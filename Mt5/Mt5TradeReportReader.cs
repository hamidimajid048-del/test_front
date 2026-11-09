namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5TradeReportReader(Mt5ConnectionService mt5, TimeProvider timeProvider)
{
    public const int MaxRangeDays = 3;
    private const string All = "*";
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(2);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private Mt5TradeReportCacheModel? _cached;

    public async Task<Mt5TradeReportDto> ReadAsync(Mt5TradeReportInput input, CancellationToken cancellationToken)
    {
        var rows = await RowsAsync(input.Kind, input.FromUtc, input.ToUtc, Mask(input.Groups), Mask(input.Symbols), cancellationToken);
        if (input.VolumeFrom is not null || input.VolumeTo is not null)
        {
            var from = input.VolumeFrom ?? double.MinValue;
            var to = input.VolumeTo ?? double.MaxValue;
            rows = [.. rows.Where(row => VolumeOf(row) is var volume && volume >= from && volume <= to)];
        }

        var defaultSort = input.Kind switch
        {
            Mt5TradeReportKindEnum.Positions => nameof(Mt5PositionHistoryDto.OpenedAt),
            Mt5TradeReportKindEnum.Orders => nameof(Mt5OrderDto.SetupAt),
            _ => nameof(Mt5DealDto.Time)
        };
        return Mt5ReportTable.Page(rows, input, defaultSort);
    }

    public Mt5TradeReportOptionsDto Options() => mt5.RunManager(manager =>
    {
        List<string> groups = [];
        using (var group = manager.GroupCreate())
        {
            for (uint position = 0, total = manager.GroupTotal(); position < total; position++)
                if (manager.GroupNext(position, group) == MTRetCode.MT_RET_OK)
                    groups.Add(group.Group());
        }

        List<string> symbols = [];
        using (var symbol = manager.SymbolCreate())
        {
            for (uint position = 0, total = manager.SymbolTotal(); position < total; position++)
                if (manager.SymbolNext(position, symbol) == MTRetCode.MT_RET_OK)
                    symbols.Add(symbol.Symbol());
        }

        return new Mt5TradeReportOptionsDto(
            [.. groups.Distinct().Order(StringComparer.OrdinalIgnoreCase)],
            [.. symbols.Distinct().Order(StringComparer.OrdinalIgnoreCase)]);
    });

    private static string Mask(IReadOnlyList<string> names) => names.Count == 0 ? All : string.Join(',', names);

    private static double VolumeOf(object row) => row switch
    {
        Mt5PositionHistoryDto position => position.Volume,
        Mt5OrderDto order => order.VolumeInitial,
        Mt5DealDto deal => deal.Volume,
        _ => 0
    };

    private async Task<IReadOnlyList<object>> RowsAsync(Mt5TradeReportKindEnum kind, DateTime fromUtc, DateTime toUtc, string groups, string symbols, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var now = timeProvider.GetUtcNow();
            if (_cached is { } cached && cached.Kind == kind && cached.FromUtc == fromUtc && cached.ToUtc == toUtc
                && cached.GroupMask == groups && cached.SymbolMask == symbols && now - cached.LoadedAt < CacheLifetime)
                return cached.Rows;

            _cached = null;
            var from = new DateTimeOffset(fromUtc).ToUnixTimeSeconds();
            var to = new DateTimeOffset(toUtc).ToUnixTimeSeconds();
            var rows = await Task.Run(() => mt5.RunManager(manager => kind switch
            {
                Mt5TradeReportKindEnum.Positions => Positions(manager, groups, symbols, from, to, now.ToUnixTimeSeconds()),
                Mt5TradeReportKindEnum.Orders => Orders(manager, groups, symbols, from, to),
                _ => (IReadOnlyList<object>)[.. Deals(manager, groups, symbols, from, to)]
            }), cancellationToken);
            _cached = new Mt5TradeReportCacheModel(kind, fromUtc, toUtc, groups, symbols, now, rows);
            return rows;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static List<Mt5DealDto> Deals(CIMTManagerAPI manager, string groups, string symbols, long from, long to)
    {
        using var deals = manager.DealCreateArray();
        Mt5Reads.EnsureRead(symbols == All
            ? manager.DealRequestByGroup(groups, from, to, deals)
            : manager.DealRequestByGroupSymbol(groups, symbols, from, to, deals));
        return [.. deals.ToArray().Select(Mt5AccountDataReader.ToDto)];
    }

    private static IReadOnlyList<object> Positions(CIMTManagerAPI manager, string groups, string symbols, long from, long to, long now)
    {
        var inRange = Deals(manager, groups, symbols, from, to);
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

    private static IReadOnlyList<object> Orders(CIMTManagerAPI manager, string groups, string symbols, long from, long to)
    {
        using var history = manager.OrderCreateArray();
        Mt5Reads.EnsureRead(symbols == All
            ? manager.HistoryRequestByGroup(groups, from, to, history)
            : manager.HistoryRequestByGroupSymbol(groups, symbols, from, to, history));
        using var open = manager.OrderCreateArray();
        Mt5Reads.EnsureRead(symbols == All
            ? manager.OrderRequestByGroup(groups, open)
            : manager.OrderRequestByGroupSymbol(groups, symbols, open));

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
