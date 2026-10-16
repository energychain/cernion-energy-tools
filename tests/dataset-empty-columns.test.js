'use strict';

const { parseDatasetText, datasetPlausibility } = require('../src/dataset-input');

// Synthetic wide export: three filled columns, four columns empty in every row, one sparse column.
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

test('larger tables with columns empty in every row are accepted, not rejected as damaged', () => {
  const [table] = parseDatasetText(wideExport(), 'Export');
  expect(table).toBeDefined();
  expect(table.emptyColumns).toEqual(['Leer A', 'Leer B', 'Leer C', 'Leer D']);
  // Columns are kept so a question about an empty column still gets its concrete cause.
  expect(table.profile.columns).toHaveLength(8);
  expect(datasetPlausibility(table, table.rows)).toBeNull();
});

test('tiny tables keep the strict empty-value rule', () => {
  expect(() => parseDatasetText(wideExport(3), 'Klein')).toThrow(/beschädigt oder unplausibel/);
});

test('genuinely sparse filled columns are still rejected above the threshold', () => {
  const header = ['Kennung', 'A', 'B', 'C'];
  const lines = [header.join(';')];
  for (let i = 0; i < 40; i += 1)
    lines.push([`ID${i}`, i === 0 ? '1' : '', i === 1 ? '2' : '', i === 2 ? '3' : ''].join(';'));
  expect(() => parseDatasetText(lines.join('\n'), 'Sparse')).toThrow(/beschädigt oder unplausibel/);
});

test('a table whose only filled column is the identifier stays rejected', () => {
  const lines = ['Kennung;A;B'];
  for (let i = 0; i < 40; i += 1) lines.push(`ID${i};;`);
  expect(() => parseDatasetText(lines.join('\n'), 'Leer')).toThrow(/beschädigt oder unplausibel/);
});

test('tables without empty columns carry no empty-column note', () => {
  const lines = ['Kennung;Wert'];
  for (let i = 0; i < 10; i += 1) lines.push(`ID${i};${i}`);
  const [table] = parseDatasetText(lines.join('\n'), 'Klein');
  expect(table.emptyColumns).toBeUndefined();
});
