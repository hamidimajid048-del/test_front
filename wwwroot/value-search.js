// CID/IP search page: every login that used one exact value (summary), its individual sessions (details), and
// CSV/XLSX exports of both. Sessions reuse the session table columns shared with the login history page.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const detailsMessage = document.getElementById('details-message');
const DEFAULT_PAGE_SIZE = 1000;
const DETAILS_QUERY_PREFIX = 'd_';

const COMMON_KEYS = ['type', 'value', 'fromUtc', 'toUtc'];
const SUMMARY_KEYS = [...COMMON_KEYS, 'sortItem', 'sortDirection'];

const TYPE_LABELS = { Ip: 'IP', Cid: 'CID' };

const pick = (source, keys) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));

// Filters of the last search; the details and exports reuse them so they always match the table shown.
let filters = null;
let summaryPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
let summaryColumnFilters = {};
let summaryLoaded = false;
let currentTab = 'summary';
let detailsOpen = false;
let detailsSort = {};
let detailsColumnFilters = {};
let detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };

function showTab(tab) {
  currentTab = tab === 'details' ? 'details' : 'summary';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === currentTab);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== currentTab;
}

const rangeControls = initRangeControls(form);

function commonParams() {
  return { ...pick(filters, COMMON_KEYS), fromUtc: fromDayParam(filters.fromUtc), toUtc: toDayParam(filters.toUtc) };
}

function summaryParams() {
  return {
    ...pick(filters, SUMMARY_KEYS),
    ...commonParams(),
    ...columnFilterParams(summaryColumnFilters),
    currentPage: summaryPaging.currentPage,
    pageSize: summaryPaging.pageSize,
  };
}

function detailsParams() {
  return {
    ...commonParams(),
    ...detailsSort,
    ...columnFilterParams(detailsColumnFilters),
    currentPage: detailsPaging.currentPage,
    pageSize: detailsPaging.pageSize,
  };
}

function writeState() {
  const state = {
    ...filters, ...columnFilterState(summaryColumnFilters),
    currentPage: summaryPaging.currentPage, pageSize: summaryPaging.pageSize,
    tab: currentTab,
  };
  if (detailsOpen) {
    const prefixed = { ...detailsSort, ...columnFilterState(detailsColumnFilters), ...detailsPaging };
    for (const [key, value] of Object.entries(prefixed)) state[DETAILS_QUERY_PREFIX + key] = value;
  }
  writeQuery(state);
}

// ---- Overview: who used the searched value, from which devices, and how the accounts stand ----

const DAY_MS = 24 * 60 * 60 * 1000;
const number = value => Number(value ?? 0).toLocaleString('en-US');
const money = value => Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function element(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.filter(child => child !== null && child !== undefined));
  return node;
}

function kpi(iconName, label, value, ...notes) {
  return element('div', 'vs-kpi',
    icon(iconName, 'vs-kpi-icon'),
    element('div', 'vs-kpi-text', element('span', 'vs-kpi-label', label), element('strong', 'vs-kpi-value', value),
      notes.length ? element('small', 'vs-kpi-note', ...notes) : null));
}

function panel(iconName, title, ...content) {
  return element('div', 'vs-panel', element('h3', 'vs-panel-title', icon(iconName), title), ...content);
}

function emptyNote() {
  return element('p', 'vs-empty', 'No data');
}

// Sessions per kind of device (Android, iOS, desktop, web), each with its share of all the sessions on the value.
function devicePanel(devices) {
  const kinds = new Map();
  for (const { name, count } of devices) {
    const kind = platformKind(name) ?? 'other';
    const entry = kinds.get(kind) ?? { count: 0, names: [] };
    entry.count += count;
    entry.names.push(name);
    kinds.set(kind, entry);
  }
  const total = [...kinds.values()].reduce((sum, entry) => sum + entry.count, 0);
  const rows = [...kinds].sort((a, b) => b[1].count - a[1].count).map(([kind, { count, names }]) => {
    const share = total ? (count / total) * 100 : 0;
    const bar = element('span', `vs-bar ${kind}`);
    bar.style.width = `${Math.max(share, 2)}%`;
    const row = element('div', 'vs-device',
      kind === 'other' ? element('span', 'vs-device-icon') : element('span', 'vs-device-icon', platformIcon(kind)),
      element('span', 'vs-device-name', kind === 'other' ? 'Other' : PLATFORM_KINDS[kind].label),
      element('span', 'vs-device-count', number(count), element('small', null, ` ${share.toFixed(share < 10 ? 1 : 0)}%`)),
      element('span', 'vs-track', bar));
    row.title = names.join(', ');
    return row;
  });
  return panel('monitor', 'Devices', ...(rows.length ? rows : [emptyNote()]));
}

