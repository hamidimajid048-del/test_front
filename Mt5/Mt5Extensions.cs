namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5Extensions
{
    public const int MaxAccountLogins = 500;
    private const int MaxEmailLength = 320;

    public static void AddMt5Connection(this WebApplicationBuilder builder)
    {
        var options = (builder.Configuration.GetSection(Mt5Options.SectionName).Get<Mt5Options>() ?? new()).Validate();
        if (!options.Enabled)
            return;

        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<Mt5ConnectionService>();
        builder.Services.AddHostedService(services => services.GetRequiredService<Mt5ConnectionService>());
        builder.Services.AddSingleton<Mt5AccountReader>();
        builder.Services.AddSingleton<Mt5AccountDataReader>();
        builder.Services.ConfigureHttpJsonOptions(json => json.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
    }

    public static void MapMt5Endpoints(this WebApplication app)
    {
        var mt5 = app.MapGroup($"{PanelUserEndpoints.Prefix}/mt5");
        if (app.Services.GetService<Mt5ConnectionService>() is null)
        {
            mt5.MapGet("/{**path}", () => Error(StatusCodes.Status503ServiceUnavailable, "The MetaTrader connection is not enabled."));
            return;
        }

        mt5.MapGet("/status", (Mt5ConnectionService connection) => Results.Ok(connection.Status));
        mt5.MapGet("/accounts", ReadAccounts);
        mt5.MapGet("/logins-by-email", FindLoginsByEmail);
        mt5.MapMt5AccountDataEndpoints();
    }

    private static IResult ReadAccounts(string? logins, Mt5AccountReader reader)
    {
        var parsed = (logins ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(text => ulong.TryParse(text, out var login) && login > 0 ? login : (ulong?)null)
            .ToArray();
        if (parsed.Length is 0 or > MaxAccountLogins || parsed.Any(login => login is null))
            return Error(StatusCodes.Status400BadRequest, $"Send 1 to {MaxAccountLogins} logins, separated by commas.");

        try
        {
            return Results.Ok(reader.Read([.. parsed.Select(login => login!.Value).Distinct()]));
        }
        catch (Mt5UnavailableException exception)
        {
            return Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    private static IResult FindLoginsByEmail(string? email, Mt5AccountReader reader)
    {
        var trimmed = (email ?? string.Empty).Trim();
        if (trimmed.Length is 0 or > MaxEmailLength || !trimmed.Contains('@'))
            return Error(StatusCodes.Status400BadRequest, "Enter a valid email address.");

        try
        {
            return Results.Ok(reader.FindByEmail(trimmed));
        }
        catch (Mt5UnavailableException exception)
        {
            return Error(StatusCodes.Status503ServiceUnavailable, exception.Message);
        }
    }

    internal static IResult Error(int statusCode, string message) => Results.Json(new { error = message }, statusCode: statusCode);
}
