// A "search by" dropdown in front of every login field: Login (the default), Position, Order or Deal. For a position,
// order or deal number the account is found first (/panel-api/mt5/account-data/find-login), put in the field, and the
// page's own search runs with it.

const LOGIN_LOOKUP_KINDS = [['login', 'Login'], ['position', 'Position'], ['order', 'Order'], ['deal', 'Deal']];

function attachLoginLookup(input) {
  const form = input.form;
  const kind = document.createElement('select');
  kind.className = 'login-lookup-kind';
  kind.setAttribute('aria-label', 'Search by');
  for (const [value, title] of LOGIN_LOOKUP_KINDS) kind.add(new Option(title, value));
  hideUnlessAllowed(kind, 'account-data.view');

  const row = document.createElement('div');
  row.className = 'login-lookup-field';
  input.replaceWith(row);
  row.append(kind, input);

  form.addEventListener('submit', async event => {
    if (kind.value === 'login') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const message = document.getElementById('message');
    const ticket = input.value.trim();
    clearMessages(form, message);
    try {
      const found = await panelRequest('GET', `mt5/account-data/find-login${toQueryString({ kind: kind.value, ticket })}`);
      if (kind.value === 'position' && form.elements.position) form.elements.position.value = ticket;
      input.value = String(found.login);
      kind.value = 'login';
      form.requestSubmit();
    } catch (error) {
      showError(form, message, error instanceof ApiError && error.message ? error : new ApiError(UNAVAILABLE_MESSAGE));
    }
  }, true);
}

for (const input of document.querySelectorAll('form.filters input[name="login"]')) attachLoginLookup(input);
