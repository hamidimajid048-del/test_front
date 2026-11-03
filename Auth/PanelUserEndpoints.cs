namespace Sgb.Trading.Violation.Panel.Auth;

/// <summary>
/// The panel's own JSON API under <c>/panel-api</c> (not forwarded to the Violation service): the signed-in user's
/// account, and account management for super admins. Every change is recorded in the audit log with who made it.
/// </summary>
public static class PanelUserEndpoints
{
    public const string Prefix = "/panel-api";

    /// <summary>
    /// Required on every state-changing request. A custom header cannot be sent cross-site without a CORS preflight,
    /// which the panel never allows, so it blocks cross-site requests even in browsers without Sec-Fetch-Site.
    /// </summary>
    public const string RequestHeader = "X-Panel-Request";

    private const string CurrentUserItem = "panel-current-user";
    private const int MaxAuditEntries = 500;
    private const string TwoFactorSetupPurpose = "panel-two-factor-setup";
    private static readonly TimeSpan TwoFactorSetupLifetime = TimeSpan.FromMinutes(10);

    public static void MapPanelUserEndpoints(this WebApplication app)
    {
        var api = app.MapGroup(Prefix).AddEndpointFilter(LoadCurrentUserAsync);

        api.MapGet("/me", (HttpContext context) =>
        {
            var user = CurrentUser(context);
            return Results.Ok(new { id = user.Id, username = user.Username, role = user.Role, permissions = user.EffectivePermissions, twoFactor = user.TotpSecret is not null });
        });

        api.MapPost("/account/two-factor/begin", BeginTwoFactor);
        api.MapPost("/account/two-factor/confirm", ConfirmTwoFactorAsync);

        api.MapPost("/account/password", ChangeOwnPasswordAsync).RequirePermission(PanelPermissions.AccountChangePassword);

        api.MapGet("/permissions", async (PanelAuthStore store, HttpContext context) =>
                Results.Ok(new { permissions = PanelPermissions.All, presets = await store.ListPresetsAsync(context.RequestAborted) }))
            .RequirePermission(PanelPermissions.UsersView);

        var roles = api.MapGroup("/roles").AddEndpointFilter(RequireSuperAdmin);
        roles.MapPost("", CreatePresetAsync);
        roles.MapPut("/{key}", UpdatePresetAsync);
        roles.MapDelete("/{key}", DeletePresetAsync);

        var users = api.MapGroup("/users");
        users.MapGet("", async (HttpContext context, PanelAuthStore store) =>
            {
                var self = CurrentUser(context);
                return Results.Ok((await store.ListUsersAsync(context.RequestAborted)).Select(user => ToResponse(user, self)));
            })
            .RequirePermission(PanelPermissions.UsersView);
        users.MapPost("", CreateUserAsync).RequirePermission(PanelPermissions.UsersCreate);
        users.MapPost("/{id:guid}/password", ResetPasswordAsync).RequirePermission(PanelPermissions.UsersResetCredentials);
        users.MapPost("/{id:guid}/two-factor", ResetTwoFactorAsync).RequirePermission(PanelPermissions.UsersResetCredentials);
        users.MapDelete("/{id:guid}/two-factor", (Guid id, HttpContext context, PanelAuthStore store) =>
                ChangeUserAsync(id, context, store, "two_factor_disabled", allowSelf: false, async (user, token) =>
                {
                    await store.DisableTwoFactorAsync(user.Id, token);
                    await store.RevokeUserSessionsAsync(user.Id, token);
                }))
            .RequirePermission(PanelPermissions.UsersResetCredentials);
        users.MapPost("/{id:guid}/permissions", ChangePermissionsAsync).RequirePermission(PanelPermissions.UsersEditPermissions);
        users.MapPost("/{id:guid}/role", ChangeRoleAsync).AddEndpointFilter(RequireSuperAdmin);
        users.MapPost("/{id:guid}/unlock", (Guid id, HttpContext context, PanelAuthStore store) =>
                ChangeUserAsync(id, context, store, "account_unlocked", allowSelf: true, (user, token) => store.UnlockAsync(user.Id, token)))
            .RequirePermission(PanelPermissions.UsersManageState);
        users.MapPost("/{id:guid}/disable", (Guid id, HttpContext context, PanelAuthStore store) =>
                ChangeUserAsync(id, context, store, "account_disabled", allowSelf: false, async (user, token) =>
                {
                    await store.SetDisabledAsync(user.Id, true, token);
                    await store.RevokeUserSessionsAsync(user.Id, token);
                }))
            .RequirePermission(PanelPermissions.UsersManageState);
        users.MapPost("/{id:guid}/enable", (Guid id, HttpContext context, PanelAuthStore store) =>
                ChangeUserAsync(id, context, store, "account_enabled", allowSelf: false, (user, token) => store.SetDisabledAsync(user.Id, false, token)))
            .RequirePermission(PanelPermissions.UsersManageState);
        users.MapPost("/{id:guid}/revoke-sessions", (Guid id, HttpContext context, PanelAuthStore store) =>
                ChangeUserAsync(id, context, store, "sessions_revoked", allowSelf: false, (user, token) => store.RevokeUserSessionsAsync(user.Id, token)))
            .RequirePermission(PanelPermissions.UsersManageState);
        users.MapDelete("/{id:guid}", (Guid id, HttpContext context, PanelAuthStore store) =>
                ChangeUserAsync(id, context, store, "user_deleted", allowSelf: false, (user, token) => store.DeleteUserAsync(user.Id, token)))
            .RequirePermission(PanelPermissions.UsersDelete);

        api.MapGet("/audit", async (string? username, int? limit, PanelAuthStore store, HttpContext context) =>
                Results.Ok(await store.ListAuditAsync(
                    string.IsNullOrWhiteSpace(username) ? null : username.Trim(),
                    Math.Clamp(limit ?? 200, 1, MaxAuditEntries),
                    context.RequestAborted)))
            .RequirePermission(PanelPermissions.AuditView);
    }

