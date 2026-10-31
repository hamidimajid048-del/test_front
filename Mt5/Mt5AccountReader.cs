namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5AccountReader(
    [FromKeyedServices(Mt5Extensions.UsersDataSourceKey)] NpgsqlDataSource dataSource,
    ILogger<Mt5AccountReader> logger)
{
    private const string Select = """
        SELECT login, source, COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), name), group_name, email, balance
        FROM mt5.users
        """;

    public async Task<IReadOnlyList<Mt5AccountDto>> ReadAsync(IReadOnlyList<ulong> logins, CancellationToken cancellationToken)
    {
        var found = await QueryAsync($"{Select} WHERE login = ANY($1)", logins.Select(login => unchecked((long)login)).ToArray(), cancellationToken);
        var byLogin = found.ToDictionary(account => account.Login);
        return [.. logins.Select(login => byLogin.GetValueOrDefault(login)
            ?? new Mt5AccountDto(login, Mt5AccountSourceEnum.NotFound, null, null, null, null))];
    }

    public async Task<Mt5EmailSearchDto> FindByEmailAsync(string email, CancellationToken cancellationToken)
    {
        var found = await QueryAsync($"{Select} WHERE lower(email) = lower($1) ORDER BY login", email, cancellationToken);
        return new Mt5EmailSearchDto(found);
    }

    private async Task<IReadOnlyList<Mt5AccountDto>> QueryAsync(string sql, object parameter, CancellationToken cancellationToken)
    {
        try
        {
            await using var command = dataSource.CreateCommand(sql);
            command.Parameters.AddWithValue(parameter);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            List<Mt5AccountDto> accounts = [];
            while (await reader.ReadAsync(cancellationToken))
            {
                accounts.Add(new Mt5AccountDto(
                    unchecked((ulong)reader.GetInt64(0)),
                    reader.GetString(1) == "Active"
                        ? Mt5AccountSourceEnum.Manager
                        : Mt5AccountSourceEnum.Archive,
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.IsDBNull(5) ? null : Math.Round(reader.GetDouble(5), 2)));
            }

            return accounts;
        }
        catch (NpgsqlException exception)
        {
            logger.LogWarning("The MetaTrader user database could not be read: {Error}", exception.Message);
            throw new Mt5UnavailableException("The MetaTrader user database is unavailable.");
        }
    }
}
