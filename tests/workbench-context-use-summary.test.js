'use strict';
// Response-only context-use summary (#1117): closed scalar DTO built from gate diagnostics only.
// synthetic_tenant_seed inputs; SENTINEL marks content that must never reach the summary.

const {
  KEYS,
  NEXT_SAFE_GATES,
  POLICY_VERSION,
  REVIEW_STATES,
  contextUseSummary,
} = require('../src/workbench-context-use-summary');

const gate = (decisions, extra = {}) => ({
  decisions,
  judgementFailed: false,
  overflowCount: 0,
  ...extra,
});
const loop = (summary = {}, gateResult = gate([])) => ({
  evidence: [{ value: 'SENTINEL-LOOP-HIT', metadata: { sourceId: 'SENTINEL-SOURCE-ID' } }],
  gate: gateResult,
  summary: {
    policyVersion: 'final-evidence-gate-1',
    judgement: 'admitted',
    attemptedCount: 1,
    admittedCount: 1,
    withheldCount: 0,
    failedCount: 0,
    sourceClasses: ['knowledge-gateway'],
    ...summary,
  },
});

function expectClosed(summary) {
  expect(Object.keys(summary)).toEqual(KEYS);
  for (const [key, value] of Object.entries(summary)) {
    expect(['string', 'number', 'boolean']).toContain(typeof value);
    if (typeof value === 'number') {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(99);
    }
    if (typeof value === 'string')
      expect([POLICY_VERSION, ...REVIEW_STATES, ...NEXT_SAFE_GATES]).toContain(value);
    expect(key).not.toMatch(/id$/i);
  }
  expect(summary.policyVersion).toBe(POLICY_VERSION);
  expect(summary.foreignContentExposed).toBe(false);
  return summary;
}

test('zero foreign material: current context only', () => {
  const summary = expectClosed(
    contextUseSummary({
      activeConversationIncluded: true,
      selectedCaseIncluded: true,
      initialGate: gate([]),
    })
  );
  expect(summary).toMatchObject({
    activeConversationIncluded: true,
    selectedCaseIncluded: true,
    evaluatedForeignCount: 0,
    withheldCount: 0,
    knowledgeLoopAttemptedCount: 0,
    knowledgeSourceClassCount: 0,
    reviewState: 'current_context_only',
    nextSafeGate: 'continue_current_case',
  });
});

test.each([
  ['linked', { linkedCount: 1, withheldCount: 0, reviewState: 'foreign_context_linked' }],
  ['pattern', { patternCount: 1, withheldCount: 1, reviewState: 'foreign_context_bounded' }],
  ['unrelated', { unrelatedCount: 1, withheldCount: 1, reviewState: 'foreign_context_bounded' }],
  [
    'comparable',
    {
      comparableCount: 1,
      withheldCount: 1,
      reviewState: 'foreign_context_bounded',
      nextSafeGate: 'explicit_case_link_or_continue_current_case',
    },
  ],
])('%s decisions are distinguishable', (decision, expected) => {
  const summary = expectClosed(contextUseSummary({ initialGate: gate([decision]) }));
  expect(summary).toMatchObject({ evaluatedForeignCount: 1, ...expected });
});

test('a shown comparable-case suggestion leads to an explicit case link', () => {
  const summary = expectClosed(
    contextUseSummary({ initialGate: gate(['comparable']), suggestionShown: true })
  );
  expect(summary.suggestionShown).toBe(true);
  expect(summary.nextSafeGate).toBe('explicit_case_link_or_continue_current_case');
});

test('overflow items count as withheld and have their own review state', () => {
  const summary = expectClosed(
    contextUseSummary({
      initialGate: gate(Array(12).fill('unrelated'), { overflowCount: 9 }),
    })
  );
  expect(summary).toMatchObject({
    evaluatedForeignCount: 12,
    unrelatedCount: 12,
    withheldCount: 21,
    reviewState: 'foreign_context_overflow_withheld',
    nextSafeGate: 'explicit_case_link_or_continue_current_case',
  });
});

