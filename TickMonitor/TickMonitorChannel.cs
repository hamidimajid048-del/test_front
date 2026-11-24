namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorChannel(Guid Id, string Name, long TelegramChatId, bool Enabled, DateTimeOffset UpdatedAt);
