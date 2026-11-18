// Shared helpers for all panel pages: API calls, tables, paging, form <-> query string, loading state.

const API_PREFIX = '/api/';
const SUCCESS_STATUS_CODE = 1;
const VALIDATION_ERROR_STATUS_CODE = 201;
const INVALID_PARAMETER_PREFIX = 'InvalidParameter:';
const UNAVAILABLE_MESSAGE = 'Service unavailable';
const INVALID_INPUT_MESSAGE = 'Check the highlighted inputs';
const INVALID_VALUE_MESSAGE = 'This value is not valid';
const PAGE_SIZES = [50, 100, 250, 500, 1000, 2000];
// A 401 means the panel session or the admin's Identity token ended; the panel signs out and asks for a new sign-in.
const SESSION_EXPIRED_PAGE = '/login.html?error=expired';

const FORBIDDEN_MESSAGE = 'You do not have permission to do this.';

// The menu groups, in the order shown; each page of MENU_ITEMS names its group.
const MENU_GROUPS = [
  { key: 'accounts', title: 'Accounts & trades', icon: 'layers' },
  { key: 'logins', title: 'Logins, IP & CID', icon: 'users' },
  { key: 'compare', title: 'Comparison', icon: 'link' },
  { key: 'operations', title: 'Operations', icon: 'settings' },
];

// Each page needs one permission; the server enforces the same rules, so this only decides what is shown.
const MENU_ITEMS = [
  { group: 'accounts', href: '/account-data.html', icon: 'database', title: 'Account data', permission: 'account-data.view', description: "One account's status, start and current balance, net profit, growth chart, open positions and orders, deposits and withdrawals, and the position, order and deal histories." },
  { group: 'accounts', href: '/trade-history.html', icon: 'swap', title: 'Trade history', permission: 'trade-history.view', description: 'Positions, orders or deals of every account in a range of days, with the login of each row.' },
  { group: 'logins', href: '/logins.html', icon: 'monitor', title: 'Login history', permission: 'logins.view', description: 'Sessions of a login with IP, CID, location and VPN/proxy warnings.' },
  { group: 'logins', href: '/email-logins.html', icon: 'mail', title: 'Email logins', permission: 'email-logins.view', description: 'Every login of an email (from the MetaTrader backup) with its IPs, CIDs and full login history in a date range.' },
  { group: 'logins', href: '/similarity.html', icon: 'fingerprint', title: 'IP/CID similarity', permission: 'similarity.view', description: 'Logins that share an IP or CID, with details and Excel/CSV export.' },
  { group: 'logins', href: '/value-search.html', icon: 'search', title: 'CID / IP search', permission: 'value-search.view', description: 'Every login that used a given CID or IP, with its login count and when it was first and last seen.' },
  { group: 'compare', href: '/copy-trade.html', icon: 'swap', title: 'Copy trade & hedge', permission: 'copy-trade.view', description: "Accounts that opened the same or the opposite trades around this login's openings." },
  { group: 'compare', href: '/compare.html', icon: 'layers', title: 'Compare accounts', permission: 'compare.view', description: 'Two logins side by side: shared IPs and CIDs with their details, near and overlapping logins, a merged timeline, and transactions made from a shared IP or computer ID.' },
  { group: 'compare', href: '/compare-logins.html', icon: 'users', title: 'Compare with logins', permission: 'compare.view', description: 'One login against one or more logins: evidence rating, which of them is linked to it, shared IPs and CIDs, and every session that used them.' },
  { group: 'compare', href: '/compare-emails.html', icon: 'mail', title: 'Compare emails', permission: 'compare-emails.view', description: 'All logins of one email against the logins of one or more emails: evidence rating, linked login pairs, shared IPs and CIDs, and every session that used them.' },
  { group: 'operations', href: '/bulk-balance.html', icon: 'wallet', title: 'Bulk deposit / withdraw', permission: 'account-data.balance-bulk', description: 'Deposit to or withdraw from many accounts at once from a CSV file (login, amount, comment), with a result for every row to download.' },
];

const ICON_PATHS = {
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  swap: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  fingerprint: '<path d="M6.5 6.5A7.5 7.5 0 0 1 19.5 12v1.5"/><path d="M4.5 11a7.5 7.5 0 0 1 .7-2.6M4.5 15v-2"/><path d="M8 18.5a17 17 0 0 0 1-6.5 3 3 0 0 1 6 0c0 3-.4 5.4-1.3 7.5"/><path d="M12 12c0 3.5-.6 6.3-2 8.5M17.8 17.5c.4-1.2.7-2.5.9-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  wallet: '<path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3"/><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5"/><path d="M4 7.5h15a1 1 0 0 1 1 1V12h-4a2 2 0 0 0 0 4h4"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-5M11 16V7M15 16v-7M19 16V5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13" width="17" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  candles: '<path d="M7 3v3M7 15v6M17 3v5M17 17v4"/><rect x="5" y="6" width="4" height="9" rx="1"/><rect x="15" y="8" width="4" height="9" rx="1"/>',
  trend: '<path d="M3 20h18"/><path d="m4 15 5-5 4 4 7-8"/><path d="M15 6h5v5"/>',
  trendDown: '<path d="M3 20h18"/><path d="m4 7 5 5 4-4 7 8"/><path d="M15 16h5v-5"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 19h16"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  scale: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="m5 7-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>',
  bars: '<path d="M4 20h16"/><path d="M7 16v-4M11 16V8M15 16v-6M19 16V5"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 8.9 4.1-1.3 7-4.6 7-8.9V6z"/><path d="m9 12 2 2 4-4"/>',
  shieldUser: '<path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 8.9 4.1-1.3 7-4.6 7-8.9V6z"/><circle cx="12" cy="10" r="2.3"/><path d="M8.5 16c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7"/>',
  mailPlus: '<path d="M20 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/><path d="M19 15v6M16 18h6"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  stateFilled: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  stateCanceled: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  stateRejected: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  statePartial: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
  stateExpired: '<path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9"/>',
  statePlaced: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  stateRequest: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5M12 2.5V6"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  entryIn: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M3 12h11M10 8l4 4-4 4"/>',
  entryOut: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M9 12h11M16 8l4 4-4 4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
};

// One gradient shared by every line icon (stroke: url(#icon-gradient)); user space, so straight lines are painted too.
function ensureIconGradient() {
  if (document.getElementById('icon-gradient')) return;
  const defs = document.createElement('div');
  defs.innerHTML = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="icon-gradient" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22"><stop offset="0" stop-color="var(--icon-from)"/><stop offset="1" stop-color="var(--icon-to)"/></linearGradient></defs></svg>';
  document.body.append(defs.firstChild);
}

// Static markup names its icons: <button data-icon="grid">Overview</button> gets the icon in front of its text.
function applyIcons(root = document) {
  for (const element of root.querySelectorAll('[data-icon]')) {
    element.prepend(icon(element.dataset.icon));
    element.removeAttribute('data-icon');
  }
}