    // Reads the signed-in account from the database on every request, so a role change, a disabled account or a
    // deleted account takes effect at once instead of when the cookie ends.
    private static async ValueTask<object?> LoadCurrentUserAsync(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next)
    {
        var context = invocation.HttpContext;
        if (!HttpMethods.IsGet(context.Request.Method) && !context.Request.Headers.ContainsKey(RequestHeader))
            return Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");

        var store = context.RequestServices.GetRequiredService<PanelAuthStore>();
        var user = context.User.GetUserId() is { } id ? await store.GetUserAsync(id, context.RequestAborted) : null;
        if (user is null || user.IsDisabled)
            return Results.Unauthorized();

        context.Items[CurrentUserItem] = user;
        return await next(invocation);
    }

    private static async ValueTask<object?> RequireSuperAdmin(EndpointFilterInvocationContext invocation, EndpointFilterDelegate next) =>
        CurrentUser(invocation.HttpContext).IsSuperAdmin
            ? await next(invocation)
            : Error(StatusCodes.Status403Forbidden, "Only a super admin can do this.");

    private static PanelUser CurrentUser(HttpContext context) => (PanelUser)context.Items[CurrentUserItem]!;

    private static async Task<IResult> ChangeOwnPasswordAsync(ChangePasswordRequest request, HttpContext context,
        PanelAuthStore store, PanelAuthOptions options)
    {
        var user = CurrentUser(context);
        var client = ClientInfo.From(context);
        if (!PanelSignInService.VerifyPassword(user, request.CurrentPassword ?? string.Empty))
        {
            // Counted like a failed sign-in, so a taken-over session cannot be used to guess the password.
            var locked = await store.RegisterFailureAsync(user.Id, options.MaxFailedAttempts, options.Lockout, CancellationToken.None);
            await store.AuditAsync("password_change_failed", user.Username, user.Id, client.IpAddress, client.UserAgent,
                "wrong current password", CancellationToken.None);
            if (!locked)
                return Error(StatusCodes.Status400BadRequest, "The current password is not correct.");

            await store.RevokeUserSessionsAsync(user.Id, CancellationToken.None);
            await store.AuditAsync("account_locked", user.Username, user.Id, client.IpAddress, client.UserAgent,
                "too many wrong current passwords on a password change", CancellationToken.None);
            return Results.Unauthorized();
        }

        var newPassword = request.NewPassword ?? string.Empty;
        if (PanelPasswordPolicy.Validate(user.Username, newPassword) is { } problem)
            return Error(StatusCodes.Status400BadRequest, problem);
        if (newPassword == request.CurrentPassword)
            return Error(StatusCodes.Status400BadRequest, "The new password must differ from the current one.");

        await store.SetPasswordAsync(user.Id, PanelSignInService.HashPassword(newPassword), context.RequestAborted);
        // The other sessions end; this one stays, so the user does not have to sign in again.
        await store.RevokeOtherSessionsAsync(user.Id, context.User.GetSessionTokenHash()!, context.RequestAborted);
        await store.AuditAsync("password_changed", user.Username, user.Id, client.IpAddress, client.UserAgent,
            "by the account itself", CancellationToken.None);
        return Results.NoContent();
    }

