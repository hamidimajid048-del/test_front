namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5AccountDataReader(Mt5ConnectionService mt5, TimeProvider timeProvider, ILogger<Mt5AccountDataReader> logger)
{
    private const double VolumeScale = 100_000_000d;
    private const int MaxChartPoints = 1500;

    public Mt5AccountDataDto? Overview(ulong login)
    {
        var facts = mt5.RunManager(manager => ReadLiveFacts(manager, login)) ?? ReadArchivedFacts(login);
        if (facts is null)
            return null;

        var deals = Deals(login);
        var startBalance = Mt5StartBalanceParser.Parse(facts.Comment);
        var rights = facts.Rights;

        return new Mt5AccountDataDto(
            login,
            facts.Source,
            facts.Name,
            facts.Group,
            facts.Email,
            facts.Comment,
            rights.HasFlag(CIMTUser.EnUsersRights.USER_RIGHT_ENABLED),
            !rights.HasFlag(CIMTUser.EnUsersRights.USER_RIGHT_TRADE_DISABLED),
            facts.Leverage,
            facts.RegisteredAt,
            startBalance,
            Math.Round(facts.Balance, 2),
            facts.Equity is { } equity ? Math.Round(equity, 2) : null,
            Math.Round(facts.Credit, 2),
            Math.Round(Mt5DealAnalyzer.NetProfit(deals), 2),
            Mt5DealAnalyzer.GrowthPercent(facts.Balance, startBalance),
            Math.Round(Mt5DealAnalyzer.Deposits(deals), 2),
            Math.Round(Mt5DealAnalyzer.Withdrawals(deals), 2),
            deals.Count,
            Mt5DealAnalyzer.BalanceCurve(deals, startBalance, MaxChartPoints));
    }

    public Mt5OpenTradesDto OpenTrades(ulong login) => mt5.RunManager(manager =>
    {
        using var positions = manager.PositionCreateArray();
        using var orders = manager.OrderCreateArray();
        Mt5Reads.EnsureRead(manager.PositionRequest(login, positions));
        Mt5Reads.EnsureRead(manager.OrderRequestOpen(login, orders));

        return new Mt5OpenTradesDto(
            [.. positions.ToArray().Select(ToDto).OrderByDescending(position => position.OpenedAt)],
            [.. orders.ToArray().Select(ToDto).OrderByDescending(order => order.SetupAt)]);
    });

    public IReadOnlyList<Mt5DealDto> Deals(ulong login) => mt5.RunManager(manager =>
    {
        using var deals = manager.DealCreateArray();
        Mt5Reads.EnsureRead(manager.DealRequest(login, 0, timeProvider.GetUtcNow().AddDays(1).ToUnixTimeSeconds(), deals));
        return (IReadOnlyList<Mt5DealDto>)[.. deals.ToArray().Select(ToDto).OrderBy(deal => deal.Time).ThenBy(deal => deal.Deal)];
    });

    public IReadOnlyList<Mt5DealDto> Transfers(ulong login) =>
        [.. Deals(login).Where(deal => Mt5DealAnalyzer.IsTransfer(deal.Action))];

    public IReadOnlyList<Mt5PositionHistoryDto> PositionHistory(ulong login) => Mt5DealAnalyzer.PositionHistory(Deals(login));

    public IReadOnlyList<Mt5OrderDto> OrderHistory(ulong login) => mt5.RunManager(manager =>
    {
        using var orders = manager.OrderCreateArray();
        Mt5Reads.EnsureRead(manager.HistoryRequest(login, 0, timeProvider.GetUtcNow().AddDays(1).ToUnixTimeSeconds(), orders));
        return (IReadOnlyList<Mt5OrderDto>)[.. orders.ToArray().Select(ToDto).OrderByDescending(order => order.SetupAt).ThenByDescending(order => order.Order)];
    });

    private Mt5AccountFactsModel? ReadArchivedFacts(ulong login)
    {
        try
        {
            return mt5.RunAdmin(admin =>
            {
                using var user = admin.UserCreate();
                var result = admin.UserArchiveRequest(login, user);
                if (result == MTRetCode.MT_RET_ERR_NOTFOUND)
                    return null;

                Mt5Reads.EnsureRead(result);
                return ToFacts(user, Mt5AccountSourceEnum.Archive, user.Balance(), null, user.Credit());
            });
        }
        catch (Mt5UnavailableException exception)
        {
            logger.LogWarning("The MetaTrader archive could not be read: {Error}", exception.Message);
            return null;
        }
    }

    private static Mt5AccountFactsModel? ReadLiveFacts(CIMTManagerAPI manager, ulong login)
    {
        using var user = manager.UserCreate();
        var result = manager.UserRequest(login, user);
        if (result == MTRetCode.MT_RET_ERR_NOTFOUND)
            return null;

        Mt5Reads.EnsureRead(result);
        using var account = manager.UserCreateAccount();
        Mt5Reads.EnsureRead(manager.UserAccountRequest(login, account));
        return ToFacts(user, Mt5AccountSourceEnum.Manager, account.Balance(), account.Equity(), account.Credit());
    }

    private static Mt5AccountFactsModel ToFacts(CIMTUser user, Mt5AccountSourceEnum source, double balance, double? equity, double credit)
    {
        var name = $"{user.FirstName()} {user.LastName()}".Trim();
        return new Mt5AccountFactsModel(
            source,
            name.Length > 0 ? name : user.Name(),
            user.Group(),
            user.EMail(),
            user.Comment(),
            user.Rights(),
            user.Leverage(),
            Mt5Reads.FromUnixOrNull(user.Registration()),
            balance,
            equity,
            credit);
    }

    private static Mt5DealDto ToDto(CIMTDeal deal) => new(
        deal.Deal(),
        Mt5Reads.FromUnix(deal.Time()),
        (CIMTDeal.EnDealAction)deal.Action(),
        (CIMTDeal.EnEntryFlag)deal.Entry(),
        deal.Symbol(),
        deal.VolumeExt() / VolumeScale,
        deal.Price(),
        deal.Profit(),
        deal.Commission(),
        deal.Storage(),
        deal.Fee(),
        deal.PositionID(),
        deal.Order(),
        deal.Comment());

    private static Mt5PositionDto ToDto(CIMTPosition position) => new(
        position.Position(),
        position.Symbol(),
        (CIMTPosition.EnPositionAction)position.Action(),
        position.VolumeExt() / VolumeScale,
        position.PriceOpen(),
        position.PriceCurrent(),
        position.PriceSL(),
        position.PriceTP(),
        position.Profit(),
        position.Storage(),
        Mt5Reads.FromUnix(position.TimeCreate()),
        position.Comment());

    private static Mt5OrderDto ToDto(CIMTOrder order) => new(
        order.Order(),
        order.Symbol(),
        (CIMTOrder.EnOrderType)order.Type(),
        (CIMTOrder.EnOrderState)order.State(),
        order.VolumeInitialExt() / VolumeScale,
        order.VolumeCurrentExt() / VolumeScale,
        order.PriceOrder(),
        order.PriceTrigger(),
        order.PriceSL(),
        order.PriceTP(),
        Mt5Reads.FromUnix(order.TimeSetup()),
        Mt5Reads.FromUnixOrNull(order.TimeDone()),
        Mt5Reads.FromUnixOrNull(order.TimeExpiration()),
        order.PositionID(),
        order.Comment());
}
