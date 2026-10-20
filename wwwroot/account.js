// Account page: the signed-in user's details and password change.

const ROLE_NAMES = { superadmin: 'Super admin', admin: 'Admin' };

const message = document.getElementById('message');
const form = document.getElementById('password-form');

function showMessage(text, kind = '') {
  message.className = kind ? `message ${kind}` : 'message';
  message.textContent = text;
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
    showMessage('Your password is changed. Your other sessions have ended.', 'success');
  } catch (error) {
    if (error.message) showMessage(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

renderMenu();
currentAccount().then(me => {
  if (!me) return;
  form.elements.username.value = me.username;
  renderSummary(document.getElementById('account'), [['Account', me.username], ['Role', ROLE_NAMES[me.role] ?? me.role]]);
});
