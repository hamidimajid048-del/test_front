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
  { key: 'logCount', title: 'Logs' },
  { key: 'otherLogCount', title: 'Compared logs' },
  { key: 'effectiveRepeatCount', title: 'Effective repeats' },
  utcColumn('firstSeenUtc', 'First seen'),
  utcColumn('lastSeenUtc', 'Last seen'),
  utcColumn('otherFirstSeenUtc', 'Compared first seen'),
  utcColumn('otherLastSeenUtc', 'Compared last seen'),
  { key: 'occurrenceDays', title: 'Occurrence days' },
  { key: 'coOccurrenceDays', title: 'Co-occurrence days' },
];

const SHARED_IP_COLUMNS = [
  { key: 'value', title: 'IP' },
  { key: 'geo', title: 'Country / city', format: geo => geo ? [geo.country, geo.city].filter(Boolean).join(' / ') : '—' },
  { key: 'geo', title: 'ISP', format: geo => geo?.isp ?? '—' },
  { key: 'geo', title: 'ASN', format: geo => geo && geo.asn > 0 ? geo.asn : '—' },
  { key: 'geo', title: 'Warnings', format: warningBadges },
  ...SHARED_VALUE_COLUMNS,
];

const SHARED_CID_COLUMNS = [
  { key: 'value', title: 'CID' },
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
  { ...utcColumn('loginAt', 'Login'), group: 'Main' },
  { key: 'ip', title: 'IP', group: 'Main' },
  { key: 'cid', title: 'CID', group: 'Main' },
  { key: 'platform', title: 'Platform', group: 'Main' },
  { ...utcColumn('otherLoginAt', 'Login'), group: 'Compared' },
  { key: 'otherIp', title: 'IP', group: 'Compared' },
  { key: 'otherCid', title: 'CID', group: 'Compared' },
  { key: 'otherPlatform', title: 'Platform', group: 'Compared' },
  { key: 'deltaSeconds', title: 'Gap', format: formatGap },
  { key: 'matchLevel', title: 'Match', format: level => badge(MATCH_LABELS[level] ?? level, MATCH_KINDS[level]) },
  { key: 'sameCid', title: 'Same CID', format: same => yesBadge(same, 'danger') },
  { key: 'sameDevice', title: 'Same device', format: same => yesBadge(same, 'warn') },
];

const OVERLAP_COLUMNS = [
  { ...utcColumn('loginAt', 'Login'), group: 'Main' },
  { ...utcColumn('logoutAt', 'Logout'), group: 'Main' },
  { key: 'ip', title: 'IP', group: 'Main' },
  { key: 'cid', title: 'CID', group: 'Main' },
  { ...utcColumn('otherLoginAt', 'Login'), group: 'Compared' },
  { ...utcColumn('otherLogoutAt', 'Logout'), group: 'Compared' },
  { key: 'otherIp', title: 'IP', group: 'Compared' },
  { key: 'otherCid', title: 'CID', group: 'Compared' },
  { ...utcColumn('overlapStartUtc', 'From'), group: 'Overlap' },
  { ...utcColumn('overlapEndUtc', 'To'), group: 'Overlap' },
  { key: 'overlapSeconds', title: 'Duration', group: 'Overlap', format: formatSpan },
  { key: 'sameIp', title: 'Same IP', format: same => yesBadge(same, 'danger') },
  { key: 'sameCid', title: 'Same CID', format: same => yesBadge(same, 'warn') },
];

const TIMELINE_COLUMNS = [
  {
    key: 'side',
    title: 'Account',
    format: side => side === 'Main' ? badge('Main', 'main') : badge('Compared', 'compared'),
  },
  utcColumn('loginAt', 'Login'),
  utcColumn('logoutAt', 'Logout'),
  { key: 'ip', title: 'IP' },
  { key: 'cid', title: 'CID' },
  { key: 'platform', title: 'Platform' },
  {
    key: 'sharedIp',
    title: 'Shared with the other',
    format: (_, row) => {
      const shared = [row.sharedIp && badge('IP', 'danger'), row.sharedCid && badge('CID', 'warn')].filter(Boolean);
      return shared.length ? inline(...shared) : '';
    },
  },
];

// ---- tabs ----

const direction = (value, labels = ['Descending', 'Ascending']) => ({
  name: 'sortDirection',
  label: 'Direction',
  kind: 'select',
  value,
  options: [['Desc', labels[0]], ['Asc', labels[1]]],
});

const compareBase = (c) => `reports/compare/${c.login}/${c.other}`;
const rangeParams = c => ({ fromUtc: c.fromUtc, toUtc: c.toUtc });
const proximityParams = c => ({ ...rangeParams(c), windowSeconds: c.windowSeconds, matchLevel: c.match });

