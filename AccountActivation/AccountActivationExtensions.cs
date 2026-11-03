namespace Sgb.Trading.Violation.Panel.AccountActivation;

public static class AccountActivationExtensions
{
    public static void AddAccountActivation(this WebApplicationBuilder builder)
    {
        var options = (builder.Configuration.GetSection(AccountActivationOptions.SectionName).Get<AccountActivationOptions>() ?? new()).Validate();
        builder.Services.AddSingleton(options);
        builder.Services.AddHttpClient<AccountActivationClient>(client => client.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds));
    }
}
