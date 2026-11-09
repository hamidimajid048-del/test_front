namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5AccountDataEndpoints
{
    public static void MapMt5AccountDataEndpoints(this RouteGroupBuilder mt5)
    {
        var data = mt5.MapGroup("/account-data").RequirePermission(PanelPermissions.AccountDataView);
        data.MapGet("", (string? login, Mt5AccountDataReader reader) => Read(login, reader.Overview));
        data.MapGet("/open", (string? login, Mt5AccountDataReader reader) => Read(login, reader.OpenTrades));
        data.MapGet("/transfers", (string? login, Mt5AccountDataReader reader) => Read(login, reader.Transfers));
        data.MapGet("/positions", (string? login, Mt5AccountDataReader reader) => Read(login, reader.PositionHistory));
        data.MapGet("/position", (string? login, string? position, Mt5AccountDataReader reader) =>
            ulong.TryParse(position, out var positionId) && positionId != 0
                ? Read(login, account => reader.PositionDetail(account, positionId))
                : Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid position number."));
        data.MapGet("/orders", (string? login, Mt5AccountDataReader reader) => Read(login, reader.OrderHistory));
        data.MapGet("/deals", (string? login, Mt5AccountDataReader reader) => Read(login, reader.Deals));
        data.MapGet("/find-login", (string? kind, string? ticket, Mt5AccountDataReader reader) =>
            Enum.TryParse<Mt5TicketKindEnum>(kind, true, out var parsedKind) && Enum.IsDefined(parsedKind)
                ? Read(ticket, number => reader.FindLogin(parsedKind, number), $"Enter a valid {parsedKind.ToString().ToLowerInvariant()} number.")
                : Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Choose a position, order or deal number."));
    }

    private static IResult Read(string? login, Func<ulong, object?> read, string invalidMessage = "Enter a valid account number.")
    {
        if (!ulong.TryParse(login, out var parsed) || parsed == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, invalidMessage);

        try
        {
            return read(parsed) is { } result
                ? Results.Ok(result)
                : Mt5Extensions.Error(StatusCodes.Status404NotFound, "No account was found for this number.");
        }
        catch (Mt5UnavailableException exception)
        {
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }
}
