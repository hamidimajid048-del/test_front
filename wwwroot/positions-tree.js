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
    defaultSort: { sortItem: 'MainOpenTime', sortDirection: 'Asc' },
    help: [
      'Copy trade: the related account opened the same direction on the same symbol close to the main position.',
      '"Related opened later" means the related account may be following the main one; "first" means the main may be following it.',
      'The same stop loss or take profit, a fixed volume multiplier and positions closed together are the strongest signs of copying.',
      'Pairs marked "Counted" are the ones the share counts (each position is matched at most once); the other positions are also close but were not chosen.',
    ],
    cards: stats => {
      const copy = stats.copyTrade;
      return [
        ['Leader', copy.leader === 'Main' ? 'Main opens first' : copy.leader === 'Related' ? 'Related opens first' : copy.leader === 'Mixed' ? 'No clear leader' : '—', 'crown'],
        ['Same stop loss', percent(copy.sameStopLossPercent), 'shield'],
        ['Same take profit', percent(copy.sameTakeProfitPercent), 'target'],
        ['Closed together', percent(copy.closedTogetherPercent), 'layers'],
        ['Same result', percent(copy.sameResultPercent), 'check'],
        ['Near entry price', percent(copy.nearPricePercent), 'mapPin'],
        ['Volume multiplier', copy.isConstantVolumeRatio ? `×${copy.dominantVolumeRatio} (constant)` : copy.dominantVolumeRatio ? `×${copy.dominantVolumeRatio} (varies)` : '—', 'scale'],
      ];
    },
  },
  hedge: {
    defaultSort: { sortItem: 'NetProfitLoss', sortDirection: 'Asc' },
    help: [
      'Hedge: the related account opened the opposite direction on the same symbol close to the main position, with a similar volume.',
      'A pair "offsets" when one side wins and the other loses. A net result near zero on many pairs means the accounts cancel each other out.',
      'Equal volumes, opposite results and positions closed together are the strongest signs of a hedge. A "loss transfer" means the profit lands on the same account again and again.',
      'Pairs marked "Counted" are the ones the share counts (each position is matched at most once); the other positions are also close but were not chosen.',
    ],
    cards: stats => {
      const hedge = stats.hedge;
      return [
        ['Pairs that offset', percent(hedge.offsettingPercent), 'swap'],
        ['Offset efficiency', percent(hedge.averageOffsetEfficiency * 100), 'percent'],
        ['Average volume difference', percent(hedge.averageAbsVolumeDiffPercent), 'scale'],
        ['Same volume', percent(hedge.sameVolumePercent), 'scale'],
        ['Closed together', percent(hedge.closedTogetherPercent), 'layers'],
        ['Loss transfer', hedge.lossTransferDetected ? `To ${hedge.lossTransferTo.toLowerCase()}` : 'Not detected', 'trendDown'],
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

// 3725.25 -> "1h 2m 5.250s"
const duration = totalSeconds => (totalSeconds === null || totalSeconds === undefined ? '—' : formatSpan(totalSeconds));

const signedDuration = seconds =>
  seconds === null || seconds === undefined ? '—' : seconds === 0 ? formatSpan(0) : `${seconds < 0 ? '-' : '+'}${duration(seconds)}`;

const signedMoney = value => `${value > 0 ? '+' : ''}${money(value)}`;

function pnl(value) {
  const span = document.createElement('span');
  span.className = value > 0 ? 'pnl-pos' : value < 0 ? 'pnl-neg' : '';
  span.textContent = money(value);
  return span;
}

// The API sends a position's direction as its deal type: BUY or SELL.
const DIRECTION_LABELS = { BUY: 'Buy', SELL: 'Sell' };
const directionLabel = direction => DIRECTION_LABELS[direction] ?? direction;
const directionBadge = direction => {
  const element = badge('', direction === 'BUY' ? 'ok' : 'danger');
  element.append(sideLabel(directionLabel(direction), direction));
  return element;
};

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

// A half-circle gauge filled to the score (0-100), coloured by the risk level.
function riskGauge(score, level) {
  const fill = Math.min(100, Math.max(0, Number(score) || 0));
  const gauge = document.createElement('div');
  gauge.className = `risk-gauge ${RISK_LEVEL_KINDS[level] ?? 'muted'}`;
  gauge.innerHTML = '<svg viewBox="0 0 120 66" aria-hidden="true"><path class="track" d="M10 60a50 50 0 0 1 100 0" pathLength="100"/>'
    + `<path class="fill" d="M10 60a50 50 0 0 1 100 0" pathLength="100" stroke-dasharray="${fill} 100"/></svg>`;
  return gauge;
}

function renderRisk(container, risk) {
  const score = document.createElement('div');
  score.className = 'risk-score';
  const number = document.createElement('strong');
  number.textContent = risk.score;
  const label = document.createElement('span');
  label.textContent = 'Risk score';
  score.append(riskGauge(risk.score, risk.level), number, label, badge(risk.level, RISK_LEVEL_KINDS[risk.level] ?? 'muted'));

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
    ], risk.reasons, undefined, { tools: false });
  } else {
    details.append('No matched pairs, so there is nothing to score.');
  }
  container.replaceChildren(score, details);
}

