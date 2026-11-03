// Account page: the signed-in user's details and password change.

const ROLE_NAMES = { superadmin: 'Super admin', admin: 'Admin' };

const message = document.getElementById('message');
const form = document.getElementById('password-form');

function showMessage(text, kind = 'success') {
  toast(text, kind);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(form);
  if (values.get('newPassword') !== values.get('confirm')) {
    showMessage('The new passwords do not match.', 'error');
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await panelRequest('POST', 'account/password', {
      currentPassword: values.get('currentPassword'),
      newPassword: values.get('newPassword'),
    });
    const username = form.elements.username.value;
    form.reset();
    form.elements.username.value = username;
    showMessage('Password changed', 'success');
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

const twoFactorState = document.getElementById('two-factor-state');
const twoFactorStart = document.getElementById('two-factor-start');
const twoFactorSetup = document.getElementById('two-factor-setup');
const twoFactorForm = document.getElementById('two-factor-form');
let setupToken = null;

function showTwoFactorState(enabled) {
  twoFactorState.textContent = enabled ? 'Enabled' : 'Not set up';
  twoFactorStart.hidden = enabled;
  twoFactorSetup.hidden = true;
}

twoFactorStart.addEventListener('click', async () => {
  try {
    const result = await panelRequest('POST', 'account/two-factor/begin');
    setupToken = result.setupToken;
    document.getElementById('two-factor-qr').src = result.twoFactor.qrCode;
    document.getElementById('two-factor-key').textContent = result.twoFactor.key;
    twoFactorSetup.hidden = false;
    twoFactorStart.hidden = true;
    twoFactorForm.elements.code.focus();
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});

twoFactorForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await panelRequest('POST', 'account/two-factor/confirm', { setupToken, code: twoFactorForm.elements.code.value });
    twoFactorForm.reset();
    document.getElementById('two-factor-qr').removeAttribute('src');
    document.getElementById('two-factor-key').textContent = '';
    showTwoFactorState(true);
    showMessage('Two-factor enabled', 'success');
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  }
});

renderMenu();
currentAccount().then(me => {
  if (!me) return;
  showTwoFactorState(me.twoFactor);
  form.elements.username.value = me.username;
  renderSummary(document.getElementById('account'), [['Account', me.username], ['Role', ROLE_NAMES[me.role] ?? me.role],
    ['Access', me.role === 'superadmin' ? 'Every permission' : `${me.permissions.length} permissions`]]);
});
