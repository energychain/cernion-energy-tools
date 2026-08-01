'use strict';

// personal-agent methods chunk 1/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: _executeChatCoreLogic, buildResponseStrategy, buildStrategyLead, buildCopilotAgentAnswer, searchCopilotEntities, collectCopilotMakoKnowledgeEvidence, collectCopilotKnowledgeEvidence, collectCopilotDatapointEvidence, collectCopilotObjectEvidence, collectCopilotPlanningEvidence, enhanceCopilotAnswerWithConsultingBrief, buildCopilotSearchAnswer, resolveConsultationSynthesisTimeoutMs, collectAllowedLegalRefs

const {
  queryKnowledgeEvidenceAdapter,
  buildPersonalAgentResponseStrategy,
  buildPersonalAgentStrategyLead,
  llmGenerateStructured,
  PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT,
  COPILOT_KNOWLEDGE_TIMEOUT_MS,
  COPILOT_DATAPOINT_TIMEOUT_MS,
  COPILOT_OBJECT_STORE_TIMEOUT_MS,
  COPILOT_CONSULTING_BRIEF_TIMEOUT_MS,
  isActionUnavailable,
  compactString,
  toCopilotList,
  isCopilotMakoEdifactQuestion,
  extractCopilotLocationLabelFromObject,
  mapCopilotDomainToSearchDomain,
  objectLooksRelevantToCopilot,
  datapointLooksRelevantToCopilot,
  normalizeCopilotObjectNamespaces,
  copilotKnowledgeHitIsAllowedForQuery,
  copilotQueryRequiresStrictEvidenceRelevance,
  copilotKnowledgeHitHasStrictQueryRelevance,
  collectCopilotShortAnswerEvidence,
  buildCopilotEvidenceShortAnswer,
  buildCopilotGroundingAnswer,
  shouldBuildCopilotConsultingBrief,
  formatCopilotConsultingBrief,
  COPILOT_CONSULTING_BRIEF_SCHEMA,
} = require('./shared');

