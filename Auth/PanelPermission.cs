namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelPermission(string Key, string Group, string Title, string Description, string? Requires = null);
