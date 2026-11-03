namespace Sgb.Trading.Violation.Panel.Mt5;

public sealed class Mt5ChangeLog(NpgsqlDataSource dataSource)
{
    public async Task RecordAsync(ulong login, string action, bool succeeded, string? detail, HttpContext context)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.mt5_account_changes (login, action, succeeded, detail, user_id, username, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """);
        command.Parameters.AddWithValue((long)login);
        command.Parameters.AddWithValue(action);
        command.Parameters.AddWithValue(succeeded);
        command.Parameters.AddWithValue((object?)detail ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)context.User.GetUserId() ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)context.User.Identity?.Name ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)ClientInfo.From(context).IpAddress ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(CancellationToken.None);
    }

    public async Task<IReadOnlyList<Mt5ChangeEntryDto>> ListAsync(ulong login, int limit, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT id, occurred_at, action, succeeded, detail, username, ip_address
            FROM violation_panel.mt5_account_changes
            WHERE login = $1
            ORDER BY id DESC
            LIMIT $2
            """);
        command.Parameters.AddWithValue((long)login);
        command.Parameters.AddWithValue(limit);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var entries = new List<Mt5ChangeEntryDto>();
        while (await reader.ReadAsync(cancellationToken))
            entries.Add(new Mt5ChangeEntryDto(
                reader.GetInt64(0),
                reader.GetDateTime(1),
                reader.GetString(2),
                reader.GetBoolean(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        return entries;
    }
}
