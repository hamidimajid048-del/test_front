namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5AccountSwitchEndpoints
{
    public static void MapMt5AccountSwitchEndpoints(this RouteGroupBuilder mt5)
    {
        mt5.MapGet("/account-switches", ReadAsync).RequirePermission(PanelPermissions.AccountDataView);
        mt5.MapGet("/account-status", ReadStatusAsync).RequirePermission(PanelPermissions.AccountDataView);
        mt5.MapPost("/account-switch", SetAsync);
    }

    private static async Task<IResult> ReadAsync(string? login, Mt5ChangeLog changeLog, CancellationToken cancellationToken) =>
        ulong.TryParse(login, out var parsed) && parsed > 0
            ? Results.Ok(await changeLog.LastSwitchChangesAsync(parsed, cancellationToken))
            : Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number.");

    private static async Task<IResult> ReadStatusAsync(
        string? login, AccountActivationOptions options, AccountActivationClient client, CancellationToken cancellationToken)
    {
        if (!ulong.TryParse(login, out var parsed) || parsed == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number.");
        if (!options.IsStatusConfigured)
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, "The status service is not configured.");

        try
        {
            var result = await client.GetStatusAsync(parsed, cancellationToken);
            return result.Succeeded
                ? Results.Content(result.Body, "application/json")
                : Mt5Extensions.Error(result.StatusCode == StatusCodes.Status404NotFound ? StatusCodes.Status404NotFound : StatusCodes.Status502BadGateway,
                    $"The status service answered {result.StatusCode}.");
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return Mt5Extensions.Error(StatusCodes.Status502BadGateway, "The status service could not be reached.");
        }
    }

    private static async Task<IResult> SetAsync(
        Mt5AccountSwitchInput request,
        HttpContext context,
        AccountActivationOptions options,
        AccountActivationClient client,
        Mt5ChangeLog changeLog,
        ILogger<AccountActivationClient> logger)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");
        if (request.Login == 0 || request.Enabled is not { } enabled || !Enum.TryParse<Mt5AccountSwitchEnum>(request.Switch, true, out var target))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number and switch.");
        if (target == Mt5AccountSwitchEnum.StopOut && !enabled)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "The stop-out plugin can only be enabled.");
        if (!context.User.HasAnyPermission(Mt5AccountSwitches.Permission(target)))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, PanelAuthorizationExtensions.ForbiddenMessage);

        var action = Mt5AccountSwitches.Action(target, enabled);
        try
        {
            var (succeeded, detail, failure) = target == Mt5AccountSwitchEnum.StopOut
                ? await SetStopOutAsync(request.Login, options, client, context.RequestAborted)
                : SetRights(request.Login, target, enabled, context);
            await changeLog.RecordAsync(request.Login, action, succeeded, detail, context);
            return succeeded ? Results.Ok(new { enabled }) : failure!;
        }
        catch (Exception exception) when (exception is Mt5UnavailableException or HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning("Switching {Switch} of account {Login} failed: {Error}", target, request.Login, exception.Message);
            await changeLog.RecordAsync(request.Login, action, false, exception.Message, context);
            return Mt5Extensions.Error(
                StatusCodes.Status502BadGateway,
                exception is Mt5UnavailableException ? exception.Message : "The activation service could not be reached.");
        }
    }

    private static (bool Succeeded, string Detail, IResult? Failure) SetRights(ulong login, Mt5AccountSwitchEnum target, bool enabled, HttpContext context)
    {
        if (context.RequestServices.GetService<Mt5AccountRightsWriter>() is not { } writer)
            return (false, "MetaTrader connection is not enabled",
                Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, "The MetaTrader connection is not enabled."));

        return writer.Set(login, target, enabled)
            ? (true, "MetaTrader updated", null)
            : (false, "no live account", Mt5Extensions.Error(StatusCodes.Status404NotFound, "No live account was found for this number."));
    }

    private static async Task<(bool Succeeded, string Detail, IResult? Failure)> SetStopOutAsync(
        ulong login, AccountActivationOptions options, AccountActivationClient client, CancellationToken cancellationToken)
    {
        if (!options.IsConfigured)
            return (false, "not configured", Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, "This switch is not configured."));

        var result = await client.EnableAsync(login, cancellationToken);
        return (result.Succeeded, $"answered {result.StatusCode}", result.Succeeded ? null : Mt5Extensions.Error(
            StatusCodes.Status502BadGateway,
            $"The service answered {result.StatusCode}{(result.Detail.Length > 0 ? $": {result.Detail}" : string.Empty)}"));
    }
}
