namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5ReportPagingDto(Mt5PageDto NormalPagingResponse, int TotalRecords);
