// Login history page: sessions (paged), IP mappings and CID mappings for one trading login.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const DEFAULT_PAGE_SIZE = 100;

let currentLogin = null;
let currentTab = 'sessions';

const yesNo = value => value === true ? 'Yes' : value === false ? 'No' : '—';

// "isHttpProxy" -> "Http proxy"
const flagLabel = key => {
  const words = key.replace(/^is/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Short warning labels shown in the sessions table for risky geo flags.
const WARNING_FLAGS = [
  { label: 'VPN', isSet: geo => geo.isVpn },
  { label: 'Proxy', isSet: geo => geo.isHttpProxy },
  { label: 'Tor', isSet: geo => geo.isTorExit },
  { label: 'Datacenter', isSet: geo => geo.isDatacenter },
  { label: 'Blacklisted', isSet: geo => geo.isBlacklisted },
  { label: 'Bot', isSet: geo => geo.isBotAny || geo.isBotBotnet || geo.isBotFake },
];

const GEO_FIELDS = [
  ['continent', 'Continent'], ['country', 'Country'], ['city', 'City'], ['region', 'Region'], ['province', 'Province'],
  ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['asn', 'ASN'],
  ['asnOrganization', 'ASN organization'], ['isp', 'ISP'], ['ispOrganization', 'ISP organization'], ['detailsFlags', 'Details flags'],
];

const GEO_FLAGS = [
  'isTorExit', 'isHttpProxy', 'isVpn', 'isDatacenter', 'isAttackMail', 'isAttackSsh', 'isAttackWeb', 'isAttackApp',
  'isBotBotnet', 'isSearchEngine', 'isBlacklisted', 'isWebdriver', 'isBotAny', 'isBotFake',
];

const SESSION_COLUMNS = [
  utcColumn('loginAt', 'Login'),
  utcColumn('logoutAt', 'Logout'),
  { key: 'ip', title: 'IP' },
  { key: 'cid', title: 'CID' },
  { key: 'platform', title: 'Platform' },
  { key: 'accessPointName', title: 'Access Point' },
  { key: 'pingMs', title: 'Ping (ms)' },
  { key: 'isSessionValid', title: 'Session valid', format: yesNo },
  { key: 'isCidValid', title: 'CID valid', format: yesNo },
  { key: 'geo', title: 'Country / city', format: geo => geo ? [geo.country, geo.city].filter(Boolean).join(' / ') : '—' },
  {
    key: 'geo',
    title: 'Warnings',
    format: geo => geo ? WARNING_FLAGS.filter(flag => flag.isSet(geo)).map(flag => flag.label).join(', ') : '',
  },
];

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

function renderMetadata(metadata) {
  renderSummary(document.getElementById('metadata'), [
    ['Login', metadata.login],
    ['Account ID', metadata.accountId],
    ['Account Server ID', metadata.accountServerId],
    ['Data start (UTC)', formatUtc(metadata.firstDataTime)],
    ['Data end (UTC)', formatUtc(metadata.lastDataTime)],
  ]);
}

function renderGeoDetails(session) {
  const container = document.getElementById('geo-details');
  const title = document.createElement('h3');
  title.textContent = `Location details — login at ${formatUtc(session.loginAt)} from ${session.ip}`;

  if (!session.geo) {
    const empty = document.createElement('p');
    empty.textContent = 'No location information available';
    container.replaceChildren(title, empty);
  } else {
    const rows = [
      ...GEO_FIELDS.map(([key, label]) => ({ label, value: session.geo[key] })),
      ...GEO_FLAGS.map(key => ({ label: flagLabel(key), value: yesNo(session.geo[key]) })),
    ];
    const table = document.createElement('div');
    renderTable(table, [{ key: 'label', title: 'Field' }, { key: 'value', title: 'Value' }], rows);
    container.replaceChildren(title, table);
  }
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSessions(report) {
  const paging = report.paging?.normalPagingResponse;
  renderMetadata(report.metadata);
  renderTable(document.getElementById('sessions'), SESSION_COLUMNS, report.items, renderGeoDetails);
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

const sessionsRequest = (page, pageSize) =>
  apiGet(`reports/logins/${currentLogin}/complete`, { currentPage: page, pageSize });

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
