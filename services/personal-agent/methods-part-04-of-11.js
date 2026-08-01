'use strict';

// personal-agent methods chunk 4/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: applyConsultationGuardrailsToBroker, handleConsultationTurn, buildEmpathethicOnboardingReply, runDream, buildDreamAuthMeta, sanitizeDreamRequestHeaders, deepMergeMeta, buildFileProcessingIntro, resolveExtractForAttachment, buildInhouseDataFromAttachments, processFileAttachments, synthesizeTurn, buildGridOperatorFlexibilityCompletedReply, buildSynthesisStyleLead

const {
  crypto,
  tenantNamespace,
  EXECUTION_MODES,
  runDreamPipeline,
  ONBOARDING_PARAM_ALTERNATIVES,
  llmGenerateText,
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  ocrExtractImage,
  extractDocumentText,
  readTextContent,
  injectFileIntoL3,
  PROFILE_NAMESPACE,
  CONSULTATION_OUTPUT_SCHEMA,
  isNotFound,
  isActionUnavailable,
  isConsultationDebugEnabled,
  sanitizeConsultationDebugError,
  createConsultationDebugRecorder,
} = require('./shared');

module.exports = {
  applyConsultationGuardrailsToBroker(brokerRecommendation = {}, semanticClassification = null) {
    if (!brokerRecommendation || typeof brokerRecommendation !== 'object') {
      return brokerRecommendation;
    }
    if (!semanticClassification || typeof semanticClassification !== 'object') {
      return brokerRecommendation;
    }

    const intent = String(brokerRecommendation.intent || '').toLowerCase();
    const workflowType = String(semanticClassification.workflowType || '').toLowerCase();
    const advisoryOnly = Boolean(semanticClassification.advisoryOnly);

    const blocksForecast = advisoryOnly && /residual_load_forecast|forecast/.test(intent);
    const blocksVdmiAsset =
      /vdmi_asset_validation_governance/.test(intent) &&
      [
        'bess_screening',
        'bess_development',
        'process_governance_decision_matrix',
        'edm_market_communication_diagnostics',
        'prosumer_nap_wallet_onboarding',
      ].includes(workflowType);

    const blocksMastrInventory =
      /mastr_asset_inventory/.test(intent) && workflowType === 'prosumer_nap_wallet_onboarding';

    if (!(blocksForecast || blocksVdmiAsset || blocksMastrInventory)) {
      return brokerRecommendation;
    }

    return {
      ...brokerRecommendation,
      intent: semanticClassification.domainIntent || brokerRecommendation.intent,
      confidence: Math.min(Number(brokerRecommendation.confidence || 0.5), 0.45),
      summary: 'hybrid-semantic-guardrail-correction',
      guardrailCorrection: {
        applied: true,
        workflowType: semanticClassification.workflowType,
        domainIntent: semanticClassification.domainIntent,
        advisoryOnly,
      },
    };
  },

  async handleConsultationTurn(ctx, input = {}) {
    const message = String(input.message || '').trim();
    const brokerRecommendation = input.brokerRecommendation || {};
    const resolvedParams =
      input.resolvedParams && typeof input.resolvedParams === 'object' ? input.resolvedParams : {};
    const knowledgeContext = input.knowledgeContext || null;
    const responseStrategy = input.responseStrategy || null;
    const synthesisPolicy = input.synthesisPolicy || null;
    const routingPolicy = input.routingPolicy || null;
    const recentHistoryWindow = Array.isArray(input.recentHistoryWindow)
      ? input.recentHistoryWindow
      : this.buildConsultationRecentHistoryWindow(input.session || null);
    const consultationDebugEnabled = isConsultationDebugEnabled(input.knownContext || {});
    const consultationDebugSink = consultationDebugEnabled
      ? Array.isArray(input.consultationDebugSink)
        ? input.consultationDebugSink
        : []
      : null;

    const finalizeConsultationResult = (result, { timeoutFallback = false } = {}) => {
      const normalizedResult = result && typeof result === 'object' ? result : {};
      const degradation = this.deriveConsultationDegradation(normalizedResult, {
        timeoutFallback,
      });
      const responsePolicyContract = this.buildResponsePolicyContract({
        message,
        workflowType:
          normalizedResult.workflowType || input?.semanticClassification?.workflowType || null,
        domainIntent:
          normalizedResult.domainIntent ||
          input?.semanticClassification?.domainIntent ||
          brokerRecommendation?.intent ||
          null,
        knownContext: input.knownContext || {},
        receiptKnowledgeEvidence: input.receiptKnowledgeEvidence || null,
        observations: Array.isArray(normalizedResult.toolTrace) ? normalizedResult.toolTrace : [],
        verifiedFacts: Array.isArray(normalizedResult.factsUsed) ? normalizedResult.factsUsed : [],
      });

      const guarded = this.applyResponsePolicyGuardrails({
        reply: String(normalizedResult.reply || ''),
        contract: responsePolicyContract,
        timeoutFallback,
      });

      return {
        ...normalizedResult,
        reply: guarded.reply,
        workflowType: responsePolicyContract.workflowType,
        domainIntent: responsePolicyContract.domainIntent,
        evidenceStatus: responsePolicyContract.evidenceStatus,
        missingEvidence: responsePolicyContract.missingEvidence,
        nextVerificationSteps: responsePolicyContract.nextVerificationSteps,
        guardrailCorrections: guarded.guardrailCorrections,
        ...(degradation ? { degradation } : {}),
      };
    };

    const agenticConsultation = await this.handleConsultationTurnAgentic(ctx, {
      ...input,
      responseStrategy,
      recentHistoryWindow,
      consultationDebugSink,
      synthesisPolicy,
      routingPolicy,
    });
    if (agenticConsultation) {
      const debugTrace = Array.isArray(agenticConsultation.debugTrace)
        ? agenticConsultation.debugTrace
        : [];
      const timeoutFallback = debugTrace.some(
        (event) =>
          event?.type === 'consultation_fallback_selected' &&
          event?.reason === 'synthesis_budget_exhausted'
      );
      return finalizeConsultationResult(agenticConsultation, { timeoutFallback });
    }

    if (consultationDebugEnabled) {
      createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
        'consultation_fallback_selected',
        {
          reason: 'agentic_returned_null',
          branch: 'legacy_non_agentic_consultation',
          plannerFailed: false,
          hadUnavailableAttempt: false,
          remainingMs: null,
          elapsedMs: null,
          iterations: null,
          lastToolStatus: null,
          lastError: null,
        }
      );
    }

    const buildLegacyFallback = (reason) =>
      this.buildConsultationOperationalDegradationReply(message, {
        reason,
        timeoutFallback: true,
        debugTrace: consultationDebugEnabled ? consultationDebugSink : null,
      });

    if (!message) {
      return finalizeConsultationResult(buildLegacyFallback('empty_message'), {
        timeoutFallback: true,
      });
    }

    try {
      const systemPrompt = this.buildConsultationPrompt({
        message,
        brokerRecommendation,
        resolvedParams,
        knowledgeContext,
        responseStrategy,
        recentHistoryWindow,
      });
      const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();

      const raw = await this.callLlmGenerate(ctx, {
        system: systemPrompt,
        user: message,
        schema: CONSULTATION_OUTPUT_SCHEMA,
        timeoutMs: synthesisTimeoutMs,
        trace: {
          executionTrace: input.executionTrace || null,
          phase: 'consultation_non_agentic',
          metadata: { timeoutMs: synthesisTimeoutMs },
        },
      });

      const data = raw?.data || raw;
      if (!data || typeof data !== 'object' || !String(data.reply || '').trim()) {
        if (consultationDebugEnabled) {
          createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
            'consultation_synthesis_null',
            {
              reason: 'non_agentic_empty_payload',
            }
          );
          createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
            'consultation_fallback_selected',
            {
              reason: 'non_agentic_empty_payload',
              branch: 'deterministic_consultation_fallback',
              plannerFailed: false,
              hadUnavailableAttempt: false,
              remainingMs: null,
              elapsedMs: null,
              iterations: null,
              lastToolStatus: null,
              lastError: null,
            }
          );
        }
        return finalizeConsultationResult(buildLegacyFallback('non_agentic_empty_payload'), {
          timeoutFallback: true,
        });
      }

      const sanitizeArray = (arr) => (Array.isArray(arr) ? arr : []);
      return finalizeConsultationResult({
        reply: String(data.reply || '').trim(),
        hypotheses: sanitizeArray(data.hypotheses),
        openQuestions: sanitizeArray(data.openQuestions),
        nextActions: sanitizeArray(data.nextActions),
        factsUsed: sanitizeArray(data.factsUsed),
        ...(consultationDebugEnabled ? { debugTrace: consultationDebugSink } : {}),
      });
    } catch (error) {
      const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();
      if (!isActionUnavailable(error)) {
        this.logger?.warn(
          `Consultation LLM generation failed (timeout=${synthesisTimeoutMs}ms, fallback active): ${error.message}`
        );
      }
      if (consultationDebugEnabled) {
        const sanitizedError = sanitizeConsultationDebugError(error);
        createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
          'consultation_fallback_selected',
          {
            reason: 'non_agentic_exception',
            branch: 'deterministic_consultation_fallback',
            plannerFailed: false,
            hadUnavailableAttempt: false,
            remainingMs: null,
            elapsedMs: null,
            iterations: null,
            lastToolStatus: null,
            lastError: sanitizedError?.message || sanitizedError?.code || null,
          }
        );
      }
      const fallbackResult = buildLegacyFallback('non_agentic_exception');
      return finalizeConsultationResult(fallbackResult, { timeoutFallback: true });
    }
  },

  async buildEmpathethicOnboardingReply({ message, execution, plan }) {
    const onboardingQuestion = execution?.stopPoint?.onboardingQuestion;
    const questionText = onboardingQuestion?.questionText || execution?.stopPoint?.message || '';
    const paramKey = onboardingQuestion?.paramKey || null;

    const staticAlternatives =
      paramKey && Array.isArray(ONBOARDING_PARAM_ALTERNATIVES[paramKey])
        ? ONBOARDING_PARAM_ALTERNATIVES[paramKey]
        : [];

    const fallback = { markdown: questionText, nextActions: [] };
    if (!questionText) return fallback;

    const nextActions = staticAlternatives.map((alt) => ({
      label: alt,
      type: 'alternative_path',
    }));

    const deterministicTemplate = [
      'Damit ich die angeforderte Prüfung belastbar fortsetzen kann, fehlt mir noch eine entscheidende Angabe.',
      questionText,
      staticAlternatives.length > 0
        ? `Falls das gerade nicht vorliegt: ${staticAlternatives[0]}`
        : null,
    ]
      .filter(Boolean)
      .join(' ');

    if (String(process.env.PERSONAL_AGENT_ONBOARDING_LLM || 'false').toLowerCase() !== 'true') {
      return { markdown: deterministicTemplate, nextActions };
    }

    const userSnippet = String(message || '')
      .trim()
      .slice(0, 400);
    const planSteps = Array.isArray(plan?.steps)
      ? plan.steps
          .map((s) => s.label || s.action)
          .filter(Boolean)
          .join(', ')
      : '';
    const altHint =
      staticAlternatives.length > 0
        ? `Falls die Angabe noch nicht verfügbar ist, biete als Alternative an: "${staticAlternatives[0]}"`
        : 'Falls die Angabe nicht sofort verfügbar ist, biete kurz eine sinnvolle Alternative an.';

    const prompt = [
      'Du bist ein professioneller, empathischer Energie-Assistent (Cernion Personal Agent).',
      `Der Nutzer stellte folgende Anfrage: "${userSnippet}"`,
      planSteps ? `Geplante Prüfschritte: ${planSteps}` : '',
      '',
      `Um fortzufahren, muss der Assistent die folgende Angabe erfragen: "${questionText}"`,
      '',
      'Schreibe eine kurze, kontextbezogene Antwort (2-3 Sätze) auf Deutsch:',
      '- Satz 1: Erkläre empathisch und direkt, WARUM genau diese Angabe für die konkrete Nutzeranfrage benötigt wird.',
      '- Satz 2: Stelle die eigentliche Frage (wortgetreu oder leicht adaptiert an den Kontext).',
      `- Satz 3 (wenn sinnvoll): ${altHint}`,
      '',
      'Antworte NUR mit dem fertigen Text. Keine Überschriften, keine Markdown-Liste, keine Erklärungen.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const llmText = (
        await llmGenerateText(prompt, {
          operation: 'onboarding-empathetic-reply',
          maxTokens: 220,
          timeoutMs: 8000,
        })
      )?.trim();

      if (!llmText || llmText.length < 15) return fallback;

      return { markdown: llmText, nextActions };
    } catch (err) {
      this.logger?.warn(
        `buildEmpathethicOnboardingReply LLM failed (non-blocking): ${err?.message}`
      );
      // Deterministic fallback: return raw question with static alternatives
      return { markdown: deterministicTemplate, nextActions };
    }
  },

  async runDream(broker, payload = {}) {
    const tenantId = String(payload.tenantId || 'default');
    const sessionId = String(payload.sessionId || '');
    const userId = String(payload.userId || payload.authMeta?.authUser?.userId || 'anonymous');
    const profileNamespace =
      payload.profileNamespace || tenantNamespace(PROFILE_NAMESPACE, tenantId);

    if (!sessionId) {
      this.logger?.warn('Dream pipeline skipped: missing sessionId in payload');
      return;
    }

    const dreamMeta = this.deepMergeMeta(
      this.buildDreamAuthMeta(payload.authMeta || {}, tenantId, userId),
      {
        source: 'personal-agent.dream',
        wakeUp: true,
      }
    );

    const dreamCtx = {
      meta: dreamMeta,
      call: (action, params, options = {}) => {
        const mergedMeta = this.deepMergeMeta(options.meta || {}, dreamMeta);
        return broker.call(action, params, { ...options, meta: mergedMeta });
      },
    };

    let session;
    try {
      session = await this.loadSession(dreamCtx, tenantId, sessionId, userId, {
        createIfMissing: false,
      });
    } catch (err) {
      if (isNotFound(err) && payload.session && typeof payload.session === 'object') {
        // v0.52.5 payload compatibility fallback (zero-downtime rollout)
        session = payload.session;
      } else if (isNotFound(err)) {
        this.logger?.info(`Dream pipeline skipped: session ${sessionId} no longer exists.`);
        return;
      } else {
        throw err;
      }
    }

    try {
      await runDreamPipeline(dreamCtx, sessionId, tenantId, userId, profileNamespace, session);
    } catch (err) {
      this.logger?.warn(`Dream pipeline failed for session ${sessionId}: ${err.message}`);
    }
  },

  buildDreamAuthMeta(meta = {}, tenantId, userId) {
    const safeMeta = meta && typeof meta === 'object' ? meta : {};
    const authUser =
      safeMeta.authUser && typeof safeMeta.authUser === 'object' ? safeMeta.authUser : {};
    const requestHeaders = this.sanitizeDreamRequestHeaders(safeMeta.requestHeaders);

    const nextAuthUser = {
      ...authUser,
      userId,
    };

    return {
      tenantId,
      authUser: nextAuthUser,
      roles: Array.isArray(safeMeta.roles) ? safeMeta.roles : undefined,
      scopes: Array.isArray(safeMeta.scopes) ? safeMeta.scopes : undefined,
      permissions: Array.isArray(safeMeta.permissions) ? safeMeta.permissions : undefined,
      auth: safeMeta.auth && typeof safeMeta.auth === 'object' ? safeMeta.auth : undefined,
      requestHeaders,
    };
  },

  sanitizeDreamRequestHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      return undefined;
    }

    const allowed = ['x-request-id', 'x-correlation-id', 'traceparent', 'tracestate'];
    const sanitized = {};

    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = String(key || '')
        .trim()
        .toLowerCase();
      if (!allowed.includes(normalizedKey)) {
        continue;
      }
      sanitized[normalizedKey] = value;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  },

  deepMergeMeta(base = {}, patch = {}) {
    const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (!isObject(base)) {
      return isObject(patch) ? { ...patch } : patch;
    }
    if (!isObject(patch)) {
      return { ...base };
    }

    const merged = { ...base };
    for (const [key, patchValue] of Object.entries(patch)) {
      const baseValue = merged[key];
      if (isObject(baseValue) && isObject(patchValue)) {
        merged[key] = this.deepMergeMeta(baseValue, patchValue);
        continue;
      }
      merged[key] = patchValue;
    }
    return merged;
  },

  buildFileProcessingIntro(fileProcessing = []) {
    if (!Array.isArray(fileProcessing) || fileProcessing.length === 0) {
      return '';
    }

    const okCount = fileProcessing.filter((item) => item.status === 'ok').length;
    const errorItems = fileProcessing.filter((item) => item.status === 'error');
    const total = fileProcessing.length;

    if (errorItems.length === 0) {
      return `Ich habe ${okCount} Datei(en) verarbeitet. `;
    }

    const names = errorItems
      .map((item) => item.fileName)
      .filter(Boolean)
      .join(', ');
    return `Ich habe ${okCount} von ${total} Datei(en) verarbeitet. Bei ${names} gab es einen Parse-Fehler. `;
  },

  resolveExtractForAttachment(file, typeInfo) {
    if (!typeInfo) {
      return null;
    }

    if (typeInfo.category === 'tabular' && typeInfo.ext === '.csv') {
      return parseCsvExtract(file.tempPath);
    }

    if (typeInfo.category === 'tabular' && (typeInfo.ext === '.xlsx' || typeInfo.ext === '.xls')) {
      return parseExcelExtract(file.tempPath);
    }

    if (typeInfo.category === 'image') {
      return ocrExtractImage(file.tempPath);
    }

    if (typeInfo.category === 'document') {
      return extractDocumentText(file.tempPath);
    }

    return {
      type: 'unsupported',
      summary: `Dateityp ${typeInfo.mimeType} wird in dieser Version nicht unterstützt.`,
    };
  },

  buildInhouseDataFromAttachments(rawFiles = [], fileProcessing = []) {
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) return [];

    const successIds = new Set(
      (Array.isArray(fileProcessing) ? fileProcessing : [])
        .filter((r) => r.status === 'ok')
        .map((r) => r.attachmentId)
    );

    const result = [];
    for (const file of rawFiles) {
      const attachmentId = String(file?.attachmentId || '');
      if (!successIds.has(attachmentId)) continue;
      if (!file?.tempPath) continue;

      try {
        const textContent = readTextContent(file.tempPath);
        if (!textContent) continue; // non-text format, silently skip

        result.push({
          attachmentId,
          fileName: String(file.fileName || 'attachment'),
          mimeType: String(file.mimeType || 'text/plain'),
          content: textContent.content,
          truncated: textContent.truncated,
          originalSizeBytes: textContent.originalSizeBytes,
        });
      } catch {
        // File errors during text read are non-fatal for this turn
      }
    }
    return result;
  },

  processFileAttachments(session, files = []) {
    if (!Array.isArray(files) || files.length === 0) {
      return [];
    }

    const results = [];

    for (const file of files) {
      const attachmentId = String(file?.attachmentId || `fa_${crypto.randomUUID().slice(0, 8)}`);
      const fileName = String(file?.fileName || 'attachment');
      const mimeType = String(file?.mimeType || 'application/octet-stream');
      const sizeBytes = Number(file?.sizeBytes || 0);

      try {
        const typeInfo = recognizeFileType(file?.tempPath);
        const extract = this.resolveExtractForAttachment(file, typeInfo);

        injectFileIntoL3(session, {
          attachmentId,
          fileName,
          mimeType,
          category: typeInfo.category,
          sizeBytes,
          extract,
        });

        results.push({
          attachmentId,
          fileName,
          status: 'ok',
        });
      } catch (error) {
        const mappedError = {
          code: error?.code || 'PARSE_ERROR',
          message: error?.message || 'Datei konnte nicht verarbeitet werden.',
        };

        injectFileIntoL3(session, {
          attachmentId,
          fileName,
          mimeType,
          category: 'unknown',
          sizeBytes,
          extract: null,
          error: mappedError,
        });

        results.push({
          attachmentId,
          fileName,
          status: 'error',
          error: mappedError,
        });
      }
    }

    return results;
  },

  synthesizeTurn({
    message,
    toolContext,
    executionMode,
    plan,
    execution,
    fileProcessing = [],
    knowledgeContext = null,
    responseStrategy = null,
  }) {
    const fileIntro = this.buildFileProcessingIntro(fileProcessing);
    const promptExcerpt = String(message || '')
      .trim()
      .slice(0, 220);
    const synthesisStyle = knowledgeContext?.synthesisStyle || null;
    const styleLead = this.buildSynthesisStyleLead(synthesisStyle);
    const strategyLead = this.buildStrategyLead(responseStrategy);
    const prefixed = (text) => {
      const segments = [styleLead, strategyLead, text].filter(Boolean);
      return segments.length > 0 ? segments.join(' ') : text;
    };

    if (toolContext && toolContext.responseRaw) {
      const keyCount = Object.keys(toolContext.responseRaw || {}).length;
      return prefixed(
        `${fileIntro}Tool-Ergebnis verarbeitet (${keyCount} Felder). Zusammenfassung erstellt und Layer 4 verworfen.`
      );
    }
    if (executionMode === EXECUTION_MODES.HITL) {
      return prefixed(
        `${fileIntro}Plan bereit: ${plan.steps.length} deterministische Schritte für „${String(
          message
        )
          .trim()
          .slice(0, 160)}“. Ausführung wartet auf Freigabe.`
      );
    }
    if (execution?.status === 'awaiting-onboarding') {
      return this.buildRecoveryReply({
        message,
        plan,
        execution,
        fileIntro,
        assumptions: execution?.assumptions || [],
        synthesisStyle,
        responseStrategy,
      });
    }
    if (execution?.status === 'completed') {
      if (plan?.primaryIntent === 'netzbetreiber_flexibility_potential') {
        return this.buildGridOperatorFlexibilityCompletedReply({
          execution,
          message,
          fileIntro,
        });
      }
      return prefixed(
        `${fileIntro}Plan abgeschlossen: ${execution.steps.length} Schritte deterministisch ausgeführt. Kontext: ${promptExcerpt}`
      );
    }
    if (execution?.status === 'partial') {
      return this.buildRecoveryReply({
        message,
        plan,
        execution,
        fileIntro,
        assumptions: execution?.assumptions || [],
        synthesisStyle,
        responseStrategy,
      });
    }
    return prefixed(
      `${fileIntro}Verstanden. Nächster Schritt für: ${String(message).trim().slice(0, 240)}`
    );
  },

  buildGridOperatorFlexibilityCompletedReply({
    execution = {},
    message = '',
    fileIntro = '',
  } = {}) {
    const steps = Array.isArray(execution?.steps) ? execution.steps : [];
    const marketStep = steps.find((step) => step?.action === 'grid-operations.marketPartners');
    const cockpitStep = steps.find(
      (step) => step?.action === 'dashboard-api.redispatchMeteringCockpit'
    );
    const cockpit =
      cockpitStep?.result && typeof cockpitStep.result === 'object' ? cockpitStep.result : {};
    const evidence =
      cockpit.evidence && typeof cockpit.evidence === 'object' ? cockpit.evidence : {};
    const readiness = cockpit.decisionReadiness || {};
    const operator = cockpit.operator || {};
    const marketResult =
      marketStep?.result && typeof marketStep.result === 'object' ? marketStep.result : {};
    const marketCandidates =
      marketResult?.data?.results ||
      marketResult?.results ||
      marketResult?.result?.results ||
      marketResult?.result?.vnbs ||
      [];
    const candidate = Array.isArray(marketCandidates) ? marketCandidates[0] || null : null;
    const operatorLabel =
      operator.name ||
      candidate?.name ||
      candidate?.companyName ||
      candidate?.vnbName ||
      'Stadtwerke Tübingen / Netzbetreiber-Kontext';

    const valueOrOpen = (value, suffix = '') =>
      value === 0 || value ? `${value}${suffix}` : 'Offen';
    const gapCodes = Array.isArray(cockpit.blockingEvidenceGaps)
      ? cockpit.blockingEvidenceGaps.map((gap) => gap?.code || gap?.message).filter(Boolean)
      : [];
    const blockers = gapCodes.length > 0 ? gapCodes.join(', ') : 'Keine Cockpit-Blocker gemeldet';

    const rows = [
      [
        'Operator-Kandidat',
        operatorLabel,
        'grid-operations.marketPartners',
        candidate ? 'Mittel' : 'Offen',
        'Basis fuer BDEW/MaStR-Aufloesung vor Detailinventar',
      ],
      [
        'Redispatch/Metering Readiness',
        readiness.signal
          ? `${readiness.signal}${readiness.score ? ` (${readiness.score})` : ''}`
          : 'Offen',
        'dashboard-api.redispatchMeteringCockpit',
        readiness.signal ? 'Mittel' : 'Offen',
        'Zeigt, ob RD2.0/Messdaten als Entscheidungsbasis nutzbar sind',
      ],
      [
        'Redispatch Settlement Readiness',
        valueOrOpen(evidence.redispatch?.settlementReadinessPercent, ' %'),
        'dashboard-api.redispatchMeteringCockpit',
        evidence.redispatch?.settlementReadinessPercent == null ? 'Offen' : 'Mittel',
        'Indikator fuer Prozessreife, nicht fuer freies MW-Potenzial',
      ],
      [
        'Messdaten gesund / stale / fehlerhaft',
        `${valueOrOpen(evidence.metering?.datapointsHealthy)} / ${valueOrOpen(
          evidence.metering?.datapointsStale
        )} / ${valueOrOpen(evidence.metering?.datapointsErrored)}`,
        'dashboard-api.redispatchMeteringCockpit',
        evidence.metering ? 'Mittel' : 'Offen',
        'Grundlage fuer Lastgang- und Gleichzeitigkeitsbewertung',
      ],
      [
        'Masterdata Quality',
        valueOrOpen(evidence.masterData?.qualityScore),
        'dashboard-api.redispatchMeteringCockpit',
        evidence.masterData?.qualityScore == null ? 'Offen' : 'Mittel',
        'Qualitaetsanker fuer Anlagen-/Netzbetreiber-Zuordnung',
      ],
      [
        '§14a / RD2.0 MW-Inventar',
        'Offen',
        'VNBdigital §14a, MaStR/Assets, Topologie/Lastfluss noch nachziehen',
        'Offen',
        'Keine MW-Zusage ohne BDEW/MaStR, Topologie und Lastfluss',
      ],
    ];

    const table = [
      '| Kennzahl | Wert | Quelle | Belastbarkeit | Bedeutung fuer Entscheidung |',
      '| --- | --- | --- | --- | --- |',
      ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');

    return [
      `${fileIntro}${table}`,
      '',
      `Kurzfazit: Der Dialog ist als Executive Erstlagebild nutzbar. Die aktuellen Zahlen sind Prozess- und Evidenzkennzahlen, noch kein belastbares MW-Flexibilitaetspotenzial.`,
      `Offene Evidenz: ${blockers}. Fuer MW-Potenzial muessen §14a-Anlagen, Redispatch-2.0-Anlagen, Topologie, Lastfluss und Gleichzeitigkeitsannahmen nachgezogen werden.`,
      'Empfehlung: Speicher zuerst pruefen, weil sie Rueckspeisespitzen direkt verschieben koennen; danach flexible Industrie und Ladeparks mit netzdienlichem Fahrplan; Rechenzentren nur mit Standort-, Abwaerme- und Netzanschlussnachweis priorisieren.',
      `Kontext: ${String(message || '')
        .trim()
        .slice(0, 220)}`,
    ].join('\n');
  },

  buildSynthesisStyleLead(synthesisStyle) {
    if (synthesisStyle === 'cautionary') {
      return 'Risikohinweis:';
    }
    if (synthesisStyle === 'methodological') {
      return 'Methodik-Hinweis:';
    }
    return '';
  },
};
