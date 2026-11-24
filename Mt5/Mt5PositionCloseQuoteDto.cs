namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed record Mt5PositionCloseQuoteDto(
    ulong Position,
    string Symbol,
    CIMTPosition.EnPositionAction Direction,
    double Volume,
    double PriceOpen,
    double PriceCurrent,
    double Profit,
    uint Digits,
    bool IsMarketOpen,
    double? Price,
    double? ProfitAtPrice);
