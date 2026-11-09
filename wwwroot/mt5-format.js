// Formatters and column helpers for MetaTrader data (account data and position details pages).

const label = value => {
  const text = String(value).replace(/^(DEAL_REASON_|ORDER_REASON_|DEAL_|POSITION_|OP_|ORDER_STATE_|ENTRY_|ACTION_|TYPE_|MT_RET_)/, '').replaceAll('_', ' ').toLowerCase();
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
const labelColumn = (key, title) => column(key, title, label);
const priceColumn = (key, title) => column(key, title, price);
const amountColumn = (key, title) => column(key, title, amount);
