namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5DealerAnswerModel(MTRetCode Code, ulong Deal, double Price);
