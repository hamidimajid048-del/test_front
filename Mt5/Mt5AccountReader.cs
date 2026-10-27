namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5AccountReader(Mt5ConnectionService mt5, ILogger<Mt5AccountReader> logger)
{
    public IReadOnlyList<Mt5AccountDto> Read(IReadOnlyList<ulong> logins)
    {
        var active = mt5.RunManager(manager => ReadActive(manager, logins));
        var missing = logins.Where(login => !active.ContainsKey(login)).ToArray();
        var archived = missing.Length == 0 ? [] : ReadArchived(missing);

        return [.. logins.Select(login => active.GetValueOrDefault(login)
            ?? archived?.GetValueOrDefault(login)
            ?? new Mt5AccountDto(login, archived is null ? Mt5AccountSourceEnum.Unavailable : Mt5AccountSourceEnum.NotFound, null, null, null, null))];
    }

    private static Dictionary<ulong, Mt5AccountDto> ReadActive(CIMTManagerAPI manager, IReadOnlyList<ulong> logins)
    {
        using var users = manager.UserCreateArray();
        using var accounts = manager.UserCreateAccountArray();
        EnsureRead(manager.UserRequestByLogins([.. logins], users));
        EnsureRead(manager.UserAccountRequestByLogins([.. logins], accounts));

        var balances = accounts.ToArray().ToDictionary(account => account.Login(), account => account.Balance());
        return users.ToArray().ToDictionary(
            user => user.Login(),
            user => ToDto(user, Mt5AccountSourceEnum.Manager, balances.GetValueOrDefault(user.Login(), user.Balance())));
    }

    private Dictionary<ulong, Mt5AccountDto>? ReadArchived(ulong[] logins)
    {
        try
        {
            return mt5.RunAdmin(admin =>
            {
                using var users = admin.UserCreateArray();
                EnsureRead(admin.UserArchiveRequestByLogins(logins, users));
                return users.ToArray().ToDictionary(user => user.Login(), user => ToDto(user, Mt5AccountSourceEnum.Archive, user.Balance()));
            });
        }
        catch (Mt5UnavailableException exception)
        {
            logger.LogWarning("The MetaTrader archive could not be read: {Error}", exception.Message);
            return null;
        }
    }

    private static Mt5AccountDto ToDto(CIMTUser user, Mt5AccountSourceEnum source, double balance)
    {
        var name = $"{user.FirstName()} {user.LastName()}".Trim();
        return new Mt5AccountDto(
            user.Login(), source, name.Length > 0 ? name : user.Name(), user.Group(), user.EMail(), Math.Round(balance, 2));
    }

    private static void EnsureRead(MTRetCode result)
    {
        if (result is not (MTRetCode.MT_RET_OK or MTRetCode.MT_RET_OK_NONE or MTRetCode.MT_RET_ERR_NOTFOUND))
            throw new Mt5UnavailableException($"MetaTrader returned {result}.");
    }
}
