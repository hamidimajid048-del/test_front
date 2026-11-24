// Tick monitoring page: the live state of the monitored symbols (/panel-api/tick-monitor/status), their alarm profiles
// (time windows in server time with escalation stages), the Telegram channels, the gap history and the settings.
// Which tabs and buttons an account sees depends on its permissions; the server enforces the same rules.

const STATUS_REFRESH_MS = 5000;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
const SNOOZE_MINUTES = [15, 30, 60, 180];
const COVERAGE_CELLS = 96;

const STATE_BADGES = {
  Watching: ['Watching', 'ok'],
  GapOpen: ['Gap open', 'danger'],
  Closed: ['Closed', 'muted'],
  Uncovered: ['Uncovered', 'warn'],
  Snoozed: ['Snoozed', 'warn'],
  Disabled: ['Disabled', 'muted'],
};

const message = document.getElementById('message');
const profileDialog = document.getElementById('profile-dialog');
const profileForm = document.getElementById('profile-form');
const profileError = document.getElementById('profile-dialog-error');
const schedulesHost = document.getElementById('schedules');
const coverageHost = document.getElementById('coverage');
const channelDialog = document.getElementById('channel-dialog');
const channelForm = document.getElementById('channel-form');
const channelError = document.getElementById('channel-dialog-error');

let me = null;
let channels = [];
let profiles = [];
let settings = null;
let editingProfile = null;
let editingChannel = null;
let statusTimer = null;

const channelName = id => channels.find(channel => channel.id === id)?.name ?? 'Unknown channel';
const showMessage = (text, kind = 'success') => toast(text, kind);
const serverTime = value => (value ? formatUtcSeconds(value) : '—');
const seconds = value => (value === null || value === undefined ? '—' : `${value}s`);

function actionButton(text, onClick, { danger = false, iconName = null, permission = null } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  if (iconName) button.append(icon(iconName));
  button.append(text);
  if (danger) button.className = 'danger';
  if (permission && !can(me, permission)) button.hidden = true;
  button.addEventListener('click', onClick);
  return button;
}

// Each part of the page has its own menu entry (/tick-monitor.html?view=profiles); the page shows only that part.
const VIEWS = ['status', 'profiles', 'channels', 'history', 'settings'];

function currentView() {
  const query = new URLSearchParams(location.search);
  const view = query.get('view') ?? query.get('tab');
  return VIEWS.includes(view) ? view : 'status';
}

function showTab(tab) {
  const current = VIEWS.includes(tab) ? tab : 'status';
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== current;
  clearInterval(statusTimer);
  statusTimer = null;
  if (current === 'status') {
    loadStatus();
    statusTimer = setInterval(loadStatus, STATUS_REFRESH_MS);
  }
  if (current === 'profiles') renderProfiles();
  if (current === 'channels') renderChannels();
  if (current === 'history') loadHistory();
  if (current === 'settings') loadSettings();
}

// ---- status ----

