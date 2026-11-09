namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5TradeReportDto(IReadOnlyList<object> Items, Mt5ReportPagingDto Paging);
