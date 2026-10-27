# Sgb.Trading.Violation.Panel

Web panel for the Trading Violation reports. It serves static pages from `wwwroot/`, has its own cookie sign-in, and
forwards `/api/*` to the Violation API through a reverse proxy (YARP). The browser never calls the API directly.

## Configuration

| Setting | Required | Meaning |
|---|---|---|
| `ConnectionStrings:PanelAuth` | yes | PostgreSQL database of the panel accounts, sessions and sign-in audit log (keep it in user secrets or environment variables) |
| `Panel:Auth:*` | no | Lockout and session limits; see [`../docs/panel-authentication.md`](../docs/panel-authentication.md) |
| `Panel:ApiBaseUrl` | yes | The Violation API address, e.g. `http://localhost:9186/` locally; add the `/trading-violation/` path behind the gateway |
| `Panel:AdminAccessToken` | no | Identity admin token used when the sign-in leaves the token field empty |
| `Panel:HealthUrl` | no | A URL that answers `{ status: "Healthy" }`; without it the panel only checks that the API answers |
| `Panel:PanelAccessKey` | temporary | See below |
| `Mt5:*` | no | MetaTrader connection; see below |

## MetaTrader connection

Like Sgb.Mt5Panel, the panel can keep a Manager API and an Administrator API connection to the MetaTrader 5 server.
Both stay connected in the background, are checked every `HealthCheckSeconds` and reconnect after a failure. The
connection is off unless `Mt5:Enabled` is `true`; then the panel refuses to start with a missing or invalid setting.

| Setting | Required | Meaning |
|---|---|---|
| `Mt5:Enabled` | no | `false` by default; turns the connection on |
| `Mt5:Server` | when enabled | `host:port` entries separated by `;`, tried in order |
| `Mt5:Login`, `Mt5:Password` | when enabled | The manager account |
| `Mt5:AdminServer`, `Mt5:AdminLogin`, `Mt5:AdminPassword` | no | Administrator API account; each falls back to the manager value when empty |
| `Mt5:ConnectTimeoutSeconds` | no | 1-300, default 30 |
| `Mt5:HealthCheckSeconds` | no | 5-600, default 15 |

Keep the account and password in `appsettings.local.json`, user secrets or environment variables (`Mt5__Password`),
never in `appsettings.json`. `GET /panel-api/mt5/status` (signed-in users) reports each link: connected, server,
last check and last error. Code that needs the server uses `Mt5ConnectionService.RunManager` or `RunAdmin`, which
serialise the native calls. The panel is built for x64; the MetaQuotes libraries are in `Mt5Native/`.

## Run

```powershell
dotnet user-secrets set "ConnectionStrings:PanelAuth" "Host=localhost;Database=violation_panel;Username=<user>;Password=<password>"
dotnet run -- users add <username>   # asks for the password, prints the authenticator key
dotnet run
```

The panel listens on `http://localhost:5180`.

## Sign-in and API access

- **Panel sign-in:** every person has a database account with a password and an authenticator code (2FA), with
  lockout, server-side sessions and an audit log. Super admins manage accounts on the **Users** page (or with `users ...` commands); everyone changes their password on the **Account** page. Details:
  [`../docs/panel-authentication.md`](../docs/panel-authentication.md).
- **Normal (Identity):** users also enter an Identity admin access token
  (`admin-client_token`). The panel sends the token to the API as that cookie. When the API rejects it, the panel
  session ends and the user signs in again.
- **Temporary panel access:** see the next section.

## Temporary panel access (to be removed)

> **Temporary until 2026-12-17.** When `Panel:PanelAccessKey` is set, users sign in with their panel account
> (password and authenticator code) only, and the panel sends the key to the API in the `X-Panel-Key` header. The API must run with
> `PanelAccess:Enabled: true` and the same key. The code is tagged `TEMPORARY-PANEL-ACCESS`.

Configuration, security constraints, how to turn it off and the removal checklist: [`../docs/temporary-panel-access.md`](../docs/temporary-panel-access.md).
