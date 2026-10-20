namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>The <c>Panel:Auth</c> section: lockout and session limits of the panel sign-in.</summary>
public sealed class PanelAuthOptions
{
    public const string SectionName = "Panel:Auth";
    public const string ConnectionStringName = "PanelAuth";

    /// <summary>Failed sign-ins (wrong password or code) after which the account is locked.</summary>
    public int MaxFailedAttempts { get; init; } = 5;

    public int LockoutMinutes { get; init; } = 15;

    /// <summary>A session without a request for this long ends.</summary>
    public int IdleTimeoutMinutes { get; init; } = 30;

    /// <summary>A session ends this long after the sign-in, whatever its activity.</summary>
    public int SessionLifetimeHours { get; init; } = 8;

    public TimeSpan Lockout => TimeSpan.FromMinutes(LockoutMinutes);
    public TimeSpan IdleTimeout => TimeSpan.FromMinutes(IdleTimeoutMinutes);
    public TimeSpan SessionLifetime => TimeSpan.FromHours(SessionLifetimeHours);

    public PanelAuthOptions Validate() =>
        MaxFailedAttempts is >= 1 and <= 20 && LockoutMinutes >= 1 && IdleTimeoutMinutes >= 1 &&
        SessionLifetimeHours >= 1 && IdleTimeout <= SessionLifetime
            ? this
            : throw new InvalidOperationException(
                $"{SectionName} is invalid: MaxFailedAttempts must be 1-20, the times positive and IdleTimeoutMinutes within SessionLifetimeHours.");
}
