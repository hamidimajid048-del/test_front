// Email logins page: every login of one email (the users table of the service's MetaTrader backup), then the service's reports for all of
// those logins together. The summary lists the IPs and CIDs per login; the details list every session with its location.
// Sorting, column filters and paging of the three tables are done by the service (report-grid.js).

const form = document.getElementById('filters');
const message = document.getElementById('message');
const MAX_LOGINS = 100;
const ACCOUNT_STATUS_LABELS = { Manager: 'Active', Archive: 'Archived' };

const rangeControls = initRangeControls(form);

let currentTab = 'logins';
let grids = [];
let request = 0;

const actionsColumn = loginActionsColumn('login');

const loginColumn = { key: 'login', title: 'Login', sortKey: 'Login' };


const mappingColumns = (key, title, extra = []) => [
  { key, title, sortKey: title },
  ...extra,
  loginColumn,
  seenColumn('firstSeen', 'lastSeen', 'First / last seen', { sortKey: 'FirstSeen' }),
  { key: 'sessionCount', title: 'Sessions', sortKey: 'SessionCount' },
  { key: 'transactionCount', title: 'Transactions', sortKey: 'TransactionCount', help: 'Transactions the login made from this value in the range. For a CID, the computer of the login session that covers the transaction time and, when possible, its IP.' },
  actionsColumn,
];

const accountColumns = [
  { key: 'login', title: 'Login' },
  { key: 'source', title: 'Status', format: source => badge(ACCOUNT_STATUS_LABELS[source] ?? source, source === 'Manager' ? 'ok' : 'muted') },
  { key: 'name', title: 'Name' },
  { key: 'group', title: 'Group' },
  {
    key: 'balance',
    title: 'Balance',
    format: value => value === null || value === undefined
      ? '—'
      : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  {
    key: 'devices',
    title: 'Devices',
    help: 'The platforms the login signed in with in the date range (Client, Android, iPhone, Web, ...), from its login sessions.',
    format: devices => devices === undefined ? '…' : devices.length ? withSeparators(platformList(devices), ', ') : '—',
    sortValue: row => row.devices?.join(', ') ?? '',
  },
  {
    key: 'cids',
    title: 'Computer IDs',
    help: 'The computer IDs (CID) the login signed in from in the date range, the most used first, with the number of sessions.',
    format: cids => cids === undefined ? '…' : cids.length ? cidList(cids) : '—',
    sortValue: row => row.cids?.length ?? 0,
  },
  actionsColumn,
];

// Puts an unseen separator between the items of a list, so the cell's text (copied or exported) keeps them apart.
function withSeparators(list, separator) {
  [...list.children].slice(1).forEach(item => {
    const gap = document.createElement('span');
    gap.className = 'visually-hidden';
    gap.textContent = separator;
    item.before(gap);
  });
  return list;
}

// One CID per line, copyable, with its session count.
function cidList(cids) {
  const list = document.createElement('div');
  list.className = 'cid-list';
  for (const { cid, sessionCount } of cids) {
    const line = document.createElement('div');
    const count = document.createElement('small');
    count.textContent = ` (${sessionCount.toLocaleString('en-US')})`;
    line.append(copyableText(cid), count);
    list.append(line);
  }
  return withSeparators(list, '; ');
}

// The devices and computer IDs of each login in the range, grouped by the service.
async function readLoginDevices(params) {
  const items = await apiGet('login-reports/get-logins-devices', params);
  return new Map(items.map(item => [item.login, item]));
}

function renderAccounts(accounts) {
  renderTable(document.getElementById('accounts'), accountColumns, accounts, undefined, { export: { name: 'email-logins' } });
}

// Adds the devices and computer IDs to the logins table once the service sends them; the rest of the page does not wait.
async function showLoginDevices(accounts, params, isCurrent) {
  let byLogin;
  try {
    byLogin = await readLoginDevices(params);
  } catch {
    byLogin = new Map();
  }
  if (!isCurrent()) return;
  const sessionsByCid = new Map();
  for (const { cids } of byLogin.values())
    for (const { cid, sessionCount } of cids) sessionsByCid.set(cid, (sessionsByCid.get(cid) ?? 0) + sessionCount);
  renderCidOverview(document.getElementById('cid-overview'), [...sessionsByCid].sort((a, b) => b[1] - a[1]).map(([cid]) => cid));
  renderAccounts(accounts.map(account => {
    const entry = byLogin.get(account.login);
    return { ...account, devices: entry?.devices ?? [], cids: entry?.cids ?? [] };
  }));
}

function showTab(tab) {
  currentTab = ['summary', 'details', 'positions'].includes(tab) ? tab : 'logins';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === currentTab);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== currentTab;
}

function writeState(values) {
  writeQuery({ ...values, tab: currentTab });
}

function clearResults() {
  emailLogins = [];
  positionsGrid.clear();
  document.getElementById('positions-summary').replaceChildren();
  document.querySelector('main.email-history').classList.remove('loaded');
  for (const grid of grids) grid.clear();
  for (const id of ['metadata', 'accounts', 'geo-details', 'cid-overview']) document.getElementById(id).replaceChildren();
  document.getElementById('accounts-title').textContent = 'Logins';
}

