// Position details page: one position of a MetaTrader account, read from the panel's Manager connection
// (/panel-api/mt5/account-data/position): its summary, its deals, and the transaction tracker records of the position.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const TABS = ['deals', 'transactions'];
let currentTab = 'deals';
let request = 0;

const grids = {
  deals: createLocalGrid({
    containerId: 'deals',
    pagerId: 'deals-pager',
    sort: { item: 'Time (UTC)', direction: 'Asc' },
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
      column('order', 'Order'),
      labelColumn('reason', 'Reason'),
      column('comment', 'Comment'),
    ],
  }),
  transactions: createLocalGrid({
    containerId: 'transactions',
    pagerId: 'transactions-pager',
    sort: { item: 'Time (UTC)', direction: 'Asc' },
    columns: [
      column('recordNo', 'Record'),
      utcColumn('time', 'Time'),
      codeColumn('actionText', 'Action', 'action'),
      codeColumn('typeText', 'Type', 'type'),
      codeColumn('entryText', 'Entry', 'entry'),
      column('symbol', 'Symbol'),
      column('lots', 'Volume', value => value === null ? '—' : lots(value)),
      priceColumn('price', 'Price'),
      priceColumn('bid', 'Bid'),
      priceColumn('ask', 'Ask'),
      priceColumn('priceGateway', 'Gateway price'),
      priceColumn('sl', 'SL'),
      priceColumn('tp', 'TP'),
      amountColumn('amount', 'Amount'),
      amountColumn('amountClosed', 'Closed amount'),
      amountColumn('profit', 'Profit'),
      amountColumn('commission', 'Commission'),
      amountColumn('swap', 'Swap'),
      column('order', 'Order'),
      column('deal', 'Deal'),
      codeColumn('reasonText', 'Reason', 'reason'),
      codeColumn('retcodeText', 'Result', 'retcode'),
      column('ip', 'IP'),
      column('platform', 'Device', platformLabel),
      column('accessPoint', 'Access point'),
      column('computerId', 'Computer ID'),
      column('dealer', 'Dealer'),
    ],
  }),
};

const codeText = code => code ? label(code.name) : '';

function codeColumn(key, title, codeKey) {
  return column(key, title, (text, row) => {
    const cell = document.createElement('span');
    cell.textContent = text || '—';
    cell.title = row[codeKey]?.description ?? '';
    return cell;
  });
}

function transactionRow(item) {
  return {
    ...item,
    actionText: codeText(item.action),
    typeText: codeText(item.type),
    entryText: codeText(item.entry),
    reasonText: codeText(item.reason),
    retcodeText: codeText(item.retcode),
  };
}

function showTab(tab) {
  currentTab = TABS.includes(tab) ? tab : 'deals';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === currentTab);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== currentTab;
}

function renderPosition(login, { position, deals }) {
  renderSummary(document.getElementById('summary'), [
    ['Account', login],
    ['Position', position.positionId],
    ['Symbol', position.symbol],
    ['Direction', label(position.direction)],
    ['Volume', lots(position.volume)],
    ['Opened (UTC)', formatUtc(position.openedAt)],
    ['Open price', price(position.openPrice)],
    ['Closed (UTC)', position.closedAt ? formatUtc(position.closedAt) : '—'],
    ['Close price', price(position.closePrice)],
    ['Open time', duration(position.durationSeconds)],
    ['Net profit', money(position.netProfit)],
    ['Status', position.isOpen ? 'Open' : 'Closed'],
    ['Deals', deals.length],
  ]);
  grids.deals.setRows(deals);
}

function writeState(login, position) {
  writeQuery({ login, position, ...(currentTab === 'deals' ? {} : { tab: currentTab }) });
}

async function search({ login, position }) {
  const current = ++request;
  document.getElementById('summary').replaceChildren();
  for (const grid of Object.values(grids)) grid.clear();
  message.textContent = 'Loading...';
  const [detail] = await Promise.allSettled([
    panelRequest('GET', `mt5/account-data/position${toQueryString({ login, position })}`),
  ]);
  if (current !== request) return;
  const orders = detail.status === 'fulfilled'
    ? [...new Set(detail.value.deals.map(deal => deal.order).filter(order => order > 0))]
    : [];
  const [tracker] = await Promise.allSettled([
    apiGet('transaction-reports/get-position-transactions', { position, orders }),
  ]);
  if (current !== request) return;
  if (detail.status === 'rejected' && tracker.status === 'rejected') throw detail.reason;
  if (detail.status === 'fulfilled') renderPosition(login, detail.value);
  if (tracker.status === 'fulfilled') grids.transactions.setRows(tracker.value.map(transactionRow));
  const failure = [detail, tracker].find(result => result.status === 'rejected');
  const back = document.getElementById('back');
  back.href = `/account-data.html?login=${encodeURIComponent(login)}&tab=positions`;
  back.hidden = false;
  writeState(login, position);
  message.textContent = '';
  if (failure) throw failure.reason;
}

async function submit() {
  const submitButton = form.querySelector('button[type="submit"]');
  clearMessages(form, message);
  submitButton.disabled = true;
  try {
    await search(formValues(form));
  } catch (error) {
    message.textContent = '';
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
}

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (!tab) return;
  showTab(tab);
  const { login, position } = formValues(form);
  if (login && position && document.getElementById('summary').childElementCount) writeState(login, position);
});

form.addEventListener('submit', event => {
  event.preventDefault();
  submit();
});

renderMenu();
showTab(new URLSearchParams(location.search).get('tab'));
if (fillFormFromQuery(form) && form.elements.login.value && form.elements.position.value) submit();
