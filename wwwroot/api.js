// Shared helpers for all panel pages: API calls, tables, paging, form <-> query string, loading state.

const API_PREFIX = '/api/v1/';
const SUCCESS_STATUS_CODE = 1;
const UNAVAILABLE_MESSAGE = 'سرویس در دسترس نیست';
const INVALID_INPUT_MESSAGE = 'ورودی‌ها را بررسی کنید';
const PAGE_SIZES = [50, 100, 250, 500];

const MENU_ITEMS = [
  { href: '/logins.html', title: 'تاریخچهٔ لاگین' },
  { href: '/similarity.html', title: 'شباهت IP/CID' },
  { href: '/copy-trade.html', title: 'کپی‌ترید و هج' },
];

class ApiError extends Error {
  // fieldErrors: { fieldName: [messages] } from an ASP.NET ValidationProblemDetails response.
  constructor(message, fieldErrors = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

// Builds a query string from the non-empty values of params.
function toQueryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value).trim());
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

// Calls GET /api/v1/{path} and returns `result`, or throws ApiError with a Persian message.
async function apiGet(path, params) {
  let response;
  try {
    response = await fetch(API_PREFIX + path + toQueryString(params), { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(UNAVAILABLE_MESSAGE);
  }

  if (response.status === 401) {
    location.href = '/login.html';
    throw new ApiError('');
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON bodies are handled below as an unavailable service.
  }

  if (body?.status && typeof body.status === 'object') {
    if (response.ok && body.status.code === SUCCESS_STATUS_CODE) return body.result;
    throw new ApiError(translateStatus(body.status));
  }
  if (body?.errors) throw new ApiError(INVALID_INPUT_MESSAGE, body.errors);
  throw new ApiError(UNAVAILABLE_MESSAGE);
}

// Builds the URL of an API file export, for use as a download link.
function apiUrl(path, params) {
  return API_PREFIX + path + toQueryString(params);
}

function renderMenu() {
  const nav = document.getElementById('menu');
  nav.replaceChildren();
  for (const item of MENU_ITEMS) {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.title;
    if (location.pathname === item.href) link.classList.add('active');
    nav.append(link);
  }
  const logout = document.createElement('form');
  logout.method = 'post';
  logout.action = '/auth/logout';
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'خروج';
  logout.append(button);
  nav.append(logout);
}

// Formats an ISO timestamp as "yyyy-MM-dd HH:mm:ss" in UTC.
function formatUtc(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').slice(0, 19);
}

// Column definition for a UTC timestamp field.
function utcColumn(key, title) {
  return { key, title: `${title} (UTC)`, format: formatUtc, ltr: true };
}

// Renders "label: value" pairs, e.g. a report's metadata above its table.
function renderSummary(container, items) {
  container.replaceChildren(...items.map(([label, value]) => {
    const item = document.createElement('span');
    const strong = document.createElement('strong');
    strong.className = 'ltr';
    strong.textContent = value ?? '—';
    item.append(`${label}: `, strong);
    return item;
  }));
}

// Link to the login history page; stops the click so a clickable row does not also open.
function loginLink(login) {
  const link = document.createElement('a');
  link.href = `/logins.html?login=${encodeURIComponent(login)}`;
  link.textContent = login;
  link.addEventListener('click', event => event.stopPropagation());
  return link;
}

// columns: [{ key, title, format?(value, row) => string | Node, ltr?, group? }]
// Consecutive columns with the same group get a shared header cell above their titles.
function renderTable(container, columns, rows, onRowClick) {
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
  const headRow = head.insertRow();
  for (const column of columns) {
    const th = document.createElement('th');
    th.textContent = column.title;
    headRow.append(th);
  }

  const body = table.createTBody();
  if (!rows?.length) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = columns.length;
    cell.className = 'empty';
    cell.textContent = 'داده‌ای یافت نشد';
  }
  for (const row of rows ?? []) {
    const tr = body.insertRow();
    if (onRowClick) {
      tr.classList.add('clickable');
      tr.addEventListener('click', () => onRowClick(row));
    }
    for (const column of columns) {
      const td = tr.insertCell();
      if (column.ltr) td.classList.add('ltr');
      const value = column.format ? column.format(row[column.key], row) : row[column.key];
      if (value instanceof Node) td.append(value);
      else td.textContent = value ?? '';
    }
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  container.replaceChildren(wrap);
}

// paging: { pageSize, currentPage, totalPages }; onPage(page, pageSize) loads the requested page.
function renderPager(container, paging, onPage) {
  const currentPage = paging?.currentPage ?? 1;
  const totalPages = Math.max(paging?.totalPages ?? 1, 1);
  const pageSize = paging?.pageSize ?? 100;

  const previous = document.createElement('button');
  previous.type = 'button';
  previous.textContent = 'قبلی';
  previous.disabled = currentPage <= 1;
  previous.addEventListener('click', () => onPage(currentPage - 1, pageSize));

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'بعدی';
  next.disabled = currentPage >= totalPages;
  next.addEventListener('click', () => onPage(currentPage + 1, pageSize));

  const label = document.createElement('span');
  label.textContent = `صفحهٔ ${currentPage} از ${totalPages}`;

  const size = document.createElement('select');
  for (const option of new Set([...PAGE_SIZES, pageSize])) size.add(new Option(`${option} ردیف`, option));
  size.value = pageSize;
  size.addEventListener('change', () => onPage(1, Number(size.value)));

  const pager = document.createElement('div');
  pager.className = 'pager';
  pager.append(previous, label, next, size);
  container.replaceChildren(pager);
}

// Returns the non-empty values of the form's named fields.
function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form)) {
    if (String(value).trim() !== '') values[key] = String(value).trim();
  }
  return values;
}

// Fills the form's named fields from the page query string.
function fillFormFromQuery(form) {
  const query = new URLSearchParams(location.search);
  for (const element of form.elements) {
    if (element.name && query.has(element.name)) element.value = query.get(element.name);
  }
  return query.toString() !== '';
}

// Writes values to the page query string so the report link can be shared or refreshed.
function writeQuery(values) {
  history.replaceState(null, '', location.pathname + toQueryString(values));
}

function clearMessages(form, messageElement) {
  form.querySelectorAll('.field-error').forEach(element => element.remove());
  messageElement.textContent = '';
  messageElement.className = 'message';
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
    input.after(note);
  }
  messageElement.className = 'message error';
  messageElement.textContent = [error.message, ...unmatched].filter(Boolean).join(' — ');
}

// Runs load() with the submit button disabled and a loading message, then reports any error.
async function withLoading(form, messageElement, load) {
  const submit = form.querySelector('button[type="submit"]');
  clearMessages(form, messageElement);
  messageElement.textContent = 'در حال بارگذاری...';
  if (submit) submit.disabled = true;
  try {
    await load();
    messageElement.textContent = '';
  } catch (error) {
    showError(form, messageElement, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    if (submit) submit.disabled = false;
  }
}
