// Compare emails page: the logins of two emails (MetaTrader Manager and archive) are compared by the service through
// their IP and CID mappings. The summary rates the evidence and lists the linked login pairs and the shared IPs and
// CIDs; the details list every session that used a shared value. Sorting, filters and paging are done by the service.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const MAX_LOGINS = 100;
const MAX_LISTED_LOGINS = 6;
const SOURCE_LABELS = { Manager: 'Active', Archive: 'Deleted' };

const EVIDENCE = {
  Strong: { kind: 'danger', text: 'A valid shared CID, or 3 or more shared IPs that are not VPN, proxy, Tor or datacenter.' },
  Medium: { kind: 'warn', text: 'A shared IP that is not VPN, proxy, Tor or datacenter.' },
  Weak: { kind: 'muted', text: 'Only VPN, proxy, Tor or datacenter IPs, or invalid CIDs, are shared.' },
  None: { kind: 'ok', text: 'No IP or CID is shared.' },
};

const rangeControls = initRangeControls(form);

let currentTab = 'summary';
let emails = { main: 'A', other: 'B' };
let sideOf = new Map();
let request = 0;

const loginsCell = logins => {
  const shown = logins.slice(0, MAX_LISTED_LOGINS).map(loginLink);
  const rest = logins.length - shown.length;
  return inline(...shown, ...(rest > 0 ? [`+${rest}`] : []));
};

const accountColumns = [
  { key: 'login', title: 'Login', format: loginLink },
  { key: 'source', title: 'Status', format: source => SOURCE_LABELS[source] ?? source },
  { key: 'name', title: 'Name' },
  { key: 'group', title: 'Group' },
  {
    key: 'balance',
    title: 'Balance',
    format: value => value === null || value === undefined
      ? '—'
      : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
];

const sideColumns = () => [
  { key: 'metric', title: 'Metric' },
  { key: 'main', title: emails.main },
  { key: 'other', title: emails.other },
];

const pairColumns = () => [
  { key: 'login', title: `Login (${emails.main})`, format: loginLink, sortKey: 'Login' },
  { key: 'otherLogin', title: `Login (${emails.other})`, format: loginLink, sortKey: 'OtherLogin' },
  { key: 'sharedIpCount', title: 'Shared IPs', sortKey: 'SharedIpCount' },
  { key: 'sharedCidCount', title: 'Shared CIDs', sortKey: 'SharedCidCount' },
];

// The shared value with, for each email, its logins, sessions and first/last sign-in.
const sharedColumns = (valueTitle, extra) => () => [
  { key: 'value', title: valueTitle, sortKey: 'Value' },
  { key: 'mainLogins', title: 'Logins', group: emails.main, format: loginsCell, sortable: false, filterable: false },
  { key: 'mainSessionCount', title: 'Sessions', group: emails.main, sortKey: 'MainSessionCount' },
  { ...utcColumn('mainFirstSeenUtc', 'First seen'), group: emails.main, sortKey: 'MainFirstSeenUtc' },
  { ...utcColumn('mainLastSeenUtc', 'Last seen'), group: emails.main, sortKey: 'MainLastSeenUtc' },
  { key: 'otherLogins', title: 'Logins', group: emails.other, format: loginsCell, sortable: false, filterable: false },
  { key: 'otherSessionCount', title: 'Sessions', group: emails.other, sortKey: 'OtherSessionCount' },
  { ...utcColumn('otherFirstSeenUtc', 'First seen'), group: emails.other, sortKey: 'OtherFirstSeenUtc' },
  { ...utcColumn('otherLastSeenUtc', 'Last seen'), group: emails.other, sortKey: 'OtherLastSeenUtc' },
  { key: 'overlapsInTime', title: 'Used in the same period', format: yesNo, sortKey: 'OverlapsInTime' },
  ...extra,
  { key: 'totalSessionCount', title: 'Total sessions', sortKey: 'TotalSessionCount' },
];

const ipExtra = [
  { key: 'geo', title: 'Country / city', format: geo => geo ? [geo.country, geo.city].filter(Boolean).join(' / ') : '—', sortable: false, filterable: false },
  { key: 'geo', title: 'Warnings', format: warningBadges, sortable: false, filterable: false },
];

const cidExtra = [
  { key: 'isCidValid', title: 'CID valid', format: yesNo, sortable: false, filterable: false },
  { key: 'platforms', title: 'Platforms', format: platforms => platforms?.join(', ') || '—', sortable: false, filterable: false },
];

const detailColumns = () => [
  {
    key: 'login',
    title: 'Email',
    format: login => sideOf.get(login) === 'main' ? badge(emails.main, 'main') : badge(emails.other, 'compared'),
  },
  { key: 'login', title: 'Login', format: loginLink, sortKey: 'Login' },
  ...SESSION_COLUMNS,
  { key: 'sharedIp', title: 'Shared IP', format: yesNo, sortKey: 'SharedIp' },
  { key: 'sharedCid', title: 'Shared CID', format: yesNo, sortKey: 'SharedCid' },
];

function showTab(tab) {
  currentTab = tab === 'details' ? 'details' : 'summary';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === currentTab);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== currentTab;
}

