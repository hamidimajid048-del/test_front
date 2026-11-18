// Links from a searched login or email to the other pages that take it, so it does not have to be typed again.
// A page calls showRelatedPages with what it searched; the email of a login is read from the user directory.

const RELATED_LOGIN_PAGES = [
  { title: 'Account data', permission: 'account-data.view', path: '/account-data.html', query: login => ({ login }) },
  { title: 'Login history', permission: 'logins.view', path: '/logins.html', query: login => ({ login }) },
  { title: 'IP/CID similarity', permission: 'similarity.view', path: '/similarity.html', query: login => ({ login }) },
  {
    title: 'Copy trade', permission: 'copy-trade.view', path: '/copy-trade.html',
    query: login => ({ kind: 'copy-trade', login, secondsBefore: 5, secondsAfter: 5, minCountShare: 1 }),
  },
  {
    title: 'Hedge', permission: 'copy-trade.view', path: '/copy-trade.html',
    query: login => ({ kind: 'hedge', login, secondsBefore: 5, secondsAfter: 5, minCountShare: 1, volumeTolerancePercent: 10 }),
  },
  { title: 'Compare accounts', permission: 'compare.view', path: '/compare.html', query: login => ({ login }) },
];

const RELATED_EMAIL_PAGES = [
  { title: 'Email logins', permission: 'email-logins.view', path: '/email-logins.html', query: email => ({ email }) },
  { title: 'Compare emails', permission: 'compare-emails.view', path: '/compare-emails.html', query: email => ({ email }) },
];

const relatedEmails = new Map();
let relatedRequest = 0;

function relatedLink(page, value) {
  return actionLink(page.title, page.path + toQueryString(page.query(value)));
}

function relatedLinks(pages, value, me) {
  return pages.filter(page => page.path !== location.pathname && can(me, page.permission)).map(page => relatedLink(page, value));
}

function emailOfLogin(login) {
  const key = String(login);
  if (!relatedEmails.has(key))
    relatedEmails.set(key, panelRequest('GET', `mt5/accounts${toQueryString({ logins: key })}`)
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

// A row's "⋯" menu: the row's own actions first, then the pages that take its login(s), opened in a new browser tab.
// With several logins (a pair row), each page item names its login.
function relatedLoginActions(logins, actions = []) {
  const list = [logins].flat();
  const many = list.length > 1;
  return rowMenu(`Actions for login ${list.join(' / ')}`, [...actions, ...list.flatMap(login => RELATED_LOGIN_PAGES.map(page => {
    const link = relatedLink(page, login);
    if (many) link.textContent = `${page.title} — ${login}`;
    hideUnlessAllowed(link, page.permission);
    return link;
  }))]);
}

// An "Actions" column at the end of a table: the "⋯" menu of the row's login(s), with the row's own actions when given.
const loginActionsColumn = (keys, actions) => ({
  key: [keys].flat()[0], title: 'Actions', sortable: false, filterable: false, noExport: true,
  format: (_, row) => relatedLoginActions([keys].flat().map(key => row[key]), actions?.(row) ?? []),
});
