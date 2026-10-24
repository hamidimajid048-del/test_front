// Compare page: two logins side by side. An overview plus lists of what they share (IPs, CIDs), sessions that
// started close to each other or overlapped, a merged time line, and the sessions of each login.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const rangeControls = initRangeControls(form);

const DEFAULT_PAGE_SIZE = 100;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;

const MATCH_LABELS = { Ip: 'Same IP', Subnet: 'Same network', Asn: 'Same ASN' };
const MATCH_KINDS = { Ip: 'danger', Subnet: 'warn', Asn: 'muted' };
const MATCH_PHRASES = { Ip: 'same IP', Subnet: 'same network', Asn: 'same ASN' };

// What the page is currently comparing: set when the form is submitted.
let context = null;
let activeTab = 'shared-ips';
const states = {};

// ---- formatting ----

// 3725 -> "1h 2m 5s"
function formatSpan(totalSeconds) {
  let remaining = Math.round(Math.abs(totalSeconds));
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (hours || minutes) parts.push(`${minutes}m`);
  parts.push(`${remaining % 60}s`);
  return parts.join(' ');
}

// The compared login's time minus the main login's: negative when the compared one came first.
const formatGap = seconds => `${seconds < 0 ? '-' : '+'}${formatSpan(seconds)}`;

const yesBadge = (value, kind) => value ? badge('Yes', kind) : 'No';

// "Name (n), Name (n) +2 more"
function topList(counts, limit = 4) {
  if (!counts?.length) return '—';
  const shown = counts.slice(0, limit).map(count => `${count.name} (${count.count})`).join(', ');
  return counts.length > limit ? `${shown} +${counts.length - limit} more` : shown;
}

// ---- columns ----

const SHARED_VALUE_COLUMNS = [
  { key: 'loginCount', title: 'Logins', sortKey: 'LoginCount' },
  { key: 'otherLoginCount', title: 'Compared logins', sortKey: 'RelatedLoginCount' },
  { ...utcColumn('firstSeenUtc', 'First seen'), sortKey: 'FirstSeenUtc' },
  { ...utcColumn('lastSeenUtc', 'Last seen'), sortKey: 'LastSeenUtc' },
  { ...utcColumn('otherFirstSeenUtc', 'Compared first seen'), sortKey: 'RelatedFirstSeenUtc' },
  { ...utcColumn('otherLastSeenUtc', 'Compared last seen'), sortKey: 'RelatedLastSeenUtc' },
  { key: 'occurrenceDays', title: 'Occurrence days', sortKey: 'OccurrenceDays' },
  { key: 'coOccurrenceDays', title: 'Co-occurrence days', sortKey: 'CoOccurrenceDays' },
];

const SHARED_IP_COLUMNS = [
  { key: 'value', title: 'IP', sortKey: 'Value' },
  { key: 'geo', title: 'Country / city', format: geo => geo ? [geo.country, geo.city].filter(Boolean).join(' / ') : '—' },
  { key: 'geo', title: 'ISP', format: geo => geo?.isp ?? '—' },
  { key: 'geo', title: 'ASN', format: geo => geo && geo.asn > 0 ? geo.asn : '—' },
  { key: 'geo', title: 'Warnings', format: warningBadges },
  ...SHARED_VALUE_COLUMNS,
];

const SHARED_CID_COLUMNS = [
  { key: 'value', title: 'CID', sortKey: 'Value' },
  {
    key: 'isCidValid',
    title: 'Valid',
    format: valid => valid === true ? badge('Valid', 'ok') : valid === false ? badge('Invalid', 'danger') : '—',
  },
  {
    key: 'platforms',
    title: 'Platforms',
    format: platforms => platforms?.length ? inline(...platforms.map(platform => badge(platform))) : '—',
  },
  ...SHARED_VALUE_COLUMNS,
];

