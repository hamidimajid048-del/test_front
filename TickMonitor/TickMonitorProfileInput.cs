namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorProfileInput(Guid? Id, string? Name, string[]? Symbols, bool? Enabled, TickMonitorProfileConfig? Config);
