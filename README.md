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

Name, group, email and balance of logins, and the login search by email, come from the Violation service
(`meta-trader-accounts/get-accounts`, `meta-trader-accounts/get-logins-by-email`), which reads `mt5_backup.mt5_users`.
The panel has no connection to a user database of its own.

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

The Copy trade & hedge page calls `meta-trader-accounts/get-accounts` (1 to 500 logins, `source` is `Manager`, `Archive` or
`NotFound`) after its table has loaded and fills the Name, Group, Email and Balance columns. The IP/CID similarity and CID/IP search
reports do not: the service returns those columns (from `mt5_backup.mt5_users`) and sorts, filters and exports them, and
applies **Different email only** on the similarity summary (`differentEmailOnly=true`).

The Email logins and Compare emails pages find the logins of an email with the service's
`meta-trader-accounts/get-logins-by-email?email=` (the users table of the MetaTrader backup, case-insensitive), each
with its status (active or archived), name, group and balance. `GET /panel-api/mt5/account-data?login=` and its sub-paths `/open`, `/transfers`, `/positions`, `/orders` and `/deals` read
one account from the Manager connection (404 when the login is unknown, 503 like the others). The overview has the
active and trade-enabled flags (from the user rights), the start balance, balance, equity, net profit, growth and the
balance curve; `/open` has the open positions and active orders; `/transfers` the balance, credit, charge, correction and
bonus deals; `/positions` the position history built from the deals; `/orders` the order history; `/deals` every deal.
The start balance comes from the account comment: a number, or the part after the last colon (`Prop:...:...:50000`).
Net profit is profit + commission + swap + fee of all deals that are not deposits, withdrawals or credit operations. The
**Account data** page (`account-data.html`) shows them in six tabs, each read when first opened, with a growth chart in
money or percent.

Open positions, orders, position history and deals (also on Trade history and Position details) show the SL and TP
prices; a position's are those of its last deal, and its **Close comment** is the comment of its last closing deal. The SL
cell is red when the stop loss closed the row and the TP cell green when the take profit did: the comment (the closing
comment for positions) holds `sl` / `tp` (for example `[sl 1.0850]`) or the reason is SL / TP.

The same tables show where each row came from, read from the MetaTrader reason: **Opened by** for positions (the reason of
the opening deal; open positions read their own), **Closed by** for closed positions (the reason of the last deal),
**Placed by** for orders and **Source** for deals. The values are Client (desktop terminal), Mobile, Web (each with its
icon), Expert, Dealer, Stop loss, Take profit, Stop out and the other server reasons.

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
The page has three tabs: **Logins** (the accounts of the email, with the devices and computer IDs each one signed in with in the range from `login-reports/get-logins-devices`, read after the table is shown and without transaction counts so it stays fast, and with buttons that open its account data, login history, similarity, copy trade, hedge or compare page in a new browser tab), **Summary** (IPs and CIDs per login) and **Details** (every session).

