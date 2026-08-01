'use strict';

// personal-agent methods chunk 2/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: buildResponsePolicyContract, buildConservativeResponseFromContract, buildClarificationPolicyReply, buildEvidenceRequirementsForRevalidation, recordEvidenceRequirementsForRevalidation, queryOpenEvidenceRequirements, applyResponsePolicyGuardrails, buildConsultationExecutionArtifact, executeConsultationToolPlan, buildConsultationPrompt, sanitizeConsultationRecentHistoryText, buildConsultationRecentHistoryWindow, fallbackConsultationReply, buildConsultationOperationalDegradationReply

const {
  getTenantId,
  buildConsultationExecutionPlan,
  extractAvailableInputs,
  validateRoutingIntent,
  buildSynthesisPolicyDirectives,
  CONSULTATION_HISTORY_MAX_ENTRIES,
  CONSULTATION_HISTORY_MAX_CHARS,
  CONSULTATION_HISTORY_ENTRY_MAX_CHARS,
  CONSULTATION_HISTORY_REDACTION_PLACEHOLDER,
} = require('./shared');

module.exports = {
  buildResponsePolicyContract({
    message = '',
    workflowType = null,
    domainIntent = null,
    knownContext = {},
    receiptKnowledgeEvidence = null,
    responsePlan = null,
    observations = [],
    execution = null,
    evidencePlan = null,
    verifiedFacts = [],
  } = {}) {
    const resolvedWorkflowType =
      workflowType ||
      responsePlan?.workflowType ||
      responsePlan?.executionReadiness?.workflowType ||
      'consultation_general';
    const resolvedDomainIntent =
      domainIntent ||
      responsePlan?.domainIntent ||
      responsePlan?.primaryIntent ||
      'consultation_general';

    const observationFacts = (Array.isArray(observations) ? observations : [])
      .filter((obs) => obs?.status === 'completed')
      .map((obs) => ({
        source: obs?.action || 'tool',
        value: String(obs?.summary || obs?.result?.description || 'completed').slice(0, 220),
      }));

    const executionFacts = (Array.isArray(execution?.steps) ? execution.steps : [])
      .filter((step) => step?.status === 'completed')
      .map((step) => ({
        source: step?.action || 'step',
        value: String(step?.purpose || step?.status || 'completed').slice(0, 220),
      }));

    const normalizedVerifiedFacts = [
      ...(Array.isArray(verifiedFacts) ? verifiedFacts : []).map((item) => {
        if (item && typeof item === 'object') {
          return {
            source: String(item.source || 'fact').slice(0, 160),
            value: String(item.value || '').slice(0, 220),
          };
        }
        return {
          source: 'fact',
          value: String(item || '').slice(0, 220),
        };
      }),
      ...observationFacts,
      ...executionFacts,
    ].filter((fact) => Boolean(fact.value));

    const knowledgeEvidence =
      receiptKnowledgeEvidence && typeof receiptKnowledgeEvidence === 'object'
        ? receiptKnowledgeEvidence
        : null;
    const knowledgeStatus = String(knowledgeEvidence?.status || '').toLowerCase();
    const knowledgeRequired = knowledgeEvidence?.required === true;
    const knowledgeHits = Array.isArray(knowledgeEvidence?.hits) ? knowledgeEvidence.hits : [];

    const knowledgeFacts = knowledgeHits
      .slice(0, 4)
      .map((hit) => ({
        source: String(hit?.source || 'knowledge').slice(0, 160),
        value: String(hit?.summary || '').slice(0, 220),
      }))
      .filter((entry) => entry.value);

    normalizedVerifiedFacts.push(...knowledgeFacts);

    const hasVerifiedVnbLookup =
      (Array.isArray(observations) ? observations : []).some(
        (obs) =>
          obs?.action === 'grid-operations.vnbLookup' &&
          obs?.status === 'completed' &&
          !obs?.error &&
          obs?.result?.error == null
      ) ||
      (Array.isArray(execution?.steps) ? execution.steps : []).some(
        (step) =>
          step?.action === 'grid-operations.vnbLookup' &&
          step?.status === 'completed' &&
          !step?.error &&
          step?.result?.error == null
      );

    const hasMarketPartnersContext = (Array.isArray(observations) ? observations : []).some(
      (obs) => obs?.action === 'grid-operations.marketPartners'
    );
    const hasVnbEvidenceSignal =
      /(?:\bvnb\b|\bnetzbetreiber\b|\bnetzgebiet\b|\bnetzzone\b|\bstandort\b|\banschluss\b|\bbdew\b|\bmarktlokation\b|\bnetzanschlusspunkt\b)/i.test(
        String(message || '')
      ) ||
      hasMarketPartnersContext ||
      Boolean(
        knownContext?.gridOperatorName ||
        knownContext?.assertedGridOperatorName ||
        knownContext?.bdew ||
        knownContext?.bdewCode ||
        knownContext?.vnbName ||
        knownContext?.operatorEvidence ||
        knownContext?.gridOperatorBdew
      );

    const missingEvidence = [];
    if (hasVnbEvidenceSignal && !hasVerifiedVnbLookup) {
      missingEvidence.push({
        id: 'vnb_lookup_required',
        label: 'Dedizierter VNB-/Netzgebietslookup fehlt.',
        severity: 'high',
      });
    }

    (Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : []).slice(0, 10).forEach((gap) => {
      missingEvidence.push({
        id: String(gap?.id || gap?.requirementId || 'evidence_gap'),
        label: String(gap?.required || gap?.label || 'Fehlende Evidenz').slice(0, 220),
        severity: String(gap?.severity || 'medium'),
      });
    });

    if (knowledgeRequired && knowledgeStatus && knowledgeStatus !== 'available') {
      missingEvidence.push({
        id: 'receipt_knowledge_required',
        label: 'Receipt fordert Knowledge-Evidenz, aber sie ist derzeit nicht verfügbar.',
        severity: knowledgeStatus === 'timeout' ? 'high' : 'medium',
      });
    }

    if (knowledgeStatus === 'timeout') {
      missingEvidence.push({
        id: 'knowledge_evidence_timeout',
        label: 'Knowledge-Evidenz konnte wegen Timeout nicht geladen werden.',
        severity: knowledgeRequired ? 'high' : 'medium',
      });
    }

    if (knowledgeStatus === 'unavailable') {
      missingEvidence.push({
        id: 'knowledge_evidence_unavailable',
        label: 'Knowledge Service ist derzeit nicht verfügbar.',
        severity: knowledgeRequired ? 'high' : 'low',
      });
    }

    const unverifiedAssumptions = [];
    if (hasVnbEvidenceSignal && !hasVerifiedVnbLookup) {
      unverifiedAssumptions.push({
        type: 'location_operator_unverified',
        statement:
          'Die Zuständigkeit des VNB ist ohne dedizierten Lookup nicht belastbar verifiziert.',
        confidence: 'low',
      });
    }

    if (knowledgeRequired && knowledgeStatus && knowledgeStatus !== 'available') {
      unverifiedAssumptions.push({
        type: 'knowledge_evidence_missing',
        statement: 'Receipt-spezifische Knowledge-Evidenz ist derzeit nicht verifiziert verfügbar.',
        confidence: 'low',
      });
    }

    const nextVerificationSteps = [];
    if (missingEvidence.some((item) => item.id === 'vnb_lookup_required')) {
      nextVerificationSteps.push({
        action: 'grid-operations.vnbLookup',
        description: 'Zuständigen VNB über dedizierten Netzgebietslookup verifizieren.',
      });
    }

    if (knowledgeRequired && knowledgeStatus && knowledgeStatus !== 'available') {
      nextVerificationSteps.push({
        action: 'knowledge-rag.query',
        description: 'Receipt-spezifische Knowledge-Evidenz erneut laden und verifizieren.',
      });
    }

    (Array.isArray(evidencePlan?.nextSteps) ? evidencePlan.nextSteps : [])
      .slice(0, 5)
      .forEach((step) => {
        nextVerificationSteps.push({
          action: String(step?.action || 'evidence_step').slice(0, 100),
          description: String(step?.description || step?.label || 'Evidenz ergänzen').slice(0, 220),
        });
      });

    const allowedLegalRefs = this.collectAllowedLegalRefs({
      knownContext,
      verifiedFacts: normalizedVerifiedFacts,
      workflowType: resolvedWorkflowType,
      domainIntent: resolvedDomainIntent,
    });

    const evidenceStatus =
      normalizedVerifiedFacts.length > 0 && missingEvidence.length === 0
        ? 'verified'
        : normalizedVerifiedFacts.length > 0
          ? 'partial'
          : 'unverified';

    return {
      workflowType: resolvedWorkflowType,
      domainIntent: resolvedDomainIntent,
      verifiedFacts: normalizedVerifiedFacts.slice(0, 12),
      unverifiedAssumptions,
      missingEvidence,
      forbiddenClaims: [
        'no_unverified_vnb_assertion',
        'no_unbacked_legal_reference',
        'no_timeout_relief_without_evidence',
        'no_workflow_mismatch_claim',
        'no_knowledge_overclaim_without_evidence',
      ],
      nextVerificationSteps,
      allowedLegalRefs,
      evidenceStatus,
    };
  },

  buildConservativeResponseFromContract(contract = {}) {
    const facts = Array.isArray(contract?.verifiedFacts) ? contract.verifiedFacts : [];
    const missingEvidence = Array.isArray(contract?.missingEvidence)
      ? contract.missingEvidence
      : [];
    const nextSteps = Array.isArray(contract?.nextVerificationSteps)
      ? contract.nextVerificationSteps
      : [];

    const factSummary =
      facts.length > 0
        ? `Vorliegende Evidenz: ${facts
            .slice(0, 3)
            .map((fact) => `${fact.source}: ${fact.value}`)
            .join('; ')}.`
        : 'Derzeit liegt keine vollständige, belastbare Evidenz vor.';
    const missingSummary =
      missingEvidence.length > 0
        ? `Offene Evidenz: ${missingEvidence
            .slice(0, 3)
            .map((item) => item.label)
            .join('; ')}.`
        : '';
    const nextSummary =
      nextSteps.length > 0
        ? `Nächste Verifikation: ${nextSteps
            .slice(0, 2)
            .map((step) => step.description)
            .join('; ')}.`
        : 'Nächste Verifikation: Bitte fehlende Evidenz gezielt ergänzen.';

    return [
      'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen.',
      factSummary,
      missingSummary,
      nextSummary,
    ]
      .filter(Boolean)
      .join(' ')
      .trim();
  },

  buildClarificationPolicyReply(policy = {}) {
    const clarification =
      policy?.clarification && typeof policy.clarification === 'object' ? policy.clarification : {};
    const question = String(clarification.question || '').trim();
    const details = String(clarification.details || '').trim();
    const options = Array.isArray(clarification.options) ? clarification.options : [];
    const optionText = options
      .map((option) => String(option?.label || option?.id || '').trim())
      .filter(Boolean)
      .join(' oder ');

    return [
      question || 'Welche Variante soll ich prüfen?',
      optionText ? `Optionen: ${optionText}.` : '',
      details,
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();
  },

  buildEvidenceRequirementsForRevalidation({
    sessionId,
    personaId,
    responsibleRole,
    missingEvidence = [],
    evidencePlan = null,
    execution = null,
  } = {}) {
    if (!personaId && !responsibleRole) return [];

    const candidates = [];
    const seen = new Set();

    const addCandidate = (requestedFact, scope) => {
      if (seen.has(requestedFact)) return;
      seen.add(requestedFact);
      const candidate = {
        evidenceRequirementId: `evreq:${sessionId}:${requestedFact}`,
        originSessionId: sessionId,
        requestedFact,
        scope,
      };
      if (personaId) candidate.originPersonaId = personaId;
      if (responsibleRole) candidate.responsibleRole = responsibleRole;
      candidates.push(candidate);
    };

    const GRID_OPERATOR_MISSING_IDS = new Set([
      'vnb_lookup_required',
      'gridOperatorBdew',
      'bdew',
      'bdewCode',
      'operatorEvidence',
    ]);
    const GRID_OPERATOR_PARAMS = new Set([
      'gridOperatorBdew',
      'bdew',
      'bdewCode',
      'gridOperatorId',
      'gridOperatorName',
      'vnbName',
    ]);

    const safeMissingEvidence = Array.isArray(missingEvidence) ? missingEvidence : [];
    if (safeMissingEvidence.some((e) => GRID_OPERATOR_MISSING_IDS.has(e?.id))) {
      addCandidate('gridOperatorBdew', 'tenant_candidate');
    }

    const stopMissingParams = Array.isArray(execution?.stopPoint?.missingParams)
      ? execution.stopPoint.missingParams
      : [];
    if (stopMissingParams.some((p) => GRID_OPERATOR_PARAMS.has(p))) {
      addCandidate('gridOperatorBdew', 'tenant_candidate');
    }

    const gaps = Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : [];
    if (gaps.some((g) => GRID_OPERATOR_MISSING_IDS.has(g?.id || g?.requirementId))) {
      addCandidate('gridOperatorBdew', 'tenant_candidate');
    }

    return candidates;
  },

  async recordEvidenceRequirementsForRevalidation(ctx, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return;
    const tenantId = getTenantId(ctx);
    for (const candidate of candidates) {
      try {
        await ctx.call(
          'evidence-revalidation.recordRequirement',
          {
            tenantId,
            evidenceRequirementId: candidate.evidenceRequirementId,
            originSessionId: candidate.originSessionId,
            ...(candidate.originPersonaId ? { originPersonaId: candidate.originPersonaId } : {}),
            ...(candidate.responsibleRole ? { responsibleRole: candidate.responsibleRole } : {}),
            requestedFact: candidate.requestedFact,
            scope: candidate.scope,
          },
          { meta: { tenantId, $gateway: false } }
        );
      } catch (error) {
        this.logger?.warn(
          `evidence-revalidation.recordRequirement failed (non-blocking): ${error.message}`
        );
      }
    }
  },

  async queryOpenEvidenceRequirements(ctx, { role, tenantId, projectScopeKey = null } = {}) {
    try {
      const result = await ctx.call(
        'evidence-requirement.listOpenForRole',
        { tenantId, role: role || 'netzplanung', projectScopeKey },
        { meta: { ...ctx.meta, tenantId, $gateway: false } }
      );
      const items = Array.isArray(result?.items) ? result.items : [];
      if (items.length === 0) {
        return `Für die Rolle **${role || 'netzplanung'}** liegen derzeit keine offenen Evidence-Anforderungen vor.`;
      }
      const lines = items.map(
        (item) =>
          `- **${item.label}** (ID: \`${item.requirementId}\`, seit ${item.createdAt?.slice(0, 10) || 'unbekannt'})`
      );
      return [
        `Offene Evidence-Anforderungen für Rolle **${role || 'netzplanung'}** (${items.length}):`,
        '',
        ...lines,
        '',
        'Antworten Sie auf eine Anforderung mit: "Die Anforderung `<ID>` ist: <Ihre Antwort>"',
      ].join('\n');
    } catch (_err) {
      process.stderr.write(
        `[methods-part-02-of-11] silent-catch-fallback (line 416): ${_err && _err.message}\n`
      );
      return null;
    }
  },

  applyResponsePolicyGuardrails({ reply = '', contract = {}, timeoutFallback = false } = {}) {
    let guardedReply = String(reply || '').trim();
    const guardrailCorrections = [];

    const workflowType = String(contract?.workflowType || '').toLowerCase();
    const missingEvidence = Array.isArray(contract?.missingEvidence)
      ? contract.missingEvidence
      : [];
    const hasUnverifiedVnbGap = missingEvidence.some((item) => item?.id === 'vnb_lookup_required');
    const definiteVnbClaimRegex =
      /(?:zust[äa]ndig(?:e[rn])?|verantwortlich(?:e[rn])?)\b[^.\n]{0,120}\b(?:ist|sei|wird|bleibt)\b/i;

    if (hasUnverifiedVnbGap && definiteVnbClaimRegex.test(guardedReply)) {
      guardedReply = this.buildConservativeResponseFromContract(contract);
      guardrailCorrections.push({
        code: 'UNVERIFIED_VNB_CLAIM_BLOCKED',
        severity: 'high',
        replacement: 'conservative_response',
      });
    }

    const allowedLegalRefs = new Set(
      (Array.isArray(contract?.allowedLegalRefs) ? contract.allowedLegalRefs : []).map((item) =>
        String(item || '')
          .replace(/\s+/g, ' ')
          .trim()
      )
    );
    const legalRefRegex = /§\s*\d+[a-zA-Z]*\s*EnWG/gi;
    const legalRefsInReply = guardedReply.match(legalRefRegex) || [];
    legalRefsInReply.forEach((ref) => {
      const normalized = String(ref || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!allowedLegalRefs.has(normalized)) {
        guardedReply = guardedReply.replace(ref, 'EnWG (Quelle erforderlich)');
        guardrailCorrections.push({
          code: 'UNBACKED_LEGAL_REFERENCE_BLOCKED',
          severity: 'medium',
          reference: normalized,
        });
      }
    });

    const workflowMismatch =
      (workflowType.includes('bess') &&
        /\b(vdmi|governance|asset\s*validation|residual\s*load|forecast)\b/i.test(guardedReply)) ||
      ((workflowType.includes('governance') || workflowType.includes('vdmi')) &&
        /\b(bess\s*screening|battery\s*sizing|wallbox|prosumer\s*tarif)\b/i.test(guardedReply)) ||
      (workflowType.includes('edm') &&
        /\b(asset\s*validation|bess\s*screening|residual\s*load\s*forecast)\b/i.test(guardedReply));

    if (workflowMismatch) {
      guardedReply = this.buildConservativeResponseFromContract(contract);
      guardrailCorrections.push({
        code: 'WORKFLOW_CONTEXT_MISMATCH_BLOCKED',
        severity: 'high',
        replacement: 'conservative_response',
      });
    }

    const knowledgeTimeoutGap = missingEvidence.some(
      (item) => item?.id === 'knowledge_evidence_timeout'
    );
    const knowledgeRequiredGap = missingEvidence.some(
      (item) => item?.id === 'receipt_knowledge_required'
    );

    if (knowledgeTimeoutGap || knowledgeRequiredGap) {
      const hint =
        'Hinweis: Knowledge-Evidenz ist aktuell nicht verfügbar; die Antwort bleibt konservativ bis zur Verifikation.';
      if (!guardedReply.includes(hint)) {
        guardedReply = `${guardedReply}\n\n${hint}`.trim();
      }
      guardrailCorrections.push({
        code: knowledgeTimeoutGap
          ? 'KNOWLEDGE_EVIDENCE_TIMEOUT_CONSERVATIVE'
          : 'KNOWLEDGE_EVIDENCE_REQUIRED_CONSERVATIVE',
        severity: 'medium',
      });
    }

    if (timeoutFallback && /keine kritischen probleme identifiziert/i.test(guardedReply)) {
      guardedReply = guardedReply.replace(
        /keine kritischen probleme identifiziert/gi,
        'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen'
      );
      guardrailCorrections.push({
        code: 'MISLEADING_TIMEOUT_RELIEF_BLOCKED',
        severity: 'high',
      });
    }

    if (
      timeoutFallback &&
      !/synthese unvollständig; belastbare bewertung nicht abgeschlossen/i.test(guardedReply)
    ) {
      guardedReply =
        `Synthese unvollständig; belastbare Bewertung nicht abgeschlossen. ${guardedReply}`.trim();
    }

    if (!guardedReply) {
      guardedReply = this.buildConservativeResponseFromContract(contract);
      guardrailCorrections.push({
        code: 'EMPTY_REPLY_RECOVERED',
        severity: 'high',
        replacement: 'conservative_response',
      });
    }

    return {
      reply: guardedReply,
      guardrailCorrections,
    };
  },

  buildConsultationExecutionArtifact(
    _ctx,
    {
      message,
      consultation,
      brokerRecommendation,
      knownContext,
      semanticClassification,
      responseStrategy,
      executionMode,
    }
  ) {
    // 1. Extract available inputs from message, consultation facts, and known context
    const extractedInputs = extractAvailableInputs(
      message,
      consultation?.factsUsed || {},
      knownContext || {}
    );

    // 2. Classify workflow and validate routing intent
    const { classifyWorkflowType } = require('../../src/consultation-execution-bridge');
    const workflowType = classifyWorkflowType({
      message,
      consultation: {
        ...(consultation || {}),
        semanticClassification:
          semanticClassification && typeof semanticClassification === 'object'
            ? semanticClassification
            : consultation?.semanticClassification || null,
      },
      knownContext,
      brokerRecommendation,
      extractedInputs,
    });

    const routingValidation = validateRoutingIntent({
      workflowType,
      brokerRecommendation,
      message,
    });

    // 3. Use corrected workflow type if routing validation detected a mismatch
    const finalWorkflowType = routingValidation.correctedWorkflow || workflowType;
    if (!routingValidation.valid) {
      this.logger?.warn('Routing intent mismatch detected', {
        reason: routingValidation.reason,
        originalWorkflow: workflowType,
        correctedWorkflow: finalWorkflowType,
        correctedIntent: routingValidation.correctedIntent,
      });
    }

    // 4. Build plan with extracted inputs and corrected workflow
    return buildConsultationExecutionPlan({
      message,
      consultation,
      brokerRecommendation,
      knownContext,
      semanticClassification,
      extractedInputs,
      responseStrategy,
      executionMode,
    });
  },

  async executeConsultationToolPlan(
    ctx,
    { plan, knownContext: _knownContext, session: _session, executionTrace, toolCallTracker }
  ) {
    const stepsToRun = (Array.isArray(plan.executableSteps) ? plan.executableSteps : [])
      .filter((s) => s.canExecute)
      .slice(0, 3);

    const results = [];

    for (const step of stepsToRun) {
      try {
        const result = await ctx.call(step.action, step.params || {}, {
          meta: { ...ctx.meta, $timeout: 5000 },
        });

        if (executionTrace && typeof executionTrace.addStep === 'function') {
          executionTrace.addStep({
            step: step.step,
            action: step.action,
            purpose: step.purpose,
            status: 'success',
          });
        }
        if (toolCallTracker && typeof toolCallTracker.track === 'function') {
          toolCallTracker.track({
            action: step.action,
            status: 'success',
            source: 'consultation_plan',
          });
        }

        results.push({
          step: step.step,
          action: step.action,
          status: 'success',
          result,
          purpose: step.purpose,
        });
      } catch (stepError) {
        results.push({
          step: step.step,
          action: step.action,
          status: 'error',
          error: String(stepError?.message || stepError),
          purpose: step.purpose,
        });
      }
    }

    return { results, completedSteps: results.filter((r) => r.status === 'success').length };
  },

  buildConsultationPrompt({
    message,
    brokerRecommendation,
    resolvedParams,
    knowledgeContext,
    responseStrategy = null,
    recentHistoryWindow = [],
    observations = [],
    toolRegistry = [],
    synthesisPolicy = null,
    routingPolicy = null,
  }) {
    const facts = [];
    const knownFacts = resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {};
    for (const [key, value] of Object.entries(knownFacts)) {
      if (value === undefined || value === null || value === '') continue;
      if (typeof value === 'object') {
        facts.push(`- ${key}: ${JSON.stringify(value).slice(0, 300)}`);
      } else {
        facts.push(`- ${key}: ${String(value).slice(0, 300)}`);
      }
    }

    if (knowledgeContext?.domainHint) {
      facts.push(`- domainHint: ${knowledgeContext.domainHint}`);
    }
    if (knowledgeContext?.regulatoryFrame) {
      facts.push(`- regulatoryFrame: ${knowledgeContext.regulatoryFrame}`);
    }
    if (brokerRecommendation?.intent) {
      facts.push(`- brokerIntent: ${brokerRecommendation.intent}`);
    }

    const strategy =
      responseStrategy ||
      this.buildResponseStrategy({
        message,
        knowledgeContext,
        resolvedParams,
      });

    facts.push('');
    facts.push('Antwortstrategie:');
    facts.push(`- audience: ${strategy.audience || 'general'}`);
    facts.push(`- epistemicState: ${strategy.epistemicState || 'clear'}`);
    facts.push(`- abstractionLevel: ${strategy.abstractionLevel || 'balanced'}`);
    facts.push(`- nextMove: ${strategy.nextMove || 'answer'}`);
    facts.push('- keine internen Schema-Feldnamen an den Nutzer ausgeben');
    if (strategy.epistemicState === 'inferable') {
      facts.push(
        '- Working Assumptions ausdrücklich benennen, bevor deterministische Schritte folgen'
      );
    }
    if (strategy.epistemicState === 'ambiguous') {
      facts.push('- nur eine präzise Klärungsfrage stellen, statt zu raten');
    }
    if (strategy.audience === 'leadership') {
      facts.push('- zuerst Entscheidung, Wirkung und Risiko, dann Details');
    }
    if (strategy.audience === 'technical') {
      facts.push('- technische Begriffe in Klartext, aber ohne interne Parameternamen');
    }

    if (Array.isArray(recentHistoryWindow) && recentHistoryWindow.length > 0) {
      facts.push('');
      facts.push('Gleicher Session-Verlauf (nur vorherige Turns, lokal/unbestätigt):');
      facts.push('- Diese Turns stammen nur aus derselben Session.');
      facts.push('- Behandle sie als Gesprächskontext, nicht als bestätigtes Tenant-Wissen.');
      facts.push('- Bei Konflikten zählen neuere Angaben und deterministische Evidenz stärker.');
      facts.push('- Fehlende Felder nicht erfinden; stattdessen eine präzise Rückfrage stellen.');
      for (const entry of recentHistoryWindow) {
        const roleLabel = entry?.role === 'assistant' ? 'ASSISTANT' : 'NUTZER';
        const text = String(entry?.text || '').trim();
        if (!text) {
          continue;
        }
        facts.push(`- ${roleLabel}: ${text}`);
      }
    }

    if (Array.isArray(observations) && observations.length > 0) {
      facts.push('');
      facts.push('Tool-Beobachtungen:');
      for (const observation of observations.slice(0, 6)) {
        facts.push(
          `- ${observation.action || 'tool'} [${observation.status || 'unknown'}]: ${String(
            observation.summary || observation.error || observation.result || ''
          ).slice(0, 400)}`
        );
      }
    }

    if (Array.isArray(toolRegistry) && toolRegistry.length > 0) {
      facts.push('');
      facts.push('Verfügbare Werkzeuge:');
      for (const tool of toolRegistry) {
        facts.push(
          `- ${tool.action}: ${tool.description}${tool.guidance ? ` | ${tool.guidance}` : ''}`
        );
      }
    }

    const synthPolicyDirectives = buildSynthesisPolicyDirectives(synthesisPolicy, routingPolicy);
    if (synthPolicyDirectives.length > 0) {
      facts.push('');
      facts.push('Blueprint-Syntheserichtlinien:');
      for (const directive of synthPolicyDirectives) {
        facts.push(directive);
      }
    }

    return [
      'Du bist ein Experte für deutsche Energiewirtschaft.',
      'Der Nutzer sucht Beratung und Einordnung. KEINE deterministische Blockade-Antwort.',
      'Regeln:',
      '- Erkläre kurz und verständlich.',
      '- Formuliere belastbar mit Unsicherheiten, wenn Evidenz fehlt.',
      '- Keine Sätze wie "Schnittstelle fehlt" oder "Methodik-Hinweis".',
      '- Leite fehlende Informationen als fachliche Konzepte, nie als interne Schemafelder, her.',
      '- Wenn die Lage inferierbar ist, benenne die Working Assumption ausdrücklich, bevor du fortfährst.',
      '- Wenn die Lage unklar ist, stelle genau eine präzise Klärungsfrage.',
      '- Passe die Abstraktion an: Führungsebene = Entscheidung/Risiko/Wirkung, technisch = Details/Eingaben.',
      '- Schlage konkrete nächste Schritte vor.',
      '',
      'Verfügbare Fakten:',
      facts.length > 0 ? facts.join('\n') : '- keine belastbaren Zusatzfakten vorhanden',
      '',
      `Nutzerfrage: ${String(message || '').trim()}`,
      '',
      'Antworte im geforderten JSON-Schema.',
    ].join('\n');
  },

  sanitizeConsultationRecentHistoryText(value = '') {
    const raw = String(value || '');
    if (!raw.trim()) {
      return null;
    }

    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    const jsonLike =
      ((/^[\[{]/.test(normalized) || /[\]}]$/.test(normalized)) &&
        /"[^"\n]{1,80}"\s*:/.test(normalized)) ||
      /"responseRaw"\s*:|"toolContext"\s*:|"inhouseData"\s*:|"rawJson"\s*:/i.test(raw);
    const xmlLike = /<[^>]{1,80}>/.test(raw);
    const base64Like = /(?:^|\s)[A-Za-z0-9+/]{80,}={0,2}(?:\s|$)/.test(raw);
    const csvLike =
      /(?:^|[\r\n])[^\r\n]*(,|;|\t)[^\r\n]*(,|;|\t)[^\r\n]*(?:[\r\n]|$)/.test(raw) &&
      raw.split(/\r?\n/).length > 1;
    const rawSensitiveHint =
      /(responseRaw|toolContext|inhouseData|rawJson|rawResponse|attachment|extract|hems|nap|payload)/i.test(
        raw
      ) && normalized.length > 80;

    if (jsonLike || xmlLike || base64Like || csvLike || rawSensitiveHint) {
      return CONSULTATION_HISTORY_REDACTION_PLACEHOLDER;
    }

    return normalized.slice(0, CONSULTATION_HISTORY_ENTRY_MAX_CHARS);
  },

  buildConsultationRecentHistoryWindow(session = null) {
    const history = Array.isArray(session?.l3?.history) ? session.l3.history : [];
    if (history.length === 0) {
      return [];
    }

    const sanitizedEntries = history
      .map((entry) => ({
        role: String(entry?.role || '')
          .trim()
          .toLowerCase(),
        text: this.sanitizeConsultationRecentHistoryText(entry?.text || entry?.content || ''),
      }))
      .filter(
        (entry) =>
          ['user', 'assistant'].includes(entry.role) && Boolean(String(entry.text || '').trim())
      );

    if (sanitizedEntries.length === 0) {
      return [];
    }

    const recentEntries = sanitizedEntries.slice(-CONSULTATION_HISTORY_MAX_ENTRIES);
    const bounded = [];
    let remainingChars = CONSULTATION_HISTORY_MAX_CHARS;

    for (let index = recentEntries.length - 1; index >= 0; index -= 1) {
      const entry = recentEntries[index];
      const text = String(entry?.text || '').trim();
      if (!text) {
        continue;
      }

      const allowedChars = Math.max(0, remainingChars - 24);
      if (allowedChars <= 0) {
        break;
      }

      const truncatedText = text.slice(0, allowedChars).trim();
      if (!truncatedText) {
        continue;
      }

      bounded.unshift({ role: entry.role, text: truncatedText });
      remainingChars -= truncatedText.length;
    }

    return bounded;
  },

  fallbackConsultationReply(message = '', observations = [], collectedFacts = [], options = {}) {
    // Extract top 2 most relevant facts from observations
    const topFacts = (Array.isArray(observations) ? observations : []).slice(0, 2).map((obs) => ({
      label: obs.action || 'Überprüfung',
      summary: String(obs.summary || obs.result?.description || obs.error || 'durchgeführt').slice(
        0,
        200
      ),
    }));
    const uncertaintyNote = this.buildConsultationVnbUncertaintyNote(message, observations);

    return {
      reply:
        'Ich habe die Beratung eingeleitet und verschiedene Aspekte überprüft. ' +
        'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen. ' +
        (topFacts.length > 0
          ? topFacts.map((f) => `${f.label}: ${f.summary}`).join('; ')
          : 'Es liegt derzeit keine vollständige Evidenz für eine belastbare Bewertung vor.') +
        uncertaintyNote +
        ' Bitte nutzen Sie den Ausführungs-Modus, um konkrete nächste Schritte zu initiieren.',
      hypotheses: [],
      openQuestions: [],
      nextActions: [
        {
          action: 'Ausführungs-Modus verwenden',
          description: 'Initiieren Sie einen der verfügbaren Tools zur konkreten Schrittausführung',
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
      degradation: this.buildConsultationDegradation({
        reason: options?.degradationReason || 'synthesis_budget_exhausted',
        timeoutFallback: true,
        recoveredFromEvidence: topFacts.length > 0,
        userVisible: true,
      }),
      ...(Array.isArray(options?.debugTrace) ? { debugTrace: options.debugTrace } : {}),
    };
  },

  buildConsultationOperationalDegradationReply(message = '', options = {}) {
    const normalizedMessage = String(message || '').trim();

    return {
      reply:
        'Der Beratungsmodus ist aktuell nur eingeschränkt verfügbar. ' +
        'Die sprachliche Synthese konnte nicht zuverlässig abgeschlossen werden; ' +
        'deshalb gebe ich keine belastbare fachliche Einordnung aus. ' +
        'Wenn Sie möchten, kann ich stattdessen konkrete Prüfschritte im Ausführungs-Modus starten ' +
        'oder gezielt die fehlenden Evidenzpunkte klären.',
      hypotheses: [],
      openQuestions: normalizedMessage
        ? [
            {
              question:
                'Soll ich direkt in den Ausführungs-Modus wechseln oder zuerst fehlende Evidenz sammeln?',
              whyRelevant:
                'So bleibt das weitere Vorgehen transparent, obwohl die Synthese derzeit degradiert ist.',
            },
          ]
        : [],
      nextActions: [
        {
          action: 'Ausführungs-Modus verwenden',
          description: 'Starte konkrete Prüfschritte statt einer rein sprachlichen Einordnung.',
        },
        {
          action: 'Fehlende Evidenz klären',
          description:
            'Sammle erst belastbare Eingaben oder Tool-Evidenz für eine spätere Bewertung.',
        },
      ],
      factsUsed: normalizedMessage
        ? [
            {
              source: 'user_prompt',
              value: normalizedMessage.slice(0, 280),
            },
          ]
        : [],
      degradation: this.buildConsultationDegradation({
        reason: options?.reason || 'non_agentic_synthesis_unavailable',
        timeoutFallback: options?.timeoutFallback !== false,
        recoveredFromEvidence: false,
        userVisible: true,
      }),
      ...(Array.isArray(options?.debugTrace) ? { debugTrace: options.debugTrace } : {}),
    };
  },
};
