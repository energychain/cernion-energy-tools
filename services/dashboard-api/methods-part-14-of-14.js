'use strict';

// dashboard-api methods chunk 14/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildEvidenceConfidenceBasis, buildEvidenceGroundingClaims, buildEvidenceGroundingAssumptions, buildEvidenceGroundingSourceActions, buildRedispatchCallQualityGate, deriveRedispatchCallGateStatus, pickRedispatchCallLeadingSignal, buildRedispatchCallNextActions, validationHasUsableEvidence, computeRedispatchMeteringScore, deriveRedispatchMeteringSignal, isOlderThanDays, daysSince

module.exports = {
  buildEvidenceConfidenceBasis({
    answerStatus,
    hasScope,
    requiresNetworkOperatorConfirmation,
    toolFailures,
    sourceClassBreakdown,
  }) {
    const basis = [`answerStatus=${answerStatus}`];
    if (!hasScope) basis.push('missing scope filter');
    if (requiresNetworkOperatorConfirmation) basis.push('operator confirmation missing');
    if (toolFailures.length > 0) basis.push('tool failure present');
    if ((sourceClassBreakdown.authoritative_registry || 0) > 0) {
      basis.push('authoritative registry/operator evidence present');
    }
    if ((sourceClassBreakdown.datapoint_health || 0) > 0) basis.push('datapoint health present');
    if ((sourceClassBreakdown.rag_chunk || 0) > 0) basis.push('RAG source refs present');
    return basis;
  },

  buildEvidenceGroundingClaims({ params, ragItems, sourceClassBreakdown }) {
    const claims = [];
    if (params.sourceAction || params.capabilityId) {
      claims.push({
        claim:
          params.sourceAction ||
          `Capability ${params.capabilityId} is the requested grounding context`,
        sourceRef: params.sourceAction || params.capabilityId,
        sourceClass: 'internal_process_evidence',
        confidenceBasis: 'explicit request parameter',
      });
    }
    for (const item of ragItems.slice(0, 3)) {
      claims.push({
        claim: item.title || 'RAG source available for answer grounding',
        sourceRef: item.sourceId,
        sourceClass: 'rag_chunk',
        confidenceBasis: `retrieval confidence ${item.confidence}`,
      });
    }
    if ((sourceClassBreakdown.datapoint_health || 0) > 0) {
      claims.push({
        claim: 'Datapoint health can be considered for freshness/completeness.',
        sourceRef: params.datapointId || 'datapoint.health',
        sourceClass: 'datapoint_health',
        confidenceBasis: 'read-only datapoint health surface',
      });
    }
    return claims;
  },

  buildEvidenceGroundingAssumptions({ params, hasScope, requiresNetworkOperatorConfirmation }) {
    const assumptions = [];
    if (params.query) {
      assumptions.push({
        assumption: 'User prompt is treated as preview context, not authoritative evidence.',
        sourceRef: 'query',
      });
    }
    if (!hasScope) {
      assumptions.push({
        assumption:
          'No local scope filter was supplied; answer must remain bounded as preliminary.',
        sourceRef: 'scope_filter_grid_area',
      });
    }
    if (requiresNetworkOperatorConfirmation) {
      assumptions.push({
        assumption:
          'Network-operator confirmation is missing; fachliche confidence remains capped.',
        sourceRef: 'network_operator_confirmation',
      });
    }
    return assumptions;
  },

  buildEvidenceGroundingSourceActions({
    routingRes,
    datapointRes,
    vdmiRes,
    ragRes,
    params,
    errors,
  }) {
    const failed = new Set(errors || []);
    return {
      'capability-broker.recommend': {
        success: !!routingRes,
        skipped: !params.query,
        failed: failed.has('capability-broker.recommend'),
        capability: routingRes?.capability || null,
        confidence:
          routingRes?.confidence ?? routingRes?.recommendedCapabilities?.[0]?.confidence ?? null,
      },
      'knowledge-rag.query': {
        success: !!ragRes,
        skipped: !params.query,
        failed: failed.has('knowledge-rag.query'),
        sources: this.extractRagEvidenceItems(ragRes).length,
      },
      'datapoint.health': {
        success: !!datapointRes,
        failed: failed.has('datapoint.health'),
        overview: datapointRes?.overview || null,
      },
      'vdmi.findings': {
        success: !!vdmiRes,
        failed: failed.has('vdmi.findings'),
        findings: Array.isArray(vdmiRes?.findings) ? vdmiRes.findings.length : 0,
      },
    };
  },

  buildRedispatchCallQualityGate({
    params,
    rdLatest,
    datapointOverview,
    validationSummary,
    validationFindings,
    forecastQuality,
    vdmiFindings,
    sourceActions,
    errors,
    hasTimeseriesContext,
  }) {
    const missingDataPoints = [];
    const openEvidence = [];
    const monitoringTasks = [];

    const addMissing = (
      missingDataPoint,
      enablesDossierAddition,
      category,
      severity = 'medium'
    ) => {
      const item = { missingDataPoint, enablesDossierAddition, category, severity };
      missingDataPoints.push(item);
      openEvidence.push(item);
      monitoringTasks.push({
        task: `Clarify ${missingDataPoint}`,
        source: category,
        severity,
        recommendedAction: enablesDossierAddition,
      });
    };

    if (!params.gridOperatorId) {
      addMissing(
        'masterDataProcessSignal',
        'Stammdatenmerkmal und Prozessabsprung koennen dem Abruffall belastbar zugeordnet werden',
        'masterData',
        'high'
      );
    }
    if (!params.meloId && !params.maloId && !params.assetId) {
      addMissing(
        'meloMaloMapping',
        'Messlokation/Marktlokation koennen in die Datenqualitaetskette aufgenommen werden',
        'metering',
        'high'
      );
    }
    if (!hasTimeseriesContext) {
      addMissing(
        'loadProfileCompleteness',
        'Nullwerte und Lastgangluecken koennen vor Clearing/Abrechnung bewertet werden',
        'metering',
        'high'
      );
      addMissing(
        'forecastQuality',
        'Prognoseluecken koennen als Klaeraufgabe statt als Abrechnungsfreigabe erscheinen',
        'forecast',
        'medium'
      );
    }

    const readinessPercent = rdLatest?.settlementReadiness?.readinessPercent;
    const rdRisk = String(rdLatest?.riskAssessment?.level || '').toLowerCase();
    const validationQuality = validationSummary?.dataQuality;
    const validationErrors = validationFindings.filter((f) => f?.severity === 'error').length;
    const validationWarnings = validationFindings.filter((f) => f?.severity === 'warning').length;
    const forecastRating = String(forecastQuality?.rating || '').toLowerCase();
    const criticalGovernance = vdmiFindings.filter((f) => {
      const severity = String(f?.severity || '').toUpperCase();
      const code = String(f?.code || '').toUpperCase();
      return severity === 'H' || severity === 'K' || code.startsWith('VD_GOV_');
    });

    if (!rdLatest) {
      addMissing(
        'controlEvidence',
        'Kontrollnachweis zum Abruf kann in die Evidenzkette aufgenommen werden',
        'controlEvidence',
        'high'
      );
    }
    if (criticalGovernance.length > 0) {
      addMissing(
        'monitoringOwner',
        'Verantwortliche Rolle und naechster Klaerschritt koennen im Dossier genannt werden',
        'monitoring',
        'high'
      );
    }
    if (
      hasTimeseriesContext &&
      !this.validationHasUsableEvidence(validationSummary, validationFindings)
    ) {
      addMissing(
        'loadProfileCompleteness',
        'Nullwerte und Lastgangluecken koennen vor Clearing/Abrechnung bewertet werden',
        'metering',
        'high'
      );
    }
    if (forecastRating === 'poor' || forecastRating === 'fair') {
      addMissing(
        'forecastQuality',
        'Prognoseluecken koennen als Klaeraufgabe statt als Abrechnungsfreigabe erscheinen',
        'forecast',
        forecastRating === 'poor' ? 'high' : 'medium'
      );
    }

    const masterDataReadiness = {
      status: params.gridOperatorId && rdLatest ? 'available' : 'missing_evidence',
      processSignal: params.gridOperatorId || null,
      source: 'redispatch-expost.list',
    };
    const meteringSignal =
      !hasTimeseriesContext || validationErrors > 0
        ? 'red'
        : validationWarnings > 0 ||
            (typeof validationQuality === 'number' && validationQuality < 0.95) ||
            (datapointOverview?.stale ?? 0) > 0
          ? 'yellow'
          : 'green';
    const meteringReadiness = {
      status: meteringSignal === 'green' ? 'ready' : 'needs_clarification',
      signal: meteringSignal,
      dataQuality: typeof validationQuality === 'number' ? validationQuality : null,
      validationErrors,
      validationWarnings,
      datapointOverview,
    };
    const forecastReadiness = {
      status:
        forecastRating === 'excellent' || forecastRating === 'good'
          ? 'ready'
          : forecastRating
            ? 'needs_clarification'
            : 'missing_evidence',
      rating: forecastQuality?.rating || null,
      mape: forecastQuality?.mape ?? null,
    };
    const controlEvidenceReadiness = {
      status: rdLatest ? 'available' : 'missing_evidence',
      auditId: rdLatest?.id || null,
      criticalGovernanceFindings: criticalGovernance.length,
    };
    const settlementReadiness = {
      status:
        typeof readinessPercent === 'number' && readinessPercent >= 80 && rdRisk !== 'high'
          ? 'candidate_ready'
          : 'not_ready',
      readinessPercent: typeof readinessPercent === 'number' ? readinessPercent : null,
      riskLevel: rdRisk || null,
      billingRelease: false,
    };

    const gateStatus = this.deriveRedispatchCallGateStatus({
      missingDataPoints,
      masterDataReadiness,
      meteringReadiness,
      forecastReadiness,
      controlEvidenceReadiness,
      settlementReadiness,
      errors,
    });
    const leadingProcessSignal = this.pickRedispatchCallLeadingSignal({
      gateStatus,
      missingDataPoints,
      sourceActions,
    });
    const nextActions = this.buildRedispatchCallNextActions(gateStatus, missingDataPoints);

    return {
      found: true,
      gateStatus,
      callContext: {
        gridOperatorId: params.gridOperatorId || null,
        meloId: params.meloId || null,
        maloId: params.maloId || null,
        assetId: params.assetId || null,
        from: params.from || null,
        to: params.to || null,
        auditId: params.auditId || rdLatest?.id || null,
      },
      masterDataReadiness,
      meteringReadiness,
      forecastReadiness,
      controlEvidenceReadiness,
      settlementReadiness,
      leadingProcessSignal,
      openEvidence,
      monitoringTasks,
      sourceActions,
      nextActions,
      missingDataPoints,
    };
  },

  deriveRedispatchCallGateStatus({
    missingDataPoints,
    meteringReadiness,
    forecastReadiness,
    controlEvidenceReadiness,
    settlementReadiness,
    errors,
  }) {
    if ((errors || []).length > 0) return 'blocked_for_billing';
    const has = (name) => missingDataPoints.some((m) => m.missingDataPoint === name);
    if (has('masterDataProcessSignal') || has('meloMaloMapping')) return 'needs_master_data_fix';
    if (has('loadProfileCompleteness') || meteringReadiness.signal === 'red') {
      return 'needs_metering_clarification';
    }
    if (has('forecastQuality') || forecastReadiness.status === 'needs_clarification') {
      return 'needs_forecast_clarification';
    }
    if (has('controlEvidence') || controlEvidenceReadiness.status !== 'available') {
      return 'needs_control_evidence';
    }
    if (has('monitoringOwner')) return 'needs_monitoring_owner';
    if (settlementReadiness.status === 'candidate_ready') return 'ready_for_settlement';
    return 'blocked_for_billing';
  },

  pickRedispatchCallLeadingSignal({ gateStatus, missingDataPoints, sourceActions }) {
    const firstMissing = missingDataPoints[0] || null;
    return {
      status: gateStatus,
      category: firstMissing?.category || 'settlement',
      blocker: firstMissing?.missingDataPoint || null,
      source:
        firstMissing?.category === 'metering'
          ? 'edm-validation.validate'
          : firstMissing?.category === 'forecast'
            ? 'forecast-engine.evaluateQuality'
            : firstMissing?.category === 'monitoring'
              ? 'vdmi.findings'
              : firstMissing?.category === 'controlEvidence'
                ? 'redispatch-expost.list'
                : sourceActions?.['redispatch-expost.list']?.selectedAuditId
                  ? 'redispatch-expost.list'
                  : 'dashboard-api.redispatchCallQualityGate',
    };
  },

  buildRedispatchCallNextActions(gateStatus, missingDataPoints) {
    if (!missingDataPoints.length && gateStatus === 'ready_for_settlement') {
      return [
        {
          action: 'review_settlement_candidate',
          label: 'Abrechnungsnahe Evidenz pruefen; keine automatische Freigabe in diesem Gate.',
        },
      ];
    }
    return missingDataPoints.map((item) => ({
      action: `clarify_${item.missingDataPoint}`,
      label: item.enablesDossierAddition,
      category: item.category,
      consequential: false,
    }));
  },

  validationHasUsableEvidence(validationSummary, validationFindings) {
    if (validationSummary && typeof validationSummary === 'object') return true;
    return Array.isArray(validationFindings) && validationFindings.length > 0;
  },

  computeRedispatchMeteringScore({ rdLatest, mqLatest, dpOverview, openCriticalFindings }) {
    const parts = [];

    const redispatchReadiness = rdLatest?.settlementReadiness?.readinessPercent;
    if (typeof redispatchReadiness === 'number') {
      parts.push(Math.max(0, Math.min(100, redispatchReadiness)));
    }

    const qualityScore = mqLatest?.qualityScore;
    if (typeof qualityScore === 'number') {
      parts.push(Math.max(0, Math.min(100, qualityScore)));
    }

    const healthy = dpOverview?.healthy;
    const stale = dpOverview?.stale;
    const errored = dpOverview?.errored;
    const total = [healthy, stale, errored].every((v) => typeof v === 'number')
      ? healthy + stale + errored
      : null;
    if (total && total > 0) {
      const datapointScore = ((healthy - errored) / total) * 100;
      parts.push(Math.max(0, Math.min(100, datapointScore)));
    }

    if (Array.isArray(openCriticalFindings)) {
      const governanceScore =
        openCriticalFindings.length === 0
          ? 100
          : Math.max(0, 60 - openCriticalFindings.length * 10);
      parts.push(governanceScore);
    }

    if (!parts.length) return null;
    const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
    return Math.round(avg * 10) / 10;
  },

  deriveRedispatchMeteringSignal({ score, blockingEvidenceGaps }) {
    const hasHighBlocker = (blockingEvidenceGaps || []).some((b) => b?.severity === 'high');
    if (hasHighBlocker) return 'red';
    if ((blockingEvidenceGaps || []).length > 0) return 'yellow';
    if (score == null) return 'yellow';
    if (score < 60) return 'red';
    if (score < 80) return 'yellow';
    return 'green';
  },

  isOlderThanDays(isoDate, days) {
    if (!isoDate) return false;
    const ts = Date.parse(isoDate);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts > days * 24 * 60 * 60 * 1000;
  },

  daysSince(isoDate) {
    if (!isoDate) return null;
    const ts = Date.parse(isoDate);
    if (!Number.isFinite(ts)) return null;
    return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  },
};
