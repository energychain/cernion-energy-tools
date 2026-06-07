'use strict';

// Unique DB path for E2E smoke tests — must be set before any service require
process.env.RCS_SIM_RUN_DB = `rcs-test-e2e-smoke-${Date.now()}`;
const SMOKE_PORT = 47321;
process.env.PORT = String(SMOKE_PORT);

const axios = require('axios');
const { ServiceBroker } = require('moleculer');

const BASE = `http://127.0.0.1:${SMOKE_PORT}/api`;
const AUTH = { headers: { Authorization: 'Bearer ck_test_smoke' } };
const BAD_AUTH = { headers: { Authorization: 'Bearer ck_invalid_revoked_token' } };

const TIMEFRAME = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };

function makeQuarterHourPrices(count = 96, priceEurMwh = 50) {
  const base = new Date(TIMEFRAME.start).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    priceEurMwh,
  }));
}

function makeInjectionSeries(count = 96, volumeKwh = 10) {
  const base = new Date(TIMEFRAME.start).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    volumeKwh,
  }));
}

const SOLAR_ASSET = {
  technology: 'solar',
  awCentsPerKwh: 7.5,
  capacityKw: 100,
  commissioningDate: '2024-01-01',
  name: 'Smoke Solar 01',
};

let broker;

// Shared run/asset state seeded in beforeAll
let smokeRunId;
const SMOKE_ASSET_ID = 'smoke-asset-solar-01';

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });

  // ── Mock: token-manager ─────────────────────────────────────────────────────
  broker.createService({
    name: 'token-manager',
    actions: {
      verify: {
        handler(ctx) {
          if (ctx.params.token === 'ck_test_smoke') {
            return {
              valid: true,
              scope: 'full-access',
              scopes: ['full-access'],
              tokenId: 'smoke-token-01',
              name: 'Smoke Test Token',
            };
          }
          return { valid: false, reason: 'INVALID_TOKEN' };
        },
      },
    },
  });

  // ── Mock: assets ────────────────────────────────────────────────────────────
  broker.createService({
    name: 'assets',
    actions: {
      effective: { handler: () => SOLAR_ASSET },
    },
  });

  // ── Mock: energy-market ─────────────────────────────────────────────────────
  broker.createService({
    name: 'energy-market',
    actions: {
      prices: { handler: () => makeQuarterHourPrices() },
    },
  });

  // ── Mock: edm ───────────────────────────────────────────────────────────────
  broker.createService({
    name: 'edm',
    actions: {
      getTimeseries: { handler: () => makeInjectionSeries() },
    },
  });

  // ── Real RCS services ───────────────────────────────────────────────────────
  broker.loadService('./services/rcs-simulation-run.service.js');
  broker.loadService('./services/eeg-clawback-calculator.service.js');
  broker.loadService('./services/rcs-rule-catalog.service.js');
  broker.loadService('./services/api.service.js');

  await broker.start();

  // Seed a completed run with one asset result — bypasses the simulate flow
  // which in sync mode intentionally omits run persistence
  const run = await broker.call('rcs-simulation-run.saveRun', {
    assetId: SMOKE_ASSET_ID,
    assetIds: [SMOKE_ASSET_ID],
    timeframe: TIMEFRAME,
    summary: { totalVolumeKwh: 960, totalBaselineAmountEur: 384.0 },
    scope: 'portfolio',
    ruleSetId: 'eeg2027-draft-2026-06',
  });
  smokeRunId = run.runId;

  await broker.call('rcs-simulation-run.saveAssetResults', {
    runId: smokeRunId,
    results: [
      {
        assetId: SMOKE_ASSET_ID,
        assetName: 'Smoke Solar 01',
        status: 'success',
        technology: 'solar',
        summary: { totalVolumeKwh: 960, totalBaselineAmountEur: 384.0 },
      },
    ],
  });

  // Give the HTTP server a moment to bind
  await new Promise((r) => setTimeout(r, 100));
}, 30000);

