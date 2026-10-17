using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Transforms;

const string LoginRateLimitPolicy = "login";
const string LoginPage = "/login.html";
const string ServiceStatusClient = "service-status";
// The Violation service reads the admin's Identity token from this cookie (the foundation's admin access token cookie).
const string AdminTokenCookie = "admin-client_token";
const string AccessTokenClaim = "access_token";
// TEMPORARY-PANEL-ACCESS: the header and minimum key length of the service's temporary panel access mode.
const string PanelAccessHeader = "X-Panel-Key";
const int MinimumPanelAccessKeyLength = 32;
string[] publicPaths = [LoginPage, "/app.css", "/theme.js"];

var builder = WebApplication.CreateBuilder(args);

var panelUsername = RequiredSetting(builder.Configuration, "Panel:Username");
var panelPassword = RequiredSetting(builder.Configuration, "Panel:Password");
var apiBaseUrl = RequiredSetting(builder.Configuration, "Panel:ApiBaseUrl");
// Optional: a token used when the sign-in form leaves the token empty, and a health URL that answers { status: "Healthy" }.
var configuredAccessToken = builder.Configuration["Panel:AdminAccessToken"];
var healthUrl = builder.Configuration["Panel:HealthUrl"];
// TEMPORARY-PANEL-ACCESS: with a key, the service trusts the panel instead of an Identity token, and the sign-in asks
// for no token. Remove with the service's mode; see docs/temporary-panel-access.md.
var panelAccessKey = builder.Configuration["Panel:PanelAccessKey"] is { Length: > 0 } configuredKey
    ? ValidPanelAccessKey(configuredKey.Trim())
    : null;
var temporaryPanelAccess = panelAccessKey is not null;

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = LoginPage;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        // HTTPS-only once the panel is served over HTTPS; plain HTTP is allowed for local runs.
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            else
                context.Response.Redirect(LoginPage);
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization(options =>
    options.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy(LoginRateLimitPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.OnRejected = (context, _) =>
    {
        context.HttpContext.Response.Redirect($"{LoginPage}?error=rate");
        return ValueTask.CompletedTask;
    };
});

builder.Services.AddHttpClient(ServiceStatusClient, client => client.Timeout = TimeSpan.FromSeconds(5));

builder.Services
    .AddReverseProxy()
    .LoadFromMemory(
        [
            new RouteConfig
            {
                RouteId = "violation-api",
                ClusterId = "violation",
                Match = new RouteMatch { Path = "/api/{**rest}" }
            }
        ],
        [
            new ClusterConfig
            {
                ClusterId = "violation",
                Destinations = new Dictionary<string, DestinationConfig>
                {
                    ["violation"] = new() { Address = apiBaseUrl }
                },
                // Similarity evidence reads can take up to 60 seconds each.
                HttpRequest = new ForwarderRequestConfig { ActivityTimeout = TimeSpan.FromSeconds(120) }
            }
        ])
    .AddTransforms(context =>
    {
        // The panel's own cookies never reach the service; only the panel key or the signed-in admin's Identity token does.
        context.AddRequestHeaderRemove("Cookie");
        context.AddRequestHeaderRemove(PanelAccessHeader);
        context.AddRequestTransform(transformContext =>
        {
            var headers = transformContext.ProxyRequest.Headers;
            if (temporaryPanelAccess)
            {
                headers.TryAddWithoutValidation(PanelAccessHeader, panelAccessKey);
                return ValueTask.CompletedTask;
            }

            var token = transformContext.HttpContext.User.FindFirstValue(AccessTokenClaim);
            if (!string.IsNullOrEmpty(token))
                headers.TryAddWithoutValidation("Cookie", $"{AdminTokenCookie}={token}");
            return ValueTask.CompletedTask;
        });
        context.AddResponseTransform(async transformContext =>
        {
            if (transformContext.ProxyResponse?.StatusCode != HttpStatusCode.Unauthorized)
                return;

            var httpContext = transformContext.HttpContext;
            if (temporaryPanelAccess)
            {
                // A rejected panel key is a configuration fault, not an ended session: signing out would only loop.
                httpContext.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Sgb.Trading.Violation.Panel.Proxy")
                    .LogError("The Violation service rejected the panel access key; Panel:PanelAccessKey must equal PanelAccess:AccessKey of the service.");
                httpContext.Response.StatusCode = StatusCodes.Status502BadGateway;
                transformContext.SuppressResponseBody = true;
                return;
            }

            // The service rejected the token (expired or revoked), so the panel session ends and the admin signs in again.
            await httpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        });
    });

