namespace Sgb.Trading.Violation.Panel.Auth;

public static class PanelPermissions
{
    public const string AccountDataView = "account-data.view";
    public const string SwitchAccount = "account-data.switch-account";
    public const string SwitchTrading = "account-data.switch-trading";
    public const string SwitchStopOut = "account-data.switch-stop-out";
    public const string AccountChangesView = "account-data.changes";
    public const string LoginsView = "logins.view";
    public const string EmailLoginsView = "email-logins.view";
    public const string SimilarityView = "similarity.view";
    public const string ValueSearchView = "value-search.view";
    public const string CopyTradeView = "copy-trade.view";
    public const string CompareView = "compare.view";
    public const string CompareEmailsView = "compare-emails.view";
    public const string ReportsExport = "reports.export";
    public const string AccountChangePassword = "account.change-password";
    public const string UsersView = "users.view";
    public const string UsersCreate = "users.create";
    public const string UsersEditPermissions = "users.edit-permissions";
    public const string UsersResetCredentials = "users.reset-credentials";
    public const string UsersManageState = "users.manage-state";
    public const string UsersDelete = "users.delete";
    public const string AuditView = "audit.view";

    private const string ReportsGroup = "Reports";
    private const string OperationsGroup = "Operations";
    private const string MyAccountGroup = "My account";
    private const string AdministrationGroup = "Administration";

    public static readonly IReadOnlyList<PanelPermission> All =
    [
        new(AccountDataView, ReportsGroup, "Account data", "One account's status, balance, trades and histories."),
        new(LoginsView, ReportsGroup, "Login history", "Sessions of a login with IP, CID and location."),
        new(EmailLoginsView, ReportsGroup, "Email logins", "Every login of an email with its IPs, CIDs and sessions."),
        new(SimilarityView, ReportsGroup, "IP/CID similarity", "Logins that share an IP or CID."),
        new(ValueSearchView, ReportsGroup, "CID / IP search", "Logins that used a given IP or CID."),
        new(CopyTradeView, ReportsGroup, "Copy trade & hedge", "Accounts that opened the same or opposite trades."),
        new(CompareView, ReportsGroup, "Compare accounts", "Two logins side by side."),
        new(CompareEmailsView, ReportsGroup, "Compare emails", "All logins of two emails compared."),
        new(AccountChangesView, ReportsGroup, "Account change log", "Every change made to a trading account from the panel.", AccountDataView),
        new(ReportsExport, ReportsGroup, "Export to Excel / CSV", "Download report data as files."),
        new(SwitchAccount, OperationsGroup, "Enable / disable account", "Turn a trading account on or off.", AccountDataView),
        new(SwitchTrading, OperationsGroup, "Enable / disable trading", "Allow or block trading on an account.", AccountDataView),
        new(SwitchStopOut, OperationsGroup, "Enable / disable stop-out plugin", "Turn the stop-out plugin on or off for an account.", AccountDataView),
        new(AccountChangePassword, MyAccountGroup, "Change own password", "Change the password of the signed-in account."),
        new(UsersView, AdministrationGroup, "See accounts", "Open the Users page and list the panel accounts."),
        new(UsersCreate, AdministrationGroup, "Add accounts", "Create panel accounts.", UsersView),
        new(UsersEditPermissions, AdministrationGroup, "Edit access", "Change what other accounts may do.", UsersView),
        new(UsersResetCredentials, AdministrationGroup, "Reset passwords and 2FA", "Set a new password or authenticator key for another account.", UsersView),
        new(UsersManageState, AdministrationGroup, "Disable, enable, unlock, sign out", "Block or allow an account, clear its lockout and end its sessions.", UsersView),
        new(UsersDelete, AdministrationGroup, "Delete accounts", "Delete panel accounts.", UsersView),
        new(AuditView, AdministrationGroup, "Audit log", "Read sign-ins and account changes.", UsersView)
    ];

    public static readonly string[] AllReportViews =
        [AccountDataView, LoginsView, EmailLoginsView, SimilarityView, ValueSearchView, CopyTradeView, CompareView, CompareEmailsView];

    public static readonly IReadOnlyList<string> AllKeys = [.. All.Select(permission => permission.Key)];

    public static readonly IReadOnlyList<string> ForExistingAdmins =
        [.. All.Where(permission => permission.Group != AdministrationGroup).Select(permission => permission.Key)];

    public static readonly IReadOnlyList<PanelPermissionPreset> Presets =
    [
        new("viewer", "Viewer", "Reads every report; no export, no changes.",
            [.. All.Where(permission => permission.Group == ReportsGroup && permission.Key != ReportsExport).Select(permission => permission.Key), AccountChangePassword]),
        new("analyst", "Analyst", "Viewer, plus export and the account switches.", ForExistingAdmins),
        new("full", "Full access", "Everything, including managing the other accounts.", AllKeys)
    ];

    public static PanelPermissionPreset DefaultPreset => Presets[0];

    public static bool IsKnown(string key) => All.Any(permission => permission.Key == key);

    public static string[] Normalize(IEnumerable<string> keys)
    {
        var wanted = keys.ToHashSet();
        return
        [
            .. All
                .Where(permission => wanted.Contains(permission.Key) || All.Any(other => wanted.Contains(other.Key) && other.Requires == permission.Key))
                .Select(permission => permission.Key)
        ];
    }

    public static IReadOnlyList<string> Effective(string role, IEnumerable<string> granted) =>
        role == PanelRoles.SuperAdmin ? AllKeys : Normalize(granted);

    public static string[]? Parse(string? specification)
    {
        if (string.IsNullOrWhiteSpace(specification))
            return null;

        var preset = Presets.FirstOrDefault(candidate => string.Equals(candidate.Key, specification.Trim(), StringComparison.OrdinalIgnoreCase));
        if (preset is not null)
            return [.. preset.Permissions];

        var keys = specification.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return keys.All(IsKnown) ? Normalize(keys) : null;
    }
}
