namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5PositionDto(
    ulong Position,
    string Symbol,
    CIMTPosition.EnPositionAction Direction,
    double Volume,
    double PriceOpen,
    double PriceCurrent,
    double PriceSl,
    double PriceTp,
    double Profit,
    double Swap,
    DateTime OpenedAt,
    string Comment);
