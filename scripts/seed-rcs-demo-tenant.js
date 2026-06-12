'use strict';

/**
 * Seed a synthetic RCS demo tenant with one completed portfolio run.
 *
 * Usage:
 *   node scripts/seed-rcs-demo-tenant.js [--db ./rcs-simulation-runs] [--asset-count 750] [--dry-run]
 *
 * The seed is deterministic and only replaces documents for its stable demo run.
 */

require('dotenv').config();

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const TENANT_ID = 'gemeindewerk-mauer-demo';
const TENANT_NAME = 'Gemeindewerk Mauer (Beispiel)';
const RUN_ID = 'demo-gemeindewerk-mauer-2026-06';
const RULE_SET_ID = 'eeg2027-draft-2026-06';
const DEFAULT_ASSET_COUNT = 750;

function argValue(name, fallback) {
  const ix = process.argv.indexOf(name);
  if (ix >= 0 && process.argv[ix + 1]) return process.argv[ix + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
}

const DB_NAME = argValue('--db', process.env.RCS_SIM_RUN_DB || 'rcs-simulation-runs');
const ASSET_COUNT = Number(argValue('--asset-count', DEFAULT_ASSET_COUNT));
const DRY_RUN = process.argv.includes('--dry-run');

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const rnd = random(0x06082026);

function pickWeighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rnd() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function docId(runId) {
  return `rcs:run:${runId}`;
}

function assetDocId(runId, assetId) {
  return `rcs:asset:${runId}:${assetId}`;
}

function traceDocId(runId, assetId) {
  return `rcs:trace:${runId}:${assetId}`;
}

function hashData(data) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
}

function technologyProfile(technology) {
  switch (technology) {
    case 'wind_onshore':
      return { minKw: 1800, maxKw: 5200, aw: 7.35, fullLoadHours: 2450 };
    case 'wind_offshore':
      return { minKw: 6500, maxKw: 11000, aw: 8.15, fullLoadHours: 3900 };
    case 'biomass':
      return { minKw: 300, maxKw: 1800, aw: 14.2, fullLoadHours: 5600 };
    case 'storage_hybrid':
      return { minKw: 500, maxKw: 4500, aw: 6.2, fullLoadHours: 900 };
    case 'pv_freiflaeche':
      return { minKw: 850, maxKw: 9500, aw: 5.7, fullLoadHours: 1020 };
    case 'pv_rooftop':
    default:
      return { minKw: 25, maxKw: 740, aw: 8.6, fullLoadHours: 890 };
  }
}

function makeAsset(index) {
  const technology = pickWeighted([
    ['pv_rooftop', 300],
    ['pv_freiflaeche', 170],
    ['wind_onshore', 145],
    ['biomass', 75],
    ['storage_hybrid', 45],
    ['wind_offshore', 15],
  ]);
  const p = technologyProfile(technology);
  const capacityKw = round2(p.minKw + rnd() * (p.maxKw - p.minKw));
  const assetId = `gwm-${String(index).padStart(4, '0')}`;
  const annualKwh = capacityKw * p.fullLoadHours * (0.86 + rnd() * 0.28);
  const baseline = round2((annualKwh * p.aw) / 100);
  const clawbackRatio = technology === 'storage_hybrid' ? 0.02 + rnd() * 0.06 : 0.08 + rnd() * 0.24;
  const clawback = round2(baseline * clawbackRatio);
  const retained = round2(baseline - clawback);
  const delta = round2(retained - baseline);

  const bucket = index % 100;
  let status = 'success';
  let readinessStatus = 'ready';
  let dataQualitySummary = null;
  let message = null;
  let errorCode = null;

  if (bucket < 2) {
    status = 'error';
    readinessStatus = 'not_ready';
    errorCode = 'DEMO_MISSING_TIMESERIES';
    message = 'Synthetischer Demo-Fall: Einspeisezeitreihe fehlt fuer diesen Zeitraum.';
    dataQualitySummary = { missing_injection_intervals: 35040 };
  } else if (bucket < 8) {
    readinessStatus = 'partial';
    dataQualitySummary = {
      interpolated_intervals: 96 + Math.floor(rnd() * 480),
      negative_price_gaps: 4 + Math.floor(rnd() * 18),
    };
  } else if (bucket < 11) {
    readinessStatus = 'not_ready';
    dataQualitySummary = {
      meter_mapping_missing: 1,
      missing_injection_intervals: 96 + Math.floor(rnd() * 960),
    };
  }

  const summary =
    status === 'success'
      ? {
          calculatedUnderOldLaw: { totalRevenueCents: Math.round(baseline * 100) },
          calculatedUnderNewLaw: {
            totalRefinancingContributionCents: Math.round(clawback * 100),
            retainedRevenueCents: Math.round(retained * 100),
          },
          deltaCents: Math.round(delta * 100),
          liquidityRiskIndex: clawbackRatio > 0.22 ? 'medium' : 'low',
        }
      : null;

  return {
    assetId,
    assetName: `${TENANT_NAME} ${technology.replace(/_/g, '-')} ${String(index).padStart(4, '0')}`,
    technology,
    capacityKw,
    awCentsPerKwh: p.aw,
    commissioningDate: `${2012 + (index % 13)}-${String((index % 12) + 1).padStart(2, '0')}-15`,
    status,
    readinessStatus,
    summary,
    dataQualitySummary,
    errorCode,
    message,
    clawback,
    baseline,
    retained,
    delta,
  };
}

