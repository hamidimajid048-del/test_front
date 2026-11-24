namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5TradeEndpoints
{
    private const string InvalidPositionMessage = "Enter a valid account and position number.";
    private const string InvalidPriceMessage = "Enter a price above zero.";
    private const string PositionNotOpenMessage = "This position is not open on the account.";

    public static void MapMt5TradeEndpoints(this RouteGroupBuilder mt5)
    {
        mt5.MapGet("/position-close", Quote).RequirePermission(PanelPermissions.ClosePosition);
        mt5.MapPost("/position-close", CloseAsync).RequirePermission(PanelPermissions.ClosePosition);
        mt5.MapPost("/order-delete", DeleteOrderAsync).RequirePermission(PanelPermissions.DeleteOrder);
    }

    private static IResult Quote(string? login, string? position, string? price, Mt5TradeWriter writer)
    {
        if (!ulong.TryParse(login, out var parsedLogin) || parsedLogin == 0 || !ulong.TryParse(position, out var positionId) || positionId == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, InvalidPositionMessage);

        double? closePrice = null;
        if (!string.IsNullOrWhiteSpace(price))
        {
            if (!double.TryParse(price, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedPrice) || !IsValidPrice(parsedPrice))
                return Mt5Extensions.Error(StatusCodes.Status400BadRequest, InvalidPriceMessage);
            closePrice = parsedPrice;
        }

        try
        {
            return writer.Quote(parsedLogin, positionId, closePrice) is { } quote
                ? Results.Ok(quote)
                : Mt5Extensions.Error(StatusCodes.Status404NotFound, PositionNotOpenMessage);
        }
        catch (Mt5UnavailableException exception)
        {
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    private static async Task<IResult> CloseAsync(Mt5PositionCloseInput request, HttpContext context, Mt5TradeWriter writer, Mt5ChangeLog changeLog)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");
        if (request.Login == 0 || request.Position == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, InvalidPositionMessage);
        if (request.Price is { } price && !IsValidPrice(price))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, InvalidPriceMessage);

        const string action = "position_close";
        var requested = request.Price is { } chosen ? $"price {chosen.ToString(CultureInfo.InvariantCulture)}" : "market price";
        try
        {
            if (await writer.CloseAsync(request.Login, request.Position, request.Price) is not { } answer)
                return Mt5Extensions.Error(StatusCodes.Status404NotFound, PositionNotOpenMessage);

            var succeeded = answer.Code is MTRetCode.MT_RET_OK or MTRetCode.MT_RET_REQUEST_DONE;
            await changeLog.RecordAsync(request.Login, action, succeeded,
                succeeded
                    ? $"position {request.Position}, {requested}, deal {answer.Deal} at {answer.Price.ToString(CultureInfo.InvariantCulture)}"
                    : $"position {request.Position}, {requested}, MetaTrader returned {answer.Code}", context);

            if (succeeded)
                return Results.Ok(new { deal = answer.Deal, price = answer.Price });

            return answer.Code == MTRetCode.MT_RET_REQUEST_TIMEOUT
                ? Mt5Extensions.Error(StatusCodes.Status504GatewayTimeout, "MetaTrader did not answer in time; check whether the position was closed.")
                : Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"MetaTrader did not close the position ({answer.Code}).");
        }
        catch (Mt5UnavailableException exception)
        {
            await changeLog.RecordAsync(request.Login, action, false, $"position {request.Position}, {exception.Message}", context);
            return Mt5Extensions.Error(StatusCodes.Status502BadGateway, exception.Message);
        }
    }

    private static async Task<IResult> DeleteOrderAsync(Mt5OrderDeleteInput request, HttpContext context, Mt5TradeWriter writer, Mt5ChangeLog changeLog)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");
        if (request.Login == 0 || request.Order == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account and order number.");

        const string action = "order_delete";
        try
        {
            if (writer.CancelOrder(request.Login, request.Order) is not { } code)
                return Mt5Extensions.Error(StatusCodes.Status404NotFound, "This order is not active on the account.");

            var succeeded = code is MTRetCode.MT_RET_OK or MTRetCode.MT_RET_REQUEST_DONE;
            await changeLog.RecordAsync(request.Login, action, succeeded,
                succeeded ? $"order {request.Order}" : $"order {request.Order}, MetaTrader returned {code}", context);
            return succeeded
                ? Results.Ok(new { order = request.Order })
                : Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"MetaTrader did not delete the order ({code}).");
        }
        catch (Mt5UnavailableException exception)
        {
            await changeLog.RecordAsync(request.Login, action, false, $"order {request.Order}, {exception.Message}", context);
            return Mt5Extensions.Error(StatusCodes.Status502BadGateway, exception.Message);
        }
    }

    private static bool IsValidPrice(double price) => double.IsFinite(price) && price > 0;
}
