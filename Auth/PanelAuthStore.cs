using Npgsql;

namespace Sgb.Trading.Violation.Panel.Auth;

public sealed record PanelUser(
    Guid Id,
    string Username,
    string PasswordHash,
    string? TotpSecret,
    long TotpLastStep,
    int FailedAttempts,
    bool IsLocked,
    bool IsDisabled,
    DateTime CreatedAt,
    DateTime? LastSignInAt,
    string Role,
    int ActiveSessions)
{
    public bool IsSuperAdmin => Role == PanelRoles.SuperAdmin;
}

public sealed record PanelAuditEntry(
    long Id,
    DateTime OccurredAt,
    string Event,
    string? Username,
    string? IpAddress,
    string? UserAgent,
    string? Detail);

/// <summary>
/// The panel's accounts, server-side sessions and sign-in audit log, in the <c>violation_panel</c> schema of the
/// <c>PanelAuth</c> PostgreSQL database. Sessions are stored by the SHA-256 hash of their token only.
/// </summary>
public sealed class PanelAuthStore(NpgsqlDataSource dataSource)
{
    private const string UserColumns =
        "id, username, password_hash, totp_secret, totp_last_step, failed_attempts, " +
        "coalesce(locked_until > now(), false), is_disabled, created_at, last_sign_in_at, role, " +
        "(SELECT count(*)::int FROM violation_panel.sessions s " +
        "WHERE s.user_id = users.id AND s.revoked_at IS NULL AND s.expires_at > now())";

    // Names of databases the panel must never use: the node database the Violation reports are read from, and the
    // PostgreSQL system databases.
    private static readonly string[] ForbiddenDatabases = ["sgb_node", "postgres", "template0", "template1"];

