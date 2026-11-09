// A table whose sort, column filters and page are read from one service endpoint, shared by the pages that report on
// several logins at once (email logins, compare emails).

const DEFAULT_PAGE_SIZE = 1000;
const SERVICE_MAX_PAGE_SIZE = 2000;

// options: { path, columns (array, or a function returning it), sort: { item, direction }, containerId, pagerId,
// titleId?, title?, onRowClick?, onRendered?(report), read?(params) (defaults to the service API), exportName? (adds
// CSV / Excel buttons that download every page of the report), exportPageSize? (the largest page the endpoint serves) }
function createReportGrid({ path, columns, sort, containerId, pagerId, titleId, title, onRowClick, onRendered, read = params => apiGet(path, params), exportName, exportPageSize = SERVICE_MAX_PAGE_SIZE }) {
  const container = document.getElementById(containerId);
  const pagerContainer = document.getElementById(pagerId);
  const titleElement = titleId ? document.getElementById(titleId) : null;
  let params = null;
  let sortState = { ...sort };
  let filters = {};
  let pageSize = DEFAULT_PAGE_SIZE;

  const query = (page, size) => ({
    ...params, sortItem: sortState.item, sortDirection: sortState.direction,
    ...columnFilterParams(filters), currentPage: page, pageSize: size,
  });

  async function readAll(request, onProgress) {
    const rows = [];
    for (let page = 1; ; page++) {
      const report = await read({ ...request, currentPage: page, pageSize: exportPageSize });
      for (const item of report.items) rows.push(item);
      onProgress(rows.length);
      const totalPages = pagingOf(report.paging)?.totalPages ?? page;
      if (report.items.length === 0 || page >= totalPages) return rows;
    }
  }

  async function load(page = 1, size = pageSize) {
    pageSize = size;
    const request = query(page, pageSize);
    const report = await read(request);
    const paging = pagingOf(report.paging);
    const total = paging?.totalRecords ?? report.items.length;
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
      ...(exportName ? { export: { name: exportName, all: { total, read: onProgress => readAll(request, onProgress) } } } : {}),
    });
    renderPager(pagerContainer, paging, load);
    if (titleElement) titleElement.textContent = `${title} (${total.toLocaleString('en-US')})`;
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
