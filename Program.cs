using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Transforms;

const string LoginRateLimitPolicy = "login";
const string LoginPage = "/login.html";
string[] publicPaths = [LoginPage, "/app.css"];

var builder = WebApplication.CreateBuilder(args);

var panelUsername = RequiredSetting(builder.Configuration, "Panel:Username");
var panelPassword = RequiredSetting(builder.Configuration, "Panel:Password");
var apiBaseUrl = RequiredSetting(builder.Configuration, "Panel:ApiBaseUrl");

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
    .AddTransforms(context => context.AddRequestHeaderRemove("Cookie"));

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

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, panelUsername)],
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