    private static IResult BeginTwoFactor(HttpContext context, IDataProtectionProvider dataProtection)
    {
        var user = CurrentUser(context);
        if (user.TotpSecret is not null)
            return Error(StatusCodes.Status400BadRequest, "Two-factor is already set up.");

        var secret = Totp.GenerateSecret();
        var token = dataProtection.CreateProtector(TwoFactorSetupPurpose).ToTimeLimitedDataProtector().Protect(secret, TwoFactorSetupLifetime);
        return Results.Ok(new { setupToken = token, twoFactor = TwoFactorSetup(user.Username, secret) });
    }

    private static async Task<IResult> ConfirmTwoFactorAsync(ConfirmTwoFactorRequest request, HttpContext context,
        PanelAuthStore store, IDataProtectionProvider dataProtection, TimeProvider timeProvider)
    {
        var user = CurrentUser(context);
        string secret;
        try
        {
            secret = dataProtection.CreateProtector(TwoFactorSetupPurpose).ToTimeLimitedDataProtector().Unprotect(request.SetupToken ?? string.Empty);
        }
        catch (CryptographicException)
        {
            return Error(StatusCodes.Status400BadRequest, "The setup expired. Start again.");
        }

        var code = (request.Code ?? string.Empty).Replace(" ", string.Empty);
        if (Totp.Verify(secret, code, timeProvider.GetUtcNow(), 0) is not { } step)
            return Error(StatusCodes.Status400BadRequest, "Incorrect code.");
        if (!await store.EnableTwoFactorAsync(user.Id, secret, step, context.RequestAborted))
            return Error(StatusCodes.Status400BadRequest, "Two-factor is already set up.");

        await AuditAsync(context, store, "two_factor_enabled", user.Username, user.Id, "by the account itself");
        return Results.NoContent();
    }

