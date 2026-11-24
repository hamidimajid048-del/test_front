namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorPendingSend(Guid ChannelId, string ScheduleName, int Sequence, int Total, long DueAt);
