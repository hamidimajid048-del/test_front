namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5AccountPasswordEndpoints
{
    private const int MinimumLength = 8;
    private const int MaximumLength = 16;

    public static void MapMt5AccountPasswordEndpoints(this RouteGroupBuilder mt5)
    {
        var passwords = mt5.MapGroup("/account-password").RequirePermission(PanelPermissions.AccountPasswords);
        passwords.MapPost("/check", (Mt5AccountPasswordInput request, HttpContext context, Mt5AccountPasswordWriter writer, Mt5ChangeLog changeLog) =>
            RunAsync(request, context, changeLog, "check", writer.Check, matches: true));
        passwords.MapPost("/change", (Mt5AccountPasswordInput request, HttpContext context, Mt5AccountPasswordWriter writer, Mt5ChangeLog changeLog) =>
            RunAsync(request, context, changeLog, "change", writer.Change, matches: false));
    }

    private static async Task<IResult> RunAsync(
        Mt5AccountPasswordInput request,
        HttpContext context,
        Mt5ChangeLog changeLog,
        string operation,
        Func<ulong, Mt5PasswordTypeEnum, string, MTRetCode> run,
        bool matches)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");
        if (request.Login == 0 || !Enum.TryParse<Mt5PasswordTypeEnum>(request.Type, true, out var type))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number and password type.");

        var password = request.Password ?? string.Empty;
        if (password.Length is < MinimumLength or > MaximumLength)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"A password has {MinimumLength} to {MaximumLength} characters.");

        var action = $"password_{type.ToString().ToLowerInvariant()}_{operation}";
        MTRetCode code;
        try
        {
            code = run(request.Login, type, password);
        }
        catch (Mt5UnavailableException exception)
        {
            await changeLog.RecordAsync(request.Login, action, false, exception.Message, context);
            return Mt5Extensions.Error(StatusCodes.Status502BadGateway, exception.Message);
        }

        if (code == MTRetCode.MT_RET_ERR_NOTFOUND)
            return Mt5Extensions.Error(StatusCodes.Status404NotFound, "No live account was found for this number.");

        if (matches)
        {
            if (code is not (MTRetCode.MT_RET_OK or MTRetCode.MT_RET_USR_INVALID_PASSWORD))
            {
                await changeLog.RecordAsync(request.Login, action, false, $"MetaTrader returned {code}", context);
                return Mt5Extensions.Error(StatusCodes.Status502BadGateway, $"MetaTrader returned {code}.");
            }

            var valid = code == MTRetCode.MT_RET_OK;
            await changeLog.RecordAsync(request.Login, action, true, valid ? "matches" : "does not match", context);
            return Results.Ok(new { valid });
        }

        await changeLog.RecordAsync(request.Login, action, code == MTRetCode.MT_RET_OK, code == MTRetCode.MT_RET_OK ? "MetaTrader updated" : $"MetaTrader returned {code}", context);
        return code == MTRetCode.MT_RET_OK
            ? Results.NoContent()
            : Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"MetaTrader did not accept the password ({code}).");
    }
}
