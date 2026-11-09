namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5BulkBalanceRowDto(
    int Row,
    string Login,
    string Amount,
    string Comment,
    Mt5BalanceKindEnum? Kind,
    decimal? Value,
    string? Name,
    string? Group,
    double? Balance,
    Mt5BulkBalanceStatusEnum Status,
    ulong? Deal,
    string Message);
