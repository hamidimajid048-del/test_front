namespace Sgb.Trading.Violation.Panel.Auth;

public static class PanelApiRules
{
    private const string ExportPrefix = "export-";

    // Report data is shared between pages (the login sessions inside the email and compare pages), so a controller lists every permission whose page reads it.
    private static readonly Dictionary<string, string[]> Controllers = new(StringComparer.OrdinalIgnoreCase)
    {
        ["login-reports"] = [PanelPermissions.LoginsView, PanelPermissions.EmailLoginsView, PanelPermissions.SimilarityView, PanelPermissions.CompareView],
        ["similarity-reports"] = [PanelPermissions.SimilarityView],
        ["value-search"] = [PanelPermissions.ValueSearchView],
        ["compare-reports"] = [PanelPermissions.CompareView],
        ["group-compare-reports"] = [PanelPermissions.CompareEmailsView],
        ["copy-trade-and-hedge-reports"] = [PanelPermissions.CopyTradeView],
        ["position-compare-reports"] = [PanelPermissions.CopyTradeView],
        ["transaction-reports"] = [PanelPermissions.AccountDataView]
    };

    public static bool IsAllowed(PathString path, ClaimsPrincipal user)
    {
        var segments = (path.Value ?? string.Empty).Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length < 3 || !Controllers.TryGetValue(segments[1], out var permissions))
            return false;

        return user.HasAnyPermission(permissions) &&
               (!segments[2].StartsWith(ExportPrefix, StringComparison.OrdinalIgnoreCase) || user.HasAnyPermission(PanelPermissions.ReportsExport));
    }
}
