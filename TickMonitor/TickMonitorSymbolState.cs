namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class TickMonitorSymbolState
{
    public TickMonitorSymbolStateEnum State { get; set; } = TickMonitorSymbolStateEnum.Disabled;
    public string? Reason { get; set; }
    public long TrackingSince { get; set; }
    public long GapStart { get; set; }
    public Guid EventId { get; set; }
    public string? ScheduleName { get; set; }
    public double? PriceBeforeGap { get; set; }
    public HashSet<(int Index, Guid ChannelId)> FiredStages { get; } = [];
    public List<TickMonitorPendingSend> Pending { get; } = [];
    public long SnoozedUntil { get; set; }
    public string? NextStage { get; set; }
    public int? NextStageInSeconds { get; set; }

    public void Reset(TickMonitorSymbolStateEnum state, string? reason)
    {
        State = state;
        Reason = reason;
        GapStart = 0;
        EventId = Guid.Empty;
        ScheduleName = null;
        PriceBeforeGap = null;
        FiredStages.Clear();
        Pending.Clear();
        NextStage = null;
        NextStageInSeconds = null;
    }
}
