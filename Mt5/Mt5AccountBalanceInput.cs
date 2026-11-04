namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5AccountBalanceInput(ulong Login, string? Kind, decimal? Amount, string? Comment);
