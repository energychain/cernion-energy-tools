'use strict';

// Case state of a workbench conversation (BK-01..04): updated each turn from the message, the
// documents of the turn and the retrieved evidence; the answer follows the state and is checked
// against it before output. Shares src/case-state with the personal agent.

const { caseStateView, reviewAnswer, updateCaseState } = require('./case-state');

const MAX_SOURCES = 8;

// Statements the person made earlier (tenant memory) stay reports; documents and other retrieved
// sources are what was observed in a source.
function turnEvidence(envelope = {}, retrieval = {}) {
  const documents = (envelope.documents || [])
    .filter((document) => typeof document?.text === 'string' && document.text.trim())
    .map((document) => ({
      source: `Dokument ${String(document.name || 'Dokument').slice(0, 120)}`,
      kind: 'source_observed',
      content: document.text,
    }));
  const sources = (retrieval?.evidence || [])
    .filter((hit) => hit && String(hit.value || '').trim())
    .slice(0, MAX_SOURCES)
    .map((hit) => ({
      source: String(hit.title || hit.name || hit.source || 'Quelle').slice(0, 160),
      kind: hit.source === 'tenant-memory' ? 'user_reported' : 'source_observed',
      content: String(hit.value),
    }));
  return [...documents, ...sources];
}

async function updateTurnCaseState({ previous, envelope, retrieval, tenantId, logger }) {
  try {
    return await updateCaseState(
      previous || null,
      { message: envelope?.userRequest || '', newEvidence: turnEvidence(envelope, retrieval) },
      { tenantId }
    );
  } catch (error) {
    logger?.warn?.(`Workbench case state update failed: ${error.message}`);
    return previous || null;
  }
}

// Revises only the passages the check flags; drafts are left as written.
async function reviewTurnReply(reply, caseState, { tenantId, logger } = {}) {
  if (!caseState || !reply?.responseText || reply.draft) return reply;
  try {
    const review = await reviewAnswer(reply.responseText, caseState, { tenantId });
    if (review.issues.length)
      logger?.info?.(
        `Workbench case state answer review: ${review.issues.map((issue) => issue.kind).join(', ')}${review.revised ? ' (revised)' : ''}`
      );
    return review.revised ? { ...reply, responseText: review.reply } : reply;
  } catch (error) {
    logger?.warn?.(`Workbench case state answer review failed: ${error.message}`);
    return reply;
  }
}

module.exports = { caseStateView, reviewTurnReply, turnEvidence, updateTurnCaseState };
