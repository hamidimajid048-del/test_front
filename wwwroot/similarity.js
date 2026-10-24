// Similarity page: logins sharing IP/CID evidence (summary), the shared values with one related login (details),
// and CSV/XLSX exports of both.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const detailsForm = document.getElementById('details-filters');
const detailsMessage = document.getElementById('details-message');
const DEFAULT_PAGE_SIZE = 100;
const DETAILS_QUERY_PREFIX = 'd_';

const COMMON_KEYS = ['type', 'fromUtc', 'toUtc', 'deviceType', 'cid'];
const SUMMARY_KEYS = [
  ...COMMON_KEYS, 'relatedLogin', 'minSharedValueCount',
  'sortItem', 'sortDirection',
];

const TYPE_LABELS = { Ip: 'IP', Cid: 'CID' };

// Filters of the last summary search; the details and exports reuse them so they always match the table shown.
let filters = null;
let summaryPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
let selected = null;
let detailsValues = {};
// Column filters typed under the table headers; the server applies them to every page.
let summaryColumnFilters = {};
let detailsColumnFilters = {};
let detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };

const pick = (source, keys) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));

const rangeControls = initRangeControls(form);

// The account's data range comes from the login sessions report metadata, the only place the service exposes it.
let accountRangeLogin = null;

async function showAccountRange() {
  const login = form.elements.login.value.trim();
  if (login === accountRangeLogin) return;
  accountRangeLogin = login;
  const hint = document.getElementById('account-range');
  if (!login) {
    hint.replaceChildren();
    return;
  }
  hint.textContent = 'Loading the account data range...';
  try {
    const { metadata } = await apiGet('login-reports/get-login-sessions-complete', { login, pageSize: 1 });
    if (login !== accountRangeLogin) return;
    const useRange = document.createElement('button');
    useRange.type = 'button';
    useRange.textContent = 'Use this range';
    useRange.addEventListener('click', () => {
      form.elements.range.value = 'custom';
      rangeControls.sync();
      rangeControls.setRange(toDayValue(new Date(metadata.firstDataTime)), toDayValue(new Date(metadata.lastDataTime)));
    });
    const range = document.createElement('span');
    range.textContent = `${toDayValue(new Date(metadata.firstDataTime))} — ${toDayValue(new Date(metadata.lastDataTime))}`;
    hint.replaceChildren(`Data range of account ${login} (UTC): `, range, useRange);
  } catch (error) {
    if (login !== accountRangeLogin) return;
    hint.textContent = `Account data range: ${error.message || UNAVAILABLE_MESSAGE}`;
  }
}

form.elements.login.addEventListener('change', showAccountRange);

function commonParams() {
  return {
    login: filters.login, ...pick(filters, COMMON_KEYS), fromUtc: fromDayParam(filters.fromUtc), toUtc: toDayParam(filters.toUtc),
  };
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
    ...detailsValues,
    ...columnFilterParams(detailsColumnFilters),
    type: selected.type,
    relatedLogin: selected.relatedLogin,
    currentPage: detailsPaging.currentPage,
    pageSize: detailsPaging.pageSize,
  };
}

function writeState() {
  const state = { ...filters, ...columnFilterState(summaryColumnFilters), currentPage: summaryPaging.currentPage, pageSize: summaryPaging.pageSize };
  if (selected) {
    const prefixed = { ...detailsValues, ...columnFilterState(detailsColumnFilters), relatedLogin: selected.relatedLogin, type: selected.type, ...detailsPaging };
    for (const [key, value] of Object.entries(prefixed)) state[DETAILS_QUERY_PREFIX + key] = value;
  }
  writeQuery(state);
}

function renderMetadata(metadata) {
  const range = metadata.fromUtc
    ? `${toDayValue(new Date(metadata.fromUtc))} — ${toDayValue(new Date(metadata.toUtc))}`
    : 'All time';
  renderSummary(document.getElementById('summary-metadata'), [['Login', metadata.login], ['Range (UTC)', range]]);
}

// The compare page for the searched login and a row's related login, over the same date range and on the tab of
// the row's evidence type.
function compareHref(row) {
  const query = new URLSearchParams({ login: filters.login, other: row.relatedLogin, tab: row.type === 'Cid' ? 'shared-cids' : 'shared-ips' });
  for (const key of ['range', 'fromUtc', 'toUtc']) {
    if (filters[key]) query.set(key, filters[key]);
  }
  return `/compare.html?${query}`;
}

const SUMMARY_COLUMNS = [
  { key: 'relatedLogin', title: 'Related login', format: loginLink, sortKey: 'RelatedLogin' },
  { key: 'type', title: 'Type', format: type => TYPE_LABELS[type] ?? type, sortKey: 'Type' },
  { key: 'sharedValueCount', title: 'Shared values', sortKey: 'SharedValueCount' },
  { key: 'logCount', title: 'Logs', sortKey: 'LogCount' },
  { key: 'relatedLogCount', title: 'Related logs', sortKey: 'RelatedLogCount' },
  {
    key: 'relatedLogin',
    title: 'Actions',
    sortable: false,
    filterable: false,
    format: (login, row) => {
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(
        actionLink('Profile', `/logins.html?login=${encodeURIComponent(login)}`),
        actionLink('Compare', compareHref(row)));
      return actions;
    },
  },
];

