namespace Sgb.Trading.Violation.Panel.TickMonitor;

public static class TickMonitorMessageBuilder
{
    public static string Alarm(string symbol, long gapStartUtcMs, long nowUtcMs, double? lastPrice) =>
        FormattableString.Invariant(
            $"Symbol: {symbol}\nGap without ticks: {Time(gapStartUtcMs)} to {Time(nowUtcMs)} UTC\nDuration: {Duration(nowUtcMs - gapStartUtcMs)}");

    public static string Recovered(string symbol, long gapStartUtcMs, long gapEndUtcMs, double? priceBefore, double? priceAfter, double point) =>
        FormattableString.Invariant(
            $"Symbol: {symbol}\nGap without ticks: {Time(gapStartUtcMs)} to {Time(gapEndUtcMs)} UTC\nDuration: {Duration(gapEndUtcMs - gapStartUtcMs)}\nPrice gap: {PriceGap(priceBefore, priceAfter, point)}");

    public static string ConnectionLost() => "Tick monitor: MetaTrader connection lost";

    public static string ConnectionRestored() => "Tick monitor: MetaTrader connection restored";

    public static string Started() => "Tick monitor started";

    public static string Stopped() => "Tick monitor stopped";

    public static string Stalled(TimeSpan since) => $"Tick monitor: no evaluation for {Duration((long)since.TotalMilliseconds)}";

    public static string Test() => "Tick monitor test message";

    private static string Duration(long milliseconds) =>
        FormattableString.Invariant($"{Math.Max(0, milliseconds) / 1000d:0.0} seconds");

    private static string PriceGap(double? before, double? after, double point) =>
        before is { } first && after is { } second && point > 0
            ? FormattableString.Invariant($"{Math.Abs(second - first) / point:0.0} points")
            : "0.0 points";

    private static string Time(long utcMs) =>
        DateTimeOffset.FromUnixTimeMilliseconds(utcMs).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
