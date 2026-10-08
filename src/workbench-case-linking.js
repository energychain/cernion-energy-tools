'use strict';

const conversationAssistance = require('./workbench-conversation');
const { rawContentAllowed, relatedCaseSentence } = require('./case-linking');

async function sharedCaseSummary(service, p, caseId) {
  const router = service.broker.getLocalService('domain-router');
  const state = await router.loadCase(p, caseId, { summaryOnly: true });
  if (rawContentAllowed(p, state)) return null;
  return router.readCaseSummary(p, state);
}

async function findIdentifierStatus(ctx, message, meta) {
  if (!ctx.broker.getLocalService('domain-router')) return null;
  const { items } = await ctx.call(
    'domain-router.cases.searchIdentifiers',
    { query: message },
    { meta }
  );
  if (!items.length) return null;
  return {
    items: items.map((item) => ({
      ...item,
      title: `Fall ${item.cetCaseId} von ${item.responsible.join(', ')}${item.summary ? `: ${item.summary}` : ''}`,
    })),
    responseText: items
      .map(
        (item) =>
          `Fall ${item.cetCaseId} von ${item.responsible.join(', ')}: ${item.status}${item.summary ? `. ${item.summary}` : '.'}`
      )
      .join('\n'),
  };
}

async function handleCaseLinkTurn(service, ctx, p, envelope, meta) {
  const message = envelope.userRequest.trim();
  const match = message.match(/^(?:das |die fälle )?gehört (nicht )?zusammen(?:\s+(.+?))?[.!]*$/iu);
  const undo = /^(?:mach das rückgängig|rückgängig|undo(?: that)?)[.!\s]*$/iu.test(message);
  if (!match && !undo) return null;
  const turn = await conversationAssistance.readTurn(service.conversationsDb, p, envelope);
  if (undo && turn?.correctionFamily === 'function') return null;
  const conversation = await service.store.resolveConversation(
    { tenantId: p.tenantId, client: envelope.channel, conversationId: envelope.conversationId },
    { optional: true }
  );
  if (!conversation?.cetCaseId)
    return match
      ? {
          mode: 'correction',
          responseText: 'Bitte wähle zuerst den Fall, dessen Verknüpfung du korrigieren möchtest.',
        }
      : null;
  const router = service.broker.getLocalService('domain-router');
  const state = await router.loadCase(p, conversation.cetCaseId);
  if (
    undo &&
    !state.caseLinkCorrections?.some(
      (item) =>
        item.decision !== 'undo' &&
        !state.caseLinkCorrections.some((entry) => entry.undoOf === item.entryId)
    )
  )
    return null;
  let targetCaseId;
  if (match) {
    const discovered = (await router.discover(ctx, p, state)).relatedCases;
    const related = [...discovered];
    // An explicit target can confirm a previously rejected visible relation.
    for (const relation of state.relatedCases) {
      if (related.some((item) => item.cetCaseId === relation.cetCaseId)) continue;
      if (relation.relationshipType !== 'same_subject') continue;
      const target = await router.loadCase(p, relation.cetCaseId, { summaryOnly: true });
      related.push({ ...relation, ...(await router.readCaseSummary(p, target)) });
    }
    const candidates = [];
    for (const item of related) {
      if (item.relationshipType !== 'same_subject') continue;
      const displayRef = await service.store.caseDisplayRef({
        tenantId: p.tenantId,
        caseId: item.cetCaseId,
      });
      if (!match[2] || [item.cetCaseId, displayRef].includes(match[2])) candidates.push(item);
    }
    if (candidates.length !== 1)
      return {
        mode: 'correction',
        responseText:
          'Bitte nenne den eindeutigen verwandten Fall: „gehört zusammen F-…“ oder „gehört nicht zusammen F-…“.',
      };
    targetCaseId = candidates[0].cetCaseId;
  }
  const result = await ctx.call(
    'domain-router.cases.correctLink',
    {
      cetCaseId: state.cetCaseId,
      ...(targetCaseId ? { targetCaseId } : {}),
      decision: undo ? 'undo' : match[1] ? 'rejected' : 'confirmed',
      caseStateVersion: state.caseStateVersion,
    },
    { meta }
  );
  await conversationAssistance.saveTurn(service.conversationsDb, p, envelope, {
    correctionFamily: 'case_link',
  });
  return {
    ...result,
    mode: 'correction',
    responseText: undo
      ? 'Die Fallverknüpfungs-Korrektur ist rückgängig gemacht.'
      : 'Die Fallverknüpfungs-Korrektur ist journalisiert. Mit „rückgängig“ kannst du sie zurücknehmen.',
  };
}

async function relatedCaseContext(service, p, items = []) {
  const visible = [];
  for (const item of items
    .filter((entry) => entry.relationshipType === 'same_subject')
    .slice(0, 5)) {
    visible.push({
      ...item,
      displayRef: await service.store.caseDisplayRef({
        tenantId: p.tenantId,
        caseId: item.cetCaseId,
      }),
    });
  }
  return { items: visible, firstSentence: relatedCaseSentence(visible) };
}

module.exports = {
  sharedCaseSummary,
  findIdentifierStatus,
  handleCaseLinkTurn,
  relatedCaseContext,
};
