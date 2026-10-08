'use strict';
const { resolveRecords } = require('../src/function-activation-records');

const splitModel = {
  sourceHash: 'current-epoch',
  functions: ['fn-a', 'fn-b'].map((functionId, index) => ({
    functionId,
    capabilities: [index ? 'cap-b' : 'cap-a'],
    derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
  })),
};

test('retained ID with historical wider scope reaches both split successors without losing attention', () => {
  const record = {
    functionId: 'fn-a',
    modelSourceHash: 'old-epoch',
    capabilities: ['cap-a', 'cap-b'],
    attention: { allowance: 10, consumedUnits: 4, replenishedUnits: 12 },
  };
  const resolved = resolveRecords([record], splitModel);
  expect(resolved.map((entry) => entry.functionId)).toEqual(['fn-a', 'fn-b']);
  expect(resolved.map((entry) => entry.attention)).toEqual([
    { allowance: 5, consumedUnits: 2, replenishedUnits: 6 },
    { allowance: 5, consumedUnits: 2, replenishedUnits: 6 },
  ]);
  expect(record.attention.allowance).toBe(10);
});

test('new current scope stays with retained ID even after another model hash regeneration', () => {
  const record = {
    functionId: 'fn-a',
    modelSourceHash: 'previous-hash',
    capabilities: ['cap-a'],
    attention: { allowance: 10, consumedUnits: 4, replenishedUnits: 12 },
  };
  expect(resolveRecords([record], splitModel)).toEqual([
    { ...record, modelSourceHash: splitModel.sourceHash },
  ]);
});

test('current identities without saved scope remain stable across hash-only regeneration', () => {
  const record = { functionId: 'fn-a', modelSourceHash: 'previous-hash', lifecycle: 'active' };
  expect(resolveRecords([record], splitModel)).toEqual([
    { ...record, modelSourceHash: splitModel.sourceHash },
  ]);
});
