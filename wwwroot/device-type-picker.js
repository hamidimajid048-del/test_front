// A multi-select popup for the device type filter. The form keeps the chosen types in one hidden input (joined by "|"),
// so the page query string, the form state and the report links need no special handling; splitDeviceTypes turns the
// text back into the list the API takes. The choices are the device types recorded in the database.

const DEVICE_TYPE_SEPARATOR = '|';

function splitDeviceTypes(text) {
  return String(text ?? '').split(DEVICE_TYPE_SEPARATOR).map(item => item.trim()).filter(Boolean);
}

function initDeviceTypePicker(form, loadChoices) {
  const input = form.elements.deviceType;
  const button = form.querySelector('.device-type-button');
  let choices = null;

  function showSelection() {
    const selected = splitDeviceTypes(input.value);
    button.textContent = selected.length === 0 ? 'Any' : selected.length === 1 ? selected[0] : `${selected.length} selected`;
    button.title = selected.join(', ');
    button.classList.toggle('has-selection', selected.length > 0);
  }

  async function open() {
    try {
      choices ??= await loadChoices();
    } catch (error) {
      toast(error.message || UNAVAILABLE_MESSAGE, 'error');
      return;
    }

    const selected = new Set(splitDeviceTypes(input.value));
    for (const type of selected) {
      if (!choices.includes(type)) choices = [...choices, type].sort();
    }

    const dialog = document.createElement('dialog');
    dialog.className = 'panel-dialog device-type-dialog';
    const heading = document.createElement('h3');
    heading.textContent = 'Device types';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search...';
    search.autocomplete = 'off';
    search.setAttribute('aria-label', 'Search device types');
    const count = document.createElement('p');
    count.className = 'device-type-count';
    const list = document.createElement('div');
    list.className = 'device-type-list';

    const rows = choices.map(type => {
      const label = document.createElement('label');
      label.className = 'device-type-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected.has(type);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(type);
        else selected.delete(type);
        showCount();
      });
      label.append(box, platformLabel(type));
      list.append(label);
      return { type, label, box };
    });

    const visibleRows = () => rows.filter(row => !row.label.hidden);
    function showCount() {
      count.textContent = `${selected.size} selected of ${rows.length}`;
    }
    search.addEventListener('input', () => {
      const text = search.value.trim().toLowerCase();
      for (const row of rows) row.label.hidden = text !== '' && !row.type.toLowerCase().includes(text);
      empty.hidden = visibleRows().length > 0;
    });

    const empty = document.createElement('p');
    empty.textContent = 'No device type matches.';
    empty.hidden = rows.length > 0;
    if (rows.length === 0) empty.textContent = 'No device types are recorded yet.';

    const setVisible = checked => {
      for (const row of visibleRows()) {
        row.box.checked = checked;
        if (checked) selected.add(row.type);
        else selected.delete(row.type);
      }
      showCount();
    };
    const quick = document.createElement('div');
    quick.className = 'device-type-quick';
    const selectAll = document.createElement('button');
    selectAll.type = 'button';
    selectAll.textContent = 'Select all';
    selectAll.addEventListener('click', () => setVisible(true));
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => setVisible(false));
    quick.append(selectAll, clear);

    const buttons = document.createElement('div');
    buttons.className = 'dialog-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => dialog.close('cancel'));
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'confirm';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => dialog.close('apply'));
    buttons.append(cancel, apply);

    dialog.append(heading, search, quick, count, list, empty, buttons);
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'apply') {
        input.value = choices.filter(type => selected.has(type)).join(DEVICE_TYPE_SEPARATOR);
        showSelection();
      }
      dialog.remove();
    });
    showCount();
    document.body.append(dialog);
    dialog.showModal();
    search.focus();
  }

  button.addEventListener('click', open);
  showSelection();
  return { sync: showSelection };
}
