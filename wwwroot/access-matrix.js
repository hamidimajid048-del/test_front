// Access matrix: every permission against every panel account, read from /panel-api/users and /panel-api/permissions.

const form = document.getElementById('matrix-form');
const message = document.getElementById('message');
let catalog = { permissions: [], presets: [] };
let users = [];

const dashboardTitle = key => DASHBOARDS.find(dashboard => dashboard.key === key)?.title ?? 'Every dashboard';

function tick(granted) {
  const span = document.createElement('span');
  span.className = `matrix-cell ${granted ? 'granted' : 'denied'}`;
  span.setAttribute('aria-label', granted ? 'Allowed' : 'Not allowed');
  span.textContent = granted ? '✓' : '·';
  return span;
}

function render() {
  const values = formValues(form);
  const needle = (values.username ?? '').trim().toLowerCase();
  const shown = users.filter(user => (!needle || user.username.toLowerCase().includes(needle)) && (!values.activeOnly || user.state === 'active'));
  const permissions = catalog.permissions.filter(permission => !values.group || permission.group === values.group);

  const summary = document.getElementById('matrix-summary');
  summary.replaceChildren(...[
    ['Accounts', String(shown.length)],
    ['Permissions', String(permissions.length)],
    ['Super admins', String(shown.filter(user => user.role === 'superadmin').length)],
  ].map(([label, value]) => {
    const span = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = label;
    span.append(strong, ' ', value);
    return span;
  }));

  const columns = [
    { key: 'dashboard', title: 'Dashboard', format: value => dashboardTitle(value) },
    { key: 'group', title: 'Group' },
    { key: 'title', title: 'Permission', format: (value, permission) => {
      const cell = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = value;
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = permission.description;
      cell.append(name, note);
      return cell;
    } },
    { key: 'key', title: 'Granted to', format: (_, permission) => String(shown.filter(user => user.permissions.includes(permission.key)).length) },
    ...shown.map(user => ({
      key: 'key',
      title: user.username,
      sortable: false,
      filterable: false,
      format: (_, permission) => tick(user.permissions.includes(permission.key)),
    })),
    { key: 'key', title: 'Roles granting it', sortable: false, filterable: false,
      format: (_, permission) => catalog.presets.filter(preset => preset.permissions.includes(permission.key)).map(preset => preset.title).join(', ') || '—' },
  ];
  renderTable(document.getElementById('matrix'), columns, permissions, undefined, { export: { name: 'panel-access-matrix' }, viewKey: 'access-matrix' });
  if (!shown.length) document.getElementById('matrix').replaceChildren(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: 'No account matches.' }));
}

form.addEventListener('submit', event => {
  event.preventDefault();
  render();
});
form.addEventListener('change', render);

renderMenu();
currentAccount().then(async me => {
  if (!can(me, 'users.view')) return;
  try {
    [catalog, users] = await Promise.all([panelRequest('GET', 'permissions'), panelRequest('GET', 'users')]);
    const groups = document.getElementById('matrix-group');
    for (const group of [...new Set(catalog.permissions.map(permission => permission.group))]) {
      const dashboard = catalog.permissions.find(permission => permission.group === group).dashboard;
      groups.append(new Option(`${dashboardTitle(dashboard)} — ${group}`, group));
    }
    render();
  } catch (error) {
    if (error.message) toast(error.message, 'error');
  }
});
