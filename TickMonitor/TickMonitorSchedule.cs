namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorSchedule(string Name, DayOfWeek[] Days, string From, string To, TickMonitorStage[] Stages)
{
    public const int MinutesPerDay = 1440;

    public bool Covers(DayOfWeek weekday, int minuteOfDay)
    {
        var from = ParseMinutes(From);
        var to = ParseMinutes(To);
        if (from < to)
            return Days.Contains(weekday) && minuteOfDay >= from && minuteOfDay < to;

        var previous = (DayOfWeek)(((int)weekday + 6) % 7);
        return (Days.Contains(weekday) && minuteOfDay >= from) || (Days.Contains(previous) && minuteOfDay < to);
    }

    public bool Overlaps(TickMonitorSchedule other)
    {
        for (var weekday = 0; weekday < 7; weekday++)
            for (var minute = 0; minute < MinutesPerDay; minute++)
                if (Covers((DayOfWeek)weekday, minute) && other.Covers((DayOfWeek)weekday, minute))
                    return true;
        return false;
    }

    public static int ParseMinutes(string time) =>
        TimeOnly.TryParseExact(time, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.Hour * 60 + parsed.Minute
            : -1;
}
