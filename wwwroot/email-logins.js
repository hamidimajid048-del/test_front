// Email logins page: every login of one email (MetaTrader Manager and archive), then the service's reports for all of
// those logins together. The summary lists the IPs and CIDs per login; the details list every session with its location.
// Sorting, column filters and paging of the three tables are done by the service (report-grid.js).

const form = document.getElementById('filters');
const message = document.getElementById('message');
const MAX_LOGINS = 100;
const SOURCE_LABELS = { Manager: 'Active', Archive: 'Deleted' };

const rangeControls = initRangeControls(form);

let currentTab = 'logins';
let grids = [];
let request = 0;

const inNewTab = link => {
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
};

const loginTabLink = login => inNewTab(loginLink(login));

const loginActions = login => inline(
  inNewTab(actionLink('Login history', `/logins.html?login=${encodeURIComponent(login)}`)),
  inNewTab(actionLink('Similarity', `/similarity.html?login=${encodeURIComponent(login)}`)));

const actionsColumn = { key: 'login', title: 'Actions', format: loginActions, sortable: false, filterable: false };

const loginColumn = { key: 'login', title: 'Login', format: loginTabLink, sortKey: 'Login' };

const mappingColumns = (key, title, extra = []) => [
  { key, title, sortKey: title },
  ...extra,
  loginColumn,
  seenColumn('firstSeen', 'lastSeen', 'First / last seen', { sortKey: 'FirstSeen' }),
  { key: 'sessionCount', title: 'Sessions', sortKey: 'SessionCount' },
  actionsColumn,
];

const accountColumns = [
  { key: 'login', title: 'Login', format: loginTabLink },
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
  actionsColumn,
];

function showTab(tab) {
  currentTab = ['summary', 'details'].includes(tab) ? tab : 'logins';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === currentTab);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== currentTab;
}

function writeState(values) {
  writeQuery({ ...values, tab: currentTab });
}

function clearResults() {
  for (const grid of grids) grid.clear();
  for (const id of ['metadata', 'accounts', 'geo-details']) document.getElementById(id).replaceChildren();
  document.getElementById('accounts-title').textContent = 'Logins';
}

async function search(values) {
  const current = ++request;
  rangeControls.sync();
  validateRange(values);
  clearResults();

  message.textContent = 'Finding the logins of the email...';
  const found = await panelRequest('GET', `mt5/logins-by-email?email=${encodeURIComponent(values.email)}`);
  if (current !== request) return;
  const accounts = found.accounts;
  writeState(values);

  if (!accounts.length) {
    renderSummary(document.getElementById('metadata'), [['Email', values.email], ['Logins', 0]]);
    throw new ApiError('No login was found for this email.');
  }
  renderTable(document.getElementById('accounts'), accountColumns, accounts);
  document.getElementById('accounts-title').textContent = `Logins (${accounts.length})`;
  if (accounts.length > MAX_LOGINS)
    throw new ApiError(`This email has ${accounts.length} logins; the reports take at most ${MAX_LOGINS}.`);

  message.textContent = 'Loading the reports...';
  const searchParams = {
    logins: accounts.map(account => account.login),
    fromUtc: fromDayParam(values.fromUtc),
    toUtc: toDayParam(values.toUtc),
  };
  const [sessions] = await Promise.all(grids.map(grid => grid.start(searchParams)));
  if (current !== request) return;

  renderSummary(document.getElementById('metadata'), [
    ['Email', values.email],
    ['Range (UTC)', values.fromUtc ? `${values.fromUtc} — ${values.toUtc}` : 'All time'],
    ['Logins', accounts.length],
    ['Sessions', (pagingOf(sessions.paging)?.totalRecords ?? sessions.items.length).toLocaleString('en-US')],
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
    columns: [loginColumn, ...SESSION_COLUMNS],
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
    columns: mappingColumns('cid', 'CID', [{ key: 'deviceType', title: 'Device type', sortKey: 'DeviceType' }]),
    sort: { item: 'SessionCount', direction: 'Desc' },
    titleId: 'cids-title',
    title: 'CID summary',
    containerId: 'cids',
    pagerId: 'cids-pager',
  }),
];

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
if (hasQuery && form.elements.email.value) submit();
