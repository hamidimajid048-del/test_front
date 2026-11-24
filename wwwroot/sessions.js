// Sessions page: the panel's server-side sessions (/panel-api/sessions), open ones by default, with the option to end one.

const form = document.getElementById('sessions-form');
let me = null;

function sessionState(session) {
  if (session.revokedAt) return ['Ended', 'muted'];
  if (new Date(session.expiresAt) <= new Date()) return ['Expired', 'muted'];
  return ['Open', 'ok'];
}

function endSessionButton(session) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'danger';
  button.textContent = 'End session';
  button.addEventListener('click', async () => {
    if (!await confirmAction({ title: `End this session of ${session.username}?`, message: 'That browser is signed out at its next request.', confirmText: 'End session', danger: true })) return;
    try {
      await panelRequest('DELETE', `sessions/${session.id}`);
      toast(`A session of ${session.username} ended.`, 'success');
      await load();
    } catch (error) {
      if (error.message) toast(error.message, 'error');
    }
  });
  return button;
}

const COLUMNS = [
  { key: 'username', title: 'Account', format: (value, session) => session.isCurrent ? inline(value, badge('You, this browser', 'main')) : value },
  { key: 'revokedAt', title: 'State', format: (_, session) => badge(...sessionState(session)) },
  { key: 'ipAddress', title: 'IP', format: value => value || '—' },
  { key: 'userAgent', title: 'Client', format: value => (value ? value.slice(0, 80) : '—') },
  utcColumn('createdAt', 'Signed in'),
  utcColumn('lastSeenAt', 'Last seen'),
  utcColumn('expiresAt', 'Expires'),
  utcColumn('revokedAt', 'Ended'),
  { key: 'id', title: 'Actions', sortable: false, filterable: false, noExport: true, format: (_, session) => {
    const actions = document.createElement('div');
    actions.className = 'actions';
    if (can(me, 'users.manage-state') && sessionState(session)[0] === 'Open' && !session.isCurrent && session.userId !== me.id)
      actions.append(endSessionButton(session));
    return actions;
  } },
];

async function load() {
  const values = formValues(form);
  try {
    let sessions = await panelRequest('GET', `sessions${toQueryString({ all: values.all ? 'true' : undefined, limit: values.limit })}`);
    const needle = (values.username ?? '').trim().toLowerCase();
    if (needle) sessions = sessions.filter(session => session.username.toLowerCase().includes(needle));
    const open = sessions.filter(session => sessionState(session)[0] === 'Open');
    document.getElementById('sessions-summary').replaceChildren(...[
      ['Open sessions', String(open.length)],
      ['Accounts signed in', String(new Set(open.map(session => session.username)).size)],
      ['Distinct addresses', String(new Set(open.map(session => session.ipAddress).filter(Boolean)).size)],
    ].map(([label, value]) => {
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = label;
      span.append(strong, ' ', value);
      return span;
    }));
    renderTable(document.getElementById('sessions'), COLUMNS, sessions, undefined, { export: { name: 'panel-sessions' }, viewKey: 'sessions' });
    if (!sessions.length) document.getElementById('sessions').replaceChildren(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: 'No session matches.' }));
  } catch (error) {
    if (error.message) toast(error.message, 'error');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  load();
});

renderMenu();
currentAccount().then(account => {
  me = account;
  if (can(me, 'users.view')) load();
});
