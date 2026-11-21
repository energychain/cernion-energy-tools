'use strict';

const { applyCaseUpdate, caseStateView, createCaseState } = require('../src/case-state');

const evidence = [{ ref: 'n1', kind: 'source_observed', source: 'scan.pdf', summary: 'Scan' }];
const identifier = (observedValue, relationToTarget, extra = {}) => ({
  entity: `Objekt ${observedValue}`,
  observedValue,
  provenance: 'scan.pdf',
  evidenceRefs: ['n1'],
  relationToTarget,
  valueForm: 'as_seen',
  ...extra,
});

test('identifiers seen but not assigned to the target are open assignments with a missing proof', () => {
  const state = applyCaseUpdate(
    createCaseState(),
    {
      evidence,
      identifierUpdates: [
        identifier('X-1', 'target'),
        identifier('D-7', 'unclear'),
        identifier('X-l', 'unclear', { valueForm: 'normalized', normalizedCandidate: 'X-1' }),
        identifier('Y-2', 'other_object'),
      ],
    },
    { turn: 1 }
  );
  const open = caseStateView(state).openAssignments;
  expect(open.map((item) => [item.value, item.status])).toEqual([
    ['D-7', 'observed'],
    ['X-l', 'candidate'],
  ]);
  for (const item of open) expect(item.missingProof).toBeTruthy();
});

test('a case without unassigned identifiers has no open assignments', () => {
  const state = applyCaseUpdate(
    createCaseState(),
    { evidence, identifierUpdates: [identifier('X-1', 'target')] },
    { turn: 1 }
  );
  expect(caseStateView(state).openAssignments).toEqual([]);
});
