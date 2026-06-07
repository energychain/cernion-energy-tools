'use strict';

const { runCalculation } = require('../src/eeg-clawback-calculator');
const { resolveRuleSet } = require('../src/rcs-rule-registry');
const { computeReadiness } = require('../src/rcs-readiness');
const { runAsync } = require('../src/async-job-runner');
const jobStore = require('../src/job-store');
const { MoleculerClientError } = require('moleculer').Errors;

// ── Normalise raw upstream responses ─────────────────────────────────────────

function normaliseAsset(raw) {
  return {
    technology: raw.technology ?? raw.tech,
    capacityKw: raw.capacityKw ?? raw.capacity_kw ?? raw.capacityKW,
    awCentsPerKwh: raw.awCentsPerKwh ?? raw.aw_cents_per_kwh ?? raw.anzulegenderWertCentsKwh,
    commissioningDate:
      raw.commissioningDate ?? raw.commissioning_date ?? raw.inbetriebnahmedatum,
  };
}

function normaliseSeries(raw) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
}

// ── Rule-arm summary ─────────────────────────────────────────────────────────

function computeRuleArmSummary(intervals) {
  const summary = {};
  for (const iv of intervals ?? []) {
    const arm = iv.ruleArm ?? 'none';
    if (!summary[arm]) summary[arm] = { count: 0, totalClawbackEur: 0, totalVolumeKwh: 0 };
    summary[arm].count += 1;
    summary[arm].totalClawbackEur =
      Math.round((summary[arm].totalClawbackEur + (iv.clawbackAmountEur ?? 0)) * 10000) / 10000;
    summary[arm].totalVolumeKwh =
      Math.round((summary[arm].totalVolumeKwh + (iv.injectionKwh ?? 0)) * 10000) / 10000;
  }
  return summary;
}

function aggregatePortfolioRuleArmSummary(assetResults) {
  const summary = {};
  for (const r of assetResults) {
    if (r.status !== 'success' || !r.ruleArmSummary) continue;
    for (const [arm, data] of Object.entries(r.ruleArmSummary)) {
      if (!summary[arm]) summary[arm] = { count: 0, totalClawbackEur: 0, totalVolumeKwh: 0 };
      summary[arm].count += data.count;
      summary[arm].totalClawbackEur =
        Math.round((summary[arm].totalClawbackEur + data.totalClawbackEur) * 10000) / 10000;
      summary[arm].totalVolumeKwh =
        Math.round((summary[arm].totalVolumeKwh + data.totalVolumeKwh) * 10000) / 10000;
    }
  }
  return summary;
}

// ── TraceMode resolution ──────────────────────────────────────────────────────

function resolveTraceMode(opts) {
  if (opts.traceMode) return opts.traceMode;
  if (opts.includeIntervalTrace === false) return 'none';
  if (opts.includeIntervalTrace === true) return 'full';
  return 'none'; // safe default for portfolio — bandwidth-heavy payloads must be opt-in
}

// ── Portfolio aggregation helpers ─────────────────────────────────────────────

function aggregatePortfolioSummary(assetResults) {
  const successful = assetResults.filter((r) => r.status === 'success');
  const failed = assetResults.filter((r) => r.status === 'error');
  const skipped = assetResults.filter((r) => r.status === 'skipped');

  let totalBaselineCents = 0;
  let totalClawbackCents = 0;
  let totalRetainedCents = 0;

  for (const r of successful) {
    totalBaselineCents += r.summary.calculatedUnderOldLaw.totalRevenueCents ?? 0;
    totalClawbackCents +=
      r.summary.calculatedUnderNewLaw.totalRefinancingContributionCents ?? 0;
    totalRetainedCents += r.summary.calculatedUnderNewLaw.retainedRevenueCents ?? 0;
  }

  const totalDeltaCents = totalRetainedCents - totalBaselineCents;
  const riskRatio = totalBaselineCents > 0 ? totalRetainedCents / totalBaselineCents : 1;
  let liquidityRiskIndex = 'low';
  if (riskRatio < 0.7) liquidityRiskIndex = 'high';
  else if (riskRatio < 0.9) liquidityRiskIndex = 'medium';

  return {
    assetCount: assetResults.length,
    successfulAssets: successful.length,
    failedAssets: failed.length,
    skippedAssets: skipped.length,
    totalBaselineAmountEur: Math.round(totalBaselineCents) / 100,
    totalClawbackAmountEur: Math.round(totalClawbackCents) / 100,
    totalRetainedAmountEur: Math.round(totalRetainedCents) / 100,
    totalDeltaEur: Math.round(totalDeltaCents) / 100,
    liquidityRiskIndex,
  };
}

