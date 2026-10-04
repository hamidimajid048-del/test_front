// Rendering of the position comparison of the copy trade / hedge page: statistics cards, the risk score, the tree of
// main positions with the related positions under them, a side-by-side comparison of one pair, and small charts.
// All numbers come from the service (position-tree and position-stats); this file only draws them.

const SIGNAL_LABELS = {
  SameSecond: 'Opened in the same second',
  RelatedFollowed: 'Related opened later',
  RelatedLed: 'Related opened first',
  SameVolume: 'Same volume',
  SimilarVolume: 'Similar volume',
  SameStopLoss: 'Same stop loss',
  SameTakeProfit: 'Same take profit',
  ClosedTogether: 'Closed together',
  NearPrice: 'Near entry price',
  SameResult: 'Same result',
  OppositeDirection: 'Opposite direction',
  Offsetting: 'Offsets the other side',
};

const SEVERITY_KINDS = { Low: 'muted', Medium: 'warn', High: 'danger' };
const SEVERITY_RANK = { Low: 1, Medium: 2, High: 3 };

const RISK_LABELS = {
  Share: 'Share of the account\'s positions',
  SameStops: 'Same stop loss / take profit',
  ConstantVolumeRatio: 'Constant volume multiplier',
  Leader: 'One account usually opens first',
  SameVolume: 'Same volume',
  ClosedTogether: 'Positions closed together',
  SharedEvidence: 'Shared IP or CID',
  Offsetting: 'One side wins what the other loses',
  LossTransfer: 'Profit always lands on one account',
};

const RISK_LEVEL_KINDS = { Low: 'ok', Medium: 'warn', High: 'danger' };

// What differs between the two report types in the view: the help text and the extra statistics cards.
const KIND_VIEWS = {
  'copy-trade': {
    defaultSort: { sortBy: 'MainOpenTime', sortDirection: 'Asc' },
    help: [
      'Copy trade: the related account opened the same direction on the same symbol close to the main position.',
      '"Related opened later" means the related account may be following the main one; "first" means the main may be following it.',
      'The same stop loss or take profit, a fixed volume multiplier and positions closed together are the strongest signs of copying.',
      'Pairs marked "Counted" are the ones the share counts (each position is matched at most once); the other positions are also close but were not chosen.',
    ],
    cards: stats => {
      const copy = stats.copyTrade;
      return [
        ['Leader', copy.leader === 'Main' ? 'Main opens first' : copy.leader === 'Related' ? 'Related opens first' : copy.leader === 'Mixed' ? 'No clear leader' : '—'],
        ['Same stop loss', percent(copy.sameStopLossPercent)],
        ['Same take profit', percent(copy.sameTakeProfitPercent)],
        ['Closed together', percent(copy.closedTogetherPercent)],
        ['Same result', percent(copy.sameResultPercent)],
        ['Near entry price', percent(copy.nearPricePercent)],
        ['Volume multiplier', copy.isConstantVolumeRatio ? `×${copy.dominantVolumeRatio} (constant)` : copy.dominantVolumeRatio ? `×${copy.dominantVolumeRatio} (varies)` : '—'],
      ];
    },
  },
  hedge: {
    defaultSort: { sortBy: 'NetProfitLoss', sortDirection: 'Asc' },
    help: [
      'Hedge: the related account opened the opposite direction on the same symbol close to the main position, with a similar volume.',
      'A pair "offsets" when one side wins and the other loses. A net result near zero on many pairs means the accounts cancel each other out.',
      'Equal volumes, opposite results and positions closed together are the strongest signs of a hedge. A "loss transfer" means the profit lands on the same account again and again.',
      'Pairs marked "Counted" are the ones the share counts (each position is matched at most once); the other positions are also close but were not chosen.',
    ],
    cards: stats => {
      const hedge = stats.hedge;
      return [
        ['Pairs that offset', percent(hedge.offsettingPercent)],
        ['Offset efficiency', percent(hedge.averageOffsetEfficiency * 100)],
        ['Average volume difference', percent(hedge.averageAbsVolumeDiffPercent)],
        ['Same volume', percent(hedge.sameVolumePercent)],
        ['Closed together', percent(hedge.closedTogetherPercent)],
        ['Loss transfer', hedge.lossTransferDetected ? `To ${hedge.lossTransferTo.toLowerCase()}` : 'Not detected'],
      ];
    },
  },
};