function aggregate(assets) {
  const successful = assets.filter((a) => a.status === 'success');
  const failed = assets.filter((a) => a.status === 'error');
  const totalBaseline = round2(successful.reduce((sum, a) => sum + a.baseline, 0));
  const totalClawback = round2(successful.reduce((sum, a) => sum + a.clawback, 0));
  const totalRetained = round2(successful.reduce((sum, a) => sum + a.retained, 0));
  const totalDelta = round2(totalRetained - totalBaseline);

  const summary = {
    assetCount: assets.length,
    successfulAssets: successful.length,
    failedAssets: failed.length,
    skippedAssets: 0,
    errorCount: failed.length,
    totalBaseline,
    totalClawback,
    totalRetained,
    totalDelta,
    totalBaselineAmountEur: totalBaseline,
    totalClawbackAmountEur: totalClawback,
    totalRetainedAmountEur: totalRetained,
    totalDeltaEur: totalDelta,
    liquidityRiskIndex: totalClawback / Math.max(totalBaseline, 1) > 0.16 ? 'medium' : 'low',
  };

  const ruleArmSummary = {
    positive_price: {
      count: successful.length * 28400,
      totalClawbackEur: round2(totalClawback * 0.18),
      totalVolumeKwh: Math.round(successful.reduce((sum, a) => sum + a.capacityKw * 850, 0)),
    },
    negative_price_4h: {
      count: successful.length * 6400,
      totalClawbackEur: round2(totalClawback * 0.64),
      totalVolumeKwh: Math.round(successful.reduce((sum, a) => sum + a.capacityKw * 210, 0)),
    },
    floor_price: {
      count: successful.length * 240,
      totalClawbackEur: round2(totalClawback * 0.18),
      totalVolumeKwh: Math.round(successful.reduce((sum, a) => sum + a.capacityKw * 34, 0)),
    },
  };

  return { summary, ruleArmSummary };
}

