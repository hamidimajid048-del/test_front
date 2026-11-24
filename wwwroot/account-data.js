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
  position_close: 'Position closed',
  order_delete: 'Order deleted',
};

const CLOSE_POSITION_PERMISSION = 'account-data.close-position';
const DELETE_ORDER_PERMISSION = 'account-data.delete-order';

// The state of the account and trading comes from MetaTrader, the stop-out plugin's from the status service (when it
// cannot be read, the last change made from the panel). `last` is that change: { enabled, username, occurredAt }.
const SWITCHES = [
  {
    key: 'account', api: 'Account', title: 'Account', icon: 'user', permission: 'account-data.switch-account',
    description: 'The owner can sign in to the account.',
    effect: ['The owner will no longer be able to sign in.', 'The owner will be able to sign in again.'],
    state: (data) => data.isEnabled,
  },
  {
    key: 'trading', api: 'Trading', title: 'Trading', icon: 'trend', permission: 'account-data.switch-trading',
    description: 'The owner can open and close trades.',
    effect: ['The owner will no longer be able to open or close trades.', 'The owner will be able to trade again.'],
    state: (data) => data.isTradeEnabled,
  },
  {
    key: 'stop_out', api: 'StopOut', title: 'Stop-out plugin', icon: 'plug', permission: 'account-data.switch-stop-out',
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
  openColumn(priceColumn('priceOpen', 'Open price')),
  priceColumn('priceCurrent', 'Current price'),
  ...stopColumns(),
  amountColumn('profit', 'Profit'),
  amountColumn('swap', 'Swap'),
  openColumn(utcColumn('openedAt', 'Opened')),
  sourceColumn('reason', 'Opened by'),
  commentColumn('comment', 'Comment'),
  tradeActionsColumn('position', CLOSE_POSITION_PERMISSION, row => menuAction('Close position', () => openCloseDialog(row))),
];

// The "⋯" cell of an open position or active order, shown to the accounts that may use its action.
function tradeActionsColumn(key, permission, item) {
  return {
    key,
    title: 'Actions',
    sortable: false,
    filterable: false,
    format: (id, row) => can(me, permission) && !isArchived() ? rowMenu(`Actions for ${id}`, [item(row)]) : '',
  };
}

const orderColumns = [
  column('order', 'Order'),
  column('symbol', 'Symbol'),
  labelColumn('type', 'Type'),
  orderStateColumn('state', 'State'),
  column('volumeInitial', 'Volume', lots),
  column('volumeCurrent', 'Remaining', lots),
  priceColumn('priceOrder', 'Price'),
  priceColumn('priceTrigger', 'Trigger price'),
  ...stopColumns(),
  utcColumn('setupAt', 'Placed'),
  utcColumn('doneAt', 'Done'),
  utcColumn('expiresAt', 'Expires', true),
  { ...column('positionId', 'Position', value => value || '—'), linkRows: true },
  sourceColumn('reason', 'Placed by'),
  commentColumn('comment', 'Comment'),
];

const positionHistoryColumns = [
  column('positionId', 'Position'),
  column('symbol', 'Symbol'),
  labelColumn('direction', 'Direction'),
  column('volume', 'Volume', tradeOnly(lots)),
  sourceColumn('openReason', 'Opened by'),
  openColumn(utcColumn('openedAt', 'Opened')),
  openColumn(priceColumn('openPrice', 'Open price')),
  closeColumn(utcColumn('closedAt', 'Closed')),
  closeColumn(priceColumn('closePrice', 'Close price')),
  ...stopColumns('closeComment'),
  column('durationSeconds', 'Open time', duration),
  amountColumn('profit', 'Profit'),
  amountColumn('commission', 'Commission'),
  amountColumn('swap', 'Swap'),
  amountColumn('netProfit', 'Net profit'),
  column('isOpen', 'Status', tradeOnly(isOpen => badge(isOpen ? 'Open' : 'Closed', isOpen ? 'warn' : 'muted'))),
  column('reason', 'Closed by', (reason, row) => row.isOpen ? '—' : source(reason)),
  commentColumn('comment', 'Comment'),
  commentColumn('closeComment', 'Close comment'),
  { key: 'positionId', title: 'Actions', sortable: false, filterable: false, format: tradeOnly(positionId => actionLink('Details', `/position-details.html?login=${encodeURIComponent(currentLogin)}&position=${encodeURIComponent(positionId)}`)) },
];

const dealColumns = [
  column('deal', 'Deal'),
  utcColumn('time', 'Time'),
  labelColumn('action', 'Action'),
  entryColumn('entry', 'Entry'),
  column('symbol', 'Symbol'),
  column('volume', 'Volume', lots),
  priceColumn('price', 'Price'),
  ...stopColumns(),
  amountColumn('profit', 'Profit'),
  amountColumn('commission', 'Commission'),
  amountColumn('swap', 'Swap'),
  { ...column('positionId', 'Position', value => value || '—'), linkRows: true },
  column('order', 'Order'),
  sourceColumn('reason', 'Source'),
  commentColumn('comment', 'Comment'),
];

const transferColumns = [
  column('deal', 'Deal'),
  utcColumn('time', 'Time'),
  labelColumn('action', 'Type'),
  amountColumn('profit', 'Amount'),
  commentColumn('comment', 'Comment'),
];

const grids = {
  positions: createLocalGrid({
    containerId: 'positions',
    pagerId: 'positions-pager',
    sort: { item: 'Opened (UTC)', direction: 'Desc' },
    columns: positionHistoryColumns,
  }),
  orders: createLocalGrid({ containerId: 'orders', pagerId: 'orders-pager', columns: orderColumns, sort: { item: 'Placed (UTC)', direction: 'Desc' } }),
  deals: createLocalGrid({
    containerId: 'deals',
    pagerId: 'deals-pager',
    sort: { item: 'Time (UTC)', direction: 'Desc' },
    columns: dealColumns,
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
  transfers: createLocalGrid({ containerId: 'transfers', pagerId: 'transfers-pager', columns: transferColumns, sort: { item: 'Time (UTC)', direction: 'Desc' } }),
  openPositions: createLocalGrid({
    containerId: 'open-positions',
    pagerId: 'open-positions-pager',
    columns: positionColumns,
    sort: { item: 'Opened (UTC)', direction: 'Desc' },
  }),
  openOrders: createLocalGrid({
    containerId: 'open-orders',
    pagerId: 'open-orders-pager',
    columns: [...orderColumns, tradeActionsColumn('order', DELETE_ORDER_PERMISSION, row => menuAction('Delete order', () => deleteOrder(row)))],
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

const isArchived = () => overview?.source === 'Archive';

// One of an archived account's backup reports: the service sorts, filters and pages it, and writes the whole report
// when it is exported. Column keys are the report's fields, so their sort and filter keys are the same names. open()
// gives the number of rows.
function createBackupGrid({ containerId, pagerId, columns, kind, sort }) {
  const container = document.getElementById(containerId);
  const pagerContainer = document.getElementById(pagerId);
  const keyed = columns.map(column => column.sortable === false
    ? column
    : { ...column, sortKey: column.key.charAt(0).toUpperCase() + column.key.slice(1) });
  let login = null;
  let sortState = { ...sort };
  let filters = {};
  let paging = { currentPage: 1, pageSize: LOCAL_PAGE_SIZE };

  const params = () => ({
    login,
    sortItem: sortState.item,
    sortDirection: sortState.direction,
    ...columnFilterParams(filters),
  });
  const reload = () => withLoading(form, message, load);

  async function load() {
    const report = await apiGet(`account-data/get-${kind}`, { ...params(), ...paging });
    const shown = pagingOf(report.paging);
    renderTable(container, keyed, report.items, null, {
      sort: {
        item: sortState.item,
        direction: sortState.direction,
        onChange: (item, direction) => {
          sortState = { item, direction };
          paging = { ...paging, currentPage: 1 };
          return reload();
        },
      },
      filter: {
        values: filters,
        onChange: values => {
          filters = values;
          paging = { ...paging, currentPage: 1 };
          return reload();
        },
      },
      export: {
        name: containerId,
        all: {
          total: shown?.totalRecords ?? report.items.length,
          download: format => saveExport(`account-data/export-${kind}`, { ...params(), format }),
        },
      },
    });
    renderPager(pagerContainer, shown, (currentPage, pageSize) => {
      paging = { currentPage, pageSize };
      return reload();
    });
    return shown?.totalRecords ?? report.items.length;
  }

  return {
    open(account) {
      login = account;
      sortState = { ...sort };
      filters = {};
      paging = { currentPage: 1, pageSize: paging.pageSize };
      return load();
    },
  };
}

const backupGrids = {
  transfers: createBackupGrid({ containerId: 'transfers', pagerId: 'transfers-pager', columns: transferColumns, kind: 'transfers', sort: { item: 'Time', direction: 'Desc' } }),
  positions: createBackupGrid({ containerId: 'positions', pagerId: 'positions-pager', columns: positionHistoryColumns, kind: 'positions', sort: { item: 'OpenedAt', direction: 'Desc' } }),
  orders: createBackupGrid({ containerId: 'orders', pagerId: 'orders-pager', columns: orderColumns, kind: 'orders', sort: { item: 'SetupAt', direction: 'Desc' } }),
  deals: createBackupGrid({ containerId: 'deals', pagerId: 'deals-pager', columns: dealColumns, kind: 'deals', sort: { item: 'Time', direction: 'Desc' } }),
};

// The account's histories: the panel's MetaTrader lists, handled in the browser, or for an archived account (MetaTrader
// keeps no history for it) the service's backup report, sorted, filtered, paged and exported by the service. Gives the
// number of rows.
async function loadHistory(kind, suffix) {
  if (isArchived()) return backupGrids[kind].open(currentLogin);
  const rows = await panelRequest('GET', panelPath(suffix));
  grids[kind].setRows(rows);
  return rows.length;
}

const TAB_LOADERS = {
  async open() {
    const open = await panelRequest('GET', panelPath('/open'));
    grids.openPositions.setRows(open.positions);
    grids.openOrders.setRows(open.orders);
    document.getElementById('open-positions-title').textContent = `Open positions (${open.positions.length})`;
    document.getElementById('open-orders-title').textContent = `Active orders (${open.orders.length})`;
  },
  async transfers() {
    const operations = await loadHistory('transfers', '/transfers');
    renderSummary(document.getElementById('transfer-totals'), [
      ['Deposits', money(overview?.totalDeposits)],
      ['Withdrawals', money(overview?.totalWithdrawals)],
      ['Operations', operations],
    ]);
  },
  async positions() {
    await loadHistory('positions', '/positions');
  },
  async orders() {
    await loadHistory('orders', '/orders');
  },
  async changes() {
    grids.changes.setRows(await panelRequest('GET', `mt5/account-changes?login=${encodeURIComponent(currentLogin)}`));
  },
  async deals() {
    await loadHistory('deals', '/deals');
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

const ARCHIVED_TITLE = 'An archived account cannot be changed';

function lockForArchive(container, archived) {
  for (const element of container.querySelectorAll('input, select, button')) {
    element.disabled = archived;
    element.title = archived ? ARCHIVED_TITLE : '';
  }
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
  toggle.title = data.source === 'Archive' ? ARCHIVED_TITLE
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

  row.append(icon(definition.icon, 'control-icon'), text, state, toggle);
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
  summary.firstElementChild.prepend(icon('shieldUser', 'summary-icon'));
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

function actionButton(text, iconName, onClick, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.append(icon(iconName), text);
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

  const generate = actionButton('Generate', 'key', () => {
    input.value = generatePassword();
    result.textContent = '';
  });
  const check = actionButton('Check', 'check', async () => {
    const answer = await run('check');
    if (!answer) return;
    result.className = `password-result ${answer.valid ? 'good' : 'bad'}`;
    result.textContent = answer.valid ? 'This is the current password.' : 'This is not the current password.';
  });
  const change = actionButton('Change', 'pencil', async () => {
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
  const copy = actionButton('Copy', 'copy', async () => {
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

const PREVIEW_DELAY_MS = 300;

function reloadAccount(login) {
  return currentLogin === login ? search(login) : Promise.resolve();
}

// The close dialog of an open position: a warning when the symbol's market is closed (the position is still closed),
// the market price or a chosen price with the profit it gives, and a last confirmation.
async function openCloseDialog(row) {
  const login = currentLogin;
  const quotePath = closePrice => `mt5/position-close?login=${encodeURIComponent(login)}&position=${encodeURIComponent(row.position)}`
    + (closePrice === undefined ? '' : `&price=${encodeURIComponent(closePrice)}`);
  let quote;
  try {
    quote = await panelRequest('GET', quotePath());
  } catch (error) {
    toast('The position cannot be closed', 'error', error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE);
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'panel-dialog close-position-dialog';
  const heading = document.createElement('h3');
  heading.textContent = `Close position ${quote.position}?`;
  const details = document.createElement('div');
  details.className = 'summary';
  renderSummary(details, [
    ['Account', login],
    ['Symbol', quote.symbol],
    ['Direction', sideLabel(label(quote.direction), quote.direction)],
    ['Volume', lots(quote.volume)],
    ['Open price', price(quote.priceOpen)],
    ['Current price', price(quote.priceCurrent)],
    ['Current profit', amount(quote.profit)],
  ]);
  dialog.append(heading, details);

  if (!quote.isMarketOpen) {
    const warning = document.createElement('p');
    warning.className = 'dialog-warning';
    warning.append(icon('alert'), document.createTextNode(`The market for ${quote.symbol} is closed now. The position will still be closed at the price you choose.`));
    dialog.append(warning);
  }

  const modes = document.createElement('div');
  modes.className = 'toggle close-modes';
  const modeButton = (mode, text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.mode = mode;
    button.textContent = text;
    modes.append(button);
    return button;
  };
  modeButton('market', 'Market price');
  modeButton('chosen', 'Chosen price');

  const priceField = document.createElement('label');
  priceField.textContent = 'Close price';
  const priceInput = document.createElement('input');
  priceInput.type = 'text';
  priceInput.inputMode = 'decimal';
  priceInput.autocomplete = 'off';
  priceInput.value = quote.priceCurrent.toFixed(quote.digits);
  priceField.append(priceInput);

  const preview = document.createElement('div');
  preview.className = 'summary close-preview';
  const note = document.createElement('p');
  note.className = 'dialog-confirm-note';
  note.textContent = 'Are you sure you want to close this position? This cannot be undone.';

  const buttons = document.createElement('div');
  buttons.className = 'dialog-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'confirm danger-solid';
  confirm.textContent = 'Close position';
  buttons.append(cancel, confirm);
  dialog.append(modes, priceField, preview, note, buttons);

  let mode = 'market';
  let chosenPrice = null;
  let chosenProfit = null;
  let previewTimer = 0;
  let previewRequest = 0;

  const showPreview = profitAtPrice => renderSummary(preview, [
    ['Profit at this price', amount(profitAtPrice)],
    ['Profit change', amount(Math.round((profitAtPrice - quote.profit) * 100) / 100)],
  ]);

  async function loadPreview() {
    const current = ++previewRequest;
    const text = priceInput.value.trim().replaceAll(',', '');
    chosenPrice = null;
    confirm.disabled = true;
    if (!/^\d+(\.\d+)?$/.test(text) || Number(text) <= 0) {
      preview.replaceChildren();
      if (text) renderSummary(preview, [['Close price', 'Enter a price above zero.']]);
      return;
    }
    renderSummary(preview, [['Profit at this price', 'Calculating…']]);
    try {
      const answer = await panelRequest('GET', quotePath(text));
      if (current !== previewRequest) return;
      chosenPrice = Number(text);
      chosenProfit = answer.profitAtPrice;
      showPreview(answer.profitAtPrice);
      confirm.disabled = false;
    } catch (error) {
      if (current !== previewRequest) return;
      renderSummary(preview, [['Profit at this price', error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE]]);
    }
  }

  function setMode(next) {
    mode = next;
    for (const button of modes.querySelectorAll('button'))
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    priceField.hidden = mode !== 'chosen';
    clearTimeout(previewTimer);
    previewRequest++;
    if (mode === 'chosen') {
      loadPreview();
      priceInput.focus();
    } else {
      renderSummary(preview, [['Close at', 'The market price when the request reaches MetaTrader']]);
      confirm.disabled = false;
    }
  }

  modes.addEventListener('click', event => {
    const next = event.target.closest('button')?.dataset.mode;
    if (next && next !== mode) setMode(next);
  });
  priceInput.addEventListener('input', () => {
    clearTimeout(previewTimer);
    confirm.disabled = true;
    previewTimer = setTimeout(loadPreview, PREVIEW_DELAY_MS);
  });
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    clearTimeout(previewTimer);
    dialog.remove();
  });
  // The last check before the close: the price it is made at and the profit or loss it gives. At the market price both
  // are read again now, as the dialog may have been open for a while.
  async function confirmClose() {
    const market = mode !== 'chosen';
    let closePrice = chosenPrice;
    let profit = chosenProfit;
    if (market) {
      const fresh = await panelRequest('GET', quotePath());
      closePrice = fresh.priceCurrent;
      profit = fresh.profit;
    }
    const result = profit < 0 ? `a loss of ${money(-profit)}` : `a profit of ${money(profit)}`;
    return confirmAction({
      title: `Close position ${quote.position} at ${price(closePrice)}?`,
      message: market
        ? `Account ${login} · ${quote.symbol}. The position will be closed at the market price, now ${price(closePrice)}, with ${result}. The price can still move before MetaTrader closes it.`
        : `Account ${login} · ${quote.symbol}. The position will be closed at ${price(closePrice)} with ${result}.`,
      confirmText: 'Close position',
      danger: true,
    });
  }

  confirm.addEventListener('click', async () => {
    const body = { login: Number(login), position: quote.position, price: mode === 'chosen' ? chosenPrice : null };
    if (mode === 'chosen' && chosenPrice === null) return;
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      if (!await confirmClose()) {
        confirm.disabled = false;
        cancel.disabled = false;
        return;
      }
      const result = await panelRequest('POST', 'mt5/position-close', body);
      dialog.close();
      toast(`Position ${quote.position} closed`, 'success', `Deal ${result.deal} at ${price(result.price)}`);
      await reloadAccount(login);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        dialog.close();
        toast('The position was closed at another price', 'error', error.message);
        await reloadAccount(login);
        return;
      }
      toast('The position was not closed', 'error', error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE);
      confirm.disabled = false;
      cancel.disabled = false;
    }
  });

  document.body.append(dialog);
  setMode('market');
  dialog.showModal();
  cancel.focus();
}

async function deleteOrder(row) {
  const login = currentLogin;
  if (!await confirmAction({
    title: `Delete order ${row.order}?`,
    message: `Account ${login}. The order will be canceled and moved to the order history.`,
    confirmText: 'Delete order',
    danger: true,
  })) return;

  try {
    await panelRequest('POST', 'mt5/order-delete', { login: Number(login), order: row.order });
    toast(`Order ${row.order} deleted`, 'success', `Account ${login}`);
    await reloadAccount(login);
  } catch (error) {
    toast('The order was not deleted', 'error', error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE);
  }
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
  const identity = document.getElementById('identity');
  renderIconSummary(identity, [
    ['Account', data.login, 'layers'],
    ['Name', data.name || '—', 'user'],
    ['Group', data.group || '—', 'users'],
    ['Email', data.email || '—', 'mail'],
  ]);
  const lead = document.createElement('strong');
  lead.className = 'ad-identity-lead';
  lead.textContent = `Login ${data.login}`;
  identity.prepend(lead);

  document.getElementById('status').replaceChildren(
    ...(data.source === 'Archive' ? [badge('Archived', 'warn')] : []));
  renderControls(data, switches, status);
  renderPasswords();
  lockForArchive(document.getElementById('password-rows'), data.source === 'Archive');
  lockForArchive(balanceForm, data.source === 'Archive');

  renderIconSummary(document.getElementById('figures'), [
    ['Start balance', data.startBalance === null ? 'Not in the comment' : money(data.startBalance), 'layers'],
    ['Balance', money(data.balance), 'wallet'],
    ['Equity', money(data.equity), 'layers'],
    ['Net profit', money(data.netProfit), data.netProfit < 0 ? 'trendDown' : 'trend', signTone(data.netProfit)],
    ['Growth', data.growthPercent === null ? '—' : `${money(data.growthPercent)}%`, 'percent', signTone(data.growthPercent)],
    ['Credit', money(data.credit), 'card'],
    ['Deposits', money(data.totalDeposits), 'download'],
    ['Withdrawals', money(data.totalWithdrawals), 'upload'],
    ['Deals', data.dealCount.toLocaleString('en-US'), 'list'],
    ['Leverage', data.leverage ? `1:${data.leverage}` : '—', 'scale'],
    ['Registered (UTC)', data.registeredAt ? formatUtcSeconds(data.registeredAt) : '—', 'calendar'],
    ...(data.comment ? [['Comment', data.comment, 'message', 'long']] : []),
  ]);
  renderBalanceChart(document.getElementById('chart'), data.chart, chartMode);
}

function clearResults() {
  document.querySelector('main.account-data').classList.remove('loaded');
  document.getElementById('stop-out-reason').textContent = '';
  document.getElementById('passwords').hidden = true;
  document.getElementById('password-rows').replaceChildren();
  lockForArchive(balanceForm, false);
  for (const id of ['identity', 'status', 'controls', 'stop-out-status', 'figures', 'chart', 'transfer-totals'])
    document.getElementById(id).replaceChildren();
  for (const grid of Object.values(grids)) grid.clear();
  document.getElementById('open-positions-title').textContent = 'Open positions';
  document.getElementById('open-orders-title').textContent = 'Active orders';
}

// MetaTrader keeps no deals for an archived account, so the deal figures and the growth chart come from the service's backup.
async function archivedDealFigures(login) {
  try {
    const backup = await apiGet('account-data/get-overview', { login });
    return {
      netProfit: backup.netProfit,
      totalDeposits: backup.totalDeposits,
      totalWithdrawals: backup.totalWithdrawals,
      dealCount: backup.dealCount,
      chart: backup.chart,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('[panel] backup overview request failed', error);
    return {};
  }
}

async function search(login) {
  const current = ++request;
  clearResults();
  clearRelatedPages();
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
  if (data.source === 'Archive') Object.assign(data, await archivedDealFigures(login));
  if (current !== request) return;
  overview = data;
  renderOverview(data, switches, status);
  document.querySelector('main.account-data').classList.add('loaded');
  showRelatedPages({ login: data.login, email: data.email });
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
