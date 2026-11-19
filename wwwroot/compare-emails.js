// Compare emails page: the logins of one email against the logins of one or more other emails (the users table of the
// service's MetaTrader backup). The groups are compared by the service through their IP and CID mappings (group-compare.js);
// the page also measures every login of the emails B against all the logins of email A, so they can be told apart.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const rangeControls = initRangeControls(form);
const compare = initGroupCompare({ form, message, sideTitle: 'Email', exportName: 'compare-emails' });
const EVIDENCE_RANK = { Strong: 3, Medium: 2, Weak: 1, None: 0 };

let request = 0;

const findLogins = email => apiGet('meta-trader-accounts/get-logins-by-email', { email });

// The "⋯" menu of an email: the pages that take it.
function emailMenu(email, subject) {
  return rowMenu(`Actions for ${email}`, () => RELATED_EMAIL_PAGES.map(page => {
    const link = relatedLink(page, email, subject);
    hideUnlessAllowed(link, page.permission);
    return link;
  }));
}

function renderSides(email, otherEmails, main, other, groupOverview, rows) {
  const pending = rows === null;
  const count = predicate => (pending ? '…' : rows.filter(predicate).length);
  const sideA = compareSideCard({
    side: 'main',
    caption: 'Email A',
    title: email,
    avatar: 'mail',
    menu: emailMenu(email, { email: otherEmails[0] }),
    figures: [
      ['Logins', main.length, 'users'],
      ['Active', main.filter(account => account.source === 'Manager').length, 'check'],
      ['Archived', main.filter(account => account.source === 'Archive').length, 'history'],
      ['Sessions', groupOverview ? groupOverview.main.sessionCount.toLocaleString('en-US') : '…', 'layers'],
    ],
  });
  const sideB = compareSideCard({
    side: 'compared',
    caption: otherEmails.length === 1 ? 'Email B' : 'Emails B',
    title: otherEmails.length === 1 ? otherEmails[0] : `${otherEmails.length} emails`,
    avatar: 'mailCompare',
    menu: otherEmails.length === 1 ? emailMenu(otherEmails[0], { email }) : undefined,
    figures: [
      ['Logins', other.length, 'users'],
      ['Linked logins', count(row => row.evidence && row.evidence !== 'None'), 'link'],
      ['Active', other.filter(account => account.source === 'Manager').length, 'check'],
      ['Archived', other.filter(account => account.source === 'Archive').length, 'history'],
    ],
  });
  document.getElementById('accounts').replaceChildren(sideA, compareVersus(), sideB);
}

// ---- each login of B against all the logins of A ----

function perLoginRow(account, overview) {
  const row = { login: account.login, email: account.email, source: account.source };
  if (!overview) return { ...row, failed: true, rank: -1 };
  const { other, shared } = overview;
  return {
    ...row,
    evidence: shared.evidence,
    rank: EVIDENCE_RANK[shared.evidence] ?? 0,
    sharedIps: shared.ipCount,
    anonymizedIps: shared.anonymizedIpCount,
    sharedCids: shared.cidCount,
    invalidCids: shared.invalidCidCount,
    bothActive: Boolean(shared.activityOverlapStartUtc),
    sessions: other.sessionCount,
    firstLoginAt: other.firstLoginAt,
    lastLoginAt: other.lastLoginAt,
  };
}

function evidenceCell(evidence, row) {
  if (row.failed) return badge('Failed', 'muted');
  return badge(evidence, GROUP_COMPARE_EVIDENCE[evidence]?.kind ?? 'muted');
}

const perLoginColumns = subject => [
  { key: 'email', title: 'Email' },
  { key: 'login', title: 'Login' },
  { key: 'source', title: 'Status', format: source => GROUP_COMPARE_SOURCE_LABELS[source] ?? '—' },
  { key: 'evidence', title: 'Evidence', format: evidenceCell, sortValue: row => row.rank },
  { key: 'sharedIps', title: 'Shared IPs', format: countCell('danger') },
  { key: 'anonymizedIps', title: 'of them VPN/proxy', format: countCell('warn') },
  { key: 'sharedCids', title: 'Shared CIDs', format: countCell('danger') },
  { key: 'invalidCids', title: 'of them invalid', format: countCell('warn') },
  { key: 'bothActive', title: 'Active in the same period', format: (both, row) => (row.failed ? '—' : both ? badge('Yes', 'warn') : 'No') },
  { key: 'sessions', title: 'Sessions', format: value => value ?? '—' },
  seenColumn('firstLoginAt', 'lastLoginAt', 'First / last login'),
  loginActionsColumn('login', undefined, { subject, emailOf: row => row.email }),
];

