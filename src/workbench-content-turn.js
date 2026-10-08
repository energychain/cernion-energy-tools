'use strict';

const { persistentSituation } = require('./workbench-turn-scope');

const crypto = require('node:crypto');
const { relatedCaseContext } = require('./workbench-case-linking');
const understanding = require('./workbench-understanding');
const conversationAssistance = require('./workbench-conversation');
const { filterEvidence, retrievalTimeoutMs } = require('./workbench-retrieval');
const sourceDefaults = require('./workbench-knowledge-sources.json');
const { knowledgeSourceAccess } = require('./workbench-knowledge-access');
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
  // Resolve server-side policy and persisted mappings under the authenticated tenant.
  const { rows } = await service.identityDb.allDocs({ include_docs: true });
  const catalog = service.settings.workbenchKnowledgeSources || sourceDefaults;
  return {
    ...knowledgeSourceAccess({ meta: { tenantId: p.tenantId } }, catalog.sources),
    ...Object.fromEntries(
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
    ),
  };
}

async function runContentTurn(service, ctx, { p, mapping, envelope, pending, conversation, meta }) {
  const started = performance.now();
  const rawMessage = envelope.userRequest;
  const thread = require('./workbench-thread');
  if (thread.isThreadInput(rawMessage))
    envelope = { ...envelope, userRequest: thread.prepareThread(rawMessage, 12000).text };
  const workbenchContext = await service.loadWorkbenchContext(p, envelope, mapping);
  const state = conversation?.cetCaseId
    ? await service.loadVisibleCase(ctx, p, conversation.cetCaseId)
    : null;
  const previous = persistentSituation(pending?.situation || state?.knownContext?.situation);
  const draftRequest = Boolean(previous && understanding.isDraftRequest(envelope.userRequest));
  const phaseTimes = { understandMs: 0, retrieveMs: 0, answerMs: 0 };
  let situation;
  let understandingFailed = false;
  const understandStarted = performance.now();
  try {
    situation = draftRequest
      ? {
          ...previous,
          requestedAction: {
            ...previous.requestedAction,
            externalEffect: false,
            draftRequested: true,
          },
        }
      : await understanding.understand({
          message: rawMessage,
          messages: ctx.params.messages,
          previous,
          asked: pending?.askedQuestions || [],
          tenantId: p.tenantId,
          model: service.settings.systemActivityModel,
          codeCatalog: service.settings.workbenchCodeCatalog,
          logger: service.logger,
        });
  } catch (error) {
    understandingFailed = true;
    service.logger.warn('Workbench understanding unavailable', {
      ...require('./workbench-llm-errors').llmErrorDetails(error),
    });
    situation = previous || {
      concern: envelope.userRequest.slice(0, 1200),
      situation: '',
      participants: [],
      identifiers: [],
      deadlines: [],
      hypotheses: [],
      missingInformation: [],
      requestedAction: {
        description: 'Prüfe die Angaben im Dokument und den bisherigen Bearbeitungsstand.',
        draftRequested: understanding.isDraftRequest(envelope.userRequest),
        externalEffect: false,
      },
      turnKind: 'knowledge',
      retrievalTerms: [],
    };
  }
  phaseTimes.understandMs = Math.round(performance.now() - understandStarted);
  const nextStepRequest =
    !understanding.isDraftRequest(envelope.userRequest) && situation.followupKind === 'next_step';
  const reuseEvidence = Boolean(
    previous &&
    nextStepRequest &&
    pending?.retrieval &&
    Date.now() - (pending.evidenceRetrievedAt || 0) < 300000
  );
  // Use the understood turn kind before deciding whether fresh retrieval is needed.
  const prefetchedKnowledge =
    !draftRequest && !reuseEvidence
      ? ctx
          .call(
            'personal-agent.collectWorkbenchEvidence',
            {
              situation: {
                concern: envelope.userRequest.slice(0, 600),
                situation: previous?.concern || '',
                hypotheses: [],
                retrievalTerms: [],
              },
            },
            {
              meta: { ...meta, workbenchEvidenceSources: ['knowledge-rag'] },
              timeout: retrievalTimeoutMs(),
            }
          )
          .catch(() => null)
      : null;
  if (situation.turnKind === 'smalltalk') {
    service.logger.info('Workbench turn phases and sources', { phaseTimes, sources: [] });
    return {
      state: 'assistance',
      nonBinding: true,
      responseText: 'Hallo! Wie kann ich dir helfen?',
      situation,
      phaseTimes,
      sources: [],
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
          situation: persistentSituation(situation),
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
  if (result.primaryDomain) situation = { ...situation, primaryDomain: result.primaryDomain };
  const prefetched = prefetchedKnowledge ? await prefetchedKnowledge : null;
  const prefetchTrace = prefetched?.trace?.find((entry) => entry.source === 'knowledge-rag');
  const knowledgeCache = prefetchTrace
    ? {
        status: prefetchTrace.status,
        hits: prefetched.evidence.filter((hit) => hit.retrievalSource === 'knowledge-rag'),
        trace: prefetchTrace,
      }
    : null;
  const access = await evidenceAccess(service, p);
  const codes = require('./workbench-codes');
  const codeLookup = codes.resolveCodes(
    { call: (name, params, options) => ctx.call(name, params, { ...options, meta }), meta },
    situation,
    access,
    service.settings.workbenchCodeCatalog,
    service.settings.workbenchKnowledgeSources || sourceDefaults
  );

  let retrieval;
  const retrieveStarted = performance.now();
  const resolvedCodes = await codeLookup;
  try {
    if (understandingFailed && !previous) {
      retrieval = { evidence: [], trace: [] };
    } else if ((draftRequest || reuseEvidence) && pending?.retrieval) {
      retrieval = {
        ...pending.retrieval,
        trace: (pending.retrieval.trace || [])
          .filter((entry) => entry.source !== 'response_boundary')
          .map((entry) => ({ ...entry, called: false, ms: 0 })),
      };
    } else {
      retrieval = await ctx.call(
        'personal-agent.collectWorkbenchEvidence',
        { situation },
        {
          meta: {
            ...meta,
            workbenchEvidenceAccess: access,
            workbenchEvidenceSources: null,
            workbenchPrefetchedKnowledge: knowledgeCache,
            workbenchSelectedCapabilities: (result.selectedCapabilities || []).map((entry) =>
              typeof entry === 'string' ? entry : entry.capability
            ),
            workbenchEvidenceCaseId: caseId,
          },
          timeout: retrievalTimeoutMs(),
        }
      );
    }
    // Recheck the contract at the response boundary, including stubbed/custom facades.
    const groups = new Map();
    for (const hit of retrieval.evidence || []) {
      const source = hit.retrievalSource || hit.source;
      const sourcePolicy = (
        service.settings.workbenchKnowledgeSources || sourceDefaults
      ).sources.find((entry) => entry.id === source);
      if (access[source] === false || (sourcePolicy?.requiresMapping && !access[source])) continue;
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
        ...(retrieval.trace || []).map((entry) =>
          access[entry.source] === false
            ? { ...entry, status: 'skipped', hitCount: 0, called: false }
            : entry
        ),
        { source: 'response_boundary', rejected: filtered.rejected },
      ],
    };
  } catch (error) {
    retrieval = {
      evidence: [],
      noCallBoundaries: [],
      trace: [
        {
          source: 'pipeline',
          status: require('./workbench-retrieval').isSourceTimeout(error)
            ? 'timeout'
            : 'unavailable',
          ms: Math.round(performance.now() - retrieveStarted),
          error: error.type || error.name,
        },
      ],
    };
  }
  situation.codeResolutions = resolvedCodes.resolutions;
  situation.missingInformation = [
    ...codes.unresolvedQuestions(resolvedCodes.resolutions),
    ...situation.missingInformation,
  ].slice(0, 10);
  retrieval.evidence = [...resolvedCodes.evidence, ...(retrieval.evidence || [])];
  retrieval.trace = [...(retrieval.trace || []), ...resolvedCodes.trace];
  phaseTimes.retrieveMs = Math.round(performance.now() - retrieveStarted);
  const related = await relatedCaseContext(service, p, result.relatedCases);
  retrieval.evidence.push(
    ...related.items.map((item) => ({
      source: 'related_case',
      value: `Fall ${item.displayRef}: ${item.status}. ${item.summary}`,
      metadata: { cetCaseId: item.cetCaseId },
    }))
  );
  const answerStarted = performance.now();
  let reply;
  try {
    reply = await understanding.answer({
      situation,
      retrieval,
      tenantId: p.tenantId,
      asked: pending?.askedQuestions || [],
      previousDraft: pending?.draft || '',
      message: envelope.userRequest,
      followup: Boolean(previous),
      nextStepOnly: Boolean(previous && nextStepRequest),
      skipModel: understandingFailed,
      lastAnswer: pending?.lastAnswer || '',
      logger: service.logger,
    });
  } finally {
    phaseTimes.answerMs = Math.max(1, Math.round(performance.now() - answerStarted));
  }
  const { sourceMetadata } = require('./workbench-retrieval');
  const sources = sourceMetadata(retrieval.trace);
  service.logger.info('Workbench turn phases and sources', { phaseTimes, sources });
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
  let firstAutoCase = false;
  if (displayRef && operation === 'classify') {
    firstAutoCase = await service.store.claimAutoCaseHint(p);
  }
  const allowedDomains = situation.hypotheses
    .filter((h) => h.kind === 'domain' && h.confidence >= 0.5)
    .map((h) => h.id);
  const choices =
    result.uncertain &&
    allowedDomains.some(
      (domain) => normalizePhrase(domain) === normalizePhrase(result.primaryDomain)
    )
      ? choiceCandidates(result, service.settings.systemActivityModel).slice(0, 3)
      : [];
  result.responseText = [
    related.firstSentence,
    reply.responseText,
    choices.length
      ? `Optional passende Funktion (Nummer oder Name):\n${choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')}`
      : '',
    displayRef
      ? `Fall ${displayRef}${firstAutoCase ? ' · Mit „Kein Fall“ kannst du ihn verwerfen.' : ''}`
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
    let annotation;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        annotation = await ctx.call(
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
        break;
      } catch (error) {
        if (error.code !== 409 && error.status !== 409) throw error;
        const latest = await service.loadVisibleCase(ctx, p, caseId);
        // The router still rejects discarded cases; never bypass its state guard.
        if (latest.disposition === 'discarded' || attempt === 3) throw error;
        result.caseStateVersion = latest.caseStateVersion;
      }
    }
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
    retrieval,
    evidenceRetrievedAt: draftRequest || reuseEvidence ? pending?.evidenceRetrievedAt : Date.now(),
    draft: reply.draft,
    offeredContent: '',
    lastQuestion: '',
    lastAnswer: reply.responseText.slice(0, 600),
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
    state: understandingFailed && !previous ? 'understanding_unavailable' : 'assistance',
    nonBinding: true,
    situation,
    evidence: reply.evidence,
    retrievalTrace: [...(retrieval.trace || []), reply.evidenceTrace],
    answerAttempts: reply.answerAttempts,
    answerStatus: reply.answerStatus,
    phaseTimes,
    sources,
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
  const situation = persistentSituation(state.knownContext.situation);
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
  result.responseText = 'Die passende Funktion ist ausgewählt.';
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

// Serialize content turns per actor/conversation, including the initial reservation.
// Refresh persisted questions after waiting so parallel requests cannot repeat them.
async function queuedContentTurn(service, ctx, input) {
  const queues = (service.workbenchContentTurns ||= new Map());
  const key = JSON.stringify([
    input.p.tenantId,
    input.p.actorId,
    input.envelope.channel,
    input.envelope.conversationId,
  ]);
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  queues.set(key, gate);
  await previous;
  try {
    const pending = await conversationAssistance.readTurn(
      service.conversationsDb,
      input.p,
      input.envelope
    );
    const conversation = await service.store.resolveConversation(
      {
        tenantId: input.p.tenantId,
        client: input.envelope.channel,
        conversationId: input.envelope.conversationId,
      },
      { optional: true }
    );
    return await runContentTurn(service, ctx, { ...input, pending, conversation });
  } finally {
    release();
    if (queues.get(key) === gate) queues.delete(key);
  }
}

module.exports = { runContentTurn: queuedContentTurn, discard, selectChoice };