function icon(name, className = 'icon') {
  ensureIconGradient();
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICON_PATHS[name]}</svg>`;
  return span;
}

// The home page cards come from MENU_ITEMS, grouped like the menu, so a page added to the menu appears there too.
// A group whose pages the account may not open is hidden.
function renderCards(container) {
  container.className = 'card-groups';
  const sections = MENU_GROUPS.map(group => {
    const section = document.createElement('section');
    section.className = 'card-group';
    section.hidden = true;
    const heading = document.createElement('h2');
    heading.className = 'card-group-title';
    heading.append(icon(group.icon, 'card-group-icon'), group.title);
    const grid = document.createElement('div');
    grid.className = 'cards';
    const items = MENU_ITEMS.filter(item => item.group === group.key);
    const cards = items.map(item => {
      const card = document.createElement('a');
      card.className = 'card';
      card.href = item.href;
      card.dataset.permission = item.permission;
      const title = document.createElement('h3');
      title.textContent = item.title;
      const text = document.createElement('p');
      text.textContent = item.description;
      const body = document.createElement('div');
      body.className = 'card-body';
      body.append(title, text);
      card.append(icon(item.icon, 'card-icon'), body);
      return card;
    });
    grid.append(...cards);
    section.append(heading, grid);
    return { section, grid, items };
  });
  container.replaceChildren(...sections.map(({ section }) => section));
  currentAccount().then(me => {
    for (const { section, grid, items } of sections) {
      const shown = items.filter(item => can(me, item.permission)).length;
      section.hidden = shown === 0;
      grid.classList.toggle('few', shown <= 2);
    }
  });
}

const USERS_PAGE = { href: '/users.html', icon: 'users', title: 'Users', permission: 'users.view' };

const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16 9.6"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
};
const TOAST_SECONDS = { success: 4, error: 8 };
const TOAST_RESUME_SECONDS = 2;

// A short notification in the corner: kind is 'success' or 'error'; detail is an optional second line.
function toast(title, kind = 'success', detail = '') {
  if (!title) return;
  let stack = document.getElementById('toasts');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toasts';
    stack.className = 'toasts';
    document.body.append(stack);
  }

  const element = document.createElement('div');
  element.className = `toast ${kind}`;
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = TOAST_ICONS[kind] ?? TOAST_ICONS.success;
  const text = document.createElement('div');
  text.className = 'toast-text';
  const heading = document.createElement('strong');
  heading.textContent = title;
  text.append(heading);
  if (detail) {
    const line = document.createElement('span');
    line.textContent = detail;
    text.append(line);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '×';

  const dismiss = () => {
    element.classList.add('leaving');
    setTimeout(() => element.remove(), 200);
  };
  close.addEventListener('click', dismiss);
  element.append(icon, text, close);
  stack.append(element);
  // A notification stays while it is hovered or focused, so it can be read and its close button reached.
  let timer = setTimeout(dismiss, (TOAST_SECONDS[kind] ?? 4) * 1000);
  const pause = () => clearTimeout(timer);
  const resume = () => { timer = setTimeout(dismiss, TOAST_RESUME_SECONDS * 1000); };
  element.addEventListener('mouseenter', pause);
  element.addEventListener('focusin', pause);
  element.addEventListener('mouseleave', resume);
  element.addEventListener('focusout', resume);
}

// Number fields are plain text boxes (no spinner arrows) that accept digits only (and one dot when data-numeric="decimal"),
// and keep the value within the min and max attributes when left.
document.addEventListener('input', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.numeric) return;
  const decimal = input.dataset.numeric === 'decimal';
  let cleaned = input.value.replace(decimal ? /[^0-9.]/g : /\D/g, '');
  if (decimal) {
    const dot = cleaned.indexOf('.');
    if (dot >= 0) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replaceAll('.', '');
  }
  if (cleaned !== input.value) input.value = cleaned;
});
document.addEventListener('change', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.numeric || input.value === '' || input.value === '.') return;
  const value = Number(input.value);
  if (input.min !== '' && value < Number(input.min)) input.value = input.min;
  if (input.max !== '' && value > Number(input.max)) input.value = input.max;
}, true);

// Asks the user to confirm an action in a dialog; resolves true when confirmed. danger paints the button red.
function confirmAction({ title, message = '', confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'panel-dialog confirm-dialog';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const text = document.createElement('p');
    text.textContent = message;
    text.hidden = !message;
    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = confirmText;
    confirm.className = danger ? 'confirm danger-solid' : 'confirm';
    buttons.append(cancel, confirm);
    dialog.append(heading, text, buttons);

    cancel.addEventListener('click', () => dialog.close('cancel'));
    confirm.addEventListener('click', () => dialog.close('confirm'));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'confirm');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    (danger ? cancel : confirm).focus();
  });
}

class ApiError extends Error {
  // fieldErrors: { fieldName: [messages] } for request values the service could not read (a ValidationError response).
  // reason: the service's failure reason (status.description), such as "AccountNotFound", when there is one.
  constructor(message, fieldErrors = {}, reason = '') {
    super(message);
    this.fieldErrors = fieldErrors;
    this.reason = reason;
  }
}

// A ValidationError response lists each unreadable parameter as "InvalidParameter:<name>".
function isValidationError(body) {
  return body?.status?.code === VALIDATION_ERROR_STATUS_CODE && Array.isArray(body.errors);
}

function fieldErrorsOf(errors) {
  const fields = {};
  for (const error of errors) {
    const description = error?.description ?? '';
    const field = description.startsWith(INVALID_PARAMETER_PREFIX) ? description.slice(INVALID_PARAMETER_PREFIX.length) : description;
    if (field) (fields[field] ??= []).push(INVALID_VALUE_MESSAGE);
  }
  return fields;
}

// Builds a query string from the non-empty values of params; an array value repeats its key (logins=1&logins=2).
function toQueryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else if (value !== undefined && value !== null && String(value).trim() !== '') {
      query.set(key, String(value).trim());
    }
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

// One console line per panel request, for finding why a call failed: failures as warnings (with what the server said),
// successes at debug level. Request bodies are never logged (they can hold passwords).
function logRequest(method, url, started, outcome, detail = '') {
  const line = `[panel] ${method} ${url} -> ${outcome} (${Math.round(performance.now() - started)} ms)`;
  const failed = typeof outcome === 'string' || outcome >= 400;
  if (failed) console.warn(line, String(detail).slice(0, 300));
  else console.debug(line);
}

// Calls GET /api/{path} and returns `result`, or throws ApiError with a Persian message.
async function apiGet(path, params) {
  let response;
  const url = API_PREFIX + path + toQueryString(params);
  const started = performance.now();
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    logRequest('GET', url, started, 'network error', error?.message);
    throw new ApiError(UNAVAILABLE_MESSAGE);
  }
  logRequest('GET', url, started, response.status, response.ok ? '' : await response.clone().text().catch(() => ''));

  if (response.status === 401) {
    location.href = SESSION_EXPIRED_PAGE;
    throw new ApiError('');
  }
  if (response.status === 403) throw new ApiError(FORBIDDEN_MESSAGE);

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON bodies are handled below as an unavailable service.
  }

  if (isValidationError(body)) throw new ApiError(INVALID_INPUT_MESSAGE, fieldErrorsOf(body.errors));
  if (body?.status && typeof body.status === 'object') {
    if (response.ok && body.status.code === SUCCESS_STATUS_CODE) return body.result;
    throw new ApiError(translateStatus(body.status), {}, body.status.description ?? '');
  }
  throw new ApiError(UNAVAILABLE_MESSAGE);
}

// Builds the URL of an API file export, for use as a download link.
function apiUrl(path, params) {
  return API_PREFIX + path + toQueryString(params);
}

function fileNameFrom(contentDisposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? '');
  return match ? decodeURIComponent(match[1]) : 'export';
}

// Fetches an export so a failure (returned as JSON instead of a file) can be shown as a message.
// Saves the file an API export answers with; throws ApiError when the service answers with an error instead.
async function saveExport(path, params) {
  let response;
  try {
    response = await fetch(apiUrl(path, params));
  } catch {
    throw new ApiError(UNAVAILABLE_MESSAGE);
  }
  if (response.status === 401) {
    location.href = SESSION_EXPIRED_PAGE;
    throw new ApiError('');
  }
  if (response.status === 403) throw new ApiError(FORBIDDEN_MESSAGE);
  const contentType = response.headers.get('Content-Type') ?? '';
  if (response.ok && !contentType.includes('json')) {
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameFrom(response.headers.get('Content-Disposition'));
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  const body = await response.json().catch(() => null);
  if (isValidationError(body)) throw new ApiError([INVALID_INPUT_MESSAGE, ...Object.keys(fieldErrorsOf(body.errors))].join(' — '));
  if (body?.status && typeof body.status === 'object') throw new ApiError(translateStatus(body.status));
  throw new ApiError(UNAVAILABLE_MESSAGE);
}

async function downloadExport(path, params, button, messageElement) {
  button.disabled = true;
  messageElement.className = 'message';
  messageElement.textContent = 'Preparing file...';
  try {
    await saveExport(path, params);
    messageElement.textContent = '';
  } catch (error) {
    messageElement.className = 'message error';
    messageElement.textContent = error instanceof ApiError ? error.message : UNAVAILABLE_MESSAGE;
  } finally {
    button.disabled = false;
  }
}

// A "?" button after a column title that explains the column (column.help) on hover, on keyboard focus and on tap.
// One tooltip element is shared by all of them and floats over the page, so a scrolling table cannot clip it.
const HELP_TIP_ID = 'col-help-tip';
let helpTip = null;
let helpOwner = null;

function hideHelpTip() {
  if (helpTip) helpTip.hidden = true;
  helpOwner?.removeAttribute('aria-describedby');
  helpOwner = null;
}

function showHelpTip(button, text) {
  if (!helpTip) {
    helpTip = document.createElement('div');
    helpTip.id = HELP_TIP_ID;
    helpTip.className = 'col-help-tip';
    helpTip.setAttribute('role', 'tooltip');
    document.body.append(helpTip);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideHelpTip(); });
    document.addEventListener('scroll', hideHelpTip, true);
    document.addEventListener('pointerdown', event => { if (!event.target.closest?.('.col-help')) hideHelpTip(); }, true);
  }
  hideHelpTip();
  helpTip.textContent = t(text);
  helpTip.hidden = false;
  const box = button.getBoundingClientRect();
  const left = box.left + box.width / 2 - helpTip.offsetWidth / 2;
  helpTip.style.left = `${Math.min(Math.max(8, left), window.innerWidth - helpTip.offsetWidth - 8)}px`;
  helpTip.style.top = `${box.bottom + 6}px`;
  button.setAttribute('aria-describedby', HELP_TIP_ID);
  helpOwner = button;
}

function addColumnHelp(th, column) {
  if (!column.help) return;
  const mark = document.createElement('button');
  mark.type = 'button';
  mark.className = 'col-help';
  mark.textContent = '?';
  mark.setAttribute('aria-label', `About ${column.title}`);
  const show = () => showHelpTip(mark, column.help);
  mark.addEventListener('mouseenter', show);
  mark.addEventListener('focus', show);
  mark.addEventListener('click', show);
  mark.addEventListener('mouseleave', hideHelpTip);
  mark.addEventListener('blur', hideHelpTip);
  th.append(mark);
}

// A small coloured label. kind: 'ok' | 'warn' | 'danger' | 'main' | 'compared' | 'muted'.
function badge(text, kind = 'muted') {
  const element = document.createElement('span');
  element.className = `badge ${kind}`;
  element.textContent = text;
  return element;
}

// A trade side (any MetaTrader code with BUY or SELL in it) gets an up or down arrow in front of its text.
function sideLabel(text, code) {
  const side = /BUY/i.test(code) ? 'buy' : /SELL/i.test(code) ? 'sell' : '';
  return side ? iconLabel(text, side === 'buy' ? 'arrowUp' : 'arrowDown', side) : text;
}

const ENTRY_ICONS = { in: 'entryIn', out: 'entryOut', inout: 'swap' };

// A deal entry (IN, OUT, INOUT or OUT_BY, with or without its ENTRY_ prefix) gets an icon in front of its text.
function entryLabel(text, code) {
  const entry = String(code ?? '').toUpperCase().replace(/[\s/]+/g, '_').replace(/^.*ENTRY_/, '');
  const kind = /^IN_?OUT$/.test(entry) ? 'inout' : /^OUT(_BY)?$/.test(entry) ? 'out' : entry === 'IN' ? 'in' : '';
  return kind ? iconLabel(text, ENTRY_ICONS[kind], `entry-${kind}`) : text;
}

// An order state gets an icon and a colour: filled green, partially filled teal, canceled and rejected red, expired
// amber, placed or started blue and a pending request grey.
const ORDER_STATES = {
  FILLED: 'filled', PARTIAL: 'partial', CANCELED: 'canceled', CANCELLED: 'canceled', REJECTED: 'rejected',
  EXPIRED: 'expired', PLACED: 'placed', STARTED: 'placed',
};

function orderStateLabel(text, code) {
  const state = String(code ?? '').toUpperCase().replace(/[\s/]+/g, '_').replace(/^.*STATE_/, '');
  const kind = ORDER_STATES[state] ?? (state.startsWith('REQUEST') ? 'request' : '');
  return kind ? iconLabel(text, `state${kind[0].toUpperCase()}${kind.slice(1)}`, `state-${kind}`) : text;
}

// A trade request action of the transaction tracker (MetaTrader TA_ codes, matched by their words so any prefix or
// spelling works) gets an icon and a colour; a buy or sell gets its arrow and an unknown action stays plain text.
const TRADE_ACTIONS = [
  [/STOP_?OUT/, 'alert', 'act-stopout'],
  [/(^|_)SL$/, 'shield', 'act-sl'],
  [/(^|_)TP$/, 'target', 'act-tp'],
  [/SLTP|MODIFY/, 'pencil', 'act-modify'],
  [/REMOVE|CANCEL|DELETE/, 'stateCanceled', 'act-remove'],
  [/EXPIR/, 'stateExpired', 'act-expire'],
  [/ACTIVATE/, 'bolt', 'act-activate'],
  [/CLOSE/, 'entryOut', 'act-close'],
  [/PENDING|PLACE/, 'statePlaced', 'act-pending'],
  [/INSTANT|MARKET|EXCHANGE|REQUEST|PRICE|EXECUTE/, 'entryIn', 'act-market'],
  [/BALANCE|CREDIT|CHARGE|CORRECTION|BONUS|COMMISSION|DEPOSIT|WITHDRAW/, 'wallet', 'act-balance'],
];

function actionLabel(text, code) {
  const action = String(code ?? '').toUpperCase().replace(/[\s/-]+/g, '_');
  if (/BUY|SELL/.test(action)) return sideLabel(text, action);
  const match = TRADE_ACTIONS.find(([pattern]) => pattern.test(action));
  return match ? iconLabel(text, match[1], match[2]) : text;
}

function iconLabel(text, iconName, tone) {
  const cell = document.createElement('span');
  cell.className = `side-cell ${tone}`;
  cell.append(icon(iconName, 'side-icon'), text);
  return cell;
}

// Wraps nodes or text in a flex row, e.g. several badges in one table cell.
function inline(...parts) {
  const row = document.createElement('span');
  row.className = 'inline';
  row.append(...parts);
  return row;
}

const NAV_TOGGLE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>';

const BRAND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4 5.5v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10v-6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';

// The panel answers /service-status itself; MetaTrader is online while the Manager link is connected.
// A pill the account may not check (403) or a connection that is not enabled is left out.
function createServiceStatus() {
  const box = document.createElement('div');
  box.className = 'service-status';
  const pill = (iconName, title, request, isOnline) => {
    const element = document.createElement('span');
    element.className = `service-pill ${iconName}`;
    element.title = title;
    const state = document.createElement('span');
    state.className = 'service-state';
    state.textContent = 'Checking';
    const label = document.createElement('span');
    label.className = 'service-name';
    label.textContent = title;
    element.append(icon(iconName, 'service-icon'), label, state);
    request()
      .then(response => {
        if (response.status === 403 || response.status === 503) return null;
        return response.ok ? response.json().then(isOnline) : false;
      })
      .catch(() => false)
      .then(online => {
        if (online === null) {
          element.remove();
          return;
        }
        element.classList.add(online ? 'ok' : 'down');
        state.textContent = online ? 'Online' : 'Offline';
      });
    return element;
  };
  box.append(
    pill('server', 'Backend Service', () => fetch('/service-status', { cache: 'no-store' }), body => Boolean(body.available)),
    pill('candles', 'MetaTrader Service', () => fetch('/panel-api/mt5/status', { cache: 'no-store' }), body => Boolean(body.manager?.connected)));
  return box;
}

const SIDEBAR_CLOSED_KEY = 'violation-panel-sidebar-closed';
const SIDEBAR_HIDDEN_KEY = 'violation-panel-sidebar-hidden';
const NARROW_SCREEN = window.matchMedia('(max-width: 1100px)');

function closedSidebarGroups() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SIDEBAR_CLOSED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveClosedSidebarGroups(keys) {
  try {
    localStorage.setItem(SIDEBAR_CLOSED_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage may be unavailable (private mode); the groups still fold for this page.
  }
}

// The pages are in a sidebar of folding groups (the folded ones are remembered on this device); the top bar keeps the
// service status, theme, language and the account menu. The menu button hides or shows the sidebar (remembered on this
// device); on a narrow screen the sidebar is hidden and slides in over the page from the menu button.
function renderMenu() {
  const nav = document.getElementById('menu');
  document.body.classList.add('has-sidebar');
  document.body.classList.toggle('sidebar-hidden', readStorage(SIDEBAR_HIDDEN_KEY) === '1');

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = '/';
  const mark = document.createElement('span');
  mark.className = 'brand-mark';
  ensureIconGradient();
  mark.innerHTML = BRAND_ICON;
  brand.append(mark, 'Violation Panel');

  const closed = closedSidebarGroups();
  const groups = MENU_GROUPS.map(group => {
    const items = MENU_ITEMS.filter(item => item.group === group.key);
    const current = items.some(item => item.href === location.pathname);
    const element = document.createElement('div');
    element.className = 'side-group';
    element.hidden = true;
    element.classList.toggle('open', current || !closed.has(group.key));
    element.classList.toggle('active', current);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'side-group-button';
    button.setAttribute('aria-expanded', String(element.classList.contains('open')));
    button.append(icon(group.icon), group.title);
    const list = document.createElement('div');
    list.className = 'side-items';
    const links = items.map(item => {
      const link = document.createElement('a');
      link.className = 'side-item';
      link.href = item.href;
      link.hidden = true;
      link.title = item.description;
      link.textContent = item.title;
      if (location.pathname === item.href) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      return link;
    });
    list.append(...links);
    button.addEventListener('click', () => {
      const open = element.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
      if (open) closed.delete(group.key);
      else closed.add(group.key);
      saveClosedSidebarGroups(closed);
    });
    element.append(button, list);
    return { element, items, links };
  });

  const pages = document.createElement('div');
  pages.className = 'side-pages';
  pages.append(...groups.map(group => group.element));
  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';
  sidebar.id = 'sidebar';
  sidebar.append(brand, pages);
  const shade = document.createElement('div');
  shade.className = 'sidebar-shade';
  nav.before(sidebar, shade);

  // The signed-in account opens a menu with its Account page, the front-end version and Sign out.
  const account = document.createElement('div');
  account.className = 'nav-group nav-account';
  account.hidden = true;
  const accountButton = document.createElement('button');
  accountButton.type = 'button';
  accountButton.className = 'nav-group-button';
  accountButton.setAttribute('aria-haspopup', 'true');
  accountButton.setAttribute('aria-expanded', 'false');
  if (location.pathname === '/account.html') accountButton.classList.add('active');
  const username = document.createElement('span');
  username.translate = false;
  accountButton.append(icon('user', 'icon nav-avatar'), username);
  const setAccountOpen = open => {
    account.classList.toggle('open', open);
    accountButton.setAttribute('aria-expanded', String(open));
  };
  accountButton.addEventListener('click', () => setAccountOpen(!account.classList.contains('open')));
  document.addEventListener('pointerdown', event => {
    if (!account.contains(event.target)) setAccountOpen(false);
  });
  const accountLink = document.createElement('a');
  accountLink.className = 'nav-item';
  accountLink.href = '/account.html';
  if (location.pathname === '/account.html') accountLink.classList.add('active');
  accountLink.append(icon('user'), 'Account');
  const logout = document.createElement('form');
  logout.method = 'post';
  logout.action = '/auth/logout';
  const logoutButton = document.createElement('button');
  logoutButton.type = 'submit';
  logoutButton.className = 'nav-item logout';
  logoutButton.append(icon('logout'), 'Sign out');
  logout.append(logoutButton);
  // The version of the pages on this server: it changes with any edit of the front end, so it shows what is deployed.
  const version = document.createElement('span');
  version.className = 'nav-version';
  version.title = 'Front-end version on this server';
  fetch('/version', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(body => { if (body?.frontend) version.textContent = `v ${body.frontend}`; })
    .catch(() => {});
  const accountMenu = document.createElement('div');
  accountMenu.className = 'nav-group-menu';
  accountMenu.append(accountLink, logout, version);
  account.append(accountButton, accountMenu);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.title = 'Menu';
  toggle.setAttribute('aria-label', 'Menu');
  toggle.setAttribute('aria-controls', 'sidebar');
  toggle.innerHTML = NAV_TOGGLE_ICON;
  const showExpanded = () => toggle.setAttribute('aria-expanded', String(NARROW_SCREEN.matches
    ? document.body.classList.contains('sidebar-open')
    : !document.body.classList.contains('sidebar-hidden')));
  const setSidebarOpen = open => {
    document.body.classList.toggle('sidebar-open', open);
    showExpanded();
  };
  toggle.addEventListener('click', () => {
    if (NARROW_SCREEN.matches) {
      setSidebarOpen(!document.body.classList.contains('sidebar-open'));
      return;
    }
    const hidden = document.body.classList.toggle('sidebar-hidden');
    try {
      localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0');
    } catch {
      // Storage may be unavailable (private mode); the sidebar still hides for this page.
    }
    showExpanded();
  });
  NARROW_SCREEN.addEventListener('change', () => setSidebarOpen(false));
  showExpanded();
  shade.addEventListener('click', () => setSidebarOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (account.classList.contains('open')) {
      setAccountOpen(false);
      accountButton.focus();
    } else if (document.body.classList.contains('sidebar-open')) {
      setSidebarOpen(false);
      toggle.focus();
    }
  });

  const divider = document.createElement('span');
  divider.className = 'nav-divider';
  const actions = document.createElement('div');
  actions.className = 'nav-actions';
  actions.append(createServiceStatus(), divider, createThemeToggle(), createLanguageSwitcher(), account);
  nav.replaceChildren(toggle, actions);

  // Every page gets a visible h1 taken from its title ("Account data — Violation Panel"), beside the icon of its menu
  // entry; a page that writes its own header (with a subtitle) gets the icon only. The header sits in the top bar.
  const main = document.querySelector('main');
  const pageIcon = [...MENU_ITEMS, USERS_PAGE].find(item => item.href === location.pathname)?.icon ?? (location.pathname === '/account.html' ? 'user' : 'layers');
  let header = main?.querySelector('.page-header');
  if (main && !header && !main.querySelector('h1')) {
    const heading = document.createElement('h1');
    heading.className = 'page-title';
    heading.textContent = document.title.split(' — ')[0];
    header = document.createElement('header');
    header.className = 'page-header';
    header.append(heading);
    main.prepend(header);
  }
  if (header && !header.querySelector('.page-icon')) header.prepend(icon(pageIcon, 'page-icon'));
  if (header) actions.before(header);
  applyIcons();

  currentAccount().then(me => {
    if (!me) return;
    username.textContent = me.username;
    account.hidden = false;
    for (const { element, items, links } of groups) {
      items.forEach((item, index) => { links[index].hidden = !can(me, item.permission); });
      element.hidden = links.every(link => link.hidden);
    }
    if (can(me, USERS_PAGE.permission)) {
      const users = document.createElement('a');
      users.className = 'side-link';
      users.href = USERS_PAGE.href;
      users.append(icon(USERS_PAGE.icon), USERS_PAGE.title);
      if (location.pathname === USERS_PAGE.href) {
        users.classList.add('active');
        users.setAttribute('aria-current', 'page');
      }
      pages.append(users);
    }
    applyPermissions(me);
    guardPage(me);
    if (!me.twoFactor && location.pathname !== '/account.html') {
      const banner = document.createElement('div');
      banner.className = 'banner warn';
      const link = document.createElement('a');
      link.href = '/account.html';
      link.append(icon('alert'), 'Two-factor is not set up. Set it up');
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'banner-close';
      dismiss.title = 'Dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.append(icon('close'));
      dismiss.addEventListener('click', () => banner.remove());
      banner.append(link, dismiss);
      nav.after(banner);
    }
  });
}

function can(me, permission) {
  return Boolean(me) && me.permissions.includes(permission);
}

// Hides what the account may not use: elements marked data-permission="key", and the export buttons.
function applyPermissions(me) {
  for (const element of document.querySelectorAll('[data-permission]'))
    if (!can(me, element.dataset.permission)) element.hidden = true;
  if (!can(me, 'reports.export'))
    for (const button of document.querySelectorAll('[data-export]')) button.hidden = true;
}

// For elements a page creates after the menu is drawn.
function hideUnlessAllowed(element, permission) {
  currentAccount().then(me => { if (!can(me, permission)) element.hidden = true; });
}

function guardPage(me) {
  const needed = [...MENU_ITEMS, USERS_PAGE].find(item => item.href === location.pathname)?.permission;
  if (!needed || can(me, needed)) return;
  const notice = document.createElement('p');
  notice.className = 'message error';
  notice.textContent = 'Your account does not have access to this page.';
  document.querySelector('main').replaceChildren(notice);
}

let currentAccountRequest;

// The signed-in account ({ id, username, role, permissions }), or null when it cannot be read.
function currentAccount() {
  currentAccountRequest ??= fetch('/panel-api/me', { headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
  return currentAccountRequest;
}

// Calls the panel's own account API (/panel-api/...). Returns the JSON body (null for an empty answer), or throws
// ApiError with the panel's message.
async function panelRequest(method, path, body) {
  const headers = { Accept: 'application/json', 'X-Panel-Request': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  const url = `/panel-api/${path}`;
  const started = performance.now();
  try {
    response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    logRequest(method, url, started, 'network error', error?.message);
    throw new ApiError(UNAVAILABLE_MESSAGE);
  }
  logRequest(method, url, started, response.status, response.ok ? '' : await response.clone().text().catch(() => ''));

  if (response.status === 401) {
    location.href = SESSION_EXPIRED_PAGE;
    throw new ApiError('');
  }
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error ?? `${UNAVAILABLE_MESSAGE} (HTTP ${response.status})`);
  return result;
}

// Formats an ISO timestamp as "yyyy-MM-dd HH:mm:ss.fff" in UTC.
function formatUtc(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').slice(0, 23);
}

// Formats an ISO timestamp as "yyyy-MM-dd HH:mm:ss" in UTC, for sources that keep whole seconds only.
function formatUtcSeconds(value) {
  return formatUtc(value).slice(0, 19);
}

// Column definition for a UTC timestamp field; wholeSeconds for sources without milliseconds.
function utcColumn(key, title, wholeSeconds = false) {
  return { key, title: `${title} (UTC)`, format: wholeSeconds ? formatUtcSeconds : formatUtc };
}

// Open time and price columns are tinted one colour and close ones another, header and cells alike.
const openColumn = column => ({ ...column, phase: 'open' });
const closeColumn = column => ({ ...column, phase: 'close' });

// A number of seconds as "1d 2h 3m 4.567s", with the milliseconds; wholeSeconds leaves them out for set values such
// as a window typed in seconds.
function formatSpan(totalSeconds, wholeSeconds = false) {
  const totalMs = Math.round(Math.abs(totalSeconds) * 1000);
  const days = Math.floor(totalMs / 86400000);
  const hours = Math.floor((totalMs % 86400000) / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const rest = (totalMs % 60000) / 1000;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  if (days || hours || minutes) parts.push(`${minutes}m`);
  parts.push(wholeSeconds ? `${Math.round(rest)}s` : `${rest.toFixed(3)}s`);
  return parts.join(' ');
}

// Column that merges a first/last timestamp pair into one cell (first on top, last below). Sorting and filtering use the
// first timestamp; pass { sortKey } for a server-sorted grid.
function seenColumn(firstKey, lastKey, title, options = {}) {
  return {
    key: firstKey,
    title: `${title} (UTC)`,
    format: (_, row) => {
      const cell = document.createElement('div');
      for (const key of [firstKey, lastKey]) {
        const line = document.createElement('div');
        line.textContent = formatUtc(row[key]);
        cell.append(line);
      }
      return cell;
    },
    ...options,
  };
}

// Renders "label: value" pairs, e.g. a report's metadata above its table.
// The values people take to other pages and tools (logins, emails, CIDs, IPs, position, deal and order numbers, symbols):
// a click on one in a table cell or a summary copies it. Action columns (not sortable) reuse these keys and are left out.
const COPY_KEYS = new Set([
  'login', 'relatedLogin', 'otherLogin', 'email', 'cid', 'sharedCid', 'otherCid', 'computerId',
  'ip', 'sharedIp', 'otherIp', 'ipAddress', 'positionId', 'position', 'deal', 'order', 'symbol',
]);
const COPY_LABELS = /^(Account|Login|Email|IP|CID|Computer ID|Position|Deal|Order|Symbol)( [AB])?$/;

const isCopyableValue = value => (typeof value === 'string' && value.trim() !== '' && value !== '—') || (typeof value === 'number' && value !== 0);

async function copyValue(value) {
  const text = String(value);
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) throw new Error('copy refused');
    }
    toast('Copied', 'success', text);
  } catch {
    toast('Copying is not available here', 'error', 'Select the text and copy it.');
  }
}

function makeCopyable(element, value) {
  element.classList.add('copyable');
  element.title = 'Click to copy';
  element.addEventListener('click', () => copyValue(value));
}

// renderSummary with an icon in front of every item: an icon name, or a ready icon such as a platform icon. A tone ('pos'
// or 'neg') colours a figure by its sign, 'long' lets it wrap.
function renderIconSummary(container, items) {
  renderSummary(container, items.map(([label, value]) => [label, value]));
  items.forEach(([, , iconName, tone], index) => {
    const item = container.children[index];
    if (iconName instanceof Node) {
      const holder = document.createElement('span');
      holder.className = 'summary-icon';
      holder.append(iconName);
      item.prepend(holder);
    } else {
      item.prepend(icon(iconName, 'summary-icon'));
    }
    if (tone) item.classList.add(tone);
  });
}

const signTone = value => (value > 0 ? 'pos' : value < 0 ? 'neg' : '');

function renderSummary(container, items) {
  container.replaceChildren(...items.map(([label, value]) => {
    const item = document.createElement('span');
    const copy = COPY_LABELS.test(label);
    if (value instanceof Node) {
      if (copy && isCopyableValue(value.textContent)) makeCopyable(value, value.textContent);
      item.append(`${label}: `, value);
      return item;
    }
    const strong = document.createElement('strong');
    strong.textContent = value ?? '—';
    if (copy && isCopyableValue(value)) makeCopyable(strong, value);
    item.append(`${label}: `, strong);
    return item;
  }));
}

// A value a click copies, for cells and lists that show several of them.
function copyableText(value) {
  const text = document.createElement('span');
  text.textContent = value;
  makeCopyable(text, value);
  return text;
}

// The distinct computer IDs of a summary, most used first, one per line and copyable, above its tables.
function renderCidOverview(container, cids) {
  const unique = [...new Set(cids.filter(Boolean))];
  container.replaceChildren();
  if (!unique.length) return;
  const title = document.createElement('h3');
  title.textContent = `Computer IDs (${unique.length})`;
  const list = document.createElement('div');
  list.className = 'cid-overview';
  for (const cid of unique) {
    const line = document.createElement('div');
    line.append(copyableText(cid));
    list.append(line);
  }
  container.append(title, list);
}

// A "⋯" button that opens a menu of a table row's links. The menu is fixed to the window, so the table's scroll box does
// not cut it off; it opens below the button, or above when there is more room there (scrolling when neither side holds
// it), and closes on a pick, a click elsewhere, Escape or scrolling.
let openRowMenu = null;

function rowMenu(label, links) {
  const wrap = document.createElement('span');
  wrap.className = 'row-menu';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row-menu-button';
  button.textContent = '⋯';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.className = 'row-menu-list';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  // links may be a function: the items are then built each time the menu opens, so data loaded after the row was drawn
  // (such as the email of its login) is part of them.
  function fill() {
    menu.replaceChildren();
    for (const link of typeof links === 'function' ? links() : links) {
      link.className = 'row-menu-item';
      link.setAttribute('role', 'menuitem');
      menu.append(link);
    }
  }
  fill();

  const onPointerDown = event => { if (!wrap.contains(event.target)) close(); };
  const onKeyDown = event => {
    if (event.key !== 'Escape') return;
    close();
    button.focus();
  };
  function close() {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    if (openRowMenu === close) openRowMenu = null;
  }
  function open() {
    openRowMenu?.();
    if (typeof links === 'function') fill();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.style.maxHeight = '';
    const box = button.getBoundingClientRect();
    const roomBelow = window.innerHeight - box.bottom - 12;
    const roomAbove = box.top - 12;
    const below = menu.offsetHeight <= roomBelow || roomBelow >= roomAbove;
    const room = below ? roomBelow : roomAbove;
    const height = Math.min(menu.offsetHeight, room);
    if (menu.offsetHeight > room) menu.style.maxHeight = `${room}px`;
    menu.style.top = `${below ? box.bottom + 4 : box.top - 4 - height}px`;
    const start = document.documentElement.dir === 'rtl' ? box.left : box.right - menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(start, window.innerWidth - menu.offsetWidth - 8))}px`;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    openRowMenu = close;
    menu.querySelector('a:not([hidden])')?.focus();
  }

  button.addEventListener('click', event => {
    event.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('a')) close();
  }, true);
  menu.addEventListener('click', event => event.stopPropagation());
  wrap.append(button, menu);
  return wrap;
}

