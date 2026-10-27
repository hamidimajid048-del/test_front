// Similarity page: logins sharing IP/CID evidence (summary), the shared values with one related login (details, one
// tab per related login and evidence type), and CSV/XLSX exports of both.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const summarySection = document.getElementById('summary-section');
const tabsBar = document.getElementById('tabs');
const detailsTemplate = document.getElementById('details-template');
const DEFAULT_PAGE_SIZE = 100;
// Older links carried the details of one account under this prefix.
const LEGACY_DETAILS_PREFIX = 'd_';
const SUMMARY_TAB = 'summary';

const COMMON_KEYS = ['type', 'fromUtc', 'toUtc', 'deviceType', 'cid'];
const SUMMARY_KEYS = [
  ...COMMON_KEYS, 'relatedLogin',
  'sortItem', 'sortDirection',
];

const TYPE_LABELS = { Ip: 'IP', Cid: 'CID' };

// Filters of the last summary search; the details and exports reuse them so they always match the table shown.
let filters = null;
let summaryPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
// Column filters typed under the table headers; the server applies them to every page.
let summaryColumnFilters = {};
// The details tabs opened from the summary, by "Type:login"; an account already open is selected, not opened twice.
const detailsTabs = new Map();
let activeTab = SUMMARY_TAB;

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

function writeState() {
  const state = { ...filters, ...columnFilterState(summaryColumnFilters), currentPage: summaryPaging.currentPage, pageSize: summaryPaging.pageSize };
  if (detailsTabs.size) {
    state.tabs = [...detailsTabs.keys()].join(',');
    if (activeTab !== SUMMARY_TAB) state.tab = activeTab;
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

const accountsDirectory = createAccountDirectory(document.getElementById('accounts-message'));
let hideSameEmail = false;
const differentEmailButton = document.getElementById('different-email');

const normalizedEmail = account => (account?.email ?? '').trim().toLowerCase();

function applyEmailFilter() {
  const mainEmail = normalizedEmail(accountsDirectory.get(Number(filters.login)));
  for (const { cell, login } of accountsDirectory.emailCells()) {
    const row = cell.closest('tr');
    if (row) row.hidden = hideSameEmail && mainEmail !== '' && normalizedEmail(accountsDirectory.get(login)) === mainEmail;
  }
}

differentEmailButton.addEventListener('click', () => {
  hideSameEmail = !hideSameEmail;
  differentEmailButton.setAttribute('aria-pressed', String(hideSameEmail));
  applyEmailFilter();
});

async function loadAccounts(items) {
  if (!items.length) return;
  await accountsDirectory.load([Number(filters.login), ...items.map(item => item.relatedLogin)]);
  const mainKnown = normalizedEmail(accountsDirectory.get(Number(filters.login))) !== '';
  differentEmailButton.disabled = !mainKnown;
  if (!mainKnown) {
    const accountsMessage = document.getElementById('accounts-message');
    accountsMessage.textContent ||= `The email of login ${filters.login} is unknown, so rows cannot be compared.`;
  }
  applyEmailFilter();
}

function detailsButton(row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Details';
  button.addEventListener('click', () => openDetails(row));
  return button;
}

const SUMMARY_COLUMNS = [
  { key: 'relatedLogin', title: 'Related login', format: loginLink, sortKey: 'RelatedLogin' },
  { key: 'type', title: 'Type', format: type => TYPE_LABELS[type] ?? type, sortKey: 'Type' },
  { key: 'relatedLoginCount', title: 'Related logins', sortKey: 'RelatedLoginCount' },
  accountsDirectory.column('Name', 'name', 'relatedLogin'),
  accountsDirectory.column('Group', 'group', 'relatedLogin'),
  accountsDirectory.column('Email', 'email', 'relatedLogin'),
  accountsDirectory.column('Balance', 'balance', 'relatedLogin'),
  {
    key: 'relatedLogin',
    title: 'Actions',
    sortable: false,
    filterable: false,
    format: (login, row) => {
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(
        detailsButton(row),
        actionLink('Profile', `/logins.html?login=${encodeURIComponent(login)}`),
        actionLink('Compare', compareHref(row)));
      return actions;
    },
  },
];

const DETAILS_COLUMNS = [
  { key: 'value', title: 'Value', sortKey: 'Value' },
  { key: 'loginCount', title: 'Logins', sortKey: 'LoginCount' },
  { key: 'relatedLoginCount', title: 'Related logins', sortKey: 'RelatedLoginCount' },
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
  accountsDirectory.reset();
  differentEmailButton.disabled = true;
  renderTable(document.getElementById('summary'), SUMMARY_COLUMNS, report.items, undefined, {
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
  summarySection.hidden = activeTab !== SUMMARY_TAB;
  writeState();
  loadAccounts(report.items);
}

function makeTab(label, { onSelect, onClose }) {
  const tab = document.createElement('span');
  tab.className = 'tab';
  const select = document.createElement('button');
  select.type = 'button';
  select.textContent = label;
  select.addEventListener('click', onSelect);
  tab.append(select);
  if (onClose) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close';
    close.setAttribute('aria-label', `Close ${label}`);
    close.addEventListener('click', onClose);
    tab.append(close);
  }
  return tab;
}

const summaryTab = makeTab('Summary', { onSelect: () => activateTab(SUMMARY_TAB) });
summaryTab.classList.add('active');
tabsBar.append(summaryTab);

function activateTab(key) {
  activeTab = key;
  summarySection.hidden = key !== SUMMARY_TAB;
  summaryTab.classList.toggle('active', key === SUMMARY_TAB);
  for (const [tabKey, { section, tab }] of detailsTabs) {
    section.hidden = tabKey !== key;
    tab.classList.toggle('active', tabKey === key);
  }
  writeState();
}

function closeDetails(key) {
  const opened = detailsTabs.get(key);
  if (!opened) return;
  opened.section.remove();
  opened.tab.remove();
  detailsTabs.delete(key);
  tabsBar.hidden = detailsTabs.size === 0;
  if (activeTab === key) activateTab(SUMMARY_TAB);
  else writeState();
}

function closeAllDetails() {
  for (const { section, tab } of detailsTabs.values()) {
    section.remove();
    tab.remove();
  }
  detailsTabs.clear();
  activeTab = SUMMARY_TAB;
  summaryTab.classList.add('active');
  tabsBar.hidden = true;
}

function addDetailsTab(relatedLogin, type) {
  const key = `${type}:${relatedLogin}`;
  const section = detailsTemplate.content.firstElementChild.cloneNode(true);
  const part = name => section.querySelector(`.details-${name}`);
  const detailsForm = part('filters');
  const detailsMessage = part('message');
  let values = {};
  let columnFilters = {};
  let paging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };

  const params = () => ({
    ...commonParams(),
    ...values,
    ...columnFilterParams(columnFilters),
    type,
    relatedLogin,
    currentPage: paging.currentPage,
    pageSize: paging.pageSize,
  });

  async function load() {
    const report = await apiGet('similarity-reports/get-details', params());
    const reportPaging = pagingOf(report.paging);
    paging = { currentPage: reportPaging?.currentPage ?? 1, pageSize: reportPaging?.pageSize ?? paging.pageSize };
    renderTable(part('table'), DETAILS_COLUMNS, report.items, undefined, {
      sort: {
        item: values.sortItem,
        direction: values.sortDirection,
        onChange: (item, direction) => {
          setSortFields(detailsForm, item, direction);
          values = { ...values, sortItem: item, sortDirection: direction };
          paging = { currentPage: 1, pageSize: paging.pageSize };
          return reload();
        },
      },
      filter: {
        values: columnFilters,
        onChange: next => {
          columnFilters = next;
          paging = { currentPage: 1, pageSize: paging.pageSize };
          return reload();
        },
      },
    });
    renderPager(part('pager'), reportPaging, (page, pageSize) => {
      paging = { currentPage: page, pageSize };
      return reload();
    });
  }

  const reload = () => withLoading(detailsForm, detailsMessage, load);

  part('title').textContent = `Details: ${filters.login} and ${relatedLogin} (${TYPE_LABELS[type] ?? type})`;
  detailsForm.addEventListener('submit', event => {
    event.preventDefault();
    values = formValues(detailsForm);
    paging = { currentPage: 1, pageSize: paging.pageSize };
    reload();
  });
  section.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
    const { currentPage, pageSize, ...exportParams } = params();
    downloadExport(
      'similarity-reports/export-details',
      { ...exportParams, format: button.dataset.format },
      button,
      part('export-message'));
  }));

  const tab = makeTab(`${relatedLogin} · ${TYPE_LABELS[type] ?? type}`, {
    onSelect: () => activateTab(key),
    onClose: () => closeDetails(key),
  });
  tabsBar.append(tab);
  tabsBar.hidden = false;
  document.querySelector('main').append(section);
  detailsTabs.set(key, { section, tab });
  reload();
  return key;
}

