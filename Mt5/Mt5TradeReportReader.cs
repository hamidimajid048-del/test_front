namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5TradeReportReader(Mt5ConnectionService mt5, TimeProvider timeProvider)
{
    public const int MaxRangeDays = 3;
    private const string AllGroups = "*";
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(2);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private Mt5TradeReportCacheModel? _cached;

    public async Task<Mt5TradeReportDto> ReadAsync(Mt5TradeReportInput input, CancellationToken cancellationToken)
    {
        var rows = await RowsAsync(input.Kind, input.FromUtc, input.ToUtc, cancellationToken);
        var defaultSort = input.Kind switch
        {
            Mt5TradeReportKindEnum.Positions => nameof(Mt5PositionHistoryDto.OpenedAt),
            Mt5TradeReportKindEnum.Orders => nameof(Mt5OrderDto.SetupAt),
            _ => nameof(Mt5DealDto.Time)
        };
        return Mt5ReportTable.Page(rows, input, defaultSort);
    }

    private async Task<IReadOnlyList<object>> RowsAsync(Mt5TradeReportKindEnum kind, DateTime fromUtc, DateTime toUtc, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var now = timeProvider.GetUtcNow();
            if (_cached is { } cached && cached.Kind == kind && cached.FromUtc == fromUtc && cached.ToUtc == toUtc && now - cached.LoadedAt < CacheLifetime)
                return cached.Rows;

            _cached = null;
            var from = new DateTimeOffset(fromUtc).ToUnixTimeSeconds();
            var to = new DateTimeOffset(toUtc).ToUnixTimeSeconds();
            var rows = await Task.Run(() => mt5.RunManager(manager => kind switch
            {
                Mt5TradeReportKindEnum.Positions => Positions(manager, from, to, now.ToUnixTimeSeconds()),
                Mt5TradeReportKindEnum.Orders => Orders(manager, from, to),
                _ => (IReadOnlyList<object>)[.. Deals(manager, from, to)]
            }), cancellationToken);
            _cached = new Mt5TradeReportCacheModel(kind, fromUtc, toUtc, now, rows);
            return rows;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static List<Mt5DealDto> Deals(CIMTManagerAPI manager, long from, long to)
    {
        using var deals = manager.DealCreateArray();
        Mt5Reads.EnsureRead(manager.DealRequestByGroup(AllGroups, from, to, deals));
        return [.. deals.ToArray().Select(Mt5AccountDataReader.ToDto)];
    }

    private static IReadOnlyList<object> Positions(CIMTManagerAPI manager, long from, long to, long now)
    {
        var inRange = Deals(manager, from, to);
        var opened = inRange
            .Where(deal => deal.PositionId != 0 && deal.Entry == CIMTDeal.EnEntryFlag.ENTRY_IN)
            .Select(deal => deal.PositionId)
            .ToHashSet();
        List<Mt5DealDto> deals = [.. inRange.Where(deal => opened.Contains(deal.PositionId))];
        var positions = Mt5DealAnalyzer.PositionHistory(deals);

        var unfinished = positions.Where(position => position.IsOpen).ToList();
        if (unfinished.Count > 0 && to < now)
        {
            var ids = unfinished.Select(position => position.PositionId).ToHashSet();
            using var later = manager.DealCreateArray();
            Mt5Reads.EnsureRead(manager.DealRequestByLogins([.. unfinished.Select(position => position.Login).Distinct()], to + 1, now, later));
            deals.AddRange(later.ToArray().Select(Mt5AccountDataReader.ToDto).Where(deal => ids.Contains(deal.PositionId)));
            positions = Mt5DealAnalyzer.PositionHistory(deals);
        }

        return [.. positions];
    }

    private static IReadOnlyList<object> Orders(CIMTManagerAPI manager, long from, long to)
    {
        using var history = manager.OrderCreateArray();
        Mt5Reads.EnsureRead(manager.HistoryRequestByGroup(AllGroups, from, to, history));
        using var open = manager.OrderCreateArray();
        Mt5Reads.EnsureRead(manager.OrderRequestByGroup(AllGroups, open));

        var fromTime = Mt5Reads.FromUnix(from);
        var toTime = Mt5Reads.FromUnix(to);
        return
        [
            .. history.ToArray().Select(Mt5AccountDataReader.ToDto)
                .Concat(open.ToArray().Select(Mt5AccountDataReader.ToDto).Where(order => order.SetupAt >= fromTime && order.SetupAt <= toTime))
                .DistinctBy(order => order.Order)
        ];
    }
}