// A button-like link for a row's "Actions" cell, opened in a new tab unless it is an in-page action ("#"); the click does not
// also trigger the row's own click handler.
function actionLink(text, href, newTab = href !== '#') {
  const link = document.createElement('a');
  link.className = 'action-link';
  link.href = href;
  if (newTab) {
    link.target = '_blank';
    link.rel = 'noopener';
  }
  link.textContent = text;
  link.addEventListener('click', event => event.stopPropagation());
  return link;
}

// ---- data grid: sorting, filtering and paging shared by every table ----

// Runs `action` unless the same control is already busy, so a double click cannot start two overlapping requests
// whose responses could arrive in the wrong order. The container is marked busy until the action settles.
async function guarded(container, action) {
  if (container.dataset.busy) return;
  container.dataset.busy = '1';
  container.classList.add('is-busy');
  container.setAttribute('aria-busy', 'true');
  try {
    await action();
  } finally {
    delete container.dataset.busy;
    container.classList.remove('is-busy');
    container.removeAttribute('aria-busy');
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const NUMBER_FILTER = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/;
const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// The text a cell shows: what the filter matches against and what sorting falls back to for structured values.
function cellText(column, row) {
  const value = column.format ? column.format(row[column.key], row) : row[column.key];
  if (value instanceof Node) return value.textContent.trim();
  return value === null || value === undefined ? '' : String(value);
}

// A value comparable across rows: numbers and dates become numbers, text stays text, empty becomes null.
function sortValue(column, row) {
  const value = column.sortValue ? column.sortValue(row) : row[column.key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    if (NUMERIC.test(value)) return Number(value);
    if (ISO_DATE.test(value)) return Date.parse(value);
    return value;
  }
  return cellText(column, row) || null;
}

function compareValues(a, b) {
  if (a === null || b === null) return (a === null) - (b === null); // empty values always sort last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return textCollator.compare(String(a), String(b));
}

// Numbers and dates read best largest/newest first; text alphabetically.
function firstDirection(column, rows) {
  if (column.firstDirection) return column.firstDirection;
  const sample = rows?.map(row => sortValue(column, row)).find(value => value !== null);
  return typeof sample === 'number' ? 'Desc' : 'Asc';
}

// Does the row satisfy the typed filter? ">5", "<=10", "=3" compare numbers; anything else is a case-insensitive
// "contains" on the text shown in the cell.
function matchesFilter(column, row, query) {
  const numeric = NUMBER_FILTER.exec(query);
  if (numeric) {
    const value = sortValue(column, row);
    if (typeof value === 'number') {
      const limit = Number(numeric[2]);
      switch (numeric[1]) {
        case '>': return value > limit;
        case '<': return value < limit;
        case '>=': return value >= limit;
        case '<=': return value <= limit;
        default: return value === limit;
      }
    }
  }
  return cellText(column, row).toLowerCase().includes(query.toLowerCase());
}

const gridStates = new WeakMap();

// Shows a sort chosen by clicking a header in the form's "Sort by" and "Direction" selects (the select matches its
// option without regard to case, as the API does).
function setSortFields(form, item, direction) {
  for (const [name, value] of [['sortItem', item], ['sortDirection', direction]]) {
    const select = form.elements[name];
    const option = select && [...select.options].find(candidate => candidate.value.toLowerCase() === String(value).toLowerCase());
    if (option) select.value = option.value;
  }
}

// Turns a header cell into a sort button with a direction indicator. `direction` is 'Asc', 'Desc' or null.
function sortButton(th, title, direction, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sort-button';
  button.title = `Sort by ${title}`;
  const label = document.createElement('span');
  label.textContent = title;
  const icon = document.createElement('span');
  icon.className = 'sort-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = direction === 'Asc' ? '▲' : direction === 'Desc' ? '▼' : '↕';
  button.append(label, icon);
  button.addEventListener('click', onClick);
  th.classList.add('sortable');
  th.setAttribute('aria-sort', direction === 'Asc' ? 'ascending' : direction === 'Desc' ? 'descending' : 'none');
  if (direction) th.classList.add('sorted');
  th.append(button);
}

// The next { item, direction } after a click on a header: same column flips the direction, a new one starts at
// its natural direction.
function nextSort(current, item, natural) {
  if (current?.item?.toLowerCase() === item.toLowerCase()) {
    return { item, direction: current.direction?.toLowerCase() === 'asc' ? 'Desc' : 'Asc' };
  }
  return { item, direction: natural };
}

// columns: [{ key, title, format?(value, row) => string | Node, group?, sortKey?, sortValue?(row), sortable?, filterable?,
// hiddenByDefault? }]
// Consecutive columns with the same group get a shared header cell above their titles.
//
// options.sort = { item, direction, onChange(item, direction) } sorts on the server (the report is paged, so the
// whole result must be re-read): only columns with a sortKey are sortable and a click calls onChange with the key.
// Without it, a click sorts the rows on screen. A row of filter boxes under the titles narrows the rows.
//
// options.filter = { values, onChange(values) } filters on the server the same way: `values` maps a column's filterKey
// (its sortKey when it has no filterKey) to the typed text, and a change (after a short pause in typing) calls onChange
// with the new values, which re-reads the report from its first page. Only columns with such a key get a filter box, and
// the boxes stay when no row matches. Without it, the boxes narrow the rows of the page on screen.
// options.tools = false turns sorting and filtering off for small fixed tables. options.columnFilters = false turns off
// only the row of filter boxes under the titles.
//
// options.export = { name, rows?, all?, permission? } adds CSV and Excel buttons (table-export.js): they download every row of the
// report with the filters and sort applied (rows() gives all of them when the table is paged in the browser, all reads
// every page of a report paged by the server, or all.download(format) has the server write the whole file) and the columns
// shown, except columns marked noExport.
function renderTable(container, allColumns, rows, onRowClick, options = {}) {
  const tools = options.tools !== false;
  const serverSort = tools ? options.sort : null;
  const serverFilter = tools ? options.filter : null;
  const filterKeyOf = column => column.filterKey ?? column.sortKey;
  const signature = allColumns.map(column => column.title).join('|');
  const redraw = () => renderTable(container, allColumns, rows, onRowClick, options);
  const viewKey = tools ? tableViewKey(container, options) : null;
  let state = gridStates.get(container);
  if (!state || state.signature !== signature) {
    state = {
      signature, sortIndex: -1, direction: 'Asc', filters: allColumns.map(() => ''), focusKey: null, filterSeq: 0,
      hidden: standardHidden(allColumns), pickerOpen: false,
    };
    gridStates.set(container, state);
    if (viewKey) initTableView(state, viewKey, allColumns, serverSort, redraw);
  }
  // Only the columns the user has not hidden are drawn; state is indexed by the full column list.
  const columns = tools ? allColumns.filter(column => !state.hidden.has(columnId(column))) : allColumns;
  const indexOf = column => allColumns.indexOf(column);
  const allRows = rows ?? [];
  const canSort = column => tools && column.sortable !== false && (serverSort ? Boolean(column.sortKey) : true);
  const canFilter = column => tools && options.columnFilters !== false && column.filterable !== false && (serverFilter ? Boolean(filterKeyOf(column)) : true);
  const serverValue = column => (serverFilter?.values?.[filterKeyOf(column)] ?? '').trim();
  const serverFiltered = () => Boolean(serverFilter) && columns.some(column => canFilter(column) && serverValue(column));
  const filterable = tools && columns.some(canFilter) && (serverFilter ? true : allRows.length > 1);

  const table = document.createElement('table');
  const head = table.createTHead();
  if (columns.some(column => column.group)) {
    const groupRow = head.insertRow();
    for (const column of columns) {
      const last = groupRow.lastElementChild;
      if (last && column.group && last.dataset.group === column.group) {
        last.colSpan++;
        continue;
      }
      const th = document.createElement('th');
      th.dataset.group = column.group ?? '';
      th.textContent = column.group ?? '';
      groupRow.append(th);
    }
  }

  const compact = columns.map(column => isCompactColumn(column, allRows));
  const numeric = columns.map(column => isNumberColumn(column, allRows));
  const body = table.createTBody();
  // A column with linkRows ties rows with the same value (an open and a close order of one position): hovering one
  // marks the others on the page.
  const linkColumn = allColumns.find(column => column.linkRows);
  const markLinked = (event, on) => {
    const tr = event.target.closest?.('tr[data-link]');
    if (!tr) return;
    for (const other of body.querySelectorAll(`tr[data-link="${CSS.escape(tr.dataset.link)}"]`))
      if (other !== tr) other.classList.toggle('linked', on);
  };
  if (linkColumn) {
    body.addEventListener('mouseover', event => markLinked(event, true));
    body.addEventListener('mouseout', event => markLinked(event, false));
  }
  const meta = document.createElement('div');
  meta.className = 'grid-meta';

  const visibleRows = () => {
    let result = allRows;
    if (serverFilter) return result;
    const active = columns.map(column => [column, state.filters[indexOf(column)].trim()]).filter(([column, query]) => query && canFilter(column));
    if (active.length) result = result.filter(row => active.every(([column, query]) => matchesFilter(column, row, query)));
    if (!serverSort && state.sortIndex >= 0) {
      const column = allColumns[state.sortIndex];
      const sign = state.direction === 'Desc' ? -1 : 1;
      const keyed = result.map(row => [sortValue(column, row), row]);
      // Empty values stay last in both directions, so only non-empty pairs flip with the sign.
      keyed.sort((a, b) => (a[0] === null || b[0] === null ? compareValues(a[0], b[0]) : sign * compareValues(a[0], b[0])));
      result = keyed.map(([, row]) => row);
    }
    return result;
  };

  // Applies the typed filters on the server. A change made while a request runs waits for it, and only the newest wins.
  const submitFilters = async values => {
    const seq = ++state.filterSeq;
    while (container.dataset.busy) await new Promise(resolve => setTimeout(resolve, 50));
    if (seq !== state.filterSeq) return;
    await guarded(container, async () => serverFilter.onChange(values));
  };

  const fill = () => {
    body.replaceChildren();
    const shown = visibleRows();
    if (!shown.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = columns.length;
      cell.className = 'empty';
      cell.textContent = allRows.length || serverFiltered() ? 'No rows match the filters' : 'No data found';
    }
    for (const row of shown) {
      const tr = body.insertRow();
      if (linkColumn && row[linkColumn.key]) tr.dataset.link = row[linkColumn.key];
      if (onRowClick) {
        tr.classList.add('clickable');
        tr.tabIndex = 0;
        tr.addEventListener('click', () => onRowClick(row));
        tr.addEventListener('keydown', event => {
          if (event.target === tr && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row); }
        });
      }
      columns.forEach((column, position) => {
        const td = tr.insertCell();
        if (compact[position]) td.classList.add('compact-col');
        if (numeric[position]) td.classList.add('num');
        const cellClass = column.cellClass?.(row);
        if (cellClass) td.classList.add(cellClass);
        if (column.phase) td.classList.add(`phase-${column.phase}`);
        if (column === linkColumn) td.classList.add('link-cell');
        const value = column.format ? column.format(row[column.key], row) : row[column.key];
        if (value instanceof Node) td.append(value);
        else td.textContent = value ?? '';
        const copiesItself = value instanceof Element && (value.matches('.copyable') || value.querySelector('.copyable'));
        if (COPY_KEYS.has(column.key) && column.sortable !== false && !copiesItself && isCopyableValue(row[column.key])) makeCopyable(td, row[column.key]);
      });
    }
    const filtered = serverFilter ? serverFiltered() : state.filters.some(query => query.trim());
    meta.replaceChildren();
    if (filtered && serverFilter) {
      const text = document.createElement('span');
      text.textContent = 'Filters apply to all pages';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Clear filters';
      clear.addEventListener('click', () => submitFilters({}));
      meta.append(text, clear);
    } else if (filtered) {
      const text = document.createElement('span');
      text.textContent = `Showing ${shown.length} of ${allRows.length} rows on this page`;
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Clear filters';
      clear.addEventListener('click', () => {
        state.filters = allColumns.map(() => '');
        for (const input of table.querySelectorAll('.filter-row input')) input.value = '';
        fill();
      });
      meta.append(text, clear);
    }
  };

  const headRow = head.insertRow();
  const sortedItem = serverSort?.item?.toLowerCase();
  columns.forEach(column => {
    const index = indexOf(column);
    const th = document.createElement('th');
    if (column.phase) th.classList.add(`phase-${column.phase}`);
    if (!canSort(column)) {
      th.textContent = column.title;
      addColumnHelp(th, column);
      headRow.append(th);
      return;
    }
    const active = serverSort
      ? column.sortKey.toLowerCase() === sortedItem
      : state.sortIndex === index;
    const direction = active ? (serverSort ? (serverSort.direction?.toLowerCase() === 'asc' ? 'Asc' : 'Desc') : state.direction) : null;
    sortButton(th, column.title, direction, () => {
      if (serverSort) {
        const next = nextSort(serverSort, column.sortKey, firstDirection(column, allRows));
        guarded(container, async () => serverSort.onChange(next.item, next.direction));
        return;
      }
      if (state.sortIndex === index) state.direction = state.direction === 'Asc' ? 'Desc' : 'Asc';
      else {
        state.sortIndex = index;
        state.direction = firstDirection(column, allRows);
      }
      redraw();
    });
    addColumnHelp(th, column);
    headRow.append(th);
  });

  if (filterable) {
    const filterRow = head.insertRow();
    filterRow.className = 'filter-row';
    columns.forEach(column => {
      const index = indexOf(column);
      const th = document.createElement('th');
      if (canFilter(column)) {
        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Filter';
        input.autocomplete = 'off';
        input.value = serverFilter ? serverValue(column) : state.filters[index];
        input.setAttribute('aria-label', `Filter ${column.title}`);
        input.title = serverFilter
          ? 'Filters all pages. Numbers and dates also accept >, <, >=, <= and =.'
          : 'Filters the rows on this page. Numbers also accept >, <, >=, <= and =.';
        let timer;
        if (serverFilter) {
          const apply = () => {
            clearTimeout(timer);
            state.focusKey = document.activeElement === input ? filterKeyOf(column) : null;
            const values = { ...serverFilter.values, [filterKeyOf(column)]: input.value.trim() };
            return submitFilters(values);
          };
          input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(apply, 400);
          });
          input.addEventListener('keydown', event => {
            if (event.key === 'Enter') apply();
          });
          if (state.focusKey === filterKeyOf(column)) {
            state.focusKey = null;
            queueMicrotask(() => {
              if (!input.isConnected) return;
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            });
          }
        } else {
          input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              state.filters[index] = input.value;
              fill();
            }, 150);
          });
        }
        th.append(input);
      }
      filterRow.append(th);
    });
  }

  fill();
  const filterCells = table.querySelector('tr.filter-row')?.cells;
  compact.forEach((isCompact, position) => {
    if (!isCompact) return;
    headRow.cells[position].classList.add('compact-col');
    filterCells?.[position].classList.add('compact-col');
  });
  numeric.forEach((isNumber, position) => { if (isNumber) headRow.cells[position].classList.add('num'); });
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  const picker = tools && allColumns.length > 1 ? columnPicker(allColumns, state, container, redraw) : null;
  const views = viewKey ? viewsMenu(state, viewKey, allColumns, serverSort, redraw) : null;
  const exporter = options.export && allRows.length
    ? exportButtons(options.export.name, () => columns, options.export.rows ?? visibleRows, options.export.all, options.export.permission)
    : null;
  container.replaceChildren(wrap, meta);
  stickHeader(table);
  if (picker || views || exporter) {
    const bar = document.createElement('div');
    bar.className = 'column-pickers';
    bar.append(...[picker, views, exporter].filter(Boolean));
    mountTools(container, bar);
  }
  finishTableView(state, serverSort, container);
}

