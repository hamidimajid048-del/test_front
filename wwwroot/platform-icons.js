// Icons for the device type of a session: web (a globe), Android (the Android head), iOS (an apple), mobile (a phone,
// when the operating system is not known), system (a desktop client), and expert (a robot) for trades an expert
// advisor made.
// The icon is drawn beside the text and carries no text of its own, so sorting, filtering and exports use the text only.

const PLATFORM_KINDS = {
  web: {
    label: 'Web',
    paths: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>',
  },
  android: {
    label: 'Android',
    paths: '<path d="M4.5 18v-2.5a7.5 7.5 0 0 1 15 0V18z"/><path d="M7.5 9.5 5.5 6.5M16.5 9.5l2-3"/><path d="M9.2 14h.01M14.8 14h.01"/>',
  },
  ios: {
    label: 'iOS',
    paths: '<path d="M12 7.6c-1.2-.9-2.4-1.3-3.6-1.1C6.1 6.9 4.6 9 4.8 12.2c.3 4.2 2.9 8.6 5.1 8.3.9-.1 1.4-.6 2.1-.6s1.2.5 2.1.6c1.6.2 3.4-2.1 4.5-5-1.6-.7-2.6-2.1-2.6-3.8 0-1.6.9-2.9 2.2-3.6-.9-1.1-2.1-1.7-3.5-1.7-1.1 0-1.9.5-2.7 1.2z"/><path d="M12 7.6c-.2-1.9.8-3.7 2.7-4.4"/>',
  },
  mobile: {
    label: 'Mobile',
    paths: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  },
  system: {
    label: 'System',
    paths: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  },
  expert: {
    label: 'Expert',
    paths: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 8V5M9.5 12.5v1.5M14.5 12.5v1.5M9.5 16.5h5M2.5 12v3M21.5 12v3"/><circle cx="12" cy="3.8" r="1.2"/>',
  },
};

function platformKind(platform) {
  const text = String(platform ?? '').toLowerCase();
  if (!text.trim() || text.trim() === 'unknown') return null;
  if (/android/.test(text)) return 'android';
  if (/\bios\b|iphone|ipad/.test(text)) return 'ios';
  if (/mobile/.test(text)) return 'mobile';
  if (/web/.test(text)) return 'web';
  return 'system';
}

function platformIcon(kind) {
  const { label, paths } = PLATFORM_KINDS[kind];
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', `platform-icon ${kind}`);
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '16');
  icon.setAttribute('height', '16');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = paths;
  icon.dataset.label = label;
  return icon;
}

// One platform: its icon, then its text.
function platformLabel(platform) {
  const kind = platformKind(platform);
  if (!kind) return platform || '';
  const cell = document.createElement('span');
  cell.className = 'platform-cell';
  cell.title = PLATFORM_KINDS[kind].label;
  cell.append(platformIcon(kind), document.createTextNode(platform));
  return cell;
}

// Several platforms (a list, or one text such as "Client, Web"), each with its icon.
function platformList(platforms) {
  const items = (Array.isArray(platforms) ? platforms : String(platforms ?? '').split(','))
    .map(item => String(item).trim()).filter(Boolean);
  if (!items.length) return '';
  const list = document.createElement('span');
  list.className = 'platform-list';
  list.append(...items.map(platformLabel));
  return list;
}
