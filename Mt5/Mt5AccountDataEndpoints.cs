namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5AccountDataEndpoints
{
    public static void MapMt5AccountDataEndpoints(this RouteGroupBuilder mt5)
    {
        var data = mt5.MapGroup("/account-data");
        data.MapGet("", (string? login, Mt5AccountDataReader reader) => Read(login, reader.Overview));
        data.MapGet("/open", (string? login, Mt5AccountDataReader reader) => Read(login, reader.OpenTrades));
        data.MapGet("/transfers", (string? login, Mt5AccountDataReader reader) => Read(login, reader.Transfers));
        data.MapGet("/positions", (string? login, Mt5AccountDataReader reader) => Read(login, reader.PositionHistory));
        data.MapGet("/orders", (string? login, Mt5AccountDataReader reader) => Read(login, reader.OrderHistory));
        data.MapGet("/deals", (string? login, Mt5AccountDataReader reader) => Read(login, reader.Deals));
    }

    private static IResult Read(string? login, Func<ulong, object?> read)
    {
        if (!ulong.TryParse(login, out var parsed) || parsed == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number.");

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