module.exports = {
  async _executeChatCoreLogic(ctx) {
    const chatActionSchema = this?.schema?.actions?.chat;
    const chatCore = chatActionSchema?._executeChatCoreLogic;
    if (typeof chatCore !== 'function') {
      throw new Error('personal-agent.chat core handler is not available');
    }
    return await chatCore.call(this, ctx);
  },

  buildResponseStrategy(input = {}) {
    return buildPersonalAgentResponseStrategy(input);
  },

  buildStrategyLead(responseStrategy = null) {
    return buildPersonalAgentStrategyLead(responseStrategy || {});
  },

  buildCopilotAgentAnswer(result = {}, { maxEvidence = 5 } = {}) {
    const consultation = result.consultation || {};
    const routing = result.routing || {};
    const execution = result.execution || {};
    const stopPoint = execution.stopPoint || {};

    const evidence = toCopilotList(
      consultation.factsUsed || result.verifiedFacts || result.factsUsed,
      (entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          return { source: 'cernion', value: compactString(entry, 300) };
        }
        return {
          source: compactString(entry.source || entry.label || entry.type || 'cernion', 120),
          value: compactString(entry.value || entry.evidence || entry.statement || entry.text, 400),
        };
      },
      maxEvidence
    );

    const hypotheses = toCopilotList(
      consultation.hypotheses,
      (entry) => entry?.statement || entry?.evidence || null,
      5
    );
    const openQuestions = toCopilotList(
      consultation.openQuestions || stopPoint.missingParams,
      (entry) => {
        if (typeof entry === 'string') return entry;
        return entry?.question || entry?.paramKey || null;
      },
      5
    );
    const recommendedNextSteps = toCopilotList(
      consultation.nextActions,
      (entry) => {
        if (typeof entry === 'string') return entry;
        return entry?.description || entry?.action || null;
      },
      5
    );

    const requestedDomains = Array.isArray(routing.requestedDomains)
      ? routing.requestedDomains
      : [];
    const processContext = [
      routing.primaryIntent,
      routing.routeLabel,
      ...requestedDomains,
      stopPoint.reasonCode ? `stop:${stopPoint.reasonCode}` : null,
    ].filter(Boolean);

    const risks = [
      ...(Array.isArray(routing.warnings) ? routing.warnings : []),
      ...(Array.isArray(result.evidenceGaps)
        ? result.evidenceGaps.map((gap) => gap?.label || gap?.id || gap?.reason).filter(Boolean)
        : []),
    ].slice(0, 5);

    return {
      success: result.success !== false,
      sessionId: result.sessionId || null,
      shortAnswer: compactString(result.reply || consultation.reply || '', 900),
      confidence: evidence.length > 0 ? 'medium' : 'low',
      evidence,
      processContext: processContext.map((entry) => compactString(entry, 160)).slice(0, 8),
      entities: hypotheses.map((entry) => compactString(entry, 160)),
      risks: risks.map((entry) => compactString(entry, 240)),
      openQuestions: openQuestions.map((entry) => compactString(entry, 240)),
      recommendedNextSteps: recommendedNextSteps.map((entry) => compactString(entry, 240)),
      allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
      forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
      routing: {
        primaryIntent: routing.primaryIntent || null,
        routeLabel: routing.routeLabel || null,
        requestedDomains,
        executionStatus: execution.status || null,
        stopReason: stopPoint.reasonCode || null,
      },
    };
  },

  async searchCopilotEntities(ctx, { searchTerm, searchDomain, maxEvidence } = {}) {
    try {
      return await ctx.call(
        'query.search',
        { q: searchTerm, domain: searchDomain, limit: maxEvidence },
        { meta: { ...ctx.meta, $gateway: false }, timeout: 3000 }
      );
    } catch (error) {
      return {
        query: searchTerm,
        domain: searchDomain,
        totalResults: 0,
        results: [],
        error: error.message,
      };
    }
  },

  async collectCopilotMakoKnowledgeEvidence(ctx, { question, maxEvidence = 5 } = {}) {
    if (!isCopilotMakoEdifactQuestion(question)) {
      return { source: 'willi-mako', status: 'skipped', hits: [], trace: { hitCount: 0 } };
    }
    try {
      const result = await ctx.call('willi-mako.resolveStructure', {
        query: compactString(question, 600),
        limit: Math.min(Math.max(Number(maxEvidence) || 5, 1), 5),
      });
      if (!result || result.success === false) {
        return {
          source: 'willi-mako',
          status: 'unavailable',
          hits: [],
          trace: { hitCount: 0, error: result?.error?.code || 'MAKO_KNOWLEDGE_UNAVAILABLE' },
        };
      }
      const sources = Array.isArray(result.data?.sources) ? result.data.sources : [];
      const hits = toCopilotList(
        sources,
        (entry) => ({
          source: 'willi-mako',
          value: compactString(
            [entry.title, entry.url ? `URL: ${entry.url}` : null].filter(Boolean).join(' · '),
            400
          ),
          metadata: { sourceId: entry.id || null, score: entry.score ?? null },
        }),
        maxEvidence
      );
      return {
        source: 'willi-mako',
        status: hits.length > 0 ? 'available' : 'missing',
        hits,
        noCallBoundaries: Array.isArray(result.data?.noCallBoundaries)
          ? result.data.noCallBoundaries
          : [],
        trace: { hitCount: hits.length, confidence: result.data?.confidence || 'none' },
      };
    } catch (_err) {
      process.stderr.write(
        `[methods-part-01-of-11] silent-catch-fallback (line 195): ${_err && _err.message}\n`
      );
      return {
        source: 'willi-mako',
        status: 'unavailable',
        hits: [],
        trace: { hitCount: 0, error: 'MAKO_KNOWLEDGE_UNAVAILABLE' },
      };
    }
  },

  async collectCopilotKnowledgeEvidence(ctx, { question, searchTerm, maxEvidence = 5 } = {}) {
    const query = compactString([searchTerm, question].filter(Boolean).join(' · '), 600);
    const result = await queryKnowledgeEvidenceAdapter(ctx, {
      query,
      limit: Math.min(Math.max(Number(maxEvidence) || 5, 1), 8),
      timeoutMs: COPILOT_KNOWLEDGE_TIMEOUT_MS,
    });
    const filteredHits = result.hits
      .filter((hit) => copilotKnowledgeHitIsAllowedForQuery(hit, query))
      .filter((hit) => copilotKnowledgeHitHasStrictQueryRelevance(hit, query));

    return {
      source: 'knowledge-rag',
      status:
        result.status === 'available' && filteredHits.length === 0 ? 'missing' : result.status,
      query: result.query,
      hits: toCopilotList(
        filteredHits,
        (hit) => ({
          source: compactString(hit.source || 'knowledge-rag', 120),
          value: compactString(
            [
              hit.summary,
              hit.documentType ? `Dokumenttyp: ${hit.documentType}` : null,
              Number.isFinite(Number(hit.score)) ? `Score: ${Number(hit.score).toFixed(3)}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            520
          ),
          retrievalHint: compactString(hit.retrievalHint || '', 500) || undefined,
          metadata: {
            hitId: hit.hitId || null,
            timestamp: hit.timestamp || null,
            documentType: hit.documentType || null,
            score: Number.isFinite(Number(hit.score)) ? Number(hit.score) : null,
          },
        }),
        maxEvidence
      ),
      trace: result.trace || { hitCount: 0 },
    };
  },

  async collectCopilotDatapointEvidence(ctx, { queryTerms = [], maxEvidence = 5 } = {}) {
    try {
      const result = await ctx.call(
        'datapoint.list',
        { limit: 100, includeHealth: true },
        { meta: { ...ctx.meta, $gateway: false }, timeout: COPILOT_DATAPOINT_TIMEOUT_MS }
      );
      const datapoints = Array.isArray(result?.datapoints) ? result.datapoints : [];
      const relevant = datapoints
        .filter((datapoint) => datapointLooksRelevantToCopilot(datapoint, queryTerms))
        .slice(0, maxEvidence);

      return {
        source: 'datapoint',
        status: relevant.length > 0 ? 'available' : 'missing',
        hits: relevant.map((datapoint) => ({
          source: 'datapoint',
          value: compactString(
            [
              datapoint.name,
              datapoint.description,
              Array.isArray(datapoint.tags) && datapoint.tags.length
                ? `Tags: ${datapoint.tags.join(', ')}`
                : null,
              datapoint.health?.status ? `Health: ${datapoint.health.status}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            520
          ),
          metadata: {
            name: datapoint.name,
            sourceType: datapoint.sourceType || null,
            createdAt: datapoint.createdAt || null,
            lastRunAt: datapoint.lastRun?.at || datapoint.lastRun?.finishedAt || null,
          },
        })),
        trace: {
          scannedCount: datapoints.length,
          hitCount: relevant.length,
        },
      };
    } catch (error) {
      return {
        source: 'datapoint',
        status: isActionUnavailable(error) ? 'unavailable' : 'timeout_or_error',
        hits: [],
        trace: { hitCount: 0, error: compactString(error.message, 180) },
      };
    }
  },

  async collectCopilotObjectEvidence(ctx, { context = {}, queryTerms = [], maxEvidence = 5 } = {}) {
    const namespaces = normalizeCopilotObjectNamespaces(context);
    const perNamespaceLimit = Math.max(3, Math.ceil(maxEvidence / Math.max(1, namespaces.length)));
    const responses = await Promise.all(
      namespaces.map(async (namespace) => {
        try {
          const result = await ctx.call(
            'object-store.query',
            { namespace, selector: {}, limit: 25 },
            { meta: { ...ctx.meta, $gateway: false }, timeout: COPILOT_OBJECT_STORE_TIMEOUT_MS }
          );
          const docs = Array.isArray(result?.docs) ? result.docs : [];
          const matched = docs
            .filter((doc) => objectLooksRelevantToCopilot(doc, queryTerms))
            .slice(0, perNamespaceLimit);
          return { namespace, status: 'available', scannedCount: docs.length, docs: matched };
        } catch (error) {
          return {
            namespace,
            status: isActionUnavailable(error) ? 'unavailable' : 'timeout_or_error',
            scannedCount: 0,
            docs: [],
            error: compactString(error.message, 160),
          };
        }
      })
    );

    const hits = responses.flatMap((entry) =>
      entry.docs.map((doc) => ({
        source: `object-store:${entry.namespace}`,
        value: compactString(
          [
            doc.key,
            doc.payload?.title || doc.payload?.name || doc.payload?.status || null,
            doc.updatedAt ? `updated: ${doc.updatedAt}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          520
        ),
        metadata: {
          namespace: entry.namespace,
          key: doc.key,
          updatedAt: doc.updatedAt || null,
        },
      }))
    );

    const availableNamespaces = responses.filter((entry) => entry.status === 'available').length;
    return {
      source: 'object-store',
      status: hits.length > 0 ? 'available' : availableNamespaces > 0 ? 'missing' : 'unavailable',
      hits: hits.slice(0, maxEvidence),
      trace: {
        namespaces: responses.map((entry) => ({
          namespace: entry.namespace,
          status: entry.status,
          scannedCount: entry.scannedCount,
          hitCount: entry.docs.length,
        })),
        hitCount: hits.length,
      },
    };
  },

  async collectCopilotPlanningEvidence(ctx, { analysisSignals = {}, maxEvidence = 5 } = {}) {
    if (!analysisSignals?.active) {
      return { source: 'analysis-planner', status: 'skipped', hits: [] };
    }

    const hits = [];
    const addHit = (value, metadata = {}) => {
      const safeValue = compactString(value, 620);
      if (!safeValue) return;
      hits.push({
        source: 'analysis-planner',
        value: safeValue,
        metadata,
      });
    };

    const signalParts = [
      analysisSignals.postalCode ? `PLZ: ${analysisSignals.postalCode}` : null,
      analysisSignals.assetClass ? `Asset-Klasse: ${analysisSignals.assetClass}` : null,
      analysisSignals.power
        ? `Leistung: ${analysisSignals.power.value} ${analysisSignals.power.unit}`
        : null,
      Array.isArray(analysisSignals.perspectives) && analysisSignals.perspectives.length > 0
        ? `Prüfperspektiven: ${analysisSignals.perspectives.join('; ')}`
        : null,
    ].filter(Boolean);
    addHit(`Cernion Analysis Planner: ${signalParts.join(' · ')}`, { kind: 'signals' });

    const calls = [];
    if (analysisSignals.postalCode) {
      calls.push(
        ctx
          .call(
            'grid-operations.vnbdigitalSearch',
            { searchTerm: analysisSignals.postalCode },
            { meta: { ...ctx.meta, $gateway: false }, timeout: 3000 }
          )
          .then((result) => ({ kind: 'vnbdigital', result }))
          .catch((error) => ({ kind: 'vnbdigital', error }))
      );
      calls.push(
        ctx
          .call(
            'energy-market.installations',
            {
              installationType: 'all',
              postleitzahl: analysisSignals.postalCode,
              limit: 5,
              includeNapData: true,
            },
            { meta: { ...ctx.meta, $gateway: false }, timeout: 5000 }
          )
          .then((result) => ({ kind: 'mastr_installations', result }))
          .catch((error) => ({ kind: 'mastr_installations', error }))
      );
    }

    const responses = await Promise.all(calls);
    for (const response of responses) {
      if (response.error) {
        continue;
      }

      if (response.kind === 'vnbdigital') {
        const results = Array.isArray(response.result?.results) ? response.result.results : [];
        const locationLabel = results
          .map((entry) => extractCopilotLocationLabelFromObject(entry, analysisSignals.postalCode))
          .find(Boolean);
        if (locationLabel) {
          addHit(`Standortauflösung: ${locationLabel}`, {
            kind: response.kind,
            field: 'locationLabel',
          });
        }
        const labels = results
          .slice(0, 3)
          .map((entry) =>
            compactString(
              [entry.title || entry.name, entry.subtitle, entry.type, entry.profileUrl]
                .filter(Boolean)
                .join(' · '),
              180
            )
          )
          .filter(Boolean);
        addHit(
          labels.length > 0
            ? `VNBdigital-Suche zur PLZ ${analysisSignals.postalCode}: ${labels.join(' | ')}. Hinweis: VNBdigital ist ein Zuständigkeits-/Verzeichnischeck, keine Netzkapazitätsprüfung.`
            : `VNBdigital-Suche zur PLZ ${analysisSignals.postalCode}: keine Treffer im Verzeichnis-Schnellcheck. Daraus folgt keine Aussage zur Netzkapazität oder Anschlussfähigkeit.`,
          { kind: response.kind, hitCount: labels.length }
        );
      }

      if (response.kind === 'mastr_installations') {
        const installations = Array.isArray(response.result?.data?.installations)
          ? response.result.data.installations
          : Array.isArray(response.result?.installations)
            ? response.result.installations
            : Array.isArray(response.result?.data?.results)
              ? response.result.data.results
              : Array.isArray(response.result?.results)
                ? response.result.results
                : [];
        const locationLabel = installations
          .map((entry) => extractCopilotLocationLabelFromObject(entry, analysisSignals.postalCode))
          .find(Boolean);
        if (locationLabel) {
          addHit(`Standortauflösung aus MaStR: ${locationLabel}`, {
            kind: response.kind,
            field: 'locationLabel',
          });
        }
        const total =
          response.result?.data?.total ??
          response.result?.total ??
          response.result?.data?.count ??
          installations.length;
        const labels = installations
          .slice(0, 3)
          .map((entry) =>
            compactString(
              [
                entry.name || entry.einheitName || entry.EinheitName || entry.mastrNummer,
                entry.nettoleistung || entry.nettoNennleistung || entry.capacityKW
                  ? `Leistung: ${entry.nettoleistung || entry.nettoNennleistung || entry.capacityKW}`
                  : null,
                entry.netzbetreiberMastrNummer ||
                  entry.gridOperatorMastrId ||
                  entry.gridOperatorName,
              ]
                .filter(Boolean)
                .join(' · '),
              180
            )
          )
          .filter(Boolean);
        addHit(
          labels.length > 0
            ? `MaStR-Schnellcheck PLZ ${analysisSignals.postalCode}: ${total} Treffer; Beispiele: ${labels.join(' | ')}`
            : `MaStR-Schnellcheck PLZ ${analysisSignals.postalCode}: keine Anlagenbeispiele im Schnellcheck.`,
          { kind: response.kind, total }
        );
      }
    }

    return {
      source: 'analysis-planner',
      status: hits.length > 0 ? 'available' : 'missing',
      hits: hits.slice(0, Math.max(1, maxEvidence)),
      trace: {
        signals: analysisSignals,
        toolCalls: responses.map((entry) => ({
          kind: entry.kind,
          status: entry.error ? 'unavailable' : 'available',
        })),
      },
    };
  },

  async enhanceCopilotAnswerWithConsultingBrief(ctx, answer = {}, { context = {} } = {}) {
    if (!shouldBuildCopilotConsultingBrief(context)) return answer;

    try {
      const evidencePreview = (Array.isArray(answer.evidence) ? answer.evidence : [])
        .slice(0, 10)
        .map((entry, index) =>
          [
            `${index + 1}. ${entry.source || 'Cernion'}: ${entry.value || ''}`,
            entry.retrievalHint ? `Retrieval: ${entry.retrievalHint}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        )
        .join('\n\n');
      const prompt = [
        'Du bist Cernion-internes Consulting-Briefing, nicht der finale Nutzer-Chat.',
        'Erzeuge ein kurzes Grounding-Briefing fuer Copilot.',
        'Nutze ausschliesslich die uebergebenen Evidence-Zeilen, Risiken und offenen Fragen.',
        'Keine neuen Rechtsquellen, Fristen, Prozessschritte, Ortsdaten oder Kapazitaetszahlen erfinden.',
        'Wenn die Evidence nur eine Vorpruefung erlaubt, sage das klar.',
        '',
        `NUTZERFRAGE:\n${answer.question || ''}`,
        '',
        `CONFIDENCE:\n${answer.confidence || 'low'}`,
        '',
        `EVIDENCE:\n${evidencePreview || 'Keine Evidence.'}`,
        '',
        `RISIKEN:\n${(answer.risks || []).join('\n') || 'Keine Risiken gemeldet.'}`,
        '',
        `OFFENE FRAGEN:\n${(answer.openQuestions || []).join('\n') || 'Keine offenen Fragen gemeldet.'}`,
      ].join('\n');

      const brief = await llmGenerateStructured(COPILOT_CONSULTING_BRIEF_SCHEMA, prompt, {
        timeoutMs: COPILOT_CONSULTING_BRIEF_TIMEOUT_MS,
        maxRetries: 1,
        tenantId: ctx?.meta?.tenantId,
        ctx,
      });
      const briefText = formatCopilotConsultingBrief(brief);
      if (!briefText) return answer;

      return {
        ...answer,
        consultingBrief: briefText,
        groundingAnswer: compactString(
          [
            answer.groundingAnswer,
            '',
            'CERNION CONSULTING BRIEF:',
            briefText,
            '',
            'BRIEF-REGEL:',
            'Copilot soll den Consulting Brief zur Strukturierung nutzen, aber weiterhin keine Fakten ergaenzen, die nicht in Evidence oder Brief enthalten sind.',
          ].join('\n'),
          7600
        ),
      };
    } catch (error) {
      this.logger?.warn?.(`Copilot consulting brief skipped: ${error.message}`);
      return answer;
    }
  },

  buildCopilotSearchAnswer({
    question,
    sessionId = null,
    domain = 'auto',
    mode = 'answer',
    context = {},
    searchTerm,
    searchResult = {},
    knowledgeEvidence = { status: 'unavailable', hits: [] },
    datapointEvidence = { status: 'unavailable', hits: [] },
    objectEvidence = { status: 'unavailable', hits: [] },
    planningEvidence = { status: 'skipped', hits: [] },
    makoKnowledgeEvidence = { status: 'skipped', hits: [] },
    maxEvidence = 5,
  } = {}) {
    const results = Array.isArray(searchResult.results) ? searchResult.results : [];
    const entityEvidence = results.slice(0, maxEvidence).map((entry) => ({
      source: compactString(entry.domain || entry.type || 'cernion', 120),
      value: compactString(
        [entry.title, entry.excerpt, entry.status ? `Status: ${entry.status}` : null]
          .filter(Boolean)
          .join(' · '),
        500
      ),
    }));
    const knowledgeHits = Array.isArray(knowledgeEvidence.hits) ? knowledgeEvidence.hits : [];
    const datapointHits = Array.isArray(datapointEvidence.hits) ? datapointEvidence.hits : [];
    const objectHits = Array.isArray(objectEvidence.hits) ? objectEvidence.hits : [];
    const planningHits = Array.isArray(planningEvidence.hits) ? planningEvidence.hits : [];
    const unavailablePlannerTools = Array.isArray(planningEvidence.trace?.toolCalls)
      ? planningEvidence.trace.toolCalls
          .filter((entry) => entry?.status === 'unavailable')
          .map((entry) => entry.kind)
          .filter(Boolean)
      : [];
    const evidence = [
      ...planningHits,
      ...entityEvidence,
      ...knowledgeHits,
      ...datapointHits,
      ...objectHits,
    ].slice(0, Math.max(maxEvidence * 4, maxEvidence));
    const hasEvidence = evidence.length > 0;
    const usableShortAnswerEvidence = collectCopilotShortAnswerEvidence(searchTerm, evidence);
    const hasUsableShortAnswerEvidence = usableShortAnswerEvidence.length > 0;
    const strictEvidenceQuestion = copilotQueryRequiresStrictEvidenceRelevance(
      [searchTerm, question].filter(Boolean).join(' ')
    );
    const hasOnlyPlannerSignals =
      evidence.length > 0 &&
      evidence.every(
        (entry) => entry?.source === 'analysis-planner' && entry?.metadata?.kind === 'signals'
      );
    const confidence =
      hasUsableShortAnswerEvidence &&
      (knowledgeHits.length > 0 || datapointHits.length > 0 || objectHits.length > 0)
        ? 'medium'
        : hasUsableShortAnswerEvidence && hasEvidence
          ? 'medium'
          : 'low';
    const shortAnswer = buildCopilotEvidenceShortAnswer({
      searchTerm,
      evidence,
      confidence,
      usableEvidence: usableShortAnswerEvidence,
    });

    const processContext = [
      domain && domain !== 'auto' ? domain : null,
      mode && mode !== 'answer' ? mode : null,
      searchResult.domain ? `search:${searchResult.domain}` : null,
      knowledgeEvidence.status ? `knowledge:${knowledgeEvidence.status}` : null,
      datapointEvidence.status ? `datapoints:${datapointEvidence.status}` : null,
      objectEvidence.status ? `objects:${objectEvidence.status}` : null,
      planningEvidence.status ? `planner:${planningEvidence.status}` : null,
      makoKnowledgeEvidence.status && makoKnowledgeEvidence.status !== 'skipped'
        ? `makoKnowledge:${makoKnowledgeEvidence.status}`
        : null,
    ].filter(Boolean);
    const guardrails = [
      'Copilot soll Knowledge-RAG, Datapoints und Object-Store-Evidence als Antwortkontext nutzen.',
      'Copilot darf Evidence-Snippets nutzernah zusammenfassen, auch wenn daraus keine perfekte Kurzantwort ableitbar ist.',
      'Copilot darf keine Ausführungs-, Lösch-, Signatur-, Override- oder Nominierungsaktion durchführen.',
      'Bei fehlender oder widersprüchlicher Evidence muss Copilot Unsicherheit benennen und darf gezielt nach fehlendem Kontext fragen.',
      ...(makoKnowledgeEvidence.status === 'available'
        ? [
            'Willi-Mako Marktkommunikations-Kontext ist unverbindlicher Wissens-/Struktur-Hinweis, kein offizieller MaKo-Nachweis und keine Anweisung zum Versand einer APERAK/UTILMD/MSCONS-Nachricht.',
          ]
        : []),
    ];

    const risks = [
      searchResult.error ? compactString(searchResult.error, 240) : null,
      hasEvidence && !hasUsableShortAnswerEvidence
        ? 'Treffer vorhanden; sie sollten als indirekter Kontext genutzt und mit Unsicherheit eingeordnet werden.'
        : null,
      strictEvidenceQuestion && !hasUsableShortAnswerEvidence
        ? 'Für diese Standort-/Leistungsfrage liegt keine belastbare Standort-, VNB- oder Netzkapazitäts-Evidence vor.'
        : null,
      hasOnlyPlannerSignals
        ? 'Nur Planner-Signal vorhanden; das ist ein Prüfplan, keine Machbarkeits- oder Kapazitätsevidenz.'
        : null,
      knowledgeEvidence.status === 'timeout'
        ? 'Knowledge-RAG Timeout: Antwort nicht ohne Hinweis finalisieren.'
        : null,
      knowledgeEvidence.status === 'unavailable'
        ? 'Knowledge-RAG nicht verfügbar: zentrale Guardrails konnten nicht geladen werden.'
        : null,
      datapointEvidence.status === 'timeout_or_error'
        ? 'Datapoint-Evidence konnte nicht vollständig geladen werden.'
        : null,
      objectEvidence.status === 'timeout_or_error'
        ? 'Object-Store-Evidence konnte nicht vollständig geladen werden.'
        : null,
      unavailablePlannerTools.length > 0
        ? `Planner-Schnellcheck unvollständig: ${unavailablePlannerTools.join(', ')} nicht verfügbar.`
        : null,
    ].filter(Boolean);
    const openQuestions = hasUsableShortAnswerEvidence
      ? []
      : strictEvidenceQuestion
        ? [
            'Gibt es eine konkrete Fläche, einen Netzanschlusspunkt oder Koordinaten für den Standort?',
            'Liegt eine Rückmeldung, Zuständigkeitsklärung oder Kapazitätsprüfung des zuständigen VNB vor?',
            'Welches Lastprofil, welche Flexibilität und welche Abwärme-/Planungsvorgaben sollen geprüft werden?',
          ]
        : hasEvidence
          ? [
              'Welche konkrete Fundstelle, Rechtsquelle, Domäne oder Prozesssicht soll bei Bedarf vertieft werden?',
            ]
          : [
              'Welche konkrete Fundstelle, Rechtsquelle, Domäne oder Prozesssicht soll geprüft werden?',
            ];
    const recommendedNextSteps = hasUsableShortAnswerEvidence
      ? ['Copilot soll die Evidenztreffer fachlich einordnen und bei Bedarf nach Details fragen.']
      : strictEvidenceQuestion
        ? [
            'Copilot soll klar sagen, dass aus dem Cernion-Kontext keine belastbare Machbarkeits- oder Kapazitätsaussage ableitbar ist, und nur die fehlenden Prüfpunkte nennen.',
          ]
        : hasEvidence
          ? [
              'Copilot soll die vorhandenen Evidenz-Snippets zusammenfassen, Unsicherheit kennzeichnen und optional eine Vertiefung anbieten.',
            ]
          : [
              'Suchbegriff präzisieren oder Cernion-Kontext wie Kommune, VNB, Projekt oder Prozess ergänzen.',
            ];
    const groundingAnswer = buildCopilotGroundingAnswer({
      question,
      searchTerm,
      shortAnswer,
      confidence,
      evidence,
      processContext,
      guardrails,
      risks,
      openQuestions,
      recommendedNextSteps,
    });

    return {
      success: true,
      sessionId,
      question: compactString(question, 500),
      shortAnswer,
      groundingAnswer,
      confidence,
      evidence,
      evidenceBySource: {
        entities: {
          status: entityEvidence.length > 0 ? 'available' : 'missing',
          hits: entityEvidence,
          trace: {
            hitCount: entityEvidence.length,
            totalResults: searchResult.totalResults || results.length,
          },
        },
        knowledge: knowledgeEvidence,
        datapoints: datapointEvidence,
        objects: objectEvidence,
        planning: planningEvidence,
        makoKnowledge: makoKnowledgeEvidence,
      },
      guardrails,
      processContext,
      entities: results
        .slice(0, maxEvidence)
        .map((entry) => compactString(entry.title || entry.id, 160))
        .filter(Boolean),
      risks,
      openQuestions,
      recommendedNextSteps,
      allowedActions: ['explain', 'retrieve_evidence', 'prepare_intent'],
      forbiddenActions: ['execute', 'confirm', 'delete', 'override', 'sign', 'nominate'],
      routing: {
        primaryIntent: 'copilot_evidence_lookup',
        routeLabel: 'Cernion Copilot evidence lookup',
        requestedDomains: domain && domain !== 'auto' ? [domain] : [],
        executionStatus: 'completed',
        stopReason: null,
      },
      query: {
        question: compactString(question, 500),
        searchTerm,
        domain: searchResult.domain || mapCopilotDomainToSearchDomain(domain),
        totalResults: searchResult.totalResults || results.length,
        contextKeys: Object.keys(context || {}).slice(0, 20),
      },
    };
  },

  resolveConsultationSynthesisTimeoutMs() {
    const raw = Number(
      process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS || PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT
    );

    if (!Number.isFinite(raw) || raw < 1_000) {
      return PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT;
    }

    return Math.floor(raw);
  },

  collectAllowedLegalRefs({
    knownContext = {},
    verifiedFacts = [],
    workflowType = '',
    domainIntent = '',
  } = {}) {
    const refs = new Set();
    const refRegex = /§\s*\d+[a-zA-Z]*\s*EnWG/gi;
    const register = (value) => {
      if (value == null) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item) => register(item));
        return;
      }

      const text = String(value);
      const matches = text.match(refRegex) || [];
      matches.forEach((match) => refs.add(String(match).replace(/\s+/g, ' ').trim()));
    };

    register(knownContext?.allowedLegalRefs);
    register(knownContext?.legalReferences);
    register(knownContext?.legalReference);
    register(knownContext?.regulatoryFrame);

    (Array.isArray(verifiedFacts) ? verifiedFacts : []).forEach((fact) => {
      register(fact?.value);
      register(fact?.source);
    });

    const workflowSignal = [workflowType, domainIntent].filter(Boolean).join(' ').toLowerCase();

    if (
      /(wallbox|prosumer|nap|pv|heat|waermepumpe|wärmepumpe|bess|storage)/i.test(workflowSignal)
    ) {
      refs.add('§ 14a EnWG');
    }
    if (/(dynamic|dynamisch|tariff|tarif)/i.test(workflowSignal)) {
      refs.add('§ 41a EnWG');
    }
    if (/(mieterstrom|tenant)/i.test(workflowSignal)) {
      refs.add('§ 42c EnWG');
    }

    return Array.from(refs);
  },
};
