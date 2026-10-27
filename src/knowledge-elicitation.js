'use strict';

// Cold start (#997 step 3): after the substantive answer CET may add one context question about an
// open knowledge need that fits the current work. Never on small talk, filing, threads, document
// input or when the answer already asks back; the register enforces fit and cooldowns.
const ASK_SPACING_MS = Number(process.env.KNOWLEDGE_ASK_SPACING_MS || 15 * 60 * 1000);

function turnSignals(result, retrieval, situation) {
  const capabilities = (result.selectedCapabilities || [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.capability))
    .filter(Boolean);
  const operations = [...(retrieval?.toolTrace || []), ...(retrieval?.trace || [])]
    .filter((entry) => entry?.called && entry.name)
    .map((entry) => entry.name);
  const functionIds = (situation.hypotheses || [])
    .filter((item) => item.kind === 'function' && item.confidence >= 0.5)
    .map((item) => item.id);
  return { capabilities, operations, functionIds };
}

function askText(need, register) {
  const polite = register === 'Sie';
  return {
    text: `Kurze Rückfrage für künftige Anfragen: Was gilt bei ${polite ? 'Ihnen' : 'euch'} für „${need.label}“? Falls jemand anderes das besser weiß, ${polite ? 'nennen Sie' : 'nenn'} mir gern die Person.`,
    question: {
      key: need.needId,
      kind: 'knowledge',
      question: `Was gilt für „${need.label}“?`,
      answered: false,
      blocking: false,
      decisive: false,
    },
  };
}

async function inlineAsk(
  ctx,
  { situation, envelope, pending, reply, result, retrieval, incomingDocuments, meta }
) {
  if (!ctx.broker.getLocalService?.('knowledge-needs')) return null;
  if (
    incomingDocuments ||
    envelope.datasetIds?.length ||
    ['smalltalk', 'review'].includes(situation.turnKind) ||
    ['filing', 'orientation'].includes(situation.conversationShape) ||
    require('./workbench-thread').isThreadInput(envelope.userRequest) ||
    reply.questions?.length ||
    reply.draft ||
    situation.requestedOutput?.requested ||
    Date.now() - (pending?.lastKnowledgeAskAt || 0) < ASK_SPACING_MS
  )
    return null;
  try {
    const need = await ctx.call(
      'knowledge-needs.selectAsk',
      { conversationId: envelope.conversationId, ...turnSignals(result, retrieval, situation) },
      { meta }
    );
    if (!need) return null;
    return askText(need, situation.conversationPreferences?.register);
  } catch (error) {
    ctx.broker.logger.warn('Knowledge ask unavailable', { reason: String(error.message) });
    return null;
  }
}

module.exports = { inlineAsk, turnSignals, askText };
