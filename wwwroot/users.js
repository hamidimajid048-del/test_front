// Users page: add, change and remove panel accounts, choose what each account may do, and read the sign-in audit log.
// Which of these an account sees depends on its permissions; the server enforces the same rules.

const message = document.getElementById('message');
const createForm = document.getElementById('create-form');
const auditForm = document.getElementById('audit-form');
const setup = document.getElementById('two-factor-setup');
const passwordDialog = document.getElementById('password-dialog');
const passwordForm = document.getElementById('password-form');
const passwordError = document.getElementById('password-dialog-error');

const ROLE_LABELS = { superadmin: 'Super admin', admin: 'Admin' };
const STATE_BADGES = { active: ['Active', 'ok'], locked: ['Locked', 'warn'], disabled: ['Disabled', 'danger'] };

const accessDialog = document.getElementById('access-dialog');
const accessForm = document.getElementById('access-form');
const accessError = document.getElementById('access-dialog-error');

let passwordTarget = null;
let accessTarget = null;
let me = null;
let catalog = { permissions: [], presets: [] };
let createAccess = null;
let accessEditor = null;

function showMessage(text, kind = 'success') {
  toast(text, kind);
}

function showTab(tab) {
  const current = ['audit', 'roles'].includes(tab) ? tab : 'accounts';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === current);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== current;
  if (current === 'audit') loadAudit();
  if (current === 'roles') renderRoles();
}

