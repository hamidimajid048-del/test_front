namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorEventChange(
    Guid Id,
    string Symbol,
    long GapStart,
    long? GapEnd,
    string? EndedBy,
    string? ScheduleName,
    int StagesFired,
    double? LastPrice);
