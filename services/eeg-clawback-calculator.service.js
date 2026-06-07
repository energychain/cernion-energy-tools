'use strict';

const { runCalculation } = require('../src/eeg-clawback-calculator');
const { resolveRuleSet } = require('../src/rcs-rule-registry');
const { computeReadiness } = require('../src/rcs-readiness');

// ── Normalise raw asset response to a canonical shape ─────────────────────────

function normaliseAsset(raw) {
  return {
    technology: raw.technology ?? raw.tech,
    capacityKw: raw.capacityKw ?? raw.capacity_kw ?? raw.capacityKW,
    awCentsPerKwh:
      raw.awCentsPerKwh ?? raw.aw_cents_per_kwh ?? raw.anzulegenderWertCentsKwh,
    commissioningDate:
      raw.commissioningDate ?? raw.commissioning_date ?? raw.inbetriebnahmedatum,
  };
}

function normaliseSeries(raw) {
  return Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
}

// ── Aggregate portfolio summary across individual asset results ───────────────

function aggregatePortfolioSummary(assetResults) {
  const successful = assetResults.filter((r) => r.status === 'success');
  const failed = assetResults.filter((r) => r.status === 'error');
  const skipped = assetResults.filter((r) => r.status === 'skipped');

  let totalBaselineCents = 0;
  let totalClawbackCents = 0;
  let totalRetainedCents = 0;

  for (const r of successful) {
    totalBaselineCents += r.summary.calculatedUnderOldLaw.totalRevenueCents ?? 0;
    totalClawbackCents += r.summary.calculatedUnderNewLaw.totalRefinancingContributionCents ?? 0;
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
    g.totalBaselineAmountEur += (r.summary.calculatedUnderOldLaw.totalRevenueCents ?? 0) / 100;
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
            technology: { type: 'enum', values: ['solar', 'wind_onshore', 'wind_offshore', 'biomass'] },
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
          ctx.call('energy-market.prices', {
            start: timeframe.start,
            end: timeframe.end,
            market: 'day-ahead',
            resolution: 'hourly',
          }).catch(() => []),
          ctx.call('edm.getTimeseries', {
            meloId: assetId,
            from: timeframe.start,
            to: timeframe.end,
            resolution: '15min',
          }).catch(() => []),
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
     * Price series is fetched once and shared across all assets.
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
      },
      async handler(ctx) {
        const { assetIds, timeframe, options } = ctx.params;
        const opts = options ?? {};
        const ruleSet = resolveRuleSet(opts.ruleSetId ?? 'latest');
        const continueOnError = opts.continueOnAssetError !== false; // default true

        // Fetch shared price series once for the whole portfolio
        const pricesRaw = await ctx
          .call('energy-market.prices', {
            start: timeframe.start,
            end: timeframe.end,
            market: 'day-ahead',
            resolution: 'hourly',
          })
          .catch(() => []);
        const prices = normaliseSeries(pricesRaw);

        // Simulate each asset independently; fail-safe per asset
        const assetResults = await Promise.all(
          assetIds.map(async (assetId) => {
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

              // Optionally check readiness before calculating
              let readinessStatus = null;
              if (opts.includeReadiness) {
                const readiness = computeReadiness(assetRaw, prices, injection, timeframe);
                readinessStatus = readiness.overallStatus;
              }

              const calc = runCalculation(asset, prices, injection, {
                ruleSet,
                includeIntervalTrace: opts.includeIntervalTrace ?? false,
              });

              return {
                assetId,
                assetName: assetRaw.name ?? assetRaw.bezeichnung ?? assetId,
                technology: asset.technology,
                status: 'success',
                readinessStatus,
                summary: calc.summary,
                ruleSetId: ruleSet?.id ?? null,
                ruleSetVersion: ruleSet?.version ?? null,
                ...(opts.includeIntervalTrace ? { intervals: calc.intervals } : {}),
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

        const portfolioSummary = aggregatePortfolioSummary(assetResults);
        const errors = assetResults.filter((r) => r.status === 'error');

        return {
          ruleSetId: ruleSet?.id ?? null,
          ruleSetVersion: ruleSet?.version ?? null,
          legalStatus: ruleSet?.legalStatus ?? null,
          timeframe,
          portfolioSummary,
          byTechnology: groupByTechnology(assetResults),
          byReadinessStatus: groupByReadiness(assetResults),
          topAssetsByDelta: topAssetsByDelta(assetResults),
          assetResults: assetResults.map((r) => ({
            assetId: r.assetId,
            assetName: r.assetName ?? r.assetId,
            technology: r.technology ?? null,
            status: r.status,
            readinessStatus: r.readinessStatus ?? null,
            summary: r.summary ?? null,
            errorCode: r.errorCode ?? null,
            message: r.message ?? null,
          })),
          errors,
        };
      },
    },

    /**
     * Portfolio readiness aggregation — checks multiple assets in parallel.
     * Maps to: POST /api/vnb/rcs/portfolio/assess-readiness
     */
    assessPortfolioReadiness: {
      rest: 'POST /portfolio/assess-readiness',
      params: {
        assetIds: { type: 'array', min: 1, items: 'string' },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
      },
      async handler(ctx) {
        const { assetIds, timeframe } = ctx.params;

        // Fetch shared price series once
        const pricesRaw = await ctx
          .call('energy-market.prices', {
            start: timeframe.start,
            end: timeframe.end,
            market: 'day-ahead',
            resolution: 'hourly',
          })
          .catch(() => []);
        const prices = normaliseSeries(pricesRaw);

        const assetReports = await Promise.all(
          assetIds.map(async (assetId) => {
            const [assetRaw, injectionRaw] = await Promise.all([
              ctx.call('assets.effective', { assetId }).catch(() => null),
              ctx.call('edm.getTimeseries', {
                meloId: assetId,
                from: timeframe.start,
                to: timeframe.end,
                resolution: '15min',
              }).catch(() => []),
            ]);
            const injection = normaliseSeries(injectionRaw);
            const report = computeReadiness(assetRaw, injection.length > 0 ? prices : prices, injection, timeframe);
            return { assetId, ...report };
          })
        );

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

        // Aggregate common recommendations
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
          portfolioStatus = counts.ready === assetCount ? 'ready' : counts.not_ready > 0 ? 'not_ready' : 'partial';
        } else {
          portfolioStatus = 'ready';
        }

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
      },
    },
  },
};
