namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5BulkBalanceEndpoints
{
    public static void MapMt5BulkBalanceEndpoints(this RouteGroupBuilder mt5)
    {
        var bulk = mt5.MapGroup("/account-balance/bulk").RequirePermission(PanelPermissions.AccountBalanceBulk);
        bulk.MapPost("/check", Check);
        bulk.MapPost("/apply", ApplyAsync);
    }

    private static IResult Check(Mt5BulkBalanceCheckInput request, HttpContext context, Mt5BulkBalanceService service)
    {
        if (Reject(context, request.Rows, Mt5BulkBalanceService.MaxRows) is { } rejected)
            return rejected;

        try
        {
            return Results.Ok(service.Check(request.Rows!));
        }
        catch (Mt5UnavailableException exception)
        {
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    private static async Task<IResult> ApplyAsync(
        Mt5BulkBalanceApplyInput request, HttpContext context, Mt5BulkBalanceService service, CancellationToken cancellationToken)
    {
        if (Reject(context, request.Rows, Mt5BulkBalanceService.MaxRowsPerApply) is { } rejected)
            return rejected;

        if (request.BatchId == Guid.Empty)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "The batch has no id.");

        return Results.Ok(await service.ApplyAsync(request.BatchId, request.Rows!, context, cancellationToken));
    }

    private static IResult? Reject(HttpContext context, IReadOnlyList<Mt5BulkBalanceRowInput>? rows, int maxRows)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");

        if (rows is null || rows.Count is 0 || rows.Count > maxRows)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"Send 1 to {maxRows} rows.");

        if (rows.Any(row => row is null || row.Row <= 0) || rows.DistinctBy(row => row.Row).Count() != rows.Count)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Every row needs its own row number.");

        return null;
    }
}
