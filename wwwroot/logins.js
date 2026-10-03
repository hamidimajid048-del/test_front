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
let currentTab = 'sessions';

const mappingColumns = (key, title) => [
  { key, title },
  utcColumn('firstSeen', 'First seen'),
  utcColumn('lastSeen', 'Last seen'),
  { key: 'sessionCount', title: 'Sessions' },
];

function showTab(tab) {
  currentTab = ['sessions', 'ips', 'cids'].includes(tab) ? tab : 'sessions';
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
  });
}

function renderMetadata(result) {
  const { metadata } = result.report;
  if (result.accountNote === null) {
    renderSummary(document.getElementById('metadata'), [
      ['Login', metadata.login],
      ['Account ID', metadata.accountId],
      ['Account Server ID', metadata.accountServerId],
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
  const paging = result.report.paging?.normalPagingResponse;
  renderMetadata(result);
  renderTable(
    document.getElementById('sessions'), SESSION_COLUMNS, result.report.items,
    session => renderGeoDetails(document.getElementById('geo-details'), session));
  renderPager(document.getElementById('sessions-pager'), paging, loadSessionsPage);
  document.getElementById('geo-details').replaceChildren();
  updateQuery(paging);
}

function clearSessions() {
  for (const id of ['metadata', 'sessions', 'sessions-pager', 'geo-details']) {
    document.getElementById(id).replaceChildren();
  }
}

function renderMapping(containerId, tab, label, key, outcome) {
  const container = document.getElementById(containerId);
  const button = document.querySelector(`#tabs button[data-tab="${tab}"]`);
  if (outcome.status === 'fulfilled') {
    renderTable(container, mappingColumns(key, label), outcome.value);
    button.textContent = `${label} (${outcome.value?.length ?? 0})`;
  } else {
    const error = document.createElement('p');
    error.className = 'message error';
    error.textContent = outcome.reason?.message || UNAVAILABLE_MESSAGE;
    container.replaceChildren(error);
    button.textContent = label;
  }
}

// Reads a page of sessions in the account's data range; without a usable range, of all recorded sessions.
// accountNote is null when the account range was used, otherwise why it could not be.
async function sessionsRequest(page, pageSize) {
  const params = { currentPage: page, pageSize };
  try {
    return { report: await apiGet(`reports/logins/${currentLogin}/complete`, params), accountNote: null };
  } catch (error) {
    if (!(error instanceof ApiError) || !ACCOUNT_REASONS.has(error.reason)) throw error;
    return { report: await apiGet(`reports/logins/${currentLogin}/sessions`, params), accountNote: error.message };
  }
}

async function loadReport(login, page, pageSize) {
  currentLogin = login;
  await withLoading(form, message, async () => {
    const [sessions, ips, cids] = await Promise.allSettled([
      sessionsRequest(page, pageSize),
      apiGet(`reports/logins/${login}/ip-mappings`),
      apiGet(`reports/logins/${login}/cid-mappings`),
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
  loadReport(formValues(form).login, 1, DEFAULT_PAGE_SIZE);
});

renderMenu();
const initialQuery = new URLSearchParams(location.search);
showTab(initialQuery.get('tab'));
if (fillFormFromQuery(form) && form.elements.login.value) {
  loadReport(
    form.elements.login.value,
    Number(initialQuery.get('currentPage')) || 1,
    Number(initialQuery.get('pageSize')) || DEFAULT_PAGE_SIZE);
}