const NEAR_COLUMNS = [
  { ...utcColumn('loginAt', 'Login'), group: 'Main', sortKey: 'LoginAt' },
  { key: 'ip', title: 'IP', group: 'Main', filterKey: 'Ip' },
  { key: 'cid', title: 'CID', group: 'Main', filterKey: 'Cid' },
  { key: 'platform', title: 'Platform', group: 'Main', filterKey: 'Platform' },
  { ...utcColumn('otherLoginAt', 'Login'), group: 'Compared', filterKey: 'OtherLoginAt' },
  { key: 'otherIp', title: 'IP', group: 'Compared', filterKey: 'OtherIp' },
  { key: 'otherCid', title: 'CID', group: 'Compared', filterKey: 'OtherCid' },
  { key: 'otherPlatform', title: 'Platform', group: 'Compared', filterKey: 'OtherPlatform' },
  { key: 'deltaSeconds', title: 'Gap', format: formatGap, sortKey: 'DeltaSeconds' },
  { key: 'matchLevel', title: 'Match', format: level => badge(MATCH_LABELS[level] ?? level, MATCH_KINDS[level]), filterKey: 'MatchLevel' },
  { key: 'sameCid', title: 'Same CID', format: same => yesBadge(same, 'danger'), filterKey: 'SameCid' },
  { key: 'sameDevice', title: 'Same device', format: same => yesBadge(same, 'warn'), filterKey: 'SameDevice' },
];

const OVERLAP_COLUMNS = [
  { ...utcColumn('loginAt', 'Login'), group: 'Main', sortKey: 'LoginAt' },
  { ...utcColumn('logoutAt', 'Logout'), group: 'Main', filterKey: 'LogoutAt' },
  { key: 'ip', title: 'IP', group: 'Main', filterKey: 'Ip' },
  { key: 'cid', title: 'CID', group: 'Main', filterKey: 'Cid' },
  { ...utcColumn('otherLoginAt', 'Login'), group: 'Compared', filterKey: 'OtherLoginAt' },
  { ...utcColumn('otherLogoutAt', 'Logout'), group: 'Compared', filterKey: 'OtherLogoutAt' },
  { key: 'otherIp', title: 'IP', group: 'Compared', filterKey: 'OtherIp' },
  { key: 'otherCid', title: 'CID', group: 'Compared', filterKey: 'OtherCid' },
  { ...utcColumn('overlapStartUtc', 'From'), group: 'Overlap', filterKey: 'OverlapStartUtc' },
  { ...utcColumn('overlapEndUtc', 'To'), group: 'Overlap', filterKey: 'OverlapEndUtc' },
  { key: 'overlapSeconds', title: 'Duration', group: 'Overlap', format: formatSpan, sortKey: 'OverlapSeconds' },
  { key: 'sameIp', title: 'Same IP', format: same => yesBadge(same, 'danger'), filterKey: 'SameIp' },
  { key: 'sameCid', title: 'Same CID', format: same => yesBadge(same, 'warn'), filterKey: 'SameCid' },
];

const TIMELINE_COLUMNS = [
  {
    key: 'side',
    title: 'Account',
    format: side => side === 'Main' ? badge('Main', 'main') : badge('Compared', 'compared'),
    filterKey: 'Side',
  },
  { ...utcColumn('loginAt', 'Login'), sortKey: 'LoginAt' },
  { ...utcColumn('logoutAt', 'Logout'), filterKey: 'LogoutAt' },
  { key: 'ip', title: 'IP', filterKey: 'Ip' },
  { key: 'cid', title: 'CID', filterKey: 'Cid' },
  { key: 'platform', title: 'Platform', filterKey: 'Platform' },
  { key: 'sharedIp', title: 'Shared IP', format: shared => shared ? badge('IP', 'danger') : '', filterKey: 'SharedIp' },
  { key: 'sharedCid', title: 'Shared CID', format: shared => shared ? badge('CID', 'warn') : '', filterKey: 'SharedCid' },
];

// ---- tabs ----

const direction = (value, labels = ['Descending', 'Ascending']) => ({
  name: 'sortDirection',
  label: 'Direction',
  kind: 'select',
  value,
  options: [['Desc', labels[0]], ['Asc', labels[1]]],
});

// The sessions of one login are ordered by the service like the other tabs (newest login first by default).
const SESSION_CONTROLS = () => [
  { name: 'sortItem', label: 'Sort by', kind: 'select', value: 'LoginAt', options: [] },
  direction('Desc'),
];

