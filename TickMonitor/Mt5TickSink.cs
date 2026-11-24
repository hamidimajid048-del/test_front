namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class Mt5TickSink : CIMTTickSink
{
    private readonly ConcurrentDictionary<string, TickMonitorTickModel> _lastTicks = new(StringComparer.OrdinalIgnoreCase);
    private long _received;

    public long Received => Volatile.Read(ref _received);

    public override void OnTick(string symbol, MTTickShort tick)
    {
        Record(symbol, tick);
        Interlocked.Increment(ref _received);
    }

    public void Record(string symbol, MTTickShort tick)
    {
        var model = new TickMonitorTickModel(tick.datetime_msc, PriceOf(tick));
        _lastTicks.AddOrUpdate(symbol, model, (_, current) => current.TimeMs >= model.TimeMs ? current : model);
    }

    public TickMonitorTickModel? Last(string symbol) => _lastTicks.GetValueOrDefault(symbol);

    public void Clear() => _lastTicks.Clear();

    private static double? PriceOf(MTTickShort tick) =>
        tick.last != 0 ? tick.last :
        tick.bid != 0 ? tick.bid :
        tick.ask != 0 ? tick.ask : null;
}
