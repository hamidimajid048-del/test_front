// Account data page: one MetaTrader account read from the panel's Manager connection (/panel-api/mt5/account-data):
// status, balances and growth chart, open positions and orders, deposits and withdrawals, and the position, order and
// deal histories. Each tab is read when it is first opened.

const form = document.getElementById('filters');
const message = document.getElementById('message');
let me = null;
currentAccount().then(account => { me = account; });
const TABS = ['overview', 'open', 'transfers', 'positions', 'orders', 'deals', 'changes'];

// One label per change action the panel records (Mt5ChangeLog); an action without one shows its own name.
const CHANGE_ACTIONS = {
  account_enable: 'Account enabled',
  account_disable: 'Account disabled',
  trading_enable: 'Trading enabled',
  trading_disable: 'Trading disabled',
  stop_out_enable: 'Stop-out plugin enabled',
  stop_out_disable: 'Stop-out plugin disabled',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  password_main_change: 'Main password changed',
  password_main_check: 'Main password checked',
  password_investor_change: 'Investor password changed',
  password_investor_check: 'Investor password checked',
};

// The state of the account and trading comes from MetaTrader, the stop-out plugin's from the status service (when it
// cannot be read, the last change made from the panel). `last` is that change: { enabled, username, occurredAt }.
const SWITCHES = [
  {
    key: 'account', api: 'Account', title: 'Account', permission: 'account-data.switch-account',
    description: 'The owner can sign in to the account.',
    effect: ['The owner will no longer be able to sign in.', 'The owner will be able to sign in again.'],
    state: (data) => data.isEnabled,
  },
  {
    key: 'trading', api: 'Trading', title: 'Trading', permission: 'account-data.switch-trading',
    description: 'The owner can open and close trades.',
    effect: ['The owner will no longer be able to open or close trades.', 'The owner will be able to trade again.'],
    state: (data) => data.isTradeEnabled,
  },
  {
    key: 'stop_out', api: 'StopOut', title: 'Stop-out plugin', permission: 'account-data.switch-stop-out',
    description: 'The stop-out plugin watches the account.',
    effect: ['', 'The stop-out plugin will watch this account.'],
    enableOnly: true,
    state: (data, last, status) => ({ Enabled: true, Disabled: false })[status?.pluginState] ?? last?.enabled ?? null,
  },
];

