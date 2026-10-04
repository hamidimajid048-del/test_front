// Copy trade and hedge page: accounts matching the login's position openings (list), and for one related account
// the position comparison: statistics with a risk score, a tree of the login's positions with the related positions
// under them, and charts. Both report types share this code; hedge only adds the volume tolerance and its own view.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const positionsForm = document.getElementById('positions-filters');
const positionsMessage = document.getElementById('positions-message');
const exportMessage = document.getElementById('export-message');
const DEFAULT_PAGE_SIZE = 100;
const TREE_PAGE_SIZE = 50;
const POSITIONS_QUERY_PREFIX = 'p_';
const BASE_PATH = 'reports/copy-trade-and-hedge';

const KINDS = {
  'copy-trade': { title: 'Copy trade', hasVolumeTolerance: false },
  hedge: { title: 'Hedge', hasVolumeTolerance: true },
};

const WINDOW_KEYS = ['secondsBefore', 'secondsAfter', 'volumeTolerancePercent'];
const LIST_KEYS = ['minPercentShare', 'minCountShare', 'sortBy', 'sortDirection'];
const FILTER_KEYS = ['symbol', 'direction', 'minSignalSeverity'];
const TABS = ['tree', 'symbols', 'timeline', 'offsets'];

const shareLabels = row => [row.hasIpShare && 'Shared IP', row.hasCidShare && 'Shared CID'].filter(Boolean).join(', ');

// Inputs of the last list search; the positions reuse them so they always match the list shown.
let search = null;
let listPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
// Day range of the last list report, handed to the compare page when no range was typed in.
let listRange = null;
let relatedLogin = null;
let positionsValues = {};
let positionsPaging = { currentPage: 1, pageSize: TREE_PAGE_SIZE };
let activeTab = 'tree';
// Open nodes and open pair comparisons survive page changes, sorting and filtering.
const treeState = { expanded: new Set(), opened: new Set(), window: { before: 0, after: 0 } };

const pick = (source, keys) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));
const kind = () => KINDS[search.kind] ?? KINDS['copy-trade'];

const rangeControls = initRangeControls(form);

function showVolumeTolerance() {
  document.getElementById('volume-tolerance').hidden = !KINDS[form.elements.kind.value]?.hasVolumeTolerance;
}

// Checks the rules the service would reject, so the user gets a clear message before any request.
function validateInputs(values) {
  validateRange(values);
  if (!values.minPercentShare && !values.minCountShare) {
    const hint = ['Fill in at least one minimum share'];
    throw new ApiError(translateStatus({ description: 'MinimumShareRequired' }), { minPercentShare: hint, minCountShare: hint });
  }
  if (KINDS[values.kind]?.hasVolumeTolerance && values.volumeTolerancePercent === undefined) {
    throw new ApiError('Enter the volume tolerance', { volumeTolerancePercent: ['Required for hedge; 0 means equal volume'] });
  }
}

// The window and range every request of the page carries.
function windowParams() {
  return { ...pick(search, WINDOW_KEYS), fromUtc: fromDayParam(search.fromUtc), toUtc: toDayParam(search.toUtc) };
}

function listParams() {
  return { ...windowParams(), ...pick(search, LIST_KEYS), currentPage: listPaging.currentPage, pageSize: listPaging.pageSize };
}

const positionsPath = suffix => `${BASE_PATH}/${search.kind}/${search.login}/related/${relatedLogin}/${suffix}`;

function treeParams() {
  return {
    ...windowParams(), ...positionsValues,
    currentPage: positionsPaging.currentPage, pageSize: positionsPaging.pageSize,
  };
}

// The statistics describe the counted pairs; sorting and paging do not apply to them.
function statsParams() {
  return { ...windowParams(), ...pick(positionsValues, FILTER_KEYS) };
}

function writeState() {
  const state = { ...search, currentPage: listPaging.currentPage, pageSize: listPaging.pageSize };
  if (relatedLogin) {
    const prefixed = { ...positionsValues, relatedLogin, ...positionsPaging, tab: activeTab };
    for (const [key, value] of Object.entries(prefixed)) state[POSITIONS_QUERY_PREFIX + key] = value;
  }
  writeQuery(state);
}

// The sessions comparison of the two logins, over the typed range or else the range of the list report.
function compareHref(login) {
  const query = new URLSearchParams({ login: search.login, other: login, tab: 'shared-ips' });
  const range = search.fromUtc ? { from: search.fromUtc, to: search.toUtc } : listRange;
  if (range) {
    query.set('range', 'custom');
    query.set('fromUtc', range.from);
    query.set('toUtc', range.to);
  }
  return `/compare.html?${query}`;
}

