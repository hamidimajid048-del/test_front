namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorSettingsDto(
    bool Enabled,
    bool TelegramBotTokenSet,
    string? TelegramBotTokenHint,
    Guid? OpsChannelId,
    int MaxRepeatCount,
    int MinRepeatIntervalSeconds,
    int MinAfterSeconds,
    int OpenGraceSeconds,
    int EventsRetentionDays)
{
    public static TickMonitorSettingsDto From(TickMonitorSettings settings) => new(
        settings.Enabled,
        settings.TelegramBotToken.Length > 0,
        settings.TelegramBotToken.Length >= 4 ? "•••• " + settings.TelegramBotToken[^4..] : null,
        settings.OpsChannelId,
        settings.MaxRepeatCount,
        settings.MinRepeatIntervalSeconds,
        settings.MinAfterSeconds,
        settings.OpenGraceSeconds,
        settings.EventsRetentionDays);
}
