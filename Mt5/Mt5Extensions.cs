namespace Sgb.Trading.Violation.Panel.Mt5;

public static class Mt5Extensions
{
    public static void AddMt5Connection(this WebApplicationBuilder builder)
    {
        var options = (builder.Configuration.GetSection(Mt5Options.SectionName).Get<Mt5Options>() ?? new()).Validate();
        if (!options.Enabled)
            return;

        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<Mt5ConnectionService>();
        builder.Services.AddHostedService(services => services.GetRequiredService<Mt5ConnectionService>());
    }

    public static void MapMt5Endpoints(this WebApplication app)
    {
        if (app.Services.GetService<Mt5ConnectionService>() is null)
            return;

        app.MapGet($"{PanelUserEndpoints.Prefix}/mt5/status", (Mt5ConnectionService mt5) => Results.Ok(mt5.Status));
    }
}
