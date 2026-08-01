'use strict';

// personal-agent methods chunk 3/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: buildConsultationDegradation, deriveConsultationDegradation, buildConsultationVnbUncertaintyNote, buildConsultationObservationSummaryReply, buildConsultationToolRegistry, parseConsultationJsonResponse, inferConsultationToolCall, summarizeConsultationObservation, shouldEarlyExitConsultationLoop, deriveConsultationPrimaryIntent, handleConsultationTurnAgentic, callLlmGenerate, classifyChatModeLLM, classifyConsultationIntentHybrid

const {
  CHAT_MODES,
  pruneUndefinedDeep,
  fuzzyClassifyConsultationIntent,
  resolveLocationFromText,
  llmGenerateText,
  llmGenerateStructured,
  executeToolWithRetry,
  CONSULTATION_OUTPUT_SCHEMA,
  CONSULTATION_REACT_MAX_ITERATIONS,
  CONSULTATION_REACT_MAX_MS,
  CONSULTATION_SYNTHESIS_MIN_MS,
  CONSULTATION_TOOL_MAX_ATTEMPTS,
  CONSULTATION_TOOL_TIMEOUT_MS,
  CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS,
  isActionUnavailable,
  buildConsultationToolExecutionContext,
  isConsultationDebugEnabled,
  sanitizeConsultationDebugText,
  sanitizeConsultationDebugError,
  createConsultationDebugRecorder,
} = require('./shared');

