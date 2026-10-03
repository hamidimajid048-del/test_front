// Copy trade and hedge page: accounts matching the login's position openings (list) and the matched position
// pairs with one related account. Both reports share this code; hedge only adds the volume tolerance.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const positionsForm = document.getElementById('positions-filters');
const positionsMessage = document.getElementById('positions-message');
const DEFAULT_PAGE_SIZE = 100;
const POSITIONS_QUERY_PREFIX = 'p_';

const KINDS = {
  'copy-trade': { title: 'Copy trade', hasVolumeTolerance: false },
  hedge: { title: 'Hedge', hasVolumeTolerance: true },
};

const WINDOW_KEYS = ['secondsBefore', 'secondsAfter', 'volumeTolerancePercent'];
const LIST_KEYS = [...WINDOW_KEYS, 'minPercentShare', 'minCountShare', 'sortBy', 'sortDirection'];

const shareLabels = row => [row.hasIpShare && 'Shared IP', row.hasCidShare && 'Shared CID'].filter(Boolean).join(', ');

// Inputs of the last list search; the positions reuse them so they always match the list shown.
let search = null;
let listPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
let relatedLogin = null;
let positionsValues = {};
let positionsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };

const pick = (source, keys) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));
const kind = () => KINDS[search.kind] ?? KINDS['copy-trade'];

function showVolumeTolerance() {
  document.getElementById('volume-tolerance').hidden = !KINDS[form.elements.kind.value]?.hasVolumeTolerance;
}

// Checks the rules the service would reject, so the user gets a Persian message before any request.
function validateInputs(values) {
  if (!values.minPercentShare && !values.minCountShare) {
    const hint = ['Fill in at least one minimum share'];
    throw new ApiError(translateStatus({ description: 'MinimumShareRequired' }), { minPercentShare: hint, minCountShare: hint });
  }
  if (KINDS[values.kind]?.hasVolumeTolerance && values.volumeTolerancePercent === undefined) {
    throw new ApiError('Enter the volume tolerance', { volumeTolerancePercent: ['Required for hedge; 0 means equal volume'] });
  }
}

function writeState() {
  const state = { ...search, currentPage: listPaging.currentPage, pageSize: listPaging.pageSize };
  if (relatedLogin) {
    const prefixed = { ...positionsValues, relatedLogin, ...positionsPaging };
    for (const [key, value] of Object.entries(prefixed)) state[POSITIONS_QUERY_PREFIX + key] = value;
  }
  writeQuery(state);
}

const LIST_COLUMNS = [
  { key: 'relatedLogin', title: 'Related login', format: loginLink },
  { key: 'countShare', title: 'Share count' },
  { key: 'percentShare', title: 'Share (%)', format: value => `${value}%` },
  { key: 'profitLoss', title: 'Profit/loss' },
  { key: 'hasIpShare', title: 'Shared evidence', format: (_, row) => shareLabels(row) },
];

const POSITION_COLUMNS = [
  { key: 'mainPositionTicket', title: 'Ticket', group: 'Main' },
  { ...utcColumn('mainOpenTimeUtc', 'Open time'), group: 'Main' },
  { key: 'symbol', title: 'Symbol', group: 'Main' },
  { key: 'mainDirection', title: 'Direction', group: 'Main' },
  { key: 'mainVolume', title: 'Volume', group: 'Main' },
  { key: 'mainProfitLoss', title: 'Profit/loss', group: 'Main' },
  { key: 'relatedPositionTicket', title: 'Ticket', group: 'Related' },
  { ...utcColumn('relatedOpenTimeUtc', 'Open time'), group: 'Related' },
  { key: 'relatedDirection', title: 'Direction', group: 'Related' },
  { key: 'relatedVolume', title: 'Volume', group: 'Related' },
  { key: 'relatedProfitLoss', title: 'Profit/loss', group: 'Related' },
  { key: 'offsetSeconds', title: 'Offset (s)' },
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
  const params = { ...pick(search, LIST_KEYS), currentPage: listPaging.currentPage, pageSize: listPaging.pageSize };
  const report = await apiGet(`reports/copy-trade-and-hedge/${search.kind}/${search.login}`, params);
  const paging = report.paging?.normalPagingResponse;
  listPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? listPaging.pageSize };

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

async function loadPositions() {
  const params = {
    ...pick(search, WINDOW_KEYS),
    ...positionsValues,
    currentPage: positionsPaging.currentPage,
    pageSize: positionsPaging.pageSize,
  };
  const report = await apiGet(
    `reports/copy-trade-and-hedge/${search.kind}/${search.login}/related/${relatedLogin}/positions`, params);
  const paging = report.paging?.normalPagingResponse;
  positionsPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? positionsPaging.pageSize };

  renderSummary(document.getElementById('positions-metadata'), [
    ['Related login', report.metadata.relatedLogin],
    ['Pairs', report.metadata.pairCount],
    ...windowItems(report.metadata),
  ]);
  renderTable(document.getElementById('positions'), POSITION_COLUMNS, report.items);
  renderPager(document.getElementById('positions-pager'), paging, (page, pageSize) => {
    positionsPaging = { currentPage: page, pageSize };
    withLoading(positionsForm, positionsMessage, loadPositions);
  });
  writeState();
}

function showPositionsSection() {
  document.getElementById('positions-title').textContent =
    `Matched position pairs (${kind().title}): ${search.login} and ${relatedLogin}`;
  const section = document.getElementById('positions-section');
  section.hidden = false;
  return section;
}

function openPositions(login) {
  relatedLogin = login;
  positionsForm.reset();
  positionsValues = {};
  positionsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
  for (const id of ['positions-metadata', 'positions', 'positions-pager']) document.getElementById(id).replaceChildren();
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

// Restores a shared or refreshed report link.
async function restoreFromQuery() {
  if (!fillFormFromQuery(form) || !form.elements.login.value) return;
  showVolumeTolerance();
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
    if (value) element.value = value;
  }
  positionsValues = formValues(positionsForm);
  positionsPaging = {
    currentPage: Number(query.get(`${POSITIONS_QUERY_PREFIX}currentPage`)) || 1,
    pageSize: Number(query.get(`${POSITIONS_QUERY_PREFIX}pageSize`)) || DEFAULT_PAGE_SIZE,
  };
  showPositionsSection();
  await withLoading(positionsForm, positionsMessage, loadPositions);
}

renderMenu();
showVolumeTolerance();
restoreFromQuery();
