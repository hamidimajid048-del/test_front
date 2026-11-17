namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5DealDto(
    ulong Login,
    ulong Deal,
    DateTime Time,
    CIMTDeal.EnDealAction Action,
    CIMTDeal.EnEntryFlag Entry,
    string Symbol,
    double Volume,
    double Price,
    double PriceSl,
    double PriceTp,
    double Profit,
    double Commission,
    double Swap,
    double Fee,
    ulong PositionId,
    ulong Order,
    string Comment,
    CIMTDeal.EnDealReason Reason);
