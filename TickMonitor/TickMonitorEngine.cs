namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class TickMonitorEngine
{
    private const long DayMs = 86_400_000L;
    private const long MinuteMs = 60_000L;
    private const long SecondMs = 1000L;

    private readonly Dictionary<string, TickMonitorSymbolState> _states = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, long> _snoozes = new(StringComparer.OrdinalIgnoreCase);
    private long _serverOffsetMs;

    public IReadOnlyDictionary<string, TickMonitorSymbolState> States => _states;

    public void Snooze(string symbol, long until)
    {
        if (until <= 0)
            _snoozes.Remove(symbol);
        else
            _snoozes[symbol] = until;
    }

    public long? SnoozedUntil(string symbol) => _snoozes.TryGetValue(symbol, out var until) ? until : null;

    public void Reset() => _states.Clear();

    public TickMonitorStepResult Step(
        long now,
        long serverOffsetMs,
        IReadOnlyList<TickMonitorProfile> profiles,
        IReadOnlyDictionary<Guid, TickMonitorChannel> channels,
        TickMonitorSettings settings,
        bool connected,
        Func<string, Mt5MarketStatusModel> market,
        Func<string, TickMonitorTickModel?> lastTick)
    {
        _serverOffsetMs = serverOffsetMs;
        var result = new TickMonitorStepResult();

        foreach (var symbol in _states.Keys.Where(symbol => !profiles.Any(profile => profile.Symbols.Contains(symbol, StringComparer.OrdinalIgnoreCase))).ToList())
        {
            Transition(symbol, _states[symbol], result, TickMonitorSymbolStateEnum.Disabled, "Removed", now, "Disabled");
            _states.Remove(symbol);
        }

        foreach (var profile in profiles)
            foreach (var symbol in profile.Symbols)
            {
                if (!_states.TryGetValue(symbol, out var state))
                    _states[symbol] = state = new TickMonitorSymbolState { TrackingSince = now };
                Evaluate(now, profile, symbol, state, channels, settings, connected, market, lastTick, result);
            }

        return result;
    }

    private void Evaluate(
        long now,
        TickMonitorProfile profile,
        string symbol,
        TickMonitorSymbolState state,
        IReadOnlyDictionary<Guid, TickMonitorChannel> channels,
        TickMonitorSettings settings,
        bool connected,
        Func<string, Mt5MarketStatusModel> market,
        Func<string, TickMonitorTickModel?> lastTick,
        TickMonitorStepResult result)
    {
        if (!profile.Enabled)
        {
            Transition(symbol, state, result, TickMonitorSymbolStateEnum.Disabled, "Profile disabled", now, "Disabled");
            return;
        }

        if (!connected)
        {
            Transition(symbol, state, result, TickMonitorSymbolStateEnum.Disabled, "MetaTrader disconnected", now, "Disabled");
            state.TrackingSince = now;
            return;
        }

        var status = market(symbol);
        if (!status.Found)
        {
            Transition(symbol, state, result, TickMonitorSymbolStateEnum.Disabled, "Symbol not found", now, "Disabled");
            return;
        }

        if (!status.Open)
        {
            Transition(symbol, state, result, TickMonitorSymbolStateEnum.Closed, status.ClosedReason, now, "MarketClosed");
            return;
        }

        if (profile.Config.CloseLeadSeconds > 0 && status.ClosesAt - now <= profile.Config.CloseLeadSeconds * SecondMs)
        {
            Transition(symbol, state, result, TickMonitorSymbolStateEnum.Closed, "Closing soon", now, "MarketClosed");
            return;
        }

        if (_snoozes.TryGetValue(symbol, out var snoozedUntil) && snoozedUntil > now)
        {
            state.Pending.Clear();
            state.State = TickMonitorSymbolStateEnum.Snoozed;
            state.Reason = null;
            state.SnoozedUntil = snoozedUntil;
            state.NextStage = null;
            state.NextStageInSeconds = null;
            return;
        }

        _snoozes.Remove(symbol);
        state.SnoozedUntil = 0;
        if (state.State == TickMonitorSymbolStateEnum.Snoozed)
            state.State = GapIsOpen(state) ? TickMonitorSymbolStateEnum.GapOpen : TickMonitorSymbolStateEnum.Watching;

        var day = Math.DivRem(now, DayMs, out var timeOfDay);
        var schedule = profile.Config.ActiveSchedule((DayOfWeek)(int)(((day + 4) % 7 + 7) % 7), (int)(timeOfDay / MinuteMs));
        if (schedule is null)
        {
            Transition(symbol, state, result, TickMonitorSymbolStateEnum.Uncovered, "No time window", now, "Uncovered");
            return;
        }

        var tick = lastTick(symbol);
        if (GapIsOpen(state) && tick is not null && tick.TimeMs > state.GapStart)
        {
            Recover(symbol, state, profile, channels, status, tick, result);
            state.Reset(TickMonitorSymbolStateEnum.Watching, null);
        }

        if (now - status.OpenedAt < settings.OpenGraceSeconds * SecondMs)
        {
            if (!GapIsOpen(state))
                state.Reset(TickMonitorSymbolStateEnum.Watching, "Market just opened");
            return;
        }

        var baseline = Math.Max(Math.Max(tick?.TimeMs ?? 0, status.OpenedAt), state.TrackingSince);
        var stagesChanged = false;
        if (!GapIsOpen(state))
        {
            var gapSoFar = now - baseline;
            var first = schedule.Stages[0];
            if (gapSoFar < first.AfterSeconds * SecondMs)
            {
                state.State = TickMonitorSymbolStateEnum.Watching;
                state.Reason = null;
                state.ScheduleName = schedule.Name;
                state.NextStage = ChannelName(channels, first.ChannelId);
                state.NextStageInSeconds = (int)((first.AfterSeconds * SecondMs - gapSoFar) / SecondMs);
                return;
            }

            state.Reset(TickMonitorSymbolStateEnum.GapOpen, null);
            state.GapStart = baseline;
            state.EventId = Guid.CreateVersion7();
            state.PriceBeforeGap = tick?.Price;
            stagesChanged = true;
        }

        state.ScheduleName = schedule.Name;
        var gap = now - state.GapStart;
        for (var index = 0; index < schedule.Stages.Length; index++)
        {
            var stage = schedule.Stages[index];
            if (state.FiredStages.Contains((index, stage.ChannelId)) || gap < stage.AfterSeconds * SecondMs)
                continue;

            state.FiredStages.Add((index, stage.ChannelId));
            stagesChanged = true;
            if (!channels.TryGetValue(stage.ChannelId, out var channel) || !channel.Enabled)
            {
                result.Warnings.Add($"Stage {index + 1} of {symbol} ({schedule.Name}) points to a missing or disabled channel; nothing was sent");
                continue;
            }

            for (var sequence = 1; sequence <= stage.RepeatCount; sequence++)
                state.Pending.Add(new TickMonitorPendingSend(
                    stage.ChannelId, schedule.Name, sequence, stage.RepeatCount, now + (sequence - 1) * stage.RepeatIntervalSeconds * SecondMs));
        }

        var next = schedule.Stages
            .Select((stage, index) => (Stage: stage, Index: index))
            .FirstOrDefault(entry => !state.FiredStages.Contains((entry.Index, entry.Stage.ChannelId)));
        state.NextStage = next.Stage is null ? null : ChannelName(channels, next.Stage.ChannelId);
        state.NextStageInSeconds = next.Stage is null ? null : (int)Math.Max(0, (next.Stage.AfterSeconds * SecondMs - gap) / SecondMs);

        foreach (var pending in state.Pending.Where(pending => pending.DueAt <= now).OrderBy(pending => pending.DueAt).ToList())
        {
            state.Pending.Remove(pending);
            if (!channels.TryGetValue(pending.ChannelId, out var channel) || !channel.Enabled)
                continue;
            result.Sends.Add(new TickMonitorSend(
                channel.TelegramChatId,
                TickMonitorMessageBuilder.Alarm(symbol, state.GapStart - _serverOffsetMs, now - _serverOffsetMs, tick?.Price),
                symbol,
                state.EventId));
        }

        if (stagesChanged)
            result.Events.Add(Change(symbol, state, null, null, tick?.Price));
    }

    private void Recover(
        string symbol,
        TickMonitorSymbolState state,
        TickMonitorProfile profile,
        IReadOnlyDictionary<Guid, TickMonitorChannel> channels,
        Mt5MarketStatusModel status,
        TickMonitorTickModel tick,
        TickMonitorStepResult result)
    {
        var notice = profile.Config.RecoveryNotice;
        if (notice.Enabled && state.FiredStages.Count >= notice.MinStagesFired)
        {
            var channelId = notice.ChannelId ?? state.FiredStages.OrderBy(stage => stage.Index).First().ChannelId;
            if (channels.TryGetValue(channelId, out var channel) && channel.Enabled)
                result.Sends.Add(new TickMonitorSend(
                    channel.TelegramChatId,
                    TickMonitorMessageBuilder.Recovered(symbol, state.GapStart - _serverOffsetMs, tick.TimeMs - _serverOffsetMs, state.PriceBeforeGap, tick.Price, status.Point),
                    symbol,
                    state.EventId));
        }

        result.Events.Add(Change(symbol, state, tick.TimeMs, "Tick", tick.Price));
    }

    private static void Transition(
        string symbol, TickMonitorSymbolState state, TickMonitorStepResult result, TickMonitorSymbolStateEnum target, string? reason, long now, string endedBy)
    {
        if (GapIsOpen(state))
            result.Events.Add(Change(symbol, state, now, endedBy, null));
        state.Reset(target, reason);
    }

    private static bool GapIsOpen(TickMonitorSymbolState state) => state.EventId != Guid.Empty;

    private static TickMonitorEventChange Change(string symbol, TickMonitorSymbolState state, long? gapEnd, string? endedBy, double? lastPrice) =>
        new(state.EventId, symbol, state.GapStart, gapEnd, endedBy, state.ScheduleName, state.FiredStages.Count, lastPrice);

    private static string ChannelName(IReadOnlyDictionary<Guid, TickMonitorChannel> channels, Guid channelId) =>
        channels.TryGetValue(channelId, out var channel) ? channel.Name : "Unknown channel";
}
