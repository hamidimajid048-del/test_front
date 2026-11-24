namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorEventDto(
    Guid Id,
    string Symbol,
    DateTimeOffset GapStart,
    DateTimeOffset? GapEnd,
    string? EndedBy,
    string? ScheduleName,
    int StagesFired,
    int MessagesSent,
    int MessagesFailed,
    double? LastPrice);