// ---- formatting ----

function percent(value) {
  return `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function money(value) {
  return Number(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function price(value) {
  return value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 5 });
}

// 3725 -> "1h 2m 5s"; 0.4 -> "0.4s"
function duration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const value = Math.abs(totalSeconds);
  if (value < 10) return `${Number(value.toFixed(1))}s`;
  let remaining = Math.round(value);
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  if (days || hours || minutes) parts.push(`${minutes}m`);
  if (!days) parts.push(`${remaining % 60}s`);
  return parts.join(' ');
}

const signedDuration = seconds =>
  seconds === null || seconds === undefined ? '—' : seconds === 0 ? '0s' : `${seconds < 0 ? '-' : '+'}${duration(seconds)}`;

const signedMoney = value => `${value > 0 ? '+' : ''}${money(value)}`;

function pnl(value) {
  const span = document.createElement('span');
  span.className = value > 0 ? 'pnl-pos' : value < 0 ? 'pnl-neg' : '';
  span.textContent = money(value);
  return span;
}

const directionBadge = direction => badge(direction, direction === 'Buy' ? 'ok' : 'danger');

const stopsText = value => (value === null || value === undefined ? '—' : price(value));

function signalBadges(signals) {
  if (!signals?.length) return '—';
  const ordered = [...signals].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return inline(...ordered.map(signal => badge(SIGNAL_LABELS[signal.code] ?? signal.code, SEVERITY_KINDS[signal.severity] ?? 'muted')));
}

function severityBadge(severity) {
  return severity ? badge(severity, SEVERITY_KINDS[severity] ?? 'muted') : '—';
}

// ---- statistics ----

function renderRisk(container, risk) {
  const score = document.createElement('div');
  score.className = 'risk-score';
  const number = document.createElement('strong');
  number.textContent = risk.score;
  const label = document.createElement('span');
  label.textContent = 'Risk score';
  score.append(number, label, badge(risk.level, RISK_LEVEL_KINDS[risk.level] ?? 'muted'));

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Why this score';
  details.append(summary);
  if (risk.reasons.length) {
    renderTable(details.appendChild(document.createElement('div')), [
      { key: 'code', title: 'Rule', format: code => RISK_LABELS[code] ?? code },
      { key: 'weight', title: 'Weight' },
      { key: 'fraction', title: 'Match', format: fraction => percent(fraction * 100) },
      { key: 'points', title: 'Points' },
    ], risk.reasons);
  } else {
    details.append('No matched pairs, so there is nothing to score.');
  }
  container.replaceChildren(score, details);
}

function renderStatCards(container, stats, kindKey) {
  const overview = stats.overview;
  const cards = [
    ['Matched pairs', overview.pairCount],
    ['Share of positions', `${percent(overview.sharePercent)} of ${overview.mainPositionCount}`],
    ['Main profit/loss', money(overview.mainProfitLoss)],
    ['Related profit/loss', money(overview.relatedProfitLoss)],
    ['Net profit/loss', money(overview.netProfitLoss)],
    ['Median time offset', duration(stats.timing.medianAbsOffsetSeconds)],
    ['Related opened later', percent(stats.timing.relatedAfterPercent)],
    ['Same volume', percent(stats.volume.sameVolumePercent)],
    ['Median volume ratio', stats.volume.medianRatio ? `×${stats.volume.medianRatio}` : '—'],
    ['Shared IP / CID', [overview.sharesIp && 'IP', overview.sharesCid && 'CID'].filter(Boolean).join(' + ') || 'None'],
  ];
  const view = KIND_VIEWS[kindKey];
  if (view && (stats.copyTrade || stats.hedge)) cards.push(...view.cards(stats));

  container.replaceChildren(...cards.map(([title, value]) => {
    const card = document.createElement('div');
    card.className = 'stat';
    const small = document.createElement('small');
    small.textContent = title;
    const strong = document.createElement('strong');
    strong.textContent = value;
    card.append(small, strong);
    return card;
  }));
}

function renderSymbols(container, rows) {
  const most = Math.max(1, ...rows.map(row => row.pairCount));
  renderTable(container, [
    { key: 'symbol', title: 'Symbol' },
    {
      key: 'pairCount',
      title: 'Pairs',
      format: count => {
        const bar = document.createElement('span');
        bar.className = 'meter';
        const fill = document.createElement('i');
        fill.style.width = `${Math.max(2, count / most * 100)}%`;
        bar.append(fill);
        return inline(String(count), bar);
      },
    },
    { key: 'mainProfitLoss', title: 'Main profit/loss', format: pnl },
    { key: 'relatedProfitLoss', title: 'Related profit/loss', format: pnl },
    { key: 'netProfitLoss', title: 'Net profit/loss', format: pnl },
  ], rows);
}

// Vertical columns, one per item. items: [{ label, value, tip }]
function renderColumns(container, items, emptyText) {
  if (!items.length || items.every(item => !item.value)) {
    container.textContent = emptyText;
    container.className = 'empty-note';
    return;
  }
  const most = Math.max(1, ...items.map(item => item.value));
  const chart = document.createElement('div');
  chart.className = 'columns';
  for (const item of items) {
    const column = document.createElement('div');
    column.className = 'column';
    column.title = item.tip ?? `${item.label}: ${item.value}`;
    const value = document.createElement('small');
    value.textContent = item.value;
    const bar = document.createElement('i');
    bar.style.height = `${item.value ? Math.max(3, item.value / most * 100) : 0}%`;
    const label = document.createElement('small');
    label.className = 'column-label';
    label.textContent = item.label;
    column.append(value, bar, label);
    chart.append(column);
  }
  container.className = '';
  container.replaceChildren(chart);
}

function renderTimeline(container, days) {
  renderColumns(container, days.map(day => ({
    label: day.day.slice(5),
    value: day.pairCount,
    tip: `${day.day}: ${day.pairCount} pairs, main ${money(day.mainProfitLoss)}, related ${money(day.relatedProfitLoss)}, net ${money(day.netProfitLoss)}`,
  })), 'No pairs in this range.');
}

function renderOffsets(container, buckets) {
  renderColumns(container, buckets.map(bucket => ({ label: bucket.label, value: bucket.count })), 'No pairs in this range.');
}

// ---- tree ----

const TREE_COLUMNS = 14;
const PARENT_HEADERS = ['', 'Main ticket', 'Opened (UTC)', 'Closed (UTC)', 'Symbol', 'Direction', 'Volume', 'Entry', 'Stop loss', 'Take profit', 'Profit/loss', 'Matches', 'Closest offset', 'Signal'];
const CHILD_HEADERS = ['', 'Related ticket', 'Opened (UTC)', 'Closed (UTC)', 'Offset', 'Direction', 'Volume', 'Entry', 'Stop loss', 'Take profit', 'Profit/loss', 'Counted', 'Net profit/loss', 'Signals'];

function cell(row, content, className) {
  const td = row.insertCell();
  if (className) td.className = className;
  if (content instanceof Node) td.append(content);
  else td.textContent = content ?? '';
  return td;
}

function headerRow(titles, className) {
  const row = document.createElement('tr');
  row.className = className;
  for (const title of titles) {
    const th = document.createElement('th');
    th.textContent = title;
    row.append(th);
  }
  return row;
}

function closedText(position) {
  return position.closeTimeUtc ? formatUtc(position.closeTimeUtc) : badge('Open', 'warn');
}

// The compare panel of one pair: the two positions side by side with the difference, and their lifetimes on one axis.
function comparePanel(main, child, kindKey) {
  const related = child.related;
  const comparison = child.comparison;
  const panel = document.createElement('div');
  panel.className = 'compare-panel';

  const hold = position => (position.durationSeconds === null || position.durationSeconds === undefined ? '—' : duration(position.durationSeconds));
  const rows = [
    ['Ticket', main.positionTicket, related.positionTicket, ''],
    ['Opened (UTC)', formatUtc(main.openTimeUtc), formatUtc(related.openTimeUtc), signedDuration(comparison.relatedMinusMainOpenSeconds)],
    ['Closed (UTC)', main.closeTimeUtc ? formatUtc(main.closeTimeUtc) : 'Open', related.closeTimeUtc ? formatUtc(related.closeTimeUtc) : 'Open', signedDuration(comparison.relatedMinusMainCloseSeconds)],
    ['Held for', hold(main), hold(related), signedDuration(comparison.durationDiffSeconds)],
    ['Time both were open', '', '', comparison.overlapSeconds === null || comparison.overlapSeconds === undefined ? '—' : duration(comparison.overlapSeconds)],
    ['Direction', main.direction, related.direction, main.direction === related.direction ? 'Same' : 'Opposite'],
    ['Volume', main.volume, related.volume, `×${comparison.volumeRatio} (${comparison.volumeDiffPercent > 0 ? '+' : ''}${comparison.volumeDiffPercent}%)`],
    ['Entry price', price(main.openPrice), price(related.openPrice), signedMoney(comparison.openPriceDiff)],
    ['Exit price', price(main.closePrice), price(related.closePrice), main.closePrice !== null && related.closePrice !== null ? signedMoney(related.closePrice - main.closePrice) : '—'],
    ['Stop loss', stopsText(main.stopLoss), stopsText(related.stopLoss), comparison.sameStopLoss ? 'Same' : '—'],
    ['Take profit', stopsText(main.takeProfit), stopsText(related.takeProfit), comparison.sameTakeProfit ? 'Same' : '—'],
    ['Profit/loss', money(main.profitLoss), money(related.profitLoss), `net ${money(comparison.netProfitLoss)}`],
  ];
  renderTable(panel.appendChild(document.createElement('div')), [
    { key: 0, title: 'Field' },
    { key: 1, title: `Main (${main.accountId})` },
    { key: 2, title: `Related (${related.accountId})` },
    { key: 3, title: 'Difference' },
  ], rows.map(row => ({ 0: row[0], 1: row[1], 2: row[2], 3: row[3] })));

  panel.append(lifeline(main, related));

  const note = document.createElement('p');
  note.className = 'compare-note';
  note.append(signalBadges(child.signals));
  panel.append(note);
  return panel;
}

// Both positions' open-to-close spans on one time axis; a position that is still open runs to the end of the axis.
function lifeline(main, related) {
  const time = value => new Date(value).getTime();
  const points = [main.openTimeUtc, related.openTimeUtc, main.closeTimeUtc, related.closeTimeUtc].filter(Boolean).map(time);
  const start = Math.min(...points);
  const latest = Math.max(...points);
  const pad = Math.max(1000, (latest - start) * 0.05);
  const end = main.closeTimeUtc && related.closeTimeUtc ? latest : latest + pad;
  const span = Math.max(1, end - start);

  const wrap = document.createElement('div');
  wrap.className = 'lifeline';
  for (const [name, position, kind] of [['Main', main, 'main'], ['Related', related, 'compared']]) {
    const row = document.createElement('div');
    row.className = 'lifeline-row';
    const title = document.createElement('small');
    title.textContent = name;
    const track = document.createElement('div');
    track.className = 'lifeline-track';
    const bar = document.createElement('span');
    bar.className = `lifeline-bar ${kind}${position.closeTimeUtc ? '' : ' open'}`;
    const from = time(position.openTimeUtc);
    const to = position.closeTimeUtc ? time(position.closeTimeUtc) : end;
    bar.style.left = `${(from - start) / span * 100}%`;
    bar.style.width = `${Math.max(0.8, (to - from) / span * 100)}%`;
    bar.title = `${formatUtc(position.openTimeUtc)} — ${position.closeTimeUtc ? formatUtc(position.closeTimeUtc) : 'still open'}`;
    track.append(bar);
    row.append(title, track);
    wrap.append(row);
  }
  const axis = document.createElement('div');
  axis.className = 'lifeline-axis';
  const first = document.createElement('small');
  first.textContent = formatUtc(new Date(start).toISOString());
  const last = document.createElement('small');
  last.textContent = main.closeTimeUtc && related.closeTimeUtc ? formatUtc(new Date(end).toISOString()) : 'open →';
  axis.append(first, last);
  wrap.append(axis);
  return wrap;
}

// Draws the tree for one page of main positions. `expanded` (a Set of main tickets) keeps the open nodes across
// redraws; `opened` (a Set of "main:related" keys) keeps the open pair comparisons.
function renderPositionsTree(container, kindKey, nodes, state) {
  const table = document.createElement('table');
  table.className = 'tree';
  table.createTHead().append(headerRow(PARENT_HEADERS));
  const body = table.createTBody();

  if (!nodes.length) {
    const empty = body.insertRow().insertCell();
    empty.colSpan = TREE_COLUMNS;
    empty.className = 'empty';
    empty.textContent = 'No data found';
  }

  for (const node of nodes) {
    const main = node.main;
    const parent = body.insertRow();
    parent.className = 'tree-parent clickable';
    parent.tabIndex = 0;
    const toggle = cell(parent, '', 'tree-toggle');
    cell(parent, main.positionTicket);
    cell(parent, formatUtc(main.openTimeUtc));
    cell(parent, closedText(main));
    cell(parent, main.symbol);
    cell(parent, directionBadge(main.direction));
    cell(parent, main.volume);
    cell(parent, price(main.openPrice));
    cell(parent, stopsText(main.stopLoss));
    cell(parent, stopsText(main.takeProfit));
    cell(parent, pnl(main.profitLoss));
    cell(parent, `${node.children.length} (${node.assignedCount} counted)`);
    cell(parent, duration(node.closestOffsetSeconds));
    cell(parent, severityBadge(node.maxSeverity));

    const childRows = [headerRow(CHILD_HEADERS, 'tree-child tree-child-head')];
    for (const child of node.children) {
      const related = child.related;
      const key = `${main.positionTicket}:${related.accountId}:${related.positionTicket}`;
      const row = document.createElement('tr');
      row.className = `tree-child clickable${child.isAssigned ? ' counted' : ''}`;
      row.tabIndex = 0;
      cell(row, '');
      cell(row, related.positionTicket);
      cell(row, formatUtc(related.openTimeUtc));
      cell(row, closedText(related));
      cell(row, signedDuration(child.comparison.relatedMinusMainOpenSeconds));
      cell(row, directionBadge(related.direction));
      cell(row, related.volume);
      cell(row, price(related.openPrice));
      cell(row, stopsText(related.stopLoss));
      cell(row, stopsText(related.takeProfit));
      cell(row, pnl(related.profitLoss));
      cell(row, child.isAssigned ? badge('Counted', 'main') : badge('Not counted', 'muted'));
      cell(row, pnl(child.comparison.netProfitLoss));
      cell(row, signalBadges(child.signals));

      const detail = document.createElement('tr');
      detail.className = 'tree-detail';
      const detailCell = detail.insertCell();
      detailCell.colSpan = TREE_COLUMNS;

      const setDetail = isOpen => {
        detail.hidden = !isOpen || row.hidden;
        if (isOpen && !detailCell.firstChild) detailCell.append(comparePanel(main, child, kindKey));
        row.classList.toggle('active', isOpen);
      };
      row.addEventListener('click', () => {
        const isOpen = !state.opened.has(key);
        if (isOpen) state.opened.add(key);
        else state.opened.delete(key);
        setDetail(isOpen);
      });
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); }
      });
      childRows.push(row, detail);
      row.dataset.key = key;
      row.setDetail = setDetail;
    }

    const setOpen = isOpen => {
      toggle.textContent = isOpen ? '▾' : '▸';
      parent.setAttribute('aria-expanded', String(isOpen));
      for (const row of childRows) {
        if (row.classList.contains('tree-detail')) row.hidden = !isOpen || !state.opened.has(row.previousElementSibling.dataset.key);
        else row.hidden = !isOpen;
      }
    };
    const flip = () => {
      const isOpen = !state.expanded.has(main.positionTicket);
      if (isOpen) state.expanded.add(main.positionTicket);
      else state.expanded.delete(main.positionTicket);
      setOpen(isOpen);
    };
    parent.addEventListener('click', flip);
    parent.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); flip(); }
    });

    // Parent first, then its children in the DOM; the initial state is applied once everything is attached.
    body.append(...childRows);
    setOpen(state.expanded.has(main.positionTicket));
    for (const row of childRows) {
      if (row.setDetail) row.setDetail(state.opened.has(row.dataset.key));
    }
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  container.replaceChildren(wrap);
}