    /// <summary>
    /// Refuses any database other than a dedicated one: a forbidden name, or a database that already has tables outside
    /// the panel's schema (such as the node database under another name). Runs before anything is created.
    /// </summary>
    public static void ValidateConnectionString(string connectionString)
    {
        var database = new NpgsqlConnectionStringBuilder(connectionString).Database?.Trim();
        if (string.IsNullOrEmpty(database))
            throw new InvalidOperationException(
                $"Connection string '{PanelAuthOptions.ConnectionStringName}' must name the panel's own database (Database=...).");

        if (ForbiddenDatabases.Contains(database, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                $"Connection string '{PanelAuthOptions.ConnectionStringName}' points to '{database}'. The panel needs its own " +
                "dedicated database and never uses the node database or a system database (docs/panel-authentication.md).");
    }

    public async Task EnsureDedicatedDatabaseAsync(CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT current_database(), table_schema || '.' || table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'violation_panel')
            LIMIT 1
            """);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (await reader.ReadAsync(cancellationToken))
            throw new InvalidOperationException(
                $"Database '{reader.GetString(0)}' is not dedicated to the panel: it has other tables (e.g. {reader.GetString(1)}). " +
                $"Point '{PanelAuthOptions.ConnectionStringName}' to an empty database of its own (docs/panel-authentication.md).");
    }

    public async Task EnsureSchemaAsync(CancellationToken cancellationToken = default)
    {
        await EnsureDedicatedDatabaseAsync(cancellationToken);
        await using var command = dataSource.CreateCommand(
            """
            CREATE SCHEMA IF NOT EXISTS violation_panel;

            CREATE TABLE IF NOT EXISTS violation_panel.users (
                id uuid PRIMARY KEY,
                username text NOT NULL,
                password_hash text NOT NULL,
                totp_secret text NULL,
                totp_last_step bigint NOT NULL DEFAULT 0,
                failed_attempts integer NOT NULL DEFAULT 0,
                locked_until timestamptz NULL,
                is_disabled boolean NOT NULL DEFAULT false,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_sign_in_at timestamptz NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON violation_panel.users (lower(username));

            CREATE TABLE IF NOT EXISTS violation_panel.sessions (
                token_hash bytea PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES violation_panel.users (id) ON DELETE CASCADE,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_seen_at timestamptz NOT NULL DEFAULT now(),
                expires_at timestamptz NOT NULL,
                revoked_at timestamptz NULL,
                ip_address text NULL,
                user_agent text NULL);
            CREATE INDEX IF NOT EXISTS ix_sessions_user_id ON violation_panel.sessions (user_id);

            CREATE TABLE IF NOT EXISTS violation_panel.audit_log (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                occurred_at timestamptz NOT NULL DEFAULT now(),
                event text NOT NULL,
                username text NULL,
                user_id uuid NULL,
                ip_address text NULL,
                user_agent text NULL,
                detail text NULL);
            CREATE INDEX IF NOT EXISTS ix_audit_log_occurred_at ON violation_panel.audit_log (occurred_at);

            -- Roles: 'superadmin' manages the accounts, 'admin' sees the reports only.
            ALTER TABLE violation_panel.users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';
            -- Accounts made before roles existed: the oldest one becomes the super admin, so someone can manage users.
            WITH promoted AS (
                UPDATE violation_panel.users SET role = 'superadmin'
                WHERE id = (SELECT id FROM violation_panel.users ORDER BY created_at LIMIT 1)
                  AND NOT EXISTS (SELECT 1 FROM violation_panel.users WHERE role = 'superadmin')
                RETURNING id, username)
            INSERT INTO violation_panel.audit_log (event, username, user_id, detail)
            SELECT 'role_changed', username, id, 'superadmin: oldest account promoted when roles were introduced' FROM promoted;

            -- Ended sessions are kept for a month for investigations, then removed.
            DELETE FROM violation_panel.sessions WHERE expires_at < now() - interval '30 days';
            """);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<PanelUser?> FindUserAsync(string username, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT {UserColumns} FROM violation_panel.users WHERE lower(username) = lower($1)");
        command.Parameters.AddWithValue(username);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<PanelUser?> GetUserAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand($"SELECT {UserColumns} FROM violation_panel.users WHERE id = $1");
        command.Parameters.AddWithValue(id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<IReadOnlyList<PanelUser>> ListUsersAsync(CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            $"SELECT {UserColumns} FROM violation_panel.users ORDER BY lower(username)");
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var users = new List<PanelUser>();
        while (await reader.ReadAsync(cancellationToken))
            users.Add(ReadUser(reader));
        return users;
    }

    public async Task<bool> AnyActiveUserAsync(CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            "SELECT EXISTS (SELECT 1 FROM violation_panel.users WHERE NOT is_disabled)");
        return (bool)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    /// <summary>Creates the account; returns false when the username is taken (case-insensitive).</summary>
    public async Task<bool> CreateUserAsync(Guid id, string username, string passwordHash, string totpSecret, string role,
        CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.users (id, username, password_hash, totp_secret, role) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT DO NOTHING
            """);
        command.Parameters.AddWithValue(id);
        command.Parameters.AddWithValue(username);
        command.Parameters.AddWithValue(passwordHash);
        command.Parameters.AddWithValue(totpSecret);
        command.Parameters.AddWithValue(role);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public Task SetRoleAsync(Guid userId, string role, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.users SET role = $2 WHERE id = $1", cancellationToken, userId, role);

    /// <summary>Deletes the account and its sessions; its audit entries stay, by username.</summary>
    public Task DeleteUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        ExecuteAsync("DELETE FROM violation_panel.users WHERE id = $1", cancellationToken, userId);

    public async Task<int> CountActiveSuperAdminsAsync(CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            "SELECT count(*)::int FROM violation_panel.users WHERE role = 'superadmin' AND NOT is_disabled");
        return (int)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    public async Task<IReadOnlyList<PanelAuditEntry>> ListAuditAsync(string? username, int limit,
        CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            SELECT id, occurred_at, event, username, ip_address, user_agent, detail
            FROM violation_panel.audit_log
            WHERE $1::text IS NULL OR lower(username) = lower($1)
            ORDER BY id DESC
            LIMIT $2
            """);
        command.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)username ?? DBNull.Value);
        command.Parameters.AddWithValue(limit);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var entries = new List<PanelAuditEntry>();
        while (await reader.ReadAsync(cancellationToken))
            entries.Add(new PanelAuditEntry(
                reader.GetInt64(0),
                reader.GetDateTime(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        return entries;
    }

    /// <summary>Counts a failed sign-in and locks the account at the limit. Returns whether the account is now locked.</summary>
    public async Task<bool> RegisterFailureAsync(Guid userId, int maxFailedAttempts, TimeSpan lockout,
        CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE violation_panel.users
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + $3 ELSE locked_until END
            WHERE id = $1
            RETURNING coalesce(locked_until > now(), false)
            """);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(maxFailedAttempts);
        command.Parameters.AddWithValue(lockout);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    /// <summary>
    /// Records a successful sign-in with the code's time step. Returns false when the step was already used (a replayed
    /// code), in which case nothing changes.
    /// </summary>
    public async Task<bool> RegisterSuccessAsync(Guid userId, long totpStep, string? rehashedPassword,
        CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE violation_panel.users
            SET totp_last_step = $2, failed_attempts = 0, locked_until = NULL, last_sign_in_at = now(),
                password_hash = coalesce($3, password_hash)
            WHERE id = $1 AND totp_last_step < $2
            """);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(totpStep);
        command.Parameters.AddWithValue((object?)rehashedPassword ?? DBNull.Value);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public Task SetPasswordAsync(Guid userId, string passwordHash, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.users SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1",
            cancellationToken, userId, passwordHash);

    public Task SetTotpSecretAsync(Guid userId, string totpSecret, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.users SET totp_secret = $2, totp_last_step = 0 WHERE id = $1",
            cancellationToken, userId, totpSecret);

    public Task SetDisabledAsync(Guid userId, bool disabled, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.users SET is_disabled = $2 WHERE id = $1", cancellationToken, userId, disabled);

    public Task UnlockAsync(Guid userId, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.users SET failed_attempts = 0, locked_until = NULL WHERE id = $1",
            cancellationToken, userId);

    public async Task CreateSessionAsync(byte[] tokenHash, Guid userId, TimeSpan lifetime, string? ipAddress,
        string? userAgent, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.sessions (token_hash, user_id, expires_at, ip_address, user_agent)
            VALUES ($1, $2, now() + $3, $4, $5)
            """);
        command.Parameters.AddWithValue(tokenHash);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(lifetime);
        command.Parameters.AddWithValue((object?)ipAddress ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)userAgent ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Marks the session as used now and returns true when it is still valid: not revoked, within its lifetime, used
    /// within the idle timeout, and its user is not disabled.
    /// </summary>
    public async Task<bool> TouchSessionAsync(byte[] tokenHash, TimeSpan idleTimeout, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            UPDATE violation_panel.sessions AS s
            SET last_seen_at = now()
            FROM violation_panel.users AS u
            WHERE s.token_hash = $1 AND u.id = s.user_id AND NOT u.is_disabled
              AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - $2
            """);
        command.Parameters.AddWithValue(tokenHash);
        command.Parameters.AddWithValue(idleTimeout);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public Task RevokeSessionAsync(byte[] tokenHash, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
            cancellationToken, tokenHash);

    public Task RevokeUserSessionsAsync(Guid userId, CancellationToken cancellationToken = default) =>
        ExecuteAsync("UPDATE violation_panel.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
            cancellationToken, userId);

    /// <summary>Ends every session of the account except the given one (the session that made the change).</summary>
    public Task RevokeOtherSessionsAsync(Guid userId, byte[] keptTokenHash, CancellationToken cancellationToken = default) =>
        ExecuteAsync(
            "UPDATE violation_panel.sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL",
            cancellationToken, userId, keptTokenHash);

    public async Task AuditAsync(string auditEvent, string? username, Guid? userId, string? ipAddress, string? userAgent,
        string? detail = null, CancellationToken cancellationToken = default)
    {
        await using var command = dataSource.CreateCommand(
            """
            INSERT INTO violation_panel.audit_log (event, username, user_id, ip_address, user_agent, detail)
            VALUES ($1, $2, $3, $4, $5, $6)
            """);
        command.Parameters.AddWithValue(auditEvent);
        command.Parameters.AddWithValue((object?)username ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)userId ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)ipAddress ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)userAgent ?? DBNull.Value);
        command.Parameters.AddWithValue((object?)detail ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task ExecuteAsync(string sql, CancellationToken cancellationToken, params object[] parameters)
    {
        await using var command = dataSource.CreateCommand(sql);
        foreach (var parameter in parameters)
            command.Parameters.AddWithValue(parameter);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static PanelUser ReadUser(NpgsqlDataReader reader) => new(
        reader.GetGuid(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.IsDBNull(3) ? null : reader.GetString(3),
        reader.GetInt64(4),
        reader.GetInt32(5),
        reader.GetBoolean(6),
        reader.GetBoolean(7),
        reader.GetDateTime(8),
        reader.IsDBNull(9) ? null : reader.GetDateTime(9),
        reader.GetString(10),
        reader.GetInt32(11));
}
