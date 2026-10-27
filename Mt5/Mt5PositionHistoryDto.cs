namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5PositionHistoryDto(
    ulong PositionId,
    string Symbol,
    CIMTPosition.EnPositionAction Direction,
    double Volume,
    DateTime OpenedAt,
    double OpenPrice,
    DateTime? ClosedAt,
    double? ClosePrice,
    double Profit,
    double Commission,
    double Swap,
    double Fee,
    double NetProfit,
    bool IsOpen);
