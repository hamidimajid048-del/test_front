// Group comparison pages (Compare with logins, Compare emails): a main group of logins against a compared group, through
// group-compare-reports/* of the service. The overview rates the evidence and lists the linked login pairs and the
// shared IPs and CIDs; the details list every session that used a shared value. Sorting, filters and paging are done
// by the service. A page resolves its own inputs to the two login groups and calls run.

const GROUP_COMPARE_MAX_LOGINS = 100;
const GROUP_COMPARE_MAX_LISTED_LOGINS = 6;
const GROUP_COMPARE_SOURCE_LABELS = { Manager: 'Active', Archive: 'Archived' };
const GROUP_COMPARE_TABS = ['overview', 'logins', 'pairs', 'ips', 'cids', 'details'];
const GROUP_COMPARE_TAB_TITLES = { pairs: 'Linked pairs', ips: 'Shared IPs', cids: 'Shared CIDs' };

const GROUP_COMPARE_EVIDENCE = {
  Strong: { kind: 'danger', text: 'A valid shared CID, or 3 or more shared IPs that are not VPN, proxy, Tor or datacenter.' },
  Medium: { kind: 'warn', text: 'A shared IP that is not VPN, proxy, Tor or datacenter.' },
  Weak: { kind: 'muted', text: 'Only VPN, proxy, Tor or datacenter IPs, or invalid CIDs, are shared.' },
  None: { kind: 'ok', text: 'No IP or CID is shared.' },
};

// Splits a typed list: commas, semicolons, spaces and line breaks separate the values; repeats (ignoring case) are dropped.
function splitValues(text) {
  const seen = new Set();
  const values = [];
  for (const value of String(text ?? '').split(/[\s,;]+/)) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values;
}

// A cell listing values separated by commas (so an export reads them apart), the first few copyable, the rest counted.
function groupCompareListCell(values) {
  if (!values?.length) return '—';
  const shown = values.slice(0, GROUP_COMPARE_MAX_LISTED_LOGINS).map(copyableText);
  const rest = values.length - shown.length;
  return inline(...shown.flatMap((item, index) => (index ? [', ', item] : [item])), ...(rest > 0 ? [`, +${rest}`] : []));
}

const groupCompareLoginsCell = logins => groupCompareListCell(logins);
const groupCompareEmailsCell = emails => groupCompareListCell(emails);

const groupCompareAccountColumns = [
  { key: 'login', title: 'Login' },
  { key: 'email', title: 'Email' },
  { key: 'source', title: 'Status', format: source => GROUP_COMPARE_SOURCE_LABELS[source] ?? source },
  { key: 'name', title: 'Name' },
  { key: 'group', title: 'Group' },
  {
    key: 'balance',
    title: 'Balance',
    format: value => value === null || value === undefined
      ? '—'
      : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  },
  loginActionsColumn('login'),
];

