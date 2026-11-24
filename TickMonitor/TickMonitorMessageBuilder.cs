namespace Sgb.Trading.Violation.Panel.TickMonitor;

public static class TickMonitorMessageBuilder
{
    private const double HourSeconds = 3600d;

    public static string Alarm(string symbol, long gapStartUtcMs, long nowUtcMs, double? lastPrice)
    {
        var text = FormattableString.Invariant(
            $"Symbol: {symbol}\nNo ticks since: {Time(gapStartUtcMs)} UTC\nDuration: {Duration(nowUtcMs - gapStartUtcMs)}");
        return lastPrice is { } price ? text + FormattableString.Invariant($"\nLast price: {price:0.#####}") : text;
    }

    public static string Recovered(string symbol, long gapStartUtcMs, long gapEndUtcMs, double? priceBefore, double? priceAfter, double point)
    {
        var text = FormattableString.Invariant(
            $"Symbol: {symbol}\nGap without ticks: {Time(gapStartUtcMs)} to {Time(gapEndUtcMs)} UTC\nDuration: {Duration(gapEndUtcMs - gapStartUtcMs)}");
        return priceBefore is { } before && priceAfter is { } after && point > 0
            ? text + $"\nPrice gap: {PriceGap(before, after, point)}"
            : text;
    }

    public static string ConnectionLost() => "Tick monitor: MetaTrader connection lost";

    public static string ConnectionRestored() => "Tick monitor: MetaTrader connection restored";

    public static string Started() => "Tick monitor started";

    public static string Stopped() => "Tick monitor stopped";

    public static string Stalled(TimeSpan since) => $"Tick monitor: no evaluation for {Duration((long)since.TotalMilliseconds)}";

    public static string Test() => "Tick monitor test message";

    private static string Duration(long milliseconds)
    {
        var span = TimeSpan.FromMilliseconds(Math.Max(0, milliseconds));
        return span.TotalSeconds < HourSeconds
            ? FormattableString.Invariant($"{span.TotalSeconds:0.0} seconds")
            : FormattableString.Invariant($"{(int)span.TotalHours}h {span.Minutes:00}m {span.Seconds:00}s");
    }

    private static string PriceGap(double before, double after, double point)
    {
        var points = Math.Round((after - before) / point, 1);
        return points == 0
            ? "0.0 points"
            : FormattableString.Invariant($"{points:+0.0;-0.0} points ({before:0.#####} to {after:0.#####})");
    }

    private static string Time(long utcMs) =>
        DateTimeOffset.FromUnixTimeMilliseconds(utcMs).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
