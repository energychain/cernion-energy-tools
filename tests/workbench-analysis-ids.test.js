'use strict';

const { analysisIds } = require('../src/workbench-content-turn');

const table = (id, sourceName, version, sheet = '') => ({ id, sourceName, version, sheet });

test('one table per source: the attached one first, else the newest version, at most six', () => {
  const candidates = [
    table('old-a', 'a.csv', 1),
    table('new-a', 'a.csv', 2),
    table('b-1', 'b.csv', 1),
    table('b-attached', 'b.csv', 1),
    table('x-1', 'x.xlsx', 1, 'Eins'),
    table('x-2', 'x.xlsx', 1, 'Zwei'),
    ...['c', 'd', 'e', 'f'].map((name) => table(name, `${name}.csv`, 1)),
  ];
  const ids = analysisIds(candidates, ['b-attached']);
  expect(ids).toHaveLength(6);
  expect(ids).toEqual(expect.arrayContaining(['new-a', 'b-attached', 'x-1', 'x-2']));
  expect(ids).not.toContain('old-a');
  expect(ids).not.toContain('b-1');
});
