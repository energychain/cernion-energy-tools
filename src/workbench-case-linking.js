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

// Removes closing marks after a command ("gehört zusammen F-12.").
function withoutClosingMarks(text) {
  let end = text.length;
  while (end > 0 && '.! '.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

// `command` is the turn action of the conversation core; without it the wording is recognized.
// link: { rejected, caseRef } for a statement that the cases (do not) belong together.
function linkCommand(message, command) {
  if (command)
    return {
      link: command.caseLink
        ? { rejected: !command.caseLink.related, caseRef: command.caseLink.caseRef || '' }
        : null,
      undo: command.action === 'undo',
    };
  const found = message.match(/^(?:das |die fälle )?gehört (nicht )?zusammen(.*)$/iu);
  const rest = found ? withoutClosingMarks(found[2]) : '';
  const separated = !rest || rest.trimStart() !== rest;
  return {
    link: found && separated ? { rejected: Boolean(found[1]), caseRef: rest.trim() } : null,
    undo: /^(?:mach das rückgängig|rückgängig|undo(?: that)?)[.!\s]*$/iu.test(message),
  };
}

function hasUndoableLink(state) {
  const corrections = state.caseLinkCorrections || [];
  return corrections.some(
    (item) =>
      item.decision !== 'undo' && !corrections.some((entry) => entry.undoOf === item.entryId)
  );
}

// The visible related case the person means; null when none or several fit.
async function linkTarget(service, ctx, p, router, state, caseRef) {
  const related = [...(await router.discover(ctx, p, state)).relatedCases];
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
    if (!caseRef || [item.cetCaseId, displayRef].includes(caseRef)) candidates.push(item);
  }
  return candidates.length === 1 ? candidates[0].cetCaseId : null;
}

const correctionReply = (responseText) => ({ mode: 'correction', responseText });

function linkDecision(link, undo) {
  if (undo) return 'undo';
  return link.rejected ? 'rejected' : 'confirmed';
}

// The case of this conversation whose links are corrected; a reply when there is none.
async function linkedCase(service, p, envelope, link) {
  const conversation = await service.store.resolveConversation(
    { tenantId: p.tenantId, client: envelope.channel, conversationId: envelope.conversationId },
    { optional: true }
  );
  if (conversation?.cetCaseId) return { caseId: conversation.cetCaseId };
  return {
    reply: link
      ? correctionReply('Bitte wähle zuerst den Fall, dessen Verknüpfung du korrigieren möchtest.')
      : null,
  };
}

async function handleCaseLinkTurn(service, ctx, p, envelope, meta, command) {
  const merged = await require('./workbench-case-continuation').mergeCommand(
    service,
    ctx,
    p,
    envelope,
    meta,
    command
  );
  if (merged) return merged;
  const { link, undo } = linkCommand(envelope.userRequest.trim(), command);
  if (!link && !undo) return null;
  const turn = await conversationAssistance.readTurn(service.conversationsDb, p, envelope);
  if (undo && turn?.correctionFamily === 'function') return null;
  const own = await linkedCase(service, p, envelope, link);
  if (!own.caseId) return own.reply;
  const router = service.broker.getLocalService('domain-router');
  const state = await router.loadCase(p, own.caseId);
  if (undo && !hasUndoableLink(state)) return null;
  let targetCaseId;
  if (link) {
    targetCaseId = await linkTarget(service, ctx, p, router, state, link.caseRef);
    if (!targetCaseId)
      return correctionReply(
        'Bitte nenne den eindeutigen verwandten Fall: „gehört zusammen F-…“ oder „gehört nicht zusammen F-…“.'
      );
  }
  const result = await ctx.call(
    'domain-router.cases.correctLink',
    {
      cetCaseId: state.cetCaseId,
      ...(targetCaseId ? { targetCaseId } : {}),
      decision: linkDecision(link, undo),
      caseStateVersion: state.caseStateVersion,
    },
    { meta }
  );
  await conversationAssistance.saveTurn(service.conversationsDb, p, envelope, {
    correctionFamily: 'case_link',
  });
  return {
    ...result,
    ...correctionReply(
      undo
        ? 'Die Fallverknüpfungs-Korrektur ist rückgängig gemacht.'
        : 'Die Fallverknüpfungs-Korrektur ist journalisiert. Mit „rückgängig“ kannst du sie zurücknehmen.'
    ),
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
