namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record Mt5MarketStatusModel(bool Found, bool Open, string? ClosedReason, long OpenedAt, long ClosesAt, double Point)
{
    public static readonly Mt5MarketStatusModel NotFound = new(false, false, "Symbol not found", 0, 0, 0);

    public static Mt5MarketStatusModel Closed(string reason, double point) => new(true, false, reason, 0, 0, point);

    public static Mt5MarketStatusModel Opened(long openedAt, long closesAt, double point) => new(true, true, null, openedAt, closesAt, point);
}