function renderStatCards(container, stats, kindKey) {
  const overview = stats.overview;
  const signed = value => (value > 0 ? 'pnl-pos' : value < 0 ? 'pnl-neg' : '');
  const cards = [
    ['Matched pairs', overview.pairCount, 'link'],
    ['Share of positions', `${percent(overview.sharePercent)} of ${overview.mainPositionCount}`, 'layers'],
    ['Main profit/loss', money(overview.mainProfitLoss), 'bars', signed(overview.mainProfitLoss)],
    ['Related profit/loss', money(overview.relatedProfitLoss), 'bars', signed(overview.relatedProfitLoss)],
    ['Net profit/loss', money(overview.netProfitLoss), 'wallet', signed(overview.netProfitLoss)],
    ['Median time offset', duration(stats.timing.medianAbsOffsetSeconds), 'timer'],
    ['Related opened later', percent(stats.timing.relatedAfterPercent), 'history'],
    ['Same volume', percent(stats.volume.sameVolumePercent), 'scale'],
    ['Median volume ratio', stats.volume.medianRatio ? `×${stats.volume.medianRatio}` : '—', 'chart'],
    ['Shared IP / CID', [overview.sharesIp && 'IP', overview.sharesCid && 'CID'].filter(Boolean).join(' + ') || 'None', 'grid'],
  ];
  const view = KIND_VIEWS[kindKey];
  if (view && (stats.copyTrade || stats.hedge)) cards.push(...view.cards(stats));

  container.replaceChildren(...cards.map(([title, value, iconName, tone]) => {
    const card = document.createElement('div');
    card.className = 'stat';
    const text = document.createElement('div');
    const small = document.createElement('small');
    small.textContent = title;
    const strong = document.createElement('strong');
    strong.textContent = value;
    if (tone) strong.className = tone;
    text.append(small, strong);
    card.append(icon(iconName, 'icon stat-icon'), text);
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

// One row per main position of the tree page: the main position and each related position as bars from their open to
// their close on the row's own time scale, with the main open and close drawn through every lane, so how closely the
// two accounts opened and closed shows at a glance. A position still open runs to the end of the row.
function renderPositionTimeline(container, nodes) {
  if (!nodes.length) {
    container.className = 'empty-note';
    container.textContent = 'No pairs in this range.';
    return;
  }
  const time = value => (value ? Date.parse(value) : null);
  const list = document.createElement('div');
  list.className = 'pt-list';

  const legend = document.createElement('div');
  legend.className = 'pt-legend';
  for (const [className, text] of [['main', 'Main position'], ['related', 'Related position'], ['guide', 'Main open and close']]) {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.className = className;
    item.append(swatch, text);
    legend.append(item);
  }
  list.append(legend);

  for (const node of nodes) {
    const positions = [node.main, ...node.children.map(child => child.related)];
    const start = Math.min(...positions.map(position => time(position.openTimeUtc)));
    const closes = positions.map(position => time(position.closeTimeUtc)).filter(value => value !== null);
    const end = Math.max(start + 1000, ...closes, ...positions.map(position => time(position.openTimeUtc)));
    const at = value => ((value - start) / (end - start)) * 100;

    const lane = (position, kind, tag, note) => {
      const row = document.createElement('div');
      row.className = `pt-lane ${kind}`;
      const label = document.createElement('span');
      label.className = 'pt-tag';
      label.append(tag);
      const track = document.createElement('div');
      track.className = 'pt-track';
      for (const value of [time(node.main.openTimeUtc), time(node.main.closeTimeUtc)].filter(item => item !== null)) {
        const guide = document.createElement('b');
        guide.className = 'pt-guide';
        guide.style.insetInlineStart = `${at(value)}%`;
        track.append(guide);
      }
      const open = time(position.openTimeUtc);
      const close = time(position.closeTimeUtc);
      const bar = document.createElement('i');
      bar.className = `pt-bar${close === null ? ' running' : ''}`;
      bar.style.insetInlineStart = `${at(open)}%`;
      bar.style.width = `${Math.max(0.6, at(close ?? end) - at(open))}%`;
      bar.title = `${formatUtc(position.openTimeUtc)} → ${close === null ? '…' : formatUtc(position.closeTimeUtc)}`
        + (close === null ? '' : ` (${duration((close - open) / 1000)})`);
      track.append(bar);
      row.append(label, track, note ?? document.createElement('span'));
      return row;
    };

    const offsets = comparison => {
      const note = document.createElement('small');
      note.className = 'pt-offsets';
      note.append('Open', ` ${signedDuration(comparison.relatedMinusMainOpenSeconds)}`, document.createElement('br'),
        'Close', ` ${comparison.relatedMinusMainCloseSeconds === null || comparison.relatedMinusMainCloseSeconds === undefined ? '—' : signedDuration(comparison.relatedMinusMainCloseSeconds)}`);
      return note;
    };

    const group = document.createElement('div');
    group.className = 'pt-row';
    const head = document.createElement('div');
    head.className = 'pt-head';
    const ticket = document.createElement('strong');
    ticket.textContent = node.main.positionTicket;
    const scale = document.createElement('small');
    scale.className = 'pt-scale';
    scale.textContent = `${formatUtc(new Date(start).toISOString())} — ${formatUtc(new Date(end).toISOString())}`;
    head.append(ticket, ` ${node.main.symbol} `, directionBadge(node.main.direction), scale);
    group.append(head, lane(node.main, 'main', 'Main'));
    for (const child of node.children) {
      group.append(lane(child.related, `related${child.isAssigned ? ' counted' : ''}`, `${child.related.positionTicket}`, offsets(child.comparison)));
    }
    list.append(group);
  }
  container.className = '';
  container.replaceChildren(list);
}


// ---- tree ----

const TREE_COLUMNS = 14;
// The report's sort items by parent column index, and the direction a first click on each starts with.
const PARENT_SORT_KEYS = { 2: 'MainOpenTime', 10: 'MainProfitLoss', 11: 'ChildCount', 12: 'ClosestOffset', 13: 'Severity' };
const TREE_SORT_NATURAL = { MainOpenTime: 'Asc', MainProfitLoss: 'Asc', ChildCount: 'Desc', ClosestOffset: 'Asc', Severity: 'Desc' };
const PARENT_HEADERS = ['', 'Main ticket', 'Opened (UTC)', 'Closed (UTC)', 'Symbol', 'Direction', 'Volume', 'Entry', 'Stop loss', 'Take profit', 'Profit/loss', 'Matches', 'Closest offset', 'Signal'];
const CHILD_HEADERS = ['', 'Related ticket', 'Opened (UTC)', 'Closed (UTC)', 'Offset', 'Direction', 'Volume', 'Entry', 'Stop loss', 'Take profit', 'Profit/loss', 'Counted', 'Net profit/loss', 'Signals'];

// Opened, closed and entry price columns of the tree, tinted like the open and close columns of the other reports.
const TREE_PHASES = { 2: 'open', 3: 'close', 7: 'open' };

function markPhases(row) {
  for (const [index, phase] of Object.entries(TREE_PHASES)) row.cells[index]?.classList.add(`phase-${phase}`);
  return row;
}

function cell(row, content, className) {
  const td = row.insertCell();
  if (className) td.className = className;
  if (content instanceof Node) td.append(content);
  else td.textContent = content ?? '';
  return td;
}

// Header row; `sortKeys` maps a column index to the report's sort item and `sort` is the active
// { item, direction, onChange } (server side, the tree is paged), which makes those headers sort buttons.
function headerRow(titles, className, sortKeys = {}, sort = null, container = null) {
  const row = document.createElement('tr');
  row.className = className;
  titles.forEach((title, index) => {
    const th = document.createElement('th');
    const key = sort && sortKeys[index];
    if (key) {
      const active = sort.item?.toLowerCase() === key.toLowerCase();
      const direction = active ? (sort.direction?.toLowerCase() === 'asc' ? 'Asc' : 'Desc') : null;
      sortButton(th, title, direction, () => {
        const next = nextSort(sort, key, TREE_SORT_NATURAL[key] ?? 'Asc');
        guarded(container, async () => sort.onChange(next.item, next.direction));
      });
    } else {
      th.textContent = title;
    }
    row.append(th);
  });
  return markPhases(row);
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
    ['Direction', sideLabel(directionLabel(main.direction), main.direction), sideLabel(directionLabel(related.direction), related.direction), main.direction === related.direction ? 'Same' : 'Opposite'],
    ['Volume', main.volume, related.volume, `×${comparison.volumeRatio} (${comparison.volumeDiffPercent > 0 ? '+' : ''}${comparison.volumeDiffPercent}%)`],
    ['Entry price', price(main.openPrice), price(related.openPrice), signedMoney(comparison.openPriceDiff)],
    ['Exit price', price(main.closePrice), price(related.closePrice), main.closePrice !== null && related.closePrice !== null ? signedMoney(related.closePrice - main.closePrice) : '—'],
    ['Stop loss', stopsText(main.stopLoss), stopsText(related.stopLoss), comparison.sameStopLoss ? 'Same' : '—'],
    ['Take profit', stopsText(main.takeProfit), stopsText(related.takeProfit), comparison.sameTakeProfit ? 'Same' : '—'],
    ['Profit/loss', money(main.profitLoss), money(related.profitLoss), `net ${money(comparison.netProfitLoss)}`],
  ];
  const phase = row => ({ 'Opened (UTC)': 'phase-open', 'Entry price': 'phase-open', 'Closed (UTC)': 'phase-close', 'Exit price': 'phase-close' })[row[0]] ?? '';
  renderTable(panel.appendChild(document.createElement('div')), [
    { key: 0, title: 'Field', cellClass: phase },
    { key: 1, title: `Main (${main.accountId})`, cellClass: phase },
    { key: 2, title: `Related (${related.accountId})`, cellClass: phase },
    { key: 3, title: 'Difference', cellClass: phase },
  ], rows.map(row => ({ 0: row[0], 1: row[1], 2: row[2], 3: row[3] })), undefined, { tools: false });

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

// How close the related opening is to the main one inside the window the user typed: full at 0 seconds, empty at the
// edge of the window (seconds before for an earlier opening, seconds after for a later one).
function proximityBar(offsetSeconds, window) {
  const limit = offsetSeconds < 0 ? window.before : window.after;
  const ratio = limit > 0 ? Math.max(0, 1 - Math.abs(offsetSeconds) / limit) : (offsetSeconds === 0 ? 1 : 0);
  const bar = document.createElement('span');
  bar.className = 'meter proximity';
  bar.title = `${Math.round(ratio * 100)}% close (window: ${window.before}s before, ${window.after}s after)`;
  const fill = document.createElement('i');
  fill.className = ratio >= 0.66 ? 'near' : ratio >= 0.33 ? 'mid' : 'far';
  fill.style.width = `${ratio * 100}%`;
  bar.append(fill);
  return bar;
}

// Draws the tree for one page of main positions. `expanded` (a Set of main tickets) keeps the open nodes across
// redraws; `opened` (a Set of "main:related" keys) keeps the open pair comparisons.
function renderPositionsTree(container, kindKey, nodes, state) {
  const table = document.createElement('table');
  table.className = 'tree';
  table.createTHead().append(headerRow(PARENT_HEADERS, undefined, PARENT_SORT_KEYS, state.sort, container));
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
    makeCopyable(cell(parent, main.positionTicket), main.positionTicket);
    cell(parent, formatUtc(main.openTimeUtc));
    cell(parent, closedText(main));
    if (isCopyableValue(main.symbol)) makeCopyable(cell(parent, main.symbol), main.symbol);
    else cell(parent, main.symbol);
    cell(parent, directionBadge(main.direction));
    cell(parent, main.volume);
    cell(parent, price(main.openPrice));
    cell(parent, stopsText(main.stopLoss));
    cell(parent, stopsText(main.takeProfit));
    cell(parent, pnl(main.profitLoss));
    cell(parent, `${node.children.length} (${node.assignedCount} counted)`);
    cell(parent, inline(duration(node.closestOffsetSeconds), proximityBar(node.children[0].comparison.relatedMinusMainOpenSeconds, state.window)));
    cell(parent, severityBadge(node.maxSeverity));
    markPhases(parent);

    const childRows = [headerRow(CHILD_HEADERS, 'tree-child tree-child-head')];
    for (const child of node.children) {
      const related = child.related;
      const key = `${main.positionTicket}:${related.accountId}:${related.positionTicket}`;
      const row = document.createElement('tr');
      row.className = `tree-child clickable${child.isAssigned ? ' counted' : ''}`;
      row.tabIndex = 0;
      cell(row, '');
      makeCopyable(cell(row, related.positionTicket), related.positionTicket);
      cell(row, formatUtc(related.openTimeUtc));
      cell(row, closedText(related));
      cell(row, inline(signedDuration(child.comparison.relatedMinusMainOpenSeconds), proximityBar(child.comparison.relatedMinusMainOpenSeconds, state.window)));
      cell(row, directionBadge(related.direction));
      cell(row, related.volume);
      cell(row, price(related.openPrice));
      cell(row, stopsText(related.stopLoss));
      cell(row, stopsText(related.takeProfit));
      cell(row, pnl(related.profitLoss));
      cell(row, child.isAssigned ? badge('Counted', 'main') : badge('Not counted', 'muted'));
      cell(row, pnl(child.comparison.netProfitLoss));
      cell(row, signalBadges(child.signals));
      markPhases(row);

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

  const hiddenIndexes = group => TREE_HEADERS[group].map((title, index) => index).filter(index =>
    index > 0 && treeColumnState(container, group).hidden.has(`${group}|${TREE_HEADERS[group][index]}`));
  hideTreeColumns(table, hiddenIndexes('Main'), hiddenIndexes('Related'));

  const bar = document.createElement('div');
  bar.className = 'column-pickers';
  for (const group of TREE_GROUPS) {
    const columns = TREE_HEADERS[group].slice(1).map(title => ({ group, title }));
    bar.append(columnPicker(columns, treeColumnState(container, group), container, () => renderPositionsTree(container, kindKey, nodes, state)));
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  container.replaceChildren(wrap);
  stickHeader(table);
  mountTools(container, bar);
}

// ---- column visibility of the tree: the main rows and the related rows each have their own columns ----

const TREE_GROUPS = ['Main', 'Related'];
const TREE_HEADERS = { Main: PARENT_HEADERS, Related: CHILD_HEADERS };
const treeColumnStates = new WeakMap();

// The hidden-column state of one group of one tree container, kept while the page is open.
function treeColumnState(container, group) {
  let groups = treeColumnStates.get(container);
  if (!groups) treeColumnStates.set(container, groups = {});
  return groups[group] ??= { hidden: new Set(), pickerOpen: false };
}

// Hides cells by position. The toggle column (0) always stays; a detail row spans what is left.
function hideTreeColumns(table, hiddenMain, hiddenRelated) {
  const hide = (row, indexes) => {
    [...row.cells].forEach((cell, index) => { if (indexes.includes(index)) cell.hidden = true; });
  };
  for (const row of table.rows) {
    if (row.classList.contains('tree-detail') || row.querySelector('td.empty')) continue;
    hide(row, row.classList.contains('tree-child') ? hiddenRelated : hiddenMain);
  }
  const span = TREE_COLUMNS - Math.min(hiddenMain.length, hiddenRelated.length);
  for (const cell of table.querySelectorAll('.tree-detail > td, td.empty')) cell.colSpan = span;
}
