// Trade history page: the positions, orders or deals of every MetaTrader account in a UTC range set to the millisecond
// (/panel-api/mt5/trade-report). Sorting, column filters and paging are done by the panel over the whole result.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const KINDS = ['positions', 'orders', 'deals'];
const MAX_RANGE_DAYS = 3;
const DAY_MS = 86400000;

const rangeControls = initRangeControls(form);
const symbolPicker = initMultiPicker(document.getElementById('symbols-field'));
const groupPicker = initMultiPicker(document.getElementById('groups-field'));
let request = 0;

async function loadPickerChoices() {
  try {
    const options = await panelRequest('GET', 'mt5/trade-report/options');
    symbolPicker.setChoices(options.symbols ?? []);
    groupPicker.setChoices(options.groups ?? []);
  } catch {
    symbolPicker.setChoices([]);
    groupPicker.setChoices([]);
  }
}

const sorted = (definition, sortKey) => ({ ...definition, sortKey });
const loginColumn = { key: 'login', title: 'Login', sortKey: 'Login' };
const actionsColumn = loginActionsColumn('login');

const COLUMNS = {
  positions: loginPositionColumns(),
  orders: [
    loginColumn,
    sorted(column('order', 'Order'), 'Order'),
    sorted(column('symbol', 'Symbol'), 'Symbol'),
    sorted(labelColumn('type', 'Type'), 'Type'),
    sorted(orderStateColumn('state', 'State'), 'State'),
    sorted(column('volumeInitial', 'Volume', lots), 'VolumeInitial'),
    sorted(column('volumeCurrent', 'Remaining', lots), 'VolumeCurrent'),
    sorted(priceColumn('priceOrder', 'Price'), 'PriceOrder'),
    sorted(priceColumn('priceTrigger', 'Trigger price'), 'PriceTrigger'),
    ...stopColumns('comment', true),
    sorted(utcColumn('setupAt', 'Placed'), 'SetupAt'),
    sorted(utcColumn('doneAt', 'Done'), 'DoneAt'),
    sorted(utcColumn('expiresAt', 'Expires', true), 'ExpiresAt'),
    { ...sorted(column('positionId', 'Position', value => value || '—'), 'PositionId'), linkRows: true },
    sorted(sourceColumn('reason', 'Placed by'), 'Reason'),
    sorted(commentColumn('comment', 'Comment'), 'Comment'),
    actionsColumn,
  ],
  deals: [
    loginColumn,
    sorted(column('deal', 'Deal'), 'Deal'),
    sorted(utcColumn('time', 'Time'), 'Time'),
    sorted(labelColumn('action', 'Action'), 'Action'),
    sorted(entryColumn('entry', 'Entry'), 'Entry'),
    sorted(column('symbol', 'Symbol'), 'Symbol'),
    sorted(column('volume', 'Volume', lots), 'Volume'),
    sorted(priceColumn('price', 'Price'), 'Price'),
    ...stopColumns('comment', true),
    sorted(amountColumn('profit', 'Profit'), 'Profit'),
    sorted(amountColumn('commission', 'Commission'), 'Commission'),
    sorted(amountColumn('swap', 'Swap'), 'Swap'),
    sorted(amountColumn('fee', 'Fee'), 'Fee'),
    { ...sorted(column('positionId', 'Position', value => value || '—'), 'PositionId'), linkRows: true },
    sorted(column('order', 'Order'), 'Order'),
    sorted(sourceColumn('reason', 'Source'), 'Reason'),
    sorted(commentColumn('comment', 'Comment'), 'Comment'),
    actionsColumn,
  ],
};

const DEFAULT_SORT = {
  positions: { item: 'OpenedAt', direction: 'Desc' },
  orders: { item: 'SetupAt', direction: 'Desc' },
  deals: { item: 'Time', direction: 'Desc' },
};

const TITLES = { positions: 'Positions', orders: 'Orders', deals: 'Deals' };