async function search(values) {
  const current = ++request;
  rangeControls.sync();
  validateRange(values);
  clearResults();

  message.textContent = 'Finding the logins of the email...';
  const accounts = await apiGet('meta-trader-accounts/get-logins-by-email', { email: values.email });
  if (current !== request) return;
  writeState(values);
  showRelatedPages({ email: values.email });

  if (!accounts.length) {
    renderIconSummary(document.getElementById('metadata'), [['Email', values.email, 'mail'], ['Logins', 0, 'layers']]);
    throw new ApiError('No login was found for this email.');
  }
  renderAccounts(accounts);
  emailLogins = accounts.map(account => account.login);
  document.getElementById('accounts-title').textContent = `Logins (${accounts.length})`;
  document.querySelector('main.email-history').classList.add('loaded');
  if (accounts.length > MAX_LOGINS)
    throw new ApiError(`This email has ${accounts.length} logins; the reports take at most ${MAX_LOGINS}.`);

  message.textContent = 'Loading the reports...';
  const searchParams = {
    logins: accounts.map(account => account.login),
    fromUtc: fromDayParam(values.fromUtc),
    toUtc: toDayParam(values.toUtc),
  };
  showLoginDevices(accounts, searchParams, () => current === request);
  const [sessions] = await Promise.all(grids.map(grid => grid.start(searchParams)));
  if (current !== request) return;

  renderIconSummary(document.getElementById('metadata'), [
    ['Email', values.email, 'mail'],
    ['Range (UTC)', values.fromUtc ? `${values.fromUtc} — ${values.toUtc}` : 'All time', 'calendar'],
    ['Logins', accounts.length, 'layers'],
    ['Sessions', (pagingOf(sessions.paging)?.totalRecords ?? sessions.items.length).toLocaleString('en-US'), 'list'],
  ]);
  message.textContent = '';
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

grids = [
  createReportGrid({
    path: 'login-reports/get-logins-sessions',
    columns: [loginColumn, ...SESSION_COLUMNS, actionsColumn],
    sort: { item: 'LoginAt', direction: 'Desc' },
    containerId: 'sessions',
    pagerId: 'sessions-pager',
    onRowClick: session => renderGeoDetails(document.getElementById('geo-details'), session),
    onRendered: () => document.getElementById('geo-details').replaceChildren(),
  }),
  createReportGrid({
    path: 'login-reports/get-logins-ip-mappings',
    columns: mappingColumns('ip', 'IP'),
    sort: { item: 'SessionCount', direction: 'Desc' },
    titleId: 'ips-title',
    title: 'IP summary',
    containerId: 'ips',
    pagerId: 'ips-pager',
  }),
  createReportGrid({
    path: 'login-reports/get-logins-cid-mappings',
    columns: mappingColumns('cid', 'CID', [{ key: 'deviceType', title: 'Device type', sortKey: 'DeviceType', format: platformList }]),
    sort: { item: 'SessionCount', direction: 'Desc' },
    titleId: 'cids-title',
    title: 'CID summary',
    containerId: 'cids',
    pagerId: 'cids-pager',
  }),
];

// The Positions tab reads only when its own Search is pressed, for its own range of whole UTC days.
const positionsForm = document.getElementById('positions-filters');
const positionsMessage = document.getElementById('positions-message');
const positionsRange = initRangeControls(positionsForm);
let emailLogins = [];
const positionsGrid = createReportGrid({
  path: 'meta-trader-accounts/get-logins-positions',
  columns: loginPositionColumns(),
  sort: { item: 'OpenedAt', direction: 'Desc' },
  titleId: 'positions-title',
  title: 'Positions',
  containerId: 'positions',
  pagerId: 'positions-pager',
  exportName: 'email-positions',
  onRendered: report => renderPositionCounts(report.metadata.logins),
});

// How many positions each login opened in the range (all pages, before the column filters), the total first.
function renderPositionCounts(counts) {
  const total = counts.reduce((sum, count) => sum + count.positionCount, 0);
  renderIconSummary(document.getElementById('positions-summary'), [
    ['Total positions', total.toLocaleString('en-US'), 'bars'],
    ...counts.map(count => [`Login ${count.login}`, count.positionCount.toLocaleString('en-US'), count.positionCount ? 'layers' : 'close']),
  ]);
}

positionsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const values = formValues(positionsForm);
  const submitButton = positionsForm.querySelector('button[type="submit"]');
  clearMessages(positionsForm, positionsMessage);
  submitButton.disabled = true;
  try {
    if (!emailLogins.length) throw new ApiError('Search an email with logins first.');
    validateRange(values);
    setLoading(positionsMessage);
    await positionsGrid.start({ logins: emailLogins, fromUtc: fromDayParam(values.fromUtc), toUtc: toDayParam(values.toUtc) });
    positionsMessage.textContent = '';
  } catch (error) {
    showError(positionsForm, positionsMessage, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
});

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
positionsRange.apply();
showTab(new URLSearchParams(location.search).get('tab'));
const hasQuery = fillFormFromQuery(form);
rangeControls.restore();
if (hasQuery && form.elements.email.value) submit();
