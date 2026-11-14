'use strict';

// Context-use summary of one Workbench answer (#1117, safety class
// ephemeral_protected_context_use_summary): which context classes the answer drew on and how the
// cross-case gate (CTX-01) and the final Knowledge-Loop gate (#1137) decided, as closed scalar
// counts and enums. Built in memory from gate diagnostics only, returned with the turn response
// and never stored: no source, title, identifier, query, error, lesson or content enters it.

const { POLICY_VERSION: FINAL_GATE_POLICY } = require('./workbench-knowledge-loop');

const POLICY_VERSION = `ctx-01-v1+${FINAL_GATE_POLICY}`;
const DECISIONS = ['linked', 'pattern', 'comparable', 'unrelated'];
const REVIEW_STATES = [
  'current_context_only',
  'foreign_context_linked',
  'foreign_context_bounded',
  'foreign_context_overflow_withheld',
  'judgement_failed_closed',
];
const NEXT_SAFE_GATES = [
  'continue_current_case',
  'explicit_case_link_or_continue_current_case',
  'human_privacy_review',
];
const KEYS = [
  'policyVersion',
  'activeConversationIncluded',
  'selectedCaseIncluded',
  'evaluatedForeignCount',
  'linkedCount',
  'patternCount',
  'comparableCount',
  'unrelatedCount',
  'withheldCount',
  'knowledgeLoopAttemptedCount',
  'knowledgeLoopAdmittedCount',
  'knowledgeLoopWithheldCount',
  'knowledgeLoopFailedCount',
  'knowledgeSourceClassCount',
  'suggestionShown',
  'foreignContentExposed',
  'reviewState',
  'nextSafeGate',
];
const MAX_COUNT = 99;

const count = (value) => (Number.isInteger(value) && value > 0 ? Math.min(value, MAX_COUNT) : 0);

// Only the enum classes of a gate result are read; anything else is ignored.
function gateFacts(gate) {
  const decisions = Array.isArray(gate?.decisions)
    ? gate.decisions.filter((decision) => DECISIONS.includes(decision))
    : [];
  return {
    decisions,
    judgementFailed: gate?.judgementFailed === true,
    overflow: count(gate?.overflowCount),
  };
}

/**
 * @param {object} input
 * @param {{decisions?: string[], judgementFailed?: boolean, overflowCount?: number}} [input.initialGate]
 *   result of gateForeignEvidence on the initial retrieval set
 * @param {{gate?: object, summary?: object}|null} [input.loopAdmission] result of admitLoopEvidence
 * @returns {Record<string, string|number|boolean>} closed scalar summary
 */
function contextUseSummary({
  activeConversationIncluded = false,
  selectedCaseIncluded = false,
  initialGate,
  loopAdmission,
  suggestionShown = false,
} = {}) {
  const gates = [gateFacts(initialGate), gateFacts(loopAdmission?.gate)];
  const decisions = gates.flatMap((gate) => gate.decisions);
  const of = (kind) => decisions.filter((decision) => decision === kind).length;
  const overflow = gates.reduce((sum, gate) => sum + gate.overflow, 0);
  const loop = loopAdmission?.summary || {};
  const judgementFailed = gates.some((gate) => gate.judgementFailed) || loop.judgement === 'failed';
  const linked = of('linked');
  const comparable = of('comparable');
  // Raw foreign material reaches the answer only when linked; a pattern contributes its lesson,
  // never the item itself, and an overflow item is dropped unjudged.
  const withheld = decisions.length - linked + overflow;
  let reviewState = 'current_context_only';
  if (judgementFailed) reviewState = 'judgement_failed_closed';
  else if (overflow) reviewState = 'foreign_context_overflow_withheld';
  else if (linked) reviewState = 'foreign_context_linked';
  else if (decisions.length) reviewState = 'foreign_context_bounded';
  let nextSafeGate = 'continue_current_case';
  if (judgementFailed) nextSafeGate = 'human_privacy_review';
  else if (overflow || comparable || suggestionShown)
    nextSafeGate = 'explicit_case_link_or_continue_current_case';
  return {
    policyVersion: POLICY_VERSION,
    activeConversationIncluded: activeConversationIncluded === true,
    selectedCaseIncluded: selectedCaseIncluded === true,
    evaluatedForeignCount: count(decisions.length),
    linkedCount: count(linked),
    patternCount: count(of('pattern')),
    comparableCount: count(comparable),
    unrelatedCount: count(of('unrelated')),
    withheldCount: count(withheld),
    knowledgeLoopAttemptedCount: count(loop.attemptedCount),
    knowledgeLoopAdmittedCount: count(loop.admittedCount),
    knowledgeLoopWithheldCount: count(loop.withheldCount),
    knowledgeLoopFailedCount: count(loop.failedCount),
    knowledgeSourceClassCount: count(
      Array.isArray(loop.sourceClasses) ? loop.sourceClasses.length : 0
    ),
    suggestionShown: suggestionShown === true,
    // Contract assertion backed by the gates: unlinked foreign content never reaches the answer.
    foreignContentExposed: false,
    reviewState,
    nextSafeGate,
  };
}

module.exports = { KEYS, NEXT_SAFE_GATES, POLICY_VERSION, REVIEW_STATES, contextUseSummary };
