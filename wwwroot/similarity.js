// Similarity page: logins sharing IP/CID evidence (summary), the shared values with one related login (details),
// and CSV/XLSX exports of both.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const detailsForm = document.getElementById('details-filters');
const detailsMessage = document.getElementById('details-message');
const DEFAULT_PAGE_SIZE = 100;
const DETAILS_QUERY_PREFIX = 'd_';

const COMMON_KEYS = ['type', 'fromUtc', 'toUtc', 'country', 'city', 'isp', 'asn', 'deviceType', 'cid'];
const SUMMARY_KEYS = [
  ...COMMON_KEYS, 'relatedLogin', 'minSharedValueCount', 'minEffectiveRepeatCount', 'minOccurrenceDays',
  'minCoOccurrenceDays', 'sortBy', 'sortDirection',
];

const TYPE_LABELS = { Ip: 'IP', Cid: 'CID' };

// Filters of the last summary search; the details and exports reuse them so they always match the table shown.
let filters = null;
let summaryPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
let selected = null;
let detailsValues = {};
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
    const { metadata } = await apiGet(`reports/logins/${login}/complete`, { pageSize: 1 });
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
  return { ...pick(filters, COMMON_KEYS), fromUtc: fromDayParam(filters.fromUtc), toUtc: toDayParam(filters.toUtc) };
}

function summaryParams() {
  return {
    ...pick(filters, SUMMARY_KEYS),
    ...commonParams(),
    currentPage: summaryPaging.currentPage,
    pageSize: summaryPaging.pageSize,
  };
}

function detailsParams() {
  return {
    ...commonParams(),
    ...detailsValues,
    type: selected.type,
    relatedLogin: selected.relatedLogin,
    currentPage: detailsPaging.currentPage,
    pageSize: detailsPaging.pageSize,
  };
}

function writeState() {
  const state = { ...filters, currentPage: summaryPaging.currentPage, pageSize: summaryPaging.pageSize };
  if (selected) {
    const prefixed = { ...detailsValues, relatedLogin: selected.relatedLogin, type: selected.type, ...detailsPaging };
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
  { key: 'relatedLogin', title: 'Related login', format: loginLink },
  { key: 'type', title: 'Type', format: type => TYPE_LABELS[type] ?? type },
  { key: 'sharedValueCount', title: 'Shared values' },
  { key: 'effectiveRepeatCount', title: 'Effective repeats' },
  { key: 'occurrenceDays', title: 'Occurrence days' },
  { key: 'coOccurrenceDays', title: 'Co-occurrence days' },
  {
    key: 'relatedLogin',
    title: 'Actions',
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
  { key: 'value', title: 'Value' },
  { key: 'logCount', title: 'Logs' },
  { key: 'relatedLogCount', title: 'Related logs' },
  { key: 'effectiveRepeatCount', title: 'Effective repeats' },
  utcColumn('firstSeenUtc', 'First seen'),
  utcColumn('lastSeenUtc', 'Last seen'),
  utcColumn('relatedFirstSeenUtc', 'Related first seen'),
  utcColumn('relatedLastSeenUtc', 'Related last seen'),
  { key: 'occurrenceDays', title: 'Occurrence days' },
  { key: 'coOccurrenceDays', title: 'Co-occurrence days' },
];

async function loadSummary() {
  const report = await apiGet(`reports/similarity/${filters.login}/summary`, summaryParams());
  const paging = report.paging?.normalPagingResponse;
  summaryPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? summaryPaging.pageSize };
  renderMetadata(report.metadata);
  renderTable(document.getElementById('summary'), SUMMARY_COLUMNS, report.items, openDetails);
  renderPager(document.getElementById('summary-pager'), paging, (page, pageSize) => {
    summaryPaging = { currentPage: page, pageSize };
    withLoading(form, message, loadSummary);
  });
  document.getElementById('summary-section').hidden = false;
  writeState();
}

async function loadDetails() {
  const report = await apiGet(`reports/similarity/${filters.login}/details`, detailsParams());
  const paging = report.paging?.normalPagingResponse;
  detailsPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? detailsPaging.pageSize };
  renderTable(document.getElementById('details'), DETAILS_COLUMNS, report.items);
  renderPager(document.getElementById('details-pager'), paging, (page, pageSize) => {
    detailsPaging = { currentPage: page, pageSize };
    withLoading(detailsForm, detailsMessage, loadDetails);
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
  detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
  document.getElementById('details').replaceChildren();
  document.getElementById('details-pager').replaceChildren();
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
    `reports/similarity/${filters.login}/${kind}/export`,
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
    const value = element.name && query.get(DETAILS_QUERY_PREFIX + element.name);
    if (value) element.value = value;
  }
  detailsValues = formValues(detailsForm);
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
