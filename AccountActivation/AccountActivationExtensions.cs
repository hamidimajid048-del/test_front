namespace Sgb.Trading.Violation.Panel.AccountActivation;

public static class AccountActivationExtensions
{
    private const string AuditEvent = "mt5_account_enable";

    public static void AddAccountActivation(this WebApplicationBuilder builder)
    {
        var options = (builder.Configuration.GetSection(AccountActivationOptions.SectionName).Get<AccountActivationOptions>() ?? new()).Validate();
        builder.Services.AddSingleton(options);
        builder.Services.AddHttpClient<AccountActivationClient>(client => client.Timeout = TimeSpan.FromSeconds(options.TimeoutSeconds));
    }

    public static void MapAccountActivationEndpoints(this WebApplication app)
    {
        app.MapPost($"{PanelUserEndpoints.Prefix}/account-activation/enable", EnableAsync);
    }

    private static async Task<IResult> EnableAsync(
        AccountActivationRequest request,
        HttpContext context,
        AccountActivationOptions options,
        AccountActivationClient client,
        PanelAuthStore store,
        ILogger<AccountActivationClient> logger)
    {
        if (!context.Request.Headers.ContainsKey(PanelUserEndpoints.RequestHeader))
            return Mt5Extensions.Error(StatusCodes.Status403Forbidden, "The request did not come from the panel.");
        if (request.Login == 0)
            return Mt5Extensions.Error(StatusCodes.Status400BadRequest, "Enter a valid account number.");
        if (!options.IsConfigured)
            return Mt5Extensions.Error(StatusCodes.Status503ServiceUnavailable, "Account activation is not configured.");

        AccountActivationResultDto result;
        try
        {
            result = await client.EnableAsync(request.Login, context.RequestAborted);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning("Enabling account {Login} failed: {Error}", request.Login, exception.Message);
            return Mt5Extensions.Error(StatusCodes.Status502BadGateway, "The activation service could not be reached.");
        }

        var user = context.User;
        var info = ClientInfo.From(context);
        await store.AuditAsync(
            AuditEvent, user.Identity?.Name, user.GetUserId(), info.IpAddress, info.UserAgent,
            $"login {request.Login}, answered {result.StatusCode}", CancellationToken.None);
        logger.LogInformation("Enable request for account {Login} answered {Status}", request.Login, result.StatusCode);

        return result.Succeeded
            ? Results.Ok(result)
            : Mt5Extensions.Error(
                StatusCodes.Status502BadGateway,
                $"The activation service answered {result.StatusCode}{(result.Detail.Length > 0 ? $": {result.Detail}" : string.Empty)}");
    }
}
