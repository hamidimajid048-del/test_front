namespace Sgb.Trading.Violation.Panel.Auth;

public sealed class PanelRequestLogMiddleware(RequestDelegate next, ILogger<PanelRequestLogMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;
        if (!path.StartsWithSegments("/api") && !path.StartsWithSegments(PanelUserEndpoints.Prefix) && !path.StartsWithSegments("/auth"))
        {
            await next(context);
            return;
        }

        var started = Stopwatch.GetTimestamp();
        try
        {
            await next(context);
        }
        catch (Exception exception)
        {
            logger.LogError("{Method} {Path} failed after {Elapsed} ms for {User}: {Error}", context.Request.Method, path,
                Elapsed(started), User(context), exception.Message);
            throw;
        }

        var status = context.Response.StatusCode;
        var level = status >= 500 ? LogLevel.Error : status >= 400 ? LogLevel.Warning
            : HttpMethods.IsGet(context.Request.Method) ? LogLevel.Debug : LogLevel.Information;
        logger.Log(level, "{Method} {Path} -> {Status} in {Elapsed} ms for {User}", context.Request.Method, path, status,
            Elapsed(started), User(context));
    }

    private static long Elapsed(long started) => (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds;

    private static string User(HttpContext context) => context.User.Identity?.Name ?? "anonymous";
}
