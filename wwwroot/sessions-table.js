// Session rows (login, IP, CID, device, location, warnings) as shown by the login history and compare pages.

const yesNo = value => value === true ? 'Yes' : value === false ? 'No' : '—';

// "isHttpProxy" -> "Http proxy"
const flagLabel = key => {
  const words = key.replace(/^is/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// Short warning labels shown next to a session or an IP for risky geo flags.
const WARNING_FLAGS = [
  { label: 'VPN', isSet: geo => geo.isVpn },
  { label: 'Proxy', isSet: geo => geo.isHttpProxy },
  { label: 'Tor', isSet: geo => geo.isTorExit },
  { label: 'Datacenter', isSet: geo => geo.isDatacenter },
  { label: 'Blacklisted', isSet: geo => geo.isBlacklisted },
  { label: 'Bot', isSet: geo => geo.isBotAny || geo.isBotBotnet || geo.isBotFake },
];

const GEO_FIELDS = [
  ['continent', 'Continent'], ['country', 'Country'], ['city', 'City'], ['region', 'Region'], ['province', 'Province'],
  ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['asn', 'ASN'],
  ['asnOrganization', 'ASN organization'], ['isp', 'ISP'], ['ispOrganization', 'ISP organization'], ['detailsFlags', 'Details flags'],
];

const GEO_FLAGS = [
  'isTorExit', 'isHttpProxy', 'isVpn', 'isDatacenter', 'isAttackMail', 'isAttackSsh', 'isAttackWeb', 'isAttackApp',
  'isBotBotnet', 'isSearchEngine', 'isBlacklisted', 'isWebdriver', 'isBotAny', 'isBotFake',
];

// The warning labels of a geo record as badges; empty when there is no geo record or no flag is set.
function warningBadges(geo) {
  const flags = geo ? WARNING_FLAGS.filter(flag => flag.isSet(geo)) : [];
  return flags.length ? inline(...flags.map(flag => badge(flag.label, 'warn'))) : '';
}

const SESSION_COLUMNS = [
  utcColumn('loginAt', 'Login'),
  utcColumn('logoutAt', 'Logout'),
  { key: 'ip', title: 'IP' },
  { key: 'cid', title: 'CID' },
  { key: 'platform', title: 'Platform' },
  { key: 'accessPointName', title: 'Access Point' },
  { key: 'pingMs', title: 'Ping (ms)' },
  { key: 'isSessionValid', title: 'Session valid', format: yesNo },
  { key: 'isCidValid', title: 'CID valid', format: yesNo },
  { key: 'geo', title: 'Country / city', format: geo => geo ? [geo.country, geo.city].filter(Boolean).join(' / ') : '—' },
  { key: 'geo', title: 'Warnings', format: warningBadges },
];

// Shows every location field and flag of a session's geo record in `container`.
function renderGeoDetails(container, session) {
  const title = document.createElement('h3');
  title.textContent = `Location details — login at ${formatUtc(session.loginAt)} from ${session.ip}`;

  if (!session.geo) {
    const empty = document.createElement('p');
    empty.textContent = 'No location information available';
    container.replaceChildren(title, empty);
  } else {
    const rows = [
      ...GEO_FIELDS.map(([key, label]) => ({ label, value: session.geo[key] })),
      ...GEO_FLAGS.map(key => ({ label: flagLabel(key), value: yesNo(session.geo[key]) })),
    ];
    const table = document.createElement('div');
    renderTable(table, [{ key: 'label', title: 'Field' }, { key: 'value', title: 'Value' }], rows);
    container.replaceChildren(title, table);
  }
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