const DETAILS_COLUMNS = [
  { key: 'value', title: 'Value', sortKey: 'Value' },
  { key: 'logCount', title: 'Logs', sortKey: 'LogCount' },
  { key: 'relatedLogCount', title: 'Related logs', sortKey: 'RelatedLogCount' },
  { ...utcColumn('firstSeenUtc', 'First seen'), sortKey: 'FirstSeenUtc' },
  { ...utcColumn('lastSeenUtc', 'Last seen'), sortKey: 'LastSeenUtc' },
  { ...utcColumn('relatedFirstSeenUtc', 'Related first seen'), sortKey: 'RelatedFirstSeenUtc' },
  { ...utcColumn('relatedLastSeenUtc', 'Related last seen'), sortKey: 'RelatedLastSeenUtc' },
];

async function loadSummary() {
  const report = await apiGet('similarity-reports/get-summary', summaryParams());
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
  document.getElementById('summary-section').hidden = false;
  writeState();
}

async function loadDetails() {
  const report = await apiGet('similarity-reports/get-details', detailsParams());
  const paging = pagingOf(report.paging);
  detailsPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? detailsPaging.pageSize };
  renderTable(document.getElementById('details'), DETAILS_COLUMNS, report.items, undefined, {
    sort: {
      item: detailsValues.sortItem,
      direction: detailsValues.sortDirection,
      onChange: (item, direction) => {
        setSortFields(detailsForm, item, direction);
        detailsValues = { ...detailsValues, sortItem: item, sortDirection: direction };
        detailsPaging = { currentPage: 1, pageSize: detailsPaging.pageSize };
        return withLoading(detailsForm, detailsMessage, loadDetails);
      },
    },
    filter: {
      values: detailsColumnFilters,
      onChange: values => {
        detailsColumnFilters = values;
        detailsPaging = { currentPage: 1, pageSize: detailsPaging.pageSize };
        return withLoading(detailsForm, detailsMessage, loadDetails);
      },
    },
  });
  renderPager(document.getElementById('details-pager'), paging, (page, pageSize) => {
    detailsPaging = { currentPage: page, pageSize };
    return withLoading(detailsForm, detailsMessage, loadDetails);
  });
  writeState();
}

function showDetailsSection() {
  document.getElementById('details-title').textContent =
    `Details: ${filters.login} and ${selected.relatedLogin} (${TYPE_LABELS[selected.type] ?? selected.type})`;
  const section = document.getElementById('details-section');
  section.hidden = false;
  return section;
}

function openDetails(row) {
  selected = { relatedLogin: row.relatedLogin, type: row.type };
  detailsForm.reset();
  detailsValues = {};
  detailsColumnFilters = {};
  detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
  document.getElementById('details').replaceChildren();
  clearPager(document.getElementById('details-pager'));
  document.getElementById('details-export-message').textContent = '';
  showDetailsSection().scrollIntoView({ behavior: 'smooth', block: 'start' });
  withLoading(detailsForm, detailsMessage, loadDetails);
}

function hideDetails() {
  selected = null;
  document.getElementById('details-section').hidden = true;
}

document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.export;
  const { currentPage, pageSize, ...params } = kind === 'summary' ? summaryParams() : detailsParams();
  downloadExport(
    `similarity-reports/export-${kind}`,
    { ...params, format: button.dataset.format },
    button,
    document.getElementById(`${kind}-export-message`));
}));

form.addEventListener('submit', event => {
  event.preventDefault();
  showAccountRange();
  withLoading(form, message, async () => {
    const values = formValues(form);
    validateRange(values);
    filters = values;
    summaryColumnFilters = {};
    summaryPaging = { currentPage: 1, pageSize: summaryPaging.pageSize };
    hideDetails();
    await loadSummary();
  });
});

detailsForm.addEventListener('submit', event => {
  event.preventDefault();
  detailsValues = formValues(detailsForm);
  detailsPaging = { currentPage: 1, pageSize: detailsPaging.pageSize };
  withLoading(detailsForm, detailsMessage, loadDetails);
});

// Restores a shared or refreshed report link.
async function restoreFromQuery() {
  if (!fillFormFromQuery(form) || !form.elements.login.value) return;
  rangeControls.restore();
  showAccountRange();
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

  const relatedLogin = query.get(`${DETAILS_QUERY_PREFIX}relatedLogin`);
  const type = query.get(`${DETAILS_QUERY_PREFIX}type`);
  if (!relatedLogin || !type || document.getElementById('summary-section').hidden) return;
  selected = { relatedLogin, type };
  for (const element of detailsForm.elements) {
    const value = element.name && queryValue(query, DETAILS_QUERY_PREFIX + element.name);
    if (value) element.value = value;
  }
  detailsValues = formValues(detailsForm);
  detailsColumnFilters = readColumnFilters(query, DETAILS_QUERY_PREFIX);
  detailsPaging = {
    currentPage: Number(query.get(`${DETAILS_QUERY_PREFIX}currentPage`)) || 1,
    pageSize: Number(query.get(`${DETAILS_QUERY_PREFIX}pageSize`)) || DEFAULT_PAGE_SIZE,
  };
  showDetailsSection();
  await withLoading(detailsForm, detailsMessage, loadDetails);
}

renderMenu();
rangeControls.sync();
restoreFromQuery();
