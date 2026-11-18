// Formatters and column helpers for MetaTrader data (account data and position details pages).

const label = value => {
  const text = String(value).replace(/^(DEAL_REASON_|ORDER_REASON_|REASON_|DEAL_|POSITION_|OP_|ORDER_STATE_|ENTRY_|ACTION_|TYPE_|MT_RET_)/, '').replaceAll('_', ' ').toLowerCase();
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

// Seconds as "1d 02:03:04.567".
const duration = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  const totalMs = Math.round(seconds * 1000);
  const days = Math.floor(totalMs / 86400000);
  const clock = [Math.floor((totalMs % 86400000) / 3600000), Math.floor((totalMs % 3600000) / 60000), Math.floor((totalMs % 60000) / 1000)]
    .map(part => String(part).padStart(2, '0')).join(':');
  const text = `${clock}.${String(totalMs % 1000).padStart(3, '0')}`;
  return days ? `${days}d ${text}` : text;
};

const column = (key, title, format) => ({ key, title, format });

// A position-history row that is a trade; the others are deposits, withdrawals and other balance operations.
const isTrade = row => /(^|_)(BUY|SELL)$/.test(String(row.direction ?? ''));
const tradeOnly = format => (value, row) => isTrade(row) ? format(value, row) : '—';
const labelColumn = (key, title) => column(key, title, value => sideLabel(label(value), value));
const entryColumn = (key, title) => column(key, title, value => entryLabel(label(value), value));
const orderStateColumn = (key, title) => column(key, title, value => orderStateLabel(label(value), value));
const priceColumn = (key, title) => column(key, title, price);
const amountColumn = (key, title) => column(key, title, amount);

// Who opened, placed or closed a deal, order or position (its MetaTrader reason). CLIENT and FIRST, and CORPORATE_ACTION
// and LAST, are the same value, so either name can arrive.
const SOURCE_LABELS = {
  CLIENT: 'Client', FIRST: 'Client', MOBILE: 'Mobile', WEB: 'Web', EXPERT: 'Expert', DEALER: 'Dealer',
  SL: 'Stop loss', TP: 'Take profit', SO: 'Stop out', EXTERNAL_CLIENT: 'External client', VMARGIN: 'Variation margin',
  CORPORATE_ACTION: 'Corporate action', LAST: 'Corporate action', EXTERNAL_SERVICE: 'External service',
};
const SOURCE_PLATFORMS = { CLIENT: 'system', FIRST: 'system', MOBILE: 'mobile', WEB: 'web', EXPERT: 'expert' };

const source = value => {
  const code = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_').replace(/^.*REASON_/, '');
  if (!code) return '—';
  const text = SOURCE_LABELS[code] ?? label(code);
  if (!SOURCE_PLATFORMS[code] || typeof platformIcon !== 'function') return stopText(text);
  const cell = document.createElement('span');
  cell.className = 'platform-cell';
  cell.append(platformIcon(SOURCE_PLATFORMS[code]), document.createTextNode(text));
  return cell;
};
const sourceColumn = (key, title) => column(key, title, source);

// The positions of several logins (trade history, the logins of an email), sortable by the report's field names. A
// function, so the pages that load this file without related-pages.js (loginActionsColumn) can still use the rest.
function loginPositionColumns() {
  const sorted = (definition, sortKey) => ({ ...definition, sortKey });
  return [
    { key: 'login', title: 'Login', sortKey: 'Login' },
    sorted(column('positionId', 'Position'), 'PositionId'),
    sorted(column('symbol', 'Symbol'), 'Symbol'),
    sorted(labelColumn('direction', 'Direction'), 'Direction'),
    sorted(column('volume', 'Volume', tradeOnly(lots)), 'Volume'),
    sorted(sourceColumn('openReason', 'Opened by'), 'OpenReason'),
    openColumn(sorted(utcColumn('openedAt', 'Opened'), 'OpenedAt')),
    openColumn(sorted(priceColumn('openPrice', 'Open price'), 'OpenPrice')),
    closeColumn(sorted(utcColumn('closedAt', 'Closed'), 'ClosedAt')),
    closeColumn(sorted(priceColumn('closePrice', 'Close price'), 'ClosePrice')),
    ...stopColumns('closeComment', true),
    sorted(column('durationSeconds', 'Open time', duration), 'DurationSeconds'),
    sorted(amountColumn('profit', 'Profit'), 'Profit'),
    sorted(amountColumn('commission', 'Commission'), 'Commission'),
    sorted(amountColumn('swap', 'Swap'), 'Swap'),
    sorted(amountColumn('fee', 'Fee'), 'Fee'),
    sorted(amountColumn('netProfit', 'Net profit'), 'NetProfit'),
    { ...sorted(column('isOpen', 'Status', tradeOnly(isOpen => badge(isOpen ? 'Open' : 'Closed', isOpen ? 'warn' : 'muted'))), 'IsOpen'), filterable: false },
    sorted(column('reason', 'Closed by', (reason, row) => row.isOpen ? '—' : source(reason)), 'Reason'),
    sorted(commentColumn('comment', 'Comment'), 'Comment'),
    sorted(commentColumn('closeComment', 'Close comment'), 'CloseComment'),
    loginActionsColumn('login', row => isTrade(row)
      ? [actionLink('Position details', `/position-details.html?login=${encodeURIComponent(row.login)}&position=${encodeURIComponent(row.positionId)}`)]
      : []),
  ];
}

// Text that names a stop loss ("[sl 1.0850]", "Stop loss") is red and one that names a take profit is green.
const stopText = value => {
  const text = value ?? '';
  const tone = /\bsl\b|stop loss/i.test(text) ? 'stop-sl' : /\btp\b|take profit/i.test(text) ? 'stop-tp' : '';
  if (!tone) return text;
  const element = document.createElement('span');
  element.className = tone;
  element.textContent = text;
  return element;
};
const commentColumn = (key, title) => column(key, title, stopText);

// SL and TP columns; the cell is red when the stop loss closed the row and green when the take profit did, read from
// the comment ("[sl 1.0850]") or the reason. Positions pass their closing comment.
const closedBy = (row, pattern, reason, commentKey) =>
  pattern.test(row[commentKey] ?? '') || String(row.reason ?? '').endsWith(reason);
const stopColumns = (commentKey = 'comment', sorted = false) => [
  { ...priceColumn('priceSl', 'SL'), ...(sorted ? { sortKey: 'PriceSl' } : {}), cellClass: row => closedBy(row, /\bsl\b/i, 'REASON_SL', commentKey) ? 'hit-sl' : '' },
  { ...priceColumn('priceTp', 'TP'), ...(sorted ? { sortKey: 'PriceTp' } : {}), cellClass: row => closedBy(row, /\btp\b/i, 'REASON_TP', commentKey) ? 'hit-tp' : '' },
];
