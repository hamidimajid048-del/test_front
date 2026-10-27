namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5OpenTradesDto(IReadOnlyList<Mt5PositionDto> Positions, IReadOnlyList<Mt5OrderDto> Orders);
