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

const ROLE_ANSWER_WINDOW_MS = 6 * 3600 * 1000;

// Role rows (#1019): a reply right after a role question may confirm or correct it. Read off
// the answer path; only when that question was the last one asked, and recently.
function recognizeRoleAnswer(ctx, { envelope, pending, meta }) {
  const last = (pending?.askedQuestions || []).at(-1);
  if (
    last?.kind !== 'role' ||
    !String(last.key || '').startsWith('role:') ||
    Date.now() - (pending?.lastKnowledgeAskAt || 0) > ROLE_ANSWER_WINDOW_MS ||
    !ctx.broker.getLocalService?.('role-proposals')
  )
    return;
  ctx
    .call(
      'role-proposals.answer',
      { message: envelope.userRequest, functionIds: [last.key.slice('role:'.length)] },
      { meta }
    )
    .catch((error) =>
      ctx.broker.logger.warn('Role answer not read', { reason: String(error.message) })
    );
}

async function roleAsk(ctx, { envelope, situation, signals, meta }) {
  if (!ctx.broker.getLocalService?.('role-proposals')) return null;
  return ctx.call(
    'role-proposals.selectAsk',
    {
      conversationId: envelope.conversationId,
      functionIds: signals.functionIds || [],
      register: situation.conversationPreferences?.register,
    },
    { meta }
  );
}

async function inlineAsk(
  ctx,
  { situation, envelope, pending, reply, result, retrieval, incomingDocuments, meta }
) {
  recognizeRoleAnswer(ctx, { envelope, pending, meta });
  if (
    !ctx.broker.getLocalService?.('knowledge-needs') &&
    !ctx.broker.getLocalService?.('role-proposals')
  )
    return null;
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
    const signals = turnSignals(result, retrieval, situation);
    // At most one context question per turn: an own role row first, then a knowledge need.
    const role = await roleAsk(ctx, { envelope, situation, signals, meta }).catch(() => null);
    if (role) return role;
    if (!ctx.broker.getLocalService?.('knowledge-needs')) return null;
    const need = await ctx.call(
      'knowledge-needs.selectAsk',
      { conversationId: envelope.conversationId, ...signals },
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
