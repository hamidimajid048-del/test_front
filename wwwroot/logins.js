// Login history page: sessions (paged), IP mappings and CID mappings for one trading login.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const DEFAULT_PAGE_SIZE = 100;

// The account report cannot answer when the evaluator has no usable data range for the login; the sessions
// themselves are still known to the login tracker, so the page falls back to them.
const ACCOUNT_REASONS = new Set([
  'AccountNotFound', 'AccountSelectionAmbiguous', 'AccountTimeRangeNotReady', 'AccountTimeRangeInvalid',
]);

let currentLogin = null;
let currentTab = 'summary';
// Sort and column filters of the sessions table; the service applies them to every page.
let sessionSort = { item: 'LoginAt', direction: 'Desc' };
let sessionFilters = {};

const mappingColumns = (key, title, extra = []) => [
  { key, title },
  ...extra,
  seenColumn('firstSeen', 'lastSeen', 'First / last seen'),
  { key: 'sessionCount', title: 'Sessions' },
];

function showTab(tab) {
  // Older links name the IP and CID tabs (now the summary) and the sessions tab (now the details).
  currentTab = ({ sessions: 'details', ips: 'summary', cids: 'summary' })[tab] ?? (['summary', 'details'].includes(tab) ? tab : 'summary');
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
  if (result.accountNote === null) {
    renderSummary(document.getElementById('metadata'), [
      ['Login', metadata.login],
      ['Data start (UTC)', formatUtc(metadata.firstDataTime)],
      ['Data end (UTC)', formatUtc(metadata.lastDataTime)],
    ]);
    return;
  }
  renderSummary(document.getElementById('metadata'), [
    ['Login', metadata.login],
    ['Range', 'All recorded sessions'],
    ['Evaluator account', result.accountNote],
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
    renderTable(container, mappingColumns(key, label, key === 'cid' ? [{ key: 'deviceType', title: 'Device type' }] : []), outcome.value);
    title.textContent = `${label} summary (${outcome.value?.length ?? 0})`;
  } else {
    const error = document.createElement('p');
    error.className = 'message error';
    error.textContent = outcome.reason?.message || UNAVAILABLE_MESSAGE;
    container.replaceChildren(error);
    title.textContent = `${label} summary`;
  }
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
  await withLoading(form, message, async () => {
    const [sessions, ips, cids] = await Promise.allSettled([
      sessionsRequest(page, pageSize),
      apiGet('login-reports/get-ip-mappings', { login }),
      apiGet('login-reports/get-cid-mappings', { login }),
    ]);
    renderMapping('ips', 'ips', 'IP', 'ip', ips);
    renderMapping('cids', 'cids', 'CID', 'cid', cids);
    if (sessions.status === 'rejected') {
      clearSessions();
      updateQuery();
      throw sessions.reason;
    }
    renderSessions(sessions.value);
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