The **Compare emails** page (`compare-emails.html`) takes email A, one or more emails B (separated by commas) and an
optional UTC day range, finds the logins of every email as above, and compares the logins of A with the logins of all
emails B as one group through `group-compare-reports/*` of the service (at most 100 logins per side):
`get-overview` (per-side totals, the shared IPs and CIDs with their share of each side, and the evidence rating),
`get-login-pairs` (which login of A shares how many IPs and CIDs with which login of B),
`get-shared-ips`, `get-shared-cids` and `get-sessions` (every session that used a shared value). Evidence is *Strong* for
a valid shared CID or 3 or more shared IPs that are not VPN/proxy/Tor/datacenter, *Medium* for a shared IP that is not,
*Weak* when only such IPs or invalid CIDs are shared, and *None* otherwise. A row of the shared tables opens its
sessions in the Details tab.
The page has six tabs: **Overview** (evidence and the side-by-side totals), **Logins** (the accounts of both sides, each with its email and the same buttons for each login), **Linked pairs**, **Shared IPs**, **Shared CIDs** and **Details**; the last three tabs show their row counts.
Every row that names a login also carries its email from the MetaTrader backup, filled by the service: the linked pairs
(`email`, `otherEmail`, sortable and filterable), the shared IPs and CIDs (`mainEmails`, `otherEmails`, the distinct
emails of each side's logins) and the sessions of the Details tab (`email`, sortable and filterable). The Compare
accounts overview shows the email of both logins the same way.

The **Compare with logins** page (`compare-logins.html`, permission `compare.view`) is the same comparison for one main
login against one or more compared logins typed directly (separated by commas or spaces, at most 100). The Logins tab
reads the accounts of the backup with `meta-trader-accounts/get-accounts?logins=`; a login the backup does not know is
still compared. Both pages share `group-compare.js` (tabs, tables, overview); each page only resolves its inputs to the
two login groups.

Every row that names an IP or a CID also carries how many transactions were made from it, filled by the service from
the transaction tracker over the report's date range (all time when none is given): the IP and CID mappings of Login
history and Email logins (`transactionCount`), the CID / IP search summary (`transactionCount`, per login), the
similarity details (`transactionCount`, `relatedTransactionCount`), the shared IPs and CIDs of Compare accounts
(`transactionCount`, `otherTransactionCount`) and of Compare with logins / Compare emails (`mainTransactionCount`,
`otherTransactionCount`, summed over the side's logins). The IP is the one recorded on the transaction; the CID is the
one of the login session that covers the transaction time and, when possible, its IP (the same attribution as the
transactions tab). The counts are sortable, filterable and exported like the other columns.

## Tick monitoring

The panel has two **dashboards**, each with its own home page and menu: **Violation** (`/`, the default) and **Symbols**
(`symbols.html`, everything about the MetaTrader symbols and their ticks). The brand at the top of the sidebar names the
current dashboard and opens the switcher; a dashboard whose pages the account may not open is not listed, and with a single
dashboard the brand is a plain link to its home (`DASHBOARDS` and the `dashboard` of each group in `api.js`). The first
Symbols tool, the **Tick monitoring** page (`tick-monitor.html`, permission `tick-monitor.view`), sends Telegram alarms
when a monitored symbol stops ticking. It needs the MetaTrader connection (`Mt5:Enabled`); nothing else is configured in `appsettings`:
the on/off switch, the Telegram bot token, the operations channel and the limits live in the panel database
(`violation_panel.tick_monitor_settings`) and are changed on the page's Settings tab (`tick-monitor.settings`). A change
to any profile, channel or setting is picked up by the engine within a second; no restart is needed.

- **Profiles** (`tick-monitor.edit`): one per symbol, with time windows in **MetaTrader server time** (days of the week,
  from, to; a window whose end is not after its start crosses midnight). Each window has ordered stages: after N seconds
  without a tick, send to a channel, M times every K seconds. Windows of a profile must not overlap; a moment outside every
  window is not monitored. Options: a "ticks resumed" notice after at least N stages fired, and a quiet period before the
  market closes (off by default). A symbol can be snoozed for 15 to 180 minutes from the Status tab.
- **Channels** (`tick-monitor.channels`): named Telegram chats; each can be tested from the page. A channel in use cannot be deleted.
- **Market closed = nothing is sent.** The engine reads the symbol's quote sessions, its trade mode and the server
  holidays (cached 5 minutes) and cancels every pending message when the market closes. After the market opens, alarms
  wait for the grace period (default 120 seconds) because the first tick is often late.
- **Ticks** come from the Manager API tick subscription (`TickSubscribe` + `SelectedAdd`); `TickLast` seeds the last tick
  after a connection and checks every minute that the subscription is still alive. The engine evaluates every second, so
  repeats every 5 seconds are exact.
- **Service notices** go to the operations channel: MetaTrader connection lost or restored, monitoring started or stopped,
  and a stalled engine. Only one panel instance runs the engine (a PostgreSQL advisory lock); another instance shows "Standby".
- **History** (`violation_panel.tick_monitor_events`): every gap with its start, end, how it ended, the stages fired and
  the messages sent or failed; kept for the configured number of days.
- Alarm texts are English and in UTC. Status, profile and channel changes are written to the audit log.

The design and the behaviour at the edges (window change during a gap, reconnects, snooze) are described in
[`../docs/tick-monitoring-escalation-plan.md`](../docs/tick-monitoring-escalation-plan.md).

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

## Languages (English / Persian)

Every page, help text, message and the sign-in page are available in English and Persian. The globe button in the
menu (and at the top of the sign-in page) switches the language at once, without reloading. The choice is kept in the
browser's local storage, so it belongs to the device; a device without a choice starts in the browser's preferred
language. Persian switches the whole layout to right-to-left; values (logins, IPs, emails, numbers, dates) keep their
own direction, and the charts and time lines still run from left (earlier) to right (later). Excel/CSV downloads made in
the page use the headers of the language shown; the service's own exports keep their English keys.

How it works (`wwwroot/i18n.js`, loaded in every page's `<head>`):

- The pages and scripts are written in English only. `wwwroot/locales/fa.json` is the Persian catalog keyed by the
  English text: `strings` (exact texts; `null` keeps a text in English on purpose), `templates` (texts with values,
  `"Logins of {0} ({1})"`), and `blocks` (help paragraphs with `<strong>`/`<em>`, keyed by their HTML).
- A MutationObserver translates every text, `title`, `placeholder` and `aria-label` as the scripts build the page, and
  restores the English source when the language goes back to English. An element with `translate="no"` (or the
  copyable value cells) is never translated. `t('text')` translates a text that never reaches the page.
- While the Persian catalog loads, the page stays hidden, so English never flashes.

Adding or changing a text: write it in English in the page or script as usual, then add the same text with its Persian
translation to `locales/fa.json` (a text built with values goes under `templates` with `{0}`, `{1}`). To find texts the
catalog misses, set `localStorage['violation-panel-i18n-debug'] = '1'` in the browser console, open the pages, and
run `i18nMissing()`.

## Related pages

Every page that searches a login (Account data, Login history, IP/CID similarity, Copy trade & hedge, Compare accounts,
Position details) shows, once the search has run, a row of buttons that open the same login on the other pages:
Account data, Login history, IP/CID similarity, Copy trade, Hedge (window 5 s, min share 1, hedge tolerance 10 %),
Compare accounts and Compare with logins (main login filled in). The email of the login is read with `meta-trader-accounts/get-accounts` and adds
Email logins and Compare emails (Email A filled in). The email pages (Email logins, Compare emails) show the email
buttons. Only pages the account may open are shown; the links are built in `related-pages.js`.

The "⋯" menu of a table row has the same pages for the row's login, and for its email when the row knows it (Email
logins, Compare emails). On a page that searched a login (IP/CID similarity, Copy trade & hedge) the compare items carry
both sides and the searched day range: Compare accounts and Compare with logins open with the searched login as the
main login and the row's login as the compared one; Compare emails opens with the searched login's email as A and the
row's email as B. The menu items are built when the menu opens, so an email loaded after the table was drawn is included.
