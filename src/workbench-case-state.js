'use strict';

// Case state of a workbench conversation (BK-01..04): updated each turn from the message, the
// documents of the turn and the retrieved evidence; the answer follows the state and is checked
// against it before output. Shares src/case-state with the personal agent.

const {
  caseStateView,
  mergeReflection,
  reflectCaseState,
  reflectionEnabled,
  reviewAnswer,
  takeAddendum,
  ADDENDUM_LABEL,
  updateCaseState,
} = require('./case-state');

// Background reflection after a turn (premium model, phase case_reflection): one per
// conversation at a time, a turn that ends meanwhile is reflected afterwards; the result is
// merged into the state current at write time and an addendum is shown with the next answer.
// Off in tests unless CASE_REFLECTION enables it.
const REFLECTION_TIMEOUT_MS = Number(process.env.CASE_REFLECTION_TIMEOUT_MS) || 300000;
const reflections = require('./case-reflection-queue').createReflectionQueue();

function scheduleReflection(service, p, envelope, { caseState, recentTurns = [], logger } = {}) {
  if (!reflectionEnabled() || !caseState?.turn) return null;
  const key = [p.tenantId, p.actorId, envelope.channel, envelope.conversationId].join(':');
  const conversation = require('./workbench-conversation');
  return reflections.schedule(key, () => {
    const started = Date.now();
    return reflectCaseState(
      caseState,
      { recentTurns },
      {
        tenantId: p.tenantId,
        timeoutMs: REFLECTION_TIMEOUT_MS,
      }
    )
      .then((reflection) =>
        conversation
          .saveCaseState(service.conversationsDb, p, envelope, (current) =>
            mergeReflection(current || caseState, reflection)
          )
          .then((merged) => {
            logger?.info?.('Workbench case reflection', {
              ms: Date.now() - started,
              turn: reflection.turn,
              addendum: Boolean(reflection.addendum),
              stored: Boolean(merged),
            });
            return merged;
          })
      )
      .catch((error) => {
        logger?.warn?.(`Workbench case reflection failed: ${error.message}`);
        return null;
      });
  });
}

// An addendum from the background reflection precedes the next answer, once.
function withAddendum(reply, caseState) {
  const { addendum, state } = takeAddendum(caseState);
  if (!addendum || !reply?.responseText) return { reply, caseState: caseState && state };
  return {
    reply: {
      ...reply,
      responseText: `${ADDENDUM_LABEL} ${addendum}\n\n${reply.responseText}`,
    },
    caseState: state,
  };
}

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
  // A fallback is no answer to correct: a revision would turn it into an invented one (TWL).
  if (!caseState || !reply?.responseText || reply.draft || reply.answerStatus === 'fallback')
    return reply;
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

module.exports = {
  reflections,
  caseStateView,
  reflectionEnabled,
  reviewTurnReply,
  scheduleReflection,
  turnEvidence,
  updateTurnCaseState,
  withAddendum,
};