function showTwoFactorSetup(username, twoFactor) {
  document.getElementById('two-factor-title').textContent = `Authenticator key for ${username}`;
  document.getElementById('two-factor-qr').src = twoFactor.qrCode;
  document.getElementById('two-factor-key').textContent = twoFactor.key;
  setup.hidden = false;
  setup.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideTwoFactorSetup() {
  setup.hidden = true;
  document.getElementById('two-factor-qr').removeAttribute('src');
  document.getElementById('two-factor-key').textContent = '';
}

function actionButton(text, onClick, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  if (danger) button.className = 'danger';
  button.addEventListener('click', onClick);
  return button;
}

// Runs one account change, then reloads the list. confirmText: asked first, when the change needs a confirmation.
async function runAction(confirmText, action, doneText) {
  if (confirmText && !await confirmAction({ title: confirmText, confirmText: 'Confirm', danger: /^(Delete|Disable)/.test(confirmText) })) return;
  try {
    const result = await action();
    showMessage(doneText, 'success');
    await loadUsers();
    return result;
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

// A preset picker and the permissions as grouped checkboxes. Permissions the signed-in account does not have itself are
// shown but locked, because nobody can hand out more than they hold. Choosing a permission also chooses what it needs.
function createAccessEditor(host, withPresets = true) {
  const boxes = new Map();
  const root = document.createElement('div');
  root.className = 'access-editor';

  const presetLabel = document.createElement('label');
  presetLabel.className = 'access-preset';
  const presetSelect = document.createElement('select');
  presetLabel.append('Role', presetSelect);
  presetSelect.append(new Option('Custom', ''));
  for (const preset of catalog.presets) presetSelect.append(new Option(`${preset.title} — ${preset.description}`, preset.key));

  const groups = document.createElement('div');
  groups.className = 'access-groups';
  for (const groupName of [...new Set(catalog.permissions.map(permission => permission.group))]) {
    const group = document.createElement('fieldset');
    group.className = 'access-group';
    const legend = document.createElement('legend');
    legend.textContent = groupName;
    group.append(legend);
    for (const permission of catalog.permissions.filter(item => item.group === groupName)) {
      const label = document.createElement('label');
      label.className = 'access-item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = !can(me, permission.key);
      label.classList.toggle('locked', box.disabled);
      box.addEventListener('change', () => { settle(permission.key); showPreset(); });
      const note = document.createElement('span');
      note.className = 'access-note';
      note.textContent = permission.description;
      label.append(box, permission.title, note);
      group.append(label);
      boxes.set(permission.key, box);
    }
    groups.append(group);
  }

  function settle(changedKey) {
    const changed = boxes.get(changedKey);
    for (const permission of catalog.permissions) {
      if (changed.checked && permission.key === changedKey && permission.requires && !boxes.get(permission.requires).disabled)
        boxes.get(permission.requires).checked = true;
      if (!changed.checked && permission.requires === changedKey && !boxes.get(permission.key).disabled)
        boxes.get(permission.key).checked = false;
    }
  }

  function selected() {
    return catalog.permissions.filter(permission => boxes.get(permission.key).checked).map(permission => permission.key);
  }

  function showPreset() {
    const current = selected().join();
    presetSelect.value = catalog.presets.find(preset => preset.permissions.join() === current)?.key ?? '';
  }

  function apply(keys) {
    for (const [key, box] of boxes) if (!box.disabled) box.checked = keys.includes(key);
    for (const permission of catalog.permissions)
      if (boxes.get(permission.key).checked && permission.requires && !boxes.get(permission.requires).disabled)
        boxes.get(permission.requires).checked = true;
    showPreset();
  }

  presetSelect.addEventListener('change', () => {
    const preset = catalog.presets.find(item => item.key === presetSelect.value);
    if (preset) apply(preset.permissions);
  });

  if (withPresets) root.append(presetLabel);
  root.append(groups);
  host.replaceChildren(root);
  return {
    get: selected,
    set(keys) {
      for (const [key, box] of boxes) box.checked = keys.includes(key);
      showPreset();
    },
    apply,
  };
}

function userActions(user) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  if (user.isSelf) {
    actions.append(actionLink('My account', '/account.html'));
    return actions;
  }

  const isSuperAdmin = me.role === 'superadmin';
  if (user.role === 'superadmin' && !isSuperAdmin) return actions;

  const name = user.username;
  if (can(me, 'users.reset-credentials')) {
    actions.append(actionButton('Reset password', () => openPasswordDialog(user)));
    actions.append(actionButton('Reset 2FA', async () => {
      const result = await runAction(
        `Issue a new authenticator key for ${name}?`,
        () => panelRequest('POST', `users/${user.id}/two-factor`),
        `${name} has a new authenticator key.`);
      if (result) showTwoFactorSetup(name, result.twoFactor);
    }));
  }

  if (can(me, 'users.reset-credentials'))
    actions.append(actionButton('Disable 2FA', () => runAction(
      `Disable two-factor for ${name}?`, () => panelRequest('DELETE', `users/${user.id}/two-factor`), `${name} has no two-factor.`), true));

  if (can(me, 'users.edit-permissions') && user.role !== 'superadmin')
    actions.append(actionButton('Edit access', () => openAccessDialog(user)));

  if (isSuperAdmin) {
    const newRole = user.role === 'superadmin' ? 'admin' : 'superadmin';
    actions.append(actionButton(newRole === 'superadmin' ? 'Make super admin' : 'Make admin', () => runAction(
      `Change ${name} to ${ROLE_LABELS[newRole]}?`,
      () => panelRequest('POST', `users/${user.id}/role`, { role: newRole }),
      `${name} is now ${ROLE_LABELS[newRole]}.`)));
  }

  if (can(me, 'users.manage-state')) {
    if (user.state === 'locked' || user.failedAttempts > 0)
      actions.append(actionButton('Unlock', () => runAction(
        null, () => panelRequest('POST', `users/${user.id}/unlock`), `${name} is unlocked.`)));

    if (user.activeSessions > 0)
      actions.append(actionButton('Sign out everywhere', () => runAction(
        `End all sessions of ${name}?`,
        () => panelRequest('POST', `users/${user.id}/revoke-sessions`), `All sessions of ${name} ended.`)));

    if (user.state === 'disabled')
      actions.append(actionButton('Enable', () => runAction(
        null, () => panelRequest('POST', `users/${user.id}/enable`), `${name} is enabled.`)));
    else
      actions.append(actionButton('Disable', () => runAction(
        `Disable ${name}?`,
        () => panelRequest('POST', `users/${user.id}/disable`), `${name} is disabled.`), true));
  }

  if (can(me, 'users.delete'))
    actions.append(actionButton('Delete', () => runAction(
      `Delete the account ${name}?`,
      () => panelRequest('DELETE', `users/${user.id}`), `${name} is deleted.`), true));
  return actions;
}

function accessBadge(user) {
  if (user.role === 'superadmin') return badge('Every permission', 'main');
  const names = catalog.permissions.filter(permission => user.permissions.includes(permission.key)).map(permission => permission.title);
  const preset = catalog.presets.find(item => item.permissions.join() === user.permissions.join());
  const element = badge(preset ? preset.title : `${user.permissions.length} of ${catalog.permissions.length}`, user.permissions.length ? 'ok' : 'warn');
  element.title = names.length ? names.join('\n') : 'No permissions';
  return element;
}

function openAccessDialog(user) {
  accessTarget = user;
  accessError.textContent = '';
  document.getElementById('access-dialog-title').textContent = `Access of ${user.username}`;
  accessEditor = createAccessEditor(document.getElementById('access-editor'));
  accessEditor.set(user.permissions);
  accessDialog.showModal();
}

const USER_COLUMNS = [
  { key: 'username', title: 'Username', format: (value, user) => user.isSelf ? inline(value, badge('You', 'main')) : value },
  { key: 'role', title: 'Role', format: value => badge(ROLE_LABELS[value] ?? value, value === 'superadmin' ? 'main' : 'muted') },
  { key: 'permissions', title: 'Access', sortable: false, filterable: false, format: (_, user) => accessBadge(user) },
  { key: 'state', title: 'State', format: value => badge(...(STATE_BADGES[value] ?? [value, 'muted'])) },
  { key: 'failedAttempts', title: 'Failed sign-ins' },
  { key: 'activeSessions', title: 'Open sessions' },
  utcColumn('lastSignInAt', 'Last sign-in'),
  utcColumn('createdAt', 'Created'),
  { key: 'id', title: 'Actions', sortable: false, filterable: false, format: (_, user) => userActions(user) },
];

async function loadUsers() {
  const users = await panelRequest('GET', 'users');
  renderTable(document.getElementById('users'), USER_COLUMNS, users);
}

const AUDIT_COLUMNS = [
  utcColumn('occurredAt', 'Time'),
  { key: 'event', title: 'Event', format: value => badge(value.replaceAll('_', ' '), auditKind(value)) },
  { key: 'username', title: 'Account' },
  { key: 'detail', title: 'Detail' },
  { key: 'ipAddress', title: 'IP' },
  { key: 'userAgent', title: 'Client', format: value => value ? value.slice(0, 60) : '' },
];

function auditKind(event) {
  if (event.includes('failed') || event.includes('locked') || event.includes('deleted') || event.includes('disabled')) return 'danger';
  if (event.includes('succeeded')) return 'ok';
  return 'muted';
}

async function loadAudit() {
  const values = new FormData(auditForm);
  try {
    const entries = await panelRequest('GET', `audit${toQueryString({ username: values.get('username'), limit: values.get('limit') })}`);
    renderTable(document.getElementById('audit'), AUDIT_COLUMNS, entries);
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

function openPasswordDialog(user) {
  passwordTarget = user;
  passwordForm.reset();
  passwordError.textContent = '';
  document.getElementById('password-dialog-text').textContent = user.username;
  passwordDialog.showModal();
}

passwordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const password = passwordForm.elements.password.value;
  if (password !== passwordForm.elements.confirm.value) {
    passwordError.textContent = 'The passwords do not match.';
    return;
  }
  try {
    await panelRequest('POST', `users/${passwordTarget.id}/password`, { password });
    passwordDialog.close();
    showMessage(`${passwordTarget.username} has a new password.`, 'success');
    await loadUsers();
  } catch (error) {
    passwordError.textContent = error.message;
  }
});

document.getElementById('password-cancel').addEventListener('click', () => passwordDialog.close());
passwordDialog.addEventListener('close', () => passwordForm.reset());

const roleDialog = document.getElementById('role-dialog');
const roleForm = document.getElementById('role-form');
const roleError = document.getElementById('role-dialog-error');
let roleTarget = null;
let roleEditor = null;

async function loadCatalog() {
  catalog = await panelRequest('GET', 'permissions');
  createAccess = createAccessEditor(document.getElementById('create-access'));
  createAccess.apply(catalog.presets[0].permissions);
  renderRoles();
}

function renderRoles() {
  const columns = [
    { key: 'title', title: 'Role', format: (value, role) => role.isBuiltIn ? inline(value, badge('Built in', 'muted')) : value },
    { key: 'description', title: 'Description' },
    { key: 'permissions', title: 'Permissions', sortable: false, filterable: false, format: value => `${value.length} of ${catalog.permissions.length}` },
    {
      key: 'key', title: 'Actions', sortable: false, filterable: false, format: (_, role) => {
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(actionButton('Edit', () => openRoleDialog(role)));
        if (!role.isBuiltIn)
          actions.append(actionButton('Delete', () => runRoleAction(
            `Delete the role ${role.title}?`, () => panelRequest('DELETE', `roles/${role.key}`), `${role.title} is deleted.`), true));
        return actions;
      },
    },
  ];
  renderTable(document.getElementById('roles'), columns, catalog.presets);
}

async function runRoleAction(confirmText, action, doneText) {
  if (!await confirmAction({ title: confirmText, confirmText: 'Confirm', danger: true })) return;
  try {
    await action();
    showMessage(doneText, 'success');
    await loadCatalog();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

function openRoleDialog(role) {
  roleTarget = role;
  roleError.textContent = '';
  document.getElementById('role-dialog-title').textContent = role ? `Edit role ${role.title}` : 'New role';
  roleForm.elements.title.value = role?.title ?? '';
  roleForm.elements.description.value = role?.description ?? '';
  roleEditor = createAccessEditor(document.getElementById('role-editor'), false);
  roleEditor.set(role?.permissions ?? []);
  roleDialog.showModal();
}

roleForm.addEventListener('submit', async event => {
  event.preventDefault();
  const body = {
    title: roleForm.elements.title.value.trim(),
    description: roleForm.elements.description.value.trim(),
    permissions: roleEditor.get(),
  };
  try {
    if (roleTarget) await panelRequest('PUT', `roles/${roleTarget.key}`, body);
    else await panelRequest('POST', 'roles', body);
    roleDialog.close();
    showMessage(`The role ${body.title} is saved.`, 'success');
    await loadCatalog();
  } catch (error) {
    roleError.textContent = error.message;
  }
});

document.getElementById('role-add').addEventListener('click', () => openRoleDialog(null));
document.getElementById('role-cancel').addEventListener('click', () => roleDialog.close());

accessForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await panelRequest('POST', `users/${accessTarget.id}/permissions`, { permissions: accessEditor.get() });
    accessDialog.close();
    showMessage(`The access of ${accessTarget.username} is saved.`, 'success');
    await loadUsers();
  } catch (error) {
    accessError.textContent = error.message;
  }
});

document.getElementById('access-cancel').addEventListener('click', () => accessDialog.close());

document.getElementById('create-role').addEventListener('change', event => {
  document.getElementById('create-access').hidden = event.target.value !== 'admin';
});

createForm.addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(createForm);
  if (values.get('password') !== values.get('confirm')) {
    showMessage('The passwords do not match.', 'error');
    return;
  }
  const submit = createForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await panelRequest('POST', 'users', {
      username: values.get('username').trim(),
      password: values.get('password'),
      role: values.get('role'),
      permissions: values.get('role') === 'admin' ? createAccess.get() : undefined,
    });
    createForm.reset();
    createAccess.apply(catalog.presets[0].permissions);
    document.getElementById('create-access').hidden = false;
    showMessage(`Account ${result.username} created. Set up its authenticator now.`, 'success');
    showTwoFactorSetup(result.username, result.twoFactor);
    await loadUsers();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

document.getElementById('two-factor-copy').addEventListener('click', async () => {
  const key = document.getElementById('two-factor-key').textContent.replaceAll(' ', '');
  try {
    await navigator.clipboard.writeText(key);
    showMessage('Key copied.', 'success');
  } catch {
    showMessage('Copying is not available here; select the key and copy it.', 'error');
  }
});
document.getElementById('two-factor-close').addEventListener('click', hideTwoFactorSetup);

auditForm.addEventListener('submit', event => {
  event.preventDefault();
  loadAudit();
});

document.getElementById('tabs').addEventListener('click', event => {
  const tab = event.target.closest('button')?.dataset.tab;
  if (tab) showTab(tab);
});

renderMenu();
currentAccount().then(async account => {
  me = account;
  if (!can(me, 'users.view')) return;
  try {
    if (me.role !== 'superadmin') document.querySelector('#create-role option[value="superadmin"]').remove();
    else document.getElementById('roles-tab').hidden = false;
    await loadCatalog();
    showTab('accounts');
    await loadUsers();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});
