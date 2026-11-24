namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorProfile(
    Guid Id, string Name, string[] Symbols, bool Enabled, TickMonitorProfileConfig Config, string? UpdatedBy, DateTimeOffset UpdatedAt);
