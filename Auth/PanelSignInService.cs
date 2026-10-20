using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;

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

    /// <summary>Returns the user when the sign-in is valid; otherwise null, after recording the failure.</summary>
    public async Task<PanelUser?> VerifyAsync(string username, string password, string code, ClientInfo client,
        CancellationToken cancellationToken)
    {
        username = username.Trim();
        code = code.Replace(" ", string.Empty).Trim();
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
            // A correct password does not unlock or reveal anything while the account is locked or disabled.
            await FailAsync("sign_in_failed", user.Username, user.Id, client, user.IsDisabled ? "disabled" : "locked");
            return null;
        }

        var reason = passwordResult == PasswordVerificationResult.Failed ? "wrong_password" : null;
        long? step = null;
        if (reason is null)
        {
            step = user.TotpSecret is null
                ? null
                : Totp.Verify(user.TotpSecret, code, timeProvider.GetUtcNow(), user.TotpLastStep);
            if (step is null)
                reason = user.TotpSecret is null ? "no_two_factor" : "wrong_code";
        }

        if (reason is null)
        {
            var rehashed = passwordResult == PasswordVerificationResult.SuccessRehashNeeded ? HashPassword(password) : null;
            if (await store.RegisterSuccessAsync(user.Id, step!.Value, rehashed, cancellationToken))
            {
                await store.AuditAsync("sign_in_succeeded", user.Username, user.Id, client.IpAddress, client.UserAgent,
                    cancellationToken: CancellationToken.None);
                return user;
            }

            reason = "replayed_code";
        }

        var locked = await store.RegisterFailureAsync(user.Id, options.MaxFailedAttempts, options.Lockout, CancellationToken.None);
        await FailAsync("sign_in_failed", user.Username, user.Id, client, reason);
        if (locked)
        {
            await store.AuditAsync("account_locked", user.Username, user.Id, client.IpAddress, client.UserAgent,
                $"{options.MaxFailedAttempts} failed attempts; locked for {options.LockoutMinutes} minutes", CancellationToken.None);
            logger.LogWarning("Panel account {Username} is locked after {Attempts} failed sign-ins (last from {IpAddress}).",
                user.Username, options.MaxFailedAttempts, client.IpAddress);
        }

        return null;
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
