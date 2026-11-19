// Similarity page: logins sharing IP/CID evidence (summary), the shared values with one related login (details, one
// tab per related login and evidence type), and CSV/XLSX exports of both.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const summarySection = document.getElementById('summary-section');
const tabsBar = document.getElementById('tabs');
const detailsTemplate = document.getElementById('details-template');
const DEFAULT_PAGE_SIZE = 1000;
// Older links carried the details of one account under this prefix.
const LEGACY_DETAILS_PREFIX = 'd_';
const SUMMARY_TAB = 'summary';

const COMMON_KEYS = ['type', 'fromUtc', 'toUtc', 'cid'];
const SUMMARY_KEYS = [
  ...COMMON_KEYS, 'relatedLogin',
  'sortItem', 'sortDirection',
];

const TYPE_LABELS = { Ip: 'IP', Cid: 'CID' };

const SHARED_SIGNINS_HELP = 'How many times this related account signed in from an IP or CID that the searched account also used. '
  + 'A high number means the two accounts keep working from the same device or network, which points to one person or linked accounts; '
  + 'a low number (1-2) is often a coincidence such as a shared network. It follows the filters above (date range, device type, CID).';
const TRANSACTIONS_HELP = 'Transactions the account made from this value in the range. The IP is the one recorded on the transaction; '
  + 'the computer (CID) is the one of the login session that covers the transaction time and, when possible, its IP.';
const DETAIL_SIGNINS_HELP ='How many times the related account signed in from this value. Compare it with Logins, the sign-ins of the searched account.';
const SHARED_VALUES_HELP = 'The IPs or CIDs both accounts used, the most used first, each with how many times the related account signed in from it. '
  + 'An IP shows the flag of its country, and the icons are the devices the related account used it from (Android, iPhone, desktop, web). '
  + 'Shared values opens all of them with their dates.';
const SHARED_VALUES_SHOWN = 5;

// Filters of the last summary search; the details and exports reuse them so they always match the table shown.
let filters = null;
let summaryPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
let summaryColumnFilters = {};
// Hides the related logins whose email equals the searched login's email; the service applies it to every page.
let differentEmailOnly = true;
// The details tabs opened from the summary, by "Type:login"; an account already open is selected, not opened twice.
const detailsTabs = new Map();
let activeTab = SUMMARY_TAB;

const pick = (source, keys) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));

const rangeControls = initRangeControls(form);
const deviceTypePicker = initDeviceTypePicker(form);

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
    useRange.append(icon('calendar'), 'Use this range');
    useRange.addEventListener('click', () => {
      form.elements.range.value = 'custom';
      rangeControls.sync();
      rangeControls.setRange(toDayValue(new Date(metadata.firstDataTime)), toDayValue(new Date(metadata.lastDataTime)));
    });
    const range = document.createElement('span');
    range.textContent = `${toDayValue(new Date(metadata.firstDataTime))} — ${toDayValue(new Date(metadata.lastDataTime))}`;
    hint.replaceChildren(icon('calendar'), `Data range of account ${login} (UTC): `, range, useRange);
  } catch (error) {
    if (login !== accountRangeLogin) return;
    hint.textContent = `Account data range: ${error.message || UNAVAILABLE_MESSAGE}`;
  }
}

form.elements.login.addEventListener('change', showAccountRange);

function commonParams() {
  return {
    login: filters.login, ...pick(filters, COMMON_KEYS), deviceTypes: splitDeviceTypes(filters.deviceType),
    fromUtc: fromDayParam(filters.fromUtc), toUtc: toDayParam(filters.toUtc),
  };
}

function summaryParams() {
  return {
    ...pick(filters, SUMMARY_KEYS),
    ...commonParams(),
    ...columnFilterParams(summaryColumnFilters),
    ...(differentEmailOnly ? { differentEmailOnly: true } : {}),
    currentPage: summaryPaging.currentPage,
    pageSize: summaryPaging.pageSize,
  };
}

function writeState() {
  const state = {
    ...filters, ...columnFilterState(summaryColumnFilters),
    ...(differentEmailOnly ? {} : { differentEmailOnly: false }),
    currentPage: summaryPaging.currentPage, pageSize: summaryPaging.pageSize,
  };
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
  const container = document.getElementById('summary-metadata');
  renderSummary(container, [['Login', metadata.login], ['Range (UTC)', range]]);
  container.lastElementChild.prepend(icon('calendar'));
}

// The searched login with its email and day range: the row menus pass it to the compare pages as the main side.
let subjectEmail = null;
const subject = () => ({ login: filters.login, email: subjectEmail, fromUtc: filters.fromUtc, toUtc: filters.toUtc });

const differentEmailButton = document.getElementById('different-email');

differentEmailButton.addEventListener('click', () => {
  differentEmailOnly = !differentEmailOnly;
  summaryPaging = { currentPage: 1, pageSize: summaryPaging.pageSize };
  withLoading(form, message, loadSummary);
});

function renderDifferentEmail(metadata) {
  const known = Boolean(metadata.loginEmail);
  subjectEmail = known ? metadata.loginEmail : null;
  differentEmailButton.disabled = !known;
  differentEmailButton.setAttribute('aria-pressed', String(differentEmailOnly && known));
  document.getElementById('accounts-message').textContent = known
    ? ''
    : `The email of login ${metadata.login} is unknown, so rows cannot be compared.`;
}

