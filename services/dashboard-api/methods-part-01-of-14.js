'use strict';

// dashboard-api methods chunk 1/14 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: maybeAttachMakoKnowledge, buildReceiptGroundingSyntheticDomain, buildReceiptGroundingFollowUps, cacheGet, cacheSet, cacheGetOrFetch, safeCall, buildIdentity, buildKpis, buildAgentSummary, _summariseMq, _summariseGc, _summariseEs, _summariseRd, buildSpotPrice, buildCo2

module.exports = {
  async maybeAttachMakoKnowledge(ctx, enabled, query) {
    if (!enabled || !query) return null;
    try {
      const result = await ctx.call('willi-mako.resolveStructure', { query, limit: 3 });
      if (!result || result.success === false) {
        return {
          available: false,
          error: result?.error?.code || 'MAKO_KNOWLEDGE_UNAVAILABLE',
        };
      }
      return { available: true, ...result.data };
    } catch (_err) {
      process.stderr.write(
        `[methods-part-01-of-14] silent-catch-fallback (line 19): ${_err && _err.message}\n`
      );
      return { available: false, error: 'MAKO_KNOWLEDGE_UNAVAILABLE' };
    }
  },

  buildReceiptGroundingSyntheticDomain(params = {}) {
    switch (params.domainShape) {
      case 'vdmi_matrix':
        return {
          matrix: {
            tasks: [
              {
                taskName: 'Synthetic VDMI grounding check',
                verantwortlich: ['DSO_GATEKEEPER'],
                durchfuehrend: ['TECHNICAL_PLANNER'],
                mitwirkend: [],
                information: [],
              },
            ],
          },
        };
      case 'kpi_fact':
        return {
          label: 'Synthetic KPI grounding check',
          value: 1,
          unit: 'evidence item',
          source: params.sourceAction || 'synthetic-inspect',
        };
      case 'evidence_gap':
        return {
          evidenceGaps: [
            {
              id: params.evidenceGapId || 'missing_source_action',
              label: params.evidenceGapId || 'Missing source action',
            },
          ],
        };
      case 'decision_brief':
        return {
          decisionStatus: 'blocked_until_evidence_arrives',
          forbiddenAssumptions: ['Renderer cannot outrank executed evidence.'],
        };
      default:
        return params.query ? { note: String(params.query).slice(0, 160) } : {};
    }
  },

  buildReceiptGroundingFollowUps(grounding = {}) {
    const followUps = [];
    if (Array.isArray(grounding.sourceActions) && grounding.sourceActions.length === 0) {
      followUps.push({
        missingDataPoint: 'missingSourceAction',
        enablesDossierAddition:
          'Add the executed domain action so the renderer can be tied to tool evidence.',
      });
    }
    if (grounding?.basis?.hasDomainResult === false) {
      followUps.push({
        missingDataPoint: 'missingDomainResultShape',
        enablesDossierAddition:
          'Provide the structured domain result fields required by the requested renderer.',
      });
    }
    for (const gapId of grounding.evidenceGapIds || []) {
      followUps.push({
        missingDataPoint: gapId,
        enablesDossierAddition:
          'Resolve this evidence gap to allow a stronger grounded presentation.',
      });
    }
    if (grounding.blockedReason) {
      followUps.push({
        missingDataPoint: 'rendererMismatch',
        enablesDossierAddition:
          'Use the grounded fallback now; enable the richer renderer once matching evidence is present.',
      });
    }
    return followUps;
  },

  cacheGet(key) {
    if (!this.cache.has(key)) return null;
    const entry = this.cache.get(key);
    if (Date.now() < entry.expiresAt) return entry.data;
    this.cache.delete(key);
    return null;
  },

  cacheSet(key, value, ttlMs) {
    this.cache.set(key, { data: value, expiresAt: Date.now() + ttlMs });
  },

  async cacheGetOrFetch(key, ttlMs, fetchFn) {
    const cached = this.cacheGet(key);
    if (cached) return cached;

    if (this.inflight.has(key)) {
      return this.inflight.get(key);
    }

    const promise = fetchFn()
      .then((result) => {
        this.cacheSet(key, result, ttlMs);
        this.inflight.delete(key);
        return result;
      })
      .catch((err) => {
        this.inflight.delete(key);
        throw err;
      });

    this.inflight.set(key, promise);
    return promise;
  },

  async safeCall(ctx, action, params, fallback = null, errors = [], label = null) {
    try {
      return await ctx.call(action, params);
    } catch (err) {
      const name = label || action;
      this.logger.warn(`dashboard-api: ${name} failed — ${err.message}`);
      if (errors) errors.push(name);
      return fallback;
    }
  },

  buildIdentity(identityData, bdewCode) {
    if (!identityData) return { bdew: bdewCode, name: null, mastrId: null, bnr: null };
    const hit = identityData.results?.[0] || identityData;
    return {
      name: hit.name || hit.providerName || null,
      mastrId: hit.mastrId || hit.mastrSnbId || null,
      bdew: hit.bdew || hit.bdewCode || bdewCode,
      bnr: hit.bnr || hit.bnrCode || null,
    };
  },

  buildKpis(vnbMonitor, health, mqAudits, rdCount) {
    // vnb-monitor.snapshot actual structure (v0.9.6+):
    //   mastr.inBetrieb.anlagenCount   — total installed units
    //   mastr.inBetrieb.leistungMW     — total capacity (string, e.g. '145.2')
    //   ewk.anschlussdauer.eeNS_weeks  — avg. connection duration EE/NS (weeks)
    //   ewk.digitalisierungsindex.gesamt_percent — overall digitalisation score
    //   ewk.umsetzungsquote.eeNS_percent         — EE/NS implementation rate (%)
    const mastr = vnbMonitor?.mastr || {};
    const ewk = vnbMonitor?.ewk || {};
    const dp = health?.overview || health || {};

    const latestMqScore = mqAudits?.audits?.[0]?.qualityScore ?? null;

    return {
      totalInstallations: mastr.inBetrieb?.anlagenCount ?? null,
      totalCapacityMW: mastr.inBetrieb ? Number(mastr.inBetrieb.leistungMW) || null : null,
      // Populated by assets.redispatchCount (v0.20.2, RES-IR-0001 Option b).
      // null when assets service is unavailable (safeCall fallback).
      redispatchEligible: rdCount?.count ?? null,
      redispatchCapacityMW: rdCount?.totalCapacityMW ?? null,
      ewkAnschlussdauerWeeks: ewk.anschlussdauer?.eeNS_weeks ?? null,
      ewkDigitalisierungsScore: ewk.digitalisierungsindex?.gesamt_percent ?? null,
      ewkUmsetzungsquote: ewk.umsetzungsquote?.eeNS_percent ?? null,
      mastrQualityScore: latestMqScore,
      datapointsHealthy: dp.healthy ?? null,
      datapointsStale: dp.stale ?? null,
      datapointsErrored: dp.errored ?? null,
    };
  },

  buildAgentSummary(mqAudits, gcValidations, esValidations, rdAudits) {
    return {
      mastrQuality: this._summariseMq(mqAudits?.audits?.[0]),
      gridConnection: this._summariseGc(gcValidations?.validations?.[0]),
      energySharing: this._summariseEs(esValidations?.validations?.[0]),
      redispatch: this._summariseRd(rdAudits?.audits?.[0]),
    };
  },

  _summariseMq(audit) {
    if (!audit) return null;
    return {
      id: audit.id,
      executedAt: audit.createdAt,
      qualityScore: audit.qualityScore,
      findingsCount: audit.findingsCount || null,
    };
  },

  _summariseGc(report) {
    if (!report) return null;
    return {
      id: report.id,
      executedAt: report.createdAt,
      decision: report.decision,
      findingsCount: report.findingsCount || null,
    };
  },

  _summariseEs(report) {
    if (!report) return null;
    return {
      id: report.id,
      executedAt: report.createdAt,
      decision: report.decision,
      findingsCount: report.findingsCount || null,
    };
  },

  _summariseRd(audit) {
    if (!audit) return null;
    return {
      id: audit.id,
      executedAt: audit.createdAt,
      settlementReadinessPercent: audit.settlementReadiness?.readinessPercent ?? null,
      riskLevel: audit.riskAssessment?.level ?? null,
      findingsCount: audit.findingsCount || null,
    };
  },

  buildSpotPrice(pricesData) {
    if (!pricesData) return null;

    // entsoe.dayAheadPrices returns dataPoints[].priceEURperMWh; other sources may use
    // prices[].price or prices[].priceEURMWh — handle all known shapes.
    const points = pricesData.dataPoints || pricesData.prices || pricesData.data || [];
    if (!points.length) return null;

    const values = points
      .map((p) => p.priceEURperMWh ?? p.priceEURMWh ?? p.price ?? p.value ?? p.priceEur)
      .filter((v) => v != null);
    if (!values.length) return null;

    // Prefer pre-computed statistics when available (entsoe response includes them)
    const stats = pricesData.statistics || {};
    const avg = stats.avgPrice ?? values.reduce((a, b) => a + b, 0) / values.length;
    const min = stats.minPrice ?? Math.min(...values);
    const max = stats.maxPrice ?? Math.max(...values);
    const current = values[values.length - 1];
    const trend = current > avg * 1.05 ? 'rising' : current < avg * 0.95 ? 'falling' : 'stable';

    return {
      current: Math.round(current * 100) / 100,
      avgToday: Math.round(avg * 100) / 100,
      minToday: Math.round(min * 100) / 100,
      maxToday: Math.round(max * 100) / 100,
      trend,
      source: 'entsoe',
    };
  },

  buildCo2(co2Data, location) {
    if (!co2Data) return null;
    // energy-market.co2Intensity returns co2_intensity_gco2eq_kwh (MCP field name);
    // nested .data sub-object is also checked for forward-compat.
    const current =
      co2Data.co2_intensity_gco2eq_kwh ??
      co2Data.data?.co2_intensity_gco2eq_kwh ??
      co2Data.current ??
      co2Data.co2Intensity ??
      co2Data.value ??
      null;
    if (current == null) return null;

    const signal = current < 300 ? 'green' : current < 450 ? 'yellow' : 'red';

    return {
      current: Math.round(current),
      avgToday:
        co2Data.average_today_gco2eq_kwh ??
        co2Data.data?.average_today_gco2eq_kwh ??
        co2Data.avgToday ??
        co2Data.average ??
        null,
      signal,
      location: co2Data.data?.location || co2Data.location || location,
    };
  },
};
