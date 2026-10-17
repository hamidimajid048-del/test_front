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
string[] publicPaths = [LoginPage, "/app.css", "/theme.js"];

var builder = WebApplication.CreateBuilder(args);

var panelUsername = RequiredSetting(builder.Configuration, "Panel:Username");
var panelPassword = RequiredSetting(builder.Configuration, "Panel:Password");
var apiBaseUrl = RequiredSetting(builder.Configuration, "Panel:ApiBaseUrl");
// Optional: a token used when the sign-in form leaves the token empty, and a health URL that answers { status: "Healthy" }.
var configuredAccessToken = builder.Configuration["Panel:AdminAccessToken"];
var healthUrl = builder.Configuration["Panel:HealthUrl"];

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
        // The panel's own cookies never reach the service; only the signed-in admin's Identity token does.
        context.AddRequestHeaderRemove("Cookie");
        context.AddRequestTransform(transformContext =>
        {
            var token = transformContext.HttpContext.User.FindFirstValue(AccessTokenClaim);
            if (!string.IsNullOrEmpty(token))
                transformContext.ProxyRequest.Headers.TryAddWithoutValidation("Cookie", $"{AdminTokenCookie}={token}");
            return ValueTask.CompletedTask;
        });
        // The service rejected the token (expired or revoked), so the panel session ends and the admin signs in again.
        context.AddResponseTransform(async transformContext =>
        {
            if (transformContext.ProxyResponse?.StatusCode == HttpStatusCode.Unauthorized)
                await transformContext.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        });
    });

var app = builder.Build();

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

        var enteredToken = form["accessToken"].ToString().Trim();
        var accessToken = enteredToken.Length > 0 ? enteredToken : configuredAccessToken?.Trim();
        if (string.IsNullOrEmpty(accessToken) || !IsUnexpiredJwt(accessToken))
            return Results.Redirect($"{LoginPage}?error=token");

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, panelUsername), new Claim(AccessTokenClaim, accessToken)],
            CookieAuthenticationDefaults.AuthenticationScheme);
        await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
        return Results.Redirect("/");
    })
    .AllowAnonymous()
    .RequireRateLimiting(LoginRateLimitPolicy);

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
