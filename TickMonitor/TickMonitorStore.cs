namespace Sgb.Trading.Violation.Panel.TickMonitor;

public sealed class TickMonitorStore(NpgsqlDataSource dataSource)
{
    public const int MaxEvents = 1000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerOptions.Web) { Converters = { new JsonStringEnumConverter() } };
    private int _version;

    public int Version => Volatile.Read(ref _version);

    public async Task<TickMonitorSettings> GetSettingsAsync(CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("SELECT config::text FROM violation_panel.tick_monitor_settings WHERE id");
        var json = await command.ExecuteScalarAsync(cancellationToken) as string;
        return json is null ? TickMonitorSettings.Default : JsonSerializer.Deserialize<TickMonitorSettings>(json, Json) ?? TickMonitorSettings.Default;
    }

    public async Task SaveSettingsAsync(TickMonitorSettings settings, string? updatedBy, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.tick_monitor_settings (id, config, updated_by)
            VALUES (true, $1::jsonb, $2)
            ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = now()
            """);
        command.Parameters.AddWithValue(JsonSerializer.Serialize(settings, Json));
        command.Parameters.AddWithValue((object?)updatedBy ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
        Changed();
    }

    public async Task<IReadOnlyList<TickMonitorChannel>> ListChannelsAsync(CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            "SELECT id, name, telegram_chat_id, enabled, updated_at FROM violation_panel.tick_monitor_channels ORDER BY lower(name)");
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var channels = new List<TickMonitorChannel>();
        while (await reader.ReadAsync(cancellationToken))
            channels.Add(new TickMonitorChannel(
                reader.GetGuid(0), reader.GetString(1), reader.GetInt64(2), reader.GetBoolean(3), reader.GetFieldValue<DateTime>(4)));
        return channels;
    }

    public async Task<TickMonitorChannel?> SaveChannelAsync(Guid id, string name, long telegramChatId, bool enabled, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.tick_monitor_channels (id, name, telegram_chat_id, enabled)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, telegram_chat_id = EXCLUDED.telegram_chat_id, enabled = EXCLUDED.enabled, updated_at = now()
            RETURNING id, name, telegram_chat_id, enabled, updated_at
            """);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(name);
        command.Parameters.AddWithValue(telegramChatId);
        command.Parameters.AddWithValue(enabled);
        try
        {
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return null;
            var channel = new TickMonitorChannel(
                reader.GetGuid(0), reader.GetString(1), reader.GetInt64(2), reader.GetBoolean(3), reader.GetFieldValue<DateTime>(4));
            Changed();
            return channel;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<string>> ProfilesUsingChannelAsync(Guid channelId, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT symbol FROM violation_panel.tick_monitor_profiles
            WHERE config::text LIKE '%' || $1 || '%'
            ORDER BY lower(symbol)
            """);
        command.Parameters.AddWithValue(channelId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var symbols = new List<string>();
        while (await reader.ReadAsync(cancellationToken))
            symbols.Add(reader.GetString(0));
        return symbols;
    }

    public async Task<bool> DeleteChannelAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("DELETE FROM violation_panel.tick_monitor_channels WHERE id = $1");
        command.Parameters.AddWithValue(id);
        var deleted = await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        if (deleted)
            Changed();
        return deleted;
    }

    public async Task<IReadOnlyList<TickMonitorProfile>> ListProfilesAsync(CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            "SELECT id, symbol, enabled, config::text, updated_by, updated_at FROM violation_panel.tick_monitor_profiles ORDER BY lower(symbol)");
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var profiles = new List<TickMonitorProfile>();
        while (await reader.ReadAsync(cancellationToken))
            profiles.Add(ReadProfile(reader));
        return profiles;
    }

    public async Task<TickMonitorProfile?> SaveProfileAsync(
        Guid id, string symbol, bool enabled, TickMonitorProfileConfig config, string? updatedBy, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.tick_monitor_profiles (id, symbol, enabled, config, updated_by)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            ON CONFLICT (id) DO UPDATE SET symbol = EXCLUDED.symbol, enabled = EXCLUDED.enabled, config = EXCLUDED.config,
                updated_by = EXCLUDED.updated_by, updated_at = now()
            RETURNING id, symbol, enabled, config::text, updated_by, updated_at
            """);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(symbol);
        command.Parameters.AddWithValue(enabled);
        command.Parameters.AddWithValue(JsonSerializer.Serialize(config, Json));
        command.Parameters.AddWithValue((object?)updatedBy ?? DBNull.Value);
        try
        {
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return null;
            var profile = ReadProfile(reader);
            Changed();
            return profile;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<bool> DeleteProfileAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("DELETE FROM violation_panel.tick_monitor_profiles WHERE id = $1");
        command.Parameters.AddWithValue(id);
        var deleted = await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        if (deleted)
            Changed();
        return deleted;
    }

    public async Task UpsertEventAsync(TickMonitorEventChange change, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.tick_monitor_events (id, symbol, gap_start, gap_end, ended_by, schedule_name, stages_fired, last_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET gap_end = EXCLUDED.gap_end, ended_by = EXCLUDED.ended_by, schedule_name = EXCLUDED.schedule_name,
                stages_fired = EXCLUDED.stages_fired, last_price = EXCLUDED.last_price
            """);
        command.Parameters.AddWithValue(change.Id);
        command.Parameters.AddWithValue(change.Symbol);
        command.Parameters.AddWithValue(DateTimeOffset.FromUnixTimeMilliseconds(change.GapStart).UtcDateTime);
        command.Parameters.AddWithValue(change.GapEnd is { } end ? DateTimeOffset.FromUnixTimeMilliseconds(end).UtcDateTime : DBNull.Value);
        command.Parameters.AddWithValue((object?)change.EndedBy ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)change.ScheduleName ?? DBNull.Value);
        command.Parameters.AddWithValue((short)change.StagesFired);
        command.Parameters.AddWithValue((object?)change.LastPrice ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task CountMessageAsync(Guid eventId, bool sent, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(sent
            ? "UPDATE violation_panel.tick_monitor_events SET messages_sent = messages_sent + 1 WHERE id = $1"
            : "UPDATE violation_panel.tick_monitor_events SET messages_failed = messages_failed + 1 WHERE id = $1");
        command.Parameters.AddWithValue(eventId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<TickMonitorEventDto>> ListEventsAsync(
        string? symbol, DateTimeOffset? from, DateTimeOffset? to, int limit, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT id, symbol, gap_start, gap_end, ended_by, schedule_name, stages_fired, messages_sent, messages_failed, last_price
            FROM violation_panel.tick_monitor_events
            WHERE ($1::text IS NULL OR lower(symbol) = lower($1))
              AND ($2::timestamptz IS NULL OR gap_start >= $2)
              AND ($3::timestamptz IS NULL OR gap_start < $3)
            ORDER BY gap_start DESC
            LIMIT $4
            """);
        command.Parameters.AddWithValue((object?)symbol ?? DBNull.Value);
        command.Parameters.AddWithValue(from is { } fromValue ? fromValue.UtcDateTime : DBNull.Value);
        command.Parameters.AddWithValue(to is { } toValue ? toValue.UtcDateTime : DBNull.Value);
        command.Parameters.AddWithValue(limit);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var events = new List<TickMonitorEventDto>();
        while (await reader.ReadAsync(cancellationToken))
            events.Add(new TickMonitorEventDto(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetFieldValue<DateTime>(2),
                reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTime>(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.GetInt16(6),
                reader.GetInt16(7),
                reader.GetInt16(8),
                reader.IsDBNull(9) ? null : reader.GetDouble(9)));
        return events;
    }

    public async Task DeleteOldEventsAsync(int retentionDays, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(
            "DELETE FROM violation_panel.tick_monitor_events WHERE gap_start < now() - make_interval(days => $1)");
        command.Parameters.AddWithValue(retentionDays);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> TryAcquireEngineLockAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT pg_try_advisory_lock(hashtext('violation_panel.tick_monitor'))", connection);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }

    public async Task<NpgsqlConnection> OpenConnectionAsync(CancellationToken cancellationToken) =>
        await dataSource.OpenConnectionAsync(cancellationToken);

    private void Changed() => Interlocked.Increment(ref _version);

    private static TickMonitorProfile ReadProfile(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetBoolean(2),
        JsonSerializer.Deserialize<TickMonitorProfileConfig>(reader.GetString(3), Json)
            ?? new TickMonitorProfileConfig(0, TickMonitorRecoveryNotice.Default, []),
        reader.IsDBNull(4) ? null : reader.GetString(4),
        reader.GetFieldValue<DateTime>(5));
}
