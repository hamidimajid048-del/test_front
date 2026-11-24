namespace Sgb.Trading.Violation.Panel.TickMonitor;

public static class TickMonitorEndpoints
{
    private const int MaxChannelNameLength = 40;
    private const int MaxSymbolSuggestions = 50;
    private const int MaxSnoozeMinutes = 1440;
    private const int DefaultEventLimit = 200;

    public static void MapTickMonitorEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/status", (TickMonitorBackgroundService service) => Results.Ok(service.Status))
            .RequirePermission(PanelPermissions.TickMonitorView);

        api.MapGet("/profiles", async (TickMonitorStore store, CancellationToken cancellationToken) =>
                Results.Ok(await store.ListProfilesAsync(cancellationToken)))
            .RequirePermission(PanelPermissions.TickMonitorView);
        api.MapPut("/profiles", SaveProfileAsync).RequirePermission(PanelPermissions.TickMonitorEdit);
        api.MapDelete("/profiles/{id:guid}", DeleteProfileAsync).RequirePermission(PanelPermissions.TickMonitorEdit);
        api.MapPost("/symbols/{symbol}/snooze", SnoozeAsync).RequirePermission(PanelPermissions.TickMonitorEdit);
        api.MapGet("/symbols", Symbols).RequirePermission(PanelPermissions.TickMonitorEdit);

        api.MapGet("/channels", async (TickMonitorStore store, CancellationToken cancellationToken) =>
                Results.Ok(await store.ListChannelsAsync(cancellationToken)))
            .RequirePermission(PanelPermissions.TickMonitorView);
        api.MapPut("/channels", SaveChannelAsync).RequirePermission(PanelPermissions.TickMonitorChannels);
        api.MapDelete("/channels/{id:guid}", DeleteChannelAsync).RequirePermission(PanelPermissions.TickMonitorChannels);
        api.MapPost("/channels/{id:guid}/test", TestChannelAsync).RequirePermission(PanelPermissions.TickMonitorChannels);

        api.MapGet("/events", ListEventsAsync).RequirePermission(PanelPermissions.TickMonitorView);