// sideTitle names the column of the Details tab that tells the side of a session; exportName prefixes the downloaded files.
function initGroupCompare({ form, message, sideTitle, exportName }) {
  let names = { main: 'A', other: 'B' };
  let sideOf = new Map();
  let currentTab = 'overview';

  const sideColumns = () => [
    { key: 'metric', title: 'Metric' },
    { key: 'main', title: names.main },
    { key: 'other', title: names.other },
  ];

  const pairColumns = () => [
    { key: 'login', title: 'Login', group: names.main, sortKey: 'Login' },
    { key: 'email', title: 'Email', group: names.main, sortKey: 'Email', format: email => email || '—' },
    { key: 'otherLogin', title: 'Login', group: names.other, sortKey: 'OtherLogin' },
    { key: 'otherEmail', title: 'Email', group: names.other, sortKey: 'OtherEmail', format: email => email || '—' },
    { key: 'sharedIpCount', title: 'Shared IPs', sortKey: 'SharedIpCount' },
    { key: 'sharedCidCount', title: 'Shared CIDs', sortKey: 'SharedCidCount' },
    loginActionsColumn(['login', 'otherLogin']),
  ];

  // The shared value with, for each side, its logins, sessions and first/last sign-in.
  const sharedColumns = (valueTitle, extra) => () => [
    { key: 'value', title: valueTitle, sortKey: 'Value' },
    { key: 'mainLogins', title: 'Logins', group: names.main, format: groupCompareLoginsCell, sortable: false, filterable: false },
    { key: 'mainEmails', title: 'Emails', group: names.main, format: groupCompareEmailsCell, sortable: false, filterable: false },
    { key: 'mainSessionCount', title: 'Sessions', group: names.main, sortKey: 'MainSessionCount' },
    seenColumn('mainFirstSeenUtc', 'mainLastSeenUtc', 'First / last seen', { group: names.main, sortKey: 'MainFirstSeenUtc' }),
    { key: 'otherLogins', title: 'Logins', group: names.other, format: groupCompareLoginsCell, sortable: false, filterable: false },
    { key: 'otherEmails', title: 'Emails', group: names.other, format: groupCompareEmailsCell, sortable: false, filterable: false },
    { key: 'otherSessionCount', title: 'Sessions', group: names.other, sortKey: 'OtherSessionCount' },
    seenColumn('otherFirstSeenUtc', 'otherLastSeenUtc', 'First / last seen', { group: names.other, sortKey: 'OtherFirstSeenUtc' }),
    { key: 'overlapsInTime', title: 'Used in the same period', format: yesNo, sortKey: 'OverlapsInTime' },
    ...extra,
    { key: 'totalSessionCount', title: 'Total sessions', sortKey: 'TotalSessionCount' },
  ];

  const ipExtra = [
    { key: 'geo', title: 'Country / city', format: geo => geo ? withCountryFlag(geo.country, [geo.country, geo.city].filter(Boolean).join(' / ')) || '—' : '—', sortable: false, filterable: false },
    { key: 'geo', title: 'Warnings', format: warningBadges, help: WARNINGS_HELP, sortable: false, filterable: false },
  ];

  const cidExtra = [
    { key: 'isCidValid', title: 'CID valid', format: yesNo, sortable: false, filterable: false },
    { key: 'platforms', title: 'Platforms', format: platforms => platformList(platforms) || '—', sortable: false, filterable: false },
  ];

  const detailColumns = () => [
    {
      key: 'login',
      title: sideTitle,
      format: login => sideOf.get(login) === 'main' ? badge(names.main, 'main') : badge(names.other, 'compared'),
    },
    { key: 'login', title: 'Login', sortKey: 'Login' },
    { key: 'email', title: 'Email', sortKey: 'Email', format: email => email || '—' },
    ...SESSION_COLUMNS,
    { key: 'sharedIp', title: 'Shared IP', format: yesNo, sortKey: 'SharedIp' },
    { key: 'sharedCid', title: 'Shared CID', format: yesNo, sortKey: 'SharedCid' },
    loginActionsColumn('login'),
  ];

  function showTab(tab) {
    currentTab = GROUP_COMPARE_TABS.includes(tab) ? tab : 'overview';
    for (const button of document.querySelectorAll('#tabs button'))
      button.classList.toggle('active', button.dataset.tab === currentTab);
    for (const panel of document.querySelectorAll('[data-panel]'))
      panel.hidden = panel.dataset.panel !== currentTab;
  }

  function showCount(tab, report) {
    const total = pagingOf(report.paging)?.totalRecords ?? report.items.length;
    document.querySelector(`#tabs [data-tab="${tab}"]`).textContent = `${GROUP_COMPARE_TAB_TITLES[tab]} (${total.toLocaleString('en-US')})`;
  }

  function resetCounts() {
    for (const [tab, title] of Object.entries(GROUP_COMPARE_TAB_TITLES))
      document.querySelector(`#tabs [data-tab="${tab}"]`).textContent = title;
  }

  function writeState(values) {
    writeQuery({ ...values, tab: currentTab });
  }

  const grids = {
    sessions: createReportGrid({
      path: 'group-compare-reports/get-sessions',
      columns: detailColumns,
      sort: { item: 'LoginAt', direction: 'Desc' },
      containerId: 'sessions',
      pagerId: 'sessions-pager',
      onRowClick: session => renderGeoDetails(document.getElementById('geo-details'), session),
      onRendered: () => document.getElementById('geo-details').replaceChildren(),
    }),
    pairs: createReportGrid({
      path: 'group-compare-reports/get-login-pairs',
      columns: pairColumns,
      sort: { item: 'SharedCidCount', direction: 'Desc' },
      titleId: 'pairs-title',
      title: 'Linked login pairs',
      containerId: 'pairs',
      pagerId: 'pairs-pager',
      onRendered: report => showCount('pairs', report),
    }),
    ips: createReportGrid({
      path: 'group-compare-reports/get-shared-ips',
      columns: sharedColumns('IP', ipExtra),
      sort: { item: 'TotalSessionCount', direction: 'Desc' },
      titleId: 'ips-title',
      title: 'Shared IPs',
      containerId: 'ips',
      pagerId: 'ips-pager',
      onRendered: report => showCount('ips', report),
      onRowClick: row => openDetails('Ip', row.value),
    }),
    cids: createReportGrid({
      path: 'group-compare-reports/get-shared-cids',
      columns: sharedColumns('CID', cidExtra),
      sort: { item: 'TotalSessionCount', direction: 'Desc' },
      titleId: 'cids-title',
      title: 'Shared CIDs',
      containerId: 'cids',
      pagerId: 'cids-pager',
      onRendered: report => showCount('cids', report),
      onRowClick: row => openDetails('Cid', row.value),
    }),
  };

  async function openDetails(column, value) {
    showTab('details');
    writeQuery({ ...Object.fromEntries(new URLSearchParams(location.search)), tab: currentTab });
    try {
      await guarded(document.getElementById('sessions'), () => grids.sessions.filterBy(column, value));
    } catch (error) {
      showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
    }
  }

  const formatTime = value => value ? formatUtc(value) : '—';
  const ofLogins = (count, side) => `${count} of ${side.loginCount}`;
  const percent = value => `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

  function renderOverview(overview) {
    const { main, other, shared } = overview;
    const evidence = GROUP_COMPARE_EVIDENCE[shared.evidence] ?? GROUP_COMPARE_EVIDENCE.None;

    const verdict = document.getElementById('verdict');
    const label = document.createElement('span');
    label.append('Evidence: ', badge(shared.evidence, evidence.kind));
    verdict.replaceChildren(label);
    document.getElementById('verdict-reason').textContent = evidence.text;

    const rows = [
      { metric: 'Logins with a shared IP', main: ofLogins(main.loginsWithSharedIpCount, main), other: ofLogins(other.loginsWithSharedIpCount, other) },
      { metric: 'Logins with a shared CID', main: ofLogins(main.loginsWithSharedCidCount, main), other: ofLogins(other.loginsWithSharedCidCount, other) },
      { metric: 'Sessions', main: main.sessionCount.toLocaleString('en-US'), other: other.sessionCount.toLocaleString('en-US') },
      { metric: 'Distinct IPs', main: main.distinctIpCount, other: other.distinctIpCount },
      { metric: 'Distinct CIDs', main: main.distinctCidCount, other: other.distinctCidCount },
      { metric: 'Shared IPs (share of its IPs)', main: `${shared.ipCount} (${percent(shared.mainIpSharePercent)})`, other: `${shared.ipCount} (${percent(shared.otherIpSharePercent)})` },
      { metric: 'Shared CIDs (share of its CIDs)', main: `${shared.cidCount} (${percent(shared.mainCidSharePercent)})`, other: `${shared.cidCount} (${percent(shared.otherCidSharePercent)})` },
      { metric: 'First login (UTC)', main: formatTime(main.firstLoginAt), other: formatTime(other.firstLoginAt) },
      { metric: 'Last login (UTC)', main: formatTime(main.lastLoginAt), other: formatTime(other.lastLoginAt) },
    ];
    renderTable(document.getElementById('sides'), sideColumns(), rows, undefined, { tools: false });

    renderSummary(document.getElementById('shared-facts'), [
      ['Shared IPs', shared.ipCount],
      ['of them VPN/proxy/Tor/datacenter', shared.anonymizedIpCount],
      ['Shared CIDs', shared.cidCount],
      ['of them invalid', shared.invalidCidCount],
      ['Linked login pairs', shared.linkedLoginPairCount],
      ['Both active together (UTC)', shared.activityOverlapStartUtc
        ? `${formatUtc(shared.activityOverlapStartUtc)} — ${formatUtc(shared.activityOverlapEndUtc)}`
        : 'No common period'],
    ]);
  }

  function clearResults() {
    resetCounts();
    for (const grid of Object.values(grids)) grid.clear();
    for (const id of ['verdict', 'sides', 'shared-facts', 'accounts-main', 'accounts-other', 'geo-details'])
      document.getElementById(id).replaceChildren();
    document.getElementById('verdict-reason').textContent = '';
  }

  function showAccounts(side, accounts) {
    renderTable(document.getElementById(`accounts-${side}`), groupCompareAccountColumns, accounts, undefined, { tools: false, export: { name: `${exportName}-${side}` } });
    document.getElementById(`accounts-${side}-title`).textContent = `Logins of ${names[side]} (${accounts.length})`;
  }

  // Compares the two login groups. names labels the sides; accounts are the rows of the Logins tab per side; isStale says
  // whether a newer search has started, so a late answer is not drawn over it.
  async function run({ sideNames, accounts, logins, otherLogins, fromUtc, toUtc }, isStale) {
    names = sideNames;
    sideOf = new Map([
      ...logins.map(login => [login, 'main']),
      ...otherLogins.map(login => [login, 'other']),
    ]);
    showAccounts('main', accounts.main);
    showAccounts('other', accounts.other);

    message.textContent = 'Comparing...';
    const params = { logins, otherLogins, fromUtc, toUtc };
    const [overview] = await Promise.all([
      apiGet('group-compare-reports/get-overview', params),
      ...Object.values(grids).map(grid => grid.start(params)),
    ]);
    if (isStale()) return;
    renderOverview(overview);
    message.textContent = '';
  }

  document.getElementById('tabs').addEventListener('click', event => {
    const tab = event.target.closest('button')?.dataset.tab;
    if (!tab) return;
    showTab(tab);
    if (location.search) writeState(Object.fromEntries(new URLSearchParams(location.search)));
  });

  showTab(new URLSearchParams(location.search).get('tab'));

  return { run, clearResults, writeState };
}
