namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5TradeWriter(Mt5ConnectionService mt5)
{
    private const double VolumeScale = 100_000_000d;
    private static readonly TimeSpan AnswerTimeout = TimeSpan.FromSeconds(30);

    public Mt5PositionCloseQuoteDto? Quote(ulong login, ulong positionId, double? price) => mt5.RunManager(manager =>
    {
        using var position = FindPosition(manager, login, positionId);
        if (position is null)
            return null;

        var group = UserGroup(manager, login);
        var symbol = position.Symbol();
        var direction = (CIMTPosition.EnPositionAction)position.Action();
        double? profitAtPrice = null;
        if (price is { } closePrice)
        {
            var orderType = direction == CIMTPosition.EnPositionAction.POSITION_BUY ? CIMTOrder.EnOrderType.OP_BUY : CIMTOrder.EnOrderType.OP_SELL;
            EnsureOk(manager.TradeProfitExt(group, symbol, orderType, position.VolumeExt(), position.PriceOpen(), closePrice, out var profit, out _));
            profitAtPrice = Math.Round(profit, 2);
        }

        return new Mt5PositionCloseQuoteDto(
            positionId,
            symbol,
            direction,
            position.VolumeExt() / VolumeScale,
            position.PriceOpen(),
            position.PriceCurrent(),
            Math.Round(position.Profit(), 2),
            position.Digits(),
            IsMarketOpen(manager, symbol, group),
            price,
            profitAtPrice);
    });

    public async Task<Mt5DealerAnswerModel?> CloseAsync(ulong login, ulong positionId, double? price)
    {
        var sink = new Mt5DealerSink();
        EnsureOk(sink.RegisterSink());
        _ = sink.Answer.ContinueWith(_ => sink.Dispose(), TaskScheduler.Default);

        MTRetCode? sent;
        try
        {
            sent = mt5.RunManager(manager =>
            {
                using var position = FindPosition(manager, login, positionId);
                if (position is null)
                    return (MTRetCode?)null;

                using var request = manager.RequestCreate();
                request.Action(CIMTRequest.EnTradeActions.TA_DEALER_POS_EXECUTE);
                request.Flags(CIMTRequest.EnTradeActionFlags.TA_FLAG_CLOSE);
                request.Login(login);
                request.Symbol(position.Symbol());
                request.Position(positionId);
                request.Type(position.Action() == (uint)CIMTPosition.EnPositionAction.POSITION_BUY ? CIMTOrder.EnOrderType.OP_SELL : CIMTOrder.EnOrderType.OP_BUY);
                request.VolumeExt(position.VolumeExt());
                request.PriceOrder(price ?? position.PriceCurrent());
                return manager.DealerSend(request, sink, out _);
            });
        }
        catch
        {
            sink.Dispose();
            throw;
        }

        if (sent != MTRetCode.MT_RET_OK)
        {
            sink.Dispose();
            return sent is { } code ? new Mt5DealerAnswerModel(code, 0, 0) : null;
        }

        try
        {
            return await sink.Answer.WaitAsync(AnswerTimeout);
        }
        catch (TimeoutException)
        {
            return new Mt5DealerAnswerModel(MTRetCode.MT_RET_REQUEST_TIMEOUT, 0, 0);
        }
    }

    public MTRetCode? SetDealPrice(ulong login, ulong dealTicket, double price) => mt5.RunManager(manager =>
    {
        using var deal = manager.DealCreate();
        var read = manager.DealRequest(dealTicket, deal);
        if (read != MTRetCode.MT_RET_OK)
            return read;

        var digits = (int)deal.Digits();
        var target = Math.Round(price, digits);
        if (Math.Round(deal.Price(), digits) == target)
            return (MTRetCode?)null;

        var positionType = deal.Action() == (uint)CIMTDeal.EnDealAction.DEAL_SELL ? CIMTOrder.EnOrderType.OP_BUY : CIMTOrder.EnOrderType.OP_SELL;
        var calculated = manager.TradeProfitExt(
            UserGroup(manager, login), deal.Symbol(), positionType, deal.VolumeExt(), deal.PricePosition(), target, out var profit, out var rate);
        if (calculated != MTRetCode.MT_RET_OK)
            return calculated;

        deal.Price(target);
        deal.Profit(Math.Round(profit, (int)deal.DigitsCurrency()));
        deal.ProfitRaw(rate == 0 ? profit : profit / rate);
        deal.RateProfit(rate);
        var updated = manager.DealUpdate(deal);
        return updated != MTRetCode.MT_RET_OK
            ? updated
            : manager.UserBalanceCheck(login, true, out _, out _, out _, out _);
    });

    public MTRetCode? CancelOrder(ulong login, ulong orderId) => mt5.RunManager(manager =>
    {
        using var order = manager.OrderCreate();
        var result = manager.OrderRequest(orderId, order);
        if (result == MTRetCode.MT_RET_ERR_NOTFOUND)
            return (MTRetCode?)null;

        Mt5Reads.EnsureRead(result);
        return order.Login() == login ? manager.OrderCancel(orderId) : null;
    });

    private static CIMTPosition? FindPosition(CIMTManagerAPI manager, ulong login, ulong positionId)
    {
        var position = manager.PositionCreate();
        var result = manager.PositionGetByTicket(positionId, position);
        if (result == MTRetCode.MT_RET_OK && position.Login() == login)
            return position;

        position.Dispose();
        Mt5Reads.EnsureRead(result);
        return null;
    }

    private static string UserGroup(CIMTManagerAPI manager, ulong login)
    {
        using var user = manager.UserCreate();
        EnsureOk(manager.UserRequest(login, user));
        return user.Group();
    }

    private static bool IsMarketOpen(CIMTManagerAPI manager, string symbolName, string group)
    {
        using var symbol = manager.SymbolCreate();
        EnsureOk(manager.SymbolGet(symbolName, group, symbol));
        if (symbol.TradeMode() == CIMTConSymbol.EnTradeMode.TRADE_DISABLED)
            return false;

        var now = DateTimeOffset.FromUnixTimeSeconds(manager.TimeServer()).UtcDateTime;
        var day = (uint)now.DayOfWeek;
        var minute = (uint)(now.Hour * 60 + now.Minute);
        using var session = manager.SymbolSessionCreate();
        for (uint index = 0; index < symbol.SessionTradeTotal(day); index++)
            if (symbol.SessionTradeNext(day, index, session) == MTRetCode.MT_RET_OK && session.Open() <= minute && minute < session.Close())
                return true;

        return false;
    }

    private static void EnsureOk(MTRetCode result)
    {
        if (result != MTRetCode.MT_RET_OK)
            throw new Mt5UnavailableException($"MetaTrader returned {result}.");
    }
}
