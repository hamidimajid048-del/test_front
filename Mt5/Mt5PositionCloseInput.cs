namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5PositionCloseInput(ulong Login, ulong Position, double? Price);
