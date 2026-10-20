// Users page: super admins add, change and remove panel accounts, and read the sign-in audit log.

const message = document.getElementById('message');
const createForm = document.getElementById('create-form');
const auditForm = document.getElementById('audit-form');
const setup = document.getElementById('two-factor-setup');
const passwordDialog = document.getElementById('password-dialog');
const passwordForm = document.getElementById('password-form');
const passwordError = document.getElementById('password-dialog-error');

const ROLE_LABELS = { superadmin: 'Super admin', admin: 'Admin' };
const STATE_BADGES = { active: ['Active', 'ok'], locked: ['Locked', 'warn'], disabled: ['Disabled', 'danger'] };

let passwordTarget = null;

function showMessage(text, kind = '') {
  message.className = kind ? `message ${kind}` : 'message';
  message.textContent = text;
}

function showTab(tab) {
  const current = tab === 'audit' ? 'audit' : 'accounts';
  for (const button of document.querySelectorAll('#tabs button'))
    button.classList.toggle('active', button.dataset.tab === current);
  for (const panel of document.querySelectorAll('[data-panel]'))
    panel.hidden = panel.dataset.panel !== current;
  if (current === 'audit') loadAudit();
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
  if (confirmText && !confirm(confirmText)) return;
  try {
    const result = await action();
    showMessage(doneText, 'success');
    await loadUsers();
    return result;
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
}

function userActions(user) {
  const actions = document.createElement('div');
  actions.className = 'actions';
  if (user.isSelf) {
    actions.append(actionLink('My account', '/account.html'));
    return actions;
  }

  const name = user.username;
  actions.append(actionButton('Reset password', () => openPasswordDialog(user)));
  actions.append(actionButton('Reset 2FA', async () => {
    const result = await runAction(
      `Issue a new authenticator key for ${name}? The current key stops working and ${name} is signed out.`,
      () => panelRequest('POST', `users/${user.id}/two-factor`),
      `${name} has a new authenticator key.`);
    if (result) showTwoFactorSetup(name, result.twoFactor);
  }));

  const newRole = user.role === 'superadmin' ? 'admin' : 'superadmin';
  actions.append(actionButton(newRole === 'superadmin' ? 'Make super admin' : 'Make admin', () => runAction(
    `Change ${name} to ${ROLE_LABELS[newRole]}? ${name} is signed out and signs in again with the new rights.`,
    () => panelRequest('POST', `users/${user.id}/role`, { role: newRole }),
    `${name} is now ${ROLE_LABELS[newRole]}.`)));

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
      `Disable ${name}? ${name} is signed out and cannot sign in until enabled again.`,
      () => panelRequest('POST', `users/${user.id}/disable`), `${name} is disabled.`), true));

  actions.append(actionButton('Delete', () => runAction(
    `Delete the account ${name}? This cannot be undone; its audit log entries stay.`,
    () => panelRequest('DELETE', `users/${user.id}`), `${name} is deleted.`), true));
  return actions;
}

const USER_COLUMNS = [
  { key: 'username', title: 'Username', format: (value, user) => user.isSelf ? inline(value, badge('You', 'main')) : value },
  { key: 'role', title: 'Role', format: value => badge(ROLE_LABELS[value] ?? value, value === 'superadmin' ? 'main' : 'muted') },
  { key: 'state', title: 'State', format: value => badge(...(STATE_BADGES[value] ?? [value, 'muted'])) },
  { key: 'failedAttempts', title: 'Failed sign-ins' },
  { key: 'activeSessions', title: 'Open sessions' },
  utcColumn('lastSignInAt', 'Last sign-in'),
  utcColumn('createdAt', 'Created'),
  { key: 'id', title: 'Actions', format: (_, user) => userActions(user) },
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
  document.getElementById('password-dialog-text').textContent =
    `${user.username} is signed out and signs in with the new password and the same authenticator app.`;
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
    });
    createForm.reset();
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
currentAccount().then(async me => {
  if (me?.role !== 'superadmin') {
    document.querySelector('main').replaceChildren(message);
    showMessage('Only a super admin can manage accounts.', 'error');
    return;
  }
  showTab('accounts');
  try {
    await loadUsers();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});
