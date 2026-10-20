using System.Security.Claims;

namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>The claims of the panel's sign-in cookie.</summary>
public static class PanelClaims
{
    /// <summary>The random session token; the database holds only its hash.</summary>
    public const string Session = "panel_session";
    public const string UserId = "panel_user_id";

    public static Guid? GetUserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(UserId), out var id) ? id : null;

    public static byte[]? GetSessionTokenHash(this ClaimsPrincipal principal) =>
        principal.FindFirstValue(Session) is { } token ? PanelSignInService.HashSessionToken(token) : null;
}