const LIST_COLUMNS = [
  { key: 'relatedLogin', title: 'Related login', format: loginLink },
  { key: 'countShare', title: 'Share count' },
  { key: 'percentShare', title: 'Share (%)', format: value => `${value}%` },
  { key: 'profitLoss', title: 'Profit/loss' },
  { key: 'hasIpShare', title: 'Shared evidence', format: (_, row) => shareLabels(row) },
  {
    key: 'relatedLogin',
    title: 'Actions',
    format: login => {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const positions = actionLink('Positions', '#');
      positions.addEventListener('click', event => {
        event.preventDefault();
        openPositions(login);
      });
      actions.append(actionLink('Compare logins', compareHref(login)), positions);
      return actions;
    },
  },
];

function windowItems(metadata) {
  const items = [
    ['Range (UTC)', `${formatUtc(metadata.fromUtc)} — ${formatUtc(metadata.toUtc)}`],
    ['Seconds before', metadata.secondsBefore],
    ['Seconds after', metadata.secondsAfter],
  ];
  if (kind().hasVolumeTolerance) items.push(['Volume tolerance (%)', metadata.volumeTolerancePercent]);
  return items;
}

async function loadList() {
  const report = await apiGet(`${BASE_PATH}/${search.kind}/${search.login}`, listParams());
  const paging = report.paging?.normalPagingResponse;
  listPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? listPaging.pageSize };

  listRange = { from: toDayValue(new Date(report.metadata.fromUtc)), to: toDayValue(new Date(report.metadata.toUtc)) };
  document.getElementById('list-title').textContent = `${kind().title} — login ${search.login}`;
  renderSummary(document.getElementById('list-metadata'), [
    ['Login', report.metadata.login],
    ['Account ID', report.metadata.accountId],
    ...windowItems(report.metadata),
    ['Positions', report.metadata.positionCount],
    ['Profit/loss', report.metadata.profitLoss],
  ]);
  renderTable(document.getElementById('list'), LIST_COLUMNS, report.items, row => openPositions(row.relatedLogin));
  renderPager(document.getElementById('list-pager'), paging, (page, pageSize) => {
    listPaging = { currentPage: page, pageSize };
    withLoading(form, message, loadList);
  });
  document.getElementById('list-section').hidden = false;
  writeState();
}

// ---- position comparison ----

async function loadTree() {
  const report = await apiGet(positionsPath('position-tree'), treeParams());
  const paging = report.paging?.normalPagingResponse;
  positionsPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? positionsPaging.pageSize };

  renderSummary(document.getElementById('positions-metadata'), [
    ['Related login', relatedLogin],
    ...windowItems(report.metadata),
    ['Main positions shown', report.metadata.nodeCount],
    ['Related positions shown', report.metadata.childCount],
    ['Counted in the share', report.metadata.assignedCount],
  ]);
  treeState.window = { before: Number(report.metadata.secondsBefore), after: Number(report.metadata.secondsAfter) };
  renderPositionsTree(document.getElementById('positions'), search.kind, report.items, treeState);
  renderPager(document.getElementById('positions-pager'), paging, (page, pageSize) => {
    positionsPaging = { currentPage: page, pageSize };
    withLoading(positionsForm, positionsMessage, loadTree);
  });
  writeState();
}

async function loadStats() {
  const stats = await apiGet(positionsPath('position-stats'), statsParams());
  renderRisk(document.getElementById('positions-risk'), stats.risk);
  renderStatCards(document.getElementById('positions-stats'), stats, search.kind);
  renderSymbols(document.getElementById('symbols-table'), stats.bySymbol);
  renderTimeline(document.getElementById('timeline-chart'), stats.byDay);
  renderOffsets(document.getElementById('offsets-chart'), stats.timing.histogram);
}

// The tree and the statistics are independent requests; the page waits for both so an error shows once.
async function loadPositions() {
  await Promise.all([loadStats(), loadTree()]);
}

function showTab(tab) {
  activeTab = TABS.includes(tab) ? tab : 'tree';
  for (const name of TABS) document.getElementById(`tab-${name}`).hidden = name !== activeTab;
  document.querySelectorAll('#positions-tabs button').forEach(button =>
    button.classList.toggle('active', button.dataset.tab === activeTab));
}

