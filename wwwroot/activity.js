// Sign-in activity: per-account counts from the audit log (/panel-api/users/activity) and the recent sign-in attempts
// (/panel-api/audit with the sign_in prefix).

const form = document.getElementById('activity-form');
const STATE_BADGES = { active: ['Active', 'ok'], locked: ['Locked', 'warn'], disabled: ['Disabled', 'danger'] };
const ROLE_LABELS = { superadmin: 'Super admin', admin: 'Admin' };

const ACTIVITY_COLUMNS = [
  { key: 'username', title: 'Account' },
  { key: 'role', title: 'Role', format: value => badge(ROLE_LABELS[value] ?? value, value === 'superadmin' ? 'main' : 'muted') },
  { key: 'state', title: 'State', format: value => badge(...(STATE_BADGES[value] ?? [value, 'muted'])) },
  { key: 'twoFactor', title: '2FA', format: value => badge(value ? 'On' : 'Off', value ? 'ok' : 'warn') },
  { key: 'signIns', title: 'Sign-ins' },
  { key: 'failedSignIns', title: 'Failed attempts', format: value => (value ? badge(String(value), value >= 5 ? 'danger' : 'warn') : '0') },
  { key: 'distinctIps', title: 'Addresses', format: value => (value > 1 ? badge(String(value), 'warn') : String(value)) },
  { key: 'activeSessions', title: 'Open sessions' },
  utcColumn('lastSignInAt', 'Last sign-in'),
  { key: 'lastIpAddress', title: 'Last IP', format: value => value || '—' },
  utcColumn('lastFailureAt', 'Last failure'),
  { key: 'changes', title: 'Other events' },
];

const SIGN_IN_COLUMNS = [
  utcColumn('occurredAt', 'Time'),
  { key: 'event', title: 'Result', format: value => badge(value === 'sign_in_succeeded' ? 'Succeeded' : 'Failed', value === 'sign_in_succeeded' ? 'ok' : 'danger') },
  { key: 'username', title: 'Account' },
  { key: 'detail', title: 'Detail' },
  { key: 'ipAddress', title: 'IP' },
  { key: 'userAgent', title: 'Client', format: value => (value ? value.slice(0, 80) : '') },
];

function summaryItems(rows) {
  return [
    ['Accounts', String(rows.length)],
    ['Sign-ins', String(rows.reduce((sum, row) => sum + row.signIns, 0))],
    ['Failed attempts', String(rows.reduce((sum, row) => sum + row.failedSignIns, 0))],
    ['Never signed in', String(rows.filter(row => !row.lastSignInAt).length)],
    ['Without 2FA', String(rows.filter(row => !row.twoFactor).length)],
  ].map(([label, value]) => {
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = label;
    span.append(strong, ' ', value);
    return span;
  });
}

async function load() {
  const values = formValues(form);
  const days = Number(values.days);
  const username = (values.username ?? '').trim();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    const [activity, signIns] = await Promise.all([
      panelRequest('GET', `users/activity${toQueryString({ days })}`),
      panelRequest('GET', `audit${toQueryString({ username: username || undefined, eventPrefix: 'sign_in', from, limit: 500 })}`),
    ]);
    const needle = username.toLowerCase();
    const rows = needle ? activity.filter(row => row.username.toLowerCase().includes(needle)) : activity;
    document.getElementById('activity-summary').replaceChildren(...summaryItems(rows));
    renderTable(document.getElementById('activity'), ACTIVITY_COLUMNS, rows, undefined, { export: { name: 'panel-sign-in-activity' }, viewKey: 'activity' });
    renderTable(document.getElementById('sign-ins'), SIGN_IN_COLUMNS, signIns, undefined, { export: { name: 'panel-sign-ins' }, viewKey: 'sign-ins' });
    if (!signIns.length) document.getElementById('sign-ins').replaceChildren(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: 'No sign-in attempt in this period.' }));
  } catch (error) {
    if (error.message) toast(error.message, 'error');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  load();
});

renderMenu();
currentAccount().then(me => {
  if (can(me, 'audit.view')) load();
});
