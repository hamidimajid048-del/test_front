namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorStatusDto(
    bool Enabled,
    bool Active,
    bool Connected,
    string? Reason,
    DateTimeOffset? LastEvaluationAt,
    DateTimeOffset? ServerTime,
    IReadOnlyList<TickMonitorSymbolStatusDto> Symbols);