// Keeps every header row (group titles, column titles, filter boxes) visible while the table scrolls: each row sticks
// right under the one above it, so its offset is the height of the rows before it.
function stickHeader(table) {
  const place = () => {
    let offset = 0;
    for (const row of table.tHead.rows) {
      for (const cell of row.cells) cell.style.top = `${offset}px`;
      offset += row.offsetHeight;
    }
  };
  place();
  new ResizeObserver(place).observe(table.tHead);
}

// The column menu goes into the bar above the table when the table has a pager (next to the rows-per-page choice and
// the record counts), otherwise at the top of the table's own container.
function mountTools(container, tools) {
  const bar = container.previousElementSibling;
  if (bar?.classList.contains('page-size-top')) {
    bar.querySelectorAll(':scope > .column-picker, :scope > .column-pickers').forEach(old => old.remove());
    bar.prepend(tools);
  } else {
    container.prepend(tools);
  }
}

// ---- column visibility: every table with tools lets the user hide and show its columns ----

// A column whose values are all numbers is kept as narrow as its content, so a short number does not take a wide column.
const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

// A column of short numbers is kept narrow. What is judged is the text shown, so a column whose key is a number but
// whose cells show something else (buttons, links with words) is not taken for one.
function isCompactColumn(column, rows) {
  if (column.compact !== undefined) return column.compact;
  let seen = false;
  for (const row of rows.slice(0, 200)) {
    const value = column.format ? cellText(column, row) : row[column.key];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'number' && !(typeof value === 'string' && value.length <= 18 && NUMBER_TEXT.test(value))) return false;
    seen = true;
  }
  return seen;
}

