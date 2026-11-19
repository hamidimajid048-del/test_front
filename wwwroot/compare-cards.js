// The parts of the compare pages (Compare accounts, Compare with logins): the side cards with their figures, the
// signal tiles that open a tab, and the verdicts of the findings.

// "Name (n), Name (n) +2 more"
function topList(counts, limit = 4) {
  if (!counts?.length) return '—';
  const shown = counts.slice(0, limit).map(count => `${count.name} (${count.count})`).join(', ');
  return counts.length > limit ? `${shown} +${counts.length - limit} more` : shown;
}

// The figures of one login of the compare-reports overview.
const accountFigures = account => [
  ['Sessions', account.sessionCount, 'layers'],
  ['Active days', account.activeDays, 'calendar'],
  ['Platforms', account.platforms?.length ?? 0, 'monitor'],
  ['Countries', topList(account.countries, 1), 'globe'],
];

// One side of a comparison: a caption, a big title, an optional email and "⋯" menu, and figures [label, value, icon].
function compareSideCard({ side, caption, title, email, menu, figures, avatar = 'user' }) {
  const card = document.createElement('div');
  card.className = `cmp-account ${side}`;
  const head = document.createElement('div');
  head.className = 'cmp-account-head';
  const name = document.createElement('div');
  const small = document.createElement('small');
  small.textContent = caption;
  const strong = document.createElement('strong');
  strong.textContent = title;
  name.append(small, strong);
  head.append(icon(avatar, 'icon cmp-avatar'), name);
  if (email !== undefined) {
    const mail = document.createElement('span');
    mail.className = 'cmp-email';
    mail.append(icon('mail'), email || '—');
    head.append(mail);
  }
  if (menu) head.append(menu);

  const list = document.createElement('div');
  list.className = 'cmp-account-figures';
  for (const [label, value, iconName] of figures) {
    const figure = document.createElement('div');
    const text = document.createElement('div');
    const caption = document.createElement('small');
    caption.textContent = label;
    const number = document.createElement('strong');
    number.textContent = value ?? '—';
    text.append(caption, number);
    figure.append(icon(iconName), text);
    list.append(figure);
  }
  card.append(head, list);
  return card;
}

function compareVersus() {
  const versus = document.createElement('span');
  versus.className = 'cmp-vs';
  versus.textContent = 'VS';
  return versus;
}

// Tiles of counts [{ count, text, icon, tab }]; a count above zero is marked, a click opens the tab.
function renderSignalTiles(container, signals, onSelect) {
  container.replaceChildren(...signals.map(signal => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = signal.count > 0 ? 'signal hot' : 'signal';
    const number = document.createElement('strong');
    number.textContent = signal.count;
    const caption = document.createElement('span');
    caption.textContent = signal.text;
    const words = document.createElement('span');
    words.className = 'signal-text';
    words.append(number, caption);
    button.append(icon(signal.icon), words);
    button.addEventListener('click', () => onSelect(signal.tab));
    return button;
  }));
}

// A check when nothing is shared, a warning sign when something is.
const toneOf = (count, shared = 'danger') => (count > 0 ? shared : 'ok');

function resultBadge(text, tone) {
  if (text === '' || text === null || text === undefined) return '—';
  if (!tone) return text;
  const element = badge(text, tone);
  element.prepend(icon(tone === 'ok' ? 'check' : 'alert'));
  return element;
}

// The Key findings list: [{ tone, text }].
function renderFindings(list, findings) {
  list.replaceChildren(...findings.map(finding => {
    const item = document.createElement('li');
    item.className = finding.tone;
    item.append(icon(finding.tone === 'ok' ? 'check' : 'alert'), finding.text);
    return item;
  }));
}