// One icon for each kind of device the related account used the value from; the platform names are its tooltip.
function sharedValueDevices(platforms) {
  const kinds = new Map();
  for (const platform of platforms ?? []) {
    const kind = platformKind(platform);
    if (kind) kinds.set(kind, [...(kinds.get(kind) ?? []), platform]);
  }
  const devices = document.createElement('span');
  devices.className = 'shared-devices';
  for (const [kind, names] of kinds) {
    const holder = document.createElement('span');
    holder.title = names.join(', ');
    holder.append(platformIcon(kind));
    devices.append(holder);
  }
  return devices;
}

// The shared IPs or CIDs of a summary row, one per line and copyable, each with the related account's sign-ins from it
// and its devices; the rest of a long list opens in the row's details tab.
function sharedValueList(values, row) {
  if (!values?.length) return '—';
  const list = document.createElement('div');
  list.className = 'cid-list shared-values';
  for (const { value, loginCount, platforms } of values.slice(0, SHARED_VALUES_SHOWN)) {
    const line = document.createElement('div');
    line.className = 'shared-value';
    const count = document.createElement('small');
    count.textContent = ` (${loginCount.toLocaleString('en-US')})`;
    const text = copyableText(value);
    text.dir = 'ltr';
    line.append(text, count, sharedValueDevices(platforms));
    list.append(line);
  }
  const rest = values.length - SHARED_VALUES_SHOWN;
  if (rest > 0) list.append(menuAction(`+${rest} more`, () => openDetails(row)));
  return list;
}

const SUMMARY_COLUMNS = [
  { key: 'relatedLogin', title: 'Related login', sortKey: 'RelatedLogin' },
  { key: 'relatedLoginCount', title: 'Shared sign-ins', sortKey: 'RelatedLoginCount', help: SHARED_SIGNINS_HELP },
  { key: 'sharedValues', title: 'Shared values', format: sharedValueList, sortable: false, filterable: false, help: SHARED_VALUES_HELP },
  ...accountColumns(['name', 'group', 'balance']),
  loginActionsColumn('relatedLogin', row => [menuAction('Shared values', () => openDetails(row))], { subject, emailOf: row => row.email }),
];

const DETAILS_COLUMNS = [
  { key: 'value', title: 'Value', sortKey: 'Value' },
  { key: 'loginCount', title: 'Logins', sortKey: 'LoginCount' },
  { key: 'relatedLoginCount', title: 'Related sign-ins', sortKey: 'RelatedLoginCount', help: DETAIL_SIGNINS_HELP },
  { key: 'transactionCount', title: 'Transactions', sortKey: 'TransactionCount', help: TRANSACTIONS_HELP },
  { key: 'relatedTransactionCount', title: 'Related transactions', sortKey: 'RelatedTransactionCount', help: TRANSACTIONS_HELP },
  { key: 'platforms', title: 'Device type', format: platformList, sortable: false, filterable: false },
  seenColumn('firstSeenUtc', 'lastSeenUtc', 'First / last seen', { sortKey: 'FirstSeenUtc' }),
  seenColumn('relatedFirstSeenUtc', 'relatedLastSeenUtc', 'Related first / last seen', { sortKey: 'RelatedFirstSeenUtc' }),
];

async function loadSummary() {
  const report = await apiGet('similarity-reports/get-summary', summaryParams());
  const paging = pagingOf(report.paging);
  summaryPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? summaryPaging.pageSize };
  renderMetadata(report.metadata);
  renderDifferentEmail(report.metadata);
  showRelatedPages({ login: report.metadata.login });
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
}

function makeTab(label, iconName, { onSelect, onClose }) {
  const tab = document.createElement('span');
  tab.className = 'tab';
  const select = document.createElement('button');
  select.type = 'button';
  select.append(icon(iconName), label);
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

const summaryTab = makeTab('Summary', 'grid', { onSelect: () => activateTab(SUMMARY_TAB) });
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
  applyIcons(section);
  const part = name => section.querySelector(`.details-${name}`);
  const detailsForm = part('filters');
  const detailsMessage = part('message');
  let values = {};
  let paging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };

  const params = () => ({
    ...commonParams(),
    ...values,
    type,
    relatedLogin,
    currentPage: paging.currentPage,
    pageSize: paging.pageSize,
  });

  async function load() {
    const report = await apiGet('similarity-reports/get-details', params());
    const reportPaging = pagingOf(report.paging);
    paging = { currentPage: reportPaging?.currentPage ?? 1, pageSize: reportPaging?.pageSize ?? paging.pageSize };
    part('table').dataset.viewKey = 'details';
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
      columnFilters: false,
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

  const tab = makeTab(`${relatedLogin} · ${TYPE_LABELS[type] ?? type}`, 'list', {
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
  deviceTypePicker.sync();
  rangeControls.restore();
  showAccountRange();
  const query = new URLSearchParams(location.search);
  filters = formValues(form);
  summaryColumnFilters = readColumnFilters(query);
  differentEmailOnly = query.get('differentEmailOnly') !== 'false';
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