const TABS = [
  {
    key: 'shared-ips',
    title: 'Shared IPs',
    path: c => `${compareBase(c)}/shared-ips`,
    exportPath: 'shared-ips',
    params: rangeParams,
    columns: SHARED_IP_COLUMNS,
    controls: [
      {
        name: 'sortBy', label: 'Sort by', kind: 'select', value: 'EffectiveRepeatCount',
        options: [
          ['EffectiveRepeatCount', 'Effective repeats'], ['Value', 'IP'], ['LogCount', 'Logs'],
          ['RelatedLogCount', 'Compared logs'], ['FirstSeenUtc', 'First seen'], ['LastSeenUtc', 'Last seen'],
          ['OccurrenceDays', 'Occurrence days'], ['CoOccurrenceDays', 'Co-occurrence days'],
        ],
      },
      direction('Desc'),
      { name: 'value', label: 'IP (exact)', kind: 'text' },
      { name: 'minEffectiveRepeatCount', label: 'Min effective repeats', kind: 'number' },
    ],
    empty: 'The two logins share no IP in this range',
  },
  {
    key: 'shared-cids',
    title: 'Shared CIDs',
    path: c => `${compareBase(c)}/shared-cids`,
    exportPath: 'shared-cids',
    params: rangeParams,
    columns: SHARED_CID_COLUMNS,
    controls: [
      {
        name: 'sortBy', label: 'Sort by', kind: 'select', value: 'EffectiveRepeatCount',
        options: [
          ['EffectiveRepeatCount', 'Effective repeats'], ['Value', 'CID'], ['LogCount', 'Logs'],
          ['RelatedLogCount', 'Compared logs'], ['FirstSeenUtc', 'First seen'], ['LastSeenUtc', 'Last seen'],
          ['OccurrenceDays', 'Occurrence days'], ['CoOccurrenceDays', 'Co-occurrence days'],
        ],
      },
      direction('Desc'),
      { name: 'value', label: 'CID (exact)', kind: 'text' },
      { name: 'minEffectiveRepeatCount', label: 'Min effective repeats', kind: 'number' },
    ],
    empty: 'The two logins share no CID in this range',
  },
  {
    key: 'near-logins',
    title: 'Near logins',
    path: c => `${compareBase(c)}/near-logins`,
    exportPath: 'near-logins',
    params: proximityParams,
    columns: NEAR_COLUMNS,
    controls: [
      {
        name: 'sortBy', label: 'Sort by', kind: 'select', value: 'DeltaSeconds',
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
    path: c => `${compareBase(c)}/overlapping-sessions`,
    params: rangeParams,
    columns: OVERLAP_COLUMNS,
    controls: [
      {
        name: 'sortBy', label: 'Sort by', kind: 'select', value: 'OverlapSeconds',
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
    path: c => `${compareBase(c)}/timeline`,
    params: rangeParams,
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
    path: c => `reports/logins/${c.login}/sessions`,
    params: rangeParams,
    columns: SESSION_COLUMNS,
    controls: [],
    geoDetails: true,
    empty: 'No sessions in this range',
  },
  {
    key: 'sessions-compared',
    title: 'Sessions (compared)',
    path: c => `reports/logins/${c.other}/sessions`,
    params: rangeParams,
    columns: SESSION_COLUMNS,
    controls: [],
    geoDetails: true,
    empty: 'No sessions in this range',
  },
];

const tabByKey = key => TABS.find(tab => tab.key === key);

function stateOf(tab) {
  states[tab.key] ??= {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    report: null,
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
          `${compareBase(context)}/${tab.exportPath}/export`,
          { ...tab.params(context), ...controlParams(tab, state), format },
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
    const report = await apiGet(tab.path(context), {
      ...tab.params(context),
      ...controlParams(tab, state),
      currentPage: state.page,
      pageSize: state.pageSize,
    });
    if (token !== context) return; // another comparison was started while this one was loading
    state.report = report;
    const paging = report.paging?.normalPagingResponse;
    state.page = paging?.currentPage ?? state.page;
    state.pageSize = paging?.pageSize ?? state.pageSize;
    if (activeTab === tab.key) render(tab, state, toolbar, tabMessage, parts);
  });
}

function render(tab, state, toolbar, tabMessage, parts) {
  const report = state.report;
  const paging = report.paging?.normalPagingResponse;

  parts.description.textContent = tab.describe ? tab.describe(context) : '';
  parts.note.textContent = tab.notes ? tab.notes(report) : '';
  renderSummary(parts.summary, report.metadata.rowCount === undefined
    ? [['Login', report.metadata.login]]
    : [['Rows', report.metadata.rowCount]]);

  renderTable(
    parts.table,
    tab.columns,
    report.items,
    tab.geoDetails ? session => renderGeoDetails(parts.detail, session) : undefined);
  if (!report.items?.length) {
    parts.table.querySelector('td.empty').textContent = tab.empty;
  }
  parts.detail.replaceChildren();

  renderPager(parts.pager, paging, (page, pageSize) => {
    state.page = page;
    state.pageSize = pageSize;
    load(tab, state, toolbar, tabMessage, parts);
  });
  writeState();
}

// ---- overview ----

const profileLink = login => actionLink('Profile', `/logins.html?login=${encodeURIComponent(login)}`);

function tradeLink(kind, label) {
  const query = new URLSearchParams({
    kind, login: context.login, secondsBefore: '5', secondsAfter: '5', minCountShare: '1',
    sortBy: 'CountShare', sortDirection: 'Desc', currentPage: '1', pageSize: String(DEFAULT_PAGE_SIZE),
    p_relatedLogin: context.other, p_sortBy: 'MainOpenTime', p_sortDirection: 'Asc', p_currentPage: '1',
    p_pageSize: String(DEFAULT_PAGE_SIZE),
  });
  if (kind === 'hedge') query.set('volumeTolerancePercent', '10');
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
  ], rows);
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

    const overview = await apiGet(`${compareBase(context)}/overview`, {
      ...rangeParams(context),
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