function writeState(values) {
  writeQuery({ ...values, tab: currentTab });
}

const grids = {
  sessions: createReportGrid({
    path: 'group-compare-reports/get-sessions',
    columns: detailColumns,
    sort: { item: 'LoginAt', direction: 'Desc' },
    containerId: 'sessions',
    pagerId: 'sessions-pager',
    onRowClick: session => renderGeoDetails(document.getElementById('geo-details'), session),
    onRendered: () => document.getElementById('geo-details').replaceChildren(),
  }),
  pairs: createReportGrid({
    path: 'group-compare-reports/get-login-pairs',
    columns: pairColumns,
    sort: { item: 'SharedCidCount', direction: 'Desc' },
    titleId: 'pairs-title',
    title: 'Linked login pairs',
    containerId: 'pairs',
    pagerId: 'pairs-pager',
  }),
  ips: createReportGrid({
    path: 'group-compare-reports/get-shared-ips',
    columns: sharedColumns('IP', ipExtra),
    sort: { item: 'TotalSessionCount', direction: 'Desc' },
    titleId: 'ips-title',
    title: 'Shared IPs',
    containerId: 'ips',
    pagerId: 'ips-pager',
    onRowClick: row => openDetails('Ip', row.value),
  }),
  cids: createReportGrid({
    path: 'group-compare-reports/get-shared-cids',
    columns: sharedColumns('CID', cidExtra),
    sort: { item: 'TotalSessionCount', direction: 'Desc' },
    titleId: 'cids-title',
    title: 'Shared CIDs',
    containerId: 'cids',
    pagerId: 'cids-pager',
    onRowClick: row => openDetails('Cid', row.value),
  }),
};

async function openDetails(column, value) {
  showTab('details');
  writeQuery({ ...Object.fromEntries(new URLSearchParams(location.search)), tab: currentTab });
  try {
    await guarded(document.getElementById('sessions'), () => grids.sessions.filterBy(column, value));
  } catch (error) {
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  }
}

