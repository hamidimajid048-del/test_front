// Shared helpers for all panel pages: API calls, tables, paging, form <-> query string, loading state.

const API_PREFIX = '/api/';
const SUCCESS_STATUS_CODE = 1;
const VALIDATION_ERROR_STATUS_CODE = 201;
const INVALID_PARAMETER_PREFIX = 'InvalidParameter:';
const UNAVAILABLE_MESSAGE = 'Service unavailable';
const INVALID_INPUT_MESSAGE = 'Check the highlighted inputs';
const INVALID_VALUE_MESSAGE = 'This value is not valid';
const PAGE_SIZES = [50, 100, 250, 500];
// A 401 means the panel session or the admin's Identity token ended; the panel signs out and asks for a new sign-in.
const SESSION_EXPIRED_PAGE = '/login.html?error=expired';

const MENU_ITEMS = [
  { href: '/account-data.html', title: 'Account data' },
  { href: '/logins.html', title: 'Login history' },
  { href: '/email-logins.html', title: 'Email logins' },
  { href: '/similarity.html', title: 'IP/CID similarity' },
  { href: '/value-search.html', title: 'CID / IP search' },
  { href: '/copy-trade.html', title: 'Copy trade & hedge' },
  { href: '/compare.html', title: 'Compare accounts' },
  { href: '/compare-emails.html', title: 'Compare emails' },
];

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

