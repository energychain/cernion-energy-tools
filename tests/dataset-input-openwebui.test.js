'use strict';

const { parseDatasetText } = require('../src/dataset-input');
const { generateDatasetFixture } = require('../scripts/generate-dataset-fixtures');

// Open WebUI's CSV loader splits a ';' table at decimal commas into "header: value" records with a
// "None: <fraction>" remainder. Newer loader output joins the next record onto the same line.
test('joined loader records are restored without losing values or rows', () => {
  const separated = generateDatasetFixture('openwebui');
  const reference = parseDatasetText(separated, 'Lastprofil-A.csv')[0];
  const joined = separated.replace(/\n\n(?=\S)/gu, ' ');
  const restored = parseDatasetText(joined, 'Lastprofil-A.csv')[0];
  expect(restored.rows.length).toBe(reference.rows.length);
  expect(restored.rows.slice(0, 5)).toEqual(reference.rows.slice(0, 5));
});

test('an empty value followed by the next record on the same line stays an empty cell', () => {
  const header = 'Zeit;Wert [kW]';
  const text = [
    `${header}: 01.01.2025 00:00;10`,
    'None: 5',
    `${header}: 01.01.2025 00:15; ${header}: 01.01.2025 00:30;12`,
    'None: 5',
    `${header}: 01.01.2025 00:45;14`,
    'None: 0',
  ].join('\n');
  const [table] = parseDatasetText(text, 'synthetisch.csv');
  expect(table.rows).toHaveLength(4);
  expect(table.rows.map((row) => row['Wert [kW]'])).toEqual([10.5, null, 12.5, 14]);
});