const formatTime = value => value ? formatUtc(value) : '—';
const percent = value => `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

function renderOverview(overview) {
  const { main, other, shared } = overview;
  const evidence = EVIDENCE[shared.evidence] ?? EVIDENCE.None;

  const verdict = document.getElementById('verdict');
  const label = document.createElement('span');
  label.append('Evidence: ', badge(shared.evidence, evidence.kind));
  verdict.replaceChildren(label);
  document.getElementById('verdict-reason').textContent = evidence.text;

  const rows = [
    { metric: 'Logins (with sessions / all)', main: `${main.activeLoginCount} / ${main.loginCount}`, other: `${other.activeLoginCount} / ${other.loginCount}` },
    { metric: 'Sessions', main: main.sessionCount.toLocaleString('en-US'), other: other.sessionCount.toLocaleString('en-US') },
    { metric: 'Distinct IPs', main: main.distinctIpCount, other: other.distinctIpCount },
    { metric: 'Distinct CIDs', main: main.distinctCidCount, other: other.distinctCidCount },
    { metric: 'Shared IPs (share of its IPs)', main: `${shared.ipCount} (${percent(shared.mainIpSharePercent)})`, other: `${shared.ipCount} (${percent(shared.otherIpSharePercent)})` },
    { metric: 'Shared CIDs (share of its CIDs)', main: `${shared.cidCount} (${percent(shared.mainCidSharePercent)})`, other: `${shared.cidCount} (${percent(shared.otherCidSharePercent)})` },
    { metric: 'First login (UTC)', main: formatTime(main.firstLoginAt), other: formatTime(other.firstLoginAt) },
    { metric: 'Last login (UTC)', main: formatTime(main.lastLoginAt), other: formatTime(other.lastLoginAt) },
  ];
  renderTable(document.getElementById('sides'), sideColumns(), rows, undefined, { tools: false });

  renderSummary(document.getElementById('shared-facts'), [
    ['Shared IPs', shared.ipCount],
    ['of them VPN/proxy/Tor/datacenter', shared.anonymizedIpCount],
    ['Shared CIDs', shared.cidCount],
    ['of them invalid', shared.invalidCidCount],
    ['Linked login pairs', shared.linkedLoginPairCount],
    ['Both active together (UTC)', shared.activityOverlapStartUtc
      ? `${formatUtc(shared.activityOverlapStartUtc)} — ${formatUtc(shared.activityOverlapEndUtc)}`
      : 'No common period'],
  ]);
}

function clearResults() {
  for (const grid of Object.values(grids)) grid.clear();
  for (const id of ['verdict', 'sides', 'shared-facts', 'accounts-main', 'accounts-other', 'geo-details'])
    document.getElementById(id).replaceChildren();
  document.getElementById('verdict-reason').textContent = '';
}

function showAccounts(side, email, accounts) {
  renderTable(document.getElementById(`accounts-${side}`), accountColumns, accounts, undefined, { tools: false });
  document.getElementById(`accounts-${side}-title`).textContent = `Logins of ${email} (${accounts.length})`;
}

async function search(values) {
  const current = ++request;
  rangeControls.sync();
  validateRange(values);
  if (values.email.toLowerCase() === values.otherEmail.toLowerCase())
    throw new ApiError('Enter two different emails', { otherEmail: ['Must differ from Email A'] });
  clearResults();

  message.textContent = 'Finding the logins of both emails...';
  const [main, other] = await Promise.all([values.email, values.otherEmail].map(email =>
    panelRequest('GET', `mt5/logins-by-email?email=${encodeURIComponent(email)}`)));
  if (current !== request) return;
  emails = { main: values.email, other: values.otherEmail };
  sideOf = new Map([
    ...main.accounts.map(account => [account.login, 'main']),
    ...other.accounts.map(account => [account.login, 'other']),
  ]);
  writeState(values);

  showAccounts('main', values.email, main.accounts);
  showAccounts('other', values.otherEmail, other.accounts);
  const notes = [];
  if (!main.archiveAvailable || !other.archiveAvailable) notes.push('Deleted accounts could not be read from the MetaTrader archive.');
  for (const [email, found] of [[values.email, main], [values.otherEmail, other]]) {
    if (!found.accounts.length) throw new ApiError([`No login was found for ${email}.`, ...notes].join(' '));
    if (found.accounts.length > MAX_LOGINS)
      throw new ApiError(`${email} has ${found.accounts.length} logins; the comparison takes at most ${MAX_LOGINS} per email.`);
  }
  const mainLogins = new Set(main.accounts.map(account => account.login));
  if (other.accounts.some(account => mainLogins.has(account.login)))
    throw new ApiError('A login belongs to both emails, so they cannot be compared.');

  message.textContent = 'Comparing...';
  const params = {
    logins: main.accounts.map(account => account.login),
    otherLogins: other.accounts.map(account => account.login),
    fromUtc: fromDayParam(values.fromUtc),
    toUtc: toDayParam(values.toUtc),
  };
  const [overview] = await Promise.all([
    apiGet('group-compare-reports/get-overview', params),
    ...Object.values(grids).map(grid => grid.start(params)),
  ]);
  if (current !== request) return;
  renderOverview(overview);
  message.textContent = notes.join(' ');
  if (notes.length) message.className = 'message error';
}

async function submit() {
  const values = formValues(form);
  const submitButton = form.querySelector('button[type="submit"]');
  clearMessages(form, message);
  submitButton.disabled = true;
  try {
    await search(values);
  } catch (error) {
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
}

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (!tab) return;
  showTab(tab);
  if (location.search) writeState(Object.fromEntries(new URLSearchParams(location.search)));
});

form.addEventListener('submit', event => {
  event.preventDefault();
  submit();
});

renderMenu();
showTab(new URLSearchParams(location.search).get('tab'));
const hasQuery = fillFormFromQuery(form);
rangeControls.restore();
if (hasQuery && form.elements.email.value && form.elements.otherEmail.value) submit();
