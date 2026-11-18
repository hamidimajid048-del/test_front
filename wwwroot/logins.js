// Login history page: sessions (paged), IP mappings and CID mappings for one trading login.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const DEFAULT_PAGE_SIZE = 1000;

// The account report cannot answer when the evaluator has no usable data range for the login; the sessions
// themselves are still known to the login tracker, so the page falls back to them.
const ACCOUNT_REASONS = new Set([
  'AccountNotFound', 'AccountSelectionAmbiguous', 'AccountTimeRangeNotReady', 'AccountTimeRangeInvalid',
]);

let currentLogin = null;
// The MetaTrader account of the login, for its name and email in the login info.
let loginAccount = null;
let currentTab = 'summary';
// The IP and CID mappings of the last search, drawn by the timeline tab; 'cid' or 'ip' is the one shown.
const mappings = { ip: null, cid: null };
let timelineSource = 'cid';
// Sort and column filters of the sessions table; the service applies them to every page.
let sessionSort = { item: 'LoginAt', direction: 'Desc' };
let sessionFilters = {};

const mappingColumns = (key, title, extra = []) => [
  { key, title },
  ...extra,
  seenColumn('firstSeen', 'lastSeen', 'First / last seen'),
  { key: 'sessionCount', title: 'Sessions' },
  { key: 'transactionCount', title: 'Transactions', help: 'Transactions the login made from this value. For a CID, the computer of the login session that covers the transaction time and, when possible, its IP.' },
];

function showTab(tab) {
  // Older links name the IP and CID tabs (now the summary) and the sessions tab (now the details).
  currentTab = ({ sessions: 'details', ips: 'summary', cids: 'summary' })[tab] ?? (['summary', 'details', 'timeline'].includes(tab) ? tab : 'summary');
  for (const button of document.querySelectorAll('#tabs button')) {
    button.classList.toggle('active', button.dataset.tab === currentTab);
  }
  for (const panel of document.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== currentTab;
  }
}

function updateQuery(paging) {
  writeQuery({
    login: currentLogin,
    tab: currentTab,
    currentPage: paging?.currentPage,
    pageSize: paging?.pageSize,
    sortItem: sessionSort.item,
    sortDirection: sessionSort.direction,
    ...columnFilterState(sessionFilters),
  });
}

function renderMetadata(result) {
  const { metadata } = result.report;
  showRelatedPages({ login: metadata.login });
  if (result.accountNote === null) {
    renderIconSummary(document.getElementById('metadata'), [
      ['Login', metadata.login, 'layers'],
      ['Name', loginAccount?.name || '—', 'user'],
      ['Email', loginAccount?.email || '—', 'mail'],
      ['Data start (UTC)', formatUtc(metadata.firstDataTime), 'calendar'],
      ['Data end (UTC)', formatUtc(metadata.lastDataTime), 'calendar'],
    ]);
    return;
  }
  renderIconSummary(document.getElementById('metadata'), [
    ['Login', metadata.login, 'layers'],
    ['Name', loginAccount?.name || '—', 'user'],
    ['Email', loginAccount?.email || '—', 'mail'],
    ['Range', 'All recorded sessions', 'calendar'],
    ['Evaluator account', result.accountNote, 'info'],
  ]);
}

function renderSessions(result) {
  const paging = pagingOf(result.report.paging);
  renderMetadata(result);
  renderTable(
    document.getElementById('sessions'), SESSION_COLUMNS, result.report.items,
    session => renderGeoDetails(document.getElementById('geo-details'), session),
    {
      sort: {
        item: sessionSort.item,
        direction: sessionSort.direction,
        onChange: (item, direction) => {
          sessionSort = { item, direction };
          return loadSessionsPage(1, paging?.pageSize ?? DEFAULT_PAGE_SIZE);
        },
      },
      filter: {
        values: sessionFilters,
        onChange: values => {
          sessionFilters = values;
          return loadSessionsPage(1, paging?.pageSize ?? DEFAULT_PAGE_SIZE);
        },
      },
    });
  renderPager(document.getElementById('sessions-pager'), paging, loadSessionsPage);
  document.getElementById('geo-details').replaceChildren();
  updateQuery(paging);
}

function clearSessions() {
  clearPager(document.getElementById('sessions-pager'));
  for (const id of ['metadata', 'sessions', 'geo-details']) {
    document.getElementById(id).replaceChildren();
  }
}

function renderMapping(containerId, tab, label, key, outcome) {
  const container = document.getElementById(containerId);
  const title = document.getElementById(`${containerId}-title`);
  if (outcome.status === 'fulfilled') {
    renderTable(container, mappingColumns(key, label, key === 'cid' ? [{ key: 'deviceType', title: 'Device type', format: platformList }] : []), outcome.value);
    title.textContent = `${label} summary (${outcome.value?.length ?? 0})`;
  } else {
    const error = document.createElement('p');
    error.className = 'message error';
    error.textContent = outcome.reason?.message || UNAVAILABLE_MESSAGE;
    container.replaceChildren(error);
    title.textContent = `${label} summary`;
  }
}

