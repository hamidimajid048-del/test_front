namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5BalancePointDto(DateTime Time, double Balance, double? GrowthPercent);