test.each([
  ['initial gate', { initialGate: gate(['unrelated'], { judgementFailed: true }) }],
  ['loop gate', { loopAdmission: loop({}, gate(['unrelated'], { judgementFailed: true })) }],
  ['loop admission', { loopAdmission: loop({ judgement: 'failed', admittedCount: 0 }) }],
])('a failed %s judgement fails closed to a human privacy review', (_label, input) => {
  const summary = expectClosed(contextUseSummary(input));
  expect(summary.reviewState).toBe('judgement_failed_closed');
  expect(summary.nextSafeGate).toBe('human_privacy_review');
  expect(summary.foreignContentExposed).toBe(false);
});

test('initial and final Knowledge-Loop decisions are both counted', () => {
  const summary = expectClosed(
    contextUseSummary({
      initialGate: gate(['linked', 'comparable']),
      loopAdmission: loop(
        {
          judgement: 'partial',
          attemptedCount: 3,
          admittedCount: 2,
          withheldCount: 1,
          failedCount: 1,
          sourceClasses: ['knowledge-gateway', 'knowledge-rag'],
        },
        gate(['pattern', 'unrelated'])
      ),
    })
  );
  expect(summary).toMatchObject({
    evaluatedForeignCount: 4,
    linkedCount: 1,
    patternCount: 1,
    comparableCount: 1,
    unrelatedCount: 1,
    withheldCount: 3,
    knowledgeLoopAttemptedCount: 3,
    knowledgeLoopAdmittedCount: 2,
    knowledgeLoopWithheldCount: 1,
    knowledgeLoopFailedCount: 1,
    knowledgeSourceClassCount: 2,
    reviewState: 'foreign_context_linked',
  });
});

test('hostile inputs never leak free text and counts stay bounded', () => {
  const hostile = {
    activeConversationIncluded: 'SENTINEL-CONV-ID',
    selectedCaseIncluded: { caseId: 'SENTINEL-CASE-ID' },
    suggestionShown: 'SENTINEL-SUGGESTION',
    initialGate: {
      evidence: [{ value: 'SENTINEL-FOREIGN-CONTENT', source: 'SENTINEL-TITLE' }],
      decisions: [...Array(150).fill('unrelated'), 'SENTINEL-DECISION', { lesson: 'SENTINEL' }],
      judgementFailed: 'yes',
      overflowCount: 'SENTINEL-OVERFLOW',
      error: 'SENTINEL-ERROR stack',
      prompt: 'SENTINEL-PROMPT',
    },
    loopAdmission: {
      gate: { decisions: 'SENTINEL', lesson: 'SENTINEL-LESSON' },
      summary: {
        attemptedCount: 5000,
        admittedCount: -3,
        withheldCount: 1.5,
        failedCount: 'SENTINEL',
        sourceClasses: 'SENTINEL-SOURCE',
        query: 'SENTINEL-QUERY',
      },
    },
  };
  const summary = expectClosed(contextUseSummary(hostile));
  expect(JSON.stringify(summary)).not.toMatch(/SENTINEL/);
  expect(summary).toMatchObject({
    activeConversationIncluded: false,
    selectedCaseIncluded: false,
    suggestionShown: false,
    evaluatedForeignCount: 99,
    unrelatedCount: 99,
    withheldCount: 99,
    knowledgeLoopAttemptedCount: 99,
    knowledgeLoopAdmittedCount: 0,
    knowledgeLoopWithheldCount: 0,
    knowledgeLoopFailedCount: 0,
    knowledgeSourceClassCount: 0,
  });
});

test('missing inputs produce the closed default summary', () => {
  expectClosed(contextUseSummary());
  expectClosed(contextUseSummary({ initialGate: null, loopAdmission: null }));
});
