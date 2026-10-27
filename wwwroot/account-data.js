// Account data page: one MetaTrader account read from the panel's Manager connection (/panel-api/mt5/account-data):
// status, balances and growth chart, open positions and orders, deposits and withdrawals, and the position, order and
// deal histories. Each tab is read when it is first opened.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const activateButton = document.getElementById('activate');
const TABS = ['overview', 'open', 'transfers', 'positions', 'orders', 'deals'];

let currentTab = 'overview';
let currentLogin = null;
let overview = null;
let chartMode = 'amount';
let loaded = new Set();
let request = 0;

const label = value => {
  const text = String(value).replace(/^(DEAL_|POSITION_|OP_|ORDER_STATE_|ENTRY_)/, '').replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const money = value => value === null || value === undefined
  ? '—'
  : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lots = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const price = value => value ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—';

const amount = value => {
  const element = document.createElement('span');
  element.className = value < 0 ? 'neg' : value > 0 ? 'pos' : '';
  element.textContent = money(value);
  return element;
};

const column = (key, title, format) => ({ key, title, format });
const labelColumn = (key, title) => column(key, title, label);
const priceColumn = (key, title) => column(key, title, price);
const amountColumn = (key, title) => column(key, title, amount);

const positionColumns = [
  column('position', 'Position'),
  column('symbol', 'Symbol'),
  labelColumn('direction', 'Direction'),
  column('volume', 'Volume', lots),
  priceColumn('priceOpen', 'Open price'),
  priceColumn('priceCurrent', 'Current price'),
  priceColumn('priceSl', 'SL'),
  priceColumn('priceTp', 'TP'),
  amountColumn('profit', 'Profit'),
  amountColumn('swap', 'Swap'),
  utcColumn('openedAt', 'Opened'),
  column('comment', 'Comment'),
];

const orderColumns = [
  column('order', 'Order'),
  column('symbol', 'Symbol'),
  labelColumn('type', 'Type'),
  labelColumn('state', 'State'),
  column('volumeInitial', 'Volume', lots),
  column('volumeCurrent', 'Remaining', lots),
  priceColumn('priceOrder', 'Price'),
  priceColumn('priceTrigger', 'Trigger price'),
  priceColumn('priceSl', 'SL'),
  priceColumn('priceTp', 'TP'),
  utcColumn('setupAt', 'Placed'),
  utcColumn('doneAt', 'Done'),
  utcColumn('expiresAt', 'Expires'),
  column('positionId', 'Position', value => value || '—'),
  column('comment', 'Comment'),
];

const grids = {
  positions: createLocalGrid({
    containerId: 'positions',
    pagerId: 'positions-pager',
    sort: { item: 'Opened (UTC)', direction: 'Desc' },
    columns: [
      column('positionId', 'Position'),
      column('symbol', 'Symbol'),
      labelColumn('direction', 'Direction'),
      column('volume', 'Volume', lots),
      utcColumn('openedAt', 'Opened'),
      priceColumn('openPrice', 'Open price'),
      utcColumn('closedAt', 'Closed'),
      priceColumn('closePrice', 'Close price'),
      amountColumn('profit', 'Profit'),
      amountColumn('commission', 'Commission'),
      amountColumn('swap', 'Swap'),
      amountColumn('fee', 'Fee'),
      amountColumn('netProfit', 'Net profit'),
      column('isOpen', 'Status', isOpen => badge(isOpen ? 'Open' : 'Closed', isOpen ? 'warn' : 'muted')),
    ],
  }),
  orders: createLocalGrid({ containerId: 'orders', pagerId: 'orders-pager', columns: orderColumns, sort: { item: 'Placed (UTC)', direction: 'Desc' } }),
  deals: createLocalGrid({
    containerId: 'deals',
    pagerId: 'deals-pager',
    sort: { item: 'Time (UTC)', direction: 'Desc' },
    columns: [
      column('deal', 'Deal'),
      utcColumn('time', 'Time'),
      labelColumn('action', 'Action'),
      labelColumn('entry', 'Entry'),
      column('symbol', 'Symbol'),
      column('volume', 'Volume', lots),
      priceColumn('price', 'Price'),
      amountColumn('profit', 'Profit'),
      amountColumn('commission', 'Commission'),
      amountColumn('swap', 'Swap'),
      amountColumn('fee', 'Fee'),
      column('positionId', 'Position', value => value || '—'),
      column('order', 'Order'),
      column('comment', 'Comment'),
    ],
  }),
  transfers: createLocalGrid({
    containerId: 'transfers',
    pagerId: 'transfers-pager',
    sort: { item: 'Time (UTC)', direction: 'Desc' },
    columns: [
      column('deal', 'Deal'),
      utcColumn('time', 'Time'),
      labelColumn('action', 'Type'),
      amountColumn('profit', 'Amount'),
      column('comment', 'Comment'),
    ],
  }),
  openPositions: createLocalGrid({
    containerId: 'open-positions',
    pagerId: 'open-positions-pager',
    columns: positionColumns,
    sort: { item: 'Opened (UTC)', direction: 'Desc' },
  }),
  openOrders: createLocalGrid({
    containerId: 'open-orders',
    pagerId: 'open-orders-pager',
    columns: orderColumns,
    sort: { item: 'Placed (UTC)', direction: 'Desc' },
  }),
};

function showTab(tab) {
  currentTab = TABS.includes(tab) ? tab : 'overview';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === currentTab);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== currentTab;
}

const panelPath = suffix => `mt5/account-data${suffix}?login=${encodeURIComponent(currentLogin)}`;

