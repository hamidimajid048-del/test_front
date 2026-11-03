namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5AccountRightsWriter(Mt5ConnectionService mt5)
{
    public bool Set(ulong login, Mt5AccountSwitchEnum target, bool enabled) => mt5.RunManager(manager =>
    {
        using var user = manager.UserCreate();
        var result = manager.UserRequest(login, user);
        if (result == MTRetCode.MT_RET_ERR_NOTFOUND)
            return false;

        EnsureOk(result);
        var flag = target == Mt5AccountSwitchEnum.Account
            ? CIMTUser.EnUsersRights.USER_RIGHT_ENABLED
            : CIMTUser.EnUsersRights.USER_RIGHT_TRADE_DISABLED;
        var flagSet = target == Mt5AccountSwitchEnum.Account ? enabled : !enabled;
        var current = user.Rights();
        var updated = flagSet ? current | flag : current & ~flag;
        if (updated == current)
            return true;

        EnsureOk(user.Rights(updated));
        EnsureOk(manager.UserUpdate(user));
        return true;
    });

    private static void EnsureOk(MTRetCode result)
    {
        if (result != MTRetCode.MT_RET_OK)
            throw new Mt5UnavailableException($"MetaTrader returned {result}.");
    }
}