// Numbers line up on the right. Identifiers (logins, tickets, ids) are numbers too but read as text, so they stay on the left.
const IDENTIFIER_KEY = /login|ticket|id$|asn/i;

function isNumberColumn(column, rows) {
  if (column.align) return column.align === 'end';
  return !IDENTIFIER_KEY.test(column.key ?? '') && isCompactColumn({ key: column.key }, rows);
}

const columnId = column => `${column.group ?? ''}|${column.title}`;

// A "Columns" menu with one checkbox per column; the last visible column cannot be hidden.
function columnPicker(allColumns, state, container, redraw) {
  const details = document.createElement('details');
  details.className = 'column-picker';
  details.open = state.pickerOpen;
  details.addEventListener('toggle', () => { state.pickerOpen = details.open; });
  const summary = document.createElement('summary');
  const hiddenCount = allColumns.filter(column => state.hidden.has(columnId(column))).length;
  summary.textContent = hiddenCount ? `Columns (${allColumns.length - hiddenCount}/${allColumns.length})` : 'Columns';
  const menu = document.createElement('div');
  menu.className = 'column-picker-menu';
  const visibleCount = allColumns.length - hiddenCount;
  for (const column of allColumns) {
    const id = columnId(column);
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !state.hidden.has(id);
    box.disabled = box.checked && visibleCount <= 1;
    box.addEventListener('change', () => {
      if (box.checked) state.hidden.delete(id);
      else state.hidden.add(id);
      redraw();
    });
    label.append(box, ` ${column.group ? `${column.group}: ` : ''}${column.title}`);
    menu.append(label);
  }
  const show = document.createElement('button');
  show.type = 'button';
  show.textContent = 'Show all';
  show.disabled = !hiddenCount;
  show.addEventListener('click', () => {
    state.hidden.clear();
    redraw();
  });
  menu.append(show);
  details.append(summary, menu);
  return details;
}