const COMPARE_PATH = 'compare-reports';
const rangeParams = c => ({ fromUtc: c.fromUtc, toUtc: c.toUtc });
const compareParams = c => ({ login: c.login, otherLogin: c.other, ...rangeParams(c) });
const proximityParams = c => ({ ...compareParams(c), windowSeconds: c.windowSeconds, matchLevel: c.match });

const TABS = [
  {
    key: 'shared-ips',
    title: 'Shared IPs',
    path: `${COMPARE_PATH}/get-shared-ips`,
    exportPath: 'shared-ips',
    params: compareParams,
    columns: SHARED_IP_COLUMNS,
    controls: [
      {
        name: 'sortItem', label: 'Sort by', kind: 'select', value: 'RelatedLoginCount',
        options: [
          ['RelatedLoginCount', 'Compared logins'], ['Value', 'IP'], ['LoginCount', 'Logins'],
          ['FirstSeenUtc', 'First seen'], ['LastSeenUtc', 'Last seen'],
          ['OccurrenceDays', 'Occurrence days'], ['CoOccurrenceDays', 'Co-occurrence days'],
        ],
      },
      direction('Desc'),
      { name: 'value', label: 'IP (exact)', kind: 'text' },
    ],
    empty: 'The two logins share no IP in this range',
  },
  {
    key: 'shared-cids',
    title: 'Shared CIDs',
    path: `${COMPARE_PATH}/get-shared-cids`,
    exportPath: 'shared-cids',
    params: compareParams,
    columns: SHARED_CID_COLUMNS,
    controls: [
      {
        name: 'sortItem', label: 'Sort by', kind: 'select', value: 'RelatedLoginCount',
        options: [
          ['RelatedLoginCount', 'Compared logins'], ['Value', 'CID'], ['LoginCount', 'Logins'],
          ['FirstSeenUtc', 'First seen'], ['LastSeenUtc', 'Last seen'],
          ['OccurrenceDays', 'Occurrence days'], ['CoOccurrenceDays', 'Co-occurrence days'],
        ],
      },
      direction('Desc'),
      { name: 'value', label: 'CID (exact)', kind: 'text' },
    ],
    empty: 'The two logins share no CID in this range',
  },
  {
    key: 'near-logins',
    title: 'Near logins',
    path: `${COMPARE_PATH}/get-near-logins`,
    exportPath: 'near-logins',
    params: proximityParams,
    columns: NEAR_COLUMNS,
    controls: [
      {
        name: 'sortItem', label: 'Sort by', kind: 'select', value: 'DeltaSeconds',
        options: [['DeltaSeconds', 'Smallest gap'], ['LoginAt', 'Main login time']],
      },
      direction('Asc', ['Descending', 'Ascending']),
    ],
    describe: c => `Logins of the two accounts that started within ${formatSpan(c.windowSeconds)} of each other with a matching address (${MATCH_PHRASES[c.match]}).`,
    empty: 'No logins of the two accounts started close to each other with a matching address',
  },
  {
    key: 'overlapping-sessions',
    title: 'Overlapping sessions',
    path: `${COMPARE_PATH}/get-overlapping-sessions`,
    params: compareParams,
    columns: OVERLAP_COLUMNS,
    controls: [
      {
        name: 'sortItem', label: 'Sort by', kind: 'select', value: 'OverlapSeconds',
        options: [['OverlapSeconds', 'Overlap duration'], ['LoginAt', 'Main login time']],
      },
      direction('Desc'),
    ],
    describe: () => 'Sessions of the two accounts that were open at the same time.',
    notes: report => report.metadata.sessionsWithoutLogout > 0
      ? `${report.metadata.sessionsWithoutLogout} sessions have no recorded logout, so they cannot be tested for overlap.`
      : '',
    empty: 'No sessions of the two accounts were open at the same time',
  },
  {
    key: 'timeline',
    title: 'Timeline',
    path: `${COMPARE_PATH}/get-timeline`,
    params: compareParams,
    columns: TIMELINE_COLUMNS,
    controls: [
      direction('Desc', ['Newest first', 'Oldest first']),
      { name: 'sharedOnly', label: 'Only sessions sharing an IP or CID', kind: 'checkbox' },
    ],
    describe: () => 'Every session of both accounts in one list.',
    empty: 'No sessions in this range',
  },
  {
    key: 'sessions-main',
    title: 'Sessions (main)',
    path: 'login-reports/get-login-sessions',
    params: c => ({ login: c.login, ...rangeParams(c) }),
    columns: SESSION_COLUMNS,
    controls: SESSION_CONTROLS(),
    geoDetails: true,
    empty: 'No sessions in this range',
  },
  {
    key: 'sessions-compared',
    title: 'Sessions (compared)',
    path: 'login-reports/get-login-sessions',
    params: c => ({ login: c.other, ...rangeParams(c) }),
    columns: SESSION_COLUMNS,
    controls: SESSION_CONTROLS(),
    geoDetails: true,
    empty: 'No sessions in this range',
  },
];

