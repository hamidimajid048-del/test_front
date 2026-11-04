// Icons for the device type of a session: web (a globe), mobile (a phone: Android or iOS) and system (a desktop client).
// The icon is drawn beside the text and carries no text of its own, so sorting, filtering and exports use the text only.

const PLATFORM_KINDS = {
  web: {
    label: 'Web',
    paths: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/>',
  },
  mobile: {
    label: 'Mobile',
    paths: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  },
  system: {
    label: 'System',
    paths: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  },
};

function platformKind(platform) {
  const text = String(platform ?? '').toLowerCase();
  if (!text.trim() || text.trim() === 'unknown') return null;
  if (/android|\bios\b|iphone|ipad|mobile/.test(text)) return 'mobile';
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