// The page numbers to show: the first, the last, and a window around the current page; null marks a gap.
function pageWindow(current, total) {
  const pages = new Set([1, total, current - 2, current - 1, current, current + 1, current + 2]);
  const sorted = [...pages].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  const result = [];
  for (const page of sorted) {
    if (result.length && page - result[result.length - 1] > 1) result.push(null);
    result.push(page);
  }
  return result;
}

// paging: { pageSize, currentPage, totalPages }; onPage(page, pageSize) loads the requested page and may return a
// promise: the pager ignores clicks until it settles, so requests cannot overlap.
function renderPager(container, paging, onPage) {
  const totalPages = Math.max(paging?.totalPages ?? 1, 1);
  const currentPage = Math.min(Math.max(paging?.currentPage ?? 1, 1), totalPages);
  const pageSize = paging?.pageSize ?? 1000;

  const go = (page, size = pageSize) => guarded(container, async () => onPage(page, size));
  const button = (text, label, page, disabled, current) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.title = label;
    element.setAttribute('aria-label', label);
    element.disabled = disabled;
    if (current) {
      element.classList.add('current');
      element.setAttribute('aria-current', 'page');
    }
    element.addEventListener('click', () => go(page));
    return element;
  };

  const pager = document.createElement('div');
  pager.className = 'pager';
  pager.append(
    button('«', 'First page', 1, currentPage <= 1),
    button('‹', 'Previous page', currentPage - 1, currentPage <= 1));
  for (const page of pageWindow(currentPage, totalPages)) {
    if (page === null) {
      const gap = document.createElement('span');
      gap.className = 'gap';
      gap.textContent = '…';
      pager.append(gap);
    } else {
      pager.append(button(String(page), `Page ${page}`, page, false, page === currentPage));
    }
  }
  pager.append(
    button('›', 'Next page', currentPage + 1, currentPage >= totalPages),
    button('»', 'Last page', totalPages, currentPage >= totalPages));

  const label = document.createElement('span');
  label.className = 'pager-label';
  label.textContent = `Page ${currentPage} of ${totalPages}`;

  // The rows-per-page choice and the record counts sit above the table (the element just before the pager), next to
  // the column menu; the page buttons stay below it.
  const size = document.createElement('select');
  size.setAttribute('aria-label', 'Rows per page');
  for (const option of new Set([...PAGE_SIZES, pageSize])) size.add(new Option(`${option}`, option));
  size.value = pageSize;
  size.addEventListener('change', () => go(1, Number(size.value)));
  const sizeLabel = document.createElement('label');
  sizeLabel.append('Rows per page ', size);
  const counts = document.createElement('span');
  counts.className = 'page-counts';
  counts.textContent = recordSummary(paging, currentPage, totalPages, pageSize);
  const bar = pageSizeBar(container);
  bar.querySelectorAll(':scope > :not(.column-picker):not(.column-pickers)').forEach(old => old.remove());
  bar.append(counts, sizeLabel);
  // A column menu drawn before the bar existed moves up next to the counts.
  container.previousElementSibling?.querySelectorAll(':scope > .column-picker, :scope > .column-pickers').forEach(menu => bar.prepend(menu));

  pager.append(label);
  container.replaceChildren(pager);
}

