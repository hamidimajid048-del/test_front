namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5TradeReportCacheModel(
    Mt5TradeReportKindEnum Kind,
    DateTime FromUtc,
    DateTime ToUtc,
    string GroupMask,
    string SymbolMask,
    DateTimeOffset LoadedAt,
    IReadOnlyList<object> Rows);
