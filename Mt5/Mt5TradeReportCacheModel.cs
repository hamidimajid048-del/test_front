namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5TradeReportCacheModel(
    Mt5TradeReportKindEnum Kind,
    DateTime FromUtc,
    DateTime ToUtc,
    DateTimeOffset LoadedAt,
    IReadOnlyList<object> Rows);
