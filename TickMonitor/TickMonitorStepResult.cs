namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class TickMonitorStepResult
{
    public List<TickMonitorSend> Sends { get; } = [];
    public List<TickMonitorEventChange> Events { get; } = [];
    public List<string> Warnings { get; } = [];
}