afterAll(async () => {
  await broker.stop();
  const { rm } = require('fs/promises');
  await rm(process.env.RCS_SIM_RUN_DB, { recursive: true, force: true }).catch(() => {});
}, 15000);

// ── Step 1: Rule Discovery ────────────────────────────────────────────────────

describe('GET /api/vnb/rcs/rules', () => {
  test('returns 200 with rule set envelope {total, items}', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/rules`, AUTH);
    expect(res.status).toBe(200);
    expect(typeof res.data.total).toBe('number');
    expect(Array.isArray(res.data.items)).toBe(true);
    expect(res.data.items.length).toBeGreaterThan(0);
  });

  test('each rule set has id and isLatest flag', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/rules`, AUTH);
    const first = res.data.items[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.isLatest).toBe('boolean');
  });
});

describe('GET /api/vnb/rcs/rules/:ruleSetId', () => {
  let ruleSetId;

  beforeAll(async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/rules`, AUTH);
    ruleSetId = res.data.items[0].id;
  });

  test('returns 200 with full rule set including parameters', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/rules/${ruleSetId}`, AUTH);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(ruleSetId);
    expect(res.data.parameters).toBeDefined();
  });

  test('returns 404 for unknown ruleSetId', async () => {
    const res = await axios
      .get(`${BASE}/vnb/rcs/rules/no-such-rule-xyz`, AUTH)
      .catch((e) => e.response);
    expect(res.status).toBe(404);
    expect(res.data.success).toBe(false);
    expect(res.data.type).toBe('RCS_RULE_SET_NOT_FOUND');
  });
});

// ── Step 2: Run Listing ───────────────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs', () => {
  test('returns 200 with pagination envelope {total, offset, limit, hasMore, items}', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs`, AUTH);
    expect(res.status).toBe(200);
    expect(typeof res.data.total).toBe('number');
    expect(typeof res.data.offset).toBe('number');
    expect(typeof res.data.limit).toBe('number');
    expect(typeof res.data.hasMore).toBe('boolean');
    expect(Array.isArray(res.data.items)).toBe(true);
  });

  test('seeded smoke run appears in listing', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs`, AUTH);
    const ids = res.data.items.map((r) => r.runId);
    expect(ids).toContain(smokeRunId);
  });

  test('run items have HATEOAS links (self, assets, errors, readiness)', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs`, AUTH);
    const run = res.data.items.find((r) => r.runId === smokeRunId);
    expect(run.links.self).toContain(smokeRunId);
    expect(run.links.assets).toMatch(/\/assets$/);
    expect(run.links.errors).toMatch(/\/errors$/);
    expect(run.links.readiness).toMatch(/\/readiness$/);
  });

  test('limit query param is accepted and coerced from string', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs?limit=1`, AUTH);
    expect(res.status).toBe(200);
    expect(res.data.items.length).toBeLessThanOrEqual(1);
  });
});

// ── Step 3: Run Detail ────────────────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs/:runId', () => {
  test('returns 200 with run detail and links', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs/${smokeRunId}`, AUTH);
    expect(res.status).toBe(200);
    expect(res.data.runId).toBe(smokeRunId);
    expect(res.data.links.self).toContain(smokeRunId);
    expect(res.data.links.assets).toContain(smokeRunId);
    expect(res.data.links.readiness).toContain(smokeRunId);
  });

  test('returns 404 for unknown runId', async () => {
    const res = await axios
      .get(`${BASE}/vnb/rcs/runs/run-does-not-exist`, AUTH)
      .catch((e) => e.response);
    expect(res.status).toBe(404);
    expect(res.data.type).toBe('RCS_RUN_NOT_FOUND');
  });
});

// ── Step 4: Asset Listing ─────────────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs/:runId/assets', () => {
  test('returns 200 with {runId, total, hasMore, assetResults}', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs/${smokeRunId}/assets`, AUTH);
    expect(res.status).toBe(200);
    expect(res.data.runId).toBe(smokeRunId);
    expect(typeof res.data.total).toBe('number');
    expect(typeof res.data.hasMore).toBe('boolean');
    expect(Array.isArray(res.data.assetResults)).toBe(true);
    expect(res.data.assetResults.length).toBeGreaterThan(0);
    expect(res.data.assetResults[0].assetId).toBe(SMOKE_ASSET_ID);
  });
});

