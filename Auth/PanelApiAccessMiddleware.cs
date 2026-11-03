namespace Sgb.Trading.Violation.Panel.Auth;

public sealed class PanelApiAccessMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/api") || PanelApiRules.IsAllowed(context.Request.Path, context.User))
            return next(context);

        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return context.Response.WriteAsJsonAsync(new { error = PanelAuthorizationExtensions.ForbiddenMessage });
    }
}
