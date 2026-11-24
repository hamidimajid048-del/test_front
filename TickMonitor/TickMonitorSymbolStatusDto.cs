namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorSymbolStatusDto(
    string Symbol,
    bool Enabled,
    string State,
    string? Reason,
    DateTimeOffset? LastTickAt,
    double? LastPrice,
    string? ActiveSchedule,
    string? NextStage,
    int? NextStageInSeconds,
    DateTimeOffset? GapStart,
    int StagesFired,
    DateTimeOffset? SnoozedUntil);
