// A table whose sort, column filters and page are read from one service endpoint, shared by the pages that report on
// several logins at once (email logins, compare emails).

const DEFAULT_PAGE_SIZE = 100;

// options: { path, columns (array, or a function returning it), sort: { item, direction }, containerId, pagerId,
// titleId?, title?, onRowClick?, onRendered?(report) }
function createReportGrid({ path, columns, sort, containerId, pagerId, titleId, title, onRowClick, onRendered }) {
  const container = document.getElementById(containerId);
  const pagerContainer = document.getElementById(pagerId);
  const titleElement = titleId ? document.getElementById(titleId) : null;
  let params = null;
  let sortState = { ...sort };
  let filters = {};
  let pageSize = DEFAULT_PAGE_SIZE;

  async function load(page = 1, size = pageSize) {
    pageSize = size;
    const report = await apiGet(path, {
      ...params, sortItem: sortState.item, sortDirection: sortState.direction,
      ...columnFilterParams(filters), currentPage: page, pageSize,
    });
    const paging = pagingOf(report.paging);
    renderTable(container, typeof columns === 'function' ? columns() : columns, report.items, onRowClick, {
      sort: {
        item: sortState.item,
        direction: sortState.direction,
        onChange: (item, direction) => {
          sortState = { item, direction };
          return load(1);
        },
      },
      filter: {
        values: filters,
        onChange: values => {
          filters = values;
          return load(1);
        },
      },
    });
    renderPager(pagerContainer, paging, load);
    if (titleElement) titleElement.textContent = `${title} (${(paging?.totalRecords ?? report.items.length).toLocaleString('en-US')})`;
    onRendered?.(report);
    return report;
  }

  return {
    start(searchParams) {
      params = searchParams;
      sortState = { ...sort };
      filters = {};
      return load(1, DEFAULT_PAGE_SIZE);
    },
    filterBy(key, value) {
      filters = { [key]: value };
      return load(1);
    },
    clear() {
      clearPager(pagerContainer);
      container.replaceChildren();
      if (titleElement) titleElement.textContent = title;
    },
  };
}
