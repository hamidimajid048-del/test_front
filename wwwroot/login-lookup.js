// Adds a "find" button beside every login field: a dialog finds the account of a position, order or deal number
// (/panel-api/mt5/account-data/find-login), puts it in the field and runs the search.

const LOGIN_LOOKUP_KINDS = [['position', 'Position'], ['order', 'Order'], ['deal', 'Deal']];

function createLoginLookupDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'panel-dialog login-lookup-dialog';
  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('h3');
  heading.textContent = 'Find the account';
  const text = document.createElement('p');
  text.textContent = 'Find the account of a position, order or deal number.';

  const kindLabel = document.createElement('label');
  kindLabel.textContent = 'Search by ';
  const kind = document.createElement('select');
  kind.name = 'kind';
  for (const [value, title] of LOGIN_LOOKUP_KINDS) kind.add(new Option(title, value));
  kindLabel.append(kind);

  const ticketLabel = document.createElement('label');
  ticketLabel.textContent = 'Number ';
  const ticket = document.createElement('input');
  ticket.name = 'ticket';
  ticket.type = 'text';
  ticket.inputMode = 'numeric';
  ticket.dataset.numeric = 'integer';
  ticket.autocomplete = 'off';
  ticket.required = true;
  ticketLabel.append(ticket);

  const error = document.createElement('p');
  error.className = 'message error';
  const buttons = document.createElement('div');
  buttons.className = 'dialog-buttons';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const find = document.createElement('button');
  find.type = 'submit';
  find.textContent = 'Find';
  buttons.append(cancel, find);

  form.append(heading, text, kindLabel, ticketLabel, error, buttons);
  dialog.append(form);
  document.body.append(dialog);
  return { dialog, form, kind, ticket, error, cancel, find };
}

function attachLoginLookup(input) {
  const parts = createLoginLookupDialog();
  const row = document.createElement('div');
  row.className = 'login-lookup-field';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'login-lookup-button';
  open.textContent = '⋯';
  open.title = 'Find the account by a position, order or deal number';
  open.setAttribute('aria-label', open.title);
  input.replaceWith(row);
  row.append(input, open);
  hideUnlessAllowed(open, 'account-data.view');

  open.addEventListener('click', () => {
    parts.error.textContent = '';
    parts.ticket.value = '';
    parts.dialog.showModal();
    parts.ticket.focus();
  });
  parts.cancel.addEventListener('click', () => parts.dialog.close());

  parts.form.addEventListener('submit', async event => {
    event.preventDefault();
    const kind = parts.kind.value;
    const ticket = parts.ticket.value.trim();
    parts.error.textContent = '';
    parts.find.disabled = true;
    try {
      const found = await panelRequest('GET', `mt5/account-data/find-login${toQueryString({ kind, ticket })}`);
      parts.dialog.close();
      input.value = String(found.login);
      const host = input.form;
      if (kind === 'position' && host?.elements.position) host.elements.position.value = ticket;
      host?.requestSubmit();
    } catch (error) {
      parts.error.textContent = error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE;
    } finally {
      parts.find.disabled = false;
    }
  });
}

for (const input of document.querySelectorAll('form.filters input[name="login"]')) attachLoginLookup(input);