// The emails of the logins, the most shared first; an email used by several logins is the strongest hint.
function emailPanel(overview) {
  const rows = overview.emails.map(({ name, count }) => element('li', count > 1 ? 'shared' : null,
    element('span', 'vs-email', copyableText(name)), element('span', 'vs-count', number(count))));
  const rest = overview.emailCount - overview.emails.length;
  return panel('mail', 'Emails',
    rows.length ? element('ul', 'vs-list', ...rows) : emptyNote(),
    rest > 0 ? element('p', 'vs-more', `+${number(rest)} more`) : null);
}

function accountPanel(overview) {
  const states = [
    ['ok', 'Active', overview.activeCount],
    ['warn', 'Archived', overview.archivedCount],
    ['muted', 'Not found', overview.notFoundCount],
  ];
  const total = states.reduce((sum, [, , count]) => sum + count, 0);
  const bar = element('div', 'vs-status-bar');
  const legend = element('div', 'vs-status-legend');
  for (const [tone, label, count] of states) {
    if (count) {
      const part = element('span', tone);
      part.style.flexGrow = String(count);
      part.title = label;
      bar.append(part);
    }
    legend.append(element('span', `vs-legend ${tone}`, label, element('b', null, number(count))));
  }
  const groups = overview.groups.map(({ name, count }) => element('li', null, element('span', 'vs-email', name), element('span', 'vs-count', number(count))));
  return panel('shield', 'Accounts',
    total ? bar : null, legend,
    element('h4', 'vs-subtitle', 'Groups'),
    groups.length ? element('ul', 'vs-list', ...groups) : emptyNote());
}

function renderOverview(metadata) {
  const container = document.getElementById('overview');
  const overview = metadata.overview;
  if (!overview) {
    container.replaceChildren();
    return;
  }
  const range = metadata.fromUtc
    ? `${toDayValue(new Date(metadata.fromUtc))} — ${toDayValue(new Date(metadata.toUtc))}`
    : 'All time';
  const value = copyableText(metadata.value);
  value.dir = 'ltr';
  const head = element('div', 'vs-overview-head',
    element('span', 'vs-type', icon(metadata.type === 'Ip' ? 'mapPin' : 'fingerprint'), TYPE_LABELS[metadata.type] ?? metadata.type),
    element('div', 'vs-overview-title', element('h2', null, value), element('p', null, element('span', null, 'Range (UTC)'), ': ', range)));

  const first = overview.firstSeenUtc ? new Date(overview.firstSeenUtc) : null;
  const last = overview.lastSeenUtc ? new Date(overview.lastSeenUtc) : null;
  const days = first && last ? Math.max(1, Math.ceil((last - first) / DAY_MS)) : 0;
  const perLogin = overview.loginCount ? Math.round(overview.sessionCount / overview.loginCount) : 0;
  const kpis = element('div', 'vs-kpis',
    kpi('users', 'Unique logins', number(overview.loginCount),
      element('span', 'ok', number(overview.activeCount), ' ', 'Active'), ' · ',
      element('span', 'warn', number(overview.archivedCount), ' ', 'Archived')),
    kpi('mail', 'Unique emails', number(overview.emailCount)),
    kpi('history', 'Sign-ins', number(overview.sessionCount), '≈ ', number(perLogin), ' ', 'per login'),
    kpi('swap', 'Transactions', number(overview.transactionCount)),
    kpi('wallet', 'Total balance', money(overview.balanceTotal)),
    kpi('calendar', 'Activity', days ? element('span', null, number(days), ' ', 'days') : '—',
      first ? element('span', null, toDayValue(first), ' — ', toDayValue(last)) : null));

  container.replaceChildren(head, kpis,
    element('div', 'vs-panels', devicePanel(overview.devices), emailPanel(overview), accountPanel(overview)));
}

