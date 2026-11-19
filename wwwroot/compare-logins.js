// Compare with logins page: one main login against one or more compared logins. The service compares the compared
// logins as one group (group-compare.js: evidence, linked pairs, shared IPs and CIDs, sessions); the page also measures
// every compared login against the main one like the Compare accounts page does, so the logins can be told apart.

const form = document.getElementById('filters');
const message = document.getElementById('message');
const rangeControls = initRangeControls(form);
const compare = initGroupCompare({ form, message, sideTitle: 'Side', exportName: 'compare-logins' });
const PER_LOGIN_PARALLELISM = 4;
const SIGNAL_COUNT = 6;

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

// ---- each compared login against the main one (compare-reports, as on the Compare accounts page) ----

const sameEmail = (a, b) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

function perLoginRow(otherLogin, overview, account, mainEmail) {
  if (!overview) return { login: otherLogin, email: account?.email ?? null, source: account?.source, failed: true, signals: -1 };
  const [, other] = overview.accounts;
  const { shared } = overview;
  const row = {
    login: otherLogin,
    email: other.email || account?.email || null,
    source: account?.source,
    sessions: other.sessionCount,
    activeDays: other.activeDays,
    firstLoginAt: other.firstLoginAt,
    lastLoginAt: other.lastLoginAt,
    sameEmail: sameEmail(mainEmail, other.email || account?.email),
    sharedIps: shared.ipCount,
    sharedCids: shared.cidCount,
    commonDays: shared.coOccurrenceDays,
    nearLogins: shared.nearLoginPairCount,
    overlapping: shared.overlappingSessionCount,
  };
  row.signals = [row.sameEmail, row.sharedIps, row.sharedCids, row.commonDays, row.nearLogins, row.overlapping].filter(Boolean).length;
  return row;
}

const countCell = tone => value => (value === undefined ? '—' : value > 0 ? badge(String(value), tone) : '0');

function signalsCell(signals, row) {
  if (row.failed) return badge('Failed', 'muted');
  return badge(`${signals} of ${SIGNAL_COUNT}`, signals >= 3 ? 'danger' : signals > 0 ? 'warn' : 'ok');
}

function perLoginColumns(subject) {
  return [
    { key: 'login', title: 'Login' },
    {
      key: 'email', title: 'Email',
      format: (email, row) => (row.sameEmail ? inline(email, badge('Same email', 'danger')) : email || '—'),
    },
    { key: 'source', title: 'Status', format: source => GROUP_COMPARE_SOURCE_LABELS[source] ?? '—' },
    { key: 'signals', title: 'Signals', format: signalsCell, help: 'How many of the six checks are found: same email, shared IP, shared CID, shared active day, near login, overlapping session.' },
    { key: 'sharedIps', title: 'Shared IPs', format: countCell('danger') },
    { key: 'sharedCids', title: 'Shared CIDs', format: countCell('danger') },
    { key: 'commonDays', title: 'Common active days', format: countCell('warn') },
    { key: 'nearLogins', title: 'Near logins', format: countCell('danger') },
    { key: 'overlapping', title: 'Overlapping sessions', format: countCell('warn') },
    { key: 'sessions', title: 'Sessions', format: value => value ?? '—' },
    { key: 'activeDays', title: 'Active days', format: value => value ?? '—' },
    seenColumn('firstLoginAt', 'lastLoginAt', 'First / last login'),
    loginActionsColumn('login', undefined, { subject, emailOf: row => row.email }),
  ];
}

// Compares every compared login with the main one, a few at a time, telling the progress; a failed login gets an empty row.
async function comparePerLogin(params, otherLogins, isStale) {
  const progress = document.getElementById('per-login-message');
  const results = new Map();
  const queue = [...otherLogins];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const otherLogin = queue.shift();
      try {
        results.set(otherLogin, await apiGet('compare-reports/get-overview', { ...params, otherLogin }));
      } catch {
        results.set(otherLogin, null);
      }
      done++;
      if (!isStale()) progress.textContent = `Comparing each login: ${done} of ${otherLogins.length}`;
    }
  };
  progress.className = 'message';
  progress.textContent = `Comparing each login: 0 of ${otherLogins.length}`;
  await Promise.all(Array.from({ length: Math.min(PER_LOGIN_PARALLELISM, otherLogins.length) }, worker));
  if (!isStale()) progress.textContent = '';
  return results;
}

// ---- cards and findings ----

function renderSides(login, mainAccount, mainOverviewAccount, otherLogins, rows) {
  const mainEmail = mainOverviewAccount?.email || mainAccount?.email;
  const pending = rows === null;
  const count = predicate => (pending ? '…' : rows.filter(predicate).length);
  const main = compareSideCard({
    side: 'main',
    caption: 'Main Account',
    title: login,
    email: mainEmail ?? '',
    menu: relatedLoginActions(login, [], { emailOf: () => mainEmail }),
    figures: mainOverviewAccount ? accountFigures(mainOverviewAccount) : accountFigures({}).map(([label, , iconName]) => [label, '…', iconName]),
  });
  const group = compareSideCard({
    side: 'compared',
    caption: 'Compared logins',
    title: `${otherLogins.length} logins`,
    avatar: 'users',
    figures: [
      ['Linked logins', count(row => row.sharedIps > 0 || row.sharedCids > 0), 'link'],
      ['Same email', count(row => row.sameEmail), 'mail'],
      ['Active', count(row => row.source === 'Manager'), 'check'],
      ['Archived', count(row => row.source === 'Archive'), 'history'],
    ],
  });
  document.getElementById('accounts').replaceChildren(main, compareVersus(), group);
}