const tabByKey = key => TABS.find(tab => tab.key === key);

// The "Sort by" choices of a tab are its sortable columns, the default one first, so a header click can always be shown.
function sortOptions(columns, first) {
  const options = new Map();
  for (const column of columns) {
    if (column.sortKey && !options.has(column.sortKey)) {
      options.set(column.sortKey, column.group ? `${column.group} · ${column.title}` : column.title);
    }
  }
  return [...options].sort(([a], [b]) => (b === first) - (a === first));
}

for (const tab of TABS) {
  const control = tab.controls.find(candidate => candidate.name === 'sortItem');
  if (control && !control.options.length) control.options = sortOptions(tab.columns, control.value);
}

function stateOf(tab) {
  states[tab.key] ??= {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    report: null,
    columnFilters: {}, // typed under the table headers; the server applies them to every page
    controls: Object.fromEntries(tab.controls.map(control => [control.name, control.value ?? ''])),
  };
  return states[tab.key];
}

function controlParams(tab, state) {
  const params = {};
  for (const control of tab.controls) {
    const value = state.controls[control.name];
    if (value === '' || value === false || value === undefined) continue;
    params[control.name] = value === true ? 'true' : value;
  }
  return params;
}

function controlElement(tab, control, state, onChange) {
  const label = document.createElement('label');
  label.append(control.label);
  let input;
  if (control.kind === 'select') {
    input = document.createElement('select');
    for (const [value, text] of control.options) input.add(new Option(text, value));
    input.value = state.controls[control.name];
  } else if (control.kind === 'checkbox') {
    label.className = 'check';
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.controls[control.name] === true;
  } else {
    input = document.createElement('input');
    input.type = control.kind === 'number' ? 'number' : 'text';
    if (control.kind === 'number') {
      input.min = '0';
      input.step = '1';
    }
    input.value = state.controls[control.name];
  }
  input.name = control.name;
  input.addEventListener('change', () => {
    state.controls[control.name] = control.kind === 'checkbox' ? input.checked : input.value.trim();
    onChange();
  });
  label.append(input);
  return label;
}

function renderTabs() {
  document.getElementById('tabs').replaceChildren(...TABS.map(tab => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tab.title;
    button.classList.toggle('active', tab.key === activeTab);
    button.addEventListener('click', () => selectTab(tab.key));
    return button;
  }));
}

function selectTab(key) {
  activeTab = key;
  renderTabs();
  showPanel();
  writeState();
}

