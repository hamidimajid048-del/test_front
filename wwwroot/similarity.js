// Similarity page: logins sharing IP/CID evidence (summary), the shared values with one related login (details),
// and CSV/XLSX exports of both.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const detailsForm = document.getElementById('details-filters');
const detailsMessage = document.getElementById('details-message');
const DEFAULT_PAGE_SIZE = 100;
const DETAILS_QUERY_PREFIX = 'd_';

const COMMON_KEYS = ['type', 'fromUtc', 'toUtc', 'country', 'city', 'isp', 'asn', 'deviceType', 'cid'];
const SUMMARY_KEYS = [
  ...COMMON_KEYS, 'relatedLogin', 'minSharedValueCount', 'minEffectiveRepeatCount', 'minOccurrenceDays',
  'minCoOccurrenceDays', 'sortBy', 'sortDirection',
];

const TYPE_LABELS = { Ip: 'IP', Cid: 'CID' };

// Filters of the last summary search; the details and exports reuse them so they always match the table shown.
let filters = null;
let summaryPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
let selected = null;
let detailsValues = {};
let detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };

const pick = (source, keys) => Object.fromEntries(keys.filter(key => key in source).map(key => [key, source[key]]));

// The range is whole UTC days ("yyyy-MM-dd"): from the start of the first day to the end of the last day.
const fromDayParam = day => (day ? `${day}T00:00:00Z` : undefined);
const toDayParam = day => (day ? `${day}T23:59:59.9999999Z` : undefined);

function validateRange(values) {
  const missing = 'بازهٔ زمانی ناقص است؛ «از» و «تا» را با هم پر کنید یا هر دو را خالی بگذارید';
  if (values.fromUtc && !values.toUtc) throw new ApiError(missing, { toUtc: ['«تا» را پر کنید'] });
  if (!values.fromUtc && values.toUtc) throw new ApiError(missing, { fromUtc: ['«از» را پر کنید'] });
  if (values.fromUtc && values.fromUtc > values.toUtc) {
    throw new ApiError('«از» نباید بعد از «تا» باشد', { fromUtc: ['«از» بعد از «تا» است'] });
  }
}

// Quick ranges ending now (UTC); each moves the start date back.
const RANGE_PRESETS = {
  week: date => date.setUTCDate(date.getUTCDate() - 7),
  month: date => date.setUTCMonth(date.getUTCMonth() - 1),
  '3months': date => date.setUTCMonth(date.getUTCMonth() - 3),
  '6months': date => date.setUTCMonth(date.getUTCMonth() - 6),
  year: date => date.setUTCFullYear(date.getUTCFullYear() - 1),
};

// Date input value ("yyyy-MM-dd") of a Date, in UTC.
const toDayValue = date => date.toISOString().slice(0, 10);

function setRange(fromValue, toValue) {
  form.elements.fromUtc.value = fromValue;
  form.elements.toUtc.value = toValue;
}

// The day inputs are editable only for a custom range. They are read-only (not disabled) otherwise, so a preset's
// days are still shown and submitted with the form.
function syncRangeInputs() {
  const custom = form.elements.range.value === 'custom';
  for (const name of ['fromUtc', 'toUtc']) {
    form.elements[name].readOnly = !custom;
    form.elements[name].title = custom ? '' : 'برای انتخاب روز، بازهٔ «دلخواه» را انتخاب کنید';
  }
}

function applyRangePreset() {
  syncRangeInputs();
  const preset = form.elements.range.value;
  if (preset === 'custom') return;
  if (!preset) {
    setRange('', '');
    return;
  }
  const to = new Date();
  const from = new Date(to);
  RANGE_PRESETS[preset](from);
  setRange(toDayValue(from), toDayValue(to));
}

// The account's data range comes from the login sessions report metadata, the only place the service exposes it.
let accountRangeLogin = null;

async function showAccountRange() {
  const login = form.elements.login.value.trim();
  if (login === accountRangeLogin) return;
  accountRangeLogin = login;
  const hint = document.getElementById('account-range');
  if (!login) {
    hint.replaceChildren();
    return;
  }
  hint.textContent = 'در حال دریافت بازهٔ داده‌های حساب...';
  try {
    const { metadata } = await apiGet(`reports/logins/${login}/complete`, { pageSize: 1 });
    if (login !== accountRangeLogin) return;
    const useRange = document.createElement('button');
    useRange.type = 'button';
    useRange.textContent = 'استفاده از این بازه';
    useRange.addEventListener('click', () => {
      form.elements.range.value = 'custom';
      syncRangeInputs();
      setRange(toDayValue(new Date(metadata.firstDataTime)), toDayValue(new Date(metadata.lastDataTime)));
    });
    const range = document.createElement('span');
    range.className = 'ltr';
    range.textContent = `${toDayValue(new Date(metadata.firstDataTime))} — ${toDayValue(new Date(metadata.lastDataTime))}`;
    hint.replaceChildren(`بازهٔ داده‌های حساب ${login} (UTC): `, range, useRange);
  } catch (error) {
    if (login !== accountRangeLogin) return;
    hint.textContent = `بازهٔ داده‌های حساب: ${error.message || UNAVAILABLE_MESSAGE}`;
  }
}

