namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorRecoveryNotice(bool Enabled, int MinStagesFired, Guid? ChannelId)
{
    public static readonly TickMonitorRecoveryNotice Default = new(true, 2, null);
}
