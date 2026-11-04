namespace Sgb.Trading.Violation.Panel.Auth;

public sealed class PanelTableViewStore(NpgsqlDataSource dataSource)
{
    public const int MaxViewsPerTable = 20;

    private const string Columns = "id, table_key, name, is_default, config::text";

    public async Task<IReadOnlyList<PanelTableView>> ListAsync(Guid userId, string keyPrefix, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT {Columns} FROM violation_panel.table_views WHERE user_id = $1 AND starts_with(table_key, $2) ORDER BY table_key, lower(name)");
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(keyPrefix);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var views = new List<PanelTableView>();
        while (await reader.ReadAsync(cancellationToken))
            views.Add(Read(reader));
        return views;
    }

    public async Task<PanelTableView?> SaveAsync(Guid userId, string tableKey, string name, PanelTableViewConfig config, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            $"""
            INSERT INTO violation_panel.table_views (id, user_id, table_key, name, config)
            SELECT $1, $2, $3, $4, $5::jsonb
            WHERE EXISTS (SELECT 1 FROM violation_panel.table_views WHERE user_id = $2 AND table_key = $3 AND lower(name) = lower($4))
               OR (SELECT count(*) FROM violation_panel.table_views WHERE user_id = $2 AND table_key = $3) < {MaxViewsPerTable}
            ON CONFLICT (user_id, table_key, (lower(name))) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
            RETURNING {Columns}
            """);
        command.Parameters.AddWithValue(Guid.CreateVersion7());
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(tableKey);
        command.Parameters.AddWithValue(name);
        command.Parameters.AddWithValue(JsonSerializer.Serialize(config, JsonSerializerOptions.Web));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task<bool> SetDefaultAsync(Guid userId, Guid id, bool isDefault, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var clear = new NpgsqlCommand(
            "UPDATE violation_panel.table_views SET is_default = false WHERE user_id = $1 AND is_default AND table_key = (SELECT table_key FROM violation_panel.table_views WHERE id = $2 AND user_id = $1)",
            connection, transaction);
        clear.Parameters.AddWithValue(userId);
        clear.Parameters.AddWithValue(id);
        await clear.ExecuteNonQueryAsync(cancellationToken);

        await using var set = new NpgsqlCommand(
            "UPDATE violation_panel.table_views SET is_default = $3 WHERE id = $2 AND user_id = $1", connection, transaction);
        set.Parameters.AddWithValue(userId);
        set.Parameters.AddWithValue(id);
        set.Parameters.AddWithValue(isDefault);
        var found = await set.ExecuteNonQueryAsync(cancellationToken) == 1;
        await transaction.CommitAsync(cancellationToken);
        return found;
    }

    public async Task<bool> DeleteAsync(Guid userId, Guid id, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("DELETE FROM violation_panel.table_views WHERE id = $1 AND user_id = $2");
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(userId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private static PanelTableView Read(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetBoolean(3),
        JsonSerializer.Deserialize<PanelTableViewConfig>(reader.GetString(4), JsonSerializerOptions.Web) ?? new PanelTableViewConfig(null, null));
}