function makeDocs() {
  const now = new Date().toISOString();
  const assets = Array.from({ length: ASSET_COUNT }, (_, i) => makeAsset(i + 1));
  const { summary, ruleArmSummary } = aggregate(assets);
  const assetIds = assets.map((a) => a.assetId);
  const timeframe = {
    from: '2025-06-07',
    to: '2026-06-07',
    start: '2025-06-07',
    end: '2026-06-07',
  };
  const inputHash = hashData({ tenantId: TENANT_ID, assetIds, timeframe, ruleSetId: RULE_SET_ID });

  const runDoc = {
    _id: docId(RUN_ID),
    runId: RUN_ID,
    tenantId: TENANT_ID,
    tenantName: TENANT_NAME,
    demo: true,
    assetId: null,
    assetName: TENANT_NAME,
    assetIds,
    assetCount: assets.length,
    scope: 'portfolio',
    timeframe,
    ruleSetId: RULE_SET_ID,
    ruleSetVersion: '1.0.0',
    legalStatus: 'referentenentwurf',
    jobId: null,
    executionMode: 'sync',
    status: 'completed',
    progress: { processedAssets: assets.length, totalAssets: assets.length, percent: 100 },
    workloadEstimate: {
      assetCount: assets.length,
      intervalCount: assets.length * 35040,
      expectedIntervalsPerAsset: 35040,
      estimatedTotalIntervals: assets.length * 35040,
      chunkSize: 50,
      traceMode: 'summary',
      executionMode: 'sync',
      estimatedDurationMs: 180000,
      estimatedRisk: 'medium',
      warnings: [],
    },
    resultLocation: { type: 'pouchdb', db: DB_NAME, runId: RUN_ID },
    summary,
    portfolioSummary: summary,
    ruleArmSummary,
    errorCount: summary.errorCount,
    options: {
      ruleSetId: RULE_SET_ID,
      executionMode: 'sync',
      traceMode: 'summary',
      includeReadiness: true,
      continueOnAssetError: true,
      chunkSize: 50,
    },
    inputHash,
    warnings: [
      'Synthetischer Demo-Mandant. Keine echten Kunden-, Markt- oder Messdaten.',
      'Datenqualitaetsfaelle sind bewusst fuer Demonstrationszwecke eingestreut.',
    ],
    createdAt: now,
    completedAt: now,
    errorMessage: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
  };

  const assetDocs = assets.map((a) => ({
    _id: assetDocId(RUN_ID, a.assetId),
    runId: RUN_ID,
    tenantId: TENANT_ID,
    tenantName: TENANT_NAME,
    assetId: a.assetId,
    assetName: a.assetName,
    technology: a.technology,
    status: a.status,
    readinessStatus: a.readinessStatus,
    summary: a.summary,
    baseline: a.baseline,
    clawback: a.clawback,
    retained: a.retained,
    delta: a.delta,
    ruleArmSummary:
      a.status === 'success'
        ? {
            positive_price: {
              count: 28400,
              totalClawbackEur: round2(a.clawback * 0.18),
              totalVolumeKwh: Math.round(a.capacityKw * 850),
            },
            negative_price_4h: {
              count: 6400,
              totalClawbackEur: round2(a.clawback * 0.64),
              totalVolumeKwh: Math.round(a.capacityKw * 210),
            },
            floor_price: {
              count: 240,
              totalClawbackEur: round2(a.clawback * 0.18),
              totalVolumeKwh: Math.round(a.capacityKw * 34),
            },
          }
        : null,
    dataQualitySummary: a.dataQualitySummary,
    errorCode: a.errorCode,
    message: a.message,
    savedAt: now,
  }));

  const traced = assets.filter((a) => a.status === 'success').slice(0, 8);
  const traceDocs = traced.map((a) => ({
    _id: traceDocId(RUN_ID, a.assetId),
    runId: RUN_ID,
    assetId: a.assetId,
    assetName: a.assetName,
    technology: a.technology,
    createdAt: now,
    ruleSetId: RULE_SET_ID,
    ruleSetVersion: '1.0.0',
    drilldownSemantics: {
      mode: 'seeded_demo_trace',
      baseRunId: RUN_ID,
      ruleSetId: RULE_SET_ID,
      usesOriginalRuleSet: true,
      usesOriginalAssetSnapshot: true,
      usesOriginalTimeseriesSnapshot: true,
      computedAt: now,
    },
    traceHash: hashData(a),
    summary: a.summary,
    intervals: Array.from({ length: 24 }, (_, hour) => ({
      timestamp: `2026-06-07T${String(hour).padStart(2, '0')}:00:00.000Z`,
      injectionKwh: round2((a.capacityKw / 24) * (0.25 + rnd() * 0.55)),
      priceEurMwh: round2(-12 + rnd() * 65),
      baselineAmountEur: round2(a.baseline / 35040),
      clawbackAmountEur: round2(a.clawback / 35040),
      retainedAmountEur: round2(a.retained / 35040),
      deltaEur: round2(a.delta / 35040),
      ruleArm: hour % 5 === 0 ? 'negative_price_4h' : 'positive_price',
      dataQualityFlags: [],
    })),
  }));

  return { runDoc, assetDocs, traceDocs, summary };
}

async function putReplacing(db, docs) {
  const withRevs = [];
  for (const doc of docs) {
    try {
      const existing = await db.get(doc._id);
      withRevs.push({ ...doc, _rev: existing._rev });
    } catch (err) {
      if (err.status !== 404) throw err;
      withRevs.push(doc);
    }
  }
  return db.bulkDocs(withRevs);
}

async function main() {
  if (!Number.isInteger(ASSET_COUNT) || ASSET_COUNT < 1) {
    throw new Error('--asset-count must be a positive integer');
  }

  const { runDoc, assetDocs, traceDocs, summary } = makeDocs();
  const docs = [runDoc, ...assetDocs, ...traceDocs];

  console.log(`[seed-rcs-demo-tenant] tenant=${TENANT_NAME}`);
  console.log(`[seed-rcs-demo-tenant] runId=${RUN_ID}`);
  console.log(`[seed-rcs-demo-tenant] db=${DB_NAME}`);
  console.log(
    `[seed-rcs-demo-tenant] docs=${docs.length} assets=${assetDocs.length} traces=${traceDocs.length}`
  );
  console.log(
    `[seed-rcs-demo-tenant] errors=${summary.errorCount} totalDelta=${summary.totalDelta} EUR`
  );

  if (DRY_RUN) {
    console.log('[seed-rcs-demo-tenant] dry-run: no documents written');
    return;
  }

  const db = new PouchDB(DB_NAME);
  const result = await putReplacing(db, docs);
  const errors = result.filter((row) => row.error);
  if (errors.length > 0) {
    console.error(errors.slice(0, 10));
    throw new Error(`Failed to write ${errors.length} document(s)`);
  }
  console.log(`[seed-rcs-demo-tenant] wrote=${result.length}`);
}

main().catch((err) => {
  console.error('[seed-rcs-demo-tenant] Fatal:', err);
  process.exit(1);
});
