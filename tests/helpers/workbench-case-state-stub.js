'use strict';

// Isolates turn tests from the case-state LLM calls (src/workbench-case-state). The wiring is
// covered by tests/workbench-case-state.test.js with the real module.
module.exports = {
  caseStateView: () => null,
  turnEvidence: () => [],
  updateTurnCaseState: async ({ previous }) => previous || null,
  reviewTurnReply: async (reply) => reply,
};
