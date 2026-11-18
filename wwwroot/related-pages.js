// Links from a searched login or email to the other pages that take it, so it does not have to be typed again.
// A page calls showRelatedPages with what it searched; the email of a login is read from the user directory.
// query(value, subject) builds a page's parameters; subject is what the page searched ({ login, email, fromUtc, toUtc }),
// so a compare link from a row carries both sides and the same day range.

const subjectRange = subject => (subject?.fromUtc && subject?.toUtc ? { range: 'custom', fromUtc: subject.fromUtc, toUtc: subject.toUtc } : {});
const otherLogin = (login, subject) => subject?.login && Number(subject.login) !== Number(login);
const otherEmail = (email, subject) => subject?.email && subject.email.toLowerCase() !== email.toLowerCase();

const RELATED_LOGIN_PAGES = [
  { title: 'Account data', icon: 'database', permission: 'account-data.view', path: '/account-data.html', query: login => ({ login }) },
  { title: 'Login history', icon: 'user', permission: 'logins.view', path: '/logins.html', query: login => ({ login }) },
  { title: 'IP/CID similarity', icon: 'fingerprint', permission: 'similarity.view', path: '/similarity.html', query: login => ({ login }) },
  {
    title: 'Copy trade', icon: 'swap', permission: 'copy-trade.view', path: '/copy-trade.html',
    query: login => ({ kind: 'copy-trade', login, secondsBefore: 5, secondsAfter: 5, minCountShare: 1 }),
  },
  {
    title: 'Hedge', icon: 'shield', permission: 'copy-trade.view', path: '/copy-trade.html',
    query: login => ({ kind: 'hedge', login, secondsBefore: 5, secondsAfter: 5, minCountShare: 1, volumeTolerancePercent: 10 }),
  },
  {
    title: 'Compare accounts', icon: 'layers', permission: 'compare.view', path: '/compare.html',
    query: (login, subject) => (otherLogin(login, subject) ? { login: subject.login, other: login, ...subjectRange(subject) } : { login }),
  },
  {
    title: 'Compare with logins', icon: 'users', permission: 'compare.view', path: '/compare-logins.html',
    query: (login, subject) => (otherLogin(login, subject) ? { login: subject.login, otherLogins: login, ...subjectRange(subject) } : { login }),
  },
];

const RELATED_EMAIL_PAGES = [
  { title: 'Email logins', icon: 'mailPlus', permission: 'email-logins.view', path: '/email-logins.html', query: email => ({ email }) },
  {
    title: 'Compare emails', icon: 'mail', permission: 'compare-emails.view', path: '/compare-emails.html',
    query: (email, subject) => (otherEmail(email, subject) ? { email: subject.email, otherEmail: email, ...subjectRange(subject) } : { email }),
  },
];

const relatedEmails = new Map();
let relatedRequest = 0;

function relatedLink(page, value, subject) {
  return actionLink(page.title, page.path + toQueryString(page.query(value, subject)));
}

function relatedLinks(pages, value, me) {
  return pages.filter(page => page.path !== location.pathname && can(me, page.permission)).map(page => {
    const link = relatedLink(page, value);
    link.prepend(icon(page.icon));
    return link;
  });
}

function emailOfLogin(login) {
  const key = String(login);
  if (!relatedEmails.has(key))
    relatedEmails.set(key, apiGet('meta-trader-accounts/get-accounts', { logins: [key] })
      .then(accounts => accounts[0]?.email || null)
      .catch(() => null));
  return relatedEmails.get(key);
}

function relatedGroup(label, links) {
  const group = document.createElement('div');
  group.className = 'related-group';
  const title = document.createElement('span');
  title.className = 'related-label';
  title.textContent = label;
  group.append(title, ...links);
  return group;
}

function appendEmailLinks(group, email, me) {
  const links = relatedLinks(RELATED_EMAIL_PAGES, email, me);
  if (!links.length) return;
  const title = document.createElement('span');
  title.className = 'related-label';
  title.textContent = `Email ${email}`;
  group.append(title, ...links);
}

// Each subject is { login, email } (email optional; it is looked up when missing) or { email }.
async function showRelatedPages(...subjects) {
  const container = document.getElementById('related-pages');
  const current = ++relatedRequest;
  container.replaceChildren();
  const me = await currentAccount();
  if (current !== relatedRequest) return;

  for (const { login, email } of subjects) {
    if (login) {
      const group = relatedGroup(`Login ${login}`, relatedLinks(RELATED_LOGIN_PAGES, login, me));
      container.append(group);
      const known = email || await emailOfLogin(login);
      if (current !== relatedRequest) return;
      if (known) appendEmailLinks(group, known, me);
      if (group.childElementCount === 1) group.remove();
    } else if (email) {
      const links = relatedLinks(RELATED_EMAIL_PAGES, email, me);
      if (links.length) container.append(relatedGroup(`Email ${email}`, links));
    }
  }
}

function clearRelatedPages() {
  relatedRequest++;
  document.getElementById('related-pages').replaceChildren();
}

// An in-page action for a row's "⋯" menu; picking it closes the menu.
function menuAction(text, onClick) {
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = text;
  link.addEventListener('click', event => {
    event.preventDefault();
    onClick();
  });
  return link;
}

// A row's "⋯" menu: the row's own actions first, then the pages that take its login(s), opened in a new browser tab,
// then the pages that take its email when it is known. With several logins (a pair row), each page item names its login.
// subject is what the page searched, so the compare pages get both sides; emailOf gives the row's email.
function relatedLoginActions(logins, actions = [], { subject, emailOf } = {}) {
  const list = [logins].flat();
  const many = list.length > 1;
  const allowedLink = (page, value, current) => {
    const link = relatedLink(page, value, current);
    hideUnlessAllowed(link, page.permission);
    return link;
  };
  const items = () => {
    const current = subject?.();
    const email = emailOf?.();
    return [
      ...actions,
      ...list.flatMap(login => RELATED_LOGIN_PAGES.map(page => {
        const link = allowedLink(page, login, current);
        if (many) link.textContent = `${page.title} — ${login}`;
        return link;
      })),
      ...(email ? RELATED_EMAIL_PAGES.map(page => allowedLink(page, email, current)) : []),
    ];
  };
  return rowMenu(`Actions for login ${list.join(' / ')}`, items);
}

// An "Actions" column at the end of a table: the "⋯" menu of the row's login(s), with the row's own actions when given.
// options.subject() is what the page searched ({ login, email, fromUtc, toUtc }); options.emailOf(row) is the row's email.
const loginActionsColumn = (keys, actions, options = {}) => ({
  key: [keys].flat()[0], title: 'Actions', sortable: false, filterable: false, noExport: true,
  format: (_, row) => relatedLoginActions([keys].flat().map(key => row[key]), actions?.(row) ?? [], {
    subject: options.subject,
    emailOf: options.emailOf ? () => options.emailOf(row) : undefined,
  }),
});