function groupByTechnology(assetResults) {
  const byTech = {};
  for (const r of assetResults.filter((r) => r.status === 'success')) {
    const tech = r.technology ?? 'unknown';
    if (!byTech[tech]) {
      byTech[tech] = {
        technology: tech,
        assetCount: 0,
        totalBaselineAmountEur: 0,
        totalClawbackAmountEur: 0,
        totalDeltaEur: 0,
      };
    }
    const g = byTech[tech];
    g.assetCount += 1;
    g.totalBaselineAmountEur +=
      (r.summary.calculatedUnderOldLaw.totalRevenueCents ?? 0) / 100;
    g.totalClawbackAmountEur +=
      (r.summary.calculatedUnderNewLaw.totalRefinancingContributionCents ?? 0) / 100;
    g.totalDeltaEur += (r.summary.deltaCents ?? 0) / 100;
  }
  return Object.values(byTech).sort((a, b) => b.assetCount - a.assetCount);
}

function groupByReadiness(assetResults) {
  const counts = { ready: 0, partial: 0, not_ready: 0, unknown: 0 };
  for (const r of assetResults) {
    const status = r.readinessStatus ?? 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));
}

function topAssetsByDelta(assetResults, n = 5) {
  return assetResults
    .filter((r) => r.status === 'success')
    .sort((a, b) => (b.summary.deltaCents ?? 0) - (a.summary.deltaCents ?? 0))
    .slice(0, n)
    .map((r) => ({
      assetId: r.assetId,
      assetName: r.assetName,
      technology: r.technology,
      deltaEur: (r.summary.deltaCents ?? 0) / 100,
      liquidityRiskIndex: r.summary.liquidityRiskIndex,
    }));
}

function topAssetsByClawback(assetResults, n = 5) {
  return assetResults
    .filter((r) => r.status === 'success')
    .sort(
      (a, b) =>
        (b.summary?.calculatedUnderNewLaw?.totalRefinancingContributionCents ?? 0) -
        (a.summary?.calculatedUnderNewLaw?.totalRefinancingContributionCents ?? 0)
    )
    .slice(0, n)
    .map((r) => ({
      assetId: r.assetId,
      assetName: r.assetName,
      technology: r.technology,
      clawbackAmountEur:
        (r.summary.calculatedUnderNewLaw.totalRefinancingContributionCents ?? 0) / 100,
    }));
}

function topAssetsByDataRisk(assetResults, n = 5) {
  return assetResults
    .filter(
      (r) =>
        r.status === 'error' ||
        r.readinessStatus === 'not_ready' ||
        r.readinessStatus === 'partial'
    )
    .slice(0, n)
    .map((r) => ({
      assetId: r.assetId,
      status: r.status,
      readinessStatus: r.readinessStatus ?? null,
      message: r.message ?? null,
    }));
}

// ── Core portfolio simulation (shared between sync and async paths) ────────────