// Builds the active tab's toolbar and result area, and loads its data when it has none yet.
function showPanel() {
  const tab = tabByKey(activeTab);
  const state = stateOf(tab);
  const panel = document.getElementById('tab-panel');

  const toolbar = document.createElement('form');
  toolbar.className = 'filters';
  const tabMessage = document.createElement('p');
  tabMessage.className = 'message';
  const exportMessage = document.createElement('p');
  exportMessage.className = 'message';

  const reload = () => {
    state.page = 1;
    toolbar.requestSubmit();
  };
  for (const control of tab.controls) toolbar.append(controlElement(tab, control, state, () => { if (control.kind !== 'text' && control.kind !== 'number') reload(); }));

  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.textContent = tab.controls.length ? 'Apply' : 'Reload';
  toolbar.append(apply);
  toolbar.addEventListener('submit', event => {
    event.preventDefault();
    state.page = 1; // a new filter or sort starts from the first page, whatever page the old result was on
    load(tab, state, toolbar, tabMessage, parts);
  });

  const exports = document.createElement('div');
  exports.className = 'actions';
  if (tab.exportPath) {
    for (const [format, text] of [['Csv', 'CSV'], ['Xlsx', 'Excel']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', () => {
        downloadExport(
          `${COMPARE_PATH}/export-${tab.exportPath}`,
          { ...tab.params(context), ...controlParams(tab, state), ...columnFilterParams(state.columnFilters), format },
          button,
          exportMessage);
      });
      exports.append(button);
    }
  }

  const parts = {
    description: document.createElement('p'),
    note: document.createElement('p'),
    summary: document.createElement('div'),
    table: document.createElement('div'),
    pager: document.createElement('div'),
    detail: document.createElement('div'),
  };
  parts.description.className = 'hint';
  parts.note.className = 'hint';
  parts.summary.className = 'summary';

  const head = document.createElement('div');
  head.className = 'section-head';
  const title = document.createElement('h2');
  title.textContent = tab.title;
  head.append(title, exports);

  panel.replaceChildren(head, toolbar, tabMessage, exportMessage, parts.description, parts.summary, parts.note, parts.table, parts.pager, parts.detail);
  if (state.report) render(tab, state, toolbar, tabMessage, parts);
  else load(tab, state, toolbar, tabMessage, parts);
}

async function load(tab, state, toolbar, tabMessage, parts) {
  const token = context;
  await withLoading(toolbar, tabMessage, async () => {
    const report = await apiGet(tab.path, {
      ...tab.params(context),
      ...controlParams(tab, state),
      ...columnFilterParams(state.columnFilters),
      currentPage: state.page,
      pageSize: state.pageSize,
    });
    if (token !== context) return; // another comparison was started while this one was loading
    state.report = report;
    const paging = pagingOf(report.paging);
    state.page = paging?.currentPage ?? state.page;
    state.pageSize = paging?.pageSize ?? state.pageSize;
    if (activeTab === tab.key) render(tab, state, toolbar, tabMessage, parts);
  });
}

// Header-click sorting of a tab: the report's sort item and direction live in the tab's toolbar controls. A tab
// with only a direction control (the timeline) sorts by its time column. Tabs with a fixed order sort the page on screen.
function tabSort(tab, state, toolbar, tabMessage, parts) {
  const hasDirection = tab.controls.some(control => control.name === 'sortDirection');
  if (!hasDirection) return null;
  const hasItem = tab.controls.some(control => control.name === 'sortItem');
  return {
    item: hasItem ? state.controls.sortItem : 'LoginAt',
    direction: state.controls.sortDirection,
    onChange: (item, direction) => {
      if (hasItem) state.controls.sortItem = item;
      state.controls.sortDirection = direction;
      setSortFields(toolbar, hasItem ? item : undefined, direction);
      state.page = 1;
      return load(tab, state, toolbar, tabMessage, parts);
    },
  };
}

// Header filters of a tab: the typed texts go to the server with the sort, so they narrow every page.
function tabFilter(tab, state, toolbar, tabMessage, parts) {
  if (!tab.columns.some(column => column.sortKey || column.filterKey)) return null;
  return {
    values: state.columnFilters,
    onChange: values => {
      state.columnFilters = values;
      state.page = 1;
      return load(tab, state, toolbar, tabMessage, parts);
    },
  };
}