function renderPerLoginFindings(rows) {
  const counted = rows.filter(row => !row.failed);
  const count = predicate => counted.filter(predicate).length;
  const findings = [
    [count(row => row.evidence === 'Strong'), value => `${value} logins of B with strong evidence`, 'danger'],
    [count(row => row.sharedIps > 0), value => `${value} logins of B share an IP`, 'danger'],
    [count(row => row.sharedCids > 0), value => `${value} logins of B share a CID`, 'danger'],
    [count(row => row.bothActive), value => `${value} logins of B active in the same period`, 'warn'],
  ];
  renderFindings(document.getElementById('findings'), findings.map(([value, text, tone]) => ({ tone: toneOf(value, tone), text: text(value) })));
}

// ---- search ----

async function search(values) {
  const current = ++request;
  const isStale = () => current !== request;
  rangeControls.sync();
  validateRange(values);
  const otherEmails = splitValues(values.otherEmail);
  if (otherEmails.length === 0) throw new ApiError('Enter at least one email to compare with', { otherEmail: ['Enter at least one email'] });
  if (otherEmails.some(email => email.toLowerCase() === values.email.toLowerCase()))
    throw new ApiError('Enter different emails', { otherEmail: ['Must differ from Email A'] });
  compare.clearResults();
  for (const id of ['accounts', 'findings', 'per-login']) document.getElementById(id).replaceChildren();

  message.textContent = 'Finding the logins of the emails...';
  const [main, ...others] = await Promise.all([values.email, ...otherEmails].map(findLogins));
  if (isStale()) return;
  const otherName = otherEmails.length === 1 ? otherEmails[0] : `${otherEmails.length} emails`;
  compare.writeState(values);

  for (const [email, found] of [[values.email, main], ...otherEmails.map((email, index) => [email, others[index]])]) {
    if (!found.length) throw new ApiError(`No login was found for ${email}.`);
    if (found.length > GROUP_COMPARE_MAX_LOGINS)
      throw new ApiError(`${email} has ${found.length} logins; the comparison takes at most ${GROUP_COMPARE_MAX_LOGINS} per side.`);
  }
  const other = others.flat();
  if (other.length > GROUP_COMPARE_MAX_LOGINS)
    throw new ApiError(`The compared emails have ${other.length} logins together; the comparison takes at most ${GROUP_COMPARE_MAX_LOGINS} per side.`);
  const mainLogins = main.map(account => account.login);
  if (other.some(account => mainLogins.includes(account.login)))
    throw new ApiError('A login belongs to both sides, so they cannot be compared.');

  const fromUtc = fromDayParam(values.fromUtc);
  const toUtc = toDayParam(values.toUtc);
  renderSides(values.email, otherEmails, main, other, null, null);
  document.getElementById('results').hidden = false;
  document.getElementById('per-login-title').textContent = `Each login of B (${other.length})`;

  const perLogin = compareEachLogin(other.map(account => account.login),
    login => apiGet('group-compare-reports/get-overview', { logins: mainLogins, otherLogins: [login], fromUtc, toUtc }), isStale);
  const groupOverview = await compare.run({
    sideNames: { main: values.email, other: otherName },
    accounts: { main, other },
    logins: mainLogins,
    otherLogins: other.map(account => account.login),
    fromUtc,
    toUtc,
  }, isStale);

  const results = await perLogin;
  if (isStale()) return;
  const rows = other
    .map(account => perLoginRow(account, results.get(account.login)))
    .sort((a, b) => b.rank - a.rank || (b.sharedCids ?? 0) - (a.sharedCids ?? 0) || (b.sharedIps ?? 0) - (a.sharedIps ?? 0));
  const subject = () => ({ email: values.email, fromUtc: values.fromUtc, toUtc: values.toUtc });
  renderSides(values.email, otherEmails, main, other, groupOverview, rows);
  renderTable(document.getElementById('per-login'), perLoginColumns(subject), rows, undefined, { export: { name: 'compare-emails-each' } });
  renderPerLoginFindings(rows);
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
