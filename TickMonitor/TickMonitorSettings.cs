namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorSettings(
    bool Enabled,
    string TelegramBotToken,
    Guid? OpsChannelId,
    int MaxRepeatCount,
    int MinRepeatIntervalSeconds,
    int MinAfterSeconds,
    int OpenGraceSeconds,
    int EventsRetentionDays)
{
    public static readonly TickMonitorSettings Default = new(false, string.Empty, null, 20, 5, 5, 120, 90);

    public bool CanRun => Enabled && TelegramBotToken.Length > 0;

    public string? Validate()
    {
        if (MaxRepeatCount is < 1 or > 500)
            return "Max repeat count must be between 1 and 500.";
        if (MinRepeatIntervalSeconds is < 1 or > 3600)
            return "Min repeat interval must be between 1 and 3600 seconds.";
        if (MinAfterSeconds is < 1 or > 3600)
            return "Min alarm delay must be between 1 and 3600 seconds.";
        if (OpenGraceSeconds is < 0 or > 3600)
            return "Open grace must be between 0 and 3600 seconds.";
        if (EventsRetentionDays is < 1 or > 3650)
            return "Events retention must be between 1 and 3650 days.";
        return null;
    }
}
