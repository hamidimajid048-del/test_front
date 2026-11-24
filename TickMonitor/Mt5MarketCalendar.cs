namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class Mt5MarketCalendar(Mt5ConnectionService mt5, TimeProvider timeProvider, ILogger<Mt5MarketCalendar> logger)
{
    private const long DayMs = 86_400_000L;
    private const long MinuteMs = 60_000L;
    private const int MaxChainDays = 7;
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromMinutes(5);

    private readonly object _gate = new();
    private readonly Dictionary<string, (Mt5SymbolCalendarModel? Model, DateTimeOffset ReadAt)> _symbols = new(StringComparer.OrdinalIgnoreCase);
    private (IReadOnlyList<Mt5HolidayModel> Holidays, DateTimeOffset ReadAt)? _holidays;
    private (IReadOnlyList<Mt5SymbolModel> Symbols, DateTimeOffset ReadAt)? _symbolList;

    public void Clear()
    {
        lock (_gate)
        {
            _symbols.Clear();
            _holidays = null;
            _symbolList = null;
        }
    }

    public Mt5MarketStatusModel Status(string symbol, long serverTimeMs)
    {
        var model = SymbolCalendar(symbol);
        if (model is null)
            return Mt5MarketStatusModel.NotFound;
        if (!model.TradingEnabled)
            return Mt5MarketStatusModel.Closed("Trading disabled", model.Point);

        var holidays = Holidays();
        var day = Math.DivRem(serverTimeMs, DayMs, out var timeOfDay);
        var minute = (int)(timeOfDay / MinuteMs);
        var intervals = Intervals(model, holidays, day, out var holiday);
        var current = intervals.FirstOrDefault(interval => minute >= interval.Open && minute < interval.Close);
        if (current == default)
            return Mt5MarketStatusModel.Closed(holiday ? "Holiday" : "Quote session", model.Point);

        var openedAt = day * DayMs + current.Open * MinuteMs;
        var closesAt = day * DayMs + current.Close * MinuteMs;
        if (current.Open == 0)
            openedAt = ChainBack(model, holidays, day, openedAt);
        if (current.Close == TickMonitorSchedule.MinutesPerDay)
            closesAt = ChainForward(model, holidays, day, closesAt);
        return Mt5MarketStatusModel.Opened(openedAt, closesAt, model.Point);
    }

    public IReadOnlyList<Mt5SymbolModel> Symbols()
    {
        lock (_gate)
        {
            if (_symbolList is { } cached && timeProvider.GetUtcNow() - cached.ReadAt < CacheLifetime)
                return cached.Symbols;
        }

        var symbols = mt5.RunManager(api =>
        {
            using var symbol = api.SymbolCreate();
            var total = api.SymbolTotal();
            var list = new List<Mt5SymbolModel>((int)total);
            for (uint position = 0; position < total; position++)
                if (api.SymbolNext(position, symbol) == MTRetCode.MT_RET_OK)
                    list.Add(new Mt5SymbolModel(symbol.Symbol(), symbol.Path()));
            return (IReadOnlyList<Mt5SymbolModel>)list;
        });

        lock (_gate)
            _symbolList = (symbols, timeProvider.GetUtcNow());
        return symbols;
    }

    private Mt5SymbolCalendarModel? SymbolCalendar(string symbol)
    {
        lock (_gate)
        {
            if (_symbols.TryGetValue(symbol, out var cached) && timeProvider.GetUtcNow() - cached.ReadAt < CacheLifetime)
                return cached.Model;
        }

        var model = mt5.RunManager(api => ReadSymbol(api, symbol));
        lock (_gate)
            _symbols[symbol] = (model, timeProvider.GetUtcNow());
        return model;
    }

    private static Mt5SymbolCalendarModel? ReadSymbol(CIMTManagerAPI api, string symbol)
    {
        using var configuration = api.SymbolCreate();
        if (api.SymbolGet(symbol, configuration) != MTRetCode.MT_RET_OK)
            return null;

        using var session = api.SymbolSessionCreate();
        var days = new List<IReadOnlyList<(int Open, int Close)>>(7);
        for (uint weekday = 0; weekday < 7; weekday++)
        {
            var sessions = new List<(int Open, int Close)>();
            for (uint position = 0, total = configuration.SessionQuoteTotal(weekday); position < total; position++)
            {
                if (configuration.SessionQuoteNext(weekday, position, session) != MTRetCode.MT_RET_OK)
                    continue;
                var open = (int)session.Open();
                var close = (int)session.Close();
                if (open >= 0 && close <= TickMonitorSchedule.MinutesPerDay && close > open)
                    sessions.Add((open, close));
            }
            days.Add(sessions);
        }

        return new Mt5SymbolCalendarModel(
            configuration.Symbol(),
            configuration.Path(),
            configuration.TradeMode() != CIMTConSymbol.EnTradeMode.TRADE_DISABLED,
            configuration.Point(),
            days);
    }

    private IReadOnlyList<Mt5HolidayModel> Holidays()
    {
        lock (_gate)
        {
            if (_holidays is { } cached && timeProvider.GetUtcNow() - cached.ReadAt < CacheLifetime)
                return cached.Holidays;
        }

        IReadOnlyList<Mt5HolidayModel> holidays;
        try
        {
            holidays = mt5.RunManager(ReadHolidays);
        }
        catch (Mt5UnavailableException exception)
        {
            logger.LogWarning("MetaTrader holidays could not be read: {Error}", exception.Message);
            holidays = [];
        }

        lock (_gate)
            _holidays = (holidays, timeProvider.GetUtcNow());
        return holidays;
    }

    private static IReadOnlyList<Mt5HolidayModel> ReadHolidays(CIMTManagerAPI api)
    {
        using var holiday = api.HolidayCreate();
        var total = api.HolidayTotal();
        var list = new List<Mt5HolidayModel>((int)total);
        for (uint position = 0; position < total; position++)
        {
            if (api.HolidayNext(position, holiday) != MTRetCode.MT_RET_OK || holiday.Mode() != CIMTConHoliday.EnHolidayMode.HOLIDAY_ENABLED)
                continue;
            var masks = new List<string>();
            for (uint index = 0, count = holiday.SymbolTotal(); index < count; index++)
                masks.Add(holiday.SymbolNext(index) ?? string.Empty);
            if (masks.Count == 0)
                masks.Add("*");
            list.Add(new Mt5HolidayModel(
                (int)holiday.Year(), (int)holiday.Month(), (int)holiday.Day(), (int)holiday.WorkFrom(), (int)holiday.WorkTo(), [.. masks]));
        }
        return list;
    }

    private static List<(int Open, int Close)> Intervals(Mt5SymbolCalendarModel model, IReadOnlyList<Mt5HolidayModel> holidays, long day, out bool holiday)
    {
        var weekday = (DayOfWeek)(int)(((day + 4) % 7 + 7) % 7);
        var date = DateOnly.FromDateTime(DateTimeOffset.FromUnixTimeMilliseconds(day * DayMs).UtcDateTime);
        var intervals = model.SessionsOf(weekday).ToList();
        holiday = false;
        foreach (var entry in holidays.Where(entry => entry.AppliesTo(date, model.Symbol, model.Path)))
        {
            holiday = true;
            if (entry.WholeDay)
                return [];
            intervals = intervals
                .Select(interval => (Open: Math.Max(interval.Open, entry.WorkFromMinutes), Close: Math.Min(interval.Close, entry.WorkToMinutes)))
                .Where(interval => interval.Close > interval.Open)
                .ToList();
        }
        return intervals;
    }

    private static long ChainBack(Mt5SymbolCalendarModel model, IReadOnlyList<Mt5HolidayModel> holidays, long day, long openedAt)
    {
        for (var step = 1; step <= MaxChainDays; step++)
        {
            var previous = Intervals(model, holidays, day - step, out _);
            var last = previous.LastOrDefault();
            if (last == default || last.Close != TickMonitorSchedule.MinutesPerDay)
                return openedAt;
            openedAt = (day - step) * DayMs + last.Open * MinuteMs;
            if (last.Open != 0)
                return openedAt;
        }
        return openedAt;
    }

    private static long ChainForward(Mt5SymbolCalendarModel model, IReadOnlyList<Mt5HolidayModel> holidays, long day, long closesAt)
    {
        for (var step = 1; step <= MaxChainDays; step++)
        {
            var next = Intervals(model, holidays, day + step, out _);
            var first = next.FirstOrDefault();
            if (first == default || first.Open != 0)
                return closesAt;
            closesAt = (day + step) * DayMs + first.Close * MinuteMs;
            if (first.Close != TickMonitorSchedule.MinutesPerDay)
                return closesAt;
        }
        return closesAt;
    }
}
