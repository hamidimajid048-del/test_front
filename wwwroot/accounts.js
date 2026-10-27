// Name, group, email and balance of logins, read from MetaTrader in a second request after a table is shown; the
// cells show a placeholder until it answers.

const NO_VALUE = '—';

function createAccountDirectory(messageElement) {
  let accounts = new Map();
  let pending = [];
  let emailCells = [];
  let failed = false;
  let request = 0;

  function text(account, field) {
    if (account.source === 'NotFound') return field === 'name' ? 'Not found' : NO_VALUE;
    const value = account[field];
    if (value === null || value === undefined || value === '') return NO_VALUE;
    if (field === 'balance') return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return field === 'name' && account.source === 'Archive' ? `${value} (deleted)` : value;
  }

  function cell(login, field) {
    const element = document.createElement('span');
    if (field === 'email') emailCells.push({ cell: element, login });
    const account = accounts.get(login);
    if (account) {
      element.textContent = text(account, field);
    } else {
      element.textContent = failed ? NO_VALUE : '…';
      pending.push({ cell: element, login, field });
    }
    return element;
  }

  return {
    reset() {
      request++;
      accounts = new Map();
      pending = [];
      emailCells = [];
      failed = false;
      messageElement.textContent = '';
    },

    column: (title, field, loginKey) =>
      ({ key: loginKey, title, sortable: false, filterable: false, format: (_, row) => cell(row[loginKey], field) }),

    get: login => accounts.get(login),

    emailCells: () => emailCells,

    async load(logins) {
      const current = ++request;
      const unique = [...new Set(logins)];
      if (!unique.length) return;
      try {
        const found = await panelRequest('GET', `mt5/accounts?logins=${unique.join(',')}`);
        if (current !== request) return;
        accounts = new Map(found.map(account => [account.login, account]));
        if (found.some(account => account.source === 'Unavailable'))
          messageElement.textContent = 'Deleted accounts could not be read from the MetaTrader archive.';
      } catch (error) {
        if (current !== request) return;
        failed = true;
        messageElement.textContent = `Account details are unavailable: ${error.message || UNAVAILABLE_MESSAGE}`;
      }
      for (const { cell: element, login, field } of pending) {
        const account = accounts.get(login);
        element.textContent = account ? text(account, field) : NO_VALUE;
      }
      pending = [];
    },
  };
}

// A button that hides the rows whose email equals the email of the main login, keeping the rows with an unknown email.
// The main login is read together with the table's logins, so one request fills the columns and the comparison.
function createSameEmailToggle(directory, button, messageElement, mainLogin) {
  let hideSame = false;
  const emailOf = login => (directory.get(login)?.email ?? '').trim().toLowerCase();

  function apply() {
    const mainEmail = emailOf(mainLogin());
    for (const { cell, login } of directory.emailCells()) {
      const row = cell.closest('tr');
      if (row) row.hidden = hideSame && mainEmail !== '' && emailOf(login) === mainEmail;
    }
  }

  button.addEventListener('click', () => {
    hideSame = !hideSame;
    button.setAttribute('aria-pressed', String(hideSame));
    apply();
  });

  return {
    reset() {
      button.disabled = true;
    },

    async load(logins) {
      if (!logins.length) return;
      await directory.load([mainLogin(), ...logins]);
      const known = emailOf(mainLogin()) !== '';
      button.disabled = !known;
      if (!known) messageElement.textContent ||= `The email of login ${mainLogin()} is unknown, so rows cannot be compared.`;
      apply();
    },
  };
}
