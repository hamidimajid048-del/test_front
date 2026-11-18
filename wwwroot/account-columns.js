// Name, group, email and balance of the logins in a report. The service fills them from the MetaTrader backup and
// sorts, filters and exports them like the report's other columns.

const NO_ACCOUNT_VALUE = '—';

// An account MetaTrader no longer has is archived, never deleted. A service published before the field was renamed
// still sends isDeleted.
function accountName(name, row) {
  const archived = row.isArchived ?? row.isDeleted;
  if (archived == null) return 'Not found';
  if (!name) return NO_ACCOUNT_VALUE;
  return archived ? `${name} (archived)` : name;
}

function accountBalance(value) {
  return value == null
    ? NO_ACCOUNT_VALUE
    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function accountColumns(hidden = []) {
  return [
    { key: 'name', title: 'Name', sortKey: 'Name', format: accountName },
    { key: 'group', title: 'Group', sortKey: 'Group' },
    { key: 'email', title: 'Email', sortKey: 'Email' },
    { key: 'balance', title: 'Balance', sortKey: 'Balance', format: accountBalance },
  ].map(column => (hidden.includes(column.key) ? { ...column, hiddenByDefault: true } : column));
}
