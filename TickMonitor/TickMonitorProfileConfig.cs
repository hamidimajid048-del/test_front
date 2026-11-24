namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorProfileConfig(int CloseLeadSeconds, TickMonitorRecoveryNotice RecoveryNotice, TickMonitorSchedule[] Schedules)
{
    public TickMonitorSchedule? ActiveSchedule(DayOfWeek weekday, int minuteOfDay) =>
        Schedules.FirstOrDefault(schedule => schedule.Covers(weekday, minuteOfDay));
}