    private static async Task<IResult> CreateUserAsync(CreateUserRequest request, HttpContext context, PanelAuthStore store)
    {
        var actor = CurrentUser(context);
        var username = request.Username?.Trim() ?? string.Empty;
        var password = request.Password ?? string.Empty;
        var role = request.Role ?? PanelRoles.Admin;
        if ((PanelPasswordPolicy.ValidateUsername(username) ?? PanelPasswordPolicy.Validate(username, password)) is { } problem)
            return Error(StatusCodes.Status400BadRequest, problem);
        if (!PanelRoles.IsValid(role))
            return Error(StatusCodes.Status400BadRequest, "The role is not valid.");
        if (role == PanelRoles.SuperAdmin && !actor.IsSuperAdmin)
            return Error(StatusCodes.Status403Forbidden, "Only a super admin can add a super admin.");

        var permissions = Array.Empty<string>();
        if (role == PanelRoles.Admin)
        {
            if (ValidatePermissions(request.Permissions) is { } invalid)
                return Error(StatusCodes.Status400BadRequest, invalid);

            permissions = PanelPermissions.Normalize(request.Permissions!);
            if (CheckGrant(actor, [], permissions) is { } denied)
                return Error(StatusCodes.Status403Forbidden, denied);
        }

        var id = Guid.CreateVersion7();
        var secret = Totp.GenerateSecret();
        if (!await store.CreateUserAsync(id, username, PanelSignInService.HashPassword(password), secret, role, permissions, context.RequestAborted))
            return Error(StatusCodes.Status409Conflict, $"An account named '{username}' already exists.");

        await AuditAsync(context, store, "user_created", username, id, $"role {role}, {permissions.Length} permissions, by {actor.Username}");
        return Results.Ok(new { id, username, twoFactor = TwoFactorSetup(username, secret) });
    }

    private static Task<IResult> ResetPasswordAsync(Guid id, ResetPasswordRequest request, HttpContext context, PanelAuthStore store) =>
        ChangeUserAsync(id, context, store, "password_reset", allowSelf: false, async (user, token) =>
        {
            var password = request.Password ?? string.Empty;
            if (PanelPasswordPolicy.Validate(user.Username, password) is { } problem)
                return Error(StatusCodes.Status400BadRequest, problem);

            await store.SetPasswordAsync(user.Id, PanelSignInService.HashPassword(password), token);
            await store.RevokeUserSessionsAsync(user.Id, token);
            return null;
        });

    private static async Task<IResult> ResetTwoFactorAsync(Guid id, HttpContext context, PanelAuthStore store)
    {
        string? secret = null;
        var result = await ChangeUserAsync(id, context, store, "two_factor_reset", allowSelf: false, async (user, token) =>
        {
            secret = Totp.GenerateSecret();
            await store.SetTotpSecretAsync(user.Id, secret, token);
            await store.RevokeUserSessionsAsync(user.Id, token);
        });
        if (secret is null)
            return result;

        var user = (await store.GetUserAsync(id, context.RequestAborted))!;
        return Results.Ok(new { twoFactor = TwoFactorSetup(user.Username, secret) });
    }

    private static Task<IResult> ChangeRoleAsync(Guid id, ChangeRoleRequest request, HttpContext context, PanelAuthStore store) =>
        ChangeUserAsync(id, context, store, "role_changed", allowSelf: false, async (user, token) =>
        {
            if (!PanelRoles.IsValid(request.Role))
                return Error(StatusCodes.Status400BadRequest, "The role is not valid.");

            await store.SetRoleAsync(user.Id, request.Role!, token);
            if (request.Role == PanelRoles.Admin && user.Permissions.Length == 0)
                await store.SetPermissionsAsync(user.Id, await store.DefaultPermissionsAsync(token), token);
            await store.RevokeUserSessionsAsync(user.Id, token);
            return null;
        }, describe: () => request.Role);

    private static Task<IResult> ChangePermissionsAsync(Guid id, ChangePermissionsRequest request, HttpContext context, PanelAuthStore store)
    {
        string? change = null;
        return ChangeUserAsync(id, context, store, "permissions_changed", allowSelf: false, async (user, token) =>
        {
            if (user.IsSuperAdmin)
                return Error(StatusCodes.Status400BadRequest, "A super admin always has every permission.");
            if (ValidatePermissions(request.Permissions) is { } invalid)
                return Error(StatusCodes.Status400BadRequest, invalid);

            var permissions = PanelPermissions.Normalize(request.Permissions!);
            if (CheckGrant(CurrentUser(context), user.Permissions, permissions) is { } denied)
                return Error(StatusCodes.Status403Forbidden, denied);

            await store.SetPermissionsAsync(user.Id, permissions, token);
            change = string.Join(' ', permissions.Except(user.Permissions).Select(key => $"+{key}")
                .Concat(user.Permissions.Except(permissions).Select(key => $"-{key}")));
            return null;
        }, describe: () => change);
    }

