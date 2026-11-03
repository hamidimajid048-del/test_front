namespace Sgb.Trading.Violation.Panel.Auth;

public sealed class PanelPendingSignIn(IDataProtectionProvider dataProtection, TimeProvider timeProvider)
{
    public const string CookieName = "violation-panel.pending";
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(5);

    private readonly IDataProtector protector = dataProtection.CreateProtector(CookieName);

    public void Issue(HttpContext context, Guid userId, string? accessToken)
    {
        var ticket = new PanelPendingTicket(userId, accessToken, timeProvider.GetUtcNow().Add(Lifetime));
        context.Response.Cookies.Append(CookieName, protector.Protect(JsonSerializer.Serialize(ticket)), Options(context));
    }

    public PanelPendingTicket? Read(HttpContext context)
    {
        if (!context.Request.Cookies.TryGetValue(CookieName, out var value))
            return null;

        try
        {
            var ticket = JsonSerializer.Deserialize<PanelPendingTicket>(protector.Unprotect(value));
            return ticket is not null && ticket.ExpiresAt > timeProvider.GetUtcNow() ? ticket : null;
        }
        catch (Exception exception) when (exception is CryptographicException or JsonException)
        {
            return null;
        }
    }

    public void Clear(HttpContext context) => context.Response.Cookies.Delete(CookieName, Options(context));

    private static CookieOptions Options(HttpContext context) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Strict,
        Secure = context.Request.IsHttps,
        Path = "/auth",
        MaxAge = Lifetime
    };
}