const grids = Object.fromEntries(KINDS.map(kind => [kind, createReportGrid({
  columns: COLUMNS[kind],
  sort: DEFAULT_SORT[kind],
  containerId: kind,
  pagerId: `${kind}-pager`,
  titleId: `${kind}-title`,
  title: TITLES[kind],
  exportName: `trade-history-${kind}`,
  exportPageSize: 50000,
  read: params => panelRequest('GET', `mt5/trade-report${toQueryString(params)}`),
})]));

function showKind(kind) {
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== kind;
}

// A datetime-local value ("yyyy-MM-ddTHH:mm[:ss[.fff]]") is UTC on this page.
const utcParam = value => `${value}Z`;

function validateTradeRange(values) {
  if (!values.fromUtc || !values.toUtc) throw new ApiError('Fill in both From and To', values.fromUtc ? { toUtc: ['Fill in To'] } : { fromUtc: ['Fill in From'] });
  validateRange(values);
  if (Date.parse(utcParam(values.toUtc)) - Date.parse(utcParam(values.fromUtc)) > MAX_RANGE_DAYS * DAY_MS) throw new ApiError(`Choose a range of at most ${MAX_RANGE_DAYS} days`, { toUtc: [`At most ${MAX_RANGE_DAYS} days`] });
  if (values.volumeFrom && values.volumeTo && Number(values.volumeFrom) > Number(values.volumeTo)) {
    throw new ApiError('Volume from must not be more than volume to', { volumeTo: ['Must not be less than From'] });
  }
}

const pickedSummary = names => names.length === 0 ? 'All' : names.length <= 3 ? names.join(', ') : `${names.length} selected`;

function volumeSummary(values) {
  if (!values.volumeFrom && !values.volumeTo) return 'Any';
  if (!values.volumeTo) return `≥ ${values.volumeFrom}`;
  if (!values.volumeFrom) return `≤ ${values.volumeTo}`;
  return `${values.volumeFrom} — ${values.volumeTo}`;
}

async function search(values) {
  const current = ++request;
  rangeControls.sync();
  validateTradeRange(values);
  const kind = KINDS.includes(values.kind) ? values.kind : 'positions';
  for (const grid of Object.values(grids)) grid.clear();
  document.getElementById('metadata').replaceChildren();
  showKind(kind);
  writeQuery(values);
  setLoading(message);

  const symbols = splitPicked(values.symbols);
  const groups = splitPicked(values.groups);
  const report = await grids[kind].start({
    kind,
    fromUtc: utcParam(values.fromUtc),
    toUtc: utcParam(values.toUtc),
    volumeFrom: values.volumeFrom,
    volumeTo: values.volumeTo,
    symbols,
    groups,
  });
  if (current !== request) return;
  renderSummary(document.getElementById('metadata'), [
    ['Report', TITLES[kind]],
    ['Range (UTC)', `${values.fromUtc.replace('T', ' ')} — ${values.toUtc.replace('T', ' ')}`],
    ['Symbols', pickedSummary(symbols)],
    ['Groups', pickedSummary(groups)],
    ['Volume (lots)', volumeSummary(values)],
    ['Rows', (pagingOf(report.paging)?.totalRecords ?? report.items.length).toLocaleString('en-US')],
  ]);
  message.textContent = '';
}

async function submit() {
  const values = formValues(form);
  const submitButton = form.querySelector('button[type="submit"]');
  clearMessages(form, message);
  submitButton.disabled = true;
  try {
    await search(values);
  } catch (error) {
    message.textContent = '';
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  submit();
});

renderMenu();
const hasQuery = fillFormFromQuery(form);
rangeControls.restore();
symbolPicker.sync();
groupPicker.sync();
loadPickerChoices();
if (!form.elements.fromUtc.value) rangeControls.apply();
if (hasQuery && form.elements.fromUtc.value) submit();
