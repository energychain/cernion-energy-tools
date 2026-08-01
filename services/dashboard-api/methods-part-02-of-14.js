'use strict';

// dashboard-api methods chunk 2/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: buildForecast, buildAgentEntry, buildVdmiAgentEntry, buildVdmiBusinessKpis, computeMedian, buildObservabilityMiniCards, buildRedispatchMeteringBlockers, buildRedispatchMeteringStaleData, buildLoadProfileAnomalyBuckets, buildLoadProfileRestrictionRefs, deriveLoadProfileStreamStatus, buildLoadProfileDecisionNotes, filterFindingsForContext, buildRedispatchCallQualitySourceActions, buildEvidenceGroundingConfidenceAudit, buildMarketCommunicationEvidenceChainStatus

module.exports = {
  buildForecast(forecastData) {
    if (!forecastData) return null;
    const solar = forecastData.solar || forecastData.solarForecast || [];
    const wind = forecastData.wind || forecastData.windForecast || [];

    const solarPeakMW = solar.length ? Math.max(...solar.map((p) => p.value ?? p.mw ?? 0)) : null;
    const windPeakMW = wind.length ? Math.max(...wind.map((p) => p.value ?? p.mw ?? 0)) : null;

    // Find combined peak timestamp
    let combinedPeakAt = null;
    if (solar.length && wind.length) {
      const solarPeak = solar.reduce((a, b) => ((a.value ?? 0) > (b.value ?? 0) ? a : b));
      combinedPeakAt = solarPeak.timestamp || solarPeak.time || null;
    }

    return { solarPeakMW, windPeakMW, combinedPeakAt };
  },

  buildAgentEntry(type, label, reports, metricKey) {
    if (!reports || !reports.length) {
      return {
        type,
        label,
        lastRun: null,
        keyMetric: null,
        findingsCount: null,
        recentReports: [],
      };
    }
    const latest = reports[0];
    const metricValue = latest[metricKey] ?? null;
    return {
      type,
      label,
      lastRun: latest.createdAt || null,
      keyMetric: metricValue != null ? { name: metricKey, value: metricValue } : null,
      findingsCount: latest.findingsCount || null,
      recentReports: reports.map((r) => ({
        id: r.id,
        executedAt: r.createdAt,
        [metricKey]: r[metricKey] ?? null,
      })),
    };
  },

  buildVdmiAgentEntry(matrices, findings) {
    const matrixList = Array.isArray(matrices) ? matrices : [];
    const findingList = Array.isArray(findings) ? findings : [];
    const latest = matrixList[0] || null;
    const openCriticalFindings = findingList.filter(
      (f) => f.status === 'open' && (f.severity === 'H' || f.severity === 'K')
    ).length;

    return {
      type: 'vdmi',
      label: 'VDMI Governance Matrix',
      lastRun: latest?.updatedAt || latest?.createdAt || null,
      keyMetric: {
        name: 'openCriticalFindings',
        value: openCriticalFindings,
      },
      findingsCount: {
        info: findingList.filter((f) => f.severity === 'L').length,
        warning: findingList.filter((f) => f.severity === 'M').length,
        error: findingList.filter((f) => f.severity === 'H' || f.severity === 'K').length,
      },
      recentReports: matrixList.map((m) => ({
        id: m.id,
        executedAt: m.updatedAt || m.createdAt || null,
        nominationStatus: m.nominationStatus || null,
        detectionConfidence: m.detectionConfidence ?? null,
      })),
    };
  },

  buildVdmiBusinessKpis(findings, matrices) {
    const findingList = Array.isArray(findings) ? findings : [];
    const matrixList = Array.isArray(matrices) ? matrices : [];

    const shadowRelevant = findingList.filter(
      (f) => typeof f.code === 'string' && /^(VD_SHADOW_|VD_SILO_)/.test(f.code)
    );
    const shadowResolved = shadowRelevant.filter((f) => f.status === 'resolved').length;
    const shadowRate =
      shadowRelevant.length > 0
        ? Number(((shadowResolved / shadowRelevant.length) * 100).toFixed(2))
        : null;

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const currentStart = now - 30 * DAY_MS;
    const previousStart = now - 60 * DAY_MS;

    const escalationFindings = findingList.filter(
      (f) => typeof f.code === 'string' && /^VD_GOV_/.test(f.code)
    );
    const currentEscalations = escalationFindings.filter((f) => {
      const ts = Date.parse(f.updatedAt || f.createdAt || '');
      return Number.isFinite(ts) && ts >= currentStart && ts < now;
    }).length;
    const previousEscalations = escalationFindings.filter((f) => {
      const ts = Date.parse(f.updatedAt || f.createdAt || '');
      return Number.isFinite(ts) && ts >= previousStart && ts < currentStart;
    }).length;
    const escalationReductionRate =
      previousEscalations > 0
        ? Number(
            (((previousEscalations - currentEscalations) / previousEscalations) * 100).toFixed(2)
          )
        : null;

    const fnavConfirmed = matrixList.filter(
      (m) =>
        m.processType === 'fnav-contract-negotiation' &&
        m.nominationStatus === 'confirmed' &&
        m.createdAt &&
        m.updatedAt
    );

    const currentDurations = fnavConfirmed
      .filter((m) => {
        const ts = Date.parse(m.updatedAt || '');
        return Number.isFinite(ts) && ts >= currentStart && ts < now;
      })
      .map((m) => {
        const createdAt = Date.parse(m.createdAt || '');
        const updatedAt = Date.parse(m.updatedAt || '');
        return Number.isFinite(createdAt) && Number.isFinite(updatedAt)
          ? (updatedAt - createdAt) / DAY_MS
          : null;
      })
      .filter((v) => v != null);

    const previousDurations = fnavConfirmed
      .filter((m) => {
        const ts = Date.parse(m.updatedAt || '');
        return Number.isFinite(ts) && ts >= previousStart && ts < currentStart;
      })
      .map((m) => {
        const createdAt = Date.parse(m.createdAt || '');
        const updatedAt = Date.parse(m.updatedAt || '');
        return Number.isFinite(createdAt) && Number.isFinite(updatedAt)
          ? (updatedAt - createdAt) / DAY_MS
          : null;
      })
      .filter((v) => v != null);

    const currentMedian = this.computeMedian(currentDurations);
    const previousMedian = this.computeMedian(previousDurations);
    const fnavGainDays =
      previousMedian != null && currentMedian != null
        ? Number((previousMedian - currentMedian).toFixed(2))
        : null;

    return {
      vdmi_shadow_path_resolution_rate: shadowRate,
      vdmi_n1_escalation_reduction_rate: escalationReductionRate,
      vdmi_fnav_time_to_decision_gain_days: fnavGainDays,
    };
  },

  computeMedian(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
  },

  buildObservabilityMiniCards(summary) {
    if (!summary) {
      return {
        health: { status: 'unknown', signal: null },
        incidents: { errorCount: null, signal: null },
        performance: { p95DurationMs: null, slowCallCount: null, signal: null },
      };
    }

    const errorCount = summary.metrics?.overview?.errorCount ?? 0;
    const p95DurationMs = summary.metrics?.overview?.p95DurationMs ?? null;
    const slowCallCount = summary.metrics?.overview?.slowCallCount ?? 0;
    const status = errorCount > 0 ? 'degraded' : 'healthy';

    return {
      health: { status, signal: status === 'healthy' ? 'green' : 'yellow' },
      incidents: {
        errorCount,
        signal: errorCount === 0 ? 'green' : errorCount < 5 ? 'yellow' : 'red',
      },
      performance: {
        p95DurationMs,
        slowCallCount,
        signal: slowCallCount === 0 ? 'green' : slowCallCount < 10 ? 'yellow' : 'red',
      },
    };
  },

  buildRedispatchMeteringBlockers({
    resolvedGridOperatorId,
    rdLatest,
    allocLatest,
    mqLatest,
    dpOverview,
    openCriticalFindings,
  }) {
    const blockers = [];

    if (!resolvedGridOperatorId) {
      blockers.push({
        code: 'MISSING_OPERATOR_CONTEXT',
        severity: 'high',
        source: 'operator-context',
        message: 'Kein eindeutiger Netzbetreiber-Kontext (gridOperatorId/BDEW) verfügbar.',
      });
    }

    if (!rdLatest) {
      blockers.push({
        code: 'REDISPATCH_EVIDENCE_MISSING',
        severity: 'high',
        source: 'redispatch-expost.list',
        message: 'Keine Redispatch-Ex-Post-Auswertung vorhanden.',
      });
    }

    const readinessPercent = rdLatest?.settlementReadiness?.readinessPercent;
    if (readinessPercent != null && readinessPercent < 70) {
      blockers.push({
        code: 'REDISPATCH_READINESS_LOW',
        severity: 'high',
        source: 'redispatch-expost.list',
        message: `Settlement-Readiness ist kritisch niedrig (${readinessPercent}%).`,
      });
    }

    const rdRisk = String(rdLatest?.riskAssessment?.level || '').toLowerCase();
    if (rdRisk === 'high' || rdRisk === 'critical') {
      blockers.push({
        code: 'REDISPATCH_RISK_HIGH',
        severity: 'high',
        source: 'redispatch-expost.list',
        message: `Redispatch-Risiko ist ${rdRisk}.`,
      });
    }

    if (!mqLatest) {
      blockers.push({
        code: 'MASTERDATA_EVIDENCE_MISSING',
        severity: 'high',
        source: 'mastr-quality.list',
        message: 'Keine MaStR-Qualitätsauswertung vorhanden.',
      });
    }

    const qualityScore = mqLatest?.qualityScore;
    if (qualityScore != null && qualityScore < 70) {
      blockers.push({
        code: 'MASTERDATA_QUALITY_LOW',
        severity: 'medium',
        source: 'mastr-quality.list',
        message: `MaStR-Qualität ist niedrig (${qualityScore}).`,
      });
    }

    if (
      !allocLatest &&
      dpOverview?.healthy == null &&
      dpOverview?.stale == null &&
      dpOverview?.errored == null
    ) {
      blockers.push({
        code: 'METERING_EVIDENCE_MISSING',
        severity: 'high',
        source: 'energy-sharing-allocation.list/datapoint.health',
        message: 'Keine belastbare Metering-Evidenz verfügbar.',
      });
    }

    if ((dpOverview?.errored ?? 0) > 0) {
      blockers.push({
        code: 'METERING_DATAPOINT_ERRORS',
        severity: 'high',
        source: 'datapoint.health',
        message: `${dpOverview.errored} Datapoints im Fehlerzustand.`,
      });
    }

    if ((dpOverview?.stale ?? 0) > 0) {
      blockers.push({
        code: 'METERING_DATAPOINT_STALE',
        severity: 'medium',
        source: 'datapoint.health',
        message: `${dpOverview.stale} Datapoints sind stale.`,
      });
    }

    if ((openCriticalFindings || []).length > 0) {
      blockers.push({
        code: 'VDMI_OPEN_CRITICAL',
        severity: 'high',
        source: 'vdmi.findings',
        message: `${openCriticalFindings.length} offene kritische VDMI-Findings.`,
      });
    }

    return blockers;
  },

  buildRedispatchMeteringStaleData({ rdLatest, allocLatest, mqLatest, dpOverview }) {
    const stale = [];

    if ((dpOverview?.stale ?? 0) > 0) {
      stale.push({
        source: 'datapoint.health',
        indicator: 'staleDatapoints',
        value: dpOverview.stale,
      });
    }

    if (this.isOlderThanDays(rdLatest?.createdAt, 30)) {
      stale.push({
        source: 'redispatch-expost.list',
        indicator: 'lastAuditAgeDays',
        value: this.daysSince(rdLatest?.createdAt),
      });
    }

    if (this.isOlderThanDays(allocLatest?.createdAt, 30)) {
      stale.push({
        source: 'energy-sharing-allocation.list',
        indicator: 'lastAllocationAgeDays',
        value: this.daysSince(allocLatest?.createdAt),
      });
    }

    if (this.isOlderThanDays(mqLatest?.createdAt, 30)) {
      stale.push({
        source: 'mastr-quality.list',
        indicator: 'lastAuditAgeDays',
        value: this.daysSince(mqLatest?.createdAt),
      });
    }

    return stale;
  },

  buildLoadProfileAnomalyBuckets(validationFindings, vdmiFindings, forecastQuality) {
    const findings = Array.isArray(validationFindings) ? validationFindings : [];
    const governance = Array.isArray(vdmiFindings) ? vdmiFindings : [];

    const dataQualityGapRules = new Set(['GAP_DETECTION', 'DUPLICATE_CHECK', 'MONOTONY_CHECK']);
    const realAnomalyRules = new Set(['BANDWIDTH_CHECK', 'NEGATIVE_VALUE_CHECK']);
    const forecastProblemRules = new Set(['SLP_PLAUSIBILITY']);

    const dataQualityGap = findings
      .filter((f) => dataQualityGapRules.has(String(f?.ruleId || '')))
      .map((f) => ({
        class: 'dataQualityGap',
        source: 'edm-validation.validate',
        ref: f.ruleId,
        severity: f.severity || null,
        timestamp: f.timestamp || null,
        message: f.message || null,
      }));

    const realAnomaly = findings
      .filter((f) => realAnomalyRules.has(String(f?.ruleId || '')))
      .map((f) => ({
        class: 'realAnomaly',
        source: 'edm-validation.validate',
        ref: f.ruleId,
        severity: f.severity || null,
        timestamp: f.timestamp || null,
        value: f.value != null ? f.value : null,
        message: f.message || null,
      }));

    const forecastProblem = findings
      .filter((f) => forecastProblemRules.has(String(f?.ruleId || '')))
      .map((f) => ({
        class: 'forecastProblem',
        source: 'edm-validation.validate',
        ref: f.ruleId,
        severity: f.severity || null,
        timestamp: f.timestamp || null,
        message: f.message || null,
      }));

    if (forecastQuality && ['poor', 'fair'].includes(String(forecastQuality.rating || ''))) {
      forecastProblem.push({
        class: 'forecastProblem',
        source: 'forecast-engine.evaluateQuality',
        ref: 'FORECAST_QUALITY',
        severity: forecastQuality.rating === 'poor' ? 'error' : 'warning',
        timestamp: null,
        message: `Forecast quality rated as ${forecastQuality.rating} (MAPE=${forecastQuality.mape}).`,
      });
    }

    const processGovernanceBreak = governance
      .filter((f) => {
        const severity = String(f?.severity || '').toUpperCase();
        const code = String(f?.code || '').toUpperCase();
        return severity === 'H' || severity === 'K' || code.startsWith('VD_GOV_');
      })
      .map((f) => ({
        class: 'processGovernanceBreak',
        source: 'vdmi.findings',
        ref: f.code || null,
        severity: f.severity || null,
        timestamp: f.updatedAt || f.createdAt || null,
        message: f.title || f.reason || null,
        findingId: f.id || null,
      }));

    return {
      dataQualityGap,
      realAnomaly,
      forecastProblem,
      processGovernanceBreak,
    };
  },

  buildLoadProfileRestrictionRefs(anomalySignals = {}) {
    const refs = [];
    const buckets = [
      ...(Array.isArray(anomalySignals.dataQualityGap) ? anomalySignals.dataQualityGap : []),
      ...(Array.isArray(anomalySignals.realAnomaly) ? anomalySignals.realAnomaly : []),
      ...(Array.isArray(anomalySignals.forecastProblem) ? anomalySignals.forecastProblem : []),
      ...(Array.isArray(anomalySignals.processGovernanceBreak)
        ? anomalySignals.processGovernanceBreak
        : []),
    ];

    for (const item of buckets) {
      if (!item?.ref) continue;
      refs.push({
        ref: item.ref,
        source: item.source || null,
        class: item.class || null,
        severity: item.severity || null,
      });
    }

    return refs;
  },

  deriveLoadProfileStreamStatus({
    qualitySummary,
    anomalySignals,
    hasPartialData,
    forecastQuality,
  }) {
    const dataQualityGap = (anomalySignals?.dataQualityGap || []).length;
    const realAnomaly = (anomalySignals?.realAnomaly || []).length;
    const forecastProblem = (anomalySignals?.forecastProblem || []).length;
    const governanceBreak = (anomalySignals?.processGovernanceBreak || []).length;

    const dataQuality = qualitySummary?.dataQuality;
    const rating = String(forecastQuality?.rating || '').toLowerCase();

    let signal = 'green';
    if (
      governanceBreak > 0 ||
      realAnomaly > 0 ||
      (typeof dataQuality === 'number' && dataQuality < 0.85) ||
      rating === 'poor'
    ) {
      signal = 'red';
    } else if (dataQualityGap > 0 || forecastProblem > 0 || hasPartialData || rating === 'fair') {
      signal = 'yellow';
    }

    return {
      signal,
      partial: !!hasPartialData,
      classification: {
        dataQualityGap,
        realAnomaly,
        forecastProblem,
        processGovernanceBreak: governanceBreak,
      },
      dataQuality: typeof dataQuality === 'number' ? dataQuality : null,
    };
  },

  buildLoadProfileDecisionNotes({
    streamStatus,
    anomalySignals,
    qualitySummary,
    forecastQuality,
    hasPartialData,
  }) {
    const notes = [];

    if (hasPartialData) {
      notes.push(
        'Partial findings active: mindestens eine Quelle ist nicht verfügbar, vorhandene Evidenz wurde dennoch ausgewertet.'
      );
    }

    if ((anomalySignals?.processGovernanceBreak || []).length > 0) {
      notes.push(
        'Process-governance break erkannt: offene kritische VDMI-Findings vor operativer Entscheidung schließen.'
      );
    }

    if ((anomalySignals?.dataQualityGap || []).length > 0) {
      notes.push(
        'Data-quality gap erkannt: Lücken/Dubletten/Monotonieabweichungen vor Prognosefreigabe bereinigen.'
      );
    }

    if ((anomalySignals?.realAnomaly || []).length > 0) {
      notes.push(
        'Real anomaly signal erkannt: Messwertausreißer/Negativwerte gegen Zähler- und Anlagenzustand verifizieren.'
      );
    }

    if ((anomalySignals?.forecastProblem || []).length > 0) {
      notes.push(
        'Forecast problem signal erkannt: SLP-/Forecast-Parameter und Vergleichsfenster nachkalibrieren.'
      );
    }

    if (qualitySummary && typeof qualitySummary.dataQuality === 'number') {
      notes.push(
        `Gemessene Datenqualität im Zeitraum: ${(qualitySummary.dataQuality * 100).toFixed(1)}%.`
      );
    }

    if (forecastQuality?.rating) {
      notes.push(`Forecast-Qualität: ${forecastQuality.rating} (MAPE=${forecastQuality.mape}).`);
    }

    if (notes.length === 0) {
      notes.push('Keine relevanten Auffälligkeiten erkannt; Stream aktuell unauffällig.');
    }

    notes.push(`Gesamtstatus: ${streamStatus?.signal || 'unknown'}.`);
    return notes;
  },

  filterFindingsForContext(findings, { gridOperatorId, meloId, maloId, assetId } = {}) {
    const list = Array.isArray(findings) ? findings : [];
    const requested = { gridOperatorId, meloId, maloId, assetId };
    return list.filter((finding) => {
      for (const [key, value] of Object.entries(requested)) {
        if (!value) continue;
        const candidates = [
          finding?.[key],
          finding?.context?.[key],
          finding?.asset?.[key],
          finding?.gridOperatorMastrId,
          finding?.operatorId,
        ].filter((v) => v != null);
        if (candidates.length > 0 && !candidates.some((v) => String(v) === String(value))) {
          return false;
        }
      }
      return true;
    });
  },

  buildRedispatchCallQualitySourceActions({
    rdRes,
    datapointRes,
    validationRes,
    forecastRes,
    vdmiRes,
    hasTimeseriesContext,
    rdLatest,
    validationFindings,
    vdmiFindings,
  }) {
    return {
      'redispatch-expost.list': {
        success: !!rdRes,
        audits: Array.isArray(rdRes?.audits) ? rdRes.audits.length : 0,
        selectedAuditId: rdLatest?.id || null,
      },
      'datapoint.health': {
        success: !!datapointRes,
        overview: datapointRes?.overview || null,
      },
      'edm-validation.validate': {
        success: !!validationRes,
        skipped: !hasTimeseriesContext,
        findings: validationFindings.length,
        dataQuality: validationRes?.summary?.dataQuality ?? null,
      },
      'forecast-engine.evaluateQuality': {
        success: !!forecastRes,
        skipped: !hasTimeseriesContext,
        rating: forecastRes?.quality?.rating || null,
      },
      'vdmi.findings': {
        success: !!vdmiRes,
        findings: vdmiFindings.length,
      },
    };
  },

  buildEvidenceGroundingConfidenceAudit({
    params,
    routingRes,
    datapointRes,
    vdmiRes,
    ragRes,
    errors,
  }) {
    const now = new Date().toISOString();
    const hasScope = !!(
      params.scopeId ||
      params.gridOperatorId ||
      params.datasourceId ||
      params.datapointId
    );
    const hasDomainContext = !!(
      params.domain ||
      params.capabilityId ||
      params.sourceAction ||
      params.query
    );
    const toolFailures = (errors || []).map((action) => ({
      action,
      impact: 'evidence_confidence_degraded',
    }));
    const ragItems = this.extractRagEvidenceItems(ragRes);
    const sourceClassBreakdown = this.buildEvidenceSourceClassBreakdown({
      params,
      ragItems,
      datapointRes,
      vdmiRes,
    });
    const missingEvidence = this.buildEvidenceGroundingMissingEvidence({
      params,
      hasScope,
      hasDomainContext,
      toolFailures,
      ragItems,
    });
    const requiresNetworkOperatorConfirmation =
      !params.networkOperatorConfirmed && this.requiresOperatorConfirmation(params);
    const scopeLimitations = [];
    if (!hasScope) {
      scopeLimitations.push({
        scopeFilter: 'grid_or_datasource_scope',
        reason: 'No gridOperatorId, scopeId, datasourceId or datapointId was supplied.',
      });
    }

    const routingScore = this.normalizeConfidenceScore(
      routingRes?.confidence ??
        routingRes?.recommendedCapabilities?.[0]?.confidence ??
        (params.capabilityId || params.sourceAction ? 0.72 : params.query ? 0.62 : 0.35)
    );
    const answerStatus = this.deriveEvidenceGroundingAnswerStatus({
      params,
      hasScope,
      hasDomainContext,
      toolFailures,
      requiresNetworkOperatorConfirmation,
    });
    const evidenceScore = this.deriveEvidenceConfidenceScore({
      answerStatus,
      hasScope,
      requiresNetworkOperatorConfirmation,
      sourceClassBreakdown,
      toolFailures,
    });
    const evidenceConfidence = {
      score: evidenceScore,
      level: evidenceScore >= 0.75 ? 'high' : evidenceScore >= 0.5 ? 'medium' : 'low',
      basis: this.buildEvidenceConfidenceBasis({
        answerStatus,
        hasScope,
        requiresNetworkOperatorConfirmation,
        toolFailures,
        sourceClassBreakdown,
      }),
    };
    const claims = this.buildEvidenceGroundingClaims({ params, ragItems, sourceClassBreakdown });
    const assumptions = this.buildEvidenceGroundingAssumptions({
      params,
      hasScope,
      requiresNetworkOperatorConfirmation,
    });
    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: item.category,
    }));
    const sourceActions = this.buildEvidenceGroundingSourceActions({
      routingRes,
      datapointRes,
      vdmiRes,
      ragRes,
      params,
      errors,
    });
    const requestContext = {
      requestId: params.requestId || null,
      sessionId: params.sessionId || null,
      query: params.query || null,
      domain: params.domain || null,
      capabilityId: params.capabilityId || routingRes?.capability || null,
      sourceAction: params.sourceAction || routingRes?.recommendedPlan?.[0]?.action || null,
      scopeId: params.scopeId || null,
      gridOperatorId: params.gridOperatorId || null,
      datasourceId: params.datasourceId || null,
      datapointId: params.datapointId || null,
    };
    const dossierEvidence = {
      answerStatus,
      routingConfidence: {
        score: routingScore,
        capability: routingRes?.capability || params.capabilityId || null,
        preferredAction: routingRes?.recommendedPlan?.[0]?.action || params.sourceAction || null,
      },
      evidenceConfidence,
      sourceClassBreakdown,
      missingEvidence,
      positiveFollowUps,
    };

    return {
      auditId: params.requestId
        ? `egca:${params.requestId}`
        : `egca:${Buffer.from(
            `${params.domain || 'unknown'}:${params.query || params.sourceAction || now}`
          )
            .toString('base64url')
            .slice(0, 24)}`,
      tenantId: params.tenantId || null,
      requestContext,
      routingConfidence: dossierEvidence.routingConfidence,
      evidenceConfidence,
      answerStatus,
      sourceClassBreakdown,
      scopeFilters: {
        scopeId: params.scopeId || null,
        gridOperatorId: params.gridOperatorId || null,
        datasourceId: params.datasourceId || null,
        datapointId: params.datapointId || null,
      },
      claims,
      assumptions,
      sourceActions,
      sourceDatapoints: params.datapointId ? [{ datapointId: params.datapointId }] : [],
      ragCollections: ragItems.map((item) => item.collection).filter(Boolean),
      datasourceHealth: datapointRes?.overview || datapointRes || null,
      toolFailures,
      scopeLimitations,
      missingEvidence,
      requiresNetworkOperatorConfirmation,
      hitlItemIds: [],
      vdmiProcessId: null,
      positiveFollowUps,
      validationFindings: missingEvidence.map((item) => ({
        code: `EGCA_${String(item.missingDataPoint || 'missing').toUpperCase()}`,
        severity: item.severity || 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence,
    };
  },

  buildMarketCommunicationEvidenceChainStatus(params = {}) {
    const officialSpecs = [
      {
        id: 'malo_identity',
        label: 'MaLo identity',
        value: params.maloId,
        sourceClass: 'official_market_location',
        enablesDossierAddition: 'bind the dossier to the official market location',
      },
      {
        id: 'melo_identity',
        label: 'MeLo identity',
        value: params.meloId,
        sourceClass: 'official_meter_location',
        enablesDossierAddition: 'bind the dossier to the official meter location',
      },
      {
        id: 'utilmd_masterdata_path',
        label: 'UTILMD/master-data path',
        value: params.utilmdMasterdataPath,
        sourceClass: 'official_market_communication',
        enablesDossierAddition: 'replace portal hints with official master-data provenance',
      },
      {
        id: 'meter_values',
        label: 'Meter values',
        value: params.meterValueBatchId,
        sourceClass: 'metering_evidence',
        enablesDossierAddition: 'add consumption-period meter-value evidence',
      },
      {
        id: 'consumption_retrieval',
        label: 'Consumption retrieval status',
        value: params.consumptionRetrievalStatus,
        sourceClass: 'edm_retrieval_evidence',
        enablesDossierAddition: 'add EDM retrieval-status statement',
      },
      {
        id: 'data_quality_status',
        label: 'Data-quality status',
        value: params.dataQualityStatus,
        sourceClass: 'edm_quality_evidence',
        enablesDossierAddition: 'add billing-readiness confidence',
      },
      {
        id: 'next_billing_step',
        label: 'Next billing step',
        value: params.nextBillingStep,
        sourceClass: 'settlement_context',
        enablesDossierAddition:
          'add next settlement or billing action context without releasing billing',
      },
    ];
    const officialEvidence = officialSpecs
      .filter((spec) => spec.value != null && spec.value !== '')
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: spec.sourceClass,
        bindingStrength: 'official_evidence',
      }));
    const missingEvidence = officialSpecs
      .filter((spec) => spec.value == null || spec.value === '')
      .map((spec) => ({
        missingDataPoint: spec.id,
        label: spec.label,
        sourceClass: spec.sourceClass,
        enablesDossierAddition: spec.enablesDossierAddition,
      }));
    const hintSpecs = [
      {
        id: 'portal_screenshot',
        label: 'Portal screenshot or portal view',
        value: params.portalHint,
      },
      { id: 'provider_view', label: 'Service-provider view', value: params.providerView },
      {
        id: 'customer_statement',
        label: 'Customer or supplier statement',
        value: params.customerStatement,
      },
    ];
    const hintsOnly = (params.includeHints ? hintSpecs : [])
      .filter((spec) => spec.value != null && spec.value !== '')
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        value: spec.value,
        sourceClass: 'hint_only',
        bindingStrength: 'not_official_proof',
      }));
    const status =
      officialEvidence.length === officialSpecs.length
        ? 'official_evidence_complete'
        : officialEvidence.length === 0 && hintsOnly.length > 0
          ? 'hints_only'
          : 'needs_official_evidence';
    const dossierFacts = [
      `Status: ${status}`,
      `Official evidence items: ${officialEvidence.length}/${officialSpecs.length}`,
    ];
    if (hintsOnly.length > 0) {
      dossierFacts.push('Portal/provider/customer material is classified as hint only.');
    }
    if (params.maloId) dossierFacts.push(`MaLo: ${params.maloId}`);
    if (params.meloId) dossierFacts.push(`MeLo: ${params.meloId}`);

    const positiveFollowUps = missingEvidence.map((item) => ({
      missingDataPoint: item.missingDataPoint,
      enablesDossierAddition: item.enablesDossierAddition,
      category: 'official_market_communication_evidence',
    }));

    return {
      chainId: `mako-ec:${Buffer.from(
        `${params.caseId || ''}:${params.maloId || ''}:${params.meloId || ''}:${params.contractAccountId || ''}`
      )
        .toString('base64url')
        .slice(0, 24)}`,
      safety: 'read_only',
      requestContext: {
        maloId: params.maloId || null,
        meloId: params.meloId || null,
        contractAccountId: params.contractAccountId || null,
        caseId: params.caseId || null,
      },
      status,
      officialEvidence,
      hintsOnly,
      missingEvidence,
      positiveFollowUps,
      dossierFacts,
      sourceActions: {
        inspected: ['dashboard-api.marketCommunicationEvidenceChainStatus'],
        notCalled: ['settlement.exportA96', 'settlement.prepareBilling', 'hitl.create'],
      },
      validationFindings: missingEvidence.map((item) => ({
        code: `MAKO_EVIDENCE_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: 'medium',
        message: item.enablesDossierAddition,
      })),
      dossierEvidence: {
        status,
        officialEvidence,
        hintsOnly,
        missingEvidence,
        positiveFollowUps,
        dossierFacts,
      },
    };
  },
};
