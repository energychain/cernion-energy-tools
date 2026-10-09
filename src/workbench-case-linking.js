'use strict';

const conversationAssistance = require('./workbench-conversation');
const { rawContentAllowed, relatedCaseSentence } = require('./case-linking');
const { statusLabel, readableCaseText } = require('./case-continuation');

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
  const p = require('./domain-router-policy').principal({ meta });
  const workbench = ctx.broker.getLocalService('workbench');
  for (const item of items) {
    item.displayRef = await workbench.store.caseDisplayRef({
      tenantId: p.tenantId,
      caseId: item.cetCaseId,
    });
  }
  return presentCaseStatus(items);
}

function presentCaseStatus(items) {
  return {
    items: items.map((item) => ({
      ...item,
      status: ['closed', 'completed', 'resolved', 'blocked'].includes(item.status)
        ? statusLabel(item.status)
        : '',
      title: readableCaseText(`Fall ${item.displayRef}: ${item.summary}`),
    })),
    responseText: readableCaseText(
      items
        .map((item) => {
          const edited = item.updatedAt
            ? `, zuletzt bearbeitet am ${new Date(item.updatedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}${item.lastEditedBy ? ` von ${item.lastEditedBy}` : ''}`
            : '';
          const status = ['closed', 'completed', 'resolved', 'blocked'].includes(item.status)
            ? statusLabel(item.status)
            : 'Die Bearbeitung ist offen';
          return `Fall ${item.displayRef}: ${item.summary}. Angelegt von ${item.responsible.join(', ')}${edited}. Stand: ${status}.`;
        })
        .join('\n\n')
    ),
  };
}

async function conversationCaseStatus(service, ctx, p, envelope, meta) {
  const pending = await conversationAssistance.readTurn(service.conversationsDb, p, envelope);
  const conversation = await service.store.resolveConversation(
    { tenantId: p.tenantId, client: envelope.channel, conversationId: envelope.conversationId },
    { optional: true }
  );
  const router = service.broker.getLocalService('domain-router');
  const explicit = ctx.params.cetCaseId || envelope.userRequest.match(/\bcase[_-][\w-]+\b/iu)?.[0];
  const displayRef = envelope.userRequest.match(/\bF-\d+\b/iu)?.[0];
  const visible = displayRef ? await router.visibleStates(p) : [];
  let displayed;
  for (const state of visible) {
    if (
      (await service.store.caseDisplayRef({ tenantId: p.tenantId, caseId: state.cetCaseId })) ===
      displayRef.toUpperCase()
    ) {
      displayed = state.cetCaseId;
      break;
    }
  }
  const caseId = explicit || displayed || (!displayRef && conversation?.cetCaseId);
  const ids = caseId
    ? [caseId]
    : displayRef || explicit
      ? []
      : (pending?.caseSelection?.items || []).map((item) => item.cetCaseId);
  const items = [];
  for (const id of ids) {
    try {
      const state = await router.loadCase(p, id, { summaryOnly: true });
      items.push({
        ...(await router.readCaseSummary(p, state)),
        displayRef: await service.store.caseDisplayRef({ tenantId: p.tenantId, caseId: id }),
      });
    } catch (error) {
      if (![403, 404].includes(error.code || error.status)) throw error;
    }
  }
  if (pending?.caseSelection)
    await conversationAssistance.saveTurn(
      service.conversationsDb,
      p,
      envelope,
      require('./workbench-case-continuation').advanceSelection(pending)
    );
  if (items.length) {
    const details =
      caseId && items.length === 1
        ? await ctx.call('workbench.cases.get', { caseId }, { meta })
        : {};
    return { ...details, ...presentCaseStatus(items) };
  }
  return null;
}

async function handleCaseLinkTurn(service, ctx, p, envelope, meta) {
  const merged = await require('./workbench-case-continuation').mergeCommand(
    service,
    ctx,
    p,
    envelope,
    meta
  );
  if (merged) return merged;
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
  conversationCaseStatus,
  handleCaseLinkTurn,
  relatedCaseContext,
};
