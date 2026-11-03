namespace Sgb.Trading.Violation.Panel.Auth;

public static class PanelAuthorizationExtensions
{
    public const string ForbiddenMessage = "You do not have permission to do this.";

    public static bool HasAnyPermission(this ClaimsPrincipal principal, params string[] permissions) =>
        principal.HasClaim(claim => claim.Type == PanelClaims.Permission && permissions.Contains(claim.Value));

    public static TBuilder RequirePermission<TBuilder>(this TBuilder builder, params string[] anyOf)
        where TBuilder : IEndpointConventionBuilder =>
        builder.AddEndpointFilter(async (invocation, next) =>
            invocation.HttpContext.User.HasAnyPermission(anyOf)
                ? await next(invocation)
                : Results.Json(new { error = ForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden));
}
