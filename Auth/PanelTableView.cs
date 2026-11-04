namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelTableView(Guid Id, string TableKey, string Name, bool IsDefault, PanelTableViewConfig Config);
