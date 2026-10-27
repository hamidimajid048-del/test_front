// A table over rows already in the browser: sort, column filters and paging are done here with the grid helpers of api.js
// (the panel's own MetaTrader lists, which the service does not page).

const LOCAL_PAGE_SIZE = 100;

// options: { containerId, pagerId, columns, sort?: { item, direction }, onRowClick? }
// Every column is sortable and filterable; its title is its sort key.
function createLocalGrid({ containerId, pagerId, columns, sort, onRowClick }) {
  const container = document.getElementById(containerId);
  const pagerContainer = document.getElementById(pagerId);
  const keyed = columns.map(column => ({ sortKey: column.title, ...column }));
  const initialSort = sort ?? null;
  let rows = [];
  let sortState = initialSort ? { ...initialSort } : { item: '', direction: 'Asc' };
  let filters = {};
  let paging = { currentPage: 1, pageSize: LOCAL_PAGE_SIZE };

  function view() {
    const active = keyed
      .map(column => [column, (filters[column.sortKey] ?? '').trim()])
      .filter(([, query]) => query);
    let result = active.length ? rows.filter(row => active.every(([column, query]) => matchesFilter(column, row, query))) : [...rows];
    const column = keyed.find(candidate => candidate.sortKey === sortState.item);
    if (column) {
      const sign = sortState.direction === 'Asc' ? 1 : -1;
      const sorted = result.map(row => [sortValue(column, row), row]);
      sorted.sort((a, b) => (a[0] === null || b[0] === null ? compareValues(a[0], b[0]) : sign * compareValues(a[0], b[0])));
      result = sorted.map(([, row]) => row);
    }
    return result;
  }

  function render() {
    const shown = view();
    const { pageSize } = paging;
    const totalPages = Math.max(Math.ceil(shown.length / pageSize), 1);
    const currentPage = Math.min(Math.max(paging.currentPage, 1), totalPages);
    paging = { currentPage, pageSize };
    const showPage = (page, size) => {
      paging = { currentPage: page, pageSize: size };
      render();
    };
    renderTable(container, keyed, shown.slice((currentPage - 1) * pageSize, currentPage * pageSize), onRowClick, {
      sort: {
        item: sortState.item,
        direction: sortState.direction,
        onChange: (item, direction) => {
          sortState = { item, direction };
          showPage(1, pageSize);
        },
      },
      filter: {
        values: filters,
        onChange: values => {
          filters = values;
          showPage(1, pageSize);
        },
      },
    });
    renderPager(pagerContainer, { pageSize, currentPage, totalPages, totalRecords: shown.length }, showPage);
  }

  return {
    setRows(next) {
      rows = next;
      sortState = initialSort ? { ...initialSort } : { item: '', direction: 'Asc' };
      filters = {};
      paging = { currentPage: 1, pageSize: paging.pageSize };
      render();
    },
    clear() {
      rows = [];
      clearPager(pagerContainer);
      container.replaceChildren();
    },
  };
}
