namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5AccountPasswordWriter(Mt5ConnectionService mt5)
{
    public MTRetCode Change(ulong login, Mt5PasswordTypeEnum type, string password) =>
        mt5.RunManager(manager => manager.UserPasswordChange(Kind(type), login, password));

    public MTRetCode Check(ulong login, Mt5PasswordTypeEnum type, string password) =>
        mt5.RunManager(manager => manager.UserPasswordCheck(Kind(type), login, password));

    private static CIMTUser.EnUsersPasswords Kind(Mt5PasswordTypeEnum type) => type == Mt5PasswordTypeEnum.Main
        ? CIMTUser.EnUsersPasswords.USER_PASS_MAIN
        : CIMTUser.EnUsersPasswords.USER_PASS_INVESTOR;
}
