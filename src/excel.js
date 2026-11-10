const ExcelJS = require('exceljs');

const HEADERS = ['video_name', 'date', 'start_time', 'end_time', 'duration_hh:mm:ss', 'Usefullness'];
const WIDTHS = [45, 24, 23, 22, 20, 26];

const toTime = (s) => { // 'HH:MM:SS' -> Excel day fraction
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec((s || '').trim());
  return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) / 86400 : s || null;
};
const toDate = (s) => { // 'YYYY-MM-DD' -> UTC date (avoids timezone shifts)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim());
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : s || null;
};

function writeRow(ws, r, row) {
  ws.getCell(r, 1).value = row.video_name;
  ws.getCell(r, 2).value = toDate(row.date); ws.getCell(r, 2).numFmt = 'yyyy-mm-dd';
  ws.getCell(r, 3).value = toTime(row.start_time); ws.getCell(r, 3).numFmt = 'h:mm:ss AM/PM';
  ws.getCell(r, 4).value = toTime(row.end_time); ws.getCell(r, 4).numFmt = 'h:mm:ss AM/PM';
  ws.getCell(r, 5).value = row.duration; ws.getCell(r, 5).numFmt = '@';
  ws.getCell(r, 6).value = row.usefulness || 'Yes';
}

// Creates a new workbook, or appends below the last used row of an existing one.
async function saveRows(filePath, rows, append) {
  const wb = new ExcelJS.Workbook();
  let ws;
  if (append) {
    await wb.xlsx.readFile(filePath);
    ws = wb.worksheets[0];
    let last = 1;
    // a row counts as filled when it has a date, time or duration; rows with only a name ("Camera 1_" placeholders) are reused
    ws.eachRow((row, n) => { if ([2, 3, 4, 5].some((c) => row.getCell(c).value !== null && row.getCell(c).value !== '')) last = n; });
    let r = last + 1;
    for (const row of rows) writeRow(ws, r++, row);
  } else {
    ws = wb.addWorksheet('Sheet1');
    ws.addRow(HEADERS).font = { bold: true };
    WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    rows.forEach((row, i) => writeRow(ws, i + 2, row));
  }
  await wb.xlsx.writeFile(filePath);
}

module.exports = { saveRows };