function render(tab, state, toolbar, tabMessage, parts) {
  const report = state.report;
  const paging = pagingOf(report.paging);

  parts.description.textContent = tab.describe ? tab.describe(context) : '';
  parts.note.textContent = tab.notes ? tab.notes(report) : '';
  renderSummary(parts.summary, report.metadata.rowCount === undefined
    ? [['Login', report.metadata.login]]
    : [['Rows', report.metadata.rowCount]]);

  renderTable(
    parts.table,
    tab.columns,
    report.items,
    tab.geoDetails ? session => renderGeoDetails(parts.detail, session) : undefined,
    {
      sort: tabSort(tab, state, toolbar, tabMessage, parts),
      filter: tabFilter(tab, state, toolbar, tabMessage, parts),
    });
  if (!report.items?.length && !Object.values(state.columnFilters).some(Boolean)) {
    parts.table.querySelector('td.empty').textContent = tab.empty;
  }
  parts.detail.replaceChildren();

  renderPager(parts.pager, paging, (page, pageSize) => {
    state.page = page;
    state.pageSize = pageSize;
    return load(tab, state, toolbar, tabMessage, parts);
  });
  writeState();
}

// ---- overview ----

const profileLink = login => actionLink('Profile', `/logins.html?login=${encodeURIComponent(login)}`);

function tradeLink(kind, label) {
  const query = new URLSearchParams({
    kind, login: context.login, secondsBefore: '5', secondsAfter: '5', minCountShare: '1',
    sortItem: 'CountShare', sortDirection: 'Desc', currentPage: '1', pageSize: String(DEFAULT_PAGE_SIZE),
    p_relatedLogin: context.other, p_sortItem: 'MainOpenTime', p_sortDirection: 'Asc', p_currentPage: '1',
    p_pageSize: String(DEFAULT_PAGE_SIZE),
  });
  if (kind === 'hedge') query.set('volumeTolerancePercent', '10');
  if (context.fromDay && context.toDay) {
    query.set('range', 'custom');
    query.set('fromUtc', context.fromDay);
    query.set('toUtc', context.toDay);
  }
  return actionLink(label, `/copy-trade.html?${query}`);
}

function swapLink() {
  const query = new URLSearchParams(location.search);
  query.set('login', context.other);
  query.set('other', context.login);
  query.set('tab', activeTab);
  query.delete('currentPage');
  query.delete('pageSize');
  return actionLink('Swap accounts', `/compare.html?${query}`);
}

function renderSignals(shared) {
  const signals = [
    [shared.ipCount, 'shared IPs', 'shared-ips'],
    [shared.cidCount, 'shared CIDs', 'shared-cids'],
    [shared.coOccurrenceDays, 'shared active days', 'timeline'],
    [shared.nearLoginPairCount, 'near logins', 'near-logins'],
    [shared.overlappingSessionCount, 'overlapping sessions', 'overlapping-sessions'],
  ];
  document.getElementById('signals').replaceChildren(...signals.map(([count, text, tab]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = count > 0 ? 'signal hot' : 'signal';
    const number = document.createElement('strong');
    number.textContent = count;
    button.append(number, ` ${text}`);
    button.addEventListener('click', () => selectTab(tab));
    return button;
  }));
}

function renderOverview(report) {
  const [main, other] = report.accounts;
  const { shared } = report;

  const actions = document.getElementById('overview-actions');
  actions.replaceChildren(
    inline(`Main ${main.login}`, profileLink(main.login)),
    inline(`Compared ${other.login}`, profileLink(other.login)),
    tradeLink('copy-trade', 'Copy trade'),
    tradeLink('hedge', 'Hedge'),
    swapLink());

  renderSignals(shared);

  const both = shared.activityOverlapStartUtc
    ? `Both active ${formatUtc(shared.activityOverlapStartUtc)} to ${formatUtc(shared.activityOverlapEndUtc)}`
    : 'The accounts were never active in the same period';
  const rows = [
    { metric: 'Sessions', main: main.sessionCount, other: other.sessionCount, shared: '' },
    { metric: 'First login (UTC)', main: formatUtc(main.firstLoginAt) || '—', other: formatUtc(other.firstLoginAt) || '—', shared: both },
    { metric: 'Last login (UTC)', main: formatUtc(main.lastLoginAt) || '—', other: formatUtc(other.lastLoginAt) || '—', shared: '' },
    { metric: 'Active days', main: main.activeDays, other: other.activeDays, shared: `${shared.coOccurrenceDays} days with both active` },
    { metric: 'Distinct IPs', main: main.distinctIpCount, other: other.distinctIpCount, shared: `${shared.ipCount} shared` },
    { metric: 'Distinct CIDs', main: main.distinctCidCount, other: other.distinctCidCount, shared: `${shared.cidCount} shared` },
    { metric: 'Platforms', main: topList(main.platforms), other: topList(other.platforms), shared: shared.platforms.join(', ') || '—' },
    { metric: 'Countries', main: topList(main.countries), other: topList(other.countries), shared: shared.countries.join(', ') || '—' },
    { metric: 'Sessions without logout', main: main.sessionsWithoutLogout, other: other.sessionsWithoutLogout, shared: '' },
    {
      metric: 'Near logins',
      main: '',
      other: '',
      shared: `${shared.nearLoginPairCount} pairs within ${formatSpan(report.metadata.windowSeconds)} (${MATCH_PHRASES[report.metadata.matchLevel]})`,
    },
    { metric: 'Overlapping sessions', main: '', other: '', shared: String(shared.overlappingSessionCount) },
  ];
  renderTable(document.getElementById('overview'), [
    { key: 'metric', title: 'Metric' },
    { key: 'main', title: `Main · ${main.login}` },
    { key: 'other', title: `Compared · ${other.login}` },
    { key: 'shared', title: 'Shared' },
  ], rows, undefined, { tools: false });
  document.getElementById('overview-section').hidden = false;
}

