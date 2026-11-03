namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelPermissionPreset(string Key, string Title, string Description, IReadOnlyList<string> Permissions, bool IsBuiltIn = false);
