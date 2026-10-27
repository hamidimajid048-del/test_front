namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5DealAnalyzer
{
    private const double VolumeEpsilon = 1e-9;

    public static bool IsTransfer(CIMTDeal.EnDealAction action) =>
        action is CIMTDeal.EnDealAction.DEAL_BALANCE or CIMTDeal.EnDealAction.DEAL_CREDIT or CIMTDeal.EnDealAction.DEAL_CHARGE
            or CIMTDeal.EnDealAction.DEAL_CORRECTION or CIMTDeal.EnDealAction.DEAL_BONUS;

    public static double Result(Mt5DealDto deal) => deal.Profit + deal.Commission + deal.Swap + deal.Fee;

    public static double NetProfit(IEnumerable<Mt5DealDto> deals) =>
        deals.Where(deal => !IsTransfer(deal.Action)).Sum(Result);

    public static double Deposits(IEnumerable<Mt5DealDto> deals) =>
        deals.Where(deal => deal.Action == CIMTDeal.EnDealAction.DEAL_BALANCE && deal.Profit > 0).Sum(deal => deal.Profit);

    public static double Withdrawals(IEnumerable<Mt5DealDto> deals) =>
        -deals.Where(deal => deal.Action == CIMTDeal.EnDealAction.DEAL_BALANCE && deal.Profit < 0).Sum(deal => deal.Profit);

    public static IReadOnlyList<Mt5BalancePointDto> BalanceCurve(IEnumerable<Mt5DealDto> deals, double? startBalance, int maxPoints)
    {
        var balance = 0d;
        List<Mt5BalancePointDto> points = [];
        foreach (var deal in deals
            .Where(deal => deal.Action is not (CIMTDeal.EnDealAction.DEAL_CREDIT or CIMTDeal.EnDealAction.DEAL_BONUS) && Result(deal) != 0)
            .OrderBy(deal => deal.Time)
            .ThenBy(deal => deal.Deal))
        {
            balance += Result(deal);
            points.Add(new Mt5BalancePointDto(deal.Time, Math.Round(balance, 2), GrowthPercent(balance, startBalance)));
        }

        if (points.Count <= maxPoints)
            return points;

        var step = (int)Math.Ceiling(points.Count / (double)maxPoints);
        return [.. points.Where((_, index) => index % step == 0 || index == points.Count - 1)];
    }

    public static double? GrowthPercent(double balance, double? startBalance) =>
        startBalance is { } start ? Math.Round((balance - start) / start * 100, 2) : null;

    public static IReadOnlyList<Mt5PositionHistoryDto> PositionHistory(IEnumerable<Mt5DealDto> deals) =>
    [.. deals
        .Where(deal => deal.PositionId != 0 && deal.Action is CIMTDeal.EnDealAction.DEAL_BUY or CIMTDeal.EnDealAction.DEAL_SELL)
        .GroupBy(deal => deal.PositionId)
        .Select(Position)
        .OrderByDescending(position => position.OpenedAt)
        .ThenByDescending(position => position.PositionId)];

    private static Mt5PositionHistoryDto Position(IGrouping<ulong, Mt5DealDto> group)
    {
        var all = group.OrderBy(deal => deal.Time).ThenBy(deal => deal.Deal).ToList();
        var ins = all.Where(deal => deal.Entry == CIMTDeal.EnEntryFlag.ENTRY_IN).ToList();
        var outs = all.Where(deal => deal.Entry != CIMTDeal.EnEntryFlag.ENTRY_IN).ToList();
        var opening = ins.Count > 0 ? ins : all;
        var direction = opening[0].Action == CIMTDeal.EnDealAction.DEAL_BUY
            ? CIMTPosition.EnPositionAction.POSITION_BUY
            : CIMTPosition.EnPositionAction.POSITION_SELL;
        if (ins.Count == 0)
            direction = direction == CIMTPosition.EnPositionAction.POSITION_BUY
                ? CIMTPosition.EnPositionAction.POSITION_SELL
                : CIMTPosition.EnPositionAction.POSITION_BUY;

        var openedVolume = ins.Sum(deal => deal.Volume);
        var closedVolume = outs.Sum(deal => deal.Volume);
        var isOpen = outs.Count == 0 || closedVolume + VolumeEpsilon < openedVolume;

        return new Mt5PositionHistoryDto(
            group.Key,
            all[0].Symbol,
            direction,
            openedVolume,
            opening[0].Time,
            WeightedPrice(ins),
            isOpen || outs.Count == 0 ? null : outs[^1].Time,
            outs.Count == 0 ? null : WeightedPrice(outs),
            all.Sum(deal => deal.Profit),
            all.Sum(deal => deal.Commission),
            all.Sum(deal => deal.Swap),
            all.Sum(deal => deal.Fee),
            all.Sum(Result),
            isOpen);
    }

    private static double WeightedPrice(IReadOnlyList<Mt5DealDto> deals)
    {
        var volume = deals.Sum(deal => deal.Volume);
        return volume <= 0 ? deals.Count == 0 ? 0 : deals[0].Price : deals.Sum(deal => deal.Price * deal.Volume) / volume;
    }
}
