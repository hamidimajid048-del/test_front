namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>Account roles: a super admin also manages the accounts; an admin sees the reports only.</summary>
public static class PanelRoles
{
    public const string SuperAdmin = "superadmin";
    public const string Admin = "admin";

    public static bool IsValid(string? role) => role is SuperAdmin or Admin;
}

/// <summary>The rules for a new password, shared by the account pages and the <c>users</c> commands.</summary>
public static class PanelPasswordPolicy
{
    public const int MinimumLength = 6;

    /// <summary>Returns why the password is not allowed, or null when it is.</summary>
    public static string? Validate(string username, string password) =>
        password.Length < MinimumLength ? $"The password needs at least {MinimumLength} characters."
        : password.Length > PanelSignInService.MaxPasswordLength ? $"The password has at most {PanelSignInService.MaxPasswordLength} characters."
        : password.Contains(username, StringComparison.OrdinalIgnoreCase) ? "The password must not contain the username."
        : null;

    /// <summary>Returns why the username is not allowed, or null when it is.</summary>
    public static string? ValidateUsername(string username) =>
        username.Length is 0 or > PanelSignInService.MaxUsernameLength || username.Any(character => char.IsWhiteSpace(character) || char.IsControl(character))
            ? $"A username has 1 to {PanelSignInService.MaxUsernameLength} characters and no spaces."
            : null;
}