const TAB_LOADERS = {
  async open() {
    const open = await panelRequest('GET', panelPath('/open'));
    grids.openPositions.setRows(open.positions);
    grids.openOrders.setRows(open.orders);
    document.getElementById('open-positions-title').textContent = `Open positions (${open.positions.length})`;
    document.getElementById('open-orders-title').textContent = `Active orders (${open.orders.length})`;
  },
  async transfers() {
    const transfers = await panelRequest('GET', panelPath('/transfers'));
    grids.transfers.setRows(transfers);
    renderSummary(document.getElementById('transfer-totals'), [
      ['Deposits', money(overview?.totalDeposits)],
      ['Withdrawals', money(overview?.totalWithdrawals)],
      ['Operations', transfers.length],
    ]);
  },
  async positions() {
    grids.positions.setRows(await panelRequest('GET', panelPath('/positions')));
  },
  async orders() {
    grids.orders.setRows(await panelRequest('GET', panelPath('/orders')));
  },
  async deals() {
    grids.deals.setRows(await panelRequest('GET', panelPath('/deals')));
  },
};

async function loadTab(tab) {
  const loader = TAB_LOADERS[tab];
  if (!currentLogin || !loader || loaded.has(tab)) return;
  const current = request;
  clearMessages(form, message);
  message.textContent = 'Loading...';
  try {
    await loader();
    if (current === request) loaded.add(tab);
    message.textContent = '';
  } catch (error) {
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  }
}

function writeState() {
  writeQuery({ login: currentLogin, tab: currentTab });
}

function renderOverview(data) {
  renderSummary(document.getElementById('identity'), [
    ['Account', data.login],
    ['Name', data.name || '—'],
    ['Group', data.group || '—'],
    ['Email', data.email || '—'],
  ]);

  const status = document.getElementById('status');
  const badges = [
    badge(data.isEnabled ? 'Active' : 'Inactive', data.isEnabled ? 'ok' : 'danger'),
    badge(data.isTradeEnabled ? 'Trade enabled' : 'Trade disabled', data.isTradeEnabled ? 'ok' : 'danger'),
  ];
  if (data.source === 'Archive') badges.push(badge('Deleted account (archive)', 'warn'));
  status.replaceChildren(inline(...badges));
  activateButton.hidden = false;
  activateButton.disabled = data.source === 'Archive';
  activateButton.title = data.source === 'Archive' ? 'A deleted account cannot be activated' : '';

  renderSummary(document.getElementById('figures'), [
    ['Start balance', data.startBalance === null ? 'Not in the comment' : money(data.startBalance)],
    ['Balance', money(data.balance)],
    ['Equity', money(data.equity)],
    ['Net profit', money(data.netProfit)],
    ['Growth', data.growthPercent === null ? '—' : `${money(data.growthPercent)}%`],
    ['Credit', money(data.credit)],
    ['Deposits', money(data.totalDeposits)],
    ['Withdrawals', money(data.totalWithdrawals)],
    ['Deals', data.dealCount.toLocaleString('en-US')],
    ['Leverage', data.leverage ? `1:${data.leverage}` : '—'],
    ['Registered (UTC)', data.registeredAt ? formatUtc(data.registeredAt) : '—'],
  ]);
  document.getElementById('comment').textContent = data.comment ? `Comment: ${data.comment}` : '';
  renderBalanceChart(document.getElementById('chart'), data.chart, chartMode);
}

function clearResults() {
  activateButton.hidden = true;
  for (const id of ['identity', 'status', 'figures', 'chart', 'transfer-totals'])
    document.getElementById(id).replaceChildren();
  document.getElementById('comment').textContent = '';
  for (const grid of Object.values(grids)) grid.clear();
  document.getElementById('open-positions-title').textContent = 'Open positions';
  document.getElementById('open-orders-title').textContent = 'Active orders';
}

async function search(login) {
  const current = ++request;
  clearResults();
  overview = null;
  loaded = new Set();
  currentLogin = login;
  message.textContent = 'Loading...';
  const data = await panelRequest('GET', panelPath(''));
  if (current !== request) return;
  overview = data;
  renderOverview(data);
  writeState();
  message.textContent = '';
  await loadTab(currentTab);
}

async function submit() {
  const submitButton = form.querySelector('button[type="submit"]');
  clearMessages(form, message);
  submitButton.disabled = true;
  try {
    await search(formValues(form).login);
  } catch (error) {
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
}

async function activate() {
  if (!currentLogin || !confirm(`Activate account ${currentLogin}?`)) return;
  const login = currentLogin;
  clearMessages(form, message);
  activateButton.disabled = true;
  message.textContent = 'Activating...';
  try {
    const result = await panelRequest('POST', 'account-activation/enable', { login: Number(login) });
    await search(login);
    message.textContent = `Activation request accepted (HTTP ${result.statusCode}).`;
  } catch (error) {
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    activateButton.disabled = overview?.source === 'Archive';
  }
}

activateButton.addEventListener('click', activate);

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (!tab) return;
  showTab(tab);
  if (currentLogin) {
    writeState();
    loadTab(currentTab);
  }
});

document.getElementById('chart-mode').addEventListener('click', event => {
  const mode = event.target.closest('button')?.dataset.mode;
  if (!mode || !overview) return;
  chartMode = mode;
  for (const button of document.querySelectorAll('#chart-mode button'))
    button.setAttribute('aria-pressed', String(button.dataset.mode === chartMode));
  renderBalanceChart(document.getElementById('chart'), overview.chart, chartMode);
});

form.addEventListener('submit', event => {
  event.preventDefault();
  submit();
});

renderMenu();
showTab(new URLSearchParams(location.search).get('tab'));
if (fillFormFromQuery(form) && form.elements.login.value) submit();
