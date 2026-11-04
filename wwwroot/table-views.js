// Saved table views: a view is a named layout of one table (its hidden columns and sort order) kept per account on the
// server, so it follows the user to any browser. A table opens with its default view, if it has one. renderTable (api.js)
// calls into this file for every table that has tools and an id (or data-view-key).

const VIEW_LIMIT_MESSAGE = 'Could not reach the saved views.';
const tableViewCache = new Map();
const waitingTables = [];
let tableViewsLoaded = false;
let tableViewsLoading;

function tableViewKey(container, options) {
  const id = options.viewKey ?? container.dataset.viewKey ?? container.id;
  return id ? `${location.pathname}:${id}` : null;
}

function viewsOf(key) {
  return tableViewCache.get(key) ?? [];
}

function storeView(view) {
  const views = viewsOf(view.tableKey).filter(item => item.id !== view.id && item.name.toLowerCase() !== view.name.toLowerCase());
  if (view.isDefault) for (const item of views) item.isDefault = false;
  views.push(view);
  views.sort((a, b) => a.name.localeCompare(b.name));
  tableViewCache.set(view.tableKey, views);
}

function loadTableViews() {
  tableViewsLoading ??= panelRequest('GET', `table-views${toQueryString({ prefix: `${location.pathname}:` })}`)
    .then(list => {
      tableViewCache.clear();
      for (const view of list) storeView(view);
    })
    .catch(() => {})
    .finally(() => {
      tableViewsLoaded = true;
      for (const waiting of waitingTables.splice(0)) {
        if (applyDefaultView(waiting.state, waiting.key, waiting.columns, waiting.serverSort)) waiting.redraw();
      }
    });
  return tableViewsLoading;
}

function standardHidden(columns) {
  return new Set(columns.filter(column => column.hiddenByDefault).map(columnId));
}

const sameText = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// Puts a view's hidden columns and sort into the table's state. A server-sorted table cannot sort itself, so its sort is
// left in state.pendingSort for renderTable to hand to the page after drawing.
function applyViewToState(state, view, columns, serverSort) {
  const known = new Set(columns.map(columnId));
  const hidden = new Set((view.config.hidden ?? []).filter(id => known.has(id)));
  if (hidden.size < columns.length) state.hidden = hidden;
  state.viewId = view.id;
  const sort = view.config.sort;
  if (!sort) return;
  if (serverSort) {
    state.pendingSort = sort;
    return;
  }
  const index = columns.findIndex(column => column.title === sort.item);
  if (index >= 0) {
    state.sortIndex = index;
    state.direction = sort.direction;
  }
}

function applyDefaultView(state, key, columns, serverSort) {
  const view = viewsOf(key).find(item => item.isDefault);
  if (!view) return false;
  applyViewToState(state, view, columns, serverSort);
  return true;
}

// Called when a table's state is created. The default view is applied now if the views are loaded, otherwise when they are.
function initTableView(state, key, columns, serverSort, redraw) {
  state.standardSort = serverSort ? { item: serverSort.item, direction: serverSort.direction } : null;
  if (tableViewsLoaded) applyDefaultView(state, key, columns, serverSort);
  else {
    waitingTables.push({ state, key, columns, serverSort, redraw });
    loadTableViews();
  }
}

// After a draw: hands a server-sorted table the sort of the view just applied, once.
function finishTableView(state, serverSort, container) {
  const sort = state.pendingSort;
  state.pendingSort = null;
  if (!sort || !serverSort || (sameText(serverSort.item, sort.item) && sameText(serverSort.direction, sort.direction))) return;
  guarded(container, async () => serverSort.onChange(sort.item, sort.direction));
}

function currentViewConfig(state, columns, serverSort) {
  const sort = serverSort
    ? serverSort.item ? { item: serverSort.item, direction: sameText(serverSort.direction, 'asc') ? 'Asc' : 'Desc' } : null
    : state.sortIndex >= 0 ? { item: columns[state.sortIndex].title, direction: state.direction } : null;
  return { hidden: [...state.hidden], sort };
}

function viewButton(text, onClick, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  if (danger) button.className = 'danger';
  button.addEventListener('click', onClick);
  return button;
}

// The "Views" menu of a table: apply, update, make default, delete, and save the current layout as a new view.
function viewsMenu(state, key, columns, serverSort, redraw) {
  const details = document.createElement('details');
  details.className = 'column-picker views-picker';
  details.open = Boolean(state.viewsOpen);
  details.addEventListener('toggle', () => { state.viewsOpen = details.open; });
  const views = viewsOf(key);
  const active = views.find(view => view.id === state.viewId);
  const summary = document.createElement('summary');
  summary.textContent = active ? `View: ${active.name}` : 'Views';
  const menu = document.createElement('div');
  menu.className = 'column-picker-menu views-menu';

  const run = async (action, doneText) => {
    try {
      await action();
      if (doneText) toast(doneText, 'success');
      redraw();
    } catch (error) {
      toast(error instanceof ApiError && error.message ? error.message : VIEW_LIMIT_MESSAGE, 'error');
    }
  };

  const save = (name, doneText) => run(async () => {
    const saved = await panelRequest('PUT', 'table-views', { tableKey: key, name, config: currentViewConfig(state, columns, serverSort) });
    storeView(saved);
    state.viewId = saved.id;
  }, doneText);

  const standard = viewButton('Standard layout', () => {
    state.hidden = standardHidden(columns);
    state.viewId = null;
    state.sortIndex = -1;
    state.direction = 'Asc';
    if (serverSort && state.standardSort?.item) state.pendingSort = state.standardSort;
    redraw();
  });
  standard.className = 'view-standard';
  menu.append(standard);

  for (const view of views) {
    const row = document.createElement('div');
    row.className = 'view-row';
    const name = viewButton(`${view.id === state.viewId ? '● ' : ''}${view.name}${view.isDefault ? ' (default)' : ''}`, () => {
      applyViewToState(state, view, columns, serverSort);
      redraw();
    });
    name.className = 'view-name';
    row.append(
      name,
      viewButton('Update', () => save(view.name, `The view ${view.name} is updated.`)),
      viewButton(view.isDefault ? 'Unset default' : 'Make default', () => {
        const makeDefault = !view.isDefault;
        return run(async () => {
          await panelRequest(makeDefault ? 'POST' : 'DELETE', `table-views/${view.id}/default`);
          for (const item of views) item.isDefault = makeDefault && item.id === view.id;
        }, makeDefault ? `${view.name} opens by default.` : 'No default view.');
      }),
      viewButton('Delete', async () => {
        if (!await confirmAction({ title: `Delete the view ${view.name}?`, confirmText: 'Delete', danger: true })) return;
        await run(async () => {
          await panelRequest('DELETE', `table-views/${view.id}`);
          tableViewCache.set(key, views.filter(item => item.id !== view.id));
          if (state.viewId === view.id) state.viewId = null;
        }, `The view ${view.name} is deleted.`);
      }, true));
    menu.append(row);
  }

  const form = document.createElement('form');
  form.className = 'view-save';
  const input = document.createElement('input');
  input.maxLength = 40;
  input.placeholder = 'Save this layout as...';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'View name');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Save';
  form.append(input, submit);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    if (name) save(name, `The view ${name} is saved.`);
  });
  menu.append(form);

  details.append(summary, menu);
  return details;
}
