namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5DealDto(
    ulong Deal,
    DateTime Time,
    CIMTDeal.EnDealAction Action,
    CIMTDeal.EnEntryFlag Entry,
    string Symbol,
    double Volume,
    double Price,
    double Profit,
    double Commission,
    double Swap,
    double Fee,
    ulong PositionId,
    ulong Order,
    string Comment);
