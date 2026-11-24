namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class TickMonitorBackgroundService(
    TickMonitorStore store,
    Mt5ConnectionService mt5,
    Mt5MarketCalendar calendar,
    Mt5TickSink sink,
    TelegramSender telegram,
    TimeProvider timeProvider,
    ILogger<TickMonitorBackgroundService> logger) : BackgroundService
{
    private static readonly TimeSpan StepInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan LockRetryInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan ReconcileInterval = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RetentionInterval = TimeSpan.FromHours(24);
    private static readonly TimeSpan StallThreshold = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan StaleSubscriptionThreshold = TimeSpan.FromSeconds(10);

    private readonly TickMonitorEngine _engine = new();
    private readonly object _engineGate = new();
    private readonly Channel<TickMonitorSend> _queue = Channel.CreateUnbounded<TickMonitorSend>(new UnboundedChannelOptions { SingleReader = true });
    private readonly HashSet<string> _selected = new(StringComparer.OrdinalIgnoreCase);

    private TickMonitorSettings _settings = TickMonitorSettings.Default;
    private IReadOnlyList<TickMonitorProfile> _profiles = [];
    private Dictionary<Guid, TickMonitorChannel> _channels = [];
    private int _loadedVersion = -1;
    private NpgsqlConnection? _lockConnection;
    private bool _active;
    private DateTimeOffset _lastLockAttempt = DateTimeOffset.MinValue;
    private DateTimeOffset? _subscribedConnection;
    private bool _sinkRegistered;
    private bool _wasConnected;
    private bool _everConnected;
    private bool _wasRunning;
    private long _serverOffsetMs;
    private long _reconcileReceived;
    private DateTimeOffset _lastReconcile = DateTimeOffset.MinValue;
    private DateTimeOffset _lastRetention = DateTimeOffset.MinValue;
    private DateTimeOffset? _lastEvaluation;
    private bool _stallReported;
    private volatile TickMonitorStatusDto _status = new(false, false, false, "Starting", null, null, []);

    public TickMonitorStatusDto Status => _status;

    public TickMonitorSettings Settings => _settings;

    public bool Snooze(string symbol, int minutes)
    {
        if (!_profiles.Any(profile => profile.Symbols.Contains(symbol, StringComparer.OrdinalIgnoreCase)))
            return false;
        lock (_engineGate)
            _engine.Snooze(symbol, minutes <= 0 ? 0 : ServerNow() + minutes * 60_000L);
        return true;
    }

    public Task<bool> SendTestAsync(TickMonitorChannel channel, CancellationToken cancellationToken) =>
        _settings.TelegramBotToken.Length == 0
            ? Task.FromResult(false)
            : telegram.SendAsync(_settings.TelegramBotToken, channel.TelegramChatId, TickMonitorMessageBuilder.Test(), cancellationToken);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var sendLoop = SendLoopAsync(stoppingToken);
        using var timer = new PeriodicTimer(StepInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await StepAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Mt5UnavailableException exception)
                {
                    logger.LogWarning("Tick monitoring step skipped: {Error}", exception.Message);
                }
                catch (Exception exception)
                {
                    logger.LogError("Tick monitoring step failed: {Error}", exception.Message);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }

        _queue.Writer.TryComplete();
        await sendLoop;
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_wasRunning && _active)
            await SendOpsNowAsync(TickMonitorMessageBuilder.Stopped(), cancellationToken);
        await base.StopAsync(cancellationToken);
        Unsubscribe();
        await ReleaseLockAsync();
    }

    private async Task StepAsync(CancellationToken cancellationToken)
    {
        var utcNow = timeProvider.GetUtcNow();
        await ReloadConfigurationAsync(cancellationToken);

        if (!_settings.CanRun)
        {
            if (_wasRunning)
            {
                Unsubscribe();
                lock (_engineGate)
                    _engine.Reset();
                sink.Clear();
                _wasRunning = false;
                logger.LogInformation("Tick monitoring disabled from the settings");
            }
            await ReleaseLockAsync();
            _status = new TickMonitorStatusDto(false, false, mt5.Status.Manager.Connected,
                _settings.Enabled ? "Telegram bot token is not set" : "Disabled in the settings", null, null, []);
            return;
        }

        if (!_active)
        {
            if (utcNow - _lastLockAttempt >= LockRetryInterval)
            {
                _lastLockAttempt = utcNow;
                await TryAcquireLockAsync(cancellationToken);
            }
            if (!_active)
            {
                _status = new TickMonitorStatusDto(true, false, mt5.Status.Manager.Connected, "Standby: another panel instance runs the monitoring", null, null, []);
                return;
            }
        }

        if (!_wasRunning)
        {
            _wasRunning = true;
            EnqueueOps(TickMonitorMessageBuilder.Started());
            logger.LogInformation("Tick monitoring started");
        }

        var link = mt5.Status.Manager;
        var connected = link.Connected;
        if (connected && link.ConnectedAt != _subscribedConnection)
            Subscribe(link.ConnectedAt);
        if (connected != _wasConnected)
        {
            if (connected && _everConnected)
                EnqueueOps(TickMonitorMessageBuilder.ConnectionRestored());
            else if (!connected)
                EnqueueOps(TickMonitorMessageBuilder.ConnectionLost());
            _wasConnected = connected;
            _everConnected |= connected;
        }

        if (_lastEvaluation is { } last && utcNow - last > StallThreshold && !_stallReported)
        {
            _stallReported = true;
            EnqueueOps(TickMonitorMessageBuilder.Stalled(utcNow - last));
            logger.LogWarning("Tick monitoring had no evaluation for {Seconds:F0} seconds", (utcNow - last).TotalSeconds);
        }
        else if (_lastEvaluation is { } since && utcNow - since <= StallThreshold)
        {
            _stallReported = false;
        }

        var now = connected ? ServerNow() : 0;
        TickMonitorStepResult result;
        lock (_engineGate)
            result = _engine.Step(now, _serverOffsetMs, _profiles, _channels, _settings, connected, symbol => calendar.Status(symbol, now), sink.Last);

        foreach (var warning in result.Warnings)
            logger.LogWarning("{Warning}", warning);
        foreach (var change in result.Events)
            await store.UpsertEventAsync(change, cancellationToken);
        foreach (var send in result.Sends)
            _queue.Writer.TryWrite(send);

        if (connected && utcNow - _lastReconcile >= ReconcileInterval)
        {
            _lastReconcile = utcNow;
            Reconcile();
        }

        if (utcNow - _lastRetention >= RetentionInterval)
        {
            _lastRetention = utcNow;
            await store.DeleteOldEventsAsync(_settings.EventsRetentionDays, cancellationToken);
        }

        _lastEvaluation = timeProvider.GetUtcNow();
        _status = BuildStatus(connected, now);
    }

    private async Task ReloadConfigurationAsync(CancellationToken cancellationToken)
    {
        var version = store.Version;
        if (version == _loadedVersion)
            return;

        _settings = await store.GetSettingsAsync(cancellationToken);
        _profiles = await store.ListProfilesAsync(cancellationToken);
        _channels = (await store.ListChannelsAsync(cancellationToken)).ToDictionary(channel => channel.Id);
        _loadedVersion = version;

        if (_subscribedConnection is not null)
            SyncSelectedSymbols();
    }

    private async Task TryAcquireLockAsync(CancellationToken cancellationToken)
    {
        try
        {
            _lockConnection ??= await store.OpenConnectionAsync(cancellationToken);
            _active = await store.TryAcquireEngineLockAsync(_lockConnection, cancellationToken);
            if (!_active)
                logger.LogInformation("Tick monitoring is on standby: another instance holds the engine lock");
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning("Tick monitoring engine lock could not be taken: {Error}", exception.Message);
            await ReleaseLockAsync();
        }
    }

    private async Task ReleaseLockAsync()
    {
        _active = false;
        if (_lockConnection is null)
            return;
        try
        {
            await _lockConnection.DisposeAsync();
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning("Tick monitoring lock connection could not be closed: {Error}", exception.Message);
        }
        _lockConnection = null;
    }

    private void Subscribe(DateTimeOffset? connectedAt)
    {
        try
        {
            mt5.RunManager(api =>
            {
                if (!_sinkRegistered)
                {
                    var registered = sink.RegisterSink();
                    if (registered != MTRetCode.MT_RET_OK)
                        throw new Mt5UnavailableException($"The tick sink could not be registered, code {registered}.");
                    _sinkRegistered = true;
                }

                var result = api.TickSubscribe(sink);
                if (result != MTRetCode.MT_RET_OK)
                    throw new Mt5UnavailableException($"The tick subscription failed with code {result}.");

                var synced = api.TimeServerRequest(out var serverTime);
                if (synced == MTRetCode.MT_RET_OK)
                    _serverOffsetMs = serverTime - timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
                return true;
            });
        }
        catch (Mt5UnavailableException exception)
        {
            logger.LogWarning("Tick subscription is not available yet: {Error}", exception.Message);
            return;
        }

        _subscribedConnection = connectedAt;
        _selected.Clear();
        calendar.Clear();
        sink.Clear();
        lock (_engineGate)
            _engine.Reset();
        SyncSelectedSymbols();
        logger.LogInformation("Tick subscription established for {Count} symbols", _selected.Count);
    }

    private void Unsubscribe()
    {
        if (_subscribedConnection is null)
            return;
        _subscribedConnection = null;
        try
        {
            mt5.RunManager(api =>
            {
                api.TickUnsubscribe(sink);
                foreach (var symbol in _selected)
                    api.SelectedDelete(symbol);
                return true;
            });
        }
        catch (Mt5UnavailableException)
        {
        }
        _selected.Clear();
    }

    private void SyncSelectedSymbols()
    {
        var wanted = _profiles.SelectMany(profile => profile.Symbols).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var added = wanted.Where(symbol => !_selected.Contains(symbol)).ToList();
        var removed = _selected.Where(symbol => !wanted.Contains(symbol)).ToList();
        if (added.Count == 0 && removed.Count == 0)
            return;

        try
        {
            mt5.RunManager(api =>
            {
                foreach (var symbol in removed)
                    api.SelectedDelete(symbol);
                foreach (var symbol in added)
                {
                    var result = api.SelectedAdd(symbol);
                    if (result != MTRetCode.MT_RET_OK)
                        logger.LogWarning("Symbol {Symbol} could not be selected for ticks, code {ReturnCode}", symbol, result);
                    if (api.TickLast(symbol, out var tick) == MTRetCode.MT_RET_OK)
                        sink.Record(symbol, tick);
                }
                return true;
            });
        }
        catch (Mt5UnavailableException exception)
        {
            logger.LogWarning("Symbol selection for ticks failed: {Error}", exception.Message);
            return;
        }

        _selected.ExceptWith(removed);
        _selected.UnionWith(added);
    }

    private void Reconcile()
    {
        var received = sink.Received;
        var quietSubscription = received == _reconcileReceived;
        _reconcileReceived = received;
        var stale = false;
        try
        {
            mt5.RunManager(api =>
            {
                if (api.TimeServerRequest(out var serverTime) == MTRetCode.MT_RET_OK)
                    _serverOffsetMs = serverTime - timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
                foreach (var symbol in _selected)
                {
                    if (api.TickLast(symbol, out var tick) != MTRetCode.MT_RET_OK)
                        continue;
                    var known = sink.Last(symbol);
                    if (known is null || tick.datetime_msc - known.TimeMs > StaleSubscriptionThreshold.TotalMilliseconds)
                        stale |= quietSubscription;
                    sink.Record(symbol, tick);
                }
                return true;
            });
        }
        catch (Mt5UnavailableException exception)
        {
            logger.LogWarning("Tick reconciliation skipped: {Error}", exception.Message);
            return;
        }

        if (!stale)
            return;
        logger.LogWarning("Tick subscription looks stale; subscribing again");
        _subscribedConnection = null;
    }

    private async Task SendLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var send in _queue.Reader.ReadAllAsync(cancellationToken))
            {
                var sent = await telegram.SendAsync(_settings.TelegramBotToken, send.TelegramChatId, send.Text, cancellationToken);
                if (send.EventId is { } eventId)
                    await store.CountMessageAsync(eventId, sent, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            logger.LogError("Tick monitoring send loop stopped: {Error}", exception.Message);
        }
    }

    private void EnqueueOps(string text)
    {
        if (_settings.OpsChannelId is { } channelId && _channels.TryGetValue(channelId, out var channel) && channel.Enabled)
            _queue.Writer.TryWrite(new TickMonitorSend(channel.TelegramChatId, text, null, null));
        else
            logger.LogInformation("Tick monitoring notice (no ops channel): {Text}", text);
    }

    private async Task SendOpsNowAsync(string text, CancellationToken cancellationToken)
    {
        if (_settings.OpsChannelId is { } channelId && _channels.TryGetValue(channelId, out var channel) && channel.Enabled)
            await telegram.SendAsync(_settings.TelegramBotToken, channel.TelegramChatId, text, cancellationToken);
    }

    private long ServerNow() => timeProvider.GetUtcNow().ToUnixTimeMilliseconds() + _serverOffsetMs;

    private TickMonitorStatusDto BuildStatus(bool connected, long now)
    {
        var symbols = new List<TickMonitorSymbolStatusDto>(_profiles.Count);
        lock (_engineGate)
        {
            foreach (var profile in _profiles)
            foreach (var symbol in profile.Symbols)
            {
                var state = _engine.States.GetValueOrDefault(symbol);
                var tick = sink.Last(symbol);
                symbols.Add(new TickMonitorSymbolStatusDto(
                    symbol,
                    profile.Name,
                    profile.Enabled,
                    (state?.State ?? TickMonitorSymbolStateEnum.Disabled).ToString(),
                    state?.Reason,
                    tick is null ? null : Time(tick.TimeMs),
                    tick?.Price,
                    state?.ScheduleName,
                    state?.NextStage,
                    state?.NextStageInSeconds,
                    state is { State: TickMonitorSymbolStateEnum.GapOpen } ? Time(state.GapStart) : null,
                    state?.FiredStages.Count ?? 0,
                    state is { SnoozedUntil: > 0 } ? Time(state.SnoozedUntil) : null));
            }
        }

        return new TickMonitorStatusDto(
            true, true, connected, connected ? null : "MetaTrader is not connected", _lastEvaluation, connected ? Time(now) : null, symbols);
    }

    private static DateTimeOffset Time(long serverTimeMs) => DateTimeOffset.FromUnixTimeMilliseconds(serverTimeMs);
}
