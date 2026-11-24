namespace Sgb.Trading.Violation.Panel.TickMonitor;

public static class TickMonitorExtensions
{
    private static readonly TimeSpan TelegramTimeout = TimeSpan.FromSeconds(15);

    public static void AddTickMonitor(this WebApplicationBuilder builder)
    {
        builder.Services.AddSingleton<TickMonitorStore>();
        if (builder.Services.All(descriptor => descriptor.ServiceType != typeof(Mt5ConnectionService)))
            return;

        builder.Services.AddHttpClient(TelegramSender.HttpClientName, client => client.Timeout = TelegramTimeout);
        builder.Services.AddSingleton<TelegramSender>();
        builder.Services.AddSingleton<Mt5TickSink>();
        builder.Services.AddSingleton<Mt5MarketCalendar>();
        builder.Services.AddSingleton<TickMonitorBackgroundService>();
        builder.Services.AddHostedService(services => services.GetRequiredService<TickMonitorBackgroundService>());
    }

    public static void MapTickMonitorEndpoints(this WebApplication app)
    {
        var api = app.MapGroup($"{PanelUserEndpoints.Prefix}/tick-monitor");
        if (app.Services.GetService<TickMonitorBackgroundService>() is null)
        {
            api.Map("/{**path}", () => Results.Json(new { error = "The MetaTrader connection is not enabled." }, statusCode: StatusCodes.Status503ServiceUnavailable));
            return;
        }

        api.MapTickMonitorEndpoints();
    }
}
