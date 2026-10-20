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
