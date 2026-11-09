namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5TradeReportOptionsDto(IReadOnlyList<string> Groups, IReadOnlyList<string> Symbols);
