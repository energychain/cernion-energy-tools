'use strict';
const XLSX = require('xlsx');
// Generated in memory: no real document, customer or personal data.
function syntheticWorkbook() {
  const workbook = XLSX.utils.book_new();
  for (const [name, value] of [
    ['First', 12],
    ['Second', 30],
  ]) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Index', 'Value'],
      [1, value],
      [2, value * 2],
    ]);
    sheet.B3 = { t: 'n', v: value * 2, f: 'B2*2' };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
module.exports = { syntheticWorkbook };