// ── Step 5: Asset Detail ──────────────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs/:runId/assets/:assetId', () => {
  test('returns 200 with asset detail, hasTrace flag, and links', async () => {
    const res = await axios.get(
      `${BASE}/vnb/rcs/runs/${smokeRunId}/assets/${SMOKE_ASSET_ID}`,
      AUTH
    );
    expect(res.status).toBe(200);
    expect(res.data.assetId).toBe(SMOKE_ASSET_ID);
    expect(typeof res.data.hasTrace).toBe('boolean');
    expect(res.data.links.drilldown).toContain('drilldown');
    expect(res.data.links.trace).toContain('trace');
  });
});

// ── Step 6: On-Demand Drilldown ───────────────────────────────────────────────

describe('POST /api/vnb/rcs/runs/:runId/assets/:assetId/drilldown', () => {
  test('returns 200 with full trace intervals, drilldownSemantics, and links', async () => {
    const res = await axios.post(
      `${BASE}/vnb/rcs/runs/${smokeRunId}/assets/${SMOKE_ASSET_ID}/drilldown`,
      { persistTrace: true, executionMode: 'sync' },
      AUTH
    );
    expect(res.status).toBe(200);
    expect(res.data.runId).toBe(smokeRunId);
    expect(res.data.assetId).toBe(SMOKE_ASSET_ID);
    expect(res.data.traceMode).toBe('full');
    expect(Array.isArray(res.data.intervals)).toBe(true);
    expect(res.data.intervals.length).toBe(96);
    expect(res.data.drilldownSemantics).toBeDefined();
    expect(res.data.drilldownSemantics.mode).toBe('recomputed_from_current_source_data');
    expect(res.data.drilldownSemantics.baseRunId).toBe(smokeRunId);
    expect(res.data.drilldownSemantics.usesOriginalRuleSet).toBe(true);
    expect(res.data.drilldownSemantics.usesOriginalAssetSnapshot).toBe(false);
    expect(res.data.links.self).toContain('drilldown');
    expect(res.data.links.trace).toContain('trace');

    // Allow fire-and-forget saveTrace to complete
    await new Promise((r) => setTimeout(r, 200));
  });

  test('returns 404 for asset not in run', async () => {
    const res = await axios
      .post(
        `${BASE}/vnb/rcs/runs/${smokeRunId}/assets/no-such-asset-xyz/drilldown`,
        { persistTrace: false, executionMode: 'sync' },
        AUTH
      )
      .catch((e) => e.response);
    expect(res.status).toBe(404);
    expect(res.data.type).toBe('RCS_ASSET_NOT_IN_RUN');
  });
});

// ── Step 7: Persisted Trace ───────────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs/:runId/assets/:assetId/trace', () => {
  test('returns 200 with trace data including drilldownSemantics', async () => {
    const res = await axios.get(
      `${BASE}/vnb/rcs/runs/${smokeRunId}/assets/${SMOKE_ASSET_ID}/trace`,
      AUTH
    );
    expect(res.status).toBe(200);
    expect(res.data.runId).toBe(smokeRunId);
    expect(res.data.assetId).toBe(SMOKE_ASSET_ID);
    expect(Array.isArray(res.data.intervals)).toBe(true);
    expect(res.data.traceHash).toBeDefined();
    expect(res.data.drilldownSemantics).toBeDefined();
    expect(res.data.drilldownSemantics.mode).toBe('recomputed_from_current_source_data');
  });

  test('returns 404 for asset with no trace', async () => {
    const res = await axios
      .get(`${BASE}/vnb/rcs/runs/${smokeRunId}/assets/no-trace-asset-xyz/trace`, AUTH)
      .catch((e) => e.response);
    expect(res.status).toBe(404);
    expect(res.data.type).toBe('RCS_TRACE_NOT_FOUND');
  });
});