async function runPortfolioSimulationCore(ctx, { assetIds, timeframe, opts, ruleSet }, jobId) {
  const continueOnError = opts.continueOnAssetError !== false;
  const chunkSize = Math.max(1, opts.chunkSize ?? 20);
  const maxIntervalsPerAsset = opts.maxIntervalsPerAsset ?? null;
  const traceMode = resolveTraceMode(opts);
  const traceAssetIds = opts.traceAssetIds ? new Set(opts.traceAssetIds) : null;
  const topNTrace = opts.topNTraceByDelta ?? null;
  const traceSampleSize = opts.traceSampleSize ?? 10;

  if (traceMode === 'full' && !traceAssetIds && assetIds.length > 50) {
    throw new MoleculerClientError(
      `traceMode 'full' is not allowed for portfolios larger than 50 assets without traceAssetIds. ` +
        `Use traceMode 'summary' or specify traceAssetIds to limit scope.`,
      400,
      'RCS_TRACE_PAYLOAD_TOO_LARGE',
      { assetCount: assetIds.length, maxForFullTrace: 50 }
    );
  }

  jobStore.appendLog(jobId, 'price_fetch', 10, 'Fetching shared price series', { timeframe });
  const pricesRaw = await ctx
    .call('energy-market.prices', {
      start: timeframe.start,
      end: timeframe.end,
      market: 'day-ahead',
      resolution: 'hourly',
    })
    .catch(() => []);
  const prices = normaliseSeries(pricesRaw);

  const allAssetResults = [];
  const totalChunks = Math.ceil(assetIds.length / chunkSize);

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const chunkStart = chunkIdx * chunkSize;
    const chunk = assetIds.slice(chunkStart, chunkStart + chunkSize);
    const chunkPercent = 10 + Math.round(((chunkIdx + 1) / totalChunks) * 70);

    jobStore.appendLog(
      jobId,
      'chunk_processing',
      chunkPercent,
      `Processing chunk ${chunkIdx + 1}/${totalChunks} (${chunk.length} assets)`,
      { chunkIndex: chunkIdx, chunkSize: chunk.length }
    );

    const chunkResults = await Promise.all(
      chunk.map(async (assetId) => {
        try {
          const [assetRaw, injectionRaw] = await Promise.all([
            ctx.call('assets.effective', { assetId }),
            ctx.call('edm.getTimeseries', {
              meloId: assetId,
              from: timeframe.start,
              to: timeframe.end,
              resolution: '15min',
            }),
          ]);

          const asset = normaliseAsset(assetRaw);
          const injection = normaliseSeries(injectionRaw);

          let readinessStatus = null;
          if (opts.includeReadiness) {
            const readiness = computeReadiness(assetRaw, prices, injection, timeframe);
            readinessStatus = readiness.overallStatus;
          }

          // Always compute intervals internally for ruleArmSummary derivation.
          // maxIntervals caps the aligned price+injection grid inside runCalculation.
          const calc = runCalculation(asset, prices, injection, {
            ruleSet,
            includeIntervalTrace: true,
            ...(maxIntervalsPerAsset ? { maxIntervals: maxIntervalsPerAsset } : {}),
          });

          const ruleArmSummary = computeRuleArmSummary(calc.intervals);

          return {
            assetId,
            assetName: assetRaw.name ?? assetRaw.bezeichnung ?? assetId,
            technology: asset.technology,
            status: 'success',
            readinessStatus,
            summary: calc.summary,
            ruleArmSummary,
            _rawIntervals: calc.intervals, // stripped from response in final mapping
          };
        } catch (err) {
          if (!continueOnError) throw err;
          return {
            assetId,
            status: 'error',
            readinessStatus: null,
            errorCode: err.code ?? 'ASSET_ERROR',
            message: err.message ?? 'Unknown error',
            stage: 'simulation',
          };
        }
      })
    );
    allAssetResults.push(...chunkResults);
  }

  jobStore.appendLog(jobId, 'aggregation', 90, 'Computing portfolio summary and rankings', {
    assetCount: allAssetResults.length,
  });

  // Determine which assets receive trace data in the response (post-run ranking)
  let traceEligibleIds;
  if (topNTrace !== null) {
    const sortedByDelta = allAssetResults
      .filter((r) => r.status === 'success')
      .sort((a, b) => (a.summary?.deltaCents ?? 0) - (b.summary?.deltaCents ?? 0))
      .slice(0, topNTrace)
      .map((r) => r.assetId);
    traceEligibleIds = new Set(sortedByDelta);
  } else if (traceAssetIds) {
    traceEligibleIds = traceAssetIds;
  } else {
    traceEligibleIds = new Set(allAssetResults.map((r) => r.assetId));
  }

  const portfolioSummary = aggregatePortfolioSummary(allAssetResults);
  const ruleArmSummary = aggregatePortfolioRuleArmSummary(allAssetResults);
  const errors = allAssetResults.filter((r) => r.status === 'error');

  const assetResultsLimit = opts.assetResultsLimit ?? allAssetResults.length;
  const assetResultsOffset = opts.assetResultsOffset ?? 0;
  const paginatedResults = allAssetResults.slice(
    assetResultsOffset,
    assetResultsOffset + assetResultsLimit
  );
  const hasMoreAssetResults = assetResultsOffset + assetResultsLimit < allAssetResults.length;

  jobStore.appendLog(jobId, 'persist', 100, 'Portfolio simulation complete', {
    successfulAssets: portfolioSummary.successfulAssets,
    failedAssets: portfolioSummary.failedAssets,
  });

  return {
    ruleSetId: ruleSet?.id ?? null,
    ruleSetVersion: ruleSet?.version ?? null,
    legalStatus: ruleSet?.legalStatus ?? null,
    timeframe,
    portfolioSummary,
    ruleArmSummary,
    byTechnology: groupByTechnology(allAssetResults),
    byReadinessStatus: groupByReadiness(allAssetResults),
    topAssetsByDelta: topAssetsByDelta(allAssetResults),
    topAssetsByClawback: topAssetsByClawback(allAssetResults),
    topAssetsByDataRisk: topAssetsByDataRisk(allAssetResults),
    assetResults: paginatedResults.map((r) => {
      let intervals;
      if (r.status === 'success' && traceEligibleIds.has(r.assetId)) {
        if (traceMode === 'full') intervals = r._rawIntervals;
        else if (traceMode === 'sample')
          intervals = (r._rawIntervals ?? []).slice(0, traceSampleSize);
      }
      return {
        assetId: r.assetId,
        assetName: r.assetName ?? r.assetId,
        technology: r.technology ?? null,
        status: r.status,
        readinessStatus: r.readinessStatus ?? null,
        summary: r.summary ?? null,
        ruleArmSummary: r.ruleArmSummary ?? null,
        errorCode: r.errorCode ?? null,
        message: r.message ?? null,
        ...(intervals !== undefined ? { intervals } : {}),
      };
    }),
    hasMoreAssetResults,
    assetResultsTotal: allAssetResults.length,
    assetResultsOffset,
    errorCount: errors.length,
    errors: errors.slice(0, 50),
  };
}

