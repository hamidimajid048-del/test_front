namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>
/// Checks a sign-in (password and one-time code), applies the lockout, records the outcome in the audit log and
/// creates the server-side session. Every failure looks the same to the caller, so the sign-in form does not reveal
/// which usernames exist or which part was wrong.
/// </summary>
public sealed class PanelSignInService(
    PanelAuthStore store,
    PanelAuthOptions options,
    TimeProvider timeProvider,
    ILogger<PanelSignInService> logger)
{
    public const int MaxUsernameLength = 64;
    public const int MaxPasswordLength = 256;
    private const int SessionTokenBytes = 32;

    private static readonly PasswordHasher<PanelUser> PasswordHasher = new();
    // Checked against when the username is unknown, so that answer takes as long as a wrong password.
    private static readonly string UnknownUserHash = PasswordHasher.HashPassword(null!, RandomNumberGenerator.GetHexString(32));

    public static string HashPassword(string password) => PasswordHasher.HashPassword(null!, password);

    public static byte[] HashSessionToken(string token) => SHA256.HashData(Convert.FromBase64String(token));

    public static bool VerifyPassword(PanelUser user, string password) =>
        password.Length <= MaxPasswordLength &&
        PasswordHasher.VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed;

    /// <summary>First step: returns the user when the username and password are right; otherwise null, after recording the failure.</summary>
    public async Task<PanelUser?> VerifyPasswordAsync(string username, string password, ClientInfo client,
        CancellationToken cancellationToken)
    {
        username = username.Trim();
        if (username.Length is 0 or > MaxUsernameLength || password.Length is 0 or > MaxPasswordLength)
        {
            await FailAsync("sign_in_failed", username.Length > MaxUsernameLength ? null : username, null, client, "malformed");
            return null;
        }

        var user = await store.FindUserAsync(username, cancellationToken);
        if (user is null)
        {
            PasswordHasher.VerifyHashedPassword(null!, UnknownUserHash, password);
            await FailAsync("sign_in_failed", username, null, client, "unknown_user");
            return null;
        }

        var passwordResult = PasswordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (user.IsDisabled || user.IsLocked)
        {
            await FailAsync("sign_in_failed", user.Username, user.Id, client, user.IsDisabled ? "disabled" : "locked");
            return null;
        }

        if (passwordResult == PasswordVerificationResult.Failed)
        {
            await RegisterFailureAsync(user, client, "wrong_password");
            return null;
        }

        if (passwordResult == PasswordVerificationResult.SuccessRehashNeeded)
            await store.UpdatePasswordHashAsync(user.Id, HashPassword(password), CancellationToken.None);
        await store.AuditAsync("password_accepted", user.Username, user.Id, client.IpAddress, client.UserAgent,
            cancellationToken: CancellationToken.None);
        return user;
    }

    /// <summary>Second step: returns the user when the one-time code is right; otherwise null, after recording the failure.</summary>
    public async Task<PanelUser?> VerifyCodeAsync(Guid userId, string code, ClientInfo client, CancellationToken cancellationToken)
    {
        code = code.Replace(" ", string.Empty).Trim();
        var user = await store.GetUserAsync(userId, cancellationToken);
        if (user is null || user.IsDisabled || user.IsLocked)
        {
            await FailAsync("sign_in_failed", user?.Username, user?.Id, client, user is null ? "unknown_user" : user.IsDisabled ? "disabled" : "locked");
            return null;
        }

        var step = user.TotpSecret is null ? null : Totp.Verify(user.TotpSecret, code, timeProvider.GetUtcNow(), user.TotpLastStep);
        if (step is not null && await store.RegisterSuccessAsync(user.Id, step.Value, null, cancellationToken))
        {
            await store.AuditAsync("sign_in_succeeded", user.Username, user.Id, client.IpAddress, client.UserAgent,
                cancellationToken: CancellationToken.None);
            return user;
        }

        await RegisterFailureAsync(user, client, user.TotpSecret is null ? "no_two_factor" : step is null ? "wrong_code" : "replayed_code");
        return null;
    }

    private async Task RegisterFailureAsync(PanelUser user, ClientInfo client, string reason)
    {
        var locked = await store.RegisterFailureAsync(user.Id, options.MaxFailedAttempts, options.Lockout, CancellationToken.None);
        await FailAsync("sign_in_failed", user.Username, user.Id, client, reason);
        if (!locked)
            return;

        await store.AuditAsync("account_locked", user.Username, user.Id, client.IpAddress, client.UserAgent,
            $"{options.MaxFailedAttempts} failed attempts; locked for {options.LockoutMinutes} minutes", CancellationToken.None);
        logger.LogWarning("Panel account {Username} is locked after {Attempts} failed sign-ins (last from {IpAddress}).",
            user.Username, options.MaxFailedAttempts, client.IpAddress);
    }

    /// <summary>Creates the session and returns its token, which only the encrypted sign-in cookie carries.</summary>
    public async Task<string> CreateSessionAsync(PanelUser user, ClientInfo client, CancellationToken cancellationToken)
    {
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(SessionTokenBytes));
        await store.CreateSessionAsync(HashSessionToken(token), user.Id, options.SessionLifetime, client.IpAddress,
            client.UserAgent, cancellationToken);
        return token;
    }

    private async Task FailAsync(string auditEvent, string? username, Guid? userId, ClientInfo client, string reason)
    {
        logger.LogWarning("Panel sign-in failed for {Username} from {IpAddress}: {Reason}.", username, client.IpAddress, reason);
        await store.AuditAsync(auditEvent, username, userId, client.IpAddress, client.UserAgent, reason, CancellationToken.None);
    }
}

public sealed record ClientInfo(string? IpAddress, string? UserAgent)
{
    private const int MaxUserAgentLength = 300;

    public static ClientInfo From(HttpContext context) => new(
        context.Connection.RemoteIpAddress?.ToString(),
        context.Request.Headers.UserAgent.ToString() is { Length: > 0 } userAgent
            ? userAgent[..Math.Min(userAgent.Length, MaxUserAgentLength)]
            : null);
}