let currentTab = 'overview';
let currentLogin = null;
let overview = null;
let chartMode = 'amount';
let loaded = new Set();
let request = 0;

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
  utcColumn('expiresAt', 'Expires', true),
  column('positionId', 'Position', value => value || '—'),
  labelColumn('reason', 'Reason'),
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
      column('durationSeconds', 'Open time', duration),
      amountColumn('profit', 'Profit'),
      amountColumn('commission', 'Commission'),
      amountColumn('swap', 'Swap'),
      amountColumn('netProfit', 'Net profit'),
      column('isOpen', 'Status', isOpen => badge(isOpen ? 'Open' : 'Closed', isOpen ? 'warn' : 'muted')),
      labelColumn('reason', 'Reason'),
      column('comment', 'Comment'),
      { key: 'positionId', title: 'Actions', sortable: false, filterable: false, format: positionId => actionLink('Details', `/position-details.html?login=${encodeURIComponent(currentLogin)}&position=${encodeURIComponent(positionId)}`) },
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
      column('positionId', 'Position', value => value || '—'),
      column('order', 'Order'),
      labelColumn('reason', 'Reason'),
      column('comment', 'Comment'),
    ],
  }),
  changes: createLocalGrid({
    containerId: 'changes',
    pagerId: 'changes-pager',
    sort: { item: 'Time (UTC)', direction: 'Desc' },
    columns: [
      utcColumn('occurredAt', 'Time'),
      column('action', 'Change', value => CHANGE_ACTIONS[value] ?? label(value)),
      column('succeeded', 'Result', ok => badge(ok ? 'Succeeded' : 'Failed', ok ? 'ok' : 'danger')),
      column('detail', 'Detail'),
      column('username', 'By'),
      column('ipAddress', 'IP'),
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
  async changes() {
    grids.changes.setRows(await panelRequest('GET', `mt5/account-changes?login=${encodeURIComponent(currentLogin)}`));
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
  setLoading(message);
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

function switchRow(data, last, status, definition) {
  const enabled = definition.state(data, last, status);
  const locked = definition.enableOnly && enabled === true;
  const allowed = can(me, definition.permission) && data.source !== 'Archive' && !locked;

  const row = document.createElement('div');
  row.className = 'control';
  const text = document.createElement('div');
  text.className = 'control-text';
  const title = document.createElement('strong');
  title.textContent = definition.title;
  const description = document.createElement('span');
  description.textContent = definition.description;
  text.append(title, description);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `switch ${enabled === null ? 'unknown' : enabled ? 'on' : 'off'}`;
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(enabled === true));
  toggle.setAttribute('aria-label', definition.title);
  toggle.disabled = !allowed;
  toggle.title = data.source === 'Archive' ? 'A deleted account cannot be changed'
    : locked ? 'This can only be enabled, not disabled'
    : allowed ? '' : 'You do not have permission to change this';
  toggle.append(document.createElement('span'));
  toggle.addEventListener('click', () => changeSwitch(definition, enabled !== true, toggle));

  const state = document.createElement('div');
  state.className = 'control-state';
  const stateText = document.createElement('strong');
  stateText.textContent = enabled === null ? 'Unknown' : enabled ? 'Enabled' : 'Disabled';
  state.append(stateText);
  if (last) {
    const lastChange = document.createElement('span');
    lastChange.textContent = `Last change by ${last.username ?? 'unknown'} · ${formatUtc(last.occurredAt)} UTC`;
    state.append(lastChange);
  }

  row.append(text, state, toggle);
  return row;
}

function renderControls(data, changes, status) {
  const byKey = new Map(changes.map(change => [change.switch, change]));
  document.getElementById('controls').replaceChildren(
    ...SWITCHES.map(definition => switchRow(data, byKey.get(definition.key), status, definition)));
  renderStopOutStatus(status);
}

const STATUS_BADGES = { Monitored: 'ok', StoppedOut: 'danger', Liquidated: 'danger', Disabled: 'muted' };
const words = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2');

function renderStopOutStatus(status) {
  const summary = document.getElementById('stop-out-status');
  const reason = document.getElementById('stop-out-reason');
  if (!status) {
    summary.replaceChildren();
    reason.textContent = '';
    return;
  }

  const items = [['Status', badge(words(status.status), STATUS_BADGES[status.status] ?? 'warn')]];
  if (status.metaTrader) {
    items.push(['Total limit', money(status.rule?.totalLimit)], ['To total limit', money(status.metaTrader.totalLimitDistance)]);
    if (status.monitor?.dailyCheckActive)
      items.push(['Daily limit', money(status.rule?.dailyLimit)], ['To daily limit', money(status.metaTrader.dailyLimitDistance)]);
  }

  const trigger = status.lastTrigger;
  if (trigger)
    items.push(
      ['Trigger', badge(words(trigger.type), 'warn')],
      ['Triggered (UTC)', formatUtc(trigger.time)],
      ['Balance at trigger', money(trigger.balance)],
      ['Equity at trigger', money(trigger.equity)]);

  const liquidation = status.liquidation;
  if (liquidation) {
    const failed = liquidation.consecutiveFailures > 0 || Boolean(liquidation.lastError);
    items.push(
      ['Liquidation', badge(words(liquidation.stage), failed ? 'danger' : liquidation.completedAt ? 'ok' : 'warn')],
      ['Attempts', liquidation.attempts],
      ['Liquidation ended (UTC)', liquidation.completedAt ? formatUtc(liquidation.completedAt) : '—']);
  }

  renderSummary(summary, items);
  reason.textContent = [
    status.statusReason,
    status.stateConflict && `Conflict: ${typeof status.stateConflict === 'string' ? status.stateConflict : JSON.stringify(status.stateConflict)}`,
    liquidation?.lastError && `Liquidation error: ${liquidation.lastError}`,
  ].filter(Boolean).join(' ');
}

async function changeSwitch(definition, enabled, toggle) {
  if (!currentLogin) return;
  const verb = enabled ? 'Enable' : 'Disable';
  const confirmed = await confirmAction({
    title: `${verb} ${definition.title.toLowerCase()}?`,
    message: `Account ${currentLogin}. ${definition.effect[enabled ? 1 : 0]}`,
    confirmText: verb,
    danger: !enabled,
  });
  if (!confirmed) return;

  const login = currentLogin;
  clearMessages(form, message);
  toggle.disabled = true;
  try {
    await panelRequest('POST', 'mt5/account-switch', { login: Number(login), switch: definition.api, enabled });
    await search(login);
    toast(`${definition.title} ${enabled ? 'enabled' : 'disabled'}`, 'success', `Account ${login}`);
  } catch (error) {
    toast(`${definition.title} was not changed`, 'error', error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE);
    toggle.disabled = false;
  }
}

const PASSWORD_TYPES = [['Main', 'Main password'], ['Investor', 'Investor password']];
const PASSWORD_LENGTH = 12;
const PASSWORD_CLASSES = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '#$%&*+-=?@'];

// A random password with at least one character of every class, drawn with the browser's secure generator.
function generatePassword() {
  const pick = alphabet => alphabet[crypto.getRandomValues(new Uint32Array(1))[0] % alphabet.length];
  const characters = [...PASSWORD_CLASSES.map(pick), ...Array.from({ length: PASSWORD_LENGTH - PASSWORD_CLASSES.length }, () => pick(PASSWORD_CLASSES.join('')))];
  for (let i = characters.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
}

function actionButton(text, onClick, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  if (danger) button.className = 'danger';
  button.addEventListener('click', onClick);
  return button;
}

function passwordRow(type, title) {
  const row = document.createElement('div');
  row.className = 'password-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 16;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = title;
  input.setAttribute('aria-label', title);
  const result = document.createElement('span');
  result.className = 'password-result';

  const run = async operation => {
    result.className = 'password-result';
    result.textContent = '';
    try {
      return await panelRequest('POST', `mt5/account-password/${operation}`, { login: Number(currentLogin), type, password: input.value });
    } catch (error) {
      result.className = 'password-result bad';
      if (!(error instanceof ApiError)) console.error('[panel] password request failed', error);
      result.textContent = error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE;
      return undefined;
    }
  };

  const generate = actionButton('Generate', () => {
    input.value = generatePassword();
    result.textContent = '';
  });
  const check = actionButton('Check', async () => {
    const answer = await run('check');
    if (!answer) return;
    result.className = `password-result ${answer.valid ? 'good' : 'bad'}`;
    result.textContent = answer.valid ? 'This is the current password.' : 'This is not the current password.';
  });
  const change = actionButton('Change', async () => {
    if (!await confirmAction({
      title: `Change the ${title.toLowerCase()}?`,
      message: `Account ${currentLogin}. The owner must use the new password from now on.`,
      confirmText: 'Change',
      danger: true,
    })) return;
    const login = currentLogin;
    if (await run('change') === undefined) return;
    result.className = 'password-result good';
    result.textContent = 'Changed.';
    toast(`${title} changed`, 'success', `Account ${login}`);
  }, true);
  const copy = actionButton('Copy', async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      result.className = 'password-result good';
      result.textContent = 'Copied.';
    } catch {
      result.className = 'password-result bad';
      result.textContent = 'Copying is not available here; select the password and copy it.';
    }
  });
  row.append(input, generate, copy, check, change, result);
  return row;
}

function renderPasswords() {
  document.getElementById('password-rows').replaceChildren(...PASSWORD_TYPES.map(([type, title]) => passwordRow(type, title)));
  document.getElementById('passwords').hidden = false;
}

const balanceForm = document.getElementById('balance-form');

balanceForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!currentLogin) return;
  const kind = balanceForm.elements.kind.value;
  const amountText = balanceForm.elements.amount.value.trim().replaceAll(',', '');
  const comment = balanceForm.elements.comment.value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
    toast('Enter an amount above zero with at most two decimals', 'error');
    return;
  }
  if (!comment) {
    toast('A comment is required', 'error');
    return;
  }
  const amount = Number(amountText);
  const verb = kind === 'Deposit' ? 'Deposit' : 'Withdraw';
  if (!await confirmAction({
    title: `${verb} ${money(amount)}?`,
    message: `Account ${currentLogin}. Comment: ${comment}`,
    confirmText: verb,
    danger: kind === 'Withdrawal',
  })) return;

  const login = currentLogin;
  const submitButton = balanceForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    await panelRequest('POST', 'mt5/account-balance', { login: Number(login), kind, amount, comment });
    balanceForm.reset();
    await search(login);
    toast(`${kind === 'Deposit' ? 'Deposit' : 'Withdrawal'} of ${money(amount)} done`, 'success', `Account ${login}`);
  } catch (error) {
    toast(`The ${kind.toLowerCase()} was not made`, 'error', error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE);
  } finally {
    submitButton.disabled = false;
  }
});