// Draws the usage timeline of the CIDs or the IPs. Clicking a CID opens its sessions; an IP is not, because the
// sessions filter matches text inside a value and one IP can be part of another.
function renderTimeline() {
  const container = document.getElementById('timeline');
  document.getElementById('timeline-title').textContent = `${timelineSource === 'cid' ? 'CID' : 'IP'} usage timeline`;
  for (const button of document.querySelectorAll('#timeline-kind button'))
    button.setAttribute('aria-pressed', String(button.dataset.kind === timelineSource));
  const outcome = mappings[timelineSource];
  if (!outcome) {
    container.replaceChildren();
    return;
  }
  if (outcome.status === 'rejected') {
    const error = document.createElement('p');
    error.className = 'message error';
    error.textContent = outcome.reason?.message || UNAVAILABLE_MESSAGE;
    container.replaceChildren(error);
    return;
  }
  const rows = (outcome.value ?? []).map(row => ({ ...row, value: String(row[timelineSource]) }));
  renderUsageTimeline(container, rows, {
    kind: timelineSource,
    onSelect: timelineSource === 'cid'
      ? row => {
        sessionFilters = { Cid: row.value };
        showTab('details');
        loadSessionsPage(1, DEFAULT_PAGE_SIZE);
      }
      : undefined,
  });
}

// Reads a page of sessions in the account's data range; without a usable range, of all recorded sessions.
// accountNote is null when the account range was used, otherwise why it could not be.
async function sessionsRequest(page, pageSize) {
  const params = {
    login: currentLogin, sortItem: sessionSort.item, sortDirection: sessionSort.direction,
    ...columnFilterParams(sessionFilters), currentPage: page, pageSize,
  };
  try {
    return { report: await apiGet('login-reports/get-login-sessions-complete', params), accountNote: null };
  } catch (error) {
    if (!(error instanceof ApiError) || !ACCOUNT_REASONS.has(error.reason)) throw error;
    return { report: await apiGet('login-reports/get-login-sessions', params), accountNote: error.message };
  }
}

async function loadReport(login, page, pageSize) {
  currentLogin = login;
  const main = document.querySelector('main.login-history');
  main.classList.remove('loaded');
  await withLoading(form, message, async () => {
    const [sessions, ips, cids, account] = await Promise.allSettled([
      sessionsRequest(page, pageSize),
      apiGet('login-reports/get-ip-mappings', { login }),
      apiGet('login-reports/get-cid-mappings', { login }),
      accountOfLogin(login),
    ]);
    loginAccount = account.status === 'fulfilled' ? account.value : null;
    renderMapping('ips', 'ips', 'IP', 'ip', ips);
    renderMapping('cids', 'cids', 'CID', 'cid', cids);
    renderCidOverview(document.getElementById('cid-overview'), cids.status === 'fulfilled'
      ? [...cids.value].sort((a, b) => b.sessionCount - a.sessionCount).map(mapping => mapping.cid)
      : []);
    Object.assign(mappings, { ip: ips, cid: cids });
    renderTimeline();
    if (sessions.status === 'rejected') {
      clearSessions();
      updateQuery();
      throw sessions.reason;
    }
    renderSessions(sessions.value);
    main.classList.add('loaded');
  });
}

async function loadSessionsPage(page, pageSize) {
  await withLoading(form, message, async () => renderSessions(await sessionsRequest(page, pageSize)));
}

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (!tab) return;
  showTab(tab);
  const query = new URLSearchParams(location.search);
  if (currentLogin) {
    writeQuery({ ...Object.fromEntries(query), tab: currentTab });
  }
});

document.getElementById('timeline-kind').addEventListener('click', event => {
  const kind = event.target.closest('button')?.dataset.kind;
  if (!kind || kind === timelineSource) return;
  timelineSource = kind;
  renderTimeline();
});

form.addEventListener('submit', event => {
  event.preventDefault();
  sessionSort = { item: 'LoginAt', direction: 'Desc' };
  sessionFilters = {};
  loadReport(formValues(form).login, 1, DEFAULT_PAGE_SIZE);
});

renderMenu();
const initialQuery = new URLSearchParams(location.search);
showTab(initialQuery.get('tab'));
if (fillFormFromQuery(form) && form.elements.login.value) {
  sessionSort = {
    item: initialQuery.get('sortItem') || sessionSort.item,
    direction: initialQuery.get('sortDirection') || sessionSort.direction,
  };
  sessionFilters = readColumnFilters(initialQuery);
  loadReport(
    form.elements.login.value,
    Number(initialQuery.get('currentPage')) || 1,
    Number(initialQuery.get('pageSize')) || DEFAULT_PAGE_SIZE);
}