// ---- form ----

function syncWindowField() {
  document.getElementById('window-custom').hidden = form.elements.windowPreset.value !== 'custom';
}

// The inputs of one comparison, validated; throws an ApiError with field errors when they are not usable.
function readContext() {
  const values = formValues(form);
  if (values.login === values.other) {
    throw new ApiError('Choose two different logins', { other: ['Must differ from the main login'] });
  }
  validateRange(values);

  const custom = values.windowPreset === 'custom';
  const windowSeconds = Number(custom ? values.windowSeconds : values.windowPreset);
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > MAX_WINDOW_SECONDS) {
    throw new ApiError('The proximity window is not valid', { windowSeconds: ['Enter 1 to 604800 seconds'] });
  }

  return {
    login: values.login,
    other: values.other,
    fromDay: values.fromUtc,
    toDay: values.toUtc,
    fromUtc: fromDayParam(values.fromUtc),
    toUtc: toDayParam(values.toUtc),
    windowSeconds,
    match: values.match ?? 'Ip',
  };
}

function writeState() {
  if (!context) return;
  const state = stateOf(tabByKey(activeTab));
  writeQuery({
    login: context.login,
    other: context.other,
    range: form.elements.range.value,
    fromUtc: context.fromDay,
    toUtc: context.toDay,
    windowPreset: form.elements.windowPreset.value,
    windowSeconds: form.elements.windowPreset.value === 'custom' ? context.windowSeconds : undefined,
    match: context.match,
    tab: activeTab,
    currentPage: state.page,
    pageSize: state.pageSize,
  });
}

// Starts a comparison from the form; `page` and `pageSize` are for the active tab (used when restoring a link).
async function run(page, pageSize) {
  await withLoading(form, message, async () => {
    context = readContext();
    for (const key of Object.keys(states)) delete states[key];
    Object.assign(stateOf(tabByKey(activeTab)), { page, pageSize });

    const overview = await apiGet(`${COMPARE_PATH}/get-overview`, {
      ...compareParams(context),
      windowSeconds: context.windowSeconds,
      matchLevel: context.match,
    });
    renderOverview(overview);
    document.getElementById('tabs-section').hidden = false;
    renderTabs();
    showPanel();
  });
}

form.elements.windowPreset.addEventListener('change', syncWindowField);
form.addEventListener('submit', event => {
  event.preventDefault();
  run(1, DEFAULT_PAGE_SIZE);
});

renderMenu();
rangeControls.sync();
if (fillFormFromQuery(form) && form.elements.login.value && form.elements.other.value) {
  const query = new URLSearchParams(location.search);
  syncWindowField();
  rangeControls.restore();
  if (tabByKey(query.get('tab'))) activeTab = query.get('tab');
  run(Number(query.get('currentPage')) || 1, Number(query.get('pageSize')) || DEFAULT_PAGE_SIZE);
}