module.exports = {
  buildConsultationDegradation({
    reason = 'consultation_degraded',
    timeoutFallback = false,
    recoveredFromEvidence = false,
    userVisible = true,
  } = {}) {
    return {
      active: true,
      code: 'CONSULTATION_SYNTHESIS_DEGRADED',
      phase: 'consultation_synthesis',
      reason: String(reason || 'consultation_degraded').slice(0, 80),
      timeoutFallback: Boolean(timeoutFallback),
      recoveredFromEvidence: Boolean(recoveredFromEvidence),
      userVisible: Boolean(userVisible),
    };
  },

  deriveConsultationDegradation(result = {}, { timeoutFallback = false } = {}) {
    if (result?.degradation && typeof result.degradation === 'object') {
      return result.degradation;
    }

    const debugTrace = Array.isArray(result?.debugTrace) ? result.debugTrace : [];
    if (debugTrace.length === 0 && !timeoutFallback) {
      return null;
    }

    const fallbackEvent = debugTrace.find(
      (event) => event?.type === 'consultation_fallback_selected'
    );
    const synthesisNullEvent = debugTrace.find(
      (event) => event?.type === 'consultation_synthesis_null'
    );
    const synthesisErrorEvent = debugTrace.find(
      (event) => event?.type === 'consultation_synthesis_error'
    );
    const synthesisSkippedEvent = debugTrace.find(
      (event) => event?.type === 'consultation_synthesis_skipped'
    );
    const recoveredFromEvidence =
      fallbackEvent?.branch === 'observation_summary_reply' ||
      (Array.isArray(result?.factsUsed) && result.factsUsed.length > 0 && !timeoutFallback);

    return this.buildConsultationDegradation({
      reason:
        fallbackEvent?.reason ||
        synthesisNullEvent?.reason ||
        synthesisErrorEvent?.errorCode ||
        synthesisSkippedEvent?.reason ||
        (timeoutFallback ? 'timeout_fallback' : 'consultation_degraded'),
      timeoutFallback,
      recoveredFromEvidence,
      userVisible: true,
    });
  },

  buildConsultationVnbUncertaintyNote(message = '', observations = []) {
    const observationList = Array.isArray(observations) ? observations : [];
    const hasVerifiedVnbLookup = observationList.some(
      (obs) =>
        obs?.action === 'grid-operations.vnbLookup' &&
        obs?.status === 'completed' &&
        !obs?.error &&
        obs?.result?.error == null
    );

    const hasMarketPartnersContext = observationList.some(
      (obs) => obs?.action === 'grid-operations.marketPartners'
    );

    const hasVnbContext =
      /(?:\bvnb\b|\bnetzbetreiber\b|\bnetzgebiet\b|\bnetzzone\b|\bstandort\b|\banschluss\b|\bbdew\b|\bmarktlokation\b|\bnetzanschlusspunkt\b)/i.test(
        String(message || '')
      ) ||
      hasMarketPartnersContext ||
      observationList.some((obs) => obs?.action === 'grid-operations.vnbLookup');

    if (!hasVnbContext || hasVerifiedVnbLookup) {
      return '';
    }

    return hasMarketPartnersContext
      ? ' Die Zuständigkeit des VNB ist noch nicht belastbar verifiziert (Marktpartner-Treffer allein sind kein Netzgebietsnachweis).'
      : ' Die Zuständigkeit des VNB ist noch nicht belastbar verifiziert.';
  },

  buildConsultationObservationSummaryReply(
    message = '',
    observations = [],
    collectedFacts = [],
    options = {}
  ) {
    const synthesisPolicy = options.synthesisPolicy || null;
    const routingPolicy = options.routingPolicy || null;
    const deprioritizeToolFailure =
      Array.isArray(synthesisPolicy?.deprioritize) &&
      synthesisPolicy.deprioritize.includes('tool_failure_as_main_answer');
    const isMunicipalSitePrecheck =
      routingPolicy?.sessionIntent === 'municipal_energy_site_precheck' ||
      synthesisPolicy?.audience === 'municipal_official';

    const observationList = Array.isArray(observations) ? observations : [];
    const topFacts = observationList
      .slice(0, 3)
      .map((obs) => ({
        label: obs.action || 'Überprüfung',
        summary: String(
          obs.summary || obs.result?.description || obs.error || 'durchgeführt'
        ).slice(0, 220),
      }))
      .filter((item) => Boolean(item.label));

    const uncertaintyNote = this.buildConsultationVnbUncertaintyNote(message, observationList);
    const hasUnverifiedVnbContext = Boolean(uncertaintyNote);

    const knownContext =
      options.knownContext && typeof options.knownContext === 'object' ? options.knownContext : {};
    const resolvedParams =
      options.resolvedParams && typeof options.resolvedParams === 'object'
        ? options.resolvedParams
        : {};
    const knowledgeContext =
      options.knowledgeContext && typeof options.knowledgeContext === 'object'
        ? options.knowledgeContext
        : {};
    const locationContext = {
      ...knownContext,
      ...resolvedParams,
      ...knowledgeContext,
    };
    const location = resolveLocationFromText(message, locationContext);
    const municipality =
      location?.municipality || locationContext.municipality || locationContext.city;
    const postalCode =
      location?.postalCode || locationContext.postalCode || locationContext.postleitzahl;
    const locationLabel = [postalCode, municipality].filter(Boolean).join(' ').trim();
    const asksAboutOsm = /\bOSM\b|openstreetmap|topolog/i.test(String(message || ''));
    const asksAboutDecisionClarity =
      /(?:klarheit|belastbar|tatsächlich|tatsaechlich|heute|möglich|moeglich|spekulativ|annehmen|woher)/i.test(
        String(message || '')
      );

    let replyText;
    if (deprioritizeToolFailure && isMunicipalSitePrecheck) {
      if (asksAboutDecisionClarity && !asksAboutOsm) {
        replyText =
          `Für ${locationLabel || 'den kommunalen Standort'} bekommen Sie belastbare Klarheit erst über eine konkrete Fläche oder Koordinaten, die gewünschte Anschlussleistung in MW und die formelle Vorprüfung beim zuständigen Netzbetreiber. ` +
          'Heute seriös möglich ist eine Gemeindeebenen-Einordnung: Standortkontext, grobe Flächenlogik, Nähe zu Infrastruktur und erkennbare Ausschluss- oder Risikothemen. ' +
          'Noch spekulativ bleiben VNB-Zuständigkeit, verfügbare Netzkapazität, Netzanschlusspunkt, Kosten und Zeithorizont, solange keine flächenscharfe Netzanschlussprüfung vorliegt. ' +
          'Öffentliche Spatial-Daten wie OSM können diese Hypothese plausibilisieren, ersetzen aber keine Netzanschlussprüfung.';
      } else {
        replyText =
          `Für ${locationLabel || 'den kommunalen Standort'} bleibt die Einordnung ein kommunaler Standort-Precheck auf Gemeindeebene. ` +
          'Tool-Lücken sind hier keine Hauptaussage: VNB-Zuständigkeit und Netzkapazität sind noch nicht belastbar verifiziert. ' +
          (asksAboutOsm
            ? 'OSM kann als öffentlicher Spatial-Context-Layer helfen, Lage, Verkehrsanbindung, Gewerbekontext und mögliche Flächenbezüge zu strukturieren; es ersetzt aber keine Netzanschlussprüfung. '
            : 'Öffentliche Spatial-Daten wie OSM können die Lage- und Flächenhypothese plausibilisieren; sie ersetzen aber keine Netzanschlussprüfung. ') +
          'Nächster sinnvoller Schritt: konkrete Fläche oder Koordinaten, gewünschte Anschlussleistung in MW und Zeithorizont ergänzen.';
      }
    } else if (deprioritizeToolFailure) {
      replyText =
        'Die bisherige Tool-Prüfung liefert noch keine belastbare Hauptaussage. ' +
        (topFacts.length > 0
          ? topFacts.map((f) => `${f.label} ist noch nicht abschließend verifiziert`).join('; ')
          : `Zur Anfrage "${String(message || '').slice(0, 120)}" laufen noch Prüfungen.`);
    } else {
      replyText =
        'Kurzfazit auf Basis der erhobenen Tool-Evidenz: ' +
        (topFacts.length > 0
          ? topFacts.map((f) => `${f.label}: ${f.summary}`).join('; ')
          : `Zur Anfrage "${String(message || '').slice(0, 120)}" liegt bereits belastbare Evidenz vor.`) +
        uncertaintyNote;
    }

    return {
      reply: replyText,
      hypotheses: hasUnverifiedVnbContext
        ? [
            {
              statement:
                'Die Zuständigkeit des Netzbetreibers ist ohne VNB-Lookup bzw. Netzgebietslogik nicht final bestätigt.',
              confidence: 'low',
              evidence: 'Aktuell liegt nur Marktpartner-Kontext vor.',
            },
          ]
        : [],
      openQuestions: hasUnverifiedVnbContext
        ? [
            {
              question:
                'Soll ich den zuständigen VNB über vnbLookup bzw. Netzgebietsauflösung verifizieren?',
              whyRelevant:
                'Marktpartner-Suchergebnisse können vom tatsächlich zuständigen VNB abweichen.',
            },
          ]
        : [],
      nextActions: [
        {
          action: 'Ausführungs-Modus verwenden',
          description: 'Nutzen Sie den Ausführungs-Modus für konkrete nächste Schritte.',
        },
      ],
      factsUsed: topFacts.map((f) => f.label),
      attemptsSummary:
        collectedFacts.length > 0
          ? collectedFacts.slice(0, 3).map((item) => ({
              iteration: item.iteration || 1,
              tool: item.tool || 'unknown',
              status: item.status || 'unknown',
              attempts: item.attempts || 1,
            }))
          : [],
      toolTrace: [],
      ...(Array.isArray(options?.debugTrace) ? { debugTrace: options.debugTrace } : {}),
    };
  },

  buildConsultationToolRegistry({
    message,
    brokerRecommendation,
    resolvedParams,
    knowledgeContext,
    _responseStrategy = null,
  } = {}) {
    const registry = [];
    const messageText = String(message || '').toLowerCase();
    const knownFacts = resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {};
    const operatorName =
      knownFacts.gridOperatorName ||
      knownFacts.assertedGridOperatorName ||
      knowledgeContext?.gridOperatorName ||
      knowledgeContext?.assertedGridOperatorName ||
      brokerRecommendation?.gridOperatorName ||
      '';
    const bdewCode = knownFacts.bdew || knownFacts.bdewCode || knowledgeContext?.bdew || '';

    registry.push({
      action: 'grid-operations.marketPartners',
      description: 'Sucht Netzbetreiber/Marktpartner über Name, City oder Suchbegriff.',
      guidance:
        'Nutze das Tool, wenn ein Netzbetreibername, eine Stadt oder ein lokaler DSO-Hinweis vorliegt.',
    });

    registry.push({
      action: 'grid-operations.vnbLookup',
      description: 'Verifiziert VNB-Zuständigkeit und löst BDEW-/Ortsdaten auf.',
      guidance:
        'Nutze das Tool für BDEW-Codes, Zuständigkeitsprüfungen oder wenn Marktpartner-Evidenz vorliegt.',
    });

    if (
      !operatorName &&
      !bdewCode &&
      !/vnb|netzbetreiber|netzoperator|bdew|bde[w]?/i.test(messageText)
    ) {
      return registry;
    }

    return registry;
  },

  parseConsultationJsonResponse(raw) {
    const jsonMatch = String(raw || '').match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_error) {
      process.stderr.write(
        `[methods-part-03-of-11] silent-catch-fallback (line 300): ${_error && _error.message}\n`
      );
      return null;
    }
  },

  inferConsultationToolCall({
    message,
    brokerRecommendation,
    resolvedParams,
    knowledgeContext,
    _responseStrategy = null,
    observations = [],
  } = {}) {
    const knownFacts = resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {};
    const messageText = String(message || '').toLowerCase();
    const operatorName =
      knownFacts.gridOperatorName ||
      knownFacts.assertedGridOperatorName ||
      knowledgeContext?.gridOperatorName ||
      knowledgeContext?.assertedGridOperatorName ||
      brokerRecommendation?.gridOperatorName ||
      '';
    const bdewCode = knownFacts.bdew || knownFacts.bdewCode || knowledgeContext?.bdew || '';
    const lastObservation = observations[observations.length - 1] || null;

    if (!observations.length) {
      if (bdewCode) {
        return {
          mode: 'tool',
          thought: 'BDEW-Code ist vorhanden, daher starte ich mit einer Zuständigkeitsprüfung.',
          toolCall: {
            action: 'grid-operations.vnbLookup',
            params: pruneUndefinedDeep({
              bdew: bdewCode,
              city: knowledgeContext?.city || knownFacts.city,
            }),
          },
        };
      }

      if (operatorName) {
        return {
          mode: 'tool',
          thought:
            'Ein Netzbetreibername ist vorhanden, daher löse ich zuerst den Marktpartner auf.',
          toolCall: {
            action: 'grid-operations.marketPartners',
            params: pruneUndefinedDeep({ query: operatorName, limit: 5 }),
          },
        };
      }

      if (/vnb|netzbetreiber|bdew|zuständig|zuständigkeit/i.test(messageText)) {
        return {
          mode: 'tool',
          thought:
            'Die Nachricht betrifft die Zuständigkeit eines VNB, daher probiere ich eine VNB-Auflösung.',
          toolCall: {
            action: 'grid-operations.vnbLookup',
            params: pruneUndefinedDeep({
              bdew: knownFacts.bdew || knownFacts.bdewCode,
              city: knownFacts.city || knowledgeContext?.city,
              query: operatorName || String(message || '').slice(0, 120),
            }),
          },
        };
      }
    }

    if (
      lastObservation?.action === 'grid-operations.marketPartners' &&
      lastObservation?.status === 'completed'
    ) {
      const results = Array.isArray(lastObservation.result?.data?.results)
        ? lastObservation.result.data.results
        : Array.isArray(lastObservation.result?.results)
          ? lastObservation.result.results
          : [];
      const topHit = results[0] || null;

      if (topHit) {
        const bdew = topHit.bdewCode || topHit.bdew || '';
        const city =
          topHit.contacts?.[0]?.city ||
          topHit.city ||
          knownFacts.city ||
          knownFacts.municipality ||
          knowledgeContext?.city ||
          knowledgeContext?.municipality ||
          '';
        return {
          mode: 'tool',
          thought:
            'Der Marktpartner ist gefunden; ich verifiziere nun den zuständigen VNB über Lookup/Netzgebietsauflösung.',
          toolCall: {
            action: 'grid-operations.vnbLookup',
            params: pruneUndefinedDeep({
              bdew,
              city,
              query:
                topHit.name ||
                operatorName ||
                knownFacts.municipality ||
                knownFacts.location ||
                String(message || '').slice(0, 120),
              vnbName: topHit.name || operatorName,
            }),
          },
        };
      }
    }

    if (
      lastObservation?.action === 'grid-operations.vnbLookup' &&
      lastObservation?.status === 'completed'
    ) {
      return {
        mode: 'final',
        thought: 'Es liegt genug Evidenz vor, um die Beratung zu finalisieren.',
        reply: '',
      };
    }

    return null;
  },

  summarizeConsultationObservation(action, result, error = null) {
    if (error) {
      return {
        action,
        status: isActionUnavailable(error) ? 'unsupported' : 'failed',
        summary: String(error.message || 'Tool call failed').slice(0, 400),
      };
    }

    let summary = '';
    if (result && typeof result === 'object') {
      const data = result.data !== undefined ? result.data : result;
      if (Array.isArray(data?.results)) {
        const top = data.results[0] || null;
        summary = top ? JSON.stringify(top).slice(0, 400) : `0 Ergebnisse von ${action}`;
      } else if (data?.operator && typeof data.operator === 'object') {
        summary = JSON.stringify(data.operator).slice(0, 400);
      } else {
        summary = JSON.stringify(data).slice(0, 400);
      }
    } else {
      summary = String(result || '').slice(0, 400);
    }

    return {
      action,
      status: 'completed',
      summary,
    };
  },

  shouldEarlyExitConsultationLoop(action, result) {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const data = result.data !== undefined ? result.data : result;
    if (Array.isArray(data?.results) && data.results.length > 0) {
      return ['grid-operations.marketPartners', 'grid-operations.vnbLookup'].includes(action);
    }

    if (data?.operator && typeof data.operator === 'object') {
      return true;
    }

    if (Array.isArray(data?.items) && data.items.length > 0) {
      return true;
    }

    return false;
  },

  deriveConsultationPrimaryIntent({ brokerRecommendation = {}, routingDecision = null } = {}) {
    const brokerIntent = String(brokerRecommendation?.intent || '').trim();
    const brokerCapability = String(brokerRecommendation?.capability || '').trim();

    if (routingDecision?.target === 'consultation_intro') {
      return 'consultation';
    }

    if (
      brokerIntent === 'mark_unknown_execution_gap' ||
      brokerCapability === 'interface_placeholder' ||
      brokerIntent === 'interface-placeholder.markGap'
    ) {
      return 'consultation';
    }

    return brokerIntent || 'consultation';
  },

  async handleConsultationTurnAgentic(ctx, input = {}) {
    const message = String(input.message || '').trim();
    const brokerRecommendation = input.brokerRecommendation || {};
    const resolvedParams =
      input.resolvedParams && typeof input.resolvedParams === 'object' ? input.resolvedParams : {};
    const knowledgeContext = input.knowledgeContext || null;
    const responseStrategy = input.responseStrategy || null;
    const knownContext = input.knownContext || {};
    const synthesisPolicy = input.synthesisPolicy || null;
    const routingPolicy = input.routingPolicy || null;
    const recentHistoryWindow = Array.isArray(input.recentHistoryWindow)
      ? input.recentHistoryWindow
      : [];
    const session = input.session && typeof input.session === 'object' ? input.session : null;
    const executionTrace = input.executionTrace || null;
    const toolCallTracker = input.toolCallTracker || null;

    const pendingHitlStopPoint =
      session?.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
        ? session.l3.stopPoint
        : null;
    const pendingHitlStatus = String(
      pendingHitlStopPoint?.hitlItem?.status ||
        pendingHitlStopPoint?.onboardingQuestion?.hitlItem?.status ||
        'pending'
    ).toLowerCase();

    if (
      pendingHitlStopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL' &&
      !['approved', 'rejected', 'declined', 'cancelled'].includes(pendingHitlStatus)
    ) {
      const onboardingQuestion = this.buildHitlOnboardingQuestion(
        pendingHitlStopPoint,
        pendingHitlStopPoint?.onboardingQuestion?.planSnapshot || null
      );
      const reply = this.buildHitlApprovalMarkdown(onboardingQuestion);

      return {
        status: 'awaiting-onboarding',
        stopPoint: {
          ...pendingHitlStopPoint,
          onboardingQuestion,
          message: onboardingQuestion.message,
          hitlItemId: onboardingQuestion?.hitlItem?.id || pendingHitlStopPoint?.hitlItemId || null,
        },
        reply,
        hypotheses: [],
        openQuestions: [
          {
            question: onboardingQuestion.message,
            whyRelevant:
              'Für den nächsten kritischen Schritt ist eine ausdrückliche Freigabe erforderlich.',
          },
        ],
        nextActions: [
          {
            action: 'HITL-Freigabe entscheiden',
            description:
              'Öffnen Sie das Freigabe-Element und bestätigen oder lehnen Sie den Schritt ab.',
          },
        ],
        factsUsed: [
          {
            source: 'session_stop_point',
            value: 'MANDATORY_HITL_APPROVAL',
          },
        ],
      };
    }

    // C) Receive jobId from caller for per-iteration progress logging
    const agenticJobId = input.jobId || null;
    const agenticJobStore = agenticJobId ? require('../../src/job-store') : null;
    const consultationDebugEnabled = isConsultationDebugEnabled(knownContext);
    const consultationDebugRecorder = createConsultationDebugRecorder({
      enabled: consultationDebugEnabled,
      trace: consultationDebugEnabled
        ? Array.isArray(input.consultationDebugSink)
          ? input.consultationDebugSink
          : []
        : null,
      agenticJobStore,
      agenticJobId,
    });
    const consultationDebugTrace = consultationDebugRecorder.trace;

    if (!message) {
      return null;
    }

    const toolRegistry = this.buildConsultationToolRegistry({
      message,
      brokerRecommendation,
      resolvedParams,
      knowledgeContext,
      responseStrategy,
    });

    consultationDebugRecorder.emit('consultation_route_selected', {
      routeKey: null,
      routeTarget: input.routingDecision?.target || CHAT_MODES.CONSULTATION,
      primaryIntent: this.deriveConsultationPrimaryIntent({
        brokerRecommendation,
        routingDecision: input.routingDecision || null,
      }),
      workflowType: input.semanticClassification?.workflowType || null,
      capability: brokerRecommendation?.capability || null,
      plannedToolCalls: toolRegistry.map((tool) => tool.action).slice(0, 10),
    });

    if (toolRegistry.length === 0) {
      return null;
    }

    const observations = [];
    const toolTrace = [];
    const collectedFacts = [];
    let plannerFailed = false;
    const startedAt = Date.now();
    let iterationsExecuted = 0;
    let hadUnavailableAttemptOverall = false;
    let lastToolStatus = null;
    let lastError = null;

    const emitBudgetCheck = (phase, iteration = null) => {
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = CONSULTATION_REACT_MAX_MS - elapsedMs;
      consultationDebugRecorder.emit('consultation_budget_check', {
        elapsedMs,
        remainingMs,
        maxMs: CONSULTATION_REACT_MAX_MS,
        iteration,
        iterationsLeft:
          typeof iteration === 'number'
            ? Math.max(CONSULTATION_REACT_MAX_ITERATIONS - iteration, 0)
            : CONSULTATION_REACT_MAX_ITERATIONS,
        phase,
      });
      return { elapsedMs, remainingMs };
    };

    consultationDebugRecorder.emit('synthesis_budget_reserved', {
      maxMs: CONSULTATION_REACT_MAX_MS,
      synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
    });

    const summarizeAttempts = (toolResult) => {
      if (!toolResult || typeof toolResult !== 'object') {
        return { attempts: 1, outcome: 'unknown' };
      }

      const attempts = Array.isArray(toolResult.attemptsLog)
        ? Math.max(1, toolResult.attemptsLog.length + (toolResult.success ? 1 : 0))
        : 1;

      return {
        attempts,
        outcome: toolResult.success ? 'success' : 'failed',
      };
    };

    const collectRetryFacts = () => {
      const lastObservation = observations[observations.length - 1] || null;
      const lastResult =
        lastObservation?.result && typeof lastObservation.result === 'object'
          ? lastObservation.result
          : {};
      const firstResult = Array.isArray(lastResult?.data?.results)
        ? lastResult.data.results[0]
        : Array.isArray(lastResult?.results)
          ? lastResult.results[0]
          : null;

      return pruneUndefinedDeep({
        message,
        brokerIntent: brokerRecommendation?.intent,
        resolvedParams,
        knownContext,
        knowledgeContext,
        observationCount: observations.length,
        lastAction: lastObservation?.action,
        bdew:
          resolvedParams?.bdew ||
          resolvedParams?.bdewCode ||
          firstResult?.bdewCode ||
          firstResult?.bdew,
        city:
          resolvedParams?.city ||
          knowledgeContext?.city ||
          firstResult?.contacts?.[0]?.city ||
          firstResult?.city,
        operatorName:
          resolvedParams?.gridOperatorName ||
          resolvedParams?.assertedGridOperatorName ||
          firstResult?.name,
      });
    };

    for (let iteration = 1; iteration <= CONSULTATION_REACT_MAX_ITERATIONS; iteration += 1) {
      iterationsExecuted = iteration;
      const loopBudget = emitBudgetCheck('loop_start', iteration);
      if (loopBudget.elapsedMs >= CONSULTATION_REACT_MAX_MS) {
        toolTrace.push({
          iteration,
          phase: 'guard',
          status: 'timeout-budget-reached',
          maxMs: CONSULTATION_REACT_MAX_MS,
        });
        break;
      }

      let stepPlan = null;

      // C) Log each agentic loop iteration (THINK phase)
      if (agenticJobStore) {
        const iterPercent = Math.min(
          25 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
          45
        );
        agenticJobStore.appendLog(
          agenticJobId,
          `agentic_iteration_${iteration}`,
          iterPercent,
          `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: THINK...`,
          { iteration, maxIterations: CONSULTATION_REACT_MAX_ITERATIONS, phase: 'think' }
        );
      }

      try {
        const plannerStartedAt = Date.now();
        consultationDebugRecorder.emit('consultation_planner_start', {
          iteration,
          phase: 'think',
        });
        const plannerPrompt = [
          'Du bist der interne ReAct-Planer des Personal Agent.',
          'Arbeite in kurzen Schleifen: THINK → ACT → OBSERVE.',
          'Nutze pro Antwort maximal einen Tool-Call.',
          'Wenn genug Evidenz vorliegt, antworte mit mode="final".',
          'Antworte ausschließlich als JSON mit den Schlüsseln mode, thought und toolCall.',
          'toolCall muss die Form { "action": "...", "params": {...} } haben.',
          '',
          `Iteration: ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}`,
          `Nutzerfrage: ${message}`,
          '',
          this.buildConsultationPrompt({
            message,
            brokerRecommendation,
            resolvedParams,
            knowledgeContext,
            responseStrategy,
            recentHistoryWindow,
            observations,
            toolRegistry,
            synthesisPolicy,
            routingPolicy,
          }),
        ].join('\n');

        const plannerResponse = await this.callLlmGenerate(ctx, {
          system: plannerPrompt,
          user: message,
          temperature: 0.1,
          maxTokens: 512,
          trace: {
            executionTrace,
            phase: `consultation_think_${iteration}`,
            metadata: { iteration },
          },
        });

        stepPlan = this.parseConsultationJsonResponse(
          plannerResponse?.text || plannerResponse?.content || plannerResponse
        );
        consultationDebugRecorder.emit('consultation_planner_end', {
          iteration,
          durationMs: Date.now() - plannerStartedAt,
        });
      } catch (error) {
        plannerFailed = true;
        const sanitizedPlannerError = sanitizeConsultationDebugError(error);
        lastError =
          sanitizedPlannerError?.message || sanitizedPlannerError?.code || 'planner_failed';
        consultationDebugRecorder.emit('consultation_planner_error', {
          iteration,
          durationMs: null,
          errorName: sanitizedPlannerError?.name || null,
          errorCode: sanitizedPlannerError?.code || null,
          errorMessage: sanitizedPlannerError?.message || null,
        });
        toolTrace.push({ iteration, phase: 'think', status: 'failed', error: error.message });
        break;
      }

      const postPlannerBudget = emitBudgetCheck('post_planner', iteration);
      if (postPlannerBudget.remainingMs <= CONSULTATION_SYNTHESIS_MIN_MS) {
        consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
          iteration,
          action: stepPlan?.toolCall?.action || null,
          tool: stepPlan?.toolCall?.action || null,
          reason: 'insufficient_budget_after_planner',
          remainingMs: postPlannerBudget.remainingMs,
          synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
        });
        break;
      }

      if (!stepPlan) {
        stepPlan = this.inferConsultationToolCall({
          message,
          brokerRecommendation,
          resolvedParams,
          knowledgeContext,
          responseStrategy,
          observations,
        });
      }

      if (!stepPlan) {
        break;
      }

      toolTrace.push({
        iteration,
        phase: 'think',
        status: 'completed',
        thought: String(stepPlan.thought || '').slice(0, 200),
      });

      if (String(stepPlan.mode || '').toLowerCase() === 'final' || !stepPlan.toolCall?.action) {
        const hasMarketPartnerObservation = observations.some(
          (obs) => obs?.action === 'grid-operations.marketPartners' && obs?.status === 'completed'
        );
        const hasVerifiedVnbObservation = observations.some(
          (obs) => obs?.action === 'grid-operations.vnbLookup' && obs?.status === 'completed'
        );
        if (hasMarketPartnerObservation && !hasVerifiedVnbObservation) {
          const enforcedStepPlan = this.inferConsultationToolCall({
            message,
            brokerRecommendation,
            resolvedParams,
            knowledgeContext,
            responseStrategy,
            observations,
          });
          if (enforcedStepPlan?.toolCall?.action) {
            stepPlan = enforcedStepPlan;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      let action = String(stepPlan.toolCall.action || '').trim();
      let params = pruneUndefinedDeep(stepPlan.toolCall.params || {});

      if (action === 'grid-operations.vnbLookup') {
        const hasBdewFact = Boolean(
          resolvedParams?.bdew ||
          resolvedParams?.bdewCode ||
          knowledgeContext?.bdew ||
          knownContext?.bdew ||
          params?.bdew
        );
        if (!hasBdewFact) {
          const fallbackQuery =
            resolvedParams?.gridOperatorName ||
            resolvedParams?.assertedGridOperatorName ||
            knowledgeContext?.gridOperatorName ||
            brokerRecommendation?.gridOperatorName ||
            String(message || '').slice(0, 120);
          action = 'grid-operations.marketPartners';
          params = pruneUndefinedDeep({ query: fallbackQuery, limit: 5 });
          toolTrace.push({
            iteration,
            phase: 'think',
            status: 'deprioritized',
            fromAction: 'grid-operations.vnbLookup',
            toAction: action,
            reason: 'missing_required_bdew_fact',
          });
        }
      }

      const registryEntry = toolRegistry.find((tool) => tool.action === action);

      if (!registryEntry) {
        observations.push({
          action,
          status: 'unsupported',
          summary: `Tool ${action} ist nicht im Registry verfügbar.`,
        });
        toolTrace.push({ iteration, phase: 'act', action, status: 'unsupported' });
        continue;
      }

      // C) Log ACT phase: which tool is being called
      if (agenticJobStore) {
        const actPercent = Math.min(
          26 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
          46
        );
        agenticJobStore.appendLog(
          agenticJobId,
          `agentic_act_${iteration}`,
          actPercent,
          `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: ACT → ${action}`,
          { iteration, action, phase: 'act' }
        );
      }

      const toolCtx = buildConsultationToolExecutionContext(ctx, this.broker);

      const preToolBudget = emitBudgetCheck('pre_tool', iteration);
      const effectiveToolTimeoutMs = Math.max(
        0,
        Math.min(
          CONSULTATION_TOOL_TIMEOUT_MS,
          preToolBudget.remainingMs - CONSULTATION_SYNTHESIS_MIN_MS
        )
      );
      consultationDebugRecorder.emit('effective_tool_timeout', {
        iteration,
        action,
        tool: action,
        configuredToolTimeoutMs: CONSULTATION_TOOL_TIMEOUT_MS,
        effectiveToolTimeoutMs,
        remainingMs: preToolBudget.remainingMs,
        synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
      });

      if (effectiveToolTimeoutMs < CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS) {
        toolTrace.push({
          iteration,
          phase: 'act',
          action,
          status: 'skipped-budget',
          effectiveToolTimeoutMs,
        });
        consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
          iteration,
          action,
          tool: action,
          reason: 'effective_timeout_below_minimum',
          effectiveToolTimeoutMs,
          minimumMs: CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS,
          remainingMs: preToolBudget.remainingMs,
          synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
        });
        break;
      }

      const toolStartedAt = Date.now();

      const toolResult = await executeToolWithRetry(toolCtx, {
        toolName: action,
        knownFacts: {
          ...collectRetryFacts(),
          requestedParams: params,
          toolRegistry: toolRegistry.map((tool) => tool.action),
        },
        userMessage: message,
        maxAttempts: CONSULTATION_TOOL_MAX_ATTEMPTS,
        allowOpenApiFallback: true,
        toolTimeoutMs: effectiveToolTimeoutMs,
        llmGenerate: async (request) => this.callLlmGenerate(ctx, request),
        parser: (raw) => this.parseConsultationJsonResponse(raw),
        onAttemptStart: ({ toolName, attempt, timeoutMs }) => {
          consultationDebugRecorder.emit('consultation_tool_start', {
            iteration,
            action: toolName,
            tool: toolName,
            attempt,
            timeoutMs,
          });
        },
        onAttemptError: ({ toolName, attempt, durationMs, errorCode, errorMessage }) => {
          lastError = sanitizeConsultationDebugText(errorMessage, 240);
          consultationDebugRecorder.emit('consultation_tool_error', {
            iteration,
            action: toolName,
            tool: toolName,
            attempt,
            durationMs,
            errorCode: sanitizeConsultationDebugText(errorCode, 80),
            errorMessage: sanitizeConsultationDebugText(errorMessage, 240),
          });
        },
      });

      const attemptInfo = summarizeAttempts(toolResult);
      const retryCount = Math.max(0, (attemptInfo.attempts || 1) - 1);
      const toolDurationMs = Date.now() - toolStartedAt;
      const hadUnavailableAttempt = Array.isArray(toolResult.attemptsLog)
        ? toolResult.attemptsLog.some((attempt) =>
            /service not found|service not available|schema error|action not found/i.test(
              String(attempt?.error || '')
            )
          )
        : false;
      hadUnavailableAttemptOverall = hadUnavailableAttemptOverall || hadUnavailableAttempt;
      consultationDebugRecorder.emit('consultation_tool_end', {
        iteration,
        action,
        tool: action,
        attempt: attemptInfo.attempts,
        durationMs: toolDurationMs,
        status: toolResult.success ? 'success' : toolResult.failFast ? 'failed-fast' : 'failed',
        failFast: Boolean(toolResult.failFast),
        hadUnavailableAttempt,
      });

      if (toolResult.success) {
        const observation = this.summarizeConsultationObservation(action, toolResult.observation);
        observation.result = toolResult.observation;
        observation.attempts = attemptInfo.attempts;
        observations.push(observation);
        lastToolStatus = observation.status;
        toolTrace.push({
          iteration,
          phase: 'act',
          action,
          status: 'completed',
          params: toolResult.params || params,
          attempts: attemptInfo.attempts,
          schemaSource: toolResult.schemaSource,
        });
        collectedFacts.push({
          iteration,
          tool: action,
          status: 'completed',
          attempts: attemptInfo.attempts,
        });
        toolCallTracker?.record({
          phase: 'consultation',
          tool: action,
          params: toolResult.params || params,
          success: true,
          retries: retryCount,
          latencyMs: toolDurationMs,
          result: toolResult.observation,
        });
        executionTrace?.recordToolInvocation({
          phase: 'consultation',
          tool: action,
          params: toolResult.params || params,
          success: true,
          latencyMs: toolDurationMs,
          retries: retryCount,
          result: toolResult.observation,
        });
        consultationDebugRecorder.emit('consultation_observation', {
          iteration,
          action,
          status: observation.status,
          error: null,
          factsCount: collectedFacts.length,
        });

        // C) Log OBSERVE phase success
        if (agenticJobStore) {
          const obsPercent = Math.min(
            27 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
            47
          );
          agenticJobStore.appendLog(
            agenticJobId,
            `agentic_observe_${iteration}`,
            obsPercent,
            `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: OBSERVE ✓ ${action} (${attemptInfo.attempts} attempt${attemptInfo.attempts !== 1 ? 's' : ''})`,
            { iteration, action, status: 'completed', attempts: attemptInfo.attempts }
          );
        }

        if (
          iteration === 1 &&
          this.shouldEarlyExitConsultationLoop(action, toolResult.observation)
        ) {
          toolTrace.push({
            iteration,
            phase: 'observe',
            action,
            status: 'early-exit',
            reason: 'sufficient_first_tool_evidence',
          });
          break;
        }

        if (Date.now() - startedAt >= CONSULTATION_REACT_MAX_MS) {
          toolTrace.push({
            iteration,
            phase: 'guard',
            status: 'timeout-budget-reached-after-tool',
            maxMs: CONSULTATION_REACT_MAX_MS,
          });
          break;
        }

        const postToolBudget = emitBudgetCheck('post_tool', iteration);
        if (postToolBudget.remainingMs <= CONSULTATION_SYNTHESIS_MIN_MS) {
          consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
            iteration,
            action: null,
            tool: null,
            reason: 'insufficient_budget_after_tool',
            remainingMs: postToolBudget.remainingMs,
            synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
          });
          break;
        }

        continue;
      }

      const failFastError = new Error(toolResult.error || 'Tool-Call fehlgeschlagen');
      const observation = this.summarizeConsultationObservation(action, null, failFastError);
      observation.attempts = attemptInfo.attempts;
      observation.summary = [
        observation.summary,
        Array.isArray(toolResult.attemptsLog) && toolResult.attemptsLog.length > 0
          ? `Attempts: ${toolResult.attemptsLog.length}`
          : null,
      ]
        .filter(Boolean)
        .join(' | ')
        .slice(0, 400);
      observations.push(observation);
      lastToolStatus = observation.status;
      lastError = sanitizeConsultationDebugText(observation.summary, 240);

      toolTrace.push({
        iteration,
        phase: 'act',
        action,
        status: toolResult.failFast ? 'failed-fast' : 'failed',
        error: observation.summary,
        attempts: attemptInfo.attempts,
        schemaSource: toolResult.schemaSource,
      });

      collectedFacts.push({
        iteration,
        tool: action,
        status: toolResult.failFast ? 'failed-fast' : 'failed',
        attempts: attemptInfo.attempts,
      });
      toolCallTracker?.record({
        phase: 'consultation',
        tool: action,
        params,
        success: false,
        retries: retryCount,
        latencyMs: toolDurationMs,
        result: toolResult.observation,
        error: observation.summary,
      });
      executionTrace?.recordToolInvocation({
        phase: 'consultation',
        tool: action,
        params,
        success: false,
        latencyMs: toolDurationMs,
        retries: retryCount,
        result: toolResult.observation,
        error: observation.summary,
      });
      consultationDebugRecorder.emit('consultation_observation', {
        iteration,
        action,
        status: observation.status,
        error: sanitizeConsultationDebugText(observation.summary, 240),
        factsCount: collectedFacts.length,
      });

      // C) Log OBSERVE phase failure
      if (agenticJobStore) {
        const obsPercent = Math.min(
          27 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
          47
        );
        agenticJobStore.appendLog(
          agenticJobId,
          `agentic_observe_${iteration}`,
          obsPercent,
          `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: OBSERVE ✗ ${action} (${toolResult.failFast ? 'fail-fast' : 'failed'}, ${attemptInfo.attempts} attempt${attemptInfo.attempts !== 1 ? 's' : ''})`,
          {
            iteration,
            action,
            status: toolResult.failFast ? 'failed-fast' : 'failed',
            attempts: attemptInfo.attempts,
          }
        );
      }

      if (toolResult.failFast || hadUnavailableAttempt) {
        break;
      }

      const postToolBudget = emitBudgetCheck('post_tool', iteration);
      if (postToolBudget.remainingMs <= CONSULTATION_SYNTHESIS_MIN_MS) {
        consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
          iteration,
          action: null,
          tool: null,
          reason: 'insufficient_budget_after_tool',
          remainingMs: postToolBudget.remainingMs,
          synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
        });
        break;
      }
    }

    if (observations.length === 0 && plannerFailed) {
      return null;
    }

    // Check if synthesis phase has enough time remaining (need at least 500ms)
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = CONSULTATION_REACT_MAX_MS - elapsedMs;
    emitBudgetCheck('pre_synthesis', iterationsExecuted || null);
    consultationDebugRecorder.emit('synthesis_budget_reserved', {
      phase: 'pre_synthesis',
      elapsedMs,
      remainingMs,
      maxMs: CONSULTATION_REACT_MAX_MS,
      synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
    });
    if (remainingMs < CONSULTATION_SYNTHESIS_MIN_MS) {
      // Synthesis budget reserve exceeded
      consultationDebugRecorder.emit('consultation_synthesis_skipped', {
        reason: 'remaining_budget_below_synthesis_reserve',
        remainingMs,
        synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
      });

      if (observations.length > 0) {
        consultationDebugRecorder.emit('consultation_fallback_selected', {
          reason: 'budget_summary_from_observations',
          branch: 'observation_summary_reply',
          plannerFailed,
          hadUnavailableAttempt: hadUnavailableAttemptOverall,
          remainingMs,
          elapsedMs,
          iterations: iterationsExecuted,
          lastToolStatus,
          lastError,
        });
        return this.buildConsultationObservationSummaryReply(
          message,
          observations,
          collectedFacts,
          {
            debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
            synthesisPolicy,
            routingPolicy,
            knownContext,
            resolvedParams,
            knowledgeContext,
          }
        );
      }

      consultationDebugRecorder.emit('consultation_fallback_selected', {
        reason: 'synthesis_budget_exhausted',
        branch: 'fallbackConsultationReply',
        plannerFailed,
        hadUnavailableAttempt: hadUnavailableAttemptOverall,
        remainingMs,
        elapsedMs,
        iterations: iterationsExecuted,
        lastToolStatus,
        lastError,
      });
      return this.fallbackConsultationReply(message, observations, collectedFacts, {
        debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
      });
    }

    let synthesisStartedAt = null;
    try {
      const synthesisPrompt = this.buildConsultationPrompt({
        message,
        brokerRecommendation,
        resolvedParams,
        knowledgeContext,
        responseStrategy,
        recentHistoryWindow,
        observations,
        toolRegistry,
        synthesisPolicy,
        routingPolicy,
      });
      const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();

      synthesisStartedAt = Date.now();
      consultationDebugRecorder.emit('consultation_synthesis_start', {
        observationsCount: observations.length,
        collectedFactsCount: collectedFacts.length,
        elapsedMs,
        remainingMs,
        timeoutMs: synthesisTimeoutMs,
      });

      const raw = await this.callLlmGenerate(ctx, {
        system: synthesisPrompt,
        user: message,
        schema: CONSULTATION_OUTPUT_SCHEMA,
        timeoutMs: synthesisTimeoutMs,
        trace: {
          executionTrace,
          phase: 'consultation_synthesis',
          metadata: { observationCount: observations.length, timeoutMs: synthesisTimeoutMs },
        },
      });

      consultationDebugRecorder.emit('consultation_synthesis_end', {
        durationMs: Date.now() - synthesisStartedAt,
        observationsCount: observations.length,
      });

      const data = raw?.data || raw;
      if (!data || typeof data !== 'object' || !String(data.reply || '').trim()) {
        consultationDebugRecorder.emit('consultation_synthesis_null', {
          reason: 'empty_synthesis_payload',
          durationMs: Date.now() - synthesisStartedAt,
          observationsCount: observations.length,
        });

        if (observations.length > 0) {
          consultationDebugRecorder.emit('consultation_fallback_selected', {
            reason: 'agentic_synthesis_null_with_observations',
            branch: 'observation_summary_reply',
            plannerFailed,
            hadUnavailableAttempt: hadUnavailableAttemptOverall,
            remainingMs,
            elapsedMs,
            iterations: iterationsExecuted,
            lastToolStatus,
            lastError,
          });
          return this.buildConsultationObservationSummaryReply(
            message,
            observations,
            collectedFacts,
            {
              debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
              synthesisPolicy,
              routingPolicy,
              knownContext,
              resolvedParams,
              knowledgeContext,
            }
          );
        }

        return null;
      }

      const sanitizeArray = (arr) => (Array.isArray(arr) ? arr : []);
      return {
        reply: String(data.reply || '').trim(),
        hypotheses: sanitizeArray(data.hypotheses),
        openQuestions: sanitizeArray(data.openQuestions),
        nextActions: sanitizeArray(data.nextActions),
        factsUsed: sanitizeArray(data.factsUsed),
        attemptsSummary: collectedFacts.map((item) => ({
          iteration: item.iteration,
          tool: item.tool,
          status: item.status,
          attempts: item.attempts,
        })),
        toolTrace,
        ...(consultationDebugEnabled ? { debugTrace: consultationDebugTrace } : {}),
      };
    } catch (error) {
      const sanitizedSynthesisError = sanitizeConsultationDebugError(error);
      const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();
      consultationDebugRecorder.emit('consultation_synthesis_error', {
        durationMs:
          typeof synthesisStartedAt === 'number'
            ? Math.max(0, Date.now() - synthesisStartedAt)
            : null,
        errorName: sanitizedSynthesisError?.name || null,
        errorCode: sanitizedSynthesisError?.code || null,
        errorMessage: sanitizedSynthesisError?.message || null,
        observationsCount: observations.length,
        timeoutMs: synthesisTimeoutMs,
      });

      if (!isActionUnavailable(error)) {
        this.logger?.warn(
          `Consultation agentic synthesis failed (timeout=${synthesisTimeoutMs}ms, legacy fallback active): ${error.message}`
        );
      }

      consultationDebugRecorder.emit('consultation_synthesis_null', {
        reason: 'synthesis_exception',
        durationMs:
          typeof synthesisStartedAt === 'number'
            ? Math.max(0, Date.now() - synthesisStartedAt)
            : null,
        observationsCount: observations.length,
        errorCode: sanitizedSynthesisError?.code || null,
        errorMessage: sanitizedSynthesisError?.message || null,
      });

      if (observations.length > 0) {
        consultationDebugRecorder.emit('consultation_fallback_selected', {
          reason: 'agentic_synthesis_exception_with_observations',
          branch: 'observation_summary_reply',
          plannerFailed,
          hadUnavailableAttempt: hadUnavailableAttemptOverall,
          remainingMs,
          elapsedMs,
          iterations: iterationsExecuted,
          lastToolStatus,
          lastError:
            sanitizedSynthesisError?.message || sanitizedSynthesisError?.code || lastError || null,
        });
        return this.buildConsultationObservationSummaryReply(
          message,
          observations,
          collectedFacts,
          {
            debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
            synthesisPolicy,
            routingPolicy,
            knownContext,
            resolvedParams,
            knowledgeContext,
          }
        );
      }

      return null;
    }
  },

  async callLlmGenerate(ctx, payload = {}) {
    const startedAt = Date.now();
    const trace = payload?.trace || null;
    const llmPayload = { ...payload };
    delete llmPayload.trace;
    const hasLocalLlmService =
      !!ctx?.broker &&
      typeof ctx.broker.hasLocalService === 'function' &&
      ctx.broker.hasLocalService('llm');
    const canCallBrokerAction =
      typeof ctx?.call === 'function' &&
      (!ctx?.broker || process.env.NODE_ENV === 'test' || hasLocalLlmService);

    if (canCallBrokerAction) {
      const response = await ctx.call('llm.generate', llmPayload, {
        meta: { ...ctx.meta, $gateway: false },
      });
      trace?.executionTrace?.recordLLMCall({
        phase: trace?.phase || 'llm.generate',
        latencyMs: Date.now() - startedAt,
        metadata: trace?.metadata || null,
      });
      return response;
    }

    const systemText = String(llmPayload.system || '').trim();
    const userText = String(llmPayload.user || '').trim();
    const prompt = [systemText, userText].filter(Boolean).join('\n\n');
    const options = {
      temperature: llmPayload.temperature,
      maxTokens: llmPayload.maxTokens,
    };

    if (llmPayload.schema && typeof llmPayload.schema === 'object') {
      const response = await llmGenerateStructured(llmPayload.schema, prompt, options);
      trace?.executionTrace?.recordLLMCall({
        phase: trace?.phase || 'llm.generate.structured',
        latencyMs: Date.now() - startedAt,
        metadata: trace?.metadata || null,
      });
      return response;
    }

    const text = await llmGenerateText(prompt, options);
    trace?.executionTrace?.recordLLMCall({
      phase: trace?.phase || 'llm.generate.text',
      latencyMs: Date.now() - startedAt,
      metadata: trace?.metadata || null,
    });
    return { text };
  },

  async classifyChatModeLLM(ctx, message, session, options = {}) {
    const systemPrompt = [
      'Du bist ein Klassifikator für Chat-Modi in einem deutschen Energie-Beratungssystem.',
      '',
      'Deine Aufgabe: Analysiere die Nutzernachricht und entscheide, ob der Nutzer',
      '1. eine BERATUNG sucht (consultation) — Einordnung, Erklärung, Problembeschreibung',
      '2. eine PRÜFUNG/AUSFÜHRUNG fordert (execution) — konkrete Aktion, Datenabruf',
      '',
      'REGELN:',
      '- „Ich habe...", „Der Code ist...", „Ich werde abgeregelt" → consultation (Beschreibung)',
      '- „Prüfe...", „Finde...", „Gib mir...", „Starte..." → execution (Aufforderung)',
      '- „Wie hoch ist...", „Was soll ich tun...", „Warum..." → consultation (Frage/Rat)',
      '- „Stadtwerke X, BDEW unbekannt" → consultation (Information bereitstellen)',
      '- „Validiere den MaStR-Eintrag" → execution (konkrete Prüfung)',
      '',
      'Antworte NUR mit einem JSON-Objekt: { "chatMode": "consultation"|"execution", "confidence": 0.0-1.0, "reasoning": "..." }',
      'Kein Markdown, keine Erklärung außerhalb des JSON.',
    ].join('\n');

    const hasPlanStack = Array.isArray(session?.l3?.planStack) && session.l3.planStack.length > 0;
    const userPrompt = [
      `Nachricht: "${String(message || '').trim()}"`,
      '',
      `Session-Kontext: ${hasPlanStack ? 'Es gibt einen offenen Plan-Stack.' : 'Kein offener Plan.'}`,
      '',
      'Klassifiziere:',
    ].join('\n');

    try {
      const llmResponse = await this.callLlmGenerate(ctx, {
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.1,
        maxTokens: 256,
        trace: {
          executionTrace: options.executionTrace || null,
          phase: 'chat_mode_classifier',
          metadata: {
            hasPlanStack,
          },
        },
      });

      const raw = llmResponse?.text || llmResponse?.content || llmResponse;
      const jsonMatch = String(raw || '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger?.warn('[classifyChatModeLLM] Kein JSON in LLM-Antwort gefunden:', raw);
        return { chatMode: null, confidence: 0, reasoning: 'JSON parse error' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        chatMode: ['consultation', 'execution'].includes(parsed.chatMode) ? parsed.chatMode : null,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
        reasoning: parsed.reasoning || 'Keine Begründung',
      };
    } catch (error) {
      this.logger?.warn('[classifyChatModeLLM] LLM-Fehler:', error.message);
      return { chatMode: null, confidence: 0, reasoning: `LLM error: ${error.message}` };
    }
  },

  async classifyConsultationIntentHybrid(ctx, message, knownContext = {}, options = {}) {
    const fallback = fuzzyClassifyConsultationIntent(message, knownContext, []);

    const systemPrompt = [
      'Du bist ein Intent-Klassifikator für Consultation-to-Execution im Energiemarkt.',
      'Klassifiziere die Anfrage strikt als JSON.',
      'Felder:',
      '- workflowType',
      '- personaType',
      '- domainIntent',
      '- executionReadinessIntent',
      '- advisoryOnly (boolean)',
      '- availableInputs (array)',
      '- missingInputs (array)',
      '- confidence (0..1)',
      '- rationale',
      'Wichtig: Nutze Semantik, keine starren Keyword-Matches.',
      'Wenn Governance/Blackbox/AI-Risiko: advisoryOnly=true.',
    ].join('\n');

    try {
      const raw = await this.callLlmGenerate(ctx, {
        system: systemPrompt,
        user: `Anfrage: ${String(message || '').trim()}\nKontext: ${JSON.stringify(knownContext || {})}`,
        temperature: 0,
        maxTokens: 500,
        trace: {
          executionTrace: options.executionTrace || null,
          phase: 'consultation_intent_classifier',
        },
      });

      const parsed = this.parseConsultationJsonResponse(raw?.text || raw?.content || raw);
      if (!parsed || typeof parsed !== 'object') {
        return fallback;
      }

      return {
        workflowType: String(parsed.workflowType || fallback.workflowType),
        personaType: String(parsed.personaType || fallback.personaType || 'general'),
        domainIntent: String(
          parsed.domainIntent || fallback.domainIntent || 'consultation_general'
        ),
        executionReadinessIntent: String(
          parsed.executionReadinessIntent || fallback.executionReadinessIntent || 'awaiting_input'
        ),
        advisoryOnly: Boolean(parsed.advisoryOnly),
        availableInputs: Array.isArray(parsed.availableInputs)
          ? parsed.availableInputs
          : fallback.availableInputs,
        missingInputs: Array.isArray(parsed.missingInputs)
          ? parsed.missingInputs
          : fallback.missingInputs,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence || fallback.confidence || 0))),
        rationale: String(parsed.rationale || fallback.rationale || 'hybrid-fallback'),
        source: 'llm',
      };
    } catch (_error) {
      this.logger?.warn(
        `[methods-part-03-of-11] silent-catch-fallback (line 1608): ${_error && _error.message}`
      );
      return fallback;
    }
  },
};