function openDetails(row) {
  const key = `${row.type}:${row.relatedLogin}`;
  activateTab(detailsTabs.has(key) ? key : addDetailsTab(row.relatedLogin, row.type));
}

document.querySelectorAll('[data-export="summary"]').forEach(button => button.addEventListener('click', () => {
  const { currentPage, pageSize, ...params } = summaryParams();
  downloadExport(
    'similarity-reports/export-summary',
    { ...params, format: button.dataset.format },
    button,
    document.getElementById('summary-export-message'));
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
    closeAllDetails();
    await loadSummary();
  });
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

  if (summarySection.hidden) return;
  const requested = (query.get('tabs') ?? '').split(',').map(entry => entry.split(':'));
  const legacyLogin = query.get(`${LEGACY_DETAILS_PREFIX}relatedLogin`);
  const legacyType = query.get(`${LEGACY_DETAILS_PREFIX}type`);
  if (legacyLogin && legacyType) requested.push([legacyType, legacyLogin]);
  let restored = null;
  for (const [type, relatedLogin] of requested) {
    if (!(type in TYPE_LABELS) || !/^\d+$/.test(relatedLogin ?? '') || detailsTabs.has(`${type}:${relatedLogin}`)) continue;
    restored = addDetailsTab(relatedLogin, type);
  }
  const wanted = query.get('tab');
  if (detailsTabs.has(wanted)) activateTab(wanted);
  else if (legacyLogin && restored) activateTab(restored);
  else writeState();
}

renderMenu();
rangeControls.sync();
restoreFromQuery();
