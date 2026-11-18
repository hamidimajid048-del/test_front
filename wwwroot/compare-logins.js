// Compare with logins page: one main login against one or more compared logins, compared by the service through their
// IP and CID mappings (group-compare.js). The Logins tab shows the accounts as the MetaTrader backup knows them.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const rangeControls = initRangeControls(form);
const compare = initGroupCompare({ form, message, sideTitle: 'Side', exportName: 'compare-logins' });

let request = 0;

function parseLogins(text) {
  const values = splitValues(text);
  const invalid = values.filter(value => !/^[1-9]\d*$/.test(value));
  if (invalid.length)
    throw new ApiError('Compared logins must be whole numbers', { otherLogins: [`Not a login: ${invalid.slice(0, 3).join(', ')}`] });
  return values.map(Number);
}

const ACCOUNTS_HINT = "The account details come from the MetaTrader backup; a login missing there is still compared. The buttons open that login's own report in a new browser tab.";
const ACCOUNTS_UNAVAILABLE_HINT = 'The account details are unavailable right now; the comparison still runs.';

// The accounts of the backup, split by side; a lookup failure leaves the Logins tab empty and does not stop the comparison.
async function findAccounts(login, otherLogins) {
  const hint = document.getElementById('accounts-hint');
  try {
    const accounts = await apiGet('meta-trader-accounts/get-accounts', { logins: [login, ...otherLogins] });
    hint.textContent = ACCOUNTS_HINT;
    return { main: accounts.filter(account => account.login === login), other: accounts.filter(account => account.login !== login) };
  } catch {
    hint.textContent = ACCOUNTS_UNAVAILABLE_HINT;
    return { main: [], other: [] };
  }
}

async function search(values) {
  const current = ++request;
  rangeControls.sync();
  validateRange(values);
  const login = Number(values.login);
  const otherLogins = parseLogins(values.otherLogins);
  if (otherLogins.length === 0) throw new ApiError('Enter at least one login to compare with', { otherLogins: ['Enter at least one login'] });
  if (otherLogins.includes(login)) throw new ApiError('Enter different logins', { otherLogins: ['Must differ from the main login'] });
  if (otherLogins.length > GROUP_COMPARE_MAX_LOGINS)
    throw new ApiError(`The comparison takes at most ${GROUP_COMPARE_MAX_LOGINS} compared logins`, { otherLogins: [`At most ${GROUP_COMPARE_MAX_LOGINS} logins`] });
  compare.clearResults();
  compare.writeState({ ...values, otherLogins: otherLogins.join(',') });
  showRelatedPages({ login });

  message.textContent = 'Finding the accounts...';
  const accounts = await findAccounts(login, otherLogins);
  if (current !== request) return;

  await compare.run({
    sideNames: { main: String(login), other: otherLogins.length === 1 ? String(otherLogins[0]) : `${otherLogins.length} logins` },
    accounts,
    logins: [login],
    otherLogins,
    fromUtc: fromDayParam(values.fromUtc),
    toUtc: toDayParam(values.toUtc),
  }, () => current !== request);
}

async function submit() {
  const values = formValues(form);
  const submitButton = form.querySelector('button[type="submit"]');
  clearMessages(form, message);
  submitButton.disabled = true;
  try {
    await search(values);
  } catch (error) {
    showError(form, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  submit();
});

renderMenu();
const hasQuery = fillFormFromQuery(form);
rangeControls.restore();
if (hasQuery && form.elements.login.value && form.elements.otherLogins.value) submit();
