namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorChannelInput(Guid? Id, string? Name, long? TelegramChatId, bool? Enabled);
