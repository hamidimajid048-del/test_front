// Trade history page: the positions, orders or deals of every MetaTrader account in a range of UTC days
// (/panel-api/mt5/trade-report). Sorting, column filters and paging are done by the panel over the whole result.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const KINDS = ['positions', 'orders', 'deals'];
const MAX_RANGE_DAYS = 3;
const DAY_MS = 86400000;

const rangeControls = initRangeControls(form);
let request = 0;

const accountLink = login => {
  const link = actionLink(String(login), `/account-data.html?login=${encodeURIComponent(login)}`);
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
};

const sorted = (definition, sortKey) => ({ ...definition, sortKey });
const loginColumn = { key: 'login', title: 'Login', format: accountLink, sortKey: 'Login' };

const COLUMNS = {
  positions: [
    loginColumn,
    sorted(column('positionId', 'Position'), 'PositionId'),
    sorted(column('symbol', 'Symbol'), 'Symbol'),
    sorted(labelColumn('direction', 'Direction'), 'Direction'),
    sorted(column('volume', 'Volume', lots), 'Volume'),
    sorted(utcColumn('openedAt', 'Opened'), 'OpenedAt'),
    sorted(priceColumn('openPrice', 'Open price'), 'OpenPrice'),
    sorted(utcColumn('closedAt', 'Closed'), 'ClosedAt'),
    sorted(priceColumn('closePrice', 'Close price'), 'ClosePrice'),
    sorted(column('durationSeconds', 'Open time', duration), 'DurationSeconds'),
    sorted(amountColumn('profit', 'Profit'), 'Profit'),
    sorted(amountColumn('commission', 'Commission'), 'Commission'),
    sorted(amountColumn('swap', 'Swap'), 'Swap'),
    sorted(amountColumn('fee', 'Fee'), 'Fee'),
    sorted(amountColumn('netProfit', 'Net profit'), 'NetProfit'),
    { ...sorted(column('isOpen', 'Status', isOpen => badge(isOpen ? 'Open' : 'Closed', isOpen ? 'warn' : 'muted')), 'IsOpen'), filterable: false },
    sorted(labelColumn('reason', 'Reason'), 'Reason'),
    sorted(column('comment', 'Comment'), 'Comment'),
    {
      key: 'positionId', title: 'Actions', sortable: false, filterable: false, noExport: true,
      format: (positionId, row) => actionLink('Details', `/position-details.html?login=${encodeURIComponent(row.login)}&position=${encodeURIComponent(positionId)}`),
    },
  ],
  orders: [
    loginColumn,
    sorted(column('order', 'Order'), 'Order'),
    sorted(column('symbol', 'Symbol'), 'Symbol'),
    sorted(labelColumn('type', 'Type'), 'Type'),
    sorted(labelColumn('state', 'State'), 'State'),
    sorted(column('volumeInitial', 'Volume', lots), 'VolumeInitial'),
    sorted(column('volumeCurrent', 'Remaining', lots), 'VolumeCurrent'),
    sorted(priceColumn('priceOrder', 'Price'), 'PriceOrder'),
    sorted(priceColumn('priceTrigger', 'Trigger price'), 'PriceTrigger'),
    sorted(priceColumn('priceSl', 'SL'), 'PriceSl'),
    sorted(priceColumn('priceTp', 'TP'), 'PriceTp'),
    sorted(utcColumn('setupAt', 'Placed'), 'SetupAt'),
    sorted(utcColumn('doneAt', 'Done'), 'DoneAt'),
    sorted(utcColumn('expiresAt', 'Expires'), 'ExpiresAt'),
    sorted(column('positionId', 'Position', value => value || '—'), 'PositionId'),
    sorted(labelColumn('reason', 'Reason'), 'Reason'),
    sorted(column('comment', 'Comment'), 'Comment'),
  ],
  deals: [
    loginColumn,
    sorted(column('deal', 'Deal'), 'Deal'),
    sorted(utcColumn('time', 'Time'), 'Time'),
    sorted(labelColumn('action', 'Action'), 'Action'),
    sorted(labelColumn('entry', 'Entry'), 'Entry'),
    sorted(column('symbol', 'Symbol'), 'Symbol'),
    sorted(column('volume', 'Volume', lots), 'Volume'),
    sorted(priceColumn('price', 'Price'), 'Price'),
    sorted(amountColumn('profit', 'Profit'), 'Profit'),
    sorted(amountColumn('commission', 'Commission'), 'Commission'),
    sorted(amountColumn('swap', 'Swap'), 'Swap'),
    sorted(amountColumn('fee', 'Fee'), 'Fee'),
    sorted(column('positionId', 'Position', value => value || '—'), 'PositionId'),
    sorted(column('order', 'Order'), 'Order'),
    sorted(labelColumn('reason', 'Reason'), 'Reason'),
    sorted(column('comment', 'Comment'), 'Comment'),
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
  read: params => panelRequest('GET', `mt5/trade-report${toQueryString(params)}`),
})]));

function showKind(kind) {
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== kind;
}

function validateTradeRange(values) {
  if (!values.fromUtc || !values.toUtc) throw new ApiError('Fill in both From and To', values.fromUtc ? { toUtc: ['Fill in To'] } : { fromUtc: ['Fill in From'] });
  validateRange(values);
  const days = (Date.parse(values.toUtc) - Date.parse(values.fromUtc)) / DAY_MS + 1;
  if (days > MAX_RANGE_DAYS) throw new ApiError(`Choose a range of at most ${MAX_RANGE_DAYS} days`, { toUtc: [`At most ${MAX_RANGE_DAYS} days`] });
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

  const report = await grids[kind].start({ kind, fromUtc: fromDayParam(values.fromUtc), toUtc: toDayParam(values.toUtc) });
  if (current !== request) return;
  renderSummary(document.getElementById('metadata'), [
    ['Report', TITLES[kind]],
    ['Range (UTC)', `${values.fromUtc} — ${values.toUtc}`],
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
if (!form.elements.fromUtc.value) rangeControls.apply();
if (hasQuery && form.elements.fromUtc.value) submit();
