// Audit log page: every recorded event (/panel-api/audit) with filters by account, event kind and time.

const form = document.getElementById('audit-form');

function auditKind(event) {
  if (event.includes('failed') || event.includes('locked') || event.includes('deleted') || event.includes('disabled')) return 'danger';
  if (event.includes('succeeded')) return 'ok';
  return 'muted';
}

const COLUMNS = [
  utcColumn('occurredAt', 'Time'),
  { key: 'event', title: 'Event', format: value => badge(value.replaceAll('_', ' '), auditKind(value)) },
  { key: 'username', title: 'Account' },
  { key: 'detail', title: 'Detail' },
  { key: 'ipAddress', title: 'IP' },
  { key: 'userAgent', title: 'Client', format: value => (value ? value.slice(0, 80) : '') },
];

async function load() {
  const values = formValues(form);
  const params = {
    username: values.username || undefined,
    eventPrefix: values.eventPrefix || undefined,
    from: values.from ? new Date(values.from + 'Z').toISOString() : undefined,
    to: values.to ? new Date(values.to + 'Z').toISOString() : undefined,
    limit: values.limit,
  };
  try {
    const entries = await panelRequest('GET', `audit${toQueryString(params)}`);
    const counts = new Map();
    for (const entry of entries) counts.set(entry.event, (counts.get(entry.event) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    document.getElementById('audit-summary').replaceChildren(...[['Entries', String(entries.length)], ...top.map(([event, count]) => [event.replaceAll('_', ' '), String(count)])].map(([label, value]) => {
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = label;
      span.append(strong, ' ', value);
      return span;
    }));
    renderTable(document.getElementById('audit'), COLUMNS, entries, undefined, { export: { name: 'panel-audit-log' }, viewKey: 'audit' });
    if (!entries.length) document.getElementById('audit').replaceChildren(Object.assign(document.createElement('p'), { className: 'empty-note', textContent: 'No entry matches.' }));
  } catch (error) {
    if (error.message) toast(error.message, 'error');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  load();
});

renderMenu();
currentAccount().then(me => {
  if (can(me, 'audit.view')) load();
});
