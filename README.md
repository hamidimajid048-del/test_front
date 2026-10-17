# Sgb.Trading.Violation.Panel

Web panel for the Trading Violation reports. It serves static pages from `wwwroot/`, has its own cookie sign-in, and
forwards `/api/*` to the Violation API through a reverse proxy (YARP). The browser never calls the API directly.

## Configuration

| Setting | Required | Meaning |
|---|---|---|
| `Panel:Username`, `Panel:Password` | yes | The panel sign-in (keep them in user secrets or environment variables) |
| `Panel:ApiBaseUrl` | yes | The Violation API address, e.g. `http://localhost:9186/` locally; add the `/trading-violation/` path behind the gateway |
| `Panel:AdminAccessToken` | no | Identity admin token used when the sign-in leaves the token field empty |
| `Panel:HealthUrl` | no | A URL that answers `{ status: "Healthy" }`; without it the panel only checks that the API answers |
| `Panel:PanelAccessKey` | temporary | See below |

## Run

```powershell
dotnet user-secrets set "Panel:Username" "<username>"
dotnet user-secrets set "Panel:Password" "<password>"
dotnet run
```

The panel listens on `http://localhost:5180`.

## Sign-in and API access

- **Normal (Identity):** users enter the panel username, password and an Identity admin access token
  (`admin-client_token`). The panel sends the token to the API as that cookie. When the API rejects it, the panel
  session ends and the user signs in again.
- **Temporary panel access:** see the next section.

## Temporary panel access (to be removed)

> **Temporary until 2026-12-17.** When `Panel:PanelAccessKey` is set, users sign in with the panel username and
> password only, and the panel sends the key to the API in the `X-Panel-Key` header. The API must run with
> `PanelAccess:Enabled: true` and the same key. The code is tagged `TEMPORARY-PANEL-ACCESS`.

Configuration, security constraints, how to turn it off and the removal checklist: [`../docs/temporary-panel-access.md`](../docs/temporary-panel-access.md).
