namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record Mt5SymbolCalendarModel(
    string Symbol, string Path, bool TradingEnabled, double Point, IReadOnlyList<IReadOnlyList<(int Open, int Close)>> QuoteSessions)
{
    public bool SessionsConfigured => QuoteSessions.Any(day => day.Count > 0);

    public IReadOnlyList<(int Open, int Close)> SessionsOf(DayOfWeek weekday) =>
        SessionsConfigured ? QuoteSessions[(int)weekday] : [(0, TickMonitorSchedule.MinutesPerDay)];
}
