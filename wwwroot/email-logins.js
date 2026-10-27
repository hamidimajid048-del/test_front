// Email logins page: every login of one email (MetaTrader Manager and archive), then the service's reports for all of
// those logins together. The summary lists the IPs and CIDs per login; the details list every session with its location.
// Sorting, column filters and paging of the three tables are done by the service.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const DEFAULT_PAGE_SIZE = 100;
const MAX_LOGINS = 100;
const SOURCE_LABELS = { Manager: 'Active', Archive: 'Deleted' };

const rangeControls = initRangeControls(form);

let currentTab = 'summary';
let grids = [];
let request = 0;

const loginColumn = { key: 'login', title: 'Login', format: loginLink, sortKey: 'Login' };

const mappingColumns = (key, title) => [
  { key, title, sortKey: title },
  loginColumn,
  { ...utcColumn('firstSeen', 'First seen'), sortKey: 'FirstSeen' },
  { ...utcColumn('lastSeen', 'Last seen'), sortKey: 'LastSeen' },
  { key: 'sessionCount', title: 'Sessions', sortKey: 'SessionCount' },
];

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

// A table whose sort, column filters and page are read from one service endpoint for all the logins of the search.
function createGrid({ path, columns, sort, titleId, title, containerId, pagerId, onRowClick, onRendered }) {
  const container = document.getElementById(containerId);
  const pagerContainer = document.getElementById(pagerId);
  const titleElement = titleId ? document.getElementById(titleId) : null;
  let params = null;
  let sortState = { ...sort };
  let filters = {};
  let pageSize = DEFAULT_PAGE_SIZE;

  async function load(page = 1, size = pageSize) {
    pageSize = size;
    const report = await apiGet(path, {
      ...params, sortItem: sortState.item, sortDirection: sortState.direction,
      ...columnFilterParams(filters), currentPage: page, pageSize,
    });
    const paging = pagingOf(report.paging);
    renderTable(container, columns, report.items, onRowClick, {
      sort: {
        item: sortState.item,
        direction: sortState.direction,
        onChange: (item, direction) => {
          sortState = { item, direction };
          return load(1);
        },
      },
      filter: {
        values: filters,
        onChange: values => {
          filters = values;
          return load(1);
        },
      },
    });
    renderPager(pagerContainer, paging, load);
    if (titleElement) titleElement.textContent = `${title} (${(paging?.totalRecords ?? report.items.length).toLocaleString('en-US')})`;
    onRendered?.(report);
    return report;
  }

  return {
    start(searchParams) {
      params = searchParams;
      sortState = { ...sort };
      filters = {};
      return load(1, DEFAULT_PAGE_SIZE);
    },
    clear() {
      clearPager(pagerContainer);
      container.replaceChildren();
      if (titleElement) titleElement.textContent = title;
    },
  };
}

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

  const notes = [];
  if (!found.archiveAvailable) notes.push('Deleted accounts could not be read from the MetaTrader archive.');
  if (!accounts.length) {
    renderSummary(document.getElementById('metadata'), [['Email', values.email], ['Logins', 0]]);
    throw new ApiError(['No login was found for this email.', ...notes].join(' '));
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

grids = [
  createGrid({
    path: 'login-reports/get-logins-sessions',
    columns: [loginColumn, ...SESSION_COLUMNS],
    sort: { item: 'LoginAt', direction: 'Desc' },
    containerId: 'sessions',
    pagerId: 'sessions-pager',
    onRowClick: session => renderGeoDetails(document.getElementById('geo-details'), session),
    onRendered: () => document.getElementById('geo-details').replaceChildren(),
  }),
  createGrid({
    path: 'login-reports/get-logins-ip-mappings',
    columns: mappingColumns('ip', 'IP'),
    sort: { item: 'SessionCount', direction: 'Desc' },
    titleId: 'ips-title',
    title: 'IP summary',
    containerId: 'ips',
    pagerId: 'ips-pager',
  }),
  createGrid({
    path: 'login-reports/get-logins-cid-mappings',
    columns: mappingColumns('cid', 'CID'),
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