    private static async Task<IResult> CreatePresetAsync(PresetRequest request, HttpContext context, PanelAuthStore store)
    {
        var title = request.Title?.Trim() ?? string.Empty;
        var key = PresetKey(title);
        if (ValidatePreset(request, title) is { } problem)
            return Error(StatusCodes.Status400BadRequest, problem);
        if (key.Length == 0)
            return Error(StatusCodes.Status400BadRequest, "The name needs letters or digits.");

        var permissions = PanelPermissions.Normalize(request.Permissions!);
        var preset = new PanelPermissionPreset(key, title, request.Description?.Trim() ?? string.Empty, permissions);
        if (!await store.CreatePresetAsync(preset, context.RequestAborted))
            return Error(StatusCodes.Status409Conflict, $"A role named '{title}' already exists.");

        var actor = CurrentUser(context);
        await AuditAsync(context, store, "access_role_created", actor.Username, actor.Id, $"{title}: {permissions.Length} permissions");
        return Results.Ok(preset);
    }

    private static async Task<IResult> UpdatePresetAsync(string key, PresetRequest request, HttpContext context, PanelAuthStore store)
    {
        var title = request.Title?.Trim() ?? string.Empty;
        if (ValidatePreset(request, title) is { } problem)
            return Error(StatusCodes.Status400BadRequest, problem);
        if (await store.GetPresetAsync(key, context.RequestAborted) is not { } before)
            return Error(StatusCodes.Status404NotFound, "The role no longer exists.");

        var permissions = PanelPermissions.Normalize(request.Permissions!);
        await store.UpdatePresetAsync(before with { Title = title, Description = request.Description?.Trim() ?? string.Empty, Permissions = permissions },
            context.RequestAborted);

        var actor = CurrentUser(context);
        var change = string.Join(' ', permissions.Except(before.Permissions).Select(permission => $"+{permission}")
            .Concat(before.Permissions.Except(permissions).Select(permission => $"-{permission}")));
        await AuditAsync(context, store, "access_role_changed", actor.Username, actor.Id, $"{title}: {change}");
        return Results.NoContent();
    }

    private static async Task<IResult> DeletePresetAsync(string key, HttpContext context, PanelAuthStore store)
    {
        if (await store.GetPresetAsync(key, context.RequestAborted) is not { } preset)
            return Error(StatusCodes.Status404NotFound, "The role no longer exists.");
        if (preset.IsBuiltIn)
            return Error(StatusCodes.Status400BadRequest, "A built-in role can be edited but not deleted.");

        await store.DeletePresetAsync(key, context.RequestAborted);
        var actor = CurrentUser(context);
        await AuditAsync(context, store, "access_role_deleted", actor.Username, actor.Id, preset.Title);
        return Results.NoContent();
    }

    private static string? ValidatePreset(PresetRequest request, string title) =>
        title.Length is 0 or > 40 ? "A role name has 1 to 40 characters."
        : request.Description?.Trim().Length > 200 ? "The description has at most 200 characters."
        : ValidatePermissions(request.Permissions);