const SUMMARY_COLUMNS = [
  { key: 'login', title: 'Login', sortKey: 'Login' },
  ...accountColumns(),
  { key: 'loginCount', title: 'Logins', sortKey: 'LoginCount' },
  { key: 'transactionCount', title: 'Transactions', sortKey: 'TransactionCount', help: 'Transactions this login made from the searched value in the range. For a CID, the computer of the login session that covers the transaction time and, when possible, its IP.' },
  seenColumn('firstSeenUtc', 'lastSeenUtc', 'First / last seen', { sortKey: 'FirstSeenUtc' }),
  loginActionsColumn('login'),
];

// The session columns shared with the login history page, with the login prepended since rows here span many logins.
const DETAILS_COLUMNS = [
  { key: 'login', title: 'Login', sortKey: 'Login' },
  { key: 'email', title: 'Email', format: email => email || '—', sortKey: 'Email' },
  ...SESSION_COLUMNS,
  loginActionsColumn('login'),
];

async function withDetailsLoading(load) {
  detailsMessage.className = 'message';
  detailsMessage.textContent = 'Loading...';
  try {
    await load();
    detailsMessage.textContent = '';
  } catch (error) {
    detailsMessage.className = 'message error';
    detailsMessage.textContent = error instanceof ApiError ? error.message : UNAVAILABLE_MESSAGE;
  }
}

async function loadSummary() {
  const report = await apiGet('value-search/get-summary', summaryParams());
  const paging = pagingOf(report.paging);
  summaryPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? summaryPaging.pageSize };
  renderOverview(report.metadata);
  renderTable(document.getElementById('summary'), SUMMARY_COLUMNS, report.items, openDetails, {
    sort: {
      item: filters.sortItem,
      direction: filters.sortDirection,
      onChange: (item, direction) => {
        setSortFields(form, item, direction);
        filters = { ...filters, sortItem: item, sortDirection: direction };
        summaryPaging = { currentPage: 1, pageSize: summaryPaging.pageSize };
        return withLoading(form, message, loadSummary);
      },
    },
    filter: {
      values: summaryColumnFilters,
      onChange: values => {
        summaryColumnFilters = values;
        summaryPaging = { currentPage: 1, pageSize: summaryPaging.pageSize };
        return withLoading(form, message, loadSummary);
      },
    },
  });
  renderPager(document.getElementById('summary-pager'), paging, (page, pageSize) => {
    summaryPaging = { currentPage: page, pageSize };
    return withLoading(form, message, loadSummary);
  });
  summaryLoaded = true;
  document.querySelector('main.value-search').classList.add('loaded');
  writeState();
}

async function loadDetails() {
  const report = await apiGet('value-search/get-details', detailsParams());
  const paging = pagingOf(report.paging);
  detailsPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? detailsPaging.pageSize };
  renderTable(
    document.getElementById('details'), DETAILS_COLUMNS, report.items,
    session => renderGeoDetails(document.getElementById('geo-details'), session), {
      sort: {
        item: detailsSort.sortItem,
        direction: detailsSort.sortDirection,
        onChange: (item, direction) => {
          detailsSort = { sortItem: item, sortDirection: direction };
          detailsPaging = { currentPage: 1, pageSize: detailsPaging.pageSize };
          return withDetailsLoading(loadDetails);
        },
      },
      filter: {
        values: detailsColumnFilters,
        onChange: values => {
          detailsColumnFilters = values;
          detailsPaging = { currentPage: 1, pageSize: detailsPaging.pageSize };
          return withDetailsLoading(loadDetails);
        },
      },
    });
  renderPager(document.getElementById('details-pager'), paging, (page, pageSize) => {
    detailsPaging = { currentPage: page, pageSize };
    return withDetailsLoading(loadDetails);
  });
  writeState();
}

