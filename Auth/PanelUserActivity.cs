namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelUserActivity(
    Guid UserId,
    string Username,
    string Role,
    string State,
    bool TwoFactor,
    int SignIns,
    int FailedSignIns,
    int DistinctIps,
    int ActiveSessions,
    DateTime? LastSignInAt,
    string? LastIpAddress,
    DateTime? LastFailureAt,
    int Changes);