        api.MapGet("/settings", async (TickMonitorStore store, CancellationToken cancellationToken) =>
                Results.Ok(TickMonitorSettingsDto.From(await store.GetSettingsAsync(cancellationToken))))
            .RequirePermission(PanelPermissions.TickMonitorView);
        api.MapPut("/settings", SaveSettingsAsync).RequirePermission(PanelPermissions.TickMonitorSettings);
    }

    private static async Task<IResult> SaveProfileAsync(
        TickMonitorProfileInput input, HttpContext context, TickMonitorStore store, PanelAuthStore auth)
    {
        if (FromPanel(context) is { } refused)
            return refused;

        var cancellationToken = context.RequestAborted;
        var settings = await store.GetSettingsAsync(cancellationToken);
        var channels = await store.ListChannelsAsync(cancellationToken);
        if (TickMonitorProfileValidator.Validate(input, settings, channels) is { } error)
            return Error(StatusCodes.Status400BadRequest, error);

        var config = input.Config! with
        {
            Schedules = [.. input.Config!.Schedules.Select(schedule => schedule with { Name = schedule.Name.Trim() })]
        };
        var profile = await store.SaveProfileAsync(
            input.Id ?? Guid.CreateVersion7(), input.Symbol!.Trim(), input.Enabled ?? true, config, context.User.Identity?.Name, cancellationToken);
        if (profile is null)
            return Error(StatusCodes.Status409Conflict, "Another profile already monitors this symbol.");

        await AuditAsync(auth, context, "tick_monitor_profile_saved", $"{profile.Symbol}: {(profile.Enabled ? "enabled" : "disabled")}, {config.Schedules.Length} window(s)");
        return Results.Ok(profile);
    }

    private static async Task<IResult> DeleteProfileAsync(Guid id, HttpContext context, TickMonitorStore store, PanelAuthStore auth)
    {
        if (FromPanel(context) is { } refused)
            return refused;

        var symbol = (await store.ListProfilesAsync(context.RequestAborted)).FirstOrDefault(profile => profile.Id == id)?.Symbol;
        if (symbol is null || !await store.DeleteProfileAsync(id, context.RequestAborted))
            return Error(StatusCodes.Status404NotFound, "The profile no longer exists.");

        await AuditAsync(auth, context, "tick_monitor_profile_deleted", symbol);
        return Results.NoContent();
    }

    private static async Task<IResult> SnoozeAsync(
        string symbol, TickMonitorSnoozeInput input, HttpContext context, TickMonitorBackgroundService service, PanelAuthStore auth)
    {
        if (FromPanel(context) is { } refused)
            return refused;
        if (input.Minutes is < 0 or > MaxSnoozeMinutes)
            return Error(StatusCodes.Status400BadRequest, $"Snooze between 0 and {MaxSnoozeMinutes} minutes.");
        if (!service.Snooze(symbol, input.Minutes))
            return Error(StatusCodes.Status404NotFound, "This symbol is not monitored.");

        await AuditAsync(auth, context, "tick_monitor_snooze", $"{symbol}: {input.Minutes} minute(s)");
        return Results.NoContent();
    }

    private static IResult Symbols(string? query, Mt5MarketCalendar calendar)
    {
        var needle = query?.Trim() ?? string.Empty;
        try
        {
            var names = calendar.SymbolNames()
                .Where(name => needle.Length == 0 || name.Contains(needle, StringComparison.OrdinalIgnoreCase))
                .OrderBy(name => name.StartsWith(needle, StringComparison.OrdinalIgnoreCase) ? 0 : 1)
                .ThenBy(name => name, StringComparer.OrdinalIgnoreCase)
                .Take(MaxSymbolSuggestions);
            return Results.Ok(names);
        }
        catch (Mt5UnavailableException exception)
        {
            return Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    private static async Task<IResult> SaveChannelAsync(
        TickMonitorChannelInput input, HttpContext context, TickMonitorStore store, PanelAuthStore auth)
    {
        if (FromPanel(context) is { } refused)
            return refused;

        var name = input.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > MaxChannelNameLength)
            return Error(StatusCodes.Status400BadRequest, $"A channel name has 1 to {MaxChannelNameLength} characters.");
        if (input.TelegramChatId is not { } chatId || chatId == 0)
            return Error(StatusCodes.Status400BadRequest, "Enter the Telegram chat id.");

        var channel = await store.SaveChannelAsync(input.Id ?? Guid.CreateVersion7(), name, chatId, input.Enabled ?? true, context.RequestAborted);
        if (channel is null)
            return Error(StatusCodes.Status409Conflict, "A channel with this name already exists.");

        await AuditAsync(auth, context, "tick_monitor_channel_saved", $"{channel.Name}: {channel.TelegramChatId}, {(channel.Enabled ? "enabled" : "disabled")}");
        return Results.Ok(channel);
    }

    private static async Task<IResult> DeleteChannelAsync(Guid id, HttpContext context, TickMonitorStore store, PanelAuthStore auth)
    {
        if (FromPanel(context) is { } refused)
            return refused;

        var cancellationToken = context.RequestAborted;
        var used = await store.ProfilesUsingChannelAsync(id, cancellationToken);
        if (used.Count > 0)
            return Error(StatusCodes.Status409Conflict, $"The channel is used by: {string.Join(", ", used)}. Change those profiles first.");
        if ((await store.GetSettingsAsync(cancellationToken)).OpsChannelId == id)
            return Error(StatusCodes.Status409Conflict, "The channel is the operations channel in the settings. Change the settings first.");

        var name = (await store.ListChannelsAsync(cancellationToken)).FirstOrDefault(channel => channel.Id == id)?.Name;
        if (name is null || !await store.DeleteChannelAsync(id, cancellationToken))
            return Error(StatusCodes.Status404NotFound, "The channel no longer exists.");

        await AuditAsync(auth, context, "tick_monitor_channel_deleted", name);
        return Results.NoContent();
    }

    private static async Task<IResult> TestChannelAsync(Guid id, HttpContext context, TickMonitorStore store, TickMonitorBackgroundService service)
    {
        if (FromPanel(context) is { } refused)
            return refused;

        var channel = (await store.ListChannelsAsync(context.RequestAborted)).FirstOrDefault(channel => channel.Id == id);
        if (channel is null)
            return Error(StatusCodes.Status404NotFound, "The channel no longer exists.");
        if (service.Settings.TelegramBotToken.Length == 0)
            return Error(StatusCodes.Status409Conflict, "Set the Telegram bot token in the settings first.");

        return await service.SendTestAsync(channel, context.RequestAborted)
            ? Results.NoContent()
            : Error(StatusCodes.Status502BadGateway, "Telegram did not accept the message; check the chat id and that the bot is in the chat.");
    }

    private static async Task<IResult> ListEventsAsync(
        string? symbol, DateTimeOffset? from, DateTimeOffset? to, int? limit, TickMonitorStore store, CancellationToken cancellationToken)
    {
        var size = Math.Clamp(limit ?? DefaultEventLimit, 1, TickMonitorStore.MaxEvents);
        return Results.Ok(await store.ListEventsAsync(string.IsNullOrWhiteSpace(symbol) ? null : symbol.Trim(), from, to, size, cancellationToken));
    }

    private static async Task<IResult> SaveSettingsAsync(
        TickMonitorSettingsInput input, HttpContext context, TickMonitorStore store, PanelAuthStore auth)
    {
        if (FromPanel(context) is { } refused)
            return refused;

        var cancellationToken = context.RequestAborted;
        var current = await store.GetSettingsAsync(cancellationToken);
        var token = input.ClearTelegramBotToken == true
            ? string.Empty
            : input.TelegramBotToken?.Trim() is { Length: > 0 } entered ? entered : current.TelegramBotToken;
        var settings = new TickMonitorSettings(
            input.Enabled ?? current.Enabled,
            token,
            input.OpsChannelId,
            input.MaxRepeatCount ?? current.MaxRepeatCount,
            input.MinRepeatIntervalSeconds ?? current.MinRepeatIntervalSeconds,
            input.MinAfterSeconds ?? current.MinAfterSeconds,
            input.OpenGraceSeconds ?? current.OpenGraceSeconds,
            input.EventsRetentionDays ?? current.EventsRetentionDays);
        if (settings.Validate() is { } error)
            return Error(StatusCodes.Status400BadRequest, error);
        if (settings.OpsChannelId is { } opsChannel && (await store.ListChannelsAsync(cancellationToken)).All(channel => channel.Id != opsChannel))
            return Error(StatusCodes.Status400BadRequest, "The operations channel does not exist.");

        await store.SaveSettingsAsync(settings, context.User.Identity?.Name, cancellationToken);
        var tokenChange = token == current.TelegramBotToken ? "token unchanged" : token.Length == 0 ? "token cleared" : "token changed";
        await AuditAsync(auth, context, "tick_monitor_settings_changed", $"{(settings.Enabled ? "enabled" : "disabled")}, {tokenChange}");
        return Results.Ok(TickMonitorSettingsDto.From(settings));
    }

    private static IResult? FromPanel(HttpContext context) =>
        context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader)
            ? null
            : Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");

    private static Task AuditAsync(PanelAuthStore auth, HttpContext context, string auditEvent, string detail)
    {
        var client = ClientInfo.From(context);
        return auth.AuditAsync(auditEvent, context.User.Identity?.Name, context.User.GetUserId(), client.IpAddress, client.UserAgent, detail);
    }

    private static IResult Error(int statusCode, string message) => Results.Json(new { error = message }, statusCode: statusCode);
}
