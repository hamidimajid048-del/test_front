using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Npgsql;
using Sgb.Trading.Violation.Panel.Auth;
using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Forwarder;
using Yarp.ReverseProxy.Transforms;

const string LoginRateLimitPolicy = "login";
const string LoginPage = "/login.html";
const string ServiceStatusClient = "service-status";
// The Violation service reads the admin's Identity token from this cookie (the foundation's admin access token cookie).
const string AdminTokenCookie = "admin-client_token";
const string AccessTokenClaim = "access_token";
const string AuthCookieName = "violation-panel.session";
// TEMPORARY-PANEL-ACCESS: the header and minimum key length of the service's temporary panel access mode.
const string PanelAccessHeader = "X-Panel-Key";
const int MinimumPanelAccessKeyLength = 32;
string[] publicPaths = [LoginPage, "/app.css", "/theme.js", "/favicon.svg"];

var builder = WebApplication.CreateBuilder(args);
// Machine-specific settings (connection string, keys) kept next to the app and out of appsettings.json; they override
// every other source.
builder.Configuration.AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: false);

// Accounts, sessions and the sign-in audit log live in PostgreSQL; see docs/panel-authentication.md.
var authConnectionString = builder.Configuration.GetConnectionString(PanelAuthOptions.ConnectionStringName) is { Length: > 0 } connection
    ? connection
    : throw new InvalidOperationException($"Connection string '{PanelAuthOptions.ConnectionStringName}' is required.");
PanelAuthStore.ValidateConnectionString(authConnectionString);
var authOptions = (builder.Configuration.GetSection(PanelAuthOptions.SectionName).Get<PanelAuthOptions>() ?? new()).Validate();
var authDataSource = NpgsqlDataSource.Create(authConnectionString);

// "users ..." manages the accounts instead of running the panel.
if (args.FirstOrDefault() == PanelUserCommands.CommandName)
    // Host options such as --environment may follow; they are configuration, not command arguments.
    return await PanelUserCommands.RunAsync([.. args[1..].TakeWhile(arg => !arg.StartsWith("--"))], new PanelAuthStore(authDataSource));

var hasLegacyCredentials =
    builder.Configuration["Panel:Username"] is { Length: > 0 } || builder.Configuration["Panel:Password"] is { Length: > 0 };

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

builder.Services.AddSingleton(authDataSource);
builder.Services.AddSingleton(authOptions);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<PanelAuthStore>();
builder.Services.AddSingleton<PanelSignInService>();

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = LoginPage;
        // The cookie lasts at most the session lifetime; the idle timeout and revocation are checked in the database.
        options.ExpireTimeSpan = authOptions.SessionLifetime;
        options.SlidingExpiration = false;
        options.Cookie.Name = AuthCookieName;
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        // HTTPS-only once the panel is served over HTTPS; plain HTTP is allowed for local runs.
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.Events.OnValidatePrincipal = async context =>
        {
            var token = context.Principal?.FindFirstValue(PanelClaims.Session);
            var store = context.HttpContext.RequestServices.GetRequiredService<PanelAuthStore>();
            if (token is not null &&
                await store.TouchSessionAsync(PanelSignInService.HashSessionToken(token), authOptions.IdleTimeout))
                return;

            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        };
        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments(PanelUserEndpoints.Prefix))
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
            await EndSessionAsync(httpContext, "identity_token_rejected");
        });
    });

builder.Services.AddSingleton(sp => new FrontendVersion(sp.GetRequiredService<IWebHostEnvironment>().WebRootFileProvider, TimeProvider.System));

var app = builder.Build();

var authStore = app.Services.GetRequiredService<PanelAuthStore>();
await authStore.EnsureSchemaAsync();
if (!await authStore.AnyActiveUserAsync())
    app.Logger.LogWarning("The panel has no active account; create one with 'users add <username>' (docs/panel-authentication.md).");
if (hasLegacyCredentials)
    app.Logger.LogWarning("Panel:Username and Panel:Password are no longer used (accounts are in the database); remove them.");

if (temporaryPanelAccess)
    app.Logger.LogWarning(
        "TEMPORARY PANEL ACCESS: the panel signs in without an Identity token and sends {Header} to the service. " +
        "Remove Panel:PanelAccessKey when the service is connected to Identity (docs/temporary-panel-access.md).",
        PanelAccessHeader);

