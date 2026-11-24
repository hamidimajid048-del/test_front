namespace Sgb.Trading.Violation.Panel.TickMonitor;

public static class TickMonitorMessageBuilder
{
    public static string Alarm(string symbol, long gapStart, long now, string scheduleName, string channelName, int sequence, int total, double? lastPrice)
    {
        var text =
            $"⚠ {symbol} – no ticks for {Span(now - gapStart)}\n" +
            $"Since: {Time(gapStart)} (server time)\n" +
            $"Window: {scheduleName} · Stage: {channelName}" + (total > 1 ? $" ({sequence}/{total})" : string.Empty);
        if (lastPrice is { } price)
            text += $"\nLast price: {price:0.#####}";
        return text;
    }

    public static string Recovered(string symbol, long gapStart, long gapEnd, double? priceBefore, double? priceAfter, double point)
    {
        var text =
            $"✅ {symbol} – ticks resumed after {Span(gapEnd - gapStart)}\n" +
            $"Gap: {Time(gapStart)} → {Time(gapEnd)} (server time)";
        if (priceBefore is { } before && priceAfter is { } after && point > 0)
            text += $"\nPrice gap: {Math.Abs(after - before) / point:0.#} points";
        return text;
    }

    public static string ConnectionLost() => "⚠ Tick monitoring: MetaTrader connection lost. Symbol alarms are paused.";

    public static string ConnectionRestored() => "✅ Tick monitoring: MetaTrader connection restored.";

    public static string Started() => "▶ Tick monitoring started.";

    public static string Stopped() => "⏹ Tick monitoring stopped.";

    public static string Stalled(TimeSpan since) => $"⚠ Tick monitoring: no evaluation for {Span((long)since.TotalMilliseconds)}; the engine may be stalled.";

    public static string Test(string channelName) => $"🔔 Tick monitoring test message for channel \"{channelName}\".";

    public static string Span(long milliseconds)
    {
        var span = TimeSpan.FromMilliseconds(Math.Max(0, milliseconds));
        if (span.TotalHours >= 1)
            return $"{(int)span.TotalHours}h {span.Minutes:00}m {span.Seconds:00}s";
        return span.TotalMinutes >= 1 ? $"{span.Minutes}m {span.Seconds:00}s" : $"{span.Seconds}s";
    }

    private static string Time(long serverTimeMs) =>
        DateTimeOffset.FromUnixTimeMilliseconds(serverTimeMs).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
