namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5PositionDetailDto(Mt5PositionHistoryDto Position, IReadOnlyList<Mt5DealDto> Deals);