// Behind a reverse proxy on this machine (nginx), the client address and scheme come from its X-Forwarded headers, so
// the sign-in rate limit counts each client instead of the proxy. Only loopback proxies are trusted (the default).
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
});

if (!app.Environment.IsDevelopment())
    app.UseHsts();

app.Use(async (context, next) =>
{
    // A state-changing request must come from the panel's own pages (browsers send Sec-Fetch-Site on every request).
    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) &&
        context.Request.Headers["Sec-Fetch-Site"].ToString() is { Length: > 0 } fetchSite &&
        fetchSite is not ("same-origin" or "none"))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    context.Response.OnStarting(() =>
    {
        var headers = context.Response.Headers;
        headers.XContentTypeOptions = "nosniff";
        headers.XFrameOptions = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
        headers.ContentSecurityPolicy = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
        // Sign-in and account responses (which can carry an authenticator key) are never cached.
        if (context.Request.Path.StartsWithSegments("/auth") || context.Request.Path.StartsWithSegments(PanelUserEndpoints.Prefix) ||
            string.Equals(context.Request.Path.Value, LoginPage, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(context.Request.Path.Value, "/version", StringComparison.OrdinalIgnoreCase))
            headers.CacheControl = "no-store";
        return Task.CompletedTask;
    });
    await next(context);
});

// The login page, its stylesheet, theme script and favicon are the only files served before authentication.
app.UseWhen(
    context => publicPaths.Contains(context.Request.Path.Value, StringComparer.OrdinalIgnoreCase),
    branch => branch.UseStaticFiles());

app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/auth/login", async (HttpContext context, PanelSignInService signIn) =>
    {
        var form = await context.Request.ReadFormAsync();
        var client = ClientInfo.From(context);

        // The token is checked first: a sign-in with a bad token neither counts against the account nor uses the code.
        string? accessToken = null;
        if (!temporaryPanelAccess)
        {
            var enteredToken = form["accessToken"].ToString().Trim();
            accessToken = enteredToken.Length > 0 ? enteredToken : configuredAccessToken?.Trim();
            if (string.IsNullOrEmpty(accessToken) || !IsUnexpiredJwt(accessToken))
                return Results.Redirect($"{LoginPage}?error=token");
        }

        var user = await signIn.VerifyAsync(
            form["username"].ToString(), form["password"].ToString(), form["code"].ToString(), client, context.RequestAborted);
        if (user is null)
            return Results.Redirect($"{LoginPage}?error=invalid");

        // A new session on every sign-in, so a session from before the sign-in is never reused.
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        var sessionToken = await signIn.CreateSessionAsync(user, client, context.RequestAborted);
        List<Claim> claims =
        [
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(PanelClaims.UserId, user.Id.ToString()),
            new Claim(PanelClaims.Session, sessionToken)
        ];
        if (accessToken is not null)
            claims.Add(new Claim(AccessTokenClaim, accessToken));

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

// The version of the pages on this server (a hash of every file in wwwroot), shown in the menu, to compare with the source.
app.MapGet("/version", (FrontendVersion version) => Results.Ok(new { frontend = version.Current }))
    .AllowAnonymous();

app.MapPost("/auth/logout", async (HttpContext context) =>
{
    await EndSessionAsync(context, "sign_out");
    return Results.Redirect(LoginPage);
});

// The signed-in account (/panel-api/me) and account management; see docs/panel-authentication.md.
app.MapPanelUserEndpoints();

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
return 0;

static string RequiredSetting(IConfiguration configuration, string key) =>
    configuration[key] is { Length: > 0 } value
        ? value
        : throw new InvalidOperationException($"Configuration value '{key}' is required.");

// Revokes the signed-in session in the database, records why, and removes the cookie.
static async Task EndSessionAsync(HttpContext context, string auditEvent)
{
    var user = context.User;
    if (user.GetSessionTokenHash() is { } tokenHash)
    {
        var store = context.RequestServices.GetRequiredService<PanelAuthStore>();
        var client = ClientInfo.From(context);
        await store.RevokeSessionAsync(tokenHash);
        await store.AuditAsync(auditEvent, user.Identity?.Name, user.GetUserId(), client.IpAddress, client.UserAgent);
    }

    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
}

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