const selectTab = tab => document.querySelector(`#tabs [data-tab="${tab}"]`)?.click();

function renderGroupSignals(shared) {
  renderSignalTiles(document.getElementById('signals'), [
    { count: shared.ipCount, text: 'Shared IPs', tab: 'ips', icon: 'mapPin' },
    { count: shared.anonymizedIpCount, text: 'VPN / proxy IPs', tab: 'ips', icon: 'shield' },
    { count: shared.cidCount, text: 'Shared CIDs', tab: 'cids', icon: 'fingerprint' },
    { count: shared.invalidCidCount, text: 'Invalid CIDs', tab: 'cids', icon: 'alert' },
    { count: shared.linkedLoginPairCount, text: 'Linked pairs', tab: 'pairs', icon: 'link' },
  ], selectTab);
}

function renderPerLoginFindings(rows) {
  const counted = rows.filter(row => !row.failed);
  const count = predicate => counted.filter(predicate).length;
  const findings = [
    [count(row => row.sameEmail), value => `${value} logins with the same email`, 'danger'],
    [count(row => row.sharedIps > 0), value => `${value} logins share an IP`, 'danger'],
    [count(row => row.sharedCids > 0), value => `${value} logins share a CID`, 'danger'],
    [count(row => row.nearLogins > 0), value => `${value} logins with near logins`, 'danger'],
    [count(row => row.commonDays > 0), value => `${value} logins active on the same days`, 'warn'],
    [count(row => row.overlapping > 0), value => `${value} logins with overlapping sessions`, 'warn'],
  ];
  renderFindings(document.getElementById('findings'), findings.map(([value, text, tone]) => ({ tone: toneOf(value, tone), text: text(value) })));
}

// ---- search ----

async function search(values) {
  const current = ++request;
  const isStale = () => current !== request;
  rangeControls.sync();
  validateRange(values);
  const login = Number(values.login);
  const otherLogins = parseLogins(values.otherLogins);
  if (otherLogins.length === 0) throw new ApiError('Enter at least one login to compare with', { otherLogins: ['Enter at least one login'] });
  if (otherLogins.includes(login)) throw new ApiError('Enter different logins', { otherLogins: ['Must differ from the main login'] });
  if (otherLogins.length > GROUP_COMPARE_MAX_LOGINS)
    throw new ApiError(`The comparison takes at most ${GROUP_COMPARE_MAX_LOGINS} compared logins`, { otherLogins: [`At most ${GROUP_COMPARE_MAX_LOGINS} logins`] });
  compare.clearResults();
  for (const id of ['accounts', 'signals', 'findings', 'per-login']) document.getElementById(id).replaceChildren();
  compare.writeState({ ...values, otherLogins: otherLogins.join(',') });

  message.textContent = 'Finding the accounts...';
  const accounts = await findAccounts(login, otherLogins);
  if (isStale()) return;

  const fromUtc = fromDayParam(values.fromUtc);
  const toUtc = toDayParam(values.toUtc);
  const subject = () => ({ login, email: accounts.main[0]?.email, fromUtc: values.fromUtc, toUtc: values.toUtc });
  renderSides(login, accounts.main[0], null, otherLogins, null);
  document.getElementById('results').hidden = false;
  document.getElementById('per-login-title').textContent = `Each compared login (${otherLogins.length})`;

  const perLogin = comparePerLogin(
    { login, fromUtc, toUtc, windowSeconds: Number(values.windowPreset ?? 300), matchLevel: values.match ?? 'Ip' },
    otherLogins, isStale);
  const overview = await compare.run({
    sideNames: { main: String(login), other: otherLogins.length === 1 ? String(otherLogins[0]) : `${otherLogins.length} logins` },
    accounts,
    logins: [login],
    otherLogins,
    fromUtc,
    toUtc,
  }, isStale);
  if (overview) renderGroupSignals(overview.shared);

  const results = await perLogin;
  if (isStale()) return;
  const mainOverviewAccount = [...results.values()].find(Boolean)?.accounts[0];
  const mainEmail = mainOverviewAccount?.email || accounts.main[0]?.email;
  const byLogin = new Map(accounts.other.map(account => [account.login, account]));
  const rows = otherLogins
    .map(otherLogin => perLoginRow(otherLogin, results.get(otherLogin), byLogin.get(otherLogin), mainEmail))
    .sort((a, b) => b.signals - a.signals || (b.sharedCids ?? 0) - (a.sharedCids ?? 0) || (b.sharedIps ?? 0) - (a.sharedIps ?? 0));
  renderSides(login, accounts.main[0], mainOverviewAccount, otherLogins, rows);
  renderTable(document.getElementById('per-login'), perLoginColumns(subject), rows, undefined, { export: { name: 'compare-logins-each' } });
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
if (hasQuery && form.elements.login.value && form.elements.otherLogins.value) submit();
