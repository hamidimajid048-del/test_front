namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5Extensions
{
    private const int MaxChangeEntries = 500;

    public static void AddMt5Connection(this WebApplicationBuilder builder)
    {
        var options = (builder.Configuration.GetSection(Mt5Options.SectionName).Get<Mt5Options>() ?? new()).Validate();
        if (!options.Enabled)
            return;

        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<Mt5ConnectionService>();
        builder.Services.AddHostedService(services => services.GetRequiredService<Mt5ConnectionService>());
        builder.Services.AddSingleton<Mt5AccountDataReader>();
        builder.Services.AddSingleton<Mt5TradeReportReader>();
        builder.Services.AddSingleton<Mt5AccountRightsWriter>();
        builder.Services.AddSingleton<Mt5AccountPasswordWriter>();
        builder.Services.AddSingleton<Mt5AccountBalanceWriter>();
        builder.Services.AddSingleton<Mt5BulkBalanceService>();
        builder.Services.ConfigureHttpJsonOptions(json => json.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
    }

    public static void MapMt5Endpoints(this WebApplication app)
    {
        var mt5 = app.MapGroup($"{PanelUserEndpoints.Prefix}/mt5");
        mt5.MapGet("/account-changes", ReadAccountChanges).RequirePermission(PanelPermissions.AccountChangesView);
        mt5.MapMt5AccountSwitchEndpoints();

        if (app.Services.GetService<Mt5ConnectionService>() is null)
        {
            mt5.MapGet("/{**path}", () => Error(StatusCodes.Status503ServiceUnavailable, "The MetaTrader connection is not enabled."));
            return;
        }

        mt5.MapGet("/status", (Mt5ConnectionService connection) => Results.Ok(connection.Status))
            .RequirePermission(PanelPermissions.AccountDataView);
        mt5.MapMt5AccountDataEndpoints();
        mt5.MapMt5TradeReportEndpoints();
        mt5.MapMt5AccountPasswordEndpoints();
        mt5.MapMt5AccountBalanceEndpoints();
        mt5.MapMt5BulkBalanceEndpoints();
    }

    private static async Task<IResult> ReadAccountChanges(string? login, Mt5ChangeLog changeLog, CancellationToken cancellationToken) =>
        ulong.TryParse(login, out var parsed) && parsed > 0
            ? Results.Ok(await changeLog.ListAsync(parsed, MaxChangeEntries, cancellationToken))
            : Error(StatusCodes.Status400BadRequest, "Enter a valid account number.");

    internal static IResult Error(int statusCode, string message) => Results.Json(new { error = message }, statusCode: statusCode);
}
