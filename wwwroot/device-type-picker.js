// A multi-select dropdown for the device type filter. The form keeps the chosen types in one hidden input (joined by "|"),
// so the page query string, the form state and the report links need no special handling; splitDeviceTypes turns the
// text back into the list the API takes. The service maps each choice to the platform names it stands for (Mobile is
// Android and iPhone, Client the desktop application, VPS its VPS build); the manager, admin and data feed platforms have no choice.

const DEVICE_TYPE_CHOICES = [
  { value: 'Mobile', label: 'Mobile (Android, iPhone)', kind: 'mobile' },
  { value: 'Client', label: 'Client (desktop application)', kind: 'system' },
  { value: 'Vps', label: 'VPS', kind: 'system' },
  { value: 'Unknown', label: 'Unknown', kind: null },
];

const DEVICE_TYPE_SEPARATOR = '|';

function splitDeviceTypes(text) {
  return String(text ?? '').split(DEVICE_TYPE_SEPARATOR).map(item => item.trim()).filter(Boolean);
}

function initDeviceTypePicker(form) {
  const input = form.elements.deviceType;
  const field = form.querySelector('.device-type-field');
  const button = field.querySelector('.device-type-button');
  let menu = null;

  function showSelection() {
    const selected = splitDeviceTypes(input.value);
    const names = DEVICE_TYPE_CHOICES.filter(choice => selected.includes(choice.value)).map(choice => choice.value);
    button.textContent = names.length === 0 ? 'Any' : names.length === DEVICE_TYPE_CHOICES.length ? 'All'
      : names.length <= 2 ? names.join(', ') : `${names.length} selected`;
    button.title = names.join(', ');
    button.classList.toggle('has-selection', names.length > 0 && names.length < DEVICE_TYPE_CHOICES.length);
  }

  function close() {
    menu?.remove();
    menu = null;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(event) {
    if (!field.contains(event.target)) close();
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  }

  function buildMenu() {
    const selected = new Set(splitDeviceTypes(input.value));
    const element = document.createElement('div');
    element.className = 'device-type-menu';

    const commit = () => {
      input.value = DEVICE_TYPE_CHOICES.filter(choice => selected.has(choice.value)).map(choice => choice.value).join(DEVICE_TYPE_SEPARATOR);
      showSelection();
    };

    const boxes = DEVICE_TYPE_CHOICES.map(choice => {
      const label = document.createElement('label');
      label.className = 'device-type-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected.has(choice.value);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(choice.value);
        else selected.delete(choice.value);
        commit();
      });
      label.append(box);
      if (choice.kind) label.append(platformIcon(choice.kind));
      label.append(document.createTextNode(choice.label));
      element.append(label);
      return { value: choice.value, box };
    });

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      selected.clear();
      for (const { box } of boxes) box.checked = false;
      commit();
    });
    element.append(clear);
    return element;
  }

  function open() {
    if (menu) {
      close();
      return;
    }
    menu = buildMenu();
    field.append(menu);
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    menu.querySelector('input').focus();
  }

  if (!input.value) input.value = DEVICE_TYPE_CHOICES.map(choice => choice.value).join(DEVICE_TYPE_SEPARATOR);
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', open);
  showSelection();
  return { sync: showSelection };
}
