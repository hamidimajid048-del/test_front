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
let symbolSuggestionsLoaded = false;

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

function showTab(tab) {
  const current = ['profiles', 'channels', 'history', 'settings'].includes(tab) ? tab : 'status';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === current);
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

function renderProfiles() {
  const host = document.getElementById('profiles');
  if (!profiles.length) {
    host.replaceChildren(emptyNote('No profile yet.'));
    return;
  }
  const columns = [
    column('symbol', 'Symbol'),
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
    column('config', 'Options', value => {
      const parts = [];
      parts.push(value.recoveryNotice.enabled ? `Resumed notice after ${value.recoveryNotice.minStagesFired} stage(s)` : 'No resumed notice');
      if (value.closeLeadSeconds > 0) parts.push(`Quiet ${value.closeLeadSeconds}s before close`);
      return parts.join(' · ');
    }),
    column('updatedAt', 'Updated', (value, row) => `${formatUtcSeconds(value)} UTC${row.updatedBy ? ` · ${row.updatedBy}` : ''}`),
    {
      key: 'id', title: 'Actions', sortable: false, filterable: false,
      format: (value, row) => {
        const actions = document.createElement('span');
        actions.className = 'actions';
        actions.append(
          actionButton('Edit', () => openProfileDialog(row), { iconName: 'pencil', permission: 'tick-monitor.edit' }),
          actionButton('Duplicate', () => openProfileDialog({ ...row, id: null, symbol: '' }), { iconName: 'copy', permission: 'tick-monitor.edit' }),
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
    await saveProfile({ ...profile, enabled: !profile.enabled }, profile.enabled ? `${profile.symbol} disabled.` : `${profile.symbol} enabled.`);
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

async function deleteProfile(profile) {
  if (!await confirmAction({ title: `Delete the profile of ${profile.symbol}?`, message: 'Its alarms stop immediately. The history is kept.', confirmText: 'Delete', danger: true })) return;
  try {
    await panelRequest('DELETE', `tick-monitor/profiles/${profile.id}`);
    showMessage(`${profile.symbol} removed.`);
    await loadProfiles();
    renderProfiles();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

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

function labelled(text, control, className = '') {
  const label = document.createElement('label');
  if (className) label.className = className;
  label.append(text, control);
  return label;
}

function stageRow(stage) {
  const row = document.createElement('div');
  row.className = 'tm-stage';
  row.append(
    labelled('After (seconds)', numberInput('afterSeconds', stage.afterSeconds, 1, 86400)),
    labelled('Channel', Object.assign(channelSelect(stage.channelId), { name: 'channelId' })),
    labelled('Messages', numberInput('repeatCount', stage.repeatCount, 1, 500)),
    labelled('Every (seconds)', numberInput('repeatIntervalSeconds', stage.repeatIntervalSeconds, 0, 86400)),
    actionButton('Remove', () => { row.remove(); drawCoverage(); }, { danger: true, iconName: 'minusBox' }));
  row.addEventListener('input', drawCoverage);
  return row;
}

function scheduleCard(schedule) {
  const card = document.createElement('fieldset');
  card.className = 'tm-schedule';
  const legend = document.createElement('legend');
  legend.textContent = 'Time window';
  card.append(legend);

  const head = document.createElement('div');
  head.className = 'tm-row';
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
  head.append(labelled('Name', name), labelled('From (server time)', from), labelled('To (server time)', to),
    actionButton('Remove window', () => { card.remove(); drawCoverage(); }, { danger: true, iconName: 'minusBox' }));
  card.append(head);

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
  card.append(days);

  const stages = document.createElement('div');
  stages.className = 'tm-stages';
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
    stages: [...card.querySelectorAll('.tm-stage')].map(row => ({
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
  title.textContent = 'Coverage (server time, 00:00 → 24:00)';
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

async function loadSymbolSuggestions() {
  if (symbolSuggestionsLoaded) return;
  try {
    const names = await panelRequest('GET', 'tick-monitor/symbols');
    document.getElementById('symbol-list').replaceChildren(...names.map(name => new Option(name)));
    symbolSuggestionsLoaded = true;
  } catch {
    // Suggestions are a convenience; the symbol can be typed.
  }
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
  document.getElementById('profile-dialog-title').textContent = profile?.id ? `Edit ${profile.symbol}` : 'New profile';
  profileForm.elements.symbol.value = profile?.symbol ?? '';
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
  loadSymbolSuggestions();
  profileDialog.showModal();
}

profileForm.addEventListener('submit', async event => {
  event.preventDefault();
  const schedules = [...schedulesHost.querySelectorAll('.tm-schedule')].map(readSchedule);
  const body = {
    id: editingProfile?.id ?? null,
    symbol: profileForm.elements.symbol.value.trim(),
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
  if (!schedules.length) {
    profileError.textContent = 'Add at least one time window.';
    return;
  }
  try {
    await saveProfile(body, `${body.symbol} saved.`);
    profileDialog.close();
  } catch (error) {
    profileError.textContent = error.message || 'The profile could not be saved.';
  }
});

document.getElementById('profile-cancel').addEventListener('click', () => profileDialog.close());
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

async function loadSettings() {
  try {
    settings = await panelRequest('GET', 'tick-monitor/settings');
    const form = document.getElementById('settings-form');
    form.elements.enabled.checked = settings.enabled;
    form.elements.telegramBotToken.value = '';
    form.elements.telegramBotToken.placeholder = settings.telegramBotTokenSet ? `Saved: ${settings.telegramBotTokenHint}` : 'Not set';
    form.elements.clearTelegramBotToken.checked = false;
    const ops = document.getElementById('settings-ops-channel');
    ops.replaceChildren(new Option('None (log only)', ''), ...channels.map(channel => new Option(channel.name, channel.id)));
    ops.value = settings.opsChannelId ?? '';
    for (const key of ['maxRepeatCount', 'minRepeatIntervalSeconds', 'minAfterSeconds', 'openGraceSeconds', 'eventsRetentionDays'])
      form.elements[key].value = String(settings[key]);
    for (const element of form.elements) element.disabled = !can(me, 'tick-monitor.settings');
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

document.getElementById('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  try {
    settings = await panelRequest('PUT', 'tick-monitor/settings', {
      enabled: form.elements.enabled.checked,
      telegramBotToken: form.elements.telegramBotToken.value.trim() || null,
      clearTelegramBotToken: form.elements.clearTelegramBotToken.checked,
      opsChannelId: form.elements.opsChannelId.value || null,
      maxRepeatCount: Number(form.elements.maxRepeatCount.value),
      minRepeatIntervalSeconds: Number(form.elements.minRepeatIntervalSeconds.value),
      minAfterSeconds: Number(form.elements.minAfterSeconds.value),
      openGraceSeconds: Number(form.elements.openGraceSeconds.value),
      eventsRetentionDays: Number(form.elements.eventsRetentionDays.value),
    });
    showMessage('Settings saved.');
    await loadSettings();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});

// ---- boot ----

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (tab) showTab(tab);
});

renderMenu();
currentAccount().then(async account => {
  me = account;
  if (!can(me, 'tick-monitor.view')) return;
  try {
    await loadProfiles();
    showTab(new URLSearchParams(location.search).get('tab') ?? 'status');
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});