function renderOverview(data, switches, status) {
  renderSummary(document.getElementById('identity'), [
    ['Account', data.login],
    ['Name', data.name || '—'],
    ['Group', data.group || '—'],
    ['Email', data.email || '—'],
  ]);

  document.getElementById('status').replaceChildren(
    ...(data.source === 'Archive' ? [badge('Deleted account (archive)', 'warn')] : []));
  renderControls(data, switches, status);
  renderPasswords();

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
    ['Registered (UTC)', data.registeredAt ? formatUtcSeconds(data.registeredAt) : '—'],
  ]);
  document.getElementById('comment').textContent = data.comment ? `Comment: ${data.comment}` : '';
  renderBalanceChart(document.getElementById('chart'), data.chart, chartMode);
}

function clearResults() {
  document.getElementById('stop-out-reason').textContent = '';
  document.getElementById('passwords').hidden = true;
  document.getElementById('password-rows').replaceChildren();
  for (const id of ['identity', 'status', 'controls', 'stop-out-status', 'figures', 'chart', 'transfer-totals'])
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
  setLoading(message);
  me = await currentAccount();
  const [data, switches, status] = await Promise.all([
    panelRequest('GET', panelPath('')),
    panelRequest('GET', `mt5/account-switches?login=${encodeURIComponent(login)}`).catch(() => []),
    panelRequest('GET', `mt5/account-status?login=${encodeURIComponent(login)}`).catch(() => null),
  ]);
  if (current !== request) return;
  overview = data;
  renderOverview(data, switches, status);
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
