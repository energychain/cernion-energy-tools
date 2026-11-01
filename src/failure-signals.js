'use strict';

// Self-improvement step 1 (#1010): derive failure signals from the structured outcome of a turn.
// Observation only. Nothing here reads message text: only status fields the turn already reports
// (answer status, degradation, retrieval trace, open questions), so no wording gate is involved.

const KINDS = [
  'user_correction',
  'repeated_question',
  'clarification_loop',
  'unanswered',
  'replay_divergence',
  'source_timeout',
  'harness_failure',
  'skill_degraded',
];
// Expected outcomes that are no CET failure (budget, explicit opt-out).
const EXPECTED_REASONS = new Set([
  'tenant_quota_exceeded',
  'disabled_by_request',
  'turn_embedding_budget_exhausted',
]);
const UNANSWERED_STATUSES = new Set(['fallback', 'error', 'unavailable']);
const FUNCTION_CONFIDENCE = 0.5;
// A clear rejection of the previous answer (graded by understanding, literal basis checked there).
const DISAGREEMENT = Number(process.env.FAILURE_SIGNAL_DISAGREEMENT || 0.6);
const MAX_ITEMS = 10;

function reasonOf(result) {
  const metadata = result?.metadata || {};
  return metadata.degradedReason || metadata.fallbackReason || undefined;
}

function unanswered(result) {
  const reason = reasonOf(result);
  if (reason && EXPECTED_REASONS.has(reason)) return false;
  return (
    UNANSWERED_STATUSES.has(result?.answerStatus) ||
    result?.state === 'understanding_unavailable' ||
    result?.metadata?.degraded === true ||
    Boolean(result?.metadata?.fallbackReason)
  );
}

function timedOutSources(result) {
  const trace = Array.isArray(result?.retrievalTrace) ? result.retrievalTrace : [];
  const seen = new Set();
  return trace
    .filter((entry) => entry?.status === 'timeout')
    .map((entry) => ({
      source: String(entry.source || 'unknown').slice(0, 80),
      ...(entry.name ? { name: String(entry.name).slice(0, 120) } : {}),
    }))
    .filter((entry) => {
      const key = `${entry.source}|${entry.name || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ITEMS);
}

// Open questions of the turn, without the optional context question of the cold start (#997).
function openQuestions(result) {
  const count = Array.isArray(result?.requiredClarifications)
    ? result.requiredClarifications.length
    : 0;
  return Math.max(0, count - (result?.contextQuestion ? 1 : 0));
}

function functionIds(result) {
  return [
    ...new Set(
      (result?.situation?.hypotheses || [])
        .filter(
          (item) =>
            item?.kind !== 'domain' &&
            typeof item?.id === 'string' &&
            Number(item.confidence) >= FUNCTION_CONFIDENCE
        )
        .map((item) => item.id)
    ),
  ].slice(0, MAX_ITEMS);
}

// Summary of one turn for the register; `observe` compares it with the conversation trail.
function turnOutcome(result) {
  return {
    unanswered: unanswered(result),
    reason: reasonOf(result),
    timeouts: timedOutSources(result),
    openQuestions: openQuestions(result),
    functionIds: functionIds(result),
    disagreement: Number(result?.situation?.answerFeedback?.disagreement) >= DISAGREEMENT,
  };
}

// Workbench after-hook: hands the outcome to the local register, never delays or alters the reply.
function afterTurn(ctx, result) {
  try {
    // A query nested in a chat turn is observed once, by the chat turn.
    if (ctx.options?.parentCtx?.action?.name === 'workbench.chat') return result;
    const register = ctx.broker.getLocalService?.('failure-signals');
    if (!register || !result || typeof result !== 'object') return result;
    const meta = require('./function-coverage-turn').mappedMeta(ctx) || ctx.meta;
    const tenantId = meta?.apiToken?.tenantId || meta?.authUser?.tenantId;
    if (!tenantId) return result;
    const conversationId =
      ctx.params?.openWebuiConversationId ||
      ctx.params?.conversationId ||
      ctx.params?.metadata?.chat_id ||
      undefined;
    // Kept tenant-internally with a case for its shadow replay (step 3); never in a signal.
    const question = [
      ctx.params?.message,
      ctx.params?.userRequest,
      ctx.params?.messages?.findLast?.((turn) => turn.role === 'user')?.content,
    ].find((value) => typeof value === 'string' && value.trim());
    const capturedFacts = [...new Set(meta?.tenantMemoryCurrentFacts || [])].slice(0, 20);
    // Tracked like the register's own follow-ups, so idle() and shutdown wait for it.
    const observed = register.observeTurn({
      tenantId,
      conversationId: conversationId ? String(conversationId).slice(0, 200) : undefined,
      turnRef: String(ctx.id || '').slice(0, 120) || undefined,
      outcome: turnOutcome(result),
      question: question ? question.slice(0, 2000) : undefined,
      capturedFacts,
      replayCtx: capturedFacts.length
        ? require('./project-skill-learning').detachedContext({ broker: ctx.broker, meta })
        : undefined,
    });
    if (typeof register.track === 'function') register.track(observed);
    else
      observed.catch((error) =>
        ctx.broker.logger.warn('Failure signal not recorded', error.message)
      );
  } catch (error) {
    ctx.broker.logger.warn('Failure signal observation skipped', error.message);
  }
  return result;
}

module.exports = { KINDS, EXPECTED_REASONS, turnOutcome, afterTurn };
