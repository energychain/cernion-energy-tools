'use strict';
const { retainCaseContexts } = require('../src/function-case-contexts');
const { activationRows } = require('../src/function-activation-state');
const Activation = require('../services/function-activation.service');
const model = {
  sourceHash: 'neutral',
  functions: [
    { functionId: 'fn-a', capabilities: [], neighbors: [{ functionId: 'fn-b', weight: 1 }] },
    { functionId: 'fn-b', capabilities: [], neighbors: [{ functionId: 'fn-a', weight: 1 }] },
    { functionId: 'fn-c', capabilities: [], neighbors: [] },
  ],
};
const settings = { ...Activation.settings, contextRetentionTurns: 2 };
let doc;
beforeEach(() => {
  doc = {
    tenantId: 'tenant-a',
    contexts: [],
    history: [],
    touches: [],
    coverage: [],
    activity: [],
    activations: [],
  };
});
const touch = (ref, fresh = true, actorId = 'person-a', functionId = 'fn-a') =>
  retainCaseContexts(
    doc,
    { actorId, ...(ref ? { context: { kind: 'case', ref } } : {}) },
    [{ functionId }],
    model,
    settings,
    fresh
  );
test('five newest distinct contexts per function; duplicates refresh, no wall-time aging', () => {
  for (let n = 0; n < 12; n++) touch(`case-${n}`, false);
  expect(doc.contexts.map((item) => item.ref)).toEqual([
    'case-7',
    'case-8',
    'case-9',
    'case-10',
    'case-11',
  ]);
  touch('case-7', false);
  expect(doc.contexts).toHaveLength(5);
  expect(doc.contexts.at(-1).ref).toBe('case-7');
  touch('case-other', false, 'person-a', 'fn-c');
  expect(doc.contexts).toHaveLength(6);
});
test('expires over deduplicated relevant human turns from #715, never unrelated/duplicate turns', () => {
  doc.coverage.push({ functionId: 'fn-a', actorId: 'person-a', score: 1 });
  touch('case-a');
  touch(null, false);
  touch(null, true, 'person-other');
  expect(doc.contexts[0].ageTurns).toBe(0);
  touch(null);
  expect(doc.contexts[0].ageTurns).toBe(1);
  touch(null);
  expect(doc.contexts).toEqual([]);
});
test('case context reaches only immediate uncovered neighbor and expires from projected reasons', () => {
  touch('case-a');
  doc.touches.push({
    functionId: 'fn-a',
    actorId: 'person-a',
    at: new Date().toISOString(),
    confidence: 1,
  });
  const rows = activationRows(doc, model, settings, Date.now());
  expect(rows.find((row) => row.functionId === 'fn-b').reason).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'neighbor', context: { kind: 'case', ref: 'case-a' } }),
    ])
  );
  expect(rows.find((row) => row.functionId === 'fn-c').reason).toEqual([]);
  doc.contexts[0].ageTurns = 2;
  expect(
    activationRows(doc, model, settings, Date.now())
      .flatMap((row) => row.reason)
      .some((reason) => reason.context)
  ).toBe(false);
});
