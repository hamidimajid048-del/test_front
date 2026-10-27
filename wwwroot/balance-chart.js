// A line chart of the balance after each deal, drawn as SVG. points: [{ time, balance, growthPercent }];
// mode: 'amount' plots the balance, 'percent' its growth against the start balance.

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART = { width: 900, height: 320, left: 64, right: 16, top: 16, bottom: 32, ticks: 5 };

function svgElement(name, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

const chartNumber = (value, digits = 2) => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Rounded axis limits and step around [min, max].
function niceScale(min, max) {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / CHART.ticks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough);
  return { low: Math.floor(min / step) * step, high: Math.ceil(max / step) * step, step };
}

function renderBalanceChart(container, points, mode) {
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
  const format = number => mode === 'percent' ? `${chartNumber(number)}%` : chartNumber(number);
  const times = usable.map(point => new Date(point.time).getTime());
  const [firstTime, lastTime] = [times[0], times[times.length - 1]];
  const scale = niceScale(Math.min(...usable.map(value)), Math.max(...usable.map(value)));
  const innerWidth = CHART.width - CHART.left - CHART.right;
  const innerHeight = CHART.height - CHART.top - CHART.bottom;
  const x = index => CHART.left + (lastTime === firstTime ? innerWidth / 2 : (times[index] - firstTime) / (lastTime - firstTime) * innerWidth);
  const y = number => CHART.top + (scale.high - number) / (scale.high - scale.low) * innerHeight;

  const svg = svgElement('svg', { viewBox: `0 0 ${CHART.width} ${CHART.height}`, class: 'balance-chart', role: 'img' });
  for (let tick = scale.low; tick <= scale.high + scale.step / 2; tick += scale.step) {
    svg.append(
      svgElement('line', { x1: CHART.left, x2: CHART.width - CHART.right, y1: y(tick), y2: y(tick), class: 'chart-grid' }),
      svgElement('text', { x: CHART.left - 8, y: y(tick) + 4, class: 'chart-label', 'text-anchor': 'end' }, format(tick)));
  }
  for (let index = 0; index <= CHART.ticks; index++) {
    const time = firstTime + (lastTime - firstTime) * index / CHART.ticks;
    svg.append(svgElement('text', {
      x: CHART.left + innerWidth * index / CHART.ticks, y: CHART.height - 8, class: 'chart-label',
      'text-anchor': index === 0 ? 'start' : index === CHART.ticks ? 'end' : 'middle',
    }, new Date(time).toISOString().slice(0, 10)));
  }
  if (scale.low < 0 && scale.high > 0) svg.append(svgElement('line', { x1: CHART.left, x2: CHART.width - CHART.right, y1: y(0), y2: y(0), class: 'chart-zero' }));

  const path = usable.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value(point)).toFixed(1)}`).join(' ');
  svg.append(svgElement('path', { d: path, class: 'chart-line' }));

  const cursor = svgElement('line', { y1: CHART.top, y2: CHART.height - CHART.bottom, class: 'chart-cursor', visibility: 'hidden' });
  const dot = svgElement('circle', { r: 4, class: 'chart-dot', visibility: 'hidden' });
  const tip = svgElement('text', { class: 'chart-tip', visibility: 'hidden' });
  svg.append(cursor, dot, tip);

  svg.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect();
    const target = (event.clientX - box.left) / box.width * CHART.width;
    let nearest = 0;
    for (let index = 1; index < usable.length; index++)
      if (Math.abs(x(index) - target) < Math.abs(x(nearest) - target)) nearest = index;
    const point = usable[nearest];
    const [px, py] = [x(nearest), y(value(point))];
    cursor.setAttribute('x1', px);
    cursor.setAttribute('x2', px);
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    tip.setAttribute('x', Math.min(Math.max(px, CHART.left + 90), CHART.width - CHART.right - 90));
    tip.setAttribute('y', Math.max(py - 10, CHART.top + 12));
    tip.setAttribute('text-anchor', 'middle');
    tip.textContent = `${formatUtc(point.time)}  ${format(value(point))}`;
    for (const item of [cursor, dot, tip]) item.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('pointerleave', () => {
    for (const item of [cursor, dot, tip]) item.setAttribute('visibility', 'hidden');
  });

  container.replaceChildren(svg);
}
