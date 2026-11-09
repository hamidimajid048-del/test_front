namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5BulkBalanceCheckInput(IReadOnlyList<Mt5BulkBalanceRowInput>? Rows);
