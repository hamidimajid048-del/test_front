// A line chart of the balance after each deal, drawn as SVG at the container's width. points: [{ time, balance, growthPercent }];
// mode: 'amount' plots the balance, 'percent' its growth against the start balance.

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { height: 300, left: 64, right: 20, top: 28, bottom: 32, minTickGap: 120 };
const DEFAULT_CHART_WIDTH = 900;
const drawnCharts = new WeakMap();
const chartResizes = new ResizeObserver(entries => {
  for (const { target } of entries) {
    const drawn = drawnCharts.get(target);
    const width = chartWidth(target);
    if (drawn && width > 0 && width !== drawn.width) renderBalanceChart(target, drawn.points, drawn.mode);
  }
});
let chartIds = 0;

function chartWidth(container) {
  const style = getComputedStyle(container);
  return Math.max(0, Math.floor(container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
}

function svgElement(name, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

const chartNumber = (value, digits = 2) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

// Rounded axis limits and step around [min, max].
function niceScale(min, max, ticks) {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough);
  return { low: Math.floor(min / step) * step, high: Math.ceil(max / step) * step, step };
}

function axisFormatter(mode, scale) {
  const reach = Math.max(Math.abs(scale.low), Math.abs(scale.high));
  const digits = scale.step < 1 ? 2 : scale.step % 1 ? 1 : 0;
  const number = value => reach >= 10_000 ? compactNumber.format(value) : chartNumber(value, digits);
  return mode === 'percent' ? value => `${number(value)}%` : number;
}

function dateFormatter(span) {
  const day = 24 * 60 * 60 * 1000;
  const options = span > 400 * day ? { month: 'short', year: 'numeric' }
    : span > 2 * day ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const format = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
  return time => format.format(new Date(time));
}

function nearestIndex(xs, target) {
  let [low, high] = [0, xs.length - 1];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (xs[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low > 0 && target - xs[low - 1] < xs[low] - target ? low - 1 : low;
}

function renderBalanceChart(container, points, mode) {
  container.classList.add('chart-frame');
  const width = chartWidth(container) || DEFAULT_CHART_WIDTH;
  if (!drawnCharts.has(container)) chartResizes.observe(container);
  drawnCharts.set(container, { points, mode, width });

  const usable = mode === 'percent' ? points.filter(point => point.growthPercent !== null) : points;
  if (usable.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = mode === 'percent'
      ? 'The percent chart needs the start balance, which is not in the account comment.'
      : 'No balance changes were found for this account.';
    container.replaceChildren(empty);
    return;
  }

  const value = point => mode === 'percent' ? point.growthPercent : point.balance;
  const values = usable.map(value);
  const times = usable.map(point => new Date(point.time).getTime());
  const [firstTime, lastTime] = [times[0], times[times.length - 1]];
  const scale = niceScale(Math.min(...values), Math.max(...values), 4);
  const axis = axisFormatter(mode, scale);
  const exact = number => mode === 'percent' ? `${chartNumber(number)}%` : chartNumber(number);
  const date = dateFormatter(lastTime - firstTime);

  const plot = { left: CHART.left, right: width - CHART.right, top: CHART.top, bottom: CHART.height - CHART.bottom };
  const x = time => lastTime === firstTime ? (plot.left + plot.right) / 2 : plot.left + (time - firstTime) / (lastTime - firstTime) * (plot.right - plot.left);
  const y = number => plot.top + (scale.high - number) / (scale.high - scale.low) * (plot.bottom - plot.top);
  const xs = times.map(x);

  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${CHART.height}`, width, height: CHART.height, class: 'balance-chart', role: 'img' });
  svg.setAttribute('aria-label', `Balance ${mode === 'percent' ? 'growth' : 'chart'}: ${usable.length} points, from ${exact(values[0])} on ${date(firstTime)} to ${exact(values.at(-1))} on ${date(lastTime)}`);

  for (let tick = scale.low; tick <= scale.high + scale.step / 2; tick += scale.step) {
    svg.append(
      svgElement('line', { x1: plot.left, x2: plot.right, y1: y(tick), y2: y(tick), class: Math.abs(tick) < scale.step / 2 && scale.low < 0 ? 'chart-zero' : 'chart-grid' }),
      svgElement('text', { x: plot.left - 10, y: y(tick) + 4, class: 'chart-label', 'text-anchor': 'end' }, axis(tick)));
  }

  const dateTicks = Math.max(1, Math.min(6, Math.floor((plot.right - plot.left) / CHART.minTickGap)));
  for (let index = 0; index <= dateTicks && lastTime !== firstTime; index++) {
    const time = firstTime + (lastTime - firstTime) * index / dateTicks;
    svg.append(svgElement('text', {
      x: x(time), y: CHART.height - 10, class: 'chart-label',
      'text-anchor': index === 0 ? 'start' : index === dateTicks ? 'end' : 'middle',
    }, date(time)));
  }

  const line = xs.map((px, index) => `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${y(values[index]).toFixed(1)}`).join(' ');
  const gradientId = `chart-wash-${++chartIds}`;
  const gradient = svgElement('linearGradient', { id: gradientId, x1: 0, x2: 0, y1: 0, y2: 1 });
  gradient.append(
    svgElement('stop', { offset: '0%', class: 'chart-wash-top' }),
    svgElement('stop', { offset: '100%', class: 'chart-wash-bottom' }));
  const defs = svgElement('defs');
  defs.append(gradient);
  svg.append(
    defs,
    svgElement('path', { d: `${line} L${xs.at(-1).toFixed(1)},${plot.bottom} L${xs[0].toFixed(1)},${plot.bottom} Z`, fill: `url(#${gradientId})` }),
    svgElement('path', { d: line, class: 'chart-line' }));

  const [endX, endY] = [xs.at(-1), y(values.at(-1))];
  svg.append(
    svgElement('circle', { cx: endX, cy: endY, r: 4.5, class: 'chart-dot' }),
    svgElement('text', { x: endX, y: Math.max(endY - 12, 12), class: 'chart-end-label', 'text-anchor': 'end' }, exact(values.at(-1))));

  const cursor = svgElement('line', { y1: plot.top, y2: plot.bottom, class: 'chart-cursor', visibility: 'hidden' });
  const dot = svgElement('circle', { r: 5, class: 'chart-dot', visibility: 'hidden' });
  svg.append(cursor, dot);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  svg.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect();
    const index = nearestIndex(xs, (event.clientX - box.left) / box.width * width);
    const [px, py] = [xs[index], y(values[index])];
    cursor.setAttribute('x1', px);
    cursor.setAttribute('x2', px);
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');

    const change = index > 0 ? values[index] - values[index - 1] : null;
    const time = document.createElement('span');
    time.className = 'chart-tip-time';
    time.textContent = `${formatUtcSeconds(usable[index].time)} UTC`;
    const amount = document.createElement('strong');
    amount.textContent = exact(values[index]);
    tip.replaceChildren(time, amount);
    if (change !== null) {
      const delta = document.createElement('span');
      delta.className = `chart-tip-change ${change > 0 ? 'pos' : change < 0 ? 'neg' : ''}`;
      delta.textContent = `${change > 0 ? '+' : change < 0 ? '−' : '±'}${exact(Math.abs(change))}`;
      tip.append(delta);
    }
    tip.hidden = false;
    const [cx, cy] = [px * box.width / width, py * box.height / CHART.height];
    const flip = cx + 14 + tip.offsetWidth > box.width;
    tip.style.left = `${svg.offsetLeft + (flip ? Math.max(cx - tip.offsetWidth - 14, 0) : cx + 14)}px`;
    tip.style.top = `${svg.offsetTop + Math.max(cy - tip.offsetHeight - 12, 0)}px`;
  });
  svg.addEventListener('pointerleave', () => {
    cursor.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });

  container.replaceChildren(svg, tip);
}
