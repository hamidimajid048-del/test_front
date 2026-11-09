namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5BulkBalanceApplyInput(Guid BatchId, IReadOnlyList<Mt5BulkBalanceRowInput>? Rows);