    private static string PresetKey(string title) =>
        string.Join('-', title.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => new string([.. word.Where(char.IsAsciiLetterOrDigit)])).Where(word => word.Length > 0));

    private static string? ValidatePermissions(string[]? permissions) =>
        permissions is null ? "Choose the permissions."
        : permissions.FirstOrDefault(key => !PanelPermissions.IsKnown(key)) is { } unknown ? $"'{unknown}' is not a permission."
        : null;

    private static string? CheckGrant(PanelUser actor, IEnumerable<string> before, IEnumerable<string> after) =>
        before.Except(after).Concat(after.Except(before)).Any(key => !actor.EffectivePermissions.Contains(key))
            ? "You can only grant or remove permissions that you have yourself."
            : null;

    private static Task<IResult> ChangeUserAsync(Guid id, HttpContext context, PanelAuthStore store, string auditEvent,
        bool allowSelf, Func<PanelUser, CancellationToken, Task> change) =>
        ChangeUserAsync(id, context, store, auditEvent, allowSelf, async (user, token) =>
        {
            await change(user, token);
            return null;
        });

    /// <summary>
    /// Loads the target account, refuses changes to the super admin's own account where they could lock everyone out
    /// (own role, disable, delete; own password and key go through the Account page or another super admin), applies
    /// the change and records it. The change returns an error result, or null on success.
    /// </summary>
    private static async Task<IResult> ChangeUserAsync(Guid id, HttpContext context, PanelAuthStore store, string auditEvent,
        bool allowSelf, Func<PanelUser, CancellationToken, Task<IResult?>> change, Func<string?>? describe = null)
    {
        var actor = CurrentUser(context);
        if (!allowSelf && id == actor.Id)
            return Error(StatusCodes.Status400BadRequest,
                "You cannot do this to your own account. Change your password on the Account page; another super admin can do the rest.");

        var user = await store.GetUserAsync(id, context.RequestAborted);
        if (user is null)
            return Error(StatusCodes.Status404NotFound, "The account no longer exists.");

        if (user.IsSuperAdmin && !actor.IsSuperAdmin)
            return Error(StatusCodes.Status403Forbidden, "Only a super admin can change a super admin.");

        if (await change(user, context.RequestAborted) is { } error)
            return error;

        await AuditAsync(context, store, auditEvent, user.Username, user.Id,
            describe?.Invoke() is { Length: > 0 } detail ? $"{detail}, by {actor.Username}" : $"by {actor.Username}");
        return Results.NoContent();
    }

    private static object TwoFactorSetup(string username, string secret)
    {
        var uri = Totp.ProvisioningUri(username, secret);
        var png = PngByteQRCodeHelper.GetQRCode(uri, QRCodeGenerator.ECCLevel.M, 6);
        return new { key = Totp.FormatSecret(secret), uri, qrCode = $"data:image/png;base64,{Convert.ToBase64String(png)}" };
    }

    private static object ToResponse(PanelUser user, PanelUser self) => new
    {
        id = user.Id,
        username = user.Username,
        role = user.Role,
        state = user.IsDisabled ? "disabled" : user.IsLocked ? "locked" : "active",
        failedAttempts = user.FailedAttempts,
        activeSessions = user.ActiveSessions,
        lastSignInAt = user.LastSignInAt,
        createdAt = user.CreatedAt,
        isSelf = user.Id == self.Id,
        permissions = user.EffectivePermissions
    };

    private static Task AuditAsync(HttpContext context, PanelAuthStore store, string auditEvent, string username, Guid userId, string detail)
    {
        var client = ClientInfo.From(context);
        return store.AuditAsync(auditEvent, username, userId, client.IpAddress, client.UserAgent, detail, CancellationToken.None);
    }

    private static IResult Error(int statusCode, string message) => Results.Json(new { error = message }, statusCode: statusCode);

    private sealed record ChangePasswordRequest(string? CurrentPassword, string? NewPassword);
    private sealed record CreateUserRequest(string? Username, string? Password, string? Role, string[]? Permissions);
    private sealed record ResetPasswordRequest(string? Password);
    private sealed record ChangeRoleRequest(string? Role);
    private sealed record ConfirmTwoFactorRequest(string? SetupToken, string? Code);
    private sealed record ChangePermissionsRequest(string[]? Permissions);
    private sealed record PresetRequest(string? Title, string? Description, string[]? Permissions);
}