// ── Step 8: Readiness Aggregation ────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs/:runId/readiness', () => {
  test('returns 200 with readiness data for the run', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs/${smokeRunId}/readiness`, AUTH);
    expect(res.status).toBe(200);
    expect(res.data.runId).toBe(smokeRunId);
  });
});

// ── Step 9: Errors Listing ────────────────────────────────────────────────────

describe('GET /api/vnb/rcs/runs/:runId/errors', () => {
  test('returns 200 with errors object', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs/${smokeRunId}/errors`, AUTH);
    expect(res.status).toBe(200);
    expect(res.data.runId).toBe(smokeRunId);
    expect(Array.isArray(res.data.errors)).toBe(true);
  });
});

// ── Step 10: Access Control ───────────────────────────────────────────────────

describe('access control — invalid token returns 401', () => {
  test('GET /runs with invalid ck_ token returns 401', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/runs`, BAD_AUTH).catch((e) => e.response);
    expect(res.status).toBe(401);
    expect(res.data.success).toBe(false);
  });

  test('GET /rules with invalid ck_ token returns 401', async () => {
    const res = await axios.get(`${BASE}/vnb/rcs/rules`, BAD_AUTH).catch((e) => e.response);
    expect(res.status).toBe(401);
    expect(res.data.success).toBe(false);
  });

  test('POST /drilldown with invalid ck_ token returns 401', async () => {
    const res = await axios
      .post(
        `${BASE}/vnb/rcs/runs/${smokeRunId}/assets/${SMOKE_ASSET_ID}/drilldown`,
        { persistTrace: false },
        BAD_AUTH
      )
      .catch((e) => e.response);
    expect(res.status).toBe(401);
  });
});

// ── Step 11: Error Response Structure ─────────────────────────────────────────

describe('error response structure', () => {
  test('404 errors have {success, message, code, type} structure', async () => {
    const res = await axios
      .get(`${BASE}/vnb/rcs/runs/run-not-found-abc`, AUTH)
      .catch((e) => e.response);
    expect(res.status).toBe(404);
    expect(res.data.success).toBe(false);
    expect(typeof res.data.message).toBe('string');
    expect(res.data.code).toBe(404);
    expect(typeof res.data.type).toBe('string');
  });
});

// ── Step 12: Link Consistency ─────────────────────────────────────────────────

describe('link consistency — links in responses are reachable', () => {
  test('run self link resolves to the same run', async () => {
    const runRes = await axios.get(`${BASE}/vnb/rcs/runs/${smokeRunId}`, AUTH);
    const selfLink = runRes.data.links.self;
    const absolute = `http://127.0.0.1:${SMOKE_PORT}${selfLink}`;
    const res2 = await axios.get(absolute, AUTH);
    expect(res2.status).toBe(200);
    expect(res2.data.runId).toBe(smokeRunId);
  });

  test('run assets link resolves to asset list for the run', async () => {
    const runRes = await axios.get(`${BASE}/vnb/rcs/runs/${smokeRunId}`, AUTH);
    const assetsLink = runRes.data.links.assets;
    const absolute = `http://127.0.0.1:${SMOKE_PORT}${assetsLink}`;
    const res2 = await axios.get(absolute, AUTH);
    expect(res2.status).toBe(200);
    expect(res2.data.runId).toBe(smokeRunId);
  });

  test('asset self link resolves to the same asset', async () => {
    const assetRes = await axios.get(
      `${BASE}/vnb/rcs/runs/${smokeRunId}/assets/${SMOKE_ASSET_ID}`,
      AUTH
    );
    const selfLink = assetRes.data.links.self;
    const absolute = `http://127.0.0.1:${SMOKE_PORT}${selfLink}`;
    const res2 = await axios.get(absolute, AUTH);
    expect(res2.status).toBe(200);
    expect(res2.data.assetId).toBe(SMOKE_ASSET_ID);
  });
});
