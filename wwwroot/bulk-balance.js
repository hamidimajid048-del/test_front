// Bulk deposit / withdraw page: a CSV of login, amount and comment is read here, checked by the panel against MetaTrader
// (/panel-api/mt5/account-balance/bulk/check, nothing is changed), and after a confirmation its Ready lines are sent in
// small chunks (/bulk/apply). Every line ends with its own result, which can be downloaded.

const MAX_LINES = 5000;
const CHUNK_SIZE = 100;
const SAMPLE = 'login,amount,comment\r\n3448358,100.00,Bonus November\r\n3448359,-50.25,Correction\r\n';

const fileForm = document.getElementById('file-form');
const message = document.getElementById('message');
const applyBar = document.getElementById('apply-bar');
const applyButton = document.getElementById('apply');
const rowsSection = document.getElementById('rows-section');

const STATUS = {
  Ready: ['Ready', 'main'],
  Invalid: ['Not sent: invalid', 'danger'],
  Done: ['Done', 'ok'],
  Failed: ['Failed', 'danger'],
  Unknown: ['Unknown', 'warn'],
  AlreadySent: ['Already sent', 'warn'],
};

const COLUMNS = [
  column('row', 'Line'),
  column('login', 'Login'),
  column('name', 'Name', value => value || '—'),
  column('group', 'Group', value => value || '—'),
  column('kind', 'Operation', value => value ?? '—'),
  column('value', 'Amount', value => (value === null || value === undefined ? '—' : money(value))),
  column('balance', 'Balance before', value => (value === null || value === undefined ? '—' : money(value))),
  column('comment', 'Comment'),
  column('status', 'Status', value => badge(...(STATUS[value] ?? [value, 'muted']))),
  column('deal', 'Deal', value => value || '—'),
  column('message', 'Message'),
];

let rows = [];
let batchId = null;
let fileName = 'bulk-balance';
let sending = false;

function splitLine(line, separator) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      cells.push(cell);
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

// The lines of the file as { row, login, amount, comment }; row is the line number in the file.
function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const first = lines.find(line => line.trim()) ?? '';
  const separator = first.includes(';') && !first.includes(',') ? ';' : ',';
  const parsed = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const cells = splitLine(line, separator);
    if (parsed.length === 0 && index === lines.indexOf(first) && !/^\d+$/.test(cells[0].trim())) return;
    parsed.push({ row: index + 1, login: (cells[0] ?? '').trim(), amount: (cells[1] ?? '').trim(), comment: cells.slice(2).join(separator).trim() });
  });
  return parsed;
}

const count = status => rows.filter(row => row.status === status).length;
const total = (status, kind) => rows.filter(row => row.status === status && row.kind === kind).reduce((sum, row) => sum + Number(row.value), 0);

function renderRows() {
  renderTable(document.getElementById('rows'), COLUMNS, rows, undefined, {
    export: { name: `${fileName}-result`, permission: 'account-data.balance-bulk' },
  });
  document.getElementById('rows-title').textContent = `Rows (${rows.length.toLocaleString('en-US')})`;
  rowsSection.hidden = false;

  const ready = count('Ready');
  const sent = ['Done', 'Failed', 'Unknown', 'AlreadySent'].some(status => count(status) > 0);
  const items = [['File', fileName], ['Lines', rows.length.toLocaleString('en-US')]];
  if (sent) {
    items.push(['Done', count('Done') + count('AlreadySent')], ['Failed', count('Failed')], ['Unknown', count('Unknown')],
      ['Invalid', count('Invalid')], ['Not sent', ready]);
    items.push(['Deposited', money(total('Done', 'Deposit'))], ['Withdrawn', money(total('Done', 'Withdrawal'))]);
  } else {
    items.push(['Ready', ready], ['Invalid', count('Invalid')]);
    items.push(['Deposits', `${rows.filter(row => row.status === 'Ready' && row.kind === 'Deposit').length} · ${money(total('Ready', 'Deposit'))}`]);
    items.push(['Withdrawals', `${rows.filter(row => row.status === 'Ready' && row.kind === 'Withdrawal').length} · ${money(total('Ready', 'Withdrawal'))}`]);
  }
  renderSummary(document.getElementById('summary'), items);

  applyBar.hidden = false;
  applyButton.hidden = ready === 0;
  applyButton.disabled = sending;
  applyButton.textContent = sent ? `Send the ${ready} remaining lines` : `Apply ${ready} ready lines`;
}

function reset() {
  rows = [];
  batchId = null;
  applyBar.hidden = true;
  rowsSection.hidden = true;
  document.getElementById('rows').replaceChildren();
  document.getElementById('summary').replaceChildren();
}

fileForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  clearMessages(fileForm, message);
  const file = fileForm.elements.file.files[0];
  if (!file) {
    showError(fileForm, message, new ApiError('Choose a CSV file first.'));
    return;
  }
  reset();
  const submitButton = fileForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const lines = parseCsv(await file.text());
    if (lines.length === 0) throw new ApiError('The file has no lines to send.');
    if (lines.length > MAX_LINES) throw new ApiError(`The file has ${lines.length.toLocaleString('en-US')} lines; send at most ${MAX_LINES.toLocaleString('en-US')} at a time.`);
    setLoading(message);
    rows = await panelRequest('POST', 'mt5/account-balance/bulk/check', { rows: lines });
    fileName = file.name.replace(/\.[^.]+$/, '') || 'bulk-balance';
    batchId = crypto.randomUUID();
    message.textContent = '';
    renderRows();
  } catch (error) {
    message.textContent = '';
    showError(fileForm, message, error instanceof ApiError ? error : new ApiError(UNAVAILABLE_MESSAGE));
  } finally {
    submitButton.disabled = false;
  }
});

applyButton.addEventListener('click', async () => {
  const ready = rows.filter(row => row.status === 'Ready');
  if (sending || ready.length === 0) return;
  const deposits = ready.filter(row => row.kind === 'Deposit');
  const withdrawals = ready.filter(row => row.kind === 'Withdrawal');
  const sum = list => money(list.reduce((value, row) => value + Number(row.value), 0));
  if (!await confirmAction({
    title: `Send ${ready.length} lines to MetaTrader?`,
    message: `${deposits.length} deposits, ${sum(deposits)} in total, and ${withdrawals.length} withdrawals, ${sum(withdrawals)} in total.`,
    confirmText: 'Send',
    danger: true,
  })) return;

  sending = true;
  fileForm.querySelector('button[type="submit"]').disabled = true;
  renderRows();
  const byRow = new Map(rows.map((row, index) => [row.row, index]));
  let sent = 0;
  try {
    for (let start = 0; start < ready.length; start += CHUNK_SIZE) {
      const chunk = ready.slice(start, start + CHUNK_SIZE);
      message.className = 'message loading';
      message.textContent = `Sending lines ${sent + 1}–${sent + chunk.length} of ${ready.length}...`;
      const results = await panelRequest('POST', 'mt5/account-balance/bulk/apply', {
        batchId,
        rows: chunk.map(row => ({ row: row.row, login: row.login, amount: row.amount, comment: row.comment })),
      });
      for (const result of results) {
        const index = byRow.get(result.row);
        if (index !== undefined) rows[index] = { ...rows[index], status: result.status, deal: result.deal, message: result.message };
      }
      sent += chunk.length;
      renderRows();
    }
    message.className = 'message';
    message.textContent = '';
    const failed = count('Failed') + count('Unknown');
    toast(`${count('Done') + count('AlreadySent')} lines done${failed ? `, ${failed} not done` : ''}`, failed ? 'error' : 'success', 'Download the result with the CSV or Excel buttons.');
  } catch (error) {
    message.textContent = '';
    showError(fileForm, message, new ApiError(`Sending stopped after ${sent} of ${ready.length} lines: ${error instanceof ApiError && error.message ? error.message : UNAVAILABLE_MESSAGE} The lines still marked Ready were not sent; send them again when the connection is back.`));
  } finally {
    sending = false;
    fileForm.querySelector('button[type="submit"]').disabled = false;
    renderRows();
  }
});

const filePicker = fileForm.querySelector('.file-picker');
const fileBox = filePicker.querySelector('.file-box');

function showChosenFile() {
  const file = fileForm.elements.file.files[0];
  filePicker.classList.toggle('has-file', Boolean(file));
  filePicker.querySelector('.file-name').textContent = file ? file.name : 'No file chosen, or drop it here';
}

fileForm.elements.file.addEventListener('change', showChosenFile);
fileBox.addEventListener('dragover', event => {
  event.preventDefault();
  fileBox.classList.add('dragging');
});
fileBox.addEventListener('dragleave', () => fileBox.classList.remove('dragging'));
fileBox.addEventListener('drop', event => {
  event.preventDefault();
  fileBox.classList.remove('dragging');
  if (sending || !event.dataTransfer?.files?.length) return;
  fileForm.elements.file.files = event.dataTransfer.files;
  showChosenFile();
});

document.getElementById('start-over').addEventListener('click', () => {
  if (sending) return;
  clearMessages(fileForm, message);
  fileForm.reset();
  showChosenFile();
  reset();
});

document.getElementById('sample').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([SAMPLE], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bulk-balance-sample.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

window.addEventListener('beforeunload', event => {
  if (sending) event.preventDefault();
});

renderMenu();
