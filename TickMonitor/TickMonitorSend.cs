namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed record TickMonitorSend(long TelegramChatId, string Text, string? Symbol, Guid? EventId);