function ago(value, now) {
  if (!value || !now) return '';
  const diff = Math.round((new Date(now) - new Date(value)) / 1000);
  if (diff < 0) return '';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m ago`;
}

function statusSummary(status) {
  const items = [];
  const engine = !status.enabled ? ['Monitoring', 'Off', 'danger'] : status.active ? ['Monitoring', 'Active', 'ok'] : ['Monitoring', 'Standby', 'warn'];
  items.push(engine);
  items.push(['MetaTrader', status.connected ? 'Connected' : 'Disconnected', status.connected ? 'ok' : 'danger']);
  if (status.serverTime) items.push(['Server time', serverTime(status.serverTime), 'muted']);
  if (status.lastEvaluationAt) items.push(['Last check', formatUtcSeconds(status.lastEvaluationAt) + ' UTC', 'muted']);
  if (status.reason) items.push(['Note', status.reason, 'warn']);
  const host = document.getElementById('status-summary');
  host.replaceChildren(...items.map(([label, value, kind]) => {
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = label;
    span.append(strong, ' ', badge(value, kind));
    return span;
  }));
}

function snoozeMenu(row) {
  const host = document.createElement('span');
  host.className = 'actions';
  if (!can(me, 'tick-monitor.edit')) return host;
  if (row.snoozedUntil)
    host.append(actionButton('Unsnooze', () => snooze(row.symbol, 0), { iconName: 'close' }));
  else
    for (const minutes of SNOOZE_MINUTES)
      host.append(actionButton(`${minutes}m`, () => snooze(row.symbol, minutes)));
  return host;
}

async function snooze(symbol, minutes) {
  try {
    await panelRequest('POST', `tick-monitor/symbols/${encodeURIComponent(symbol)}/snooze`, { minutes });
    showMessage(minutes ? `${symbol} snoozed for ${minutes} minutes.` : `${symbol} is monitored again.`);
    await loadStatus();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

async function loadStatus() {
  try {
    const status = await panelRequest('GET', 'tick-monitor/status');
    statusSummary(status);
    const now = status.serverTime;
    const columns = [
      column('symbol', 'Symbol'),
      column('profile', 'Profile'),
      column('state', 'State', (value, row) => {
        const wrapper = document.createElement('span');
        wrapper.className = 'inline';
        wrapper.append(badge(...(STATE_BADGES[value] ?? [value, 'muted'])));
        if (!row.enabled) wrapper.append(badge('Profile off', 'muted'));
        return wrapper;
      }),
      column('reason', 'Reason', value => value || '—'),
      column('lastTickAt', 'Last tick (server time)', (value, row) => (value ? `${serverTime(value)} · ${ago(value, now)}` : '—')),
      column('lastPrice', 'Last price', value => (value === null || value === undefined ? '—' : String(value))),
      column('activeSchedule', 'Window', value => value || '—'),
      column('nextStage', 'Next stage', (value, row) => (value ? `${value} in ${row.nextStageInSeconds ?? 0}s` : '—')),
      column('gapStart', 'Gap since', (value, row) => (value ? `${serverTime(value)} · ${ago(value, now)}` : '—')),
      column('stagesFired', 'Stages fired'),
      column('snoozedUntil', 'Snoozed until', value => (value ? serverTime(value) : '—')),
      { key: 'symbol', title: 'Snooze', format: (value, row) => snoozeMenu(row), sortable: false, filterable: false },
    ];
    renderTable(document.getElementById('status-table'), columns, status.symbols, null, { viewKey: 'tick-monitor-status' });
    if (!status.symbols.length) document.getElementById('status-table').replaceChildren(emptyNote('No symbol is monitored yet. Add a profile.'));
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

function emptyNote(text) {
  const note = document.createElement('p');
  note.className = 'empty-note';
  note.textContent = text;
  return note;
}

// ---- profiles ----

async function loadProfiles() {
  [channels, profiles] = await Promise.all([panelRequest('GET', 'tick-monitor/channels'), panelRequest('GET', 'tick-monitor/profiles')]);
}

function describeStage(stage) {
  const repeat = stage.repeatCount > 1 ? `, ${stage.repeatCount}× every ${stage.repeatIntervalSeconds}s` : '';
  return `${stage.afterSeconds}s → ${channelName(stage.channelId)}${repeat}`;
}

function describeSchedule(schedule) {
  const days = schedule.days.length === 7 ? 'Every day' : schedule.days.map(day => DAY_SHORT[day] ?? day).join(' ');
  return `${schedule.name}: ${days} ${schedule.from}–${schedule.to}`;
}

const SYMBOLS_SHOWN = 8;

function symbolsCell(symbols) {
  const cell = document.createElement('div');
  cell.className = 'tm-chips compact';
  for (const symbol of symbols.slice(0, SYMBOLS_SHOWN))
    cell.append(Object.assign(document.createElement('span'), { className: 'tm-chip', textContent: symbol, translate: false }));
  if (symbols.length > SYMBOLS_SHOWN) {
    cell.append(Object.assign(document.createElement('span'), { className: 'visually-hidden', textContent: symbols.slice(SYMBOLS_SHOWN).join(' ') }));
    const more = badge(`+${symbols.length - SYMBOLS_SHOWN} more`, 'main');
    more.title = symbols.slice(SYMBOLS_SHOWN).join(', ');
    cell.append(more);
  }
  return cell;
}

function renderProfiles() {
  const host = document.getElementById('profiles');
  if (!profiles.length) {
    host.replaceChildren(emptyNote('No profile yet.'));
    return;
  }
  const columns = [
    column('name', 'Profile'),
    { ...column('symbols', 'Symbols', value => symbolsCell(value)), sortValue: row => row.symbols.length, filterValue: row => row.symbols.join(' ') },
    column('enabled', 'Enabled', value => badge(value ? 'Enabled' : 'Disabled', value ? 'ok' : 'muted')),
    column('config', 'Time windows (server time)', value => {
      const list = document.createElement('ul');
      list.className = 'tm-list';
      for (const schedule of value.schedules) {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = describeSchedule(schedule);
        item.append(title);
        const stages = document.createElement('div');
        stages.className = 'muted';
        stages.textContent = schedule.stages.map(describeStage).join(' · ');
        item.append(stages);
        list.append(item);
      }
      return list;
    }),
    { ...column('config', 'Options', value => {
      const parts = [];
      parts.push(value.recoveryNotice.enabled ? `"Ticks resumed" message if ${value.recoveryNotice.minStagesFired}+ stages fired` : 'No "ticks resumed" message');
      if (value.closeLeadSeconds > 0) parts.push(`Quiet ${value.closeLeadSeconds}s before close`);
      return parts.join(' · ');
    }), help: 'When ticks come back after a gap, one closing message (symbol, gap start and end, duration, price gap) is sent, but only if the gap lasted long enough to fire at least this many alarm stages, so a short one-stage gap does not get a second message.' },
    { ...column('updatedAt', 'Updated', (value, row) => `${formatUtcSeconds(value)} UTC${row.updatedBy ? ` · ${row.updatedBy}` : ''}`), hiddenByDefault: true },
    {
      key: 'id', title: 'Actions', sortable: false, filterable: false,
      format: (value, row) => {
        const actions = document.createElement('span');
        actions.className = 'actions';
        actions.append(
          actionButton('Edit', () => openProfileDialog(row), { iconName: 'pencil', permission: 'tick-monitor.edit' }),
          actionButton('Duplicate', () => openProfileDialog({ ...row, id: null, name: `${row.name} copy`, symbols: [] }), { iconName: 'copy', permission: 'tick-monitor.edit' }),
          actionButton(row.enabled ? 'Disable' : 'Enable', () => toggleProfile(row), { permission: 'tick-monitor.edit' }),
          actionButton('Delete', () => deleteProfile(row), { danger: true, iconName: 'close', permission: 'tick-monitor.edit' }));
        return actions;
      },
    },
  ];
  renderTable(host, columns, profiles, null, { viewKey: 'tick-monitor-profiles' });
}

async function saveProfile(profile, doneText) {
  const saved = await panelRequest('PUT', 'tick-monitor/profiles', profile);
  showMessage(doneText);
  await loadProfiles();
  renderProfiles();
  return saved;
}

async function toggleProfile(profile) {
  try {
    await saveProfile({ ...profile, enabled: !profile.enabled }, profile.enabled ? `${profile.name} disabled.` : `${profile.name} enabled.`);
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

async function deleteProfile(profile) {
  if (!await confirmAction({ title: `Delete the profile ${profile.name}?`, message: `Alarms of its ${profile.symbols.length} symbol(s) stop immediately. The history is kept.`, confirmText: 'Delete', danger: true })) return;
  try {
    await panelRequest('DELETE', `tick-monitor/profiles/${profile.id}`);
    showMessage(`${profile.name} removed.`);
    await loadProfiles();
    renderProfiles();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

// ---- symbol picker ----
// The MetaTrader symbols as a tree of their groups (the symbol path on the server), with a checkbox per symbol and per
// group. A symbol that another profile already watches is shown but cannot be chosen.

const symbolSearch = document.getElementById('symbol-search');
const symbolPicker = document.getElementById('symbol-picker');
const symbolBrowse = document.getElementById('symbol-browse');
let symbolCatalog = null;
let chosenSymbols = new Set();
let openFolders = new Set();

const symbolKey = symbol => symbol.toLowerCase();

async function loadSymbolCatalog() {
  if (symbolCatalog) return;
  try {
    symbolCatalog = await panelRequest('GET', 'tick-monitor/symbols');
  } catch {
    symbolCatalog = [];
  }
  if (!profileDialog.open) return;
  renderSymbolPicker();
}

// Which profile already watches each symbol, other than the one being edited.
function symbolOwners() {
  const owners = new Map();
  for (const profile of profiles)
    if (profile.id !== editingProfile?.id)
      for (const symbol of profile.symbols) owners.set(symbolKey(symbol), profile.name);
  return owners;
}

function symbolTree(items) {
  const root = { path: '', folders: new Map(), symbols: [] };
  for (const item of items) {
    const parts = (item.path || item.name).split('\\').filter(Boolean);
    parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.folders.has(part)) node.folders.set(part, { path: node.path ? `${node.path}\\${part}` : part, folders: new Map(), symbols: [] });
      node = node.folders.get(part);
    }
    node.symbols.push(item.name);
  }
  return root;
}

const treeSymbols = node => [...node.symbols, ...[...node.folders.values()].flatMap(treeSymbols)];

function setChosen(symbols, value) {
  for (const symbol of symbols) {
    const existing = [...chosenSymbols].find(item => symbolKey(item) === symbolKey(symbol));
    if (existing) chosenSymbols.delete(existing);
    if (value) chosenSymbols.add(symbol);
  }
  renderSymbolPicker();
}

const isChosen = symbol => [...chosenSymbols].some(item => symbolKey(item) === symbolKey(symbol));

function renderChosen() {
  const known = new Set((symbolCatalog ?? []).map(item => symbolKey(item.name)));
  const chips = [...chosenSymbols].sort((a, b) => a.localeCompare(b)).map(symbol => {
    const chip = document.createElement('span');
    const unknown = symbolCatalog?.length && !known.has(symbolKey(symbol));
    chip.className = `tm-chip${unknown ? ' unknown' : ''}`;
    chip.translate = false;
    chip.title = unknown ? t('Not found on the MetaTrader server') : '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', t(`Remove ${symbol}`));
    remove.textContent = '\u00d7';
    remove.addEventListener('click', () => setChosen([symbol], false));
    chip.append(symbol, remove);
    return chip;
  });
  const host = document.getElementById('symbol-chips');
  host.replaceChildren(...chips);
  if (!chips.length) host.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'No symbol chosen yet.' }));
  document.getElementById('symbol-count').textContent = `${chosenSymbols.size} selected`;
}

function folderRow(name, node, owners, searching, depth) {
  const all = treeSymbols(node);
  const free = all.filter(symbol => !owners.has(symbolKey(symbol)));
  const chosen = all.filter(isChosen).length;
  const open = searching || openFolders.has(node.path);

  const folder = document.createElement('div');
  folder.className = 'tm-folder';
  const head = document.createElement('div');
  head.className = 'tm-folder-head';
  head.style.paddingInlineStart = `${depth * 18}px`;
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = `tm-folder-arrow${open ? ' open' : ''}`;
  arrow.setAttribute('aria-expanded', String(open));
  arrow.setAttribute('aria-label', name);
  arrow.textContent = '\u25b8';
  arrow.disabled = searching;
  arrow.addEventListener('click', () => {
    if (openFolders.has(node.path)) openFolders.delete(node.path);
    else openFolders.add(node.path);
    renderSymbolPicker();
  });
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.disabled = !free.length;
  box.checked = free.length > 0 && free.every(isChosen);
  box.indeterminate = !box.checked && chosen > 0;
  box.setAttribute('aria-label', t(`All of ${name}`));
  box.addEventListener('change', () => setChosen(free, box.checked));
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'tm-folder-name';
  title.textContent = name;
  title.translate = false;
  title.addEventListener('click', () => arrow.click());
  const count = document.createElement('span');
  count.className = `tm-folder-count${chosen ? ' chosen' : ''}`;
  count.textContent = `${chosen}/${all.length}`;
  head.append(arrow, box, title, count);
  folder.append(head);
  if (open) folder.append(...nodeRows(node, owners, searching, depth + 1));
  return folder;
}

function nodeRows(node, owners, searching, depth) {
  const rows = [...node.folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, child]) => folderRow(name, child, owners, searching, depth));
  for (const symbol of [...node.symbols].sort((a, b) => a.localeCompare(b))) {
    const owner = owners.get(symbolKey(symbol));
    const label = document.createElement('label');
    label.className = `tm-symbol${owner ? ' taken' : ''}`;
    label.style.paddingInlineStart = `${depth * 18 + 26}px`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = isChosen(symbol);
    box.disabled = Boolean(owner);
    box.addEventListener('change', () => setChosen([symbol], box.checked));
    const name = document.createElement('span');
    name.textContent = symbol;
    name.translate = false;
    label.append(box, name);
    if (owner) label.append(Object.assign(document.createElement('span'), { className: 'tm-symbol-owner', textContent: `in ${owner}` }));
    rows.push(label);
  }
  return rows;
}

function renderSymbolPicker() {
  renderChosen();
  if (symbolPicker.hidden) return;
  if (!symbolCatalog) {
    symbolPicker.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Loading the symbols…' }));
    return;
  }
  if (!symbolCatalog.length) {
    symbolPicker.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'The symbol list is not available; type a symbol and press Enter.' }));
    return;
  }
  const needle = symbolSearch.value.trim().toLowerCase();
  const items = needle ? symbolCatalog.filter(item => item.name.toLowerCase().includes(needle) || item.path.toLowerCase().includes(needle)) : symbolCatalog;
  const scroll = symbolPicker.scrollTop;
  const rows = nodeRows(symbolTree(items), symbolOwners(), Boolean(needle), 0);
  symbolPicker.replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('p'), { className: 'muted', textContent: 'No symbol matches; press Enter to add it as typed.' })]));
  symbolPicker.scrollTop = scroll;
}

function showSymbolPicker(show) {
  symbolPicker.hidden = !show;
  symbolBrowse.setAttribute('aria-expanded', String(show));
  symbolBrowse.classList.toggle('active', show);
  renderSymbolPicker();
}

symbolBrowse.addEventListener('click', () => showSymbolPicker(symbolPicker.hidden));
symbolSearch.addEventListener('input', () => {
  if (symbolSearch.value.trim() && symbolPicker.hidden) showSymbolPicker(true);
  else renderSymbolPicker();
});
symbolSearch.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const typed = symbolSearch.value.trim();
  if (!typed) return;
  const known = symbolCatalog?.find(item => symbolKey(item.name) === symbolKey(typed));
  const owner = symbolOwners().get(symbolKey(typed));
  if (owner) {
    profileError.textContent = `${typed} is already in the profile ${owner}.`;
    return;
  }
  profileError.textContent = '';
  symbolSearch.value = '';
  setChosen([known?.name ?? typed], true);
});

// ---- profile dialog ----

function channelSelect(selected, allowEmpty = false) {
  const select = document.createElement('select');
  if (allowEmpty) select.append(new Option('Channel of the first stage', ''));
  for (const channel of channels) select.append(new Option(channel.enabled ? channel.name : `${channel.name} (disabled)`, channel.id));
  select.value = selected ?? '';
  if (!allowEmpty && !select.value && channels.length) select.value = channels[0].id;
  return select;
}

function numberInput(name, value, min, max) {
  const input = document.createElement('input');
  input.type = 'number';
  input.name = name;
  input.min = String(min);
  input.max = String(max);
  input.required = true;
  input.value = String(value);
  return input;
}

function labelled(text, control, className = '', help = '') {
  const label = document.createElement(control.matches('input, select, textarea') ? 'label' : 'div');
  label.className = `tm-label ${className}`.trim();
  const title = document.createElement('span');
  title.append(text);
  if (help) title.append(' ', helpMark(help, text));
  label.append(title, control);
  return label;
}

// What each field of the profile dialog does, shown by its "?".
const PROFILE_HELP = {
  "name": "A short name shown in the panel, for example Day or Night. It is not sent to Telegram.",
  "from": "Start of the window in MetaTrader server time.",
  "to": "End of the window in server time. An end at or before the start means the window runs past midnight into the next day.",
  "days": "The weekdays on which the window starts. A window past midnight belongs to the day it starts.",
  "after": "How many seconds without a tick before this stage fires. Each stage must come after the previous one.",
  "channel": "The Telegram channel this stage writes to.",
  "messages": "How many messages this stage sends. More than 1 makes it a wake-up stage.",
  "every": "Seconds between the messages of this stage. Used only when Messages is more than 1. Every message stops as soon as ticks come back.",
  "coverage": "A preview of the week: each bar is a day from 00:00 to 24:00 server time. Coloured parts are watched, hatched parts are not, and red marks windows that overlap.",
};

function iconButton(iconName, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tm-icon-button danger';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.append(icon(iconName));
  button.addEventListener('click', onClick);
  return button;
}

const STAGE_COLUMNS = [['Stage'], ['After (seconds)', 'after'], ['Channel', 'channel'], ['Messages', 'messages'], ['Every (seconds)', 'every'], ['']];

function withAria(control, text) {
  control.setAttribute('aria-label', text);
  return control;
}

// One stage: a row of the window's stage grid; the column titles sit once above the rows.
function stageRow(stage) {
  const row = document.createElement('div');
  row.className = 'tm-stage';
  const number = document.createElement('span');
  number.className = 'tm-stage-number';
  row.append(
    number,
    withAria(numberInput('afterSeconds', stage.afterSeconds, 1, 86400), 'After (seconds)'),
    withAria(Object.assign(channelSelect(stage.channelId), { name: 'channelId' }), 'Channel'),
    withAria(numberInput('repeatCount', stage.repeatCount, 1, 500), 'Messages'),
    withAria(numberInput('repeatIntervalSeconds', stage.repeatIntervalSeconds, 0, 86400), 'Every (seconds)'),
    iconButton('close', 'Remove stage', () => { row.remove(); drawCoverage(); }));
  row.addEventListener('input', drawCoverage);
  return row;
}

function scheduleCard(schedule) {
  const card = document.createElement('div');
  card.className = 'tm-schedule';

  const head = document.createElement('div');
  head.className = 'tm-schedule-head';
  const name = document.createElement('input');
  name.name = 'name';
  name.maxLength = 40;
  name.required = true;
  name.value = schedule.name;
  const from = document.createElement('input');
  from.type = 'time';
  from.name = 'from';
  from.required = true;
  from.value = schedule.from;
  const to = document.createElement('input');
  to.type = 'time';
  to.name = 'to';
  to.required = true;
  to.value = schedule.to;
  const days = document.createElement('div');
  days.className = 'tm-days';
  for (const day of DAYS) {
    const chip = document.createElement('label');
    chip.className = 'tm-day';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = 'day';
    box.value = day;
    box.checked = schedule.days.includes(day);
    chip.append(box, DAY_SHORT[day]);
    days.append(chip);
  }
  head.append(labelled('Name', name, 'tm-grow', PROFILE_HELP.name), labelled('From', from, '', PROFILE_HELP.from), labelled('To', to, '', PROFILE_HELP.to),
    labelled('Days', days, '', PROFILE_HELP.days),
    iconButton('close', 'Remove window', () => { card.remove(); drawCoverage(); }));
  card.append(head);

  const stages = document.createElement('div');
  stages.className = 'tm-stages';
  const titles = document.createElement('div');
  titles.className = 'tm-stage tm-stage-titles';
  for (const [text, help] of STAGE_COLUMNS) {
    const cell = document.createElement('span');
    cell.append(text);
    if (help) cell.append(' ', helpMark(PROFILE_HELP[help], text));
    titles.append(cell);
  }
  stages.append(titles);
  for (const stage of schedule.stages) stages.append(stageRow(stage));
  card.append(stages);
  card.append(actionButton('Add stage', () => { stages.append(stageRow({ afterSeconds: 30, channelId: channels[0]?.id, repeatCount: 1, repeatIntervalSeconds: 0 })); drawCoverage(); }, { iconName: 'plusBox' }));
  card.addEventListener('input', drawCoverage);
  return card;
}

function readSchedule(card) {
  return {
    name: card.querySelector('[name="name"]').value.trim(),
    days: [...card.querySelectorAll('[name="day"]:checked')].map(box => box.value),
    from: card.querySelector('[name="from"]').value.slice(0, 5),
    to: card.querySelector('[name="to"]').value.slice(0, 5),
    stages: [...card.querySelectorAll('.tm-stage:not(.tm-stage-titles)')].map(row => ({
      afterSeconds: Number(row.querySelector('[name="afterSeconds"]').value),
      channelId: row.querySelector('[name="channelId"]').value,
      repeatCount: Number(row.querySelector('[name="repeatCount"]').value),
      repeatIntervalSeconds: Number(row.querySelector('[name="repeatIntervalSeconds"]').value),
    })),
  };
}

const minutesOf = time => {
  const [hours, minutes] = time.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : -1;
};

// Same rule as the server: a window whose end is not after its start crosses midnight into the next day.
function covers(schedule, dayIndex, minute) {
  const from = minutesOf(schedule.from);
  const to = minutesOf(schedule.to);
  if (from < 0 || to < 0) return false;
  const day = DAYS[dayIndex];
  if (from < to) return schedule.days.includes(day) && minute >= from && minute < to;
  const previous = DAYS[(dayIndex + 6) % 7];
  return (schedule.days.includes(day) && minute >= from) || (schedule.days.includes(previous) && minute < to);
}

// One bar per weekday: coloured where a window covers the quarter hour, red where two overlap, hatched where none does.
function drawCoverage() {
  const schedules = [...schedulesHost.querySelectorAll('.tm-schedule')].map(readSchedule);
  coverageHost.replaceChildren();
  if (!schedules.length) return;
  const title = document.createElement('div');
  title.className = 'tm-coverage-title';
  title.append('Coverage (server time, 00:00 → 24:00)', ' ', helpMark(PROFILE_HELP.coverage, 'Coverage'));
  coverageHost.append(title);
  DAYS.forEach((day, dayIndex) => {
    const row = document.createElement('div');
    row.className = 'tm-coverage-row';
    const label = document.createElement('span');
    label.textContent = DAY_SHORT[day];
    row.append(label);
    const bar = document.createElement('div');
    bar.className = 'tm-coverage-bar';
    for (let cell = 0; cell < COVERAGE_CELLS; cell++) {
      const minute = cell * (1440 / COVERAGE_CELLS);
      const hits = schedules.filter(schedule => covers(schedule, dayIndex, minute));
      const piece = document.createElement('span');
      piece.className = hits.length > 1 ? 'overlap' : hits.length === 1 ? `covered c${schedules.indexOf(hits[0]) % 6}` : 'gap';
      piece.title = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')} ${hits.length > 1 ? 'Overlap: ' + hits.map(hit => hit.name).join(', ') : hits.length ? hits[0].name : 'Not monitored'}`;
      bar.append(piece);
    }
    row.append(bar);
    coverageHost.append(row);
  });
}

