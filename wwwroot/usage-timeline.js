// A usage timeline of CIDs or IPs: one row per value with a bar from its first to its last sign-in (the tracker
// records sign-ins only, never sign-outs, so a bar is the span of use, not a session). For one login the bars are
// coloured by device type; when two logins are compared each row has a bar per login and a band where both spans meet.

const TIMELINE_KINDS = {
  mobile: { label: 'Mobile', className: 'ut-mobile' },
  system: { label: 'Desktop/Client', className: 'ut-desktop' },
  web: { label: 'Web', className: 'ut-web' },
  mixed: { label: 'Mixed', className: 'ut-other' },
  unknown: { label: 'Unknown', className: 'ut-other' },
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

// The device kind of a CID from its platforms ("Client Android, Client").
function timelineKind(deviceType) {
  const kinds = new Set(String(deviceType ?? '').split(',').map(platformKind).filter(Boolean));
  if (kinds.size === 0) return 'unknown';
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}

// Tick times between from and to: hours, days, weeks or whole months, so that about 4 to 10 ticks fit.
function timelineTicks(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const span = to - from;
  const fixed = [[HOUR_MS, 'hour'], [6 * HOUR_MS, 'hour'], [DAY_MS, 'day'], [7 * DAY_MS, 'day']].find(([step]) => span / step <= 10);
  if (fixed) {
    const [step, unit] = fixed;
    const ticks = [];
    for (let time = Math.ceil(from / step) * step; time <= to; time += step) ticks.push({ time, unit });
    return ticks;
  }
  const months = [1, 2, 3, 6, 12, 24].find(step => span / (step * 30 * DAY_MS) <= 10) ?? 24;
  const start = new Date(from);
  let year = start.getUTCFullYear();
  let month = Math.ceil((start.getUTCMonth() + (start.getUTCDate() > 1 || start.getUTCHours() > 0 ? 1 : 0)) / months) * months;
  const ticks = [];
  for (;;) {
    year += Math.floor(month / 12);
    month %= 12;
    const time = Date.UTC(year, month, 1);
    if (time > to) return ticks;
    ticks.push({ time, unit: 'month' });
    month += months;
  }
}

function tickLabel({ time, unit }) {
  const date = new Date(time);
  if (unit === 'month') return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const day = date.toISOString().slice(0, 10);
  return unit === 'hour' ? `${day.slice(5)} ${date.toISOString().slice(11, 16)}` : day;
}

// The risk flag labels of a geo record ("VPN", "Datacenter"); empty without a record.
const riskFlags = geo => geo ? WARNING_FLAGS.filter(flag => flag.isSet(geo)).map(flag => flag.label) : [];

// Tooltip lines for the latest geo record of an IP.
function geoLines(geo) {
  if (!geo) return ['Location: not recorded'];
  const risks = riskFlags(geo);
  const known = text => text && text.toLowerCase() !== 'unknown' ? text : null;
  return [
    `Location: ${[...new Set([geo.city, geo.region, geo.province, geo.country].map(known).filter(Boolean))].join(', ') || '—'}`,
    `ISP: ${geo.isp || geo.ispOrganization || '—'}`,
    geo.asn > 0 ? `ASN: ${geo.asn}${geo.asnOrganization ? ` · ${geo.asnOrganization}` : ''}` : null,
    `Risk flags: ${risks.length ? risks.join(', ') : 'none'}`,
  ];
}

const loginsText = count => `${Number(count).toLocaleString('en-US')} ${Number(count) === 1 ? 'login' : 'logins'}`;

// The use of a value by one login with its times parsed; null when the login never used it or its dates are invalid.
function parseUse(use) {
  if (!use) return null;
  const from = Date.parse(use.firstSeen);
  const to = Date.parse(use.lastSeen);
  return Number.isFinite(from) && Number.isFinite(to) ? { ...use, from, to, kind: timelineKind(use.deviceType) } : null;
}

// rows for one login: [{ value, firstSeen, lastSeen, sessionCount, deviceType?, geo? }].
// rows for two logins (options.sides = [{ name, login }, { name, login }]): [{ value, geo?, uses: [use|null, use|null] }],
// where a use is { firstSeen, lastSeen, sessionCount, deviceType? }.
// options.kind is 'cid' or 'ip'; options.onSelect(row) makes the rows clickable; options.empty replaces the empty text.
function renderUsageTimeline(container, rows, { kind, onSelect, sides, empty: emptyText } = {}) {
  const items = rows
    .map(row => {
      const uses = (sides ? row.uses : [row]).map(parseUse);
      const present = uses.filter(Boolean);
      return {
        ...row,
        uses,
        from: Math.min(...present.map(use => use.from)),
        to: Math.max(...present.map(use => use.to)),
        shared: present.length > 1,
      };
    })
    .filter(item => item.uses.some(Boolean))
    .sort((a, b) => b.shared - a.shared || a.from - b.from || a.to - b.to);
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = emptyText ?? `No ${kind === 'cid' ? 'CID' : 'IP'} was recorded for this login.`;
    container.replaceChildren(empty);
    return;
  }

  let start = Math.min(...items.map(item => item.from));
  let end = Math.max(...items.map(item => item.to));
  const pad = Math.max((end - start) * 0.02, HOUR_MS);
  start -= pad;
  end += pad;
  const percent = time => ((time - start) / (end - start)) * 100;
  const ticks = timelineTicks(start, end);
  // The time both logins used a value: from the later first sign-in to the earlier last one.
  const together = item => {
    if (!item.shared) return null;
    const from = Math.max(...item.uses.map(use => use.from));
    const to = Math.min(...item.uses.map(use => use.to));
    return from <= to ? { from, to } : null;
  };

  const root = document.createElement('div');
  root.className = 'usage-timeline';

  const legend = document.createElement('div');
  legend.className = 'ut-legend';
  const legendEntry = (className, text) => {
    const entry = document.createElement('span');
    const swatch = document.createElement('span');
    swatch.className = `ut-swatch ${className}`;
    entry.append(swatch, text);
    legend.append(entry);
  };
  if (sides) {
    sides.forEach((side, index) => legendEntry(`ut-side-${index}`, `${side.name} · ${side.login}`));
    if (items.some(together)) legendEntry('ut-together', 'Both logins in the same period');
  } else {
    const used = new Set(items.map(item => item.uses[0].kind));
    for (const key of ['mobile', 'system', 'web', 'mixed', 'unknown'].filter(key => used.has(key))) {
      legendEntry(TIMELINE_KINDS[key].className, TIMELINE_KINDS[key].label);
    }
  }
  root.append(legend);

  const chart = document.createElement('div');
  chart.className = sides ? 'ut-chart ut-compare' : 'ut-chart';
  chart.setAttribute('role', 'list');
  chart.setAttribute('aria-label', `${kind === 'cid' ? 'CID' : 'IP'} usage timeline: ${items.length} values`);

  const axisRow = top => {
    const axis = document.createElement('div');
    axis.className = top ? 'ut-axis ut-axis-top' : 'ut-axis';
    axis.setAttribute('aria-hidden', 'true');
    const axisTrack = document.createElement('span');
    axisTrack.className = 'ut-track';
    for (const tick of ticks) {
      const text = document.createElement('span');
      text.style.left = `${percent(tick.time)}%`;
      text.textContent = tickLabel(tick);
      axisTrack.append(text);
    }
    axis.append(document.createElement('span'), axisTrack);
    return axis;
  };
  // A long list also gets the dates above its first row, so they can be read without scrolling to the end.
  const offset = items.length > 12 ? 1 : 0;
  if (offset) {
    const top = axisRow(true);
    top.style.gridRow = '1';
    chart.append(top);
  }

  const grid = document.createElement('div');
  grid.className = 'ut-gridlines';
  grid.style.gridRow = `${1 + offset} / ${items.length + 1 + offset}`;
  grid.setAttribute('aria-hidden', 'true');
  for (const tick of ticks) {
    const line = document.createElement('span');
    line.style.left = `${percent(tick.time)}%`;
    grid.append(line);
  }
  chart.append(grid);

  const deviceText = use => `${TIMELINE_KINDS[use.kind].label}${use.deviceType ? ` · ${use.deviceType}` : ''}`;
  const tooltipLines = item => {
    if (!sides) {
      const use = item.uses[0];
      return [
        item.value,
        deviceText(use),
        ...(kind === 'ip' ? geoLines(item.geo) : []),
        `First sign-in: ${formatUtc(use.firstSeen)}`,
        `Last sign-in: ${formatUtc(use.lastSeen)}`,
        `Sign-ins: ${Number(use.sessionCount).toLocaleString('en-US')}`,
      ];
    }
    const both = together(item);
    return [
      item.value,
      ...(kind === 'ip' ? geoLines(item.geo) : []),
      ...item.uses.flatMap((use, index) => use
        ? [`${sides[index].name} ${sides[index].login}: ${loginsText(use.sessionCount)} · ${deviceText(use)}`,
          `  ${formatUtc(use.firstSeen)} → ${formatUtc(use.lastSeen)}`]
        : [`${sides[index].name} ${sides[index].login}: never used it`]),
      item.shared
        ? both
          ? `Both in the same period: ${formatUtc(new Date(both.from).toISOString())} → ${formatUtc(new Date(both.to).toISOString())}`
          : `Used by both, ${formatSpan((Math.max(...item.uses.map(use => use.from)) - Math.min(...item.uses.map(use => use.to))) / 1000)} apart`
        : null,
    ];
  };

  const tip = document.createElement('div');
  tip.className = 'ut-tip';
  tip.hidden = true;
  const showTip = (item, x, y) => {
    tip.replaceChildren(...[...tooltipLines(item), onSelect ? 'Click to see its sessions' : null].filter(Boolean).map((text, index) => {
      const line = document.createElement(index === 0 ? 'strong' : 'span');
      line.textContent = text;
      return line;
    }));
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(x + 14, window.innerWidth - box.width - 8)}px`;
    tip.style.top = `${Math.min(y + 14, window.innerHeight - box.height - 8)}px`;
  };

  const span = (from, to, className) => {
    const element = document.createElement('span');
    element.className = className;
    const left = percent(from);
    element.style.left = `min(${left}%, calc(100% - 6px))`;
    element.style.width = `${Math.max(percent(to) - left, 0)}%`;
    return element;
  };

  items.forEach((item, index) => {
    const row = document.createElement(onSelect ? 'button' : 'div');
    row.style.gridRow = String(index + 1 + offset);
    if (onSelect) {
      row.type = 'button';
      row.addEventListener('click', () => {
        tip.hidden = true;
        onSelect(item);
      });
    }
    row.className = 'ut-row';
    row.setAttribute('role', 'listitem');

    const label = document.createElement('span');
    label.className = 'ut-label';
    const shortValue = kind === 'cid' && item.value.length > 10 ? `${item.value.slice(0, 8)}…` : item.value;
    const counts = sides
      ? item.uses.map((use, side) => `${sides[side].name} ${use ? Number(use.sessionCount).toLocaleString('en-US') : 0}`).join(' · ')
      : loginsText(item.uses[0].sessionCount);
    const parts = [
      shortValue,
      sides ? null : TIMELINE_KINDS[item.uses[0].kind].label,
      kind === 'ip' ? item.geo?.country || null : null,
      counts,
      ...(kind === 'ip' ? riskFlags(item.geo).map(flag => `⚠ ${flag}`) : []),
    ];
    label.textContent = parts.filter(Boolean).join(' | ');

    const track = document.createElement('span');
    track.className = 'ut-track';
    const both = together(item);
    if (both) track.append(span(both.from, both.to, 'ut-band'));
    item.uses.forEach((use, side) => {
      if (!use) return;
      const className = sides ? `ut-side-${side} ut-lane-${side}` : TIMELINE_KINDS[use.kind].className;
      track.append(span(use.from, use.to, `ut-bar ${className}`));
    });

    row.setAttribute('aria-label', tooltipLines(item).filter(Boolean).join(', '));
    row.addEventListener('pointermove', event => showTip(item, event.clientX, event.clientY));
    row.addEventListener('pointerleave', () => { tip.hidden = true; });
    row.addEventListener('focus', () => {
      const box = track.getBoundingClientRect();
      showTip(item, box.left, box.bottom);
    });
    row.addEventListener('blur', () => { tip.hidden = true; });
    row.append(label, track);
    chart.append(row);
  });

  const bottom = axisRow(false);
  bottom.style.gridRow = String(items.length + 1 + offset);
  chart.append(bottom);

  const caption = document.createElement('p');
  caption.className = 'hint';
  caption.textContent = sides
    ? 'Each bar runs from the first to the last sign-in of a login with that value (UTC); values used by both logins come first. The tracker records sign-ins only, so a shared period means both used the value in that stretch of time, not that their sessions were open at the same moment.'
    : 'Each bar runs from the first to the last sign-in with that value (UTC). The tracker records sign-ins only, so gaps inside a bar are not shown.';

  root.append(chart, caption, tip);
  container.replaceChildren(root);
}
