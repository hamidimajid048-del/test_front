namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelSessionEntry(
    string Id,
    Guid UserId,
    string Username,
    DateTime CreatedAt,
    DateTime LastSeenAt,
    DateTime ExpiresAt,
    DateTime? RevokedAt,
    string? IpAddress,
    string? UserAgent,
    bool IsCurrent);