function openProfileDialog(profile) {
  if (!channels.length) {
    showMessage('Add a channel first; every stage needs one.', 'error');
    return;
  }
  editingProfile = profile;
  const config = profile?.config ?? {
    closeLeadSeconds: 0,
    recoveryNotice: { enabled: true, minStagesFired: 2, channelId: null },
    schedules: [{ name: 'Day', days: DAYS.slice(0, 5), from: '04:00', to: '20:00', stages: [{ afterSeconds: 30, channelId: channels[0].id, repeatCount: 1, repeatIntervalSeconds: 0 }] }],
  };
  document.getElementById('profile-dialog-title').textContent = profile?.id ? `Edit ${profile.name}` : 'New profile';
  profileForm.elements.profileName.value = profile?.name ?? '';
  chosenSymbols = new Set(profile?.symbols ?? []);
  openFolders = new Set();
  symbolSearch.value = '';
  symbolPicker.hidden = true;
  symbolBrowse.setAttribute('aria-expanded', 'false');
  symbolBrowse.classList.remove('active');
  profileForm.elements.enabled.checked = profile?.enabled ?? true;
  profileForm.elements.closeLeadSeconds.value = String(config.closeLeadSeconds ?? 0);
  profileForm.elements.recoveryEnabled.checked = config.recoveryNotice?.enabled ?? true;
  profileForm.elements.recoveryMinStages.value = String(config.recoveryNotice?.minStagesFired ?? 2);
  const recoveryChannel = channelSelect(config.recoveryNotice?.channelId, true);
  recoveryChannel.name = 'recoveryChannelId';
  profileForm.elements.recoveryChannelId.replaceWith(recoveryChannel);
  schedulesHost.replaceChildren(...config.schedules.map(scheduleCard));
  drawCoverage();
  profileError.textContent = '';
  renderSymbolPicker();
  profileDialog.showModal();
  loadSymbolCatalog();
}

profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  const schedules = [...schedulesHost.querySelectorAll('.tm-schedule')].map(readSchedule);
  const body = {
    id: editingProfile?.id ?? null,
    name: profileForm.elements.profileName.value.trim(),
    symbols: [...chosenSymbols],
    enabled: profileForm.elements.enabled.checked,
    config: {
      closeLeadSeconds: Number(profileForm.elements.closeLeadSeconds.value),
      recoveryNotice: {
        enabled: profileForm.elements.recoveryEnabled.checked,
        minStagesFired: Number(profileForm.elements.recoveryMinStages.value),
        channelId: profileForm.elements.recoveryChannelId.value || null,
      },
      schedules,
    },
  };
  if (!body.symbols.length) {
    profileError.textContent = 'Choose at least one symbol.';
    return;
  }
  if (!schedules.length) {
    profileError.textContent = 'Add at least one time window.';
    return;
  }
  try {
    await saveProfile(body, `${body.name} saved.`);
    profileDialog.close();
  } catch (error) {
    profileError.textContent = error.message || 'The profile could not be saved.';
  }
});

document.getElementById('profile-cancel').addEventListener('click', () => profileDialog.close());
document.getElementById('profile-close').addEventListener('click', () => profileDialog.close());
document.getElementById('profile-add').addEventListener('click', () => openProfileDialog(null));
document.getElementById('schedule-add').addEventListener('click', () => {
  schedulesHost.append(scheduleCard({ name: `Window ${schedulesHost.children.length + 1}`, days: DAYS.slice(0, 5), from: '00:00', to: '00:00', stages: [{ afterSeconds: 30, channelId: channels[0]?.id, repeatCount: 1, repeatIntervalSeconds: 0 }] }));
  drawCoverage();
});