// The report's paging with the number of rows of the whole result: `{ pageSize, currentPage, totalPages, totalRecords }`.
function pagingOf(paging) {
  return paging?.normalPagingResponse ? { ...paging.normalPagingResponse, totalRecords: paging.totalRecords } : undefined;
}

// "Records 101–200 of 1,234 · Page 2 of 13"
function recordSummary(paging, currentPage, totalPages, pageSize) {
  const total = paging?.totalRecords;
  if (typeof total !== 'number') return `Page ${currentPage} of ${totalPages}`;
  if (total === 0) return 'No records';
  const first = (currentPage - 1) * pageSize + 1;
  if (first > total) return `No records on this page · ${total.toLocaleString('en-US')} in total`;
  const last = Math.min(currentPage * pageSize, total);
  return `Records ${first.toLocaleString('en-US')}–${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} · Page ${currentPage} of ${totalPages}`;
}

// The bar above the table that the pager fills with the rows-per-page choice; created on first use.
function pageSizeBar(pagerContainer) {
  const table = pagerContainer.previousElementSibling;
  let bar = table?.previousElementSibling;
  if (!bar?.classList.contains('page-size-top')) {
    bar = document.createElement('div');
    bar.className = 'page-size-top';
    table?.before(bar);
  }
  return bar;
}