function showPositionsSection() {
  document.getElementById('positions-title').textContent =
    `Position comparison (${kind().title}): ${search.login} and ${relatedLogin}`;
  document.getElementById('positions-compare').href = compareHref(relatedLogin);
  document.getElementById('positions-profile').href = `/logins.html?login=${encodeURIComponent(relatedLogin)}`;
  document.getElementById('positions-help').replaceChildren(...KIND_VIEWS[search.kind].help.map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  const section = document.getElementById('positions-section');
  section.hidden = false;
  return section;
}

function resetPositionsView() {
  for (const id of ['positions-metadata', 'positions-risk', 'positions-stats', 'positions', 'positions-pager', 'symbols-table', 'timeline-chart', 'offsets-chart']) {
    document.getElementById(id).replaceChildren();
  }
  exportMessage.textContent = '';
  treeState.expanded.clear();
  treeState.opened.clear();
}

function openPositions(login) {
  relatedLogin = login;
  positionsForm.reset();
  const defaults = KIND_VIEWS[search.kind].defaultSort;
  positionsForm.elements.sortBy.value = defaults.sortBy;
  positionsForm.elements.sortDirection.value = defaults.sortDirection;
  positionsValues = formValues(positionsForm);
  positionsPaging = { currentPage: 1, pageSize: TREE_PAGE_SIZE };
  resetPositionsView();
  showTab('tree');
  showPositionsSection().scrollIntoView({ behavior: 'smooth', block: 'start' });
  withLoading(positionsForm, positionsMessage, loadPositions);
}

function hidePositions() {
  relatedLogin = null;
  document.getElementById('positions-section').hidden = true;
}

// The volume tolerance only belongs to hedge; a hidden field must not leak into a copy trade request.
function readSearch() {
  const values = formValues(form);
  if (!KINDS[values.kind]?.hasVolumeTolerance) delete values.volumeTolerancePercent;
  return values;
}

form.elements.kind.addEventListener('change', showVolumeTolerance);

form.addEventListener('submit', event => {
  event.preventDefault();
  withLoading(form, message, async () => {
    const values = readSearch();
    validateInputs(values);
    search = values;
    listPaging = { currentPage: 1, pageSize: listPaging.pageSize };
    hidePositions();
    await loadList();
  });
});

positionsForm.addEventListener('submit', event => {
  event.preventDefault();
  positionsValues = formValues(positionsForm);
  positionsPaging = { currentPage: 1, pageSize: positionsPaging.pageSize };
  withLoading(positionsForm, positionsMessage, loadPositions);
});

document.getElementById('positions-tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (!tab) return;
  showTab(tab);
  writeState();
});

function setAllExpanded(open) {
  if (!open) treeState.opened.clear();
  for (const parent of document.querySelectorAll('#positions tr.tree-parent')) {
    const isOpen = parent.getAttribute('aria-expanded') === 'true';
    if (isOpen !== open) parent.click();
  }
  if (!open) document.querySelectorAll('#positions tr.tree-child.active').forEach(row => row.classList.remove('active'));
}

document.getElementById('expand-all').addEventListener('click', () => setAllExpanded(true));
document.getElementById('collapse-all').addEventListener('click', () => setAllExpanded(false));

// Exports use the same inputs as the screen: the window, the range and the filters; paging and sorting are ignored
// by the service, so the file always has every row.
document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
  const pairs = button.dataset.export === 'pairs';
  const params = pairs
    ? { ...windowParams(), ...positionsValues }
    : { ...statsParams(), dataset: button.dataset.dataset };
  downloadExport(positionsPath(pairs ? 'position-tree/export' : 'position-stats/export'),
    { ...params, format: button.dataset.format }, button, exportMessage);
}));

// Restores a shared or refreshed report link.
async function restoreFromQuery() {
  if (!fillFormFromQuery(form) || !form.elements.login.value) return;
  showVolumeTolerance();
  rangeControls.restore();
  const query = new URLSearchParams(location.search);
  listPaging = {
    currentPage: Number(query.get('currentPage')) || 1,
    pageSize: Number(query.get('pageSize')) || DEFAULT_PAGE_SIZE,
  };
  await withLoading(form, message, async () => {
    const values = readSearch();
    validateInputs(values);
    search = values;
    await loadList();
  });

  const related = query.get(`${POSITIONS_QUERY_PREFIX}relatedLogin`);
  if (!related || document.getElementById('list-section').hidden) return;
  relatedLogin = related;
  for (const element of positionsForm.elements) {
    const value = element.name && query.get(POSITIONS_QUERY_PREFIX + element.name);
    if (!value) continue;
    if (element.type === 'checkbox') element.checked = value === 'true';
    else element.value = value;
  }
  positionsValues = formValues(positionsForm);
  positionsPaging = {
    currentPage: Number(query.get(`${POSITIONS_QUERY_PREFIX}currentPage`)) || 1,
    pageSize: Number(query.get(`${POSITIONS_QUERY_PREFIX}pageSize`)) || TREE_PAGE_SIZE,
  };
  showTab(query.get(`${POSITIONS_QUERY_PREFIX}tab`));
  showPositionsSection();
  await withLoading(positionsForm, positionsMessage, loadPositions);
}

renderMenu();
rangeControls.sync();
showVolumeTolerance();
restoreFromQuery();
