'use strict';

const { randomUUID } = require('node:crypto');
const conversationAssistance = require('./workbench-conversation');
const { caseLabel, sameStrongSubject } = require('./case-continuation');

async function candidates(service, ctx, p, situation, meta) {
  const { items } = await ctx.call(
    'domain-router.cases.continuationCandidates',
    { identifiers: situation.identifiers || [] },
    { meta }
  );
  for (const item of items)
    item.displayRef = await service.store.caseDisplayRef({
      tenantId: p.tenantId,
      caseId: item.cetCaseId,
    });
  return items;
}

function selection(pending, message) {
  if (!pending?.caseSelection) return null;
  const text = message.trim().replace(/[.!]$/u, '');
  if (/^(?:neu|neuer fall)$/iu.test(text)) return { newCase: true };
  const items = pending.caseSelection.items;
  const item = /^[1-3]$/u.test(text)
    ? items[Number(text) - 1]
    : items.find((entry) => [entry.displayRef, entry.cetCaseId].includes(text));
  return item ? { caseId: item.cetCaseId } : { invalid: true };
}

function mergeSituation(previous, current) {
  if (!previous) return current;
  const result = { ...previous, ...current, concern: previous.concern || current.concern };
  result.situation = [...new Set([previous.situation, current.situation].filter(Boolean))].join(
    '\n'
  );
  for (const field of ['identifiers', 'deadlines', 'participants', 'hypotheses']) {
    result[field] = [
      ...new Map(
        [...(previous[field] || []), ...(current[field] || [])].map((entry) => [
          JSON.stringify(entry),
          entry,
        ])
      ).values(),
    ];
  }
  return result;
}

async function assignCase(service, ctx, p, envelope, situation, pending, meta) {
  const choice = selection(pending, envelope.userRequest);
  if (choice?.invalid)
    return {
      response: {
        state: 'case_selection',
        nonBinding: true,
        responseText: 'Bitte antworte mit der Fallnummer, der Nummer deiner Auswahl oder „neu“.',
      },
    };
  const items = await candidates(service, ctx, p, situation, meta);
  let selected;
  if (choice?.caseId) {
    selected = items.find((item) => item.cetCaseId === choice.caseId);
    if (!selected)
      return {
        response: {
          state: 'case_selection',
          nonBinding: true,
          responseText:
            'Dieser Fall ist nicht mehr für die Fortsetzung verfügbar. Du kannst „neu“ wählen.',
        },
      };
    if (!selected.canContinue)
      return {
        response: {
          state: 'case_selection',
          nonBinding: true,
          responseText: `Du kannst ${caseLabel(selected)} sehen, hast aber keine Freigabe zur Bearbeitung. Wähle „neu“, um dein Material in einem eigenen Fall zu bearbeiten.`,
        },
      };
  } else if (!choice?.newCase && items.length === 1) {
    selected = items[0];
  } else if (!choice?.newCase && items.length) {
    const shown = items.slice(0, 3);
    await conversationAssistance.saveTurn(service.conversationsDb, p, envelope, {
      caseSelection: { items: shown, message: envelope.userRequest },
      situation,
    });
    return {
      response: {
        state: 'case_selection',
        nonBinding: true,
        responseText: `Das Material könnte zu ${shown.map(caseLabel).join('; ')} gehören. Welchen Fall soll ich fortsetzen (Fallnummer oder 1–${shown.length}), oder möchtest du „neu“?`,
      },
    };
  }
  return { selected, items, choice };
}

async function recordContribution(service, p, envelope, caseId, situation) {
  const router = service.broker.getLocalService('domain-router');
  const entryId = randomUUID();
  await router.eventsDb.put({
    _id: `case-contribution:${entryId}`,
    entryId,
    tenantId: p.tenantId,
    actorId: p.actorId,
    cetCaseId: caseId,
    kind: 'contributed',
    summary: 'Neues Material zum bestehenden Fall hinzugefügt.',
    conversationId: envelope.conversationId,
    material: envelope.userRequest,
    situation,
    at: new Date().toISOString(),
  });
  return entryId;
}

async function duplicateProposal(service, p, selected, items) {
  if (!selected) return { items: [], text: '' };
  const router = service.broker.getLocalService('domain-router');
  const types = router.casePolicy(p).identifierTypes;
  const duplicates = items
    .filter(
      (item) =>
        item.cetCaseId !== selected.cetCaseId &&
        sameStrongSubject(selected.identifiers, item.identifiers, types, true)
    )
    .slice(0, 20);
  return {
    items: duplicates,
    text: duplicates.length
      ? `Weitere offene Fälle mit denselben Kennungen: ${duplicates.slice(0, 3).map(caseLabel).join('; ')}${duplicates.length > 3 ? ` sowie ${duplicates.length - 3} weitere` : ''}. Soll ich diese mit ${selected.displayRef} zusammenführen? Bestätige ausdrücklich mit „Fälle zusammenführen“; bis dahin bleiben sie eigenständig.`
      : '',
  };
}

async function mergeCommand(service, ctx, p, envelope, meta) {
  if (!/^(?:fälle zusammenführen|zusammenführung bestätigen)[.!\s]*$/iu.test(envelope.userRequest))
    return null;
  const pending = await conversationAssistance.readTurn(service.conversationsDb, p, envelope);
  const proposal = pending?.caseMergeProposal;
  if (!proposal?.sourceCaseIds?.length)
    return {
      mode: 'correction',
      responseText: 'In diesem Gespräch liegt kein Zusammenführungsvorschlag zur Bestätigung vor.',
    };
  const result = await ctx.call(
    'domain-router.cases.mergeConfirmed',
    { ...proposal, confirmed: true },
    { meta }
  );
  // Bind existing chats using the same store validation and conflict handling.
  const { rows } = await service.conversationsDb.allDocs({ include_docs: true });
  for (const { doc } of rows) {
    if (
      doc.type !== 'workbench_conversation' ||
      doc.tenantId !== p.tenantId ||
      !proposal.sourceCaseIds.includes(doc.cetCaseId)
    )
      continue;
    await service.store.linkConversation({
      tenantId: p.tenantId,
      client: doc.client,
      conversationId: doc.externalConversationId,
      cetCaseId: proposal.cetCaseId,
      caseStateVersion: result.caseStateVersion,
      overwrite: true,
    });
  }
  await conversationAssistance.saveTurn(service.conversationsDb, p, envelope, {
    caseMergeProposal: null,
  });
  return {
    ...result,
    mode: 'correction',
    responseText:
      'Die bestätigten Fälle sind zusammengeführt. Inhalte und Journal bleiben erhalten; die Zusammenführung ist auditiert.',
  };
}

module.exports = {
  assignCase,
  selection,
  mergeSituation,
  recordContribution,
  duplicateProposal,
  mergeCommand,
};
