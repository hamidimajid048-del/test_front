// Compare emails page: the logins of one email against the logins of one or more other emails (the users table of the
// service's MetaTrader backup). The groups are compared by the service through their IP and CID mappings (group-compare.js).

const form = document.getElementById('filters');
const message = document.getElementById('message');
const rangeControls = initRangeControls(form);
const compare = initGroupCompare({ form, message, sideTitle: 'Email', exportName: 'compare-emails' });

let request = 0;

const findLogins = email => apiGet('meta-trader-accounts/get-logins-by-email', { email });

async function search(values) {
  const current = ++request;
  rangeControls.sync();
  validateRange(values);
  const otherEmails = splitValues(values.otherEmail);
  if (otherEmails.length === 0) throw new ApiError('Enter at least one email to compare with', { otherEmail: ['Enter at least one email'] });
  if (otherEmails.some(email => email.toLowerCase() === values.email.toLowerCase()))
    throw new ApiError('Enter different emails', { otherEmail: ['Must differ from Email A'] });
  compare.clearResults();

  message.textContent = 'Finding the logins of the emails...';
  const [main, ...others] = await Promise.all([values.email, ...otherEmails].map(findLogins));
  if (current !== request) return;
  const otherName = otherEmails.length === 1 ? otherEmails[0] : `${otherEmails.length} emails`;
  compare.writeState(values);
  showRelatedPages({ email: values.email }, ...otherEmails.map(email => ({ email })));

  for (const [email, found] of [[values.email, main], ...otherEmails.map((email, index) => [email, others[index]])]) {
    if (!found.length) throw new ApiError(`No login was found for ${email}.`);
    if (found.length > GROUP_COMPARE_MAX_LOGINS)
      throw new ApiError(`${email} has ${found.length} logins; the comparison takes at most ${GROUP_COMPARE_MAX_LOGINS} per side.`);
  }
  const other = others.flat();
  if (other.length > GROUP_COMPARE_MAX_LOGINS)
    throw new ApiError(`The compared emails have ${other.length} logins together; the comparison takes at most ${GROUP_COMPARE_MAX_LOGINS} per side.`);
  const mainLogins = new Set(main.map(account => account.login));
  if (other.some(account => mainLogins.has(account.login)))
    throw new ApiError('A login belongs to both sides, so they cannot be compared.');

  await compare.run({
    sideNames: { main: values.email, other: otherName },
    accounts: { main, other },
    logins: main.map(account => account.login),
    otherLogins: other.map(account => account.login),
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
if (hasQuery && form.elements.email.value && form.elements.otherEmail.value) submit();
