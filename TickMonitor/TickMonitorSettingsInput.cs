namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorSettingsInput(
    bool? Enabled,
    string? TelegramBotToken,
    bool? ClearTelegramBotToken,
    Guid? OpsChannelId,
    int? MaxRepeatCount,
    int? MinRepeatIntervalSeconds,
    int? MinAfterSeconds,
    int? OpenGraceSeconds,
    int? EventsRetentionDays);
