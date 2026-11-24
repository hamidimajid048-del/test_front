namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorStage(int AfterSeconds, Guid ChannelId, int RepeatCount, int RepeatIntervalSeconds);