// Calls GET /api/{path} and returns `result`, or throws ApiError with a Persian message.
async function apiGet(path, params) {
  let response;
  try {
    response = await fetch(API_PREFIX + path + toQueryString(params), { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(UNAVAILABLE_MESSAGE);
  }

  if (response.status === 401) {
    location.href = SESSION_EXPIRED_PAGE;
    throw new ApiError('');
  }

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
async function downloadExport(path, params, button, messageElement) {
  button.disabled = true;
  messageElement.className = 'message';
  messageElement.textContent = 'Preparing file...';
  try {
    let response;
    try {
      response = await fetch(apiUrl(path, params));
    } catch {
      throw new ApiError(UNAVAILABLE_MESSAGE);
    }
    if (response.status === 401) {
      location.href = SESSION_EXPIRED_PAGE;
      return;
    }
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
      messageElement.textContent = '';
      return;
    }
    const body = await response.json().catch(() => null);
    if (isValidationError(body)) throw new ApiError([INVALID_INPUT_MESSAGE, ...Object.keys(fieldErrorsOf(body.errors))].join(' — '));
    if (body?.status && typeof body.status === 'object') throw new ApiError(translateStatus(body.status));
    throw new ApiError(UNAVAILABLE_MESSAGE);
  } catch (error) {
    messageElement.className = 'message error';
    messageElement.textContent = error instanceof ApiError ? error.message : UNAVAILABLE_MESSAGE;
  } finally {
    button.disabled = false;
  }
}

// A small coloured label. kind: 'ok' | 'warn' | 'danger' | 'main' | 'compared' | 'muted'.
function badge(text, kind = 'muted') {
  const element = document.createElement('span');
  element.className = `badge ${kind}`;
  element.textContent = text;
  return element;
}

// Wraps nodes or text in a flex row, e.g. several badges in one table cell.
function inline(...parts) {
  const row = document.createElement('span');
  row.className = 'inline';
  row.append(...parts);
  return row;
}

const BRAND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4 5.5v6c0 5 3.4 8.8 8 10 4.6-1.2 8-5 8-10v-6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';

function renderMenu() {
  const nav = document.getElementById('menu');

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = '/';
  const mark = document.createElement('span');
  mark.className = 'brand-mark';
  mark.innerHTML = BRAND_ICON;
  brand.append(mark, 'Violation Panel');

  const links = MENU_ITEMS.map(item => {
    const link = document.createElement('a');
    link.className = 'nav-link';
    link.href = item.href;
    link.textContent = item.title;
    if (location.pathname === item.href) link.classList.add('active');
    return link;
  });

  const logout = document.createElement('form');
  logout.method = 'post';
  logout.action = '/auth/logout';
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'logout';
  button.textContent = 'Sign out';
  logout.append(button);

  // The signed-in account links to its Account page; super admins also get the Users page.
  const signedInAs = document.createElement('a');
  signedInAs.className = 'nav-user';
  signedInAs.href = '/account.html';
  signedInAs.title = 'Account';
  if (location.pathname === '/account.html') signedInAs.classList.add('active');

  const actions = document.createElement('div');
  actions.className = 'nav-actions';
  actions.append(signedInAs, createThemeToggle(), logout);

  // The version of the pages on this server: it changes with any edit of the front end, so it shows what is deployed.
  const version = document.createElement('span');
  version.className = 'nav-version';
  version.title = 'Front-end version on this server';
  actions.prepend(version);
  fetch('/version', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(body => { if (body?.frontend) version.textContent = `v ${body.frontend}`; })
    .catch(() => {});

  nav.replaceChildren(brand, ...links, actions);

  currentAccount().then(me => {
    if (!me) return;
    signedInAs.textContent = me.username;
    if (me.role !== 'superadmin') return;
    const users = document.createElement('a');
    users.className = 'nav-link';
    users.href = '/users.html';
    users.textContent = 'Users';
    if (location.pathname === '/users.html') users.classList.add('active');
    actions.before(users);
  });
}

let currentAccountRequest;

// The signed-in account ({ id, username, role }), or null when it cannot be read.
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
  try {
    response = await fetch(`/panel-api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(UNAVAILABLE_MESSAGE);
  }

  if (response.status === 401) {
    location.href = SESSION_EXPIRED_PAGE;
    throw new ApiError('');
  }
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(result?.error ?? UNAVAILABLE_MESSAGE);
  return result;
}

// Formats an ISO timestamp as "yyyy-MM-dd HH:mm:ss" in UTC.
function formatUtc(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace('T', ' ').slice(0, 19);
}

// Column definition for a UTC timestamp field.
function utcColumn(key, title) {
  return { key, title: `${title} (UTC)`, format: formatUtc };
}

// Renders "label: value" pairs, e.g. a report's metadata above its table.
function renderSummary(container, items) {
  container.replaceChildren(...items.map(([label, value]) => {
    const item = document.createElement('span');
    const strong = document.createElement('strong');
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

// A button-like link for a row's "Actions" cell; the click does not also trigger the row's own click handler.
function actionLink(text, href) {
  const link = document.createElement('a');
  link.className = 'action-link';
  link.href = href;
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
  try {
    await action();
  } finally {
    delete container.dataset.busy;
    container.classList.remove('is-busy');
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

// columns: [{ key, title, format?(value, row) => string | Node, group?, sortKey?, sortValue?(row), sortable?, filterable? }]
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
// options.tools = false turns sorting and filtering off for small fixed tables.
function renderTable(container, allColumns, rows, onRowClick, options = {}) {
  const tools = options.tools !== false;
  const serverSort = tools ? options.sort : null;
  const serverFilter = tools ? options.filter : null;
  const filterKeyOf = column => column.filterKey ?? column.sortKey;
  const signature = allColumns.map(column => column.title).join('|');
  let state = gridStates.get(container);
  if (!state || state.signature !== signature) {
    state = {
      signature, sortIndex: -1, direction: 'Asc', filters: allColumns.map(() => ''), focusKey: null, filterSeq: 0,
      hidden: loadHiddenColumns(container, signature), pickerOpen: false,
    };
    gridStates.set(container, state);
  }
  // Only the columns the user has not hidden are drawn; state is indexed by the full column list.
  const columns = tools ? allColumns.filter(column => !state.hidden.has(columnId(column))) : allColumns;
  const indexOf = column => allColumns.indexOf(column);
  const allRows = rows ?? [];
  const canSort = column => tools && column.sortable !== false && (serverSort ? Boolean(column.sortKey) : true);
  const canFilter = column => tools && column.filterable !== false && (serverFilter ? Boolean(filterKeyOf(column)) : true);
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

  const body = table.createTBody();
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
      if (onRowClick) {
        tr.classList.add('clickable');
        tr.addEventListener('click', () => onRowClick(row));
      }
      for (const column of columns) {
        const td = tr.insertCell();
        const value = column.format ? column.format(row[column.key], row) : row[column.key];
        if (value instanceof Node) td.append(value);
        else td.textContent = value ?? '';
      }
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
    if (!canSort(column)) {
      th.textContent = column.title;
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
      renderTable(container, allColumns, rows, onRowClick, options);
    });
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
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  const picker = tools && allColumns.length > 1 ? columnPicker(allColumns, state, container, () => renderTable(container, allColumns, rows, onRowClick, options)) : null;
  container.replaceChildren(wrap, meta);
  if (picker) mountTools(container, picker);
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

const columnId = column => `${column.group ?? ''}|${column.title}`;
const hiddenColumnsKey = (container, signature) => `grid-columns:${location.pathname}:${container.id}:${signature}`;

function loadHiddenColumns(container, signature) {
  try {
    return new Set(JSON.parse(localStorage.getItem(hiddenColumnsKey(container, signature)) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveHiddenColumns(container, signature, hidden) {
  try {
    localStorage.setItem(hiddenColumnsKey(container, signature), JSON.stringify([...hidden]));
  } catch {
    // The choice then only lasts until the page is left.
  }
}

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
      saveHiddenColumns(container, state.signature, state.hidden);
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
    saveHiddenColumns(container, state.signature, state.hidden);
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
  const pageSize = paging?.pageSize ?? 100;

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
  messageElement.textContent = 'Loading...';
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
