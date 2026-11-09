namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5TradeReportEndpoints
{
    private const string FilterPrefix = "Filters[";

    public static void MapMt5TradeReportEndpoints(this RouteGroupBuilder mt5)
    {
        mt5.MapGet("/trade-report", ReadAsync).RequirePermission(PanelPermissions.TradeHistoryView);
        mt5.MapGet("/trade-report/options", Options).RequirePermission(PanelPermissions.TradeHistoryView);
    }

    private static IResult Options(Mt5TradeReportReader reader)
    {
        try
        {
            return Results.Ok(reader.Options());
        }
        catch (Mt5UnavailableException exception)
        {
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    private static async Task<IResult> ReadAsync(HttpRequest request, Mt5TradeReportReader reader, CancellationToken cancellationToken)
    {
        var query = request.Query;
        if (!Enum.TryParse<Mt5TradeReportKindEnum>(query["kind"], true, out var kind) || !Enum.IsDefined(kind))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Choose positions, orders or deals.");

        if (!TryParseUtc(query["fromUtc"], out var fromUtc) || !TryParseUtc(query["toUtc"], out var toUtc))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Fill in both From and To.");

        if (fromUtc > toUtc)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "From must not be after To.");

        if (toUtc - fromUtc > TimeSpan.FromDays(Mt5TradeReportReader.MaxRangeDays))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, $"Choose a range of at most {Mt5TradeReportReader.MaxRangeDays} days.");

        if (!TryParseVolume(query["volumeFrom"], out var volumeFrom) || !TryParseVolume(query["volumeTo"], out var volumeTo))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter the volume in lots, zero or more.");

        if (volumeFrom > volumeTo)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Volume from must not be more than volume to.");

        var symbols = Names(query["symbols"]);
        var groups = Names(query["groups"]);
        if (symbols.Concat(groups).Any(name => name.Contains(',')))
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Choose symbols and groups from the lists.");

        var filters = query
            .Where(pair => pair.Key.StartsWith(FilterPrefix, StringComparison.OrdinalIgnoreCase) && pair.Key.EndsWith(']'))
            .ToDictionary(pair => pair.Key[FilterPrefix.Length..^1], pair => pair.Value.ToString(), StringComparer.OrdinalIgnoreCase);
        var input = new Mt5TradeReportInput(
            kind,
            fromUtc,
            toUtc,
            volumeFrom,
            volumeTo,
            symbols,
            groups,
            query["sortItem"].ToString() is { Length: > 0 } item ? item : null,
            !string.Equals(query["sortDirection"], "Asc", StringComparison.OrdinalIgnoreCase),
            int.TryParse(query["currentPage"], out var page) ? page : 1,
            int.TryParse(query["pageSize"], out var size) ? size : 1000,
            filters);

        try
        {
            return Results.Ok(await reader.ReadAsync(input, cancellationToken));
        }
        catch (Mt5UnavailableException exception)
        {
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    private static string[] Names(StringValues values) =>
        [.. values.Select(value => value?.Trim()).OfType<string>().Where(value => value.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase)];

    private static bool TryParseVolume(string? text, out double? value)
    {
        value = null;
        if (string.IsNullOrWhiteSpace(text))
            return true;

        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) || parsed < 0 || !double.IsFinite(parsed))
            return false;

        value = parsed;
        return true;
    }

    private static bool TryParseUtc(string? text, out DateTime value)
    {
        var parsed = DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out value);
        value = DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return parsed;
    }
}
