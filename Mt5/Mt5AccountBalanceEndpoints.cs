namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5AccountBalanceEndpoints
{
    private const decimal MaximumAmount = 1_000_000_000m;
    private const int MaximumCommentLength = 32;

    public static void MapMt5AccountBalanceEndpoints(this RouteGroupBuilder mt5) =>
        mt5.MapPost("/account-balance", ApplyAsync).RequirePermission(PanelPermissions.AccountBalance);

    private static async Task<IResult> ApplyAsync(
        Mt5AccountBalanceInput request, HttpContext context, Mt5AccountBalanceWriter writer, Mt5ChangeLog changeLog)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");
        if (request.Login == 0 || !Enum.TryParse<Mt5BalanceKindEnum>(request.Kind, true, out var kind))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number and operation.");
        if (request.Amount is not { } amount || amount <= 0 || amount > MaximumAmount || decimal.Round(amount, 2) != amount)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter an amount above zero with at most two decimals.");

        var comment = request.Comment?.Trim() ?? string.Empty;
        if (comment.Length is 0 or > MaximumCommentLength)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"A comment of 1 to {MaximumCommentLength} characters is required.");

        var action = kind.ToString().ToLowerInvariant();
        try
        {
            var (code, dealId) = writer.Apply(request.Login, kind, amount, comment);
            var succeeded = code is MTRetCode.MT_RET_OK or MTRetCode.MT_RET_REQUEST_DONE;
            await changeLog.RecordAsync(request.Login, action, succeeded,
                succeeded ? $"{amount:0.00}, deal {dealId}, {comment}" : $"{amount:0.00}, MetaTrader returned {code}, {comment}", context);
            if (code == MTRetCode.MT_RET_ERR_NOTFOUND)
                return Mt5Extensions.Error(StatusCodes.Status404NotFound, "No live account was found for this number.");

            return succeeded
                ? Results.Ok(new { deal = dealId })
                : Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"MetaTrader did not accept the {action} ({code}).");
        }
        catch (Mt5UnavailableException exception)
        {
            await changeLog.RecordAsync(request.Login, action, false, exception.Message, context);
            return Mt5Extensions.Error(StatusCodes.Status502BadGateway, exception.Message);
        }
    }
}