// ---- channels ----

function renderChannels() {
  const host = document.getElementById('channels');
  if (!channels.length) {
    host.replaceChildren(emptyNote('No channel yet.'));
    return;
  }
  const columns = [
    column('name', 'Name'),
    column('telegramChatId', 'Telegram chat id', value => String(value)),
    column('enabled', 'Enabled', value => badge(value ? 'Enabled' : 'Disabled', value ? 'ok' : 'muted')),
    column('updatedAt', 'Updated', value => `${formatUtcSeconds(value)} UTC`),
    {
      key: 'id', title: 'Actions', sortable: false, filterable: false,
      format: (value, row) => {
        const actions = document.createElement('span');
        actions.className = 'actions';
        actions.append(
          actionButton('Edit', () => openChannelDialog(row), { iconName: 'pencil', permission: 'tick-monitor.channels' }),
          actionButton('Send test', () => testChannel(row), { iconName: 'message', permission: 'tick-monitor.channels' }),
          actionButton('Delete', () => deleteChannel(row), { danger: true, iconName: 'close', permission: 'tick-monitor.channels' }));
        return actions;
      },
    },
  ];
  renderTable(host, columns, channels, null, { viewKey: 'tick-monitor-channels' });
}

function openChannelDialog(channel) {
  editingChannel = channel;
  document.getElementById('channel-dialog-title').textContent = channel ? `Edit ${channel.name}` : 'New channel';
  channelForm.elements.name.value = channel?.name ?? '';
  channelForm.elements.telegramChatId.value = channel ? String(channel.telegramChatId) : '';
  channelForm.elements.enabled.checked = channel?.enabled ?? true;
  channelError.textContent = '';
  channelDialog.showModal();
}

channelForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const saved = await panelRequest('PUT', 'tick-monitor/channels', {
      id: editingChannel?.id ?? null,
      name: channelForm.elements.name.value.trim(),
      telegramChatId: Number(channelForm.elements.telegramChatId.value),
      enabled: channelForm.elements.enabled.checked,
    });
    showMessage(`${saved.name} saved.`);
    channelDialog.close();
    await loadProfiles();
    renderChannels();
  } catch (error) {
    channelError.textContent = error.message || 'The channel could not be saved.';
  }
});

document.getElementById('channel-cancel').addEventListener('click', () => channelDialog.close());
document.getElementById('channel-add').addEventListener('click', () => openChannelDialog(null));

async function testChannel(channel) {
  try {
    await panelRequest('POST', `tick-monitor/channels/${channel.id}/test`);
    showMessage(`Test message sent to ${channel.name}.`);
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

async function deleteChannel(channel) {
  if (!await confirmAction({ title: `Delete the channel ${channel.name}?`, confirmText: 'Delete', danger: true })) return;
  try {
    await panelRequest('DELETE', `tick-monitor/channels/${channel.id}`);
    showMessage(`${channel.name} removed.`);
    await loadProfiles();
    renderChannels();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

// ---- history ----

const ENDED_BY = {
  Tick: ['Ticks resumed', 'ok'],
  MarketClosed: ['Market closed', 'muted'],
  Uncovered: ['Window ended', 'muted'],
  Disabled: ['Disabled', 'muted'],
};

async function loadHistory() {
  const form = document.getElementById('history-form');
  const values = formValues(form);
  const params = {
    symbol: values.symbol || undefined,
    from: values.from ? new Date(values.from + 'Z').toISOString() : undefined,
    to: values.to ? new Date(values.to + 'Z').toISOString() : undefined,
    limit: values.limit,
  };
  try {
    const events = await panelRequest('GET', `tick-monitor/events${toQueryString(params)}`);
    const columns = [
      column('symbol', 'Symbol'),
      column('gapStart', 'Gap start (server time)', serverTime),
      column('gapEnd', 'Gap end (server time)', value => (value ? serverTime(value) : badge('Ongoing', 'danger'))),
      column('gapEnd', 'Duration', (value, row) => (value ? formatSpan(Math.round((new Date(value) - new Date(row.gapStart)) / 1000), true) : '—')),
      column('endedBy', 'Ended by', value => (value ? badge(...(ENDED_BY[value] ?? [value, 'muted'])) : '—')),
      column('scheduleName', 'Window', value => value || '—'),
      column('stagesFired', 'Stages fired'),
      column('messagesSent', 'Sent'),
      column('messagesFailed', 'Failed', value => (value ? badge(String(value), 'danger') : '0')),
      column('lastPrice', 'Last price', value => (value === null || value === undefined ? '—' : String(value))),
    ];
    const host = document.getElementById('history');
    renderTable(host, columns, events, null, { viewKey: 'tick-monitor-history' });
    if (!events.length) host.replaceChildren(emptyNote('No gap in this range.'));
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

document.getElementById('history-form').addEventListener('submit', event => {
  event.preventDefault();
  loadHistory();
});

// ---- settings ----

// Each limit: its field, unit, allowed range, default and what it does, so the form explains itself.
const LIMITS = [
  { key: 'maxRepeatCount', title: 'Most messages per stage', unit: 'messages', min: 1, max: 500, fallback: 20,
    help: 'The largest "Messages" a stage may have. A wake-up stage with 5 messages every 5 seconds needs at least 5.' },
  { key: 'minRepeatIntervalSeconds', title: 'Shortest interval between repeats', unit: 'seconds', min: 1, max: 3600, fallback: 5,
    help: 'The smallest "Every (seconds)" a stage may use. Telegram allows about 20 messages a minute per chat; 5 seconds keeps a stage under that.' },
  { key: 'minAfterSeconds', title: 'Shortest alarm delay', unit: 'seconds', min: 1, max: 3600, fallback: 5,
    help: 'The smallest "After (seconds)" a stage may use. The engine checks once a second, so a delay under 5 seconds adds noise without precision.' },
  { key: 'openGraceSeconds', title: 'Grace after the market opens', unit: 'seconds', min: 0, max: 3600, fallback: 120,
    help: 'No alarm during this time after a symbol\'s quote session opens, because the first tick after the open is often late. The gap still counts from the open.' },
  { key: 'eventsRetentionDays', title: 'Keep the gap history for', unit: 'days', min: 1, max: 3650, fallback: 90,
    help: 'Older gaps are deleted from the History tab once a day.' },
];

const settingsForm = document.getElementById('settings-form');
const enabledSwitch = document.getElementById('settings-enabled');
let enabledDraft = false;

function limitField(limit) {
  const field = document.createElement('div');
  field.className = 'tm-field tm-limit';
  const label = document.createElement('label');
  label.htmlFor = `settings-${limit.key}`;
  label.append(limit.title, ' ', helpMark(limit.help, limit.title));
  const row = document.createElement('div');
  row.className = 'tm-inline';
  const input = document.createElement('input');
  input.type = 'number';
  input.id = `settings-${limit.key}`;
  input.name = limit.key;
  input.min = String(limit.min);
  input.max = String(limit.max);
  input.step = '1';
  const unit = document.createElement('span');
  unit.className = 'tm-unit';
  unit.textContent = limit.unit;
  const reset = actionButton(`Use default (${limit.fallback})`, () => { input.value = String(limit.fallback); input.dispatchEvent(new Event('input', { bubbles: true })); });
  row.append(input, unit, reset);
  input.title = `Allowed: ${limit.min} to ${limit.max} ${limit.unit}.`;
  const error = document.createElement('p');
  error.className = 'field-error';
  error.dataset.errorFor = limit.key;
  field.append(label, row, error);
  return field;
}

function limitError(limit, value) {
  if (value === '' || !Number.isInteger(Number(value))) return 'Enter a whole number.';
  const number = Number(value);
  if (number < limit.min || number > limit.max) return `Must be between ${limit.min} and ${limit.max}.`;
  return '';
}

function showLimitErrors() {
  let valid = true;
  for (const limit of LIMITS) {
    const message = limitError(limit, settingsForm.elements[limit.key].value);
    settingsForm.querySelector(`[data-error-for="${limit.key}"]`).textContent = message;
    settingsForm.elements[limit.key].classList.toggle('invalid', Boolean(message));
    if (message) valid = false;
  }
  return valid;
}

function settingsDraft() {
  return {
    enabled: enabledDraft,
    telegramBotToken: settingsForm.elements.telegramBotToken.value.trim() || null,
    clearTelegramBotToken: settingsForm.elements.clearTelegramBotToken.checked,
    opsChannelId: settingsForm.elements.opsChannelId.value || null,
    ...Object.fromEntries(LIMITS.map(limit => [limit.key, Number(settingsForm.elements[limit.key].value)])),
  };
}

function settingsChanged() {
  if (!settings) return false;
  const draft = settingsDraft();
  return draft.enabled !== settings.enabled || draft.telegramBotToken !== null || draft.clearTelegramBotToken ||
    (draft.opsChannelId ?? null) !== (settings.opsChannelId ?? null) ||
    LIMITS.some(limit => draft[limit.key] !== settings[limit.key]);
}

function paintEnabled() {
  const tokenSet = settings?.telegramBotTokenSet && !settingsForm.elements.clearTelegramBotToken.checked;
  const willHaveToken = tokenSet || settingsForm.elements.telegramBotToken.value.trim().length > 0;
  enabledSwitch.className = `switch ${enabledDraft ? 'on' : 'off'}`;
  enabledSwitch.setAttribute('aria-checked', String(enabledDraft));
  const state = document.getElementById('settings-enabled-state');
  state.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = enabledDraft ? 'On' : 'Off';
  state.append(strong);
  const note = document.getElementById('settings-enabled-note');
  note.textContent = enabledDraft && !willHaveToken
    ? 'Monitoring is set to on but no bot token is saved: the engine will not start until a token is saved.'
    : enabledDraft ? 'Alarms are sent as soon as the settings are saved and a profile has a gap.' : 'No alarm is sent while monitoring is off. Profiles and channels can still be edited.';
  note.classList.toggle('warn', enabledDraft && !willHaveToken);
}

function paintTokenState() {
  const state = document.getElementById('settings-token-state');
  const entered = settingsForm.elements.telegramBotToken.value.trim();
  if (settingsForm.elements.clearTelegramBotToken.checked) state.textContent = 'The saved token will be removed when you save.';
  else if (entered) state.textContent = /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(entered) ? 'New token entered; it replaces the saved one when you save.' : 'This does not look like a bot token (expected digits, a colon, then at least 30 characters).';
  else state.textContent = settings?.telegramBotTokenSet ? `Saved token: ${settings.telegramBotTokenHint}` : 'No token is saved.';
}

function paintDirty() {
  const dirty = settingsChanged();
  document.getElementById('settings-dirty').textContent = dirty ? 'Unsaved changes' : '';
  document.getElementById('settings-discard').disabled = !dirty;
}

function paintSettings() {
  paintEnabled();
  paintTokenState();
  paintDirty();
}

async function paintEngine() {
  try {
    const status = await panelRequest('GET', 'tick-monitor/status');
    const host = document.getElementById('settings-engine');
    const engine = !status.enabled ? ['Engine', 'Off', 'danger'] : status.active ? ['Engine', 'Active', 'ok'] : ['Engine', 'Standby', 'warn'];
    const items = [engine, ['MetaTrader', status.connected ? 'Connected' : 'Disconnected', status.connected ? 'ok' : 'danger']];
    if (status.reason) items.push(['Note', status.reason, 'warn']);
    host.replaceChildren(...items.map(([label, value, kind]) => {
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = label;
      span.append(strong, ' ', badge(value, kind));
      return span;
    }));
  } catch {
    // The engine summary is informative only; the form works without it.
  }
}

function fillSettings() {
  enabledDraft = settings.enabled;
  settingsForm.elements.telegramBotToken.value = '';
  settingsForm.elements.telegramBotToken.type = 'password';
  document.getElementById('settings-token-show').textContent = 'Show';
  settingsForm.elements.clearTelegramBotToken.checked = false;
  const channelOptions = () => channels.map(channel => new Option(channel.enabled ? channel.name : `${channel.name} (disabled)`, channel.id));
  const ops = document.getElementById('settings-ops-channel');
  ops.replaceChildren(new Option('None (write to the log only)', ''), ...channelOptions());
  ops.value = settings.opsChannelId ?? '';
  const test = document.getElementById('settings-test-channel');
  test.replaceChildren(...channelOptions());
  if (settings.opsChannelId) test.value = settings.opsChannelId;
  for (const limit of LIMITS) settingsForm.elements[limit.key].value = String(settings[limit.key]);
  showLimitErrors();
  paintSettings();
}

async function loadSettings() {
  try {
    settings = await panelRequest('GET', 'tick-monitor/settings');
    if (!document.getElementById('settings-limits').children.length)
      document.getElementById('settings-limits').replaceChildren(...LIMITS.map(limitField));
    fillSettings();
    const editable = can(me, 'tick-monitor.settings');
    for (const element of settingsForm.querySelectorAll('input, select, button'))
      if (element.id !== 'settings-token-show' && element.id !== 'settings-test-channel' && element.id !== 'settings-test') element.disabled = !editable;
    paintEngine();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

enabledSwitch.addEventListener('click', () => {
  enabledDraft = !enabledDraft;
  paintSettings();
});

settingsForm.addEventListener('input', () => {
  showLimitErrors();
  paintSettings();
});

document.getElementById('settings-token-show').addEventListener('click', event => {
  const input = settingsForm.elements.telegramBotToken;
  input.type = input.type === 'password' ? 'text' : 'password';
  event.target.textContent = input.type === 'password' ? 'Show' : 'Hide';
});

document.getElementById('settings-discard').addEventListener('click', () => fillSettings());

document.getElementById('settings-test').addEventListener('click', async () => {
  const channelId = document.getElementById('settings-test-channel').value;
  if (!channelId) {
    showMessage('Add a channel on the Channels tab first.', 'error');
    return;
  }
  if (settingsForm.elements.telegramBotToken.value.trim()) {
    showMessage('Save the new token first; the test uses the saved token.', 'error');
    return;
  }
  const channel = channels.find(entry => entry.id === channelId);
  await testChannel(channel);
});

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!showLimitErrors()) {
    showMessage('Fix the highlighted limits first.', 'error');
    return;
  }
  const draft = settingsDraft();
  if (draft.enabled && !settings.enabled && !await confirmAction({ title: 'Turn tick monitoring on?', message: 'Alarms start going to the Telegram channels as soon as a monitored symbol has a gap.', confirmText: 'Turn on' })) return;
  if (!draft.enabled && settings.enabled && !await confirmAction({ title: 'Turn tick monitoring off?', message: 'No alarm will be sent until it is turned on again.', confirmText: 'Turn off', danger: true })) return;
  if (draft.clearTelegramBotToken && !await confirmAction({ title: 'Remove the saved bot token?', message: 'Monitoring stops until a new token is saved.', confirmText: 'Remove', danger: true })) return;
  try {
    settings = await panelRequest('PUT', 'tick-monitor/settings', draft);
    showMessage('Settings saved.');
    fillSettings();
    paintEngine();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});

// ---- boot ----

const viewEntry = MENU_ITEMS.find(item => item.href === (currentView() === 'status' ? location.pathname : `${location.pathname}?view=${currentView()}`));
if (viewEntry) document.title = `${viewEntry.title} \u2014 Violation Panel`;
applyHelpMarks();
renderMenu();
currentAccount().then(async account => {
  me = account;
  if (!can(me, 'tick-monitor.view')) return;
  try {
    await loadProfiles();
    showTab(currentView());
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});
