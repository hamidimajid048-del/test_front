namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5ConnectionService : BackgroundService
{
    private const string NativeManagerLibrary = "MT5APIManager64.dll";

    private readonly Mt5Options _options;
    private readonly ILogger<Mt5ConnectionService> _logger;
    private readonly Mt5Link<CIMTManagerAPI> _manager;
    private readonly Mt5Link<CIMTAdminAPI> _admin;
    private bool _factoryInitialized;

    public Mt5ConnectionService(Mt5Options options, ILogger<Mt5ConnectionService> logger)
    {
        _options = options;
        _logger = logger;

        var timeout = checked((uint)TimeSpan.FromSeconds(options.ConnectTimeoutSeconds).TotalMilliseconds);
        var adminServer = options.AdminServer.Length > 0 ? options.AdminServer : options.Server;
        var adminLogin = options.AdminLogin != 0 ? options.AdminLogin : options.Login;
        var adminPassword = options.AdminPassword.Length > 0 ? options.AdminPassword : options.Password;

        _manager = new Mt5Link<CIMTManagerAPI>(
            "manager", Servers(options.Server), logger,
            () => (SMTManagerAPIFactory.CreateManager(SMTManagerAPIFactory.ManagerAPIVersion, out var result), result),
            (api, server) => api.Connect(server, options.Login, options.Password, null, CIMTManagerAPI.EnPumpModes.PUMP_MODE_FULL, timeout),
            api => api.TimeServerRequest(out _),
            api => api.Disconnect());

        _admin = new Mt5Link<CIMTAdminAPI>(
            "admin", Servers(adminServer), logger,
            () => (SMTManagerAPIFactory.CreateAdmin(SMTManagerAPIFactory.ManagerAPIVersion, out var result), result),
            (api, server) => api.Connect(server, adminLogin, adminPassword, null, 0, timeout),
            api => api.TimeServerRequest(out _),
            api => api.Disconnect());
    }

    public Mt5StatusDto Status => new(_manager.Status, _admin.Status);

    public T RunManager<T>(Func<CIMTManagerAPI, T> action) => _manager.Run(action);

    public T RunAdmin<T>(Func<CIMTAdminAPI, T> action) => _admin.Run(action);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(_options.HealthCheckSeconds);
        var retry = TimeSpan.FromSeconds(Math.Min(_options.HealthCheckSeconds, 10));
        while (!stoppingToken.IsCancellationRequested)
        {
            var connected = false;
            try
            {
                connected = await Task.Run(Tick, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogError("Unexpected error in the MetaTrader connection loop: {Error}", exception.Message);
                CloseLinks("Unexpected error: " + exception.Message);
            }

            try
            {
                await Task.Delay(connected ? interval : retry, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        CloseLinks("Service stopped.");
        if (_factoryInitialized)
        {
            SMTManagerAPIFactory.Shutdown();
            _factoryInitialized = false;
        }
    }

    private static string[] Servers(string servers) =>
        servers.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private bool Tick()
    {
        if (!EnsureFactory())
            return false;

        var manager = _manager.Tick();
        var admin = _admin.Tick();
        return manager && admin;
    }

    private bool EnsureFactory()
    {
        if (_factoryInitialized)
            return true;

        var nativeLibraryPath = Path.Combine(AppContext.BaseDirectory, NativeManagerLibrary);
        string? error = null;
        if (!File.Exists(nativeLibraryPath))
        {
            error = $"The MetaTrader native library was not found at {nativeLibraryPath}.";
        }
        else if (SMTManagerAPIFactory.Initialize(AppContext.BaseDirectory) is var result && result != MTRetCode.MT_RET_OK)
        {
            error = $"The Manager API initialization failed with code {result}.";
        }

        if (error is not null)
        {
            _manager.Fail(error);
            _admin.Fail(error);
            return false;
        }

        _factoryInitialized = true;
        return true;
    }

    private void CloseLinks(string reason)
    {
        _manager.Close(reason);
        _admin.Close(reason);
    }
}
