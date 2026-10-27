namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5OrderDto(
    ulong Order,
    string Symbol,
    CIMTOrder.EnOrderType Type,
    CIMTOrder.EnOrderState State,
    double VolumeInitial,
    double VolumeCurrent,
    double PriceOrder,
    double PriceTrigger,
    double PriceSl,
    double PriceTp,
    DateTime SetupAt,
    DateTime? DoneAt,
    DateTime? ExpiresAt,
    ulong PositionId,
    string Comment);
