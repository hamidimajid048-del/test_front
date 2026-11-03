namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelPendingTicket(Guid UserId, string? AccessToken, DateTimeOffset ExpiresAt);
