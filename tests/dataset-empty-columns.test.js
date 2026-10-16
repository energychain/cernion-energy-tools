'use strict';

const { parseDatasetText, datasetPlausibility } = require('../src/dataset-input');

// Synthetic wide export: three filled columns and five columns that are empty in every row.
function wideExport(rows = 40) {
  const header = [
    'Kennung',
    'Typ',
    'Leistung kW',
    'Leer A',
    'Leer B',
    'Leer C',
    'Leer D',
    'Teilweise',
  ];
  const lines = [header.join(';')];
  for (let i = 0; i < rows; i += 1)
    lines.push(
      [`ID${1000 + i}`, i % 2 ? 'a' : 'b', (i + 1) * 1.5, '', '', '', '', i % 3 ? '' : 'x'].join(
        ';'
      )
    );
  return lines.join('\n');
}

test('columns empty in every row are dropped instead of rejecting the table as damaged', () => {
  const [table] = parseDatasetText(wideExport(), 'Export');
  expect(table).toBeDefined();
  expect(table.droppedEmptyColumns).toEqual(['Leer A', 'Leer B', 'Leer C', 'Leer D']);
  expect(table.profile.columns.map((column) => column.name).sort()).toEqual(
    ['Kennung', 'Leistung kW', 'Teilweise', 'Typ'].sort()
  );
  expect(Object.keys(table.rows[0])).not.toContain('Leer A');
  expect(datasetPlausibility(table, table.rows)).toBeNull();
});

test('genuinely sparse filled columns are still rejected above the empty-value threshold', () => {
  const header = ['Kennung', 'A', 'B', 'C'];
  const lines = [header.join(';')];
  for (let i = 0; i < 40; i += 1)
    lines.push([`ID${i}`, i === 0 ? '1' : '', i === 1 ? '2' : '', i === 2 ? '3' : ''].join(';'));
  expect(() => parseDatasetText(lines.join('\n'), 'Sparse')).toThrow(/beschädigt oder unplausibel/);
});

test('tables without empty columns are unchanged and carry no drop note', () => {
  const lines = ['Kennung;Wert'];
  for (let i = 0; i < 10; i += 1) lines.push(`ID${i};${i}`);
  const [table] = parseDatasetText(lines.join('\n'), 'Klein');
  expect(table.droppedEmptyColumns).toBeUndefined();
  expect(table.profile.columns).toHaveLength(2);
});
