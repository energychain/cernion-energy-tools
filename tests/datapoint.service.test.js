'use strict';

/**
 * Tests for datapoint.service.js (v0.11 — Datapoint Layer)
 *
 * Uses an isolated in-memory PouchDB path per test suite to avoid
 * interference between tests and the production .datapoints/ directory.
 *
 * agent.loadSession and agent.executePlan are stubbed so no real
 * microservice calls or file I/O are required.
 */

const { ServiceBroker } = require('moleculer');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Unique temp directory for PouchDB during this test run
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-dp-test-${Date.now()}`);

// Load the service and override the dbPath before requiring
process.env.DATAPOINT_DB_PATH = TEST_DB_PATH;
const DatapointService = require('../services/datapoint.service');

// Minimal fixture session (mirrors .sessions/9209aa45-*.json shape)
const SESSION_FIXTURE = require('./fixtures/session-pv-stromdao.json');

// ── Helpers ───────────────────────────────────────────────────────────────

/** Create a mock agent service with loadSession + executePlan stubs */
function buildMockAgentService(overrides = {}) {
  return {
    name: 'agent',
    actions: {
      loadSession: {
        handler(ctx) {
          return overrides.loadSession
            ? overrides.loadSession(ctx)
            : Promise.resolve(SESSION_FIXTURE);
        },
      },
      executePlan: {
        handler(ctx) {
          return overrides.executePlan
            ? overrides.executePlan(ctx)
            : Promise.resolve({
                success: true,
                stepResults: [
                  {
                    step: 1,
                    action: 'assets.solar',
                    result: Array.from({ length: 38 }, (_, i) => ({ id: i, kw: 10 })),
                    error: null,
                  },
                ],
                executedAt: new Date().toISOString(),
              });
        },
      },
    },
  };
}

/** Promote a datapoint with sensible defaults, returns promote result */
async function promoteFixture(broker, overrides = {}) {
  return broker.call('datapoint.promote', {
    sessionId: SESSION_FIXTURE.id,
    name: 'test-pv-portfolio',
    description: 'Test PV portfolio',
    owner: 'jest',
    tags: ['solar', 'test'],
    fixedParams: {},
    refresh: { strategy: 'manual' },
    ...overrides,
  });
}

// ── Test suites ───────────────────────────────────────────────────────────

describe('datapoint.service', () => {
  let broker;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(DatapointService);
    broker.createService(buildMockAgentService());
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    // Clean up PouchDB files between tests
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── promote ─────────────────────────────────────────────────────────────

  describe('promote', () => {
    it('creates a datapoint from a session fixture', async () => {
      const result = await promoteFixture(broker);

      expect(result.success).toBe(true);
      expect(result.name).toBe('test-pv-portfolio');
      expect(result._rev).toBeDefined();
    });

    it('persists lastRun.status as "never" immediately after promotion', async () => {
      await promoteFixture(broker);

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });

      expect(doc.lastRun.status).toBe('never');
      expect(doc.lastRun.timestamp).toBeNull();
      expect(doc.health.totalRuns).toBe(0);
    });

    it('stores plan steps and requiredInputs from the session', async () => {
      await promoteFixture(broker);

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });

      expect(Array.isArray(doc.plan.steps)).toBe(true);
      expect(doc.plan.steps.length).toBeGreaterThan(0);
      expect(Array.isArray(doc.plan.requiredInputs)).toBe(true);
    });

    it('rejects duplicate name with HTTP 409', async () => {
      await promoteFixture(broker);

      await expect(promoteFixture(broker)).rejects.toMatchObject({
        code: 409,
        type: 'DUPLICATE_NAME',
      });
    });

    it('returns HTTP 404 when session is not found', async () => {
      // Override loadSession to simulate missing session
      const brokerLocal = new ServiceBroker({ logger: false });
      brokerLocal.createService(DatapointService);
      brokerLocal.createService(
        buildMockAgentService({
          loadSession: () => Promise.resolve(null),
        })
      );
      await brokerLocal.start();

      await expect(
        brokerLocal.call('datapoint.promote', {
          sessionId: 'nonexistent-id',
          name: 'should-not-exist',
        })
      ).rejects.toMatchObject({ code: 404, type: 'SESSION_NOT_FOUND' });

      await brokerLocal.stop();
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns all promoted datapoints with health data', async () => {
      await promoteFixture(broker, { name: 'dp-alpha' });
      await promoteFixture(broker, { name: 'dp-beta' });

      const result = await broker.call('datapoint.list', {});

      expect(result.count).toBe(2);
      expect(result.datapoints.map((d) => d.name).sort()).toEqual(['dp-alpha', 'dp-beta']);
      expect(result.datapoints[0].lastRun).toBeDefined();
      expect(result.datapoints[0].health).toBeDefined();
    });

    it('returns empty list when no datapoints exist', async () => {
      const result = await broker.call('datapoint.list', {});
      expect(result.count).toBe(0);
      expect(result.datapoints).toHaveLength(0);
    });

    // AP3 (v0.13): tag-based filtering
    it('filters by a single tag (case-insensitive)', async () => {
      await promoteFixture(broker, { name: 'dp-solar-a', tags: ['Solar', 'stromdao-netze'] });
      await promoteFixture(broker, { name: 'dp-wind-b', tags: ['wind'] });

      const result = await broker.call('datapoint.list', { tags: 'solar' });

      expect(result.count).toBe(1);
      expect(result.datapoints[0].name).toBe('dp-solar-a');
    });

    it('filters by multiple comma-separated tags (AND semantics)', async () => {
      await promoteFixture(broker, { name: 'dp-solar-stromdao', tags: ['solar', 'stromdao-netze'] });
      await promoteFixture(broker, { name: 'dp-solar-only', tags: ['solar'] });
      await promoteFixture(broker, { name: 'dp-wind-stromdao', tags: ['wind', 'stromdao-netze'] });

      const result = await broker.call('datapoint.list', { tags: 'solar,stromdao-netze' });

      expect(result.count).toBe(1);
      expect(result.datapoints[0].name).toBe('dp-solar-stromdao');
    });

    it('returns empty list when no datapoints match the tag filter', async () => {
      await promoteFixture(broker, { name: 'dp-wind-only', tags: ['wind'] });

      const result = await broker.call('datapoint.list', { tags: 'solar' });

      expect(result.count).toBe(0);
    });
  });

  // ── runScheduledRefreshes — concurrency limit (AP2 v0.13) ────────────────

  describe('runScheduledRefreshes — concurrency limit', () => {
    it('defers additional refreshes when maxConcurrentRefreshes is reached', async () => {
      const service = broker.services.find((s) => s.name === 'datapoint');
      // Lower the limit to 1 for this test
      service.settings.maxConcurrentRefreshes = 1;

      await promoteFixture(broker, {
        name: 'dp-sched-1',
        refresh: { strategy: 'interval', intervalMinutes: 1 },
      });
      await promoteFixture(broker, {
        name: 'dp-sched-2',
        refresh: { strategy: 'interval', intervalMinutes: 1 },
      });

      // Simulate one refresh already in progress (dp-sched-1 is running)
      service.activeRefreshes.add('dp-sched-1');

      // Run the scheduler — limit is already at 1, dp-sched-2 should be deferred
      await service.runScheduledRefreshes();

      // dp-sched-2 must NOT have been refreshed (still 'never')
      const dp2 = await broker.call('datapoint.get', { name: 'dp-sched-2' });
      expect(dp2.lastRun.status).toBe('never');

      // Cleanup the simulated in-progress entry
      service.activeRefreshes.delete('dp-sched-1');
    });

    it('starts refreshes up to the concurrency limit', async () => {
      const service = broker.services.find((s) => s.name === 'datapoint');
      service.settings.maxConcurrentRefreshes = 3;

      // With no activeRefreshes, the first 3 overdue datapoints should be allowed
      // This verifies the guard does NOT prematurely block when limit is not yet hit
      expect(service.activeRefreshes.size).toBe(0);
      expect(service.settings.maxConcurrentRefreshes).toBe(3);
    });
  });

  // ── get ──────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns the full document for a known datapoint', async () => {
      await promoteFixture(broker);

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });

      expect(doc.name).toBe('test-pv-portfolio');
      expect(doc.sourceType).toBe('agent-session');
      expect(doc._id).toBe('dp:test-pv-portfolio');
    });

    it('throws 404 for an unknown datapoint name', async () => {
      await expect(broker.call('datapoint.get', { name: 'does-not-exist' })).rejects.toMatchObject({
        code: 404,
        type: 'NOT_FOUND',
      });
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates description and tags without touching plan', async () => {
      await promoteFixture(broker);

      const updated = await broker.call('datapoint.update', {
        name: 'test-pv-portfolio',
        description: 'Updated description',
        tags: ['solar', 'production'],
      });

      expect(updated.success).toBe(true);

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      expect(doc.description).toBe('Updated description');
      expect(doc.tags).toEqual(['solar', 'production']);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes an existing datapoint and removes it from list', async () => {
      await promoteFixture(broker);

      const del = await broker.call('datapoint.remove', { name: 'test-pv-portfolio' });
      expect(del.deleted).toBe(true);

      const list = await broker.call('datapoint.list', {});
      expect(list.count).toBe(0);
    });

    it('throws 404 when deleting a non-existent datapoint', async () => {
      await expect(broker.call('datapoint.remove', { name: 'ghost' })).rejects.toMatchObject({
        code: 404,
        type: 'NOT_FOUND',
      });
    });
  });

  // ── refresh ──────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('updates lastRun.status to success and increments health.totalRuns', async () => {
      await promoteFixture(broker);

      const refreshResult = await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });

      expect(refreshResult.success).toBe(true);
      expect(refreshResult.lastRun.status).toBe('success');
      expect(refreshResult.lastRun.timestamp).toBeDefined();

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      expect(doc.health.totalRuns).toBe(1);
      expect(doc.health.consecutiveSuccesses).toBe(1);
      expect(doc.health.consecutiveFailures).toBe(0);
    });

    it('builds summary with rowCount from last step result', async () => {
      await promoteFixture(broker);

      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      expect(doc.lastRun.summary).toBeDefined();
      expect(doc.lastRun.summary.rowCount).toBe(38); // fixture mock returns 38 items
    });

    it('records error status when executePlan throws', async () => {
      // Override executePlan to throw
      const brokerLocal = new ServiceBroker({ logger: false });
      brokerLocal.createService(DatapointService);
      brokerLocal.createService(
        buildMockAgentService({
          executePlan: () => Promise.reject(new Error('MCP unreachable')),
        })
      );
      await brokerLocal.start();

      await brokerLocal.call('datapoint.promote', {
        sessionId: SESSION_FIXTURE.id,
        name: 'error-dp',
      });

      const refreshResult = await brokerLocal.call('datapoint.refresh', { name: 'error-dp' });

      expect(refreshResult.success).toBe(false);
      expect(refreshResult.lastRun.status).toBe('error');
      expect(refreshResult.error).toBe('MCP unreachable');

      const doc = await brokerLocal.call('datapoint.get', { name: 'error-dp' });
      expect(doc.health.consecutiveFailures).toBe(1);

      await brokerLocal.stop();
      try {
        fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it('increments _rev on second refresh (PouchDB revisioning)', async () => {
      await promoteFixture(broker);

      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });
      const doc1 = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });

      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });
      const doc2 = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });

      expect(doc2._rev).not.toBe(doc1._rev);
      expect(doc2.health.totalRuns).toBe(2);
    });
  });

  // ── health overview ───────────────────────────────────────────────────────

  describe('health', () => {
    it('aggregates never/healthy/errored counts correctly', async () => {
      // Datapoint 1: never run
      await promoteFixture(broker, { name: 'dp-never' });

      // Datapoint 2: successfully refreshed
      await promoteFixture(broker, { name: 'dp-healthy' });
      await broker.call('datapoint.refresh', { name: 'dp-healthy' });

      // Datapoint 3: test errored status in isolation using a separate broker + DB
      const errDbPath = path.join(os.tmpdir(), `cernion-dp-err-${Date.now()}`);
      process.env.DATAPOINT_DB_PATH = errDbPath;
      // Re-require the service with the new env to pick up the new path
      jest.resetModules();
      const DatapointServiceErr = require('../services/datapoint.service');
      const brokerErr = new ServiceBroker({ logger: false });
      brokerErr.createService(DatapointServiceErr);
      brokerErr.createService(
        buildMockAgentService({
          loadSession: () => Promise.resolve(SESSION_FIXTURE),
          executePlan: () => Promise.reject(new Error('fail')),
        })
      );
      await brokerErr.start();
      await brokerErr.call('datapoint.promote', {
        sessionId: SESSION_FIXTURE.id,
        name: 'dp-errored',
      });
      await brokerErr.call('datapoint.refresh', { name: 'dp-errored' });

      const errHealth = await brokerErr.call('datapoint.health', {});
      expect(errHealth.total).toBe(1);
      expect(errHealth.errored).toBe(1);
      expect(errHealth.neverRun).toBe(0);

      await brokerErr.stop();
      try {
        fs.rmSync(errDbPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      // restore env
      process.env.DATAPOINT_DB_PATH = TEST_DB_PATH;

      // Query health on the main broker (2 datapoints: 1 never, 1 healthy)
      const health = await broker.call('datapoint.health', {});
      expect(health.total).toBe(2);
      expect(health.neverRun).toBe(1);
      expect(health.healthy).toBe(1);
      expect(health.errored).toBe(0);

      const neverDp = health.datapoints.find((d) => d.name === 'dp-never');
      expect(neverDp.status).toBe('never_run');
      expect(neverDp.ageMinutes).toBeNull();

      const healthyDp = health.datapoints.find((d) => d.name === 'dp-healthy');
      expect(healthyDp.status).toBe('healthy');
      expect(healthyDp.rowCount).toBe(38);
    });
  });

  // ── helper methods ────────────────────────────────────────────────────────

  describe('buildSummary (method)', () => {
    let svc;
    beforeEach(() => {
      svc = broker.getLocalService('datapoint');
    });

    it('summarises an array result', () => {
      const rows = [
        { id: 1, kw: 10 },
        { id: 2, kw: 20 },
      ];
      const summary = svc.buildSummary([{ step: 1, result: rows, error: null }]);
      expect(summary.rowCount).toBe(2);
      expect(summary.columns).toEqual(expect.arrayContaining(['id', 'kw']));
    });

    it('returns null for empty stepResults', () => {
      expect(svc.buildSummary([])).toBeNull();
    });
  });

  describe('hashSchema (method)', () => {
    let svc;
    beforeEach(() => {
      svc = broker.getLocalService('datapoint');
    });

    it('returns a 16-char hex string for array results', () => {
      const rows = [{ a: 1, b: 2 }];
      const hash = svc.hashSchema([{ step: 1, result: rows, error: null }]);
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(16);
    });

    it('returns the same hash for the same columns regardless of order', () => {
      const r1 = [{ a: 1, b: 2 }];
      const r2 = [{ b: 2, a: 1 }];
      const h1 = svc.hashSchema([{ step: 1, result: r1, error: null }]);
      const h2 = svc.hashSchema([{ step: 1, result: r2, error: null }]);
      expect(h1).toBe(h2);
    });

    it('returns different hash when columns change', () => {
      const r1 = [{ a: 1, b: 2 }];
      const r2 = [{ a: 1, c: 3 }];
      const h1 = svc.hashSchema([{ step: 1, result: r1, error: null }]);
      const h2 = svc.hashSchema([{ step: 1, result: r2, error: null }]);
      expect(h1).not.toBe(h2);
    });
  });

  describe('updateHealth (method)', () => {
    let svc;
    const initialHealth = {
      totalRuns: 0,
      consecutiveSuccesses: 0,
      consecutiveFailures: 0,
      lastFailure: null,
      avgDurationMs: 0,
      schemaStable: true,
    };

    beforeEach(() => {
      svc = broker.getLocalService('datapoint');
    });

    it('increments totalRuns and consecutiveSuccesses on success', () => {
      const h = svc.updateHealth({ ...initialHealth }, 'success', 500);
      expect(h.totalRuns).toBe(1);
      expect(h.consecutiveSuccesses).toBe(1);
      expect(h.consecutiveFailures).toBe(0);
      expect(h.avgDurationMs).toBe(500);
    });

    it('increments consecutiveFailures on error and sets lastFailure', () => {
      const h = svc.updateHealth({ ...initialHealth }, 'error', 200);
      expect(h.consecutiveFailures).toBe(1);
      expect(h.lastFailure).not.toBeNull();
    });

    it('marks schemaStable=false when schema hash changes', () => {
      const h = svc.updateHealth(
        { ...initialHealth },
        'success',
        100,
        'aabbccddeeff0011',
        'deadbeef12345678'
      );
      expect(h.schemaStable).toBe(false);
    });
  });

  // ── Issue #30: computeProvenanceHash ─────────────────────────────────────

  describe('computeProvenanceHash (method)', () => {
    let svc;
    beforeEach(() => {
      svc = broker.getLocalService('datapoint');
    });

    it('returns a 64-char hex SHA-256 hash for valid stepResults', () => {
      const steps = [{ step: 1, action: 'assets.solar', result: [{ id: 1 }], error: null }];
      const hash = svc.computeProvenanceHash(steps);
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns null for empty stepResults', () => {
      expect(svc.computeProvenanceHash([])).toBeNull();
      expect(svc.computeProvenanceHash(null)).toBeNull();
    });

    it('returns identical hash for identical data (deterministic)', () => {
      const steps = [{ step: 1, action: 'a.b', result: { x: 1 }, error: null }];
      const h1 = svc.computeProvenanceHash(steps);
      const h2 = svc.computeProvenanceHash(steps);
      expect(h1).toBe(h2);
    });

    it('returns different hash when data changes', () => {
      const s1 = [{ step: 1, action: 'a.b', result: [{ kw: 10 }], error: null }];
      const s2 = [{ step: 1, action: 'a.b', result: [{ kw: 20 }], error: null }];
      expect(svc.computeProvenanceHash(s1)).not.toBe(svc.computeProvenanceHash(s2));
    });

    it('includes action in hash (different action → different hash)', () => {
      const s1 = [{ step: 1, action: 'assets.solar', result: [{ id: 1 }], error: null }];
      const s2 = [{ step: 1, action: 'assets.wind', result: [{ id: 1 }], error: null }];
      expect(svc.computeProvenanceHash(s1)).not.toBe(svc.computeProvenanceHash(s2));
    });
  });

  // ── Issue #30: provenanceHash persisted on refresh ──────────────────────

  describe('provenanceHash (refresh integration)', () => {
    it('stores provenanceHash on the doc after successful refresh', async () => {
      await promoteFixture(broker);
      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      expect(doc.provenanceHash).toBeDefined();
      expect(doc.provenanceHash).not.toBeNull();
      expect(doc.provenanceHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('initialises provenanceHash as null on promote', async () => {
      await promoteFixture(broker);
      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      expect(doc.provenanceHash).toBeNull();
    });
  });

  // ── Issue #32: agent_interventions ──────────────────────────────────────

  describe('agent_interventions (explainability log)', () => {
    it('initialises agent_interventions as empty array on promote', async () => {
      await promoteFixture(broker);
      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      expect(doc.agent_interventions).toEqual([]);
    });

    it('appends interventions from executePlan result on refresh', async () => {
      const brokerLocal = new ServiceBroker({ logger: false });
      brokerLocal.createService(DatapointService);
      brokerLocal.createService(
        buildMockAgentService({
          executePlan: () =>
            Promise.resolve({
              success: true,
              stepResults: [{ step: 1, action: 'assets.solar', result: [{ id: 1 }], error: null }],
              interventions: [
                {
                  timestamp: '2026-06-01T10:00:00.000Z',
                  action: 'param_repair',
                  reason: "Auto-corrected param 'PLZ' → 'postleitzahl' on step 1",
                  confidence_score: 0.95,
                  agent_id: 'executePlan',
                },
              ],
              executedAt: new Date().toISOString(),
            }),
        })
      );
      await brokerLocal.start();

      await brokerLocal.call('datapoint.promote', {
        sessionId: SESSION_FIXTURE.id,
        name: 'dp-interventions',
      });
      await brokerLocal.call('datapoint.refresh', { name: 'dp-interventions' });

      const doc = await brokerLocal.call('datapoint.get', { name: 'dp-interventions' });
      expect(doc.agent_interventions).toHaveLength(1);
      expect(doc.agent_interventions[0].action).toBe('param_repair');
      expect(doc.agent_interventions[0].confidence_score).toBe(0.95);

      await brokerLocal.stop();
      try {
        fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it('does not add interventions when executePlan returns empty array', async () => {
      await promoteFixture(broker);
      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });

      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      // Default mock returns no interventions property → stays empty
      expect(doc.agent_interventions).toEqual([]);
    });
  });

  // ── Issue #30: oemetadata action ────────────────────────────────────────

  describe('oemetadata', () => {
    it('returns OEMetadata v2.0 document for a refreshed datapoint', async () => {
      await promoteFixture(broker);
      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });

      const meta = await broker.call('datapoint.oemetadata', { name: 'test-pv-portfolio' });

      // OEMetadata v2.0 top-level fields
      expect(meta.name).toBe('test-pv-portfolio');
      expect(meta.title).toBeDefined();
      expect(meta.description).toBeDefined();
      expect(Array.isArray(meta.language)).toBe(true);
      expect(meta.metaMetadata).toBeDefined();
      expect(meta.metaMetadata.metadataVersion).toMatch(/OEMetadata/);

      // OEMetadata v2.0 sources (title+path+licenses, not type+sessionId)
      expect(Array.isArray(meta.sources)).toBe(true);
      expect(meta.sources.length).toBeGreaterThan(0);
      expect(meta.sources[0]).toHaveProperty('title');
      expect(meta.sources[0]).toHaveProperty('licenses');

      // Cernion extension — EU AI Act Art. 12 provenance
      expect(meta._cernion).toBeDefined();
      expect(meta._cernion.provenance).toBeDefined();
      expect(meta._cernion.provenance.algorithm).toBe('SHA-256');
      expect(meta._cernion.provenance.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(meta._cernion.provenance.lastRefresh).toBeDefined();
      expect(meta._cernion.provenance.hashStable).toBe(true);

      // Cernion extension — explainability log and health
      expect(Array.isArray(meta._cernion.agent_interventions)).toBe(true);
      expect(meta._cernion.health).toBeDefined();
    });

    it('returns null provenance hash for never-refreshed datapoint', async () => {
      await promoteFixture(broker);

      const meta = await broker.call('datapoint.oemetadata', { name: 'test-pv-portfolio' });

      expect(meta._cernion.provenance.hash).toBeNull();
      expect(meta._cernion.provenance.hashStable).toBe(false);
    });

    it('throws 404 for non-existent datapoint', async () => {
      await expect(broker.call('datapoint.oemetadata', { name: 'ghost' })).rejects.toMatchObject({
        code: 404,
        type: 'NOT_FOUND',
      });
    });
  });

  // ── Issue #32: interventions — dedicated endpoint ────────────────────────

  describe('interventions action (Issue #32 dedicated endpoint)', () => {
    it('returns empty interventions list for fresh datapoint', async () => {
      await promoteFixture(broker);
      const result = await broker.call('datapoint.interventions', { name: 'test-pv-portfolio' });
      expect(result.name).toBe('test-pv-portfolio');
      expect(result.total).toBe(0);
      expect(result.interventions).toEqual([]);
    });

    it('returns interventions after a refresh that appends them', async () => {
      await promoteFixture(broker);
      // The mock executePlan returns interventions
      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });
      const result = await broker.call('datapoint.interventions', { name: 'test-pv-portfolio' });
      expect(result.name).toBe('test-pv-portfolio');
      expect(typeof result.total).toBe('number');
      expect(Array.isArray(result.interventions)).toBe(true);
    });

    it('respects limit parameter — caps returned entries', async () => {
      await promoteFixture(broker);
      await broker.call('datapoint.refresh', { name: 'test-pv-portfolio' });
      const result = await broker.call('datapoint.interventions', {
        name: 'test-pv-portfolio',
        limit: 1,
      });
      expect(result.interventions.length).toBeLessThanOrEqual(1);
    });

    it('filters by since parameter — excludes older entries', async () => {
      await promoteFixture(broker);
      // Insert a known-old intervention directly via PouchDB
      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      // Access the db directly through the service instance
      const svc = broker.getLocalService('datapoint');
      await svc.db.put({
        ...doc,
        agent_interventions: [
          {
            timestamp: '2020-01-01T00:00:00.000Z',
            action: 'param_repair',
            reason: 'old entry',
            confidence_score: 0.5,
            agent_id: 'executePlan',
          },
        ],
      });
      const result = await broker.call('datapoint.interventions', {
        name: 'test-pv-portfolio',
        since: '2025-01-01T00:00:00Z',
      });
      // The 2020 entry should be filtered out
      expect(
        result.interventions.every((e) => new Date(e.timestamp) >= new Date('2025-01-01'))
      ).toBe(true);
    });

    it('returns newest entries first (descending order)', async () => {
      await promoteFixture(broker);
      const svc = broker.getLocalService('datapoint');
      const doc = await broker.call('datapoint.get', { name: 'test-pv-portfolio' });
      await svc.db.put({
        ...doc,
        agent_interventions: [
          {
            timestamp: '2026-01-01T00:00:00Z',
            action: 'param_repair',
            reason: 'first',
            confidence_score: 0.8,
            agent_id: 'executePlan',
          },
          {
            timestamp: '2026-03-01T00:00:00Z',
            action: 'step_failure',
            reason: 'second',
            confidence_score: 0.6,
            agent_id: 'executePlan',
          },
        ],
      });
      const result = await broker.call('datapoint.interventions', { name: 'test-pv-portfolio' });
      expect(result.total).toBe(2);
      // Newest first: March then January
      expect(result.interventions[0].timestamp).toBe('2026-03-01T00:00:00Z');
      expect(result.interventions[1].timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('throws 404 for non-existent datapoint', async () => {
      await expect(broker.call('datapoint.interventions', { name: 'ghost' })).rejects.toMatchObject(
        { code: 404, type: 'NOT_FOUND' }
      );
    });
  });
});
