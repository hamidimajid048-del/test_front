namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5Link<TApi>(
    string name,
    string[] servers,
    ILogger logger,
    Func<(TApi? Api, MTRetCode Result)> create,
    Func<TApi, string, MTRetCode> connect,
    Func<TApi, MTRetCode> ping,
    Action<TApi> disconnect) where TApi : class, IDisposable
{
    private readonly object _gate = new();
    private TApi? _api;
    private volatile Mt5LinkStatusDto _status = new(false, null, null, null, "Not connected yet.");

    public Mt5LinkStatusDto Status => _status;

    public T Run<T>(Func<TApi, T> action)
    {
        lock (_gate)
        {
            return _api is null
                ? throw new Mt5UnavailableException($"The MetaTrader {name} link is not connected.")
                : action(_api);
        }
    }

    public bool Tick() => _status.Connected ? CheckHealth() : Connect();

    public void Fail(string error) => _status = new Mt5LinkStatusDto(false, null, null, DateTimeOffset.UtcNow, error);

    public void Close(string reason)
    {
        lock (_gate)
        {
            Release();
            Fail(reason);
        }
    }

    private bool Connect()
    {
        lock (_gate)
        {
            var (api, result) = create();
            if (api is null || result != MTRetCode.MT_RET_OK)
            {
                api?.Dispose();
                Fail($"The {name} API could not be created, code {result}.");
                return false;
            }

            string? lastFailure = null;
            foreach (var server in servers)
            {
                result = connect(api, server);
                if (result == MTRetCode.MT_RET_OK)
                {
                    _api = api;
                    _status = new Mt5LinkStatusDto(true, server, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null);
                    logger.LogInformation("Connected to MetaTrader server {Server} as {Link}", server, name);
                    return true;
                }

                lastFailure = $"Connection to {server} failed with code {result}.";
                logger.LogWarning("MetaTrader {Link} connection to {Server} failed with code {ReturnCode}", name, server, result);
            }

            api.Dispose();
            Fail(lastFailure ?? "No MetaTrader server is configured.");
            return false;
        }
    }

    private bool CheckHealth()
    {
        lock (_gate)
        {
            if (_api is null)
                return false;

            var result = ping(_api);
            if (result == MTRetCode.MT_RET_OK)
            {
                _status = _status with { LastCheckAt = DateTimeOffset.UtcNow, LastError = null };
                return true;
            }

            logger.LogWarning("MetaTrader {Link} health check failed with code {ReturnCode}; reconnecting", name, result);
            Release();
            Fail($"Health check failed with code {result}.");
            return false;
        }
    }

    private void Release()
    {
        if (_api is null)
            return;

        try
        {
            disconnect(_api);
        }
        catch (Exception exception)
        {
            logger.LogWarning("Error while disconnecting the MetaTrader {Link} link: {Error}", name, exception.Message);
        }

        _api.Dispose();
        _api = null;
    }
}
