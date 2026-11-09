namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5TradeReportInput(
    Mt5TradeReportKindEnum Kind,
    DateTime FromUtc,
    DateTime ToUtc,
    double? VolumeFrom,
    double? VolumeTo,
    IReadOnlyList<string> Symbols,
    IReadOnlyList<string> Groups,
    string? SortItem,
    bool SortDescending,
    int CurrentPage,
    int PageSize,
    IReadOnlyDictionary<string, string> Filters);