form.elements.range.addEventListener('change', applyRangePreset);
form.elements.login.addEventListener('change', showAccountRange);

function commonParams() {
  return { ...pick(filters, COMMON_KEYS), fromUtc: fromDayParam(filters.fromUtc), toUtc: toDayParam(filters.toUtc) };
}

function summaryParams() {
  return {
    ...pick(filters, SUMMARY_KEYS),
    ...commonParams(),
    currentPage: summaryPaging.currentPage,
    pageSize: summaryPaging.pageSize,
  };
}

function detailsParams() {
  return {
    ...commonParams(),
    ...detailsValues,
    type: selected.type,
    relatedLogin: selected.relatedLogin,
    currentPage: detailsPaging.currentPage,
    pageSize: detailsPaging.pageSize,
  };
}

function writeState() {
  const state = { ...filters, currentPage: summaryPaging.currentPage, pageSize: summaryPaging.pageSize };
  if (selected) {
    const prefixed = { ...detailsValues, relatedLogin: selected.relatedLogin, type: selected.type, ...detailsPaging };
    for (const [key, value] of Object.entries(prefixed)) state[DETAILS_QUERY_PREFIX + key] = value;
  }
  writeQuery(state);
}

function renderMetadata(metadata) {
  const range = metadata.fromUtc
    ? `${toDayValue(new Date(metadata.fromUtc))} تا ${toDayValue(new Date(metadata.toUtc))}`
    : 'همهٔ زمان‌ها';
  renderSummary(document.getElementById('summary-metadata'), [['لاگین', metadata.login], ['بازه (UTC)', range]]);
}

const SUMMARY_COLUMNS = [
  { key: 'relatedLogin', title: 'لاگین مرتبط', format: loginLink, ltr: true },
  { key: 'type', title: 'نوع', format: type => TYPE_LABELS[type] ?? type },
  { key: 'sharedValueCount', title: 'تعداد مقدار مشترک', ltr: true },
  { key: 'effectiveRepeatCount', title: 'تکرار مؤثر', ltr: true },
  { key: 'occurrenceDays', title: 'روز وقوع', ltr: true },
  { key: 'coOccurrenceDays', title: 'روز هم‌زمان', ltr: true },
];

const DETAILS_COLUMNS = [
  { key: 'value', title: 'مقدار', ltr: true },
  { key: 'logCount', title: 'تعداد لاگ', ltr: true },
  { key: 'relatedLogCount', title: 'تعداد لاگ مرتبط', ltr: true },
  { key: 'effectiveRepeatCount', title: 'تکرار مؤثر', ltr: true },
  utcColumn('firstSeenUtc', 'اولین مشاهده'),
  utcColumn('lastSeenUtc', 'آخرین مشاهده'),
  utcColumn('relatedFirstSeenUtc', 'اولین مشاهدهٔ مرتبط'),
  utcColumn('relatedLastSeenUtc', 'آخرین مشاهدهٔ مرتبط'),
  { key: 'occurrenceDays', title: 'روز وقوع', ltr: true },
  { key: 'coOccurrenceDays', title: 'روز هم‌زمان', ltr: true },
];

async function loadSummary() {
  const report = await apiGet(`reports/similarity/${filters.login}/summary`, summaryParams());
  const paging = report.paging?.normalPagingResponse;
  summaryPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? summaryPaging.pageSize };
  renderMetadata(report.metadata);
  renderTable(document.getElementById('summary'), SUMMARY_COLUMNS, report.items, openDetails);
  renderPager(document.getElementById('summary-pager'), paging, (page, pageSize) => {
    summaryPaging = { currentPage: page, pageSize };
    withLoading(form, message, loadSummary);
  });
  document.getElementById('summary-section').hidden = false;
  writeState();
}

async function loadDetails() {
  const report = await apiGet(`reports/similarity/${filters.login}/details`, detailsParams());
  const paging = report.paging?.normalPagingResponse;
  detailsPaging = { currentPage: paging?.currentPage ?? 1, pageSize: paging?.pageSize ?? detailsPaging.pageSize };
  renderTable(document.getElementById('details'), DETAILS_COLUMNS, report.items);
  renderPager(document.getElementById('details-pager'), paging, (page, pageSize) => {
    detailsPaging = { currentPage: page, pageSize };
    withLoading(detailsForm, detailsMessage, loadDetails);
  });
  writeState();
}

