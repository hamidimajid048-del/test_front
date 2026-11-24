namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorProfileInput(Guid? Id, string? Symbol, bool? Enabled, TickMonitorProfileConfig? Config);