// Empties a pager together with its rows-per-page choice above the table.
function clearPager(pagerContainer) {
  const bar = pagerContainer.previousElementSibling?.previousElementSibling;
  if (bar?.classList.contains('page-size-top')) bar.replaceChildren();
  pagerContainer.replaceChildren();
}

// Column filters travel to the API as Filters[Column]=text, and in the page's own link as `${prefix}cf_Column=text`.
const COLUMN_FILTER_PREFIX = 'cf_';

function columnFilterParams(values) {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([, text]) => text).map(([key, text]) => [`Filters[${key}]`, text]));
}

function columnFilterState(values, prefix = '') {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([, text]) => text).map(([key, text]) => [prefix + COLUMN_FILTER_PREFIX + key, text]));
}

function readColumnFilters(query, prefix = '') {
  const start = prefix + COLUMN_FILTER_PREFIX;
  return Object.fromEntries([...query.entries()].filter(([key, text]) => key.startsWith(start) && text).map(([key, text]) => [key.slice(start.length), text]));
}

// Returns the non-empty values of the form's named fields.
function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form)) {
    if (String(value).trim() !== '') values[key] = String(value).trim();
  }
  return values;
}

// The value of a page query parameter. Links written before the sort item was renamed carry sortBy (or a prefixed
// p_sortBy/d_sortBy), so a missing sortItem falls back to it.
function queryValue(query, name) {
  if (query.has(name)) return query.get(name);
  const legacy = name.replace(/sortItem$/, 'sortBy');
  return legacy !== name && query.has(legacy) ? query.get(legacy) : null;
}

// Fills the form's named fields from the page query string.
function fillFormFromQuery(form) {
  const query = new URLSearchParams(location.search);
  for (const element of form.elements) {
    const value = element.name ? queryValue(query, element.name) : null;
    if (value === null) continue;
    // A select matches its option without regard to case, as the API does, so older links (direction=Buy) still work.
    const option = element.tagName === 'SELECT'
      ? [...element.options].find(candidate => candidate.value.toLowerCase() === value.toLowerCase())
      : null;
    element.value = option ? option.value : value;
  }
  return query.toString() !== '';
}

// Writes values to the page query string so the report link can be shared or refreshed.
function writeQuery(values) {
  history.replaceState(null, '', location.pathname + toQueryString(values));
}

function clearMessages(form, messageElement) {
  form.querySelectorAll('.field-error').forEach(element => element.remove());
  form.querySelectorAll('[aria-invalid]').forEach(element => element.removeAttribute('aria-invalid'));
  messageElement.textContent = '';
  messageElement.className = 'message';
}

// Shows the loading message with a spinner.
function setLoading(messageElement) {
  messageElement.className = 'message loading';
  messageElement.textContent = 'Loading...';
}

// Shows an ApiError: field errors next to matching inputs, everything else in messageElement.
function showError(form, messageElement, error) {
  const unmatched = [];
  for (const [field, messages] of Object.entries(error.fieldErrors ?? {})) {
    const input = [...form.elements].find(element => element.name?.toLowerCase() === field.toLowerCase());
    if (!input) {
      unmatched.push(...messages);
      continue;
    }
    const note = document.createElement('small');
    note.className = 'field-error';
    note.textContent = messages.join(' ');
    note.id = `${input.name}-error`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', note.id);
    input.after(note);
  }
  messageElement.className = 'message error';
  messageElement.textContent = [error.message, ...unmatched].filter(Boolean).join(' — ');
}

// Runs load() with the submit button disabled and a loading message, then reports any error.
async function withLoading(form, messageElement, load) {
  const submit = form.querySelector('button[type="submit"]');
  clearMessages(form, messageElement);
  setLoading(messageElement);
  if (submit) submit.disabled = true;
  try {
    await load();
    messageElement.className = 'message';
    messageElement.textContent = '';
  } catch (error) {
    showError(form, messageElement, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    if (submit) submit.disabled = false;
  }
}

// ---- accessibility added to every page ----

// Tabs: the buttons of a .tabs bar get the tab roles, follow the "active" class set by each page, and move with the
// arrow keys. A tab that has a section with the same data-panel is tied to it.
function syncTabs(tabs) {
  const buttons = [...tabs.querySelectorAll(':scope > button, :scope > .tab > button:first-child')];
  tabs.setAttribute('role', 'tablist');
  const anyActive = buttons.some(button => button.classList.contains('active') || button.closest('.tab')?.classList.contains('active'));
  buttons.forEach((button, index) => {
    const active = button.classList.contains('active') || Boolean(button.closest('.tab')?.classList.contains('active'));
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active || (!anyActive && index === 0) ? 0 : -1;
    const panel = button.dataset.tab ? document.querySelector(`[data-panel="${button.dataset.tab}"]`) : null;
    if (panel) {
      button.id ||= `tab-${button.dataset.tab}`;
      panel.id ||= `panel-${button.dataset.tab}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      button.setAttribute('aria-controls', panel.id);
    }
  });
}

document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[role="tab"]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...tab.closest('.tabs').querySelectorAll('[role="tab"]')];
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
  event.preventDefault();
  next.focus();
  next.click();
});

// Message areas are polite live regions, so errors and the loading text are announced.
function enhance(root) {
  if (!(root instanceof Element)) return;
  const within = selector => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  within('.tabs').forEach(syncTabs);
  within('p.message').forEach(element => {
    if (!element.hasAttribute('role')) element.setAttribute('role', 'status');
  });
}

// Column and view menus close on Escape and on a click elsewhere.
document.addEventListener('pointerdown', event => {
  for (const menu of document.querySelectorAll('details.column-picker[open]')) if (!menu.contains(event.target)) menu.open = false;
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('details.column-picker[open]');
  if (!menu) return;
  menu.open = false;
  menu.querySelector('summary').focus();
});

new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'attributes') enhance(record.target.closest('.tabs'));
    else record.addedNodes.forEach(enhance);
  }
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
enhance(document.body);