function showDetailsSection() {
  document.getElementById('details-title').textContent =
    `جزئیات: ${filters.login} و ${selected.relatedLogin} (${TYPE_LABELS[selected.type] ?? selected.type})`;
  const section = document.getElementById('details-section');
  section.hidden = false;
  return section;
}

function openDetails(row) {
  selected = { relatedLogin: row.relatedLogin, type: row.type };
  detailsForm.reset();
  detailsValues = {};
  detailsPaging = { currentPage: 1, pageSize: DEFAULT_PAGE_SIZE };
  document.getElementById('details').replaceChildren();
  document.getElementById('details-pager').replaceChildren();
  document.getElementById('details-export-message').textContent = '';
  showDetailsSection().scrollIntoView({ behavior: 'smooth', block: 'start' });
  withLoading(detailsForm, detailsMessage, loadDetails);
}

function hideDetails() {
  selected = null;
  document.getElementById('details-section').hidden = true;
}

function fileNameFrom(contentDisposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? '');
  return match ? decodeURIComponent(match[1]) : 'export';
}

// Fetches an export so a failure (returned as JSON instead of a file) can be shown as a message.
async function downloadExport(path, params, button, messageElement) {
  button.disabled = true;
  messageElement.className = 'message';
  messageElement.textContent = 'در حال آماده‌سازی فایل...';
  try {
    let response;
    try {
      response = await fetch(apiUrl(path, params));
    } catch {
      throw new ApiError(UNAVAILABLE_MESSAGE);
    }
    if (response.status === 401) {
      location.href = '/login.html';
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
    if (body?.status && typeof body.status === 'object') throw new ApiError(translateStatus(body.status));
    if (body?.errors) throw new ApiError([INVALID_INPUT_MESSAGE, ...Object.values(body.errors).flat()].join(' — '));
    throw new ApiError(UNAVAILABLE_MESSAGE);
  } catch (error) {
    messageElement.className = 'message error';
    messageElement.textContent = error instanceof ApiError ? error.message : UNAVAILABLE_MESSAGE;
  } finally {
    button.disabled = false;
  }
}

document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
  const kind = button.dataset.export;
  const { currentPage, pageSize, ...params } = kind === 'summary' ? summaryParams() : detailsParams();
  downloadExport(
    `reports/similarity/${filters.login}/${kind}/export`,
    { ...params, format: button.dataset.format },
    button,
    document.getElementById(`${kind}-export-message`));
}));

form.addEventListener('submit', event => {
  event.preventDefault();
  showAccountRange();
  withLoading(form, message, async () => {
    const values = formValues(form);
    validateRange(values);
    filters = values;
    summaryPaging = { currentPage: 1, pageSize: summaryPaging.pageSize };
    hideDetails();
    await loadSummary();
  });
});

detailsForm.addEventListener('submit', event => {
  event.preventDefault();
  detailsValues = formValues(detailsForm);
  detailsPaging = { currentPage: 1, pageSize: detailsPaging.pageSize };
  withLoading(detailsForm, detailsMessage, loadDetails);
});

// Restores a shared or refreshed report link.
async function restoreFromQuery() {
  if (!fillFormFromQuery(form) || !form.elements.login.value) return;
  if (!form.elements.range.value && form.elements.fromUtc.value) form.elements.range.value = 'custom';
  syncRangeInputs();
  showAccountRange();
  const query = new URLSearchParams(location.search);
  filters = formValues(form);
  summaryPaging = {
    currentPage: Number(query.get('currentPage')) || 1,
    pageSize: Number(query.get('pageSize')) || DEFAULT_PAGE_SIZE,
  };
  await withLoading(form, message, async () => {
    validateRange(filters);
    await loadSummary();
  });

  const relatedLogin = query.get(`${DETAILS_QUERY_PREFIX}relatedLogin`);
  const type = query.get(`${DETAILS_QUERY_PREFIX}type`);
  if (!relatedLogin || !type || document.getElementById('summary-section').hidden) return;
  selected = { relatedLogin, type };
  for (const element of detailsForm.elements) {
    const value = element.name && query.get(DETAILS_QUERY_PREFIX + element.name);
    if (value) element.value = value;
  }
  detailsValues = formValues(detailsForm);
  detailsPaging = {
    currentPage: Number(query.get(`${DETAILS_QUERY_PREFIX}currentPage`)) || 1,
    pageSize: Number(query.get(`${DETAILS_QUERY_PREFIX}pageSize`)) || DEFAULT_PAGE_SIZE,
  };
  showDetailsSection();
  await withLoading(detailsForm, detailsMessage, loadDetails);
}

renderMenu();
syncRangeInputs();
restoreFromQuery();
