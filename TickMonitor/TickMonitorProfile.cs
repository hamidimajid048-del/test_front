namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorProfile(
    Guid Id, string Symbol, bool Enabled, TickMonitorProfileConfig Config, string? UpdatedBy, DateTimeOffset UpdatedAt);
