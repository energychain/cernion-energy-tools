'use strict';

const crypto = require('node:crypto');
const understanding = require('./workbench-understanding');
const conversationAssistance = require('./workbench-conversation');
const { filterEvidence } = require('./workbench-retrieval');
const sourceDefaults = require('./workbench-knowledge-sources.json');
const { choiceCandidates, confirmedCapability } = require('./capability-clarification');
const { getFunctionModel } = require('./function-model');
const { resolveFunctions, normalizePhrase } = require('./function-resolver');
const { safeTurnMemory } = require('./workbench-turn-memory');

async function discard(service, ctx, p, envelope, pending, meta) {
  const conversation = await service.store.resolveConversation(
    { tenantId: p.tenantId, client: envelope.channel, conversationId: envelope.conversationId },
    { optional: true }
  );
  const caseId = conversation?.cetCaseId;
  if (caseId) {
    await ctx.call('domain-router.discard', { cetCaseId: caseId }, { meta });
    await service.store.unlinkConversation({
      tenantId: p.tenantId,
      client: envelope.channel,
      conversationId: envelope.conversationId,
    });
    const functionIds = resolveFunctions(
      understanding.routingRequest(pending?.situation || { concern: '', situation: '' }),
      { model: service.settings.systemActivityModel || getFunctionModel() }
    ).matches.map((entry) => entry.functionId);
    const correction = {
      type: 'workbench_case_correction',
      tenantId: p.tenantId,
      actorId: p.actorId,
      caseId,
      kind: 'corrected',
      summary: 'Kein Fall: automatische Fallanlage zurückgenommen.',
      functionIds,
      at: new Date().toISOString(),
    };
    await service.conversationsDb.put({
      _id: `case-correction:${crypto.randomUUID()}`,
      ...correction,
    });
    if (ctx.broker.getLocalService('journal')) {
      for (const functionId of functionIds)
        await ctx.call(
          'journal.append',
          {
            tenantId: p.tenantId,
            functionId,
            kind: 'corrected',
            summary: correction.summary,
            refs: [{ kind: 'case', id: caseId }],
          },
          { meta }
        );
    }
  }
  await conversationAssistance.saveTurn(service.conversationsDb, p, envelope, {
    situation: null,
    caseSuppressed: true,
    lastQuestion: '',
    offeredContent: '',
  });
  return {
    state: 'case_discarded',
    nonBinding: true,
    ...(caseId ? { discardedCaseId: caseId } : {}),
    responseText: caseId
      ? 'Der Fall ist verworfen. Die Korrektur ist gespeichert; ich helfe in diesem Gespräch ohne automatische Fallanlage weiter.'
      : 'Ich helfe in diesem Gespräch ohne automatische Fallanlage weiter.',
  };
}

async function evidenceAccess(service, p) {
  // Access is resolved from persisted tenant/actor mappings, never from the request/LLM.
  const { rows } = await service.identityDb.allDocs({ include_docs: true });
  const catalog = service.settings.workbenchKnowledgeSources || sourceDefaults;
  return Object.fromEntries(
    catalog.sources
      .filter((source) => source.requiresMapping)
      .map((source) => [
        source.id,
        rows.some(
          ({ doc }) =>
            doc.type === source.mappingType &&
            doc.enabled !== false &&
            doc.cetTenantId === p.tenantId &&
            doc.cetActorId === p.actorId &&
            (!doc[source.staffField] ||
              p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(role)))
        ),
      ])
  );
}