// ── Core portfolio readiness assessment (shared between sync and async paths) ──

async function runPortfolioReadinessCore(ctx, { assetIds, timeframe }, jobId) {
  jobStore.appendLog(jobId, 'price_series', 10, 'Fetching shared price series', { timeframe });
  const pricesRaw = await ctx
    .call('energy-market.prices', {
      start: timeframe.start,
      end: timeframe.end,
      market: 'day-ahead',
      resolution: 'hourly',
    })
    .catch(() => []);
  const prices = normaliseSeries(pricesRaw);

  const total = assetIds.length;
  const assetReports = await Promise.all(
    assetIds.map(async (assetId, idx) => {
      const percent = 20 + Math.round(((idx + 1) / total) * 50);
      jobStore.appendLog(
        jobId,
        'timeseries_check',
        percent,
        `Checking asset ${idx + 1}/${total}: ${assetId}`,
        { assetId }
      );
      const [assetRaw, injectionRaw] = await Promise.all([
        ctx.call('assets.effective', { assetId }).catch(() => null),
        ctx
          .call('edm.getTimeseries', {
            meloId: assetId,
            from: timeframe.start,
            to: timeframe.end,
            resolution: '15min',
          })
          .catch(() => []),
      ]);
      const injection = normaliseSeries(injectionRaw);
      const report = computeReadiness(assetRaw, prices, injection, timeframe);
      return { assetId, ...report };
    })
  );

  jobStore.appendLog(jobId, 'aggregation', 80, 'Computing readiness aggregation');

  const counts = { ready: 0, partial: 0, not_ready: 0 };
  const allIssues = [];
  for (const r of assetReports) {
    counts[r.overallStatus] = (counts[r.overallStatus] ?? 0) + 1;
    for (const src of Object.values(r.sources ?? {})) {
      for (const issue of src.issues ?? []) {
        if (issue.severity === 'error') allIssues.push({ assetId: r.assetId, ...issue });
      }
    }
  }

  const assetCount = assetIds.length;
  const readinessRatio = assetCount > 0 ? counts.ready / assetCount : 0;

  const recMap = {};
  for (const r of assetReports) {
    for (const rec of r.recommendations ?? []) {
      recMap[rec] = (recMap[rec] ?? 0) + 1;
    }
  }
  const commonRecommendations = Object.entries(recMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([rec, count]) => ({ recommendation: rec, affectedAssets: count }));

  let portfolioStatus;
  if (counts.not_ready > 0 || counts.partial > 0) {
    portfolioStatus =
      counts.ready === assetCount ? 'ready' : counts.not_ready > 0 ? 'not_ready' : 'partial';
  } else {
    portfolioStatus = 'ready';
  }

  jobStore.appendLog(jobId, 'persist', 100, 'Portfolio readiness assessment complete', {
    portfolioStatus,
    readyCount: counts.ready,
  });

  return {
    portfolioStatus,
    assetCount,
    readyCount: counts.ready,
    partialCount: counts.partial,
    notReadyCount: counts.not_ready,
    readinessRatio: Math.round(readinessRatio * 1000) / 1000,
    criticalFindings: allIssues.slice(0, 20),
    commonRecommendations,
    assetReports,
  };
}

