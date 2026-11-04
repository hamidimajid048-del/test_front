namespace Sgb.Trading.Violation.Panel.Auth;

public static class PanelTableViewEndpoints
{
    private const int MaxKeyLength = 200;
    private const int MaxNameLength = 40;
    private const int MaxColumns = 100;
    private const int MaxIdLength = 120;

    public static void MapPanelTableViewEndpoints(this RouteGroupBuilder api)
    {
        var views = api.MapGroup("/table-views");
        views.MapGet("", async (string? prefix, HttpContext context, PanelTableViewStore store) =>
            Results.Ok(await store.ListAsync(UserId(context), prefix?.Trim() ?? "/", context.RequestAborted)));
        views.MapPut("", SaveAsync);
        views.MapPost("/{id:guid}/default", (Guid id, HttpContext context, PanelTableViewStore store) => SetDefaultAsync(id, true, context, store));
        views.MapDelete("/{id:guid}/default", (Guid id, HttpContext context, PanelTableViewStore store) => SetDefaultAsync(id, false, context, store));
        views.MapDelete("/{id:guid}", async (Guid id, HttpContext context, PanelTableViewStore store) =>
            await store.DeleteAsync(UserId(context), id, context.RequestAborted) ? Results.NoContent() : NotFound());
    }

    private static Guid UserId(HttpContext context) => context.User.GetUserId()!.Value;

    private static async Task<IResult> SaveAsync(SaveRequest request, HttpContext context, PanelTableViewStore store)
    {
        var key = request.TableKey?.Trim() ?? string.Empty;
        var name = request.Name?.Trim() ?? string.Empty;
        if (key.Length is 0 or > MaxKeyLength || !key.StartsWith('/'))
            return Error(StatusCodes.Status400BadRequest, "The table is not valid.");
        if (name.Length is 0 or > MaxNameLength)
            return Error(StatusCodes.Status400BadRequest, $"A view name has 1 to {MaxNameLength} characters.");
        if (!IsValid(request.Config))
            return Error(StatusCodes.Status400BadRequest, "The view is not valid.");

        return await store.SaveAsync(UserId(context), key, name, request.Config!, context.RequestAborted) is { } saved
            ? Results.Ok(saved)
            : Error(StatusCodes.Status409Conflict, $"A table can have at most {PanelTableViewStore.MaxViewsPerTable} views. Delete one first.");
    }

    private static bool IsValid(PanelTableViewConfig? config) =>
        config is not null &&
        (config.Hidden is null || (config.Hidden.Length <= MaxColumns && config.Hidden.All(id => id.Length <= MaxIdLength))) &&
        (config.Sort is null || (config.Sort.Item is { Length: > 0 and <= MaxIdLength } && config.Sort.Direction is "Asc" or "Desc"));

    private static async Task<IResult> SetDefaultAsync(Guid id, bool isDefault, HttpContext context, PanelTableViewStore store) =>
        await store.SetDefaultAsync(UserId(context), id, isDefault, context.RequestAborted) ? Results.NoContent() : NotFound();

    private static IResult NotFound() => Error(StatusCodes.Status404NotFound, "The view no longer exists.");

    private static IResult Error(int statusCode, string message) => Results.Json(new { error = message }, statusCode: statusCode);

    private sealed record SaveRequest(string? TableKey, string? Name, PanelTableViewConfig? Config);
}