async function runContentTurn(service, ctx, { p, mapping, envelope, pending, conversation, meta }) {
  const started = performance.now();
  const workbenchContext = await service.loadWorkbenchContext(p, envelope, mapping);
  const state = conversation?.cetCaseId
    ? await service.loadVisibleCase(ctx, p, conversation.cetCaseId)
    : null;
  let situation;
  try {
    situation = await understanding.understand({
      message: envelope.userRequest,
      messages: ctx.params.messages,
      previous: pending?.situation || state?.knownContext?.situation,
      tenantId: p.tenantId,
      model: service.settings.systemActivityModel,
    });
  } catch (error) {
    service.logger.warn('Workbench understanding unavailable', {
      errorClass: error.type || error.name,
    });
    return {
      state: 'understanding_unavailable',
      nonBinding: true,
      responseText:
        'Ich kann den Inhalt gerade nicht zuverlässig einordnen. Bitte versuche es später erneut; es wurde keine neue Fallbearbeitung gestartet.',
      latencyMs: Math.round(performance.now() - started),
    };
  }
  if (situation.turnKind === 'smalltalk') {
    return {
      state: 'assistance',
      nonBinding: true,
      responseText: 'Hallo! Wie kann ich dir helfen?',
      situation,
      latencyMs: Math.round(performance.now() - started),
    };
  }
  let result = {};
  let previousMemory = null;
  let caseId;
  let operation;
  // Pure knowledge questions never create or advance case state.
  if (situation.turnKind === 'work' && !pending?.caseSuppressed) {
    if (!conversation) {
      const reservation = await service.store.reserveConversation({
        tenantId: p.tenantId,
        client: envelope.channel,
        conversationId: envelope.conversationId,
        openWebuiConversationId: envelope.openWebuiConversationId,
        openWebuiUserId: envelope.openWebuiUserId,
        openWebuiOrgId: envelope.openWebuiOrgId,
        clientId: envelope.asyncDelivery.clientId,
      });
      if (!reservation.reserved)
        conversation = await service.waitForConversationCase({
          tenantId: p.tenantId,
          client: envelope.channel,
          conversationId: envelope.conversationId,
        });
    } else if (!conversation.cetCaseId) {
      conversation = await service.waitForConversationCase({
        tenantId: p.tenantId,
        client: envelope.channel,
        conversationId: envelope.conversationId,
      });
    }
    previousMemory = conversation?.cetCaseId
      ? await service.loadTurnMemory(p, conversation.cetCaseId)
      : null;
    operation = conversation ? 'continue' : 'classify';
    const routedEnvelope = { ...envelope, userRequest: understanding.routingRequest(situation) };
    result = await ctx.call(
      `domain-router.${operation}`,
      {
        ...routedEnvelope,
        requestedMode: operation,
        ...(conversation ? { cetCaseId: conversation.cetCaseId } : {}),
        disableKnowledgeRouting: true,
        knownContext: {
          // Do not promote client knownContext into model-derived facts.
          situation,
          userRequest: routedEnvelope.userRequest,
          identifiers: situation.identifiers,
          deadlines: situation.deadlines,
          workbenchContext,
          ...(previousMemory ? { cetTurnMemory: safeTurnMemory(previousMemory) } : {}),
        },
      },
      { meta }
    );
    caseId = result.cetCaseId;
    await service.store.linkConversation({
      tenantId: p.tenantId,
      client: envelope.channel,
      conversationId: envelope.conversationId,
      openWebuiConversationId: envelope.openWebuiConversationId,
      openWebuiUserId: envelope.openWebuiUserId,
      openWebuiOrgId: envelope.openWebuiOrgId,
      cetCaseId: caseId,
      caseStateVersion: result.caseStateVersion,
      clientId: envelope.asyncDelivery.clientId,
    });
  }
  const access = await evidenceAccess(service, p);
  let retrieval;
  try {
    retrieval = await ctx.call(
      'personal-agent.collectWorkbenchEvidence',
      { situation },
      {
        meta: {
          ...meta,
          workbenchEvidenceAccess: access,
          workbenchSelectedCapabilities: (result.selectedCapabilities || []).map((entry) =>
            typeof entry === 'string' ? entry : entry.capability
          ),
          workbenchEvidenceCaseId: caseId,
        },
        timeout: 4000,
      }
    );
    // Recheck the contract at the response boundary, including stubbed/custom facades.
    const groups = new Map();
    for (const hit of retrieval.evidence || []) {
      const source = hit.retrievalSource || hit.source;
      groups.set(source, [...(groups.get(source) || []), hit]);
    }
    const checks = [...groups].map(([source, hits]) =>
      filterEvidence(hits, situation, {
        catalog: service.settings.workbenchKnowledgeSources,
        source,
      })
    );
    const filtered = {
      hits: checks.flatMap((entry) => entry.hits),
      rejected: checks.flatMap((entry) => entry.rejected),
    };
    retrieval = {
      ...retrieval,
      evidence: filtered.hits,
      trace: [
        ...(retrieval.trace || []),
        { source: 'response_boundary', rejected: filtered.rejected },
      ],
    };
  } catch (error) {
    retrieval = {
      evidence: [],
      noCallBoundaries: [],
      trace: [{ source: 'pipeline', status: 'unavailable', error: error.type || error.name }],
    };
  }
  const reply = await understanding.answer({
    situation,
    retrieval,
    tenantId: p.tenantId,
    asked: pending?.askedQuestions || [],
  });
  let draftId;
  if (reply.draft && caseId)
    draftId = await conversationAssistance.saveDraft(
      service.conversationsDb,
      p,
      caseId,
      reply.draft
    );
  let displayRef;
  if (caseId) displayRef = await service.store.caseDisplayRef({ tenantId: p.tenantId, caseId });
  const allowedDomains = situation.hypotheses
    .filter((h) => h.kind === 'domain' && h.confidence >= 0.5)
    .map((h) => h.id);
  const choices =
    result.uncertain && allowedDomains.includes(result.primaryDomain)
      ? choiceCandidates(result, service.settings.systemActivityModel).slice(0, 3)
      : [];
  result.responseText = [
    reply.responseText,
    choices.length
      ? `Optional passende Funktion (Nummer oder Name):\n${choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')}`
      : '',
    displayRef
      ? `Ich führe das als Fall ${displayRef}. Mit „Kein Fall“ kannst du ihn verwerfen.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  result.requiredClarifications = reply.questions.map((item) => item.question);
  result.noCallGuards = [
    ...new Set([
      ...(result.noCallGuards || []),
      ...(workbenchContext.noCallGuards || []),
      ...(retrieval.noCallBoundaries || []),
    ]),
  ];
  if (caseId) {
    const annotation = await ctx.call(
      'domain-router.recordWorkbenchTurn',
      {
        cetCaseId: caseId,
        caseStateVersion: result.caseStateVersion,
        responseText: result.responseText.slice(0, 16000),
        requiredClarifications: result.requiredClarifications,
        noCallGuards: result.noCallGuards,
      },
      { meta }
    );
    result.caseStateVersion = annotation.caseStateVersion;
    await service.store.linkConversation({
      tenantId: p.tenantId,
      client: envelope.channel,
      conversationId: envelope.conversationId,
      cetCaseId: caseId,
      caseStateVersion: result.caseStateVersion,
    });
  }
  await conversationAssistance.saveTurn(service.conversationsDb, p, envelope, {
    situation,
    offeredContent: '',
    lastQuestion: '',
    askedQuestions: [...(pending?.askedQuestions || []), ...reply.questions],
  });
  const turnMemory = caseId
    ? await service.saveTurnMemory(p, {
        caseId,
        caseStateVersion: result.caseStateVersion,
        previousMemory,
        classification: result,
        envelope: { ...envelope, userRequest: understanding.routingRequest(situation) },
        mapping,
        workbenchContext,
      })
    : null;
  const eventSummary = caseId
    ? await service.eventSummary(p, caseId, { clientId: envelope.asyncDelivery?.clientId })
    : service.emptyEventSummary();
  return {
    ...service.chatResponse(operation || 'answer', result, eventSummary, turnMemory),
    state: 'assistance',
    nonBinding: true,
    situation,
    evidence: reply.evidence,
    retrievalTrace: retrieval.trace,
    answerStatus: reply.answerStatus,
    ...(displayRef ? { caseDisplayRef: displayRef } : {}),
    ...(draftId ? { draftId } : {}),
    latencyMs: Math.round(performance.now() - started),
  };
}

async function selectChoice(service, ctx, { p, mapping, envelope, conversation, meta }) {
  if (!conversation?.cetCaseId) return null;
  const state = await service.loadVisibleCase(ctx, p, conversation.cetCaseId);
  const model = service.settings.systemActivityModel || getFunctionModel();
  const choice = confirmedCapability(envelope.userRequest, state, model);
  if (!choice) return null;
  const situation = state.knownContext.situation;
  if (!situation) return null;
  if (
    !situation.hypotheses.some(
      (hypothesis) =>
        hypothesis.confidence >= 0.5 &&
        (hypothesis.kind === 'domain'
          ? normalizePhrase(hypothesis.id) === normalizePhrase(state.currentDomain)
          : model.functions.some(
              (fn) => fn.functionId === hypothesis.id && fn.capabilities.includes(choice.capability)
            ))
    )
  )
    return null;
  const result = await ctx.call(
    'domain-router.continue',
    {
      ...envelope,
      cetCaseId: conversation.cetCaseId,
      userRequest: understanding.routingRequest(situation),
      disableKnowledgeRouting: true,
      knownContext: { situation, capabilityChoice: envelope.userRequest },
    },
    { meta }
  );
  result.responseText =
    'Die passende Funktion ist ausgewählt. Die Bearbeitung bleibt unverbindlich; es wurde keine externe Handlung ausgeführt.';
  result.requiredClarifications = [];
  const workbenchContext = await service.loadWorkbenchContext(p, envelope, mapping);
  const previousMemory = await service.loadTurnMemory(p, conversation.cetCaseId);
  const memory = await service.saveTurnMemory(p, {
    caseId: result.cetCaseId,
    caseStateVersion: result.caseStateVersion,
    previousMemory,
    classification: result,
    envelope: { ...envelope, userRequest: understanding.routingRequest(situation) },
    mapping,
    workbenchContext,
  });
  await service.store.linkConversation({
    tenantId: p.tenantId,
    client: envelope.channel,
    conversationId: envelope.conversationId,
    cetCaseId: result.cetCaseId,
    caseStateVersion: result.caseStateVersion,
  });
  return {
    ...service.chatResponse(
      'continue',
      result,
      await service.eventSummary(p, result.cetCaseId),
      memory
    ),
    nonBinding: true,
    situation,
  };
}

module.exports = { runContentTurn, discard, selectChoice };