// ── Service definition ────────────────────────────────────────────────────────

module.exports = {
  name: 'eeg-clawback-calculator',

  actions: {
    /**
     * Layer 1 — pure mathematical core.
     * Accepts pre-fetched timeseries directly; performs no I/O.
     */
    calculate: {
      rest: 'POST /calculate',
      params: {
        asset: {
          type: 'object',
          props: {
            technology: {
              type: 'enum',
              values: ['solar', 'wind_onshore', 'wind_offshore', 'biomass'],
            },
            capacityKw: { type: 'number', positive: true },
            awCentsPerKwh: { type: 'number', positive: true },
            commissioningDate: { type: 'string' },
          },
        },
        prices: { type: 'array' },
        injection: { type: 'array' },
        options: { type: 'object', optional: true },
      },
      handler(ctx) {
        const opts = ctx.params.options ?? {};
        const ruleSet = resolveRuleSet(opts.ruleSetId ?? 'latest');
        return runCalculation(ctx.params.asset, ctx.params.prices, ctx.params.injection, {
          ruleSet,
          includeIntervalTrace: opts.includeIntervalTrace ?? true,
        });
      },
    },

    /**
     * Data readiness pre-check for a single asset.
     * Maps to: POST /api/vnb/rcs/assess-readiness
     */
    assessReadiness: {
      rest: 'POST /assess-readiness',
      params: {
        assetId: { type: 'string', min: 1 },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
      },
      async handler(ctx) {
        const { assetId, timeframe } = ctx.params;
        const [assetRaw, pricesRaw, injectionRaw] = await Promise.all([
          ctx.call('assets.effective', { assetId }).catch(() => null),
          ctx
            .call('energy-market.prices', {
              start: timeframe.start,
              end: timeframe.end,
              market: 'day-ahead',
              resolution: 'hourly',
            })
            .catch(() => []),
          ctx
            .call('edm.getTimeseries', {
              meloId: assetId,
              from: timeframe.start,
              to: timeframe.end,
              resolution: '15min',
            })
            .catch(() => []),
        ]);
        const prices = normaliseSeries(pricesRaw);
        const injection = normaliseSeries(injectionRaw);
        const report = computeReadiness(assetRaw, prices, injection, timeframe);
        return { assetId, timeframe, ...report };
      },
    },

    /**
     * Single-asset simulation — fetches asset / prices / injection, delegates to runCalculation.
     * Maps to: POST /api/vnb/rcs/simulate
     */
    simulate: {
      rest: 'POST /simulate',
      params: {
        assetId: { type: 'string', min: 1 },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
        options: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const { assetId, timeframe, options } = ctx.params;
        const [assetRaw, pricesRaw, injectionRaw] = await Promise.all([
          ctx.call('assets.effective', { assetId }),
          ctx.call('energy-market.prices', {
            start: timeframe.start,
            end: timeframe.end,
            market: 'day-ahead',
            resolution: 'hourly',
          }),
          ctx.call('edm.getTimeseries', {
            meloId: assetId,
            from: timeframe.start,
            to: timeframe.end,
            resolution: '15min',
          }),
        ]);

        const asset = normaliseAsset(assetRaw);
        const prices = normaliseSeries(pricesRaw);
        const injection = normaliseSeries(injectionRaw);

        const opts = options ?? {};
        const ruleSet = resolveRuleSet(opts.ruleSetId ?? 'latest');
        const result = runCalculation(asset, prices, injection, {
          ruleSet,
          includeIntervalTrace: opts.includeIntervalTrace ?? true,
        });

        return {
          assetId,
          assetName: assetRaw.name ?? assetRaw.bezeichnung ?? assetId,
          timeframe,
          blueprintId: 'rcs-eeg2027-clawback-v1',
          options: opts,
          ...result,
        };
      },
    },

    /**
     * Portfolio simulation — simulates multiple assets in one call.
     * Shared price fetch; chunked parallel asset processing; async-capable.
     * Maps to: POST /api/vnb/rcs/portfolio/simulate
     */
    simulatePortfolio: {
      rest: 'POST /portfolio/simulate',
      params: {
        assetIds: { type: 'array', min: 1, items: 'string' },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
        options: { type: 'object', optional: true },
        executionMode: {
          type: 'enum',
          values: ['auto', 'sync', 'async'],
          optional: true,
          default: 'auto',
        },
      },
      async handler(ctx) {
        const { assetIds, timeframe, options } = ctx.params;
        const opts = options ?? {};
        const executionMode = ctx.params.executionMode ?? opts.executionMode ?? 'auto';
        const ruleSet = resolveRuleSet(opts.ruleSetId ?? 'latest');

        const maxAssets = opts.maxAssets ?? 500;
        if (assetIds.length > maxAssets) {
          throw new MoleculerClientError(
            `Portfolio exceeds maxAssets limit (${maxAssets}). Got ${assetIds.length} assets.`,
            400,
            'RCS_MAX_ASSETS_EXCEEDED',
            { assetCount: assetIds.length, maxAssets }
          );
        }

        const coreArgs = { assetIds, timeframe, opts, ruleSet };
        const coreWorker = (jobId) => runPortfolioSimulationCore(ctx, coreArgs, jobId);

        if (executionMode === 'sync') {
          return coreWorker(null);
        }

        if (executionMode === 'async') {
          ctx.meta.$gateway = true;
        }

        return runAsync(ctx, {
          service: 'eeg-clawback-calculator',
          action: 'simulatePortfolio',
          params: ctx.params,
          worker: coreWorker,
        });
      },
    },

    /**
     * Portfolio readiness aggregation — checks multiple assets in parallel.
     * Async-capable. Maps to: POST /api/vnb/rcs/portfolio/assess-readiness
     */
    assessPortfolioReadiness: {
      rest: 'POST /portfolio/assess-readiness',
      params: {
        assetIds: { type: 'array', min: 1, items: 'string' },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
        executionMode: {
          type: 'enum',
          values: ['auto', 'sync', 'async'],
          optional: true,
          default: 'auto',
        },
      },
      async handler(ctx) {
        const { assetIds, timeframe } = ctx.params;
        const executionMode = ctx.params.executionMode ?? 'auto';

        const coreArgs = { assetIds, timeframe };
        const coreWorker = (jobId) => runPortfolioReadinessCore(ctx, coreArgs, jobId);

        if (executionMode === 'sync') {
          return coreWorker(null);
        }

        if (executionMode === 'async') {
          ctx.meta.$gateway = true;
        }

        return runAsync(ctx, {
          service: 'eeg-clawback-calculator',
          action: 'assessPortfolioReadiness',
          params: ctx.params,
          worker: coreWorker,
        });
      },
    },
  },
};
