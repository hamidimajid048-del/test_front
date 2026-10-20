using System.Text;

namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>
/// Account management from the command line (<c>Sgb.Trading.Violation.Panel users ...</c>), for the first super admin
/// and for recovery; super admins can do the same on the panel's Users page. Passwords are read without echo and
/// every change is recorded in the audit log.
/// </summary>
public static class PanelUserCommands
{
    public const string CommandName = "users";

    private const string Usage =
        """
        Usage: Sgb.Trading.Violation.Panel users <command> [username] [role]

          list                          List the accounts and their state
          add <username> [role]         Create an account (asks for the password, prints the authenticator key);
                                        role is 'superadmin' or 'admin', by default superadmin when there is no
                                        active super admin, otherwise admin
          set-role <username> <role>    Change the role ('superadmin' manages accounts, 'admin' sees reports only)
          reset-password <username>     Set a new password and end the account's sessions
          reset-2fa <username>          Issue a new authenticator key and end the account's sessions
          unlock <username>             Clear the failed sign-ins and the lockout
          disable <username>            Block the account and end its sessions
          enable <username>             Allow a disabled account again
          revoke-sessions <username>    End the account's sessions (sign out everywhere)
          delete <username>             Delete the account (its audit entries stay)
        """;

    public static async Task<int> RunAsync(string[] args, PanelAuthStore store)
    {
        await store.EnsureSchemaAsync();
        var command = args.ElementAtOrDefault(0);
        var username = args.ElementAtOrDefault(1)?.Trim();
        var role = args.ElementAtOrDefault(2)?.Trim().ToLowerInvariant();

        if (command == "list" && args.Length == 1)
            return await ListAsync(store);

        var takesRole = command is "add" or "set-role";
        if (command is null || string.IsNullOrEmpty(username) || args.Length > (takesRole ? 3 : 2) ||
            (command == "set-role" && role is null) || (role is not null && !PanelRoles.IsValid(role)))
        {
            Console.Error.WriteLine(Usage);
            return 1;
        }

        if (command == "add")
            return await AddAsync(store, username, role);

        var user = await store.FindUserAsync(username);
        if (user is null)
        {
            Console.Error.WriteLine($"No account named '{username}'.");
            return 1;
        }

        string? detail = null;
        switch (command)
        {
            case "set-role":
                await store.SetRoleAsync(user.Id, role!);
                await store.RevokeUserSessionsAsync(user.Id);
                detail = role;
                break;
            case "reset-password":
                if (ReadNewPassword(user.Username) is not { } password)
                    return 1;
                await store.SetPasswordAsync(user.Id, PanelSignInService.HashPassword(password));
                await store.RevokeUserSessionsAsync(user.Id);
                break;
            case "reset-2fa":
                var secret = Totp.GenerateSecret();
                await store.SetTotpSecretAsync(user.Id, secret);
                await store.RevokeUserSessionsAsync(user.Id);
                PrintAuthenticatorKey(user.Username, secret);
                break;
            case "unlock":
                await store.UnlockAsync(user.Id);
                break;
            case "disable":
                await store.SetDisabledAsync(user.Id, true);
                await store.RevokeUserSessionsAsync(user.Id);
                break;
            case "enable":
                await store.SetDisabledAsync(user.Id, false);
                break;
            case "revoke-sessions":
                await store.RevokeUserSessionsAsync(user.Id);
                break;
            case "delete":
                await store.DeleteUserAsync(user.Id);
                break;
            default:
                Console.Error.WriteLine(Usage);
                return 1;
        }

        await AuditAsync(store, command, user.Username, user.Id, detail);
        Console.WriteLine($"Done: {command} {user.Username}.");
        return 0;
    }

    private static async Task<int> AddAsync(PanelAuthStore store, string username, string? role)
    {
        if (PanelPasswordPolicy.ValidateUsername(username) is { } problem)
        {
            Console.Error.WriteLine(problem);
            return 1;
        }

        if (await store.FindUserAsync(username) is not null)
        {
            Console.Error.WriteLine($"An account named '{username}' already exists.");
            return 1;
        }

        if (ReadNewPassword(username) is not { } password)
            return 1;

        role ??= await store.CountActiveSuperAdminsAsync() == 0 ? PanelRoles.SuperAdmin : PanelRoles.Admin;
        var id = Guid.CreateVersion7();
        var secret = Totp.GenerateSecret();
        await store.CreateUserAsync(id, username, PanelSignInService.HashPassword(password), secret, role);
        await AuditAsync(store, "add", username, id, role);
        Console.WriteLine($"Account '{username}' created with the role '{role}'.");
        PrintAuthenticatorKey(username, secret);
        return 0;
    }

    private static async Task<int> ListAsync(PanelAuthStore store)
    {
        var users = await store.ListUsersAsync();
        if (users.Count == 0)
        {
            Console.WriteLine("No accounts. Create one with: users add <username>");
            return 0;
        }

        Console.WriteLine($"{"Username",-24} {"Role",-11} {"State",-10} {"Failed",6}  {"Last sign-in (UTC)",-20} Created (UTC)");
        foreach (var user in users)
        {
            var state = user.IsDisabled ? "disabled" : user.IsLocked ? "locked" : "active";
            Console.WriteLine(
                $"{user.Username,-24} {user.Role,-11} {state,-10} {user.FailedAttempts,6}  " +
                $"{user.LastSignInAt?.ToString("yyyy-MM-dd HH:mm") ?? "-",-20} {user.CreatedAt:yyyy-MM-dd HH:mm}");
        }

        return 0;
    }

    private static string? ReadNewPassword(string username)
    {
        var password = ReadSecret($"New password for {username}: ");
        var problem = PanelPasswordPolicy.Validate(username, password);
        if (problem is null && ReadSecret("Repeat the password: ") != password)
            problem = "The passwords do not match.";

        if (problem is null)
            return password;

        Console.Error.WriteLine(problem);
        return null;
    }

    private static string ReadSecret(string prompt)
    {
        Console.Write(prompt);
        if (Console.IsInputRedirected)
            return Console.ReadLine() ?? string.Empty;

        var builder = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter)
                break;
            if (key.Key == ConsoleKey.Backspace)
            {
                if (builder.Length > 0)
                    builder.Length--;
            }
            else if (!char.IsControl(key.KeyChar))
            {
                builder.Append(key.KeyChar);
            }
        }

        Console.WriteLine();
        return builder.ToString();
    }

    private static void PrintAuthenticatorKey(string username, string secret)
    {
        Console.WriteLine();
        Console.WriteLine("Add this key to an authenticator app (Google Authenticator, Microsoft Authenticator, ...).");
        Console.WriteLine("Sign-in needs its 6-digit code. The key is shown only now; give it to the user over a private channel.");
        Console.WriteLine($"  Account: {Totp.Issuer} ({username})");
        Console.WriteLine($"  Key:     {Totp.FormatSecret(secret)}");
        Console.WriteLine($"  URI:     {Totp.ProvisioningUri(username, secret)}");
    }

    private static Task AuditAsync(PanelAuthStore store, string command, string username, Guid userId, string? detail) =>
        store.AuditAsync($"cli_{command.Replace('-', '_')}", username, userId, null,
            $"cli:{Environment.UserName}@{Environment.MachineName}", detail);
}
