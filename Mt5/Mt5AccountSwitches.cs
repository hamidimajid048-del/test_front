namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5AccountSwitches
{
    public static string Key(Mt5AccountSwitchEnum target) => target switch
    {
        Mt5AccountSwitchEnum.Account => "account",
        Mt5AccountSwitchEnum.Trading => "trading",
        _ => "stop_out"
    };

    public static string Permission(Mt5AccountSwitchEnum target) => target switch
    {
        Mt5AccountSwitchEnum.Account => PanelPermissions.SwitchAccount,
        Mt5AccountSwitchEnum.Trading => PanelPermissions.SwitchTrading,
        _ => PanelPermissions.SwitchStopOut
    };

    public static string Action(Mt5AccountSwitchEnum target, bool enabled) => $"{Key(target)}_{(enabled ? "enable" : "disable")}";
}
