'use strict';

const { unsourcedDetail } = require('../src/workbench-free-answer');
const { availableToolAnswer } = require('../src/workbench-tool-answer');

test('a detail quoted from a source is not unsourced; a new one is', () => {
  const sources = ['Zeitraum 14.04.2026 – 15.04.2026, Kennung R-17A'];
  expect(unsourcedDetail('Laut Quelle gilt „14.04.2026“ für `R-17A`.', sources)).toBe(false);
  expect(unsourcedDetail('Frist bis 20.05.2026.', sources)).toBe(true);
  expect(unsourcedDetail('Ohne Einzelangaben.', sources)).toBe(false);
});

test('an empty query result is left out when the answer stands on other evidence', () => {
  const hit = {
    retrievalSource: 'capability-read',
    source: 'x.read',
    value: JSON.stringify({ count: 0, data: [] }),
    metadata: { rowCount: 0 },
  };
  expect(availableToolAnswer([hit], 'Was ist belegt?')).toMatch(/0 Datensätze/u);
  expect(availableToolAnswer([hit], 'Was ist belegt?', undefined, { skipEmpty: true })).toBe('');
});