function setDetailsTitle(login) {
  document.getElementById('details-title').textContent = login
    ? `Sessions: login ${login} on ${TYPE_LABELS[filters.type] ?? filters.type} ${filters.value}`
    : `Sessions: every login on ${TYPE_LABELS[filters.type] ?? filters.type} ${filters.value}`;
}

function openDetailsWith(columnFilters, login) {
  detailsOpen = true;
  detailsColumnFilters = columnFilters;
  detailsSort = {};
  detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
  document.getElementById('details').replaceChildren();
  clearPager(document.getElementById('details-pager'));
  document.getElementById('details-export-message').textContent = '';
  document.getElementById('geo-details').replaceChildren();
  setDetailsTitle(login);
  showTab('details');
  withDetailsLoading(loadDetails);
}

// Clicking a summary row drills into that login's own sessions on the searched value (an exact filter, so a
// login like 12 never also matches 123).
function openDetails(row) {
  openDetailsWith({ login: `=${row.login}` }, row.login);
}

// Every session of every login that used the value, with no login filter at all.
function openAllDetails() {
  openDetailsWith({}, null);
}

function hideDetails() {
  detailsOpen = false;
  document.getElementById('details').replaceChildren();
  clearPager(document.getElementById('details-pager'));
  document.getElementById('geo-details').replaceChildren();
}

document.getElementById('view-all-sessions').addEventListener('click', openAllDetails);

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (!tab || tab === currentTab) return;
  // Opening Details for the first time (no row clicked yet) defaults to every session of every login.
  if (tab === 'details' && !detailsOpen && filters) openAllDetails();
  else showTab(tab);
  writeState();
});

document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.export;
  const { currentPage, pageSize, ...params } = kind === 'summary' ? summaryParams() : detailsParams();
  downloadExport(
    `value-search/export-${kind}`,
    { ...params, format: button.dataset.format },
    button,
    document.getElementById(`${kind}-export-message`));
}));

form.addEventListener('submit', event => {
  event.preventDefault();
  withLoading(form, message, async () => {
    const values = formValues(form);
    validateRange(values);
    filters = values;
    summaryColumnFilters = {};
    summaryPaging = { currentPage: 1, pageSize: summaryPaging.pageSize };
    hideDetails();
    showTab('summary');
    await loadSummary();
  });
});

// Restores a shared or refreshed report link.
async function restoreFromQuery() {
  if (!fillFormFromQuery(form) || !form.elements.value.value) return;
  rangeControls.restore();
  const query = new URLSearchParams(location.search);
  filters = formValues(form);
  summaryColumnFilters = readColumnFilters(query);
  summaryPaging = {
    currentPage: Number(query.get('currentPage')) || 1,
    pageSize: Number(query.get('pageSize')) || DEFAULT_PAGE_SIZE,
  };
  await withLoading(form, message, async () => {
    validateRange(filters);
    await loadSummary();
  });

  if (query.get('tab') !== 'details' || !summaryLoaded) return;
  detailsOpen = true;
  detailsColumnFilters = readColumnFilters(query, DETAILS_QUERY_PREFIX);
  detailsSort = {
    sortItem: queryValue(query, `${DETAILS_QUERY_PREFIX}sortItem`) || undefined,
    sortDirection: queryValue(query, `${DETAILS_QUERY_PREFIX}sortDirection`) || undefined,
  };
  detailsPaging = {
    currentPage: Number(query.get(`${DETAILS_QUERY_PREFIX}currentPage`)) || 1,
    pageSize: Number(query.get(`${DETAILS_QUERY_PREFIX}pageSize`)) || DEFAULT_PAGE_SIZE,
  };
  const loginFilter = detailsColumnFilters.login;
  setDetailsTitle(loginFilter ? loginFilter.replace(/^[<>=]+/, '') : null);
  showTab('details');
  await withDetailsLoading(loadDetails);
}

renderMenu();
rangeControls.sync();
restoreFromQuery();
