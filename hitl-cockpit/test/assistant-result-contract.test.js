'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  RESULT_BLOCK_END,
  RESULT_BLOCK_START,
  formatResultBlock,
  handoffMarker,
  hasExactHandoffMarker,
  parseResultBlock,
  validateResultContract,
} = require('../lib/result-contract');

function completed(overrides = {}) {
  return {
    proposalId: 'proposal_abc',
    handoffId: 'proposal_abc',
    sourceBoard: 'operations',
    sourceTaskId: 't_public01',
    status: 'completed',
    statement: 'Kundenfall wurde nachweisbar gelöst.',
    evidenceRefs: ['case-id:case-9921'],
    nextStep: null,
    responsibleAgent: 'Felix',
    occurredAt: '2026-11-14T10:00:00Z',
    outcomeCandidate: {
      type: 'customer_case_resolved',
      statement: 'Kundenfall fallabschließend gelöst',
    },
    managementDecision: null,
    ...overrides,
  };
}

test('validates and round-trips the bounded AP21 machine result contract', () => {
  const value = validateResultContract(completed());
  assert.equal(value.occurredAt, 1794650400);
  assert.ok(Object.isFrozen(value));
  assert.deepEqual(parseResultBlock(`Prosa\n${formatResultBlock(completed())}\nEnde`), value);
});

test('completed results require material evidence and cannot close on task references', () => {
  assert.throws(
    () => validateResultContract(completed({ evidenceRefs: [] })),
    /material_evidence_missing/
  );
  assert.throws(
    () => validateResultContract(completed({ evidenceRefs: ['kanban:t_public01'] })),
    /material_evidence_missing/
  );
});

test('blocked results require a concrete question and all non-completed results require a next step', () => {
  const blocked = completed({
    status: 'blocked',
    evidenceRefs: [],
    nextStep: 'Soll Felix die fehlende Freigabe bei Thorsten einholen?',
    outcomeCandidate: null,
  });
  assert.equal(validateResultContract(blocked).status, 'blocked');
  assert.throws(
    () => validateResultContract({ ...blocked, nextStep: 'Freigabe einholen' }),
    /concrete_question_required/
  );
  assert.throws(
    () => validateResultContract({ ...blocked, status: 'continuing', nextStep: null }),
    /next_step_required/
  );
});

test('requires one unambiguous JSON block with no unknown or private fields', () => {
  const raw = JSON.stringify(completed());
  assert.throws(
    () =>
      parseResultBlock(`${RESULT_BLOCK_START}\n${raw}\n${RESULT_BLOCK_END}\n${RESULT_BLOCK_END}`),
    /result_block_ambiguous/
  );
  assert.throws(() => validateResultContract({ ...completed(), extra: true }), /unknown_field/);
  assert.throws(
    () => validateResultContract(completed({ statement: 'TWL private customer result' })),
    /private_result_rejected/
  );
});

test('handoff correlation accepts only the exact marker as its own line', () => {
  const marker = handoffMarker('proposal_abc');
  assert.equal(marker, 'ASSISTANT_MATRIX_HANDOFF:proposal_abc');
  assert.equal(hasExactHandoffMarker(`text\n${marker}\nresult`, 'proposal_abc'), true);
  assert.equal(hasExactHandoffMarker(`prefix ${marker}`, 'proposal_abc'), false);
  assert.equal(hasExactHandoffMarker(`${marker}-suffix`, 'proposal_abc'), false);
});
