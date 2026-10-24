// CID/IP search page: every login that used one exact value (summary), its individual sessions (details), and
// CSV/XLSX exports of both. Sessions reuse the session table columns shared with the login history page.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const detailsMessage = document.getElementById('details-message');
const DEFAULT_PAGE_SIZE = 100;
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

function renderMetadata(metadata) {
  const range = metadata.fromUtc
    ? `${toDayValue(new Date(metadata.fromUtc))} — ${toDayValue(new Date(metadata.toUtc))}`
    : 'All time';
  renderSummary(document.getElementById('summary-metadata'), [
    ['Type', TYPE_LABELS[metadata.type] ?? metadata.type],
    ['Value', metadata.value],
    ['Range (UTC)', range],
  ]);
}

const SUMMARY_COLUMNS = [
  { key: 'login', title: 'Login', format: loginLink, sortKey: 'Login' },
  { key: 'loginCount', title: 'Logins', sortKey: 'LoginCount' },
  { ...utcColumn('firstSeenUtc', 'First seen'), sortKey: 'FirstSeenUtc' },
  { ...utcColumn('lastSeenUtc', 'Last seen'), sortKey: 'LastSeenUtc' },
  {
    key: 'login',
    title: 'Actions',
    sortable: false,
    filterable: false,
    format: login => {
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(actionLink('Profile', `/logins.html?login=${encodeURIComponent(login)}`));
      return actions;
    },
  },
];

// The session columns shared with the login history page, with the login prepended since rows here span many logins.
const DETAILS_COLUMNS = [
  { key: 'login', title: 'Login', format: loginLink, sortKey: 'Login' },
  ...SESSION_COLUMNS,
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
  renderMetadata(report.metadata);
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
