'use strict';

// personal-agent methods chunk 7/11 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: buildGroundedReceiptReply, buildEvidenceGapUserMessage, appendGroundingContractToReply, buildReceiptExecutionContext, normalizeReceiptExecutionResult, selectRuntimeReceipt, buildReceiptSelectionMetadata, attachKnowledgeHintsToKnownContext, buildQualitySummary, getHandoffPersonaIdFromWorkflowAuditTrail, getPersonaHandoffSnapshotContext, resolvePersonaForTrace, resolveBootstrapContext, buildBootstrapTraceContext

const {
  MoleculerClientError,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
  pruneUndefinedDeep,
  buildGroundedReceiptReplyAdapter,
  isNotFound,
  isActionUnavailable,
  isPlausibleBdewCode,
} = require('./shared');

module.exports = {
  buildGroundedReceiptReply(_message = '', receiptSelection = null, executionResult = null) {
    return buildGroundedReceiptReplyAdapter(_message, receiptSelection, executionResult);
  },

  buildEvidenceGapUserMessage(evidencePlan = {}) {
    const gaps = Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : [];
    const requiredGaps = gaps.filter((gap) => gap?.required !== false).slice(0, 5);
    const listed = (requiredGaps.length > 0 ? requiredGaps : gaps.slice(0, 5)).map((gap) => {
      const label = gap?.label || gap?.id || gap?.sourceId || 'Evidenz';
      const reason =
        gap?.reason ||
        gap?.missingReason ||
        gap?.severity ||
        'für die belastbare Prüfung erforderlich';
      return `- ${label}: ${reason}.`;
    });

    if (listed.length === 0) {
      return 'Ich kann die Antwort noch nicht belastbar abschließen, weil die erforderliche Evidenz noch nicht vollständig vorliegt. Bitte ergänze die fehlenden Nachweise oder starte die passende Datenabfrage erneut.';
    }

    return [
      'Ich kann die Antwort noch nicht belastbar abschließen, weil folgende Evidenz fehlt:',
      ...listed,
      'Sobald diese Evidenz vorliegt, kann ich die Bewertung ohne Platzhalter fortsetzen.',
    ].join('\n');
  },

  appendGroundingContractToReply(
    reply = '',
    { execution = null, knowledgeScope = [], missingEvidence = [], assumptions = [] } = {}
  ) {
    const baseReply = String(reply || '').trim();
    if (!baseReply || /\bDatengrundlage\s*:/i.test(baseReply)) {
      return baseReply;
    }

    const datapoints = sanitizeScopedDatapoints(knowledgeScope)
      .slice(0, 4)
      .map((point) => {
        const status = point.status ? `, ${point.status}` : '';
        return `${point.key} (${point.scope}/${point.source}${status})`;
      });

    const toolEvidence = (Array.isArray(execution?.steps) ? execution.steps : [])
      .filter((step) => step?.status === 'completed' && step?.action)
      .slice(0, 4)
      .map((step) => step.action);

    const openEvidence = (Array.isArray(missingEvidence) ? missingEvidence : [])
      .map((gap) => gap?.label || gap?.id || gap)
      .filter(Boolean)
      .slice(0, 3);

    const assumptionTexts = (Array.isArray(assumptions) ? assumptions : [])
      .map((item) => {
        if (typeof item === 'string') return item;
        return item?.label || item?.type || item?.value || null;
      })
      .filter(Boolean)
      .slice(0, 3);

    if (
      datapoints.length === 0 &&
      toolEvidence.length === 0 &&
      openEvidence.length === 0 &&
      assumptionTexts.length === 0
    ) {
      return baseReply;
    }

    const lines = ['Datengrundlage:'];
    if (datapoints.length > 0) {
      lines.push(`- Genutzte Datenpunkte: ${datapoints.join('; ')}.`);
    }
    if (toolEvidence.length > 0) {
      lines.push(`- Tool-Evidenz: ${toolEvidence.join('; ')}.`);
    }
    lines.push(
      `- Annahmen: ${assumptionTexts.length > 0 ? `${assumptionTexts.join('; ')}.` : 'keine zusätzlichen Annahmen für die Kernaussage.'}`
    );
    if (openEvidence.length > 0) {
      lines.push(`- Noch offen: ${openEvidence.join('; ')}.`);
    }

    return `${baseReply}\n\n${lines.join('\n')}`;
  },

  buildReceiptExecutionContext({
    message = '',
    knownContext = {},
    resolvedParams = {},
    observations = [],
  } = {}) {
    const baseContext = {
      ...(knownContext && typeof knownContext === 'object' ? knownContext : {}),
      ...(resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {}),
    };

    const city =
      baseContext.city ||
      baseContext.municipality ||
      baseContext.location ||
      baseContext.promptHints?.city ||
      null;
    const rawBdew = baseContext.bdewCode || baseContext.bdew || baseContext.promptHints?.bdew;
    const bdewCode = isPlausibleBdewCode(rawBdew) ? rawBdew : undefined;
    const vnbName =
      baseContext.vnbName ||
      baseContext.gridOperatorName ||
      baseContext.assertedGridOperatorName ||
      baseContext.promptHints?.vnbName;

    return pruneUndefinedDeep({
      ...baseContext,
      message: String(message || ''),
      city: city,
      municipality: baseContext.municipality || city || undefined,
      bdewCode: bdewCode || undefined,
      bdew: isPlausibleBdewCode(baseContext.bdew) ? baseContext.bdew : bdewCode || undefined,
      vnbName: vnbName || undefined,
      gridOperatorName: baseContext.gridOperatorName || vnbName || undefined,
      observations: Array.isArray(observations) ? observations : [],
    });
  },

  normalizeReceiptExecutionResult(result = {}, { plan = null, message = '' } = {}) {
    const rawSteps = Array.isArray(result?.steps) ? result.steps : [];
    const normalizedSteps = rawSteps.map((step, idx) => ({
      step: Number(step?.step || idx + 1),
      action: step?.action || step?.outcome?.action || 'unknown.action',
      status:
        step?.status === 'error' || step?.status === 'failed'
          ? 'failed'
          : step?.status === 'fallback'
            ? 'completed'
            : step?.status === 'skipped'
              ? 'blocked'
              : 'completed',
      params: step?.params || {},
      result: step?.outcome?.result || step?.result || null,
      error: step?.error || step?.outcome?.error || null,
    }));

    const completedSteps = normalizedSteps.filter((step) => step.status === 'completed').length;
    const failedStep = normalizedSteps.find((step) => step.status === 'failed');
    const blockedStep = normalizedSteps.find((step) => step.status === 'blocked');

    let stopPoint = null;
    if (failedStep) {
      stopPoint = {
        reasonCode: 'ACTION_FAILED',
        message: failedStep.error || 'Runtime receipt execution failed.',
        blockedStep: failedStep.step,
        blockedAction: failedStep.action,
        status: 'action-error',
      };
    } else if (blockedStep) {
      stopPoint = {
        reasonCode: 'MISSING_INPUTS',
        message: 'Runtime receipt execution blocked because required inputs are missing.',
        blockedStep: blockedStep.step,
        blockedAction: blockedStep.action,
        status: 'missing-inputs',
      };
    }

    return {
      status: stopPoint ? 'partial' : 'completed',
      completedSteps,
      steps: normalizedSteps,
      stopPoint,
      message,
      assumptions: [],
      plan,
    };
  },

  async selectRuntimeReceipt(ctx, payload = {}) {
    if (payload.disableReceiptSelection === true) {
      return {
        selected: false,
        receiptId: null,
        mode: 'disabled',
        score: null,
        status: null,
        warnings: [],
        diagnostics: null,
        selectedReceipt: null,
        execution: {
          used: false,
          executor: null,
          fallbackReason: 'disabled_by_request',
        },
      };
    }

    try {
      const result = await ctx.call(
        'agent-receipts.select',
        {
          message: payload.message || '',
          context: payload.context || {},
          input: payload.input || {},
          forceReceipt: payload.forceReceipt,
          preferredReceipts: Array.isArray(payload.preferredReceipts)
            ? payload.preferredReceipts
            : [],
          allowDraftReceipts: payload.allowDraftReceipts === true,
          explainReceiptSelection: payload.explainReceiptSelection === true,
          disableReceiptSelection: false,
          includeEvaluation: true,
        },
        { meta: { ...ctx.meta, $gateway: false } }
      );

      const data =
        result && typeof result === 'object' && result.data && typeof result.data === 'object'
          ? result.data
          : result;

      let selectedReceipt =
        data?.selectedReceipt && typeof data.selectedReceipt === 'object'
          ? data.selectedReceipt
          : null;

      if (
        !selectedReceipt &&
        data?.selected === true &&
        typeof data?.receiptId === 'string' &&
        data.receiptId.trim().length > 0
      ) {
        try {
          const fetched = await ctx.call(
            'agent-receipts.get',
            {
              id: data.receiptId.trim(),
              includeArchived: false,
            },
            { meta: { ...ctx.meta, $gateway: false } }
          );
          const fetchedData =
            fetched &&
            typeof fetched === 'object' &&
            fetched.data &&
            typeof fetched.data === 'object'
              ? fetched.data
              : fetched;
          if (fetchedData && typeof fetchedData === 'object') {
            selectedReceipt = fetchedData;
          }
        } catch (fetchError) {
          this.logger?.warn?.(
            `Runtime receipt selected but not hydrated (${data.receiptId}): ${fetchError.message}`
          );
        }
      }

      return {
        selected: Boolean(data?.selected),
        receiptId: typeof data?.receiptId === 'string' ? data.receiptId : null,
        mode: typeof data?.mode === 'string' ? data.mode : data?.selected ? 'matched' : 'none',
        score: typeof data?.score === 'number' ? data.score : null,
        status: typeof data?.status === 'string' ? data.status : null,
        warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        diagnostics:
          data?.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : null,
        selectedReceipt,
        evaluation:
          data?.evaluation && typeof data.evaluation === 'object'
            ? {
                executable: data.evaluation.executable === true,
                matchScore:
                  typeof data.evaluation.matchScore === 'number'
                    ? data.evaluation.matchScore
                    : null,
                plannedToolCalls: Array.isArray(data.evaluation.plannedToolCalls)
                  ? data.evaluation.plannedToolCalls
                  : [],
              }
            : null,
        execution: {
          used: false,
          executor: null,
          fallbackReason: null,
        },
        knowledgeEvidence:
          data?.evaluation && typeof data.evaluation === 'object'
            ? {
                status:
                  typeof data.evaluation.knowledgeEvidenceStatus === 'string'
                    ? data.evaluation.knowledgeEvidenceStatus
                    : null,
                required: data.evaluation.knowledgeEvidenceRequired === true,
                hits: Array.isArray(data.evaluation.knowledgeEvidence)
                  ? data.evaluation.knowledgeEvidence
                  : [],
                trace:
                  data.evaluation.knowledgeEvidenceTrace &&
                  typeof data.evaluation.knowledgeEvidenceTrace === 'object'
                    ? data.evaluation.knowledgeEvidenceTrace
                    : { queryCount: 0, queries: [] },
              }
            : null,
      };
    } catch (error) {
      if (isActionUnavailable(error) || isNotFound(error)) {
        if (typeof payload.forceReceipt === 'string' && payload.forceReceipt.trim().length > 0) {
          throw new MoleculerClientError(
            'Forced runtime receipt cannot be resolved because agent-receipts service is unavailable.',
            422,
            'RECEIPT_SELECTION_UNAVAILABLE',
            {
              forceReceipt: payload.forceReceipt,
            }
          );
        }

        return {
          selected: false,
          receiptId: null,
          mode: 'unavailable',
          score: null,
          status: null,
          warnings: [],
          diagnostics: null,
          selectedReceipt: null,
          execution: {
            used: false,
            executor: null,
            fallbackReason: 'selection_service_unavailable',
          },
        };
      }
      throw error;
    }
  },

  buildReceiptSelectionMetadata(selection = null, { includeDiagnostics = false } = {}) {
    if (!includeDiagnostics || !selection || typeof selection !== 'object') {
      return null;
    }

    return {
      receiptSelection: pruneUndefinedDeep({
        mode: selection.mode || 'none',
        selected: Boolean(selection.selected),
        receiptId: selection.receiptId || null,
        status: selection.status || null,
        score: typeof selection.score === 'number' ? selection.score : null,
        warnings: Array.isArray(selection.warnings) ? selection.warnings : [],
        diagnostics:
          selection.diagnostics && typeof selection.diagnostics === 'object'
            ? selection.diagnostics
            : null,
        execution:
          selection.execution && typeof selection.execution === 'object'
            ? {
                used: selection.execution.used === true,
                executor: selection.execution.executor || null,
                fallbackReason: selection.execution.fallbackReason || null,
                plannedToolCalls: Array.isArray(selection.execution.plannedToolCalls)
                  ? selection.execution.plannedToolCalls
                  : [],
                executedToolCalls: Array.isArray(selection.execution.executedToolCalls)
                  ? selection.execution.executedToolCalls
                  : [],
              }
            : null,
        knowledgeEvidence:
          selection.knowledgeEvidence && typeof selection.knowledgeEvidence === 'object'
            ? {
                status: selection.knowledgeEvidence.status || null,
                required: selection.knowledgeEvidence.required === true,
                hitCount: Array.isArray(selection.knowledgeEvidence.hits)
                  ? selection.knowledgeEvidence.hits.length
                  : 0,
              }
            : null,
      }),
    };
  },

  attachKnowledgeHintsToKnownContext(knownContext = {}, knowledgeContext = null) {
    const enriched = { ...(knownContext || {}) };
    if (!knowledgeContext) {
      return enriched;
    }

    enriched._knowledgeHints = {
      domainHint: knowledgeContext.domainHint || null,
      regulatoryFrame: knowledgeContext.regulatoryFrame || null,
      synthesisStyle: knowledgeContext.synthesisStyle || null,
    };
    return enriched;
  },

  buildQualitySummary({ evidencePlan = null, execution = null, consultation = null } = {}) {
    const confidence =
      evidencePlan && typeof evidencePlan.confidence === 'number' ? evidencePlan.confidence : null;
    const gapCount = Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps.length : 0;
    const consultationFactCount = Array.isArray(consultation?.factsUsed)
      ? consultation.factsUsed.length
      : 0;

    const groundednessScore =
      confidence !== null
        ? Number(Math.max(0, Math.min(1, confidence)).toFixed(2))
        : consultationFactCount > 0
          ? 0.6
          : 0.3;

    const uncertaintyReasons = [];
    if (gapCount > 0) {
      uncertaintyReasons.push('missing_evidence');
    }
    if (execution?.status === 'partial') {
      uncertaintyReasons.push('partial_execution');
    }
    if (consultation && consultationFactCount === 0) {
      uncertaintyReasons.push('low_consultation_evidence');
    }

    const uncertaintyScore = Number(
      Math.max(0, Math.min(1, 1 - groundednessScore + (gapCount > 0 ? 0.15 : 0))).toFixed(2)
    );

    return {
      groundedness: {
        score: groundednessScore,
        basis: confidence !== null ? 'evidence_plan' : 'consultation_facts',
        confidence: confidence,
      },
      uncertainty: {
        score: uncertaintyScore,
        reasons: uncertaintyReasons,
        requiresHITL: uncertaintyReasons.includes('missing_evidence') || uncertaintyScore >= 0.6,
      },
    };
  },

  getHandoffPersonaIdFromWorkflowAuditTrail(item = null) {
    const trail = Array.isArray(item?.workflowAuditTrail) ? item.workflowAuditTrail : [];
    if (trail.length === 0) {
      return null;
    }
    for (let i = trail.length - 1; i >= 0; i -= 1) {
      const entry = trail[i];
      if (!entry || entry.action !== 'workflow_completed') {
        continue;
      }
      const handoffPersonaId =
        typeof entry.handoffPersonaId === 'string' ? entry.handoffPersonaId.trim() : '';
      if (handoffPersonaId) {
        return handoffPersonaId;
      }
    }
    return null;
  },

  async getPersonaHandoffSnapshotContext(ctx, hitlItemId) {
    const normalizedHitlItemId =
      typeof hitlItemId === 'string' && hitlItemId.trim() ? hitlItemId.trim() : null;
    if (!normalizedHitlItemId) {
      return {
        workflowCompletionState: null,
        handoffPersonaId: null,
      };
    }

    const item = await this.getHitlItem(ctx, normalizedHitlItemId);
    if (!item) {
      return {
        workflowCompletionState: null,
        handoffPersonaId: null,
      };
    }

    const workflowCompletionStateRaw =
      typeof item.workflowCompletionState === 'string' ? item.workflowCompletionState.trim() : '';
    const workflowCompletionState = workflowCompletionStateRaw || null;

    const explicitHandoffPersonaId =
      typeof item.handoffPersonaId === 'string' ? item.handoffPersonaId.trim() : '';
    const handoffPersonaId =
      explicitHandoffPersonaId || this.getHandoffPersonaIdFromWorkflowAuditTrail(item) || null;

    return {
      workflowCompletionState,
      handoffPersonaId,
    };
  },

  async resolvePersonaForTrace(ctx, snapshot) {
    const { tenantId } = snapshot;
    if (!tenantId) {
      return { resolved: false, reason: 'no_tenant' };
    }
    try {
      const result = await ctx.call('agent-persona.resolvePersona', snapshot, {
        meta: { ...ctx.meta, $gateway: false },
        timeout: 1500,
      });
      if (result?.success && result?.resolvedPersona) {
        const handoffApplied = result.resolvedPersona.resolutionMode === 'handoff';
        return {
          resolved: true,
          ...result.resolvedPersona,
          auditEventId:
            typeof result.auditEventId === 'string' && result.auditEventId.trim()
              ? result.auditEventId.trim()
              : null,
          handoffApplied,
          appliedHandoffPersonaId:
            handoffApplied && typeof result.resolvedPersona.personaId === 'string'
              ? result.resolvedPersona.personaId
              : null,
        };
      }
      return { resolved: false, reason: 'no_match' };
    } catch (err) {
      const isUnavailable =
        err?.type === 'SERVICE_NOT_FOUND' ||
        err?.type === 'SERVICE_NOT_AVAILABLE' ||
        err?.code === 'SERVICE_NOT_FOUND';
      const isTimeout = err?.type === 'REQUEST_TIMEOUT' || /timeout/i.test(err?.message || '');
      if (isTimeout) return { resolved: false, reason: 'timeout' };
      if (isUnavailable) return { resolved: false, reason: 'service_unavailable' };
      return { resolved: false, reason: 'error' };
    }
  },

  resolveBootstrapContext({ session = {}, knownContext = {} } = {}) {
    const existingRaw =
      session?.l3?.bootstrapContext && typeof session.l3.bootstrapContext === 'object'
        ? session.l3.bootstrapContext
        : null;
    const existing = sanitizeBootstrapContext(existingRaw);

    // Extract explicit organizationType from knownContext (root level or nested bootstrapContext)
    const explicitRootOrganizationType =
      typeof knownContext?.organizationType === 'string' ? knownContext.organizationType : null;
    const explicitBootstrap =
      knownContext?.bootstrapContext && typeof knownContext.bootstrapContext === 'object'
        ? knownContext.bootstrapContext
        : null;
    const explicitOrganizationType =
      typeof explicitBootstrap?.organizationType === 'string'
        ? explicitBootstrap.organizationType
        : explicitRootOrganizationType;

    const candidateForOrgType = sanitizeBootstrapContext({
      status: 'unknown',
      organizationType: explicitOrganizationType,
      source: 'knownContext',
      updatedAt: new Date().toISOString(),
    });
    const hasExplicitOrganizationType = candidateForOrgType.organizationType !== 'unknown';

    if (hasExplicitOrganizationType) {
      // established ONLY if explicitly set to 'established' in knownContext.bootstrapContext.status
      // and it passes sanitization — never derived from organizationType alone
      const rawExplicitStatus = String(explicitBootstrap?.status || '')
        .trim()
        .toLowerCase();
      const status = rawExplicitStatus === 'established' ? 'established' : 'partial';

      return sanitizeBootstrapContext({
        status,
        organizationType: candidateForOrgType.organizationType,
        source: 'knownContext',
        updatedAt: new Date().toISOString(),
      });
    }

    // No explicit organizationType: carry forward existing sanitized context
    return sanitizeBootstrapContext({
      status: existing.status,
      organizationType: existing.organizationType,
      source: existing.source || 'default',
      updatedAt: new Date().toISOString(),
    });
  },

  buildBootstrapTraceContext(bootstrapContext = null) {
    return sanitizeBootstrapContext(bootstrapContext);
  },
};
