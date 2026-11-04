// Formatters and column helpers for MetaTrader data (account data and position details pages).

const label = value => {
  const text = String(value).replace(/^(DEAL_REASON_|ORDER_REASON_|DEAL_|POSITION_|OP_|ORDER_STATE_|ENTRY_)/, '').replaceAll('_', ' ').toLowerCase();
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

const duration = seconds => {
  if (seconds === null || seconds === undefined) return '—';
  const days = Math.floor(seconds / 86400);
  const clock = [Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(part => String(part).padStart(2, '0')).join(':');
  return days ? `${days}d ${clock}` : clock;
};

const column = (key, title, format) => ({ key, title, format });
const labelColumn = (key, title) => column(key, title, label);
const priceColumn = (key, title) => column(key, title, price);
const amountColumn = (key, title) => column(key, title, amount);
