'use strict';

// Self-improvement step 3 (#1010): shadow replay of a failed question after new tenant data
// arrived. It runs understanding, evidence collection and the answer like a turn, but writes
// nothing: no case, no conversation state, no notice, no memory capture. The answer text is only
// judged, never stored or shown. Mapping-bound sources stay off (no evidence access is granted),
// so a replay never reads more than the original turn could.
const understanding = require('./workbench-understanding');
const { turnOutcome } = require('./failure-signals');

const FAILED = new Set(['fallback', 'error', 'unavailable']);

async function shadowReplay(ctx, { tenantId, question, newFactIds = [] }) {
  const situation = await understanding.understand({ message: question, tenantId });
  const meta = { ...ctx.meta, workbenchToolsManaged: true, workbenchEvidenceSources: null };
  const collected = await ctx
    .call('personal-agent.collectWorkbenchEvidence', { situation }, { meta })
    .catch(() => ({ evidence: [], trace: [] }));
  const retrieval = {
    evidence: [...(collected.evidence || [])],
    trace: [...(collected.trace || [])],
  };
  const memory = await require('./tenant-memory')
    .related(ctx, require('./domain-router-policy').principal(ctx), situation, question)
    .catch(() => ({ evidence: [] }));
  retrieval.evidence.push(...(memory?.evidence || []));
  const reply = await understanding.answer({
    situation,
    retrieval,
    tenantId,
    message: question,
    followup: false,
    skipModel: false,
  });
  const outcome = turnOutcome({ ...reply, situation, retrievalTrace: retrieval.trace });
  const fresh = new Set(newFactIds);
  const usedFacts = retrieval.evidence
    .filter((hit) => hit.retrievalSource === 'tenant-memory' && fresh.has(hit.metadata?.key))
    .map((hit) => hit.metadata.key);
  const answered = !outcome.unanswered && !FAILED.has(reply.answerStatus);
  return {
    passed: answered && usedFacts.length > 0,
    answered,
    answerStatus: reply.answerStatus,
    usedFacts: [...new Set(usedFacts)].slice(0, 10),
    timeouts: outcome.timeouts.length,
    at: new Date().toISOString(),
  };
}

module.exports = { shadowReplay };
