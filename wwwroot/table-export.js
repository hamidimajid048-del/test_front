// Client-side CSV and Excel (.xlsx) export of the rows a table shows, for reports the panel builds itself. The Excel file is
// written here too (a minimal workbook in an uncompressed zip), so no library or server round trip is needed.

const COMMA_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const SAFE_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const encoder = new TextEncoder();

// The text of a cell as a number when it is one ("1,234.50" becomes 1234.5), otherwise the text; the "—" placeholder is empty.
function exportCell(text) {
  const value = text.trim();
  if (value === '—') return '';
  const plain = COMMA_NUMBER.test(value) ? value.replaceAll(',', '') : value;
  return SAFE_NUMBER.test(plain) && plain.length <= 16 ? Number(plain) : value;
}

function tableMatrix(columns, rows) {
  return [
    columns.map(column => (column.group ? `${column.group} ${column.title}` : column.title)),
    ...rows.map(row => columns.map(column => exportCell(cellText(column, row)))),
  ];
}

function csvCell(value) {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(matrix) {
  return new Blob(['﻿', matrix.map(line => line.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// A zip with the files stored uncompressed. files: [[name, text]].
function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034B50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(12, 0x21, true);
    header.setUint32(14, crc32(data), true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014B50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, header.getUint32(14, true), true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    parts.push(header, nameBytes, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xmlText = value => String(value).replace(XML_INVALID, '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

function columnLetters(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

function toXlsx(matrix, sheetName) {
  const rows = matrix.map((line, rowIndex) => {
    const cells = line.map((value, columnIndex) => {
      if (value === '') return '';
      const ref = `${columnLetters(columnIndex)}${rowIndex + 1}`;
      return typeof value === 'number'
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
    });
    return `<row r="${rowIndex + 1}">${cells.join('')}</row>`;
  });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const sheet = sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report';
  return zip([
    ['[Content_Types].xml', `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ['_rels/.rels', `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`],
  ]);
}

// format: 'csv' | 'xlsx'. name: the report's name, used for the sheet and the file.
function exportTable(columns, rows, name, format) {
  const matrix = tableMatrix(columns, rows);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const url = URL.createObjectURL(format === 'xlsx' ? toXlsx(matrix, name) : toCsv(matrix));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${stamp}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const EXCEL_MAX_ROWS = 1048575;

// The CSV / Excel buttons for a table: they download every row of the report, not only the page on screen. columns()
// gives the columns shown. rows() gives the rows when the browser holds all of them; for a report paged by the server,
// all = { total, read(onProgress(count)) } reads every page with the filters and sort applied. permission is the one
// that shows the buttons (report export, unless the table is the result of an operation the account may run).
function exportButtons(name, columns, rows, all, permission = 'reports.export') {
  const bar = document.createElement('span');
  bar.className = 'table-export';
  const total = all ? all.total : rows().length;
  const buttons = [];
  for (const [format, text] of [['csv', 'CSV'], ['xlsx', 'Excel']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = `Download all ${total.toLocaleString('en-US')} rows, with the filters and sort applied, as ${text}`;
    button.addEventListener('click', async () => {
      if (bar.dataset.busy) return;
      if (format === 'xlsx' && total > EXCEL_MAX_ROWS) {
        toast(`Excel holds at most ${EXCEL_MAX_ROWS.toLocaleString('en-US')} rows`, 'error', 'Download CSV, or narrow the report with the filters.');
        return;
      }
      bar.dataset.busy = 'true';
      for (const item of buttons) item.disabled = true;
      try {
        const data = all
          ? await all.read(count => { button.textContent = `${text} ${Math.min(99, Math.floor((count * 100) / Math.max(total, 1)))}%`; })
          : rows();
        button.textContent = `${text}...`;
        await new Promise(resolve => setTimeout(resolve));
        exportTable(columns().filter(column => !column.noExport), data, name, format);
      } catch (error) {
        toast('The download failed', 'error', error instanceof ApiError && error.message ? error.message : 'Try again, or narrow the report with the filters.');
      } finally {
        delete bar.dataset.busy;
        for (const item of buttons) item.disabled = false;
        button.textContent = text;
      }
    });
    buttons.push(button);
    bar.append(button);
  }
  hideUnlessAllowed(bar, permission);
  return bar;
}
