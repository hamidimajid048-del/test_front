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

## MetaTrader user directory

Name, group, email and balance of logins, and the login search by email, are read from the `Mt5Users` PostgreSQL database
(table `mt5.users`, filled every 30 minutes by Sgb.Trading.Violation.Mt5UserSync), not from MetaTrader. Set
`ConnectionStrings:Mt5Users`; without it those endpoints answer 503. The data is as fresh as the last sync run.

## MetaTrader connection

Like Sgb.Mt5Panel, the panel can keep a Manager API and an Administrator API connection to the MetaTrader 5 server, both with the same account.
Both stay connected in the background, are checked every `HealthCheckSeconds` and reconnect after a failure. The
connection is off unless `Mt5:Enabled` is `true`; then the panel refuses to start with a missing or invalid setting.

| Setting | Required | Meaning |
|---|---|---|
| `Mt5:Enabled` | no | `false` by default; turns the connection on |
| `Mt5:Server` | when enabled | `host:port` entries separated by `;`, tried in order |
| `Mt5:Login`, `Mt5:Password` | when enabled | The one account used for both the Manager and the Administrator connection |
| `Mt5:ConnectTimeoutSeconds` | no | 1-300, default 30 |
| `Mt5:HealthCheckSeconds` | no | 5-600, default 15 |

Keep the account and password in `appsettings.local.json`, user secrets or environment variables (`Mt5__Password`),
never in `appsettings.json`. `GET /panel-api/mt5/status` (signed-in users) reports each link: connected, server,
last check and last error. Code that needs the server uses `Mt5ConnectionService.RunManager` or `RunAdmin`, which
serialise the native calls. The panel is built for x64; the MetaQuotes libraries are in `Mt5Native/`.

`GET /panel-api/mt5/accounts?logins=1,2,3` (1 to 500 logins) returns each account's name, group, email and balance.
Active accounts are read from the Manager; a login the Manager does not have is looked up in the Administrator
archive (deleted accounts). `source` is `Manager`, `Archive`, `NotFound`, or `Unavailable` when the archive cannot be
read. It answers 503 when the Manager is not connected or `Mt5:Enabled` is `false`. The Similarity page calls it for
the related logins after the summary table has loaded and fills the Name, Group, Email and Balance columns.

`GET /panel-api/mt5/logins-by-email?email=` returns `{ accounts, archiveAvailable }`: every account whose email equals
the given one (case-insensitive), active ones from the Manager (`UserRequestArray`) and deleted ones from the
Administrator archive (`UserArchiveRequestArray`), each with name, group and balance. `archiveAvailable` is `false` when
the archive could not be read. `GET /panel-api/mt5/account-data?login=` and its sub-paths `/open`, `/transfers`, `/positions`, `/orders` and `/deals` read
one account from the Manager connection (404 when the login is unknown, 503 like the others). The overview has the
active and trade-enabled flags (from the user rights), the start balance, balance, equity, net profit, growth and the
balance curve; `/open` has the open positions and active orders; `/transfers` the balance, credit, charge, correction and
bonus deals; `/positions` the position history built from the deals; `/orders` the order history; `/deals` every deal.
The start balance comes from the account comment: a number, or the part after the last colon (`Prop:...:...:50000`).
Net profit is profit + commission + swap + fee of all deals that are not deposits, withdrawals or credit operations. The
**Account data** page (`account-data.html`) shows them in six tabs, each read when first opened, with a growth chart in
money or percent.

The Overview tab has three **switches** (green = enabled, red = disabled) that show the current state and change it
through `POST /panel-api/mt5/account-switch` (`{ login, switch, enabled }`), each with its own permission:

| Switch | State shown | Changed through |
|---|---|---|
| Account (`account-data.switch-account`) | MetaTrader `USER_RIGHT_ENABLED` | the Manager API, directly on the user |
| Trading (`account-data.switch-trading`) | MetaTrader `USER_RIGHT_TRADE_DISABLED` (inverted) | the Manager API, directly on the user |
| Stop-out plugin (`account-data.switch-stop-out`) | the status service (`pluginState`); if it cannot be read, the last change made from the panel (grey "Unknown" before the first) | the company API: `POST {AccountActivation:Url}` (header `APIKey`, body `{ "Logins": [login] }`); it can only be enabled, so the switch is locked while it is on |

The status service is `GET {AccountActivation:StatusUrl}` (`{login}` in the address, header `APIKey`), passed through at
`GET /panel-api/mt5/account-status?login=`. Under the switches the page shows its status (for example Monitored), the
total and daily limits with the distance to them, the last trigger and liquidation flags, and the status reason.

The Manager account (`Mt5:Login`) needs the right to change users, otherwise MetaTrader answers with a permission error
and the change is logged as failed. Keep
`AccountActivation:ApiKey` in `appsettings.local.json`, user secrets or the environment variable
`AccountActivation__ApiKey`. Under each switch the panel shows who made the last change from the panel; changes made
elsewhere (the MetaTrader terminal) are not recorded.

**Account change log:** every change the panel makes to a trading account is stored in
`violation_panel.mt5_account_changes` (time, login, action, result, detail, who, IP) and shown on the **Changes** tab of the
Account data page (`account-data.changes` permission; `GET /panel-api/mt5/account-changes?login=`). Every switch change is the first
kind of entry. A new one (deposit, withdrawal, password change, ...) must call `Mt5ChangeLog.RecordAsync(login, action, succeeded,
detail, context)` after it runs, whether it worked or not, and get a label in `CHANGE_ACTIONS` in `account-data.js`.

The **Email logins** page (`email-logins.html`) takes an email and an optional UTC day range, finds the logins as above,
and asks the service for the reports of all those logins together (`login-reports/get-logins-ip-mappings`,
`get-logins-cid-mappings` and `get-logins-sessions`, at most 100 logins): the summary lists the IPs and CIDs per login
with first/last sign-in and session count, the details list every session with its location and warnings. Sorting,
column filters and paging are done by the service.
The page has three tabs: **Logins** (the accounts of the email, each with buttons that open its login history or similarity report in a new browser tab), **Summary** (IPs and CIDs per login) and **Details** (every session).

The **Compare emails** page (`compare-emails.html`) takes two emails and an optional UTC day range, finds the logins of
each email as above, and compares the two groups through `group-compare-reports/*` of the service (at most 100 logins per
email): `get-overview` (per-email totals, the shared IPs and CIDs with their share of each side, and the evidence rating),
`get-login-pairs` (which login of one email shares how many IPs and CIDs with which login of the other),
`get-shared-ips`, `get-shared-cids` and `get-sessions` (every session that used a shared value). Evidence is *Strong* for
a valid shared CID or 3 or more shared IPs that are not VPN/proxy/Tor/datacenter, *Medium* for a shared IP that is not,
*Weak* when only such IPs or invalid CIDs are shared, and *None* otherwise. A row of the shared tables opens its
sessions in the Details tab.
The page has six tabs: **Overview** (evidence and the side-by-side totals), **Logins** (the accounts of both emails, with buttons that open a login's history or similarity report in a new browser tab), **Linked pairs**, **Shared IPs**, **Shared CIDs** and **Details**; the last three tabs show their row counts.

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
