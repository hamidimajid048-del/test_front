namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5BulkBalanceRowInput(int Row, string? Login, string? Amount, string? Comment);
