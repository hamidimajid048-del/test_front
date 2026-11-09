// A searchable multi-select dropdown. The chosen values are kept in the field's hidden input joined by "|", so the page
// query string and the form state need no special handling; nothing chosen means all. splitPicked turns the text back
// into the list the API takes.

const MULTI_PICKER_SEPARATOR = '|';
const MULTI_PICKER_MAX_ROWS = 300;

function splitPicked(text) {
  return String(text ?? '').split(MULTI_PICKER_SEPARATOR).map(item => item.trim()).filter(Boolean);
}

function initMultiPicker(field) {
  const input = field.querySelector('input[type="hidden"]');
  const button = field.querySelector('button');
  let choices = [];
  let menu = null;

  function showSelection() {
    const names = splitPicked(input.value);
    button.textContent = names.length === 0 ? 'All' : names.length <= 2 ? names.join(', ') : `${names.length} selected`;
    button.title = names.join(', ');
    button.classList.toggle('has-selection', names.length > 0);
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
    const selected = new Set(splitPicked(input.value));
    const element = document.createElement('div');
    element.className = 'device-type-menu multi-picker-menu';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search';
    search.autocomplete = 'off';
    const list = document.createElement('div');
    list.className = 'multi-picker-list';

    const commit = () => {
      input.value = [...selected].join(MULTI_PICKER_SEPARATOR);
      showSelection();
    };

    let shown = [];
    function renderList() {
      const text = search.value.trim().toLowerCase();
      const names = [...new Set([...selected, ...choices])];
      shown = names.filter(name => name.toLowerCase().includes(text));
      const rows = shown.slice(0, MULTI_PICKER_MAX_ROWS).map(name => {
        const label = document.createElement('label');
        label.className = 'device-type-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = selected.has(name);
        box.addEventListener('change', () => {
          if (box.checked) selected.add(name);
          else selected.delete(name);
          commit();
        });
        label.append(box, document.createTextNode(name));
        return label;
      });
      if (shown.length > MULTI_PICKER_MAX_ROWS) {
        const more = document.createElement('p');
        more.className = 'multi-picker-more';
        more.textContent = `${shown.length - MULTI_PICKER_MAX_ROWS} more, type to narrow the list`;
        rows.push(more);
      }
      if (shown.length === 0) {
        const none = document.createElement('p');
        none.className = 'multi-picker-more';
        none.textContent = choices.length === 0 ? 'Loading...' : 'Nothing found';
        rows.push(none);
      }
      list.replaceChildren(...rows);
    }

    const actions = document.createElement('div');
    actions.className = 'multi-picker-actions';
    const selectShown = document.createElement('button');
    selectShown.type = 'button';
    selectShown.textContent = 'Select shown';
    selectShown.addEventListener('click', () => {
      for (const name of shown) selected.add(name);
      commit();
      renderList();
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear (all)';
    clear.addEventListener('click', () => {
      selected.clear();
      commit();
      renderList();
    });
    actions.append(selectShown, clear);

    search.addEventListener('input', renderList);
    element.append(search, list, actions);
    element.refresh = renderList;
    renderList();
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

  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', open);
  showSelection();
  return {
    sync: showSelection,
    setChoices(names) {
      choices = names;
      menu?.refresh();
    },
  };
}