var app = builder.Build();

if (temporaryPanelAccess)
    app.Logger.LogWarning(
        "TEMPORARY PANEL ACCESS: the panel signs in without an Identity token and sends {Header} to the service. " +
        "Remove Panel:PanelAccessKey when the service is connected to Identity (docs/temporary-panel-access.md).",
        PanelAccessHeader);

// The login page and its stylesheet are the only files served before authentication.
app.UseWhen(
    context => publicPaths.Contains(context.Request.Path.Value, StringComparer.OrdinalIgnoreCase),
    branch => branch.UseStaticFiles());

app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/auth/login", async (HttpContext context) =>
    {
        var form = await context.Request.ReadFormAsync();
        if (!SecretEquals(form["username"].ToString(), panelUsername) |
            !SecretEquals(form["password"].ToString(), panelPassword))
            return Results.Redirect($"{LoginPage}?error=invalid");

        List<Claim> claims = [new Claim(ClaimTypes.Name, panelUsername)];
        if (!temporaryPanelAccess)
        {
            var enteredToken = form["accessToken"].ToString().Trim();
            var accessToken = enteredToken.Length > 0 ? enteredToken : configuredAccessToken?.Trim();
            if (string.IsNullOrEmpty(accessToken) || !IsUnexpiredJwt(accessToken))
                return Results.Redirect($"{LoginPage}?error=token");
            claims.Add(new Claim(AccessTokenClaim, accessToken));
        }

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
        return Results.Redirect("/");
    })
    .AllowAnonymous()
    .RequireRateLimiting(LoginRateLimitPolicy);

// Tells the sign-in page whether to ask for an Identity token: "none" (temporary panel access), "optional" (a
// configured token is the fallback) or "required".
app.MapGet("/auth/options", () => Results.Ok(new
    {
        accessToken = temporaryPanelAccess ? "none" : string.IsNullOrWhiteSpace(configuredAccessToken) ? "required" : "optional"
    }))
    .AllowAnonymous();

app.MapPost("/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Redirect(LoginPage);
});

// The service's own health endpoint listens on a restricted port (and not at all in local mode), so the panel probes it.
app.MapGet("/service-status", async (IHttpClientFactory httpClientFactory, CancellationToken cancellationToken) =>
{
    try
    {
        using var response = await httpClientFactory.CreateClient(ServiceStatusClient)
            .GetAsync(healthUrl is { Length: > 0 } ? healthUrl : apiBaseUrl, cancellationToken);
        // Without a health URL any answer shows the service is running.
        return Results.Ok(new { available = healthUrl is not { Length: > 0 } || response.IsSuccessStatusCode });
    }
    catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
    {
        return Results.Ok(new { available = false });
    }
});

app.MapReverseProxy();

await app.RunAsync();

static string RequiredSetting(IConfiguration configuration, string key) =>
    configuration[key] is { Length: > 0 } value
        ? value
        : throw new InvalidOperationException($"Configuration value '{key}' is required.");

// Hashing first keeps the comparison constant-time regardless of input length.
static bool SecretEquals(string candidate, string expected) =>
    CryptographicOperations.FixedTimeEquals(
        SHA256.HashData(Encoding.UTF8.GetBytes(candidate)),
        SHA256.HashData(Encoding.UTF8.GetBytes(expected)));

// TEMPORARY-PANEL-ACCESS: the service refuses shorter keys, so the panel fails at startup rather than on every request.
static string ValidPanelAccessKey(string key) =>
    key.Length >= MinimumPanelAccessKeyLength
        ? key
        : throw new InvalidOperationException($"Panel:PanelAccessKey must be at least {MinimumPanelAccessKeyLength} characters.");

// Only a shape and expiry check; the service validates the signature, issuer, audience and token version.
static bool IsUnexpiredJwt(string token)
{
    var parts = token.Split('.');
    if (parts.Length != 3)
        return false;

    try
    {
        using var payload = JsonDocument.Parse(Base64UrlTextEncoder.Decode(parts[1]));
        return payload.RootElement.TryGetProperty("exp", out var exp) &&
               exp.TryGetInt64(out var expiresAt) &&
               DateTimeOffset.FromUnixTimeSeconds(expiresAt) > DateTimeOffset.UtcNow;
    }
    catch (Exception exception) when (exception is FormatException or JsonException or ArgumentException)
    {
        return false;
    }
}
