'use strict';

/**
 * Tests for Snapshot Semantik — datapoint.service.js (v0.13)
 *
 * Covers: createSnapshot, listSnapshots, getSnapshot, validateSnapshot,
 * removeSnapshot, and tag-based snapshot creation.
 *
 * Uses the same isolated PouchDB pattern as datapoint.service.test.js:
 * fresh broker + unique temp dir per test run.
 */

const { ServiceBroker } = require('moleculer');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-snap-test-${Date.now()}`);

process.env.DATAPOINT_DB_PATH = TEST_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

const DatapointService = require('../services/datapoint.service');
const SESSION_FIXTURE = require('./fixtures/session-pv-twl.json');

// ── Helpers ───────────────────────────────────────────────────────────────

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
                    result: Array.from({ length: 10 }, (_, i) => ({ id: i, kw: 5 })),
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

async function promoteDatapoint(broker, name, tags = []) {
  return broker.call('datapoint.promote', {
    sessionId: SESSION_FIXTURE.id,
    name,
    description: `Test datapoint ${name}`,
    tags,
    owner: 'jest',
    fixedParams: {},
    refresh: { strategy: 'manual' },
  });
}

// ── Test suites ───────────────────────────────────────────────────────────

describe('datapoint.service — Snapshot Semantik (v0.13)', () => {
  let broker;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(DatapointService);
    broker.createService(buildMockAgentService());
    await broker.start();
  });

  afterEach(async () => {
    if (broker) await broker.stop();
    try {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── createSnapshot ──────────────────────────────────────────────────────

  describe('createSnapshot', () => {
    it('creates a complete snapshot with 2 datapoints (both refreshed)', async () => {
      await promoteDatapoint(broker, 'dp-alpha');
      await promoteDatapoint(broker, 'dp-beta');

      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-alpha', 'dp-beta'],
        description: 'Test snapshot',
      });

      expect(snap.status).toBe('complete');
      expect(snap.id).toBeDefined();
      expect(snap._id).toBe(`snap:${snap.id}`);
      expect(snap.datapointNames).toEqual(['dp-alpha', 'dp-beta']);
      expect(snap.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
      expect(snap.datapoints).toHaveLength(2);
      expect(snap.datapoints[0].status).toBe('refreshed');
      expect(snap.datapoints[1].status).toBe('refreshed');
      expect(snap.datapoints[0].provenanceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(snap.createdBy).toBe('manual');
      expect(snap.lastValidation).toEqual({ timestamp: null, consistent: null, drift: null });
    });

    it('marks a recently-refreshed datapoint as "fresh" (skips refresh)', async () => {
      await promoteDatapoint(broker, 'dp-fresh');
      // Refresh to give it a recent lastRun
      await broker.call('datapoint.refresh', { name: 'dp-fresh' });

      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-fresh'],
        maxAgeMinutes: 60,
      });

      expect(snap.status).toBe('complete');
      expect(snap.datapoints[0].status).toBe('fresh');
    });

    it('produces partial status when one datapoint does not exist', async () => {
      await promoteDatapoint(broker, 'dp-good');

      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-good', 'dp-nonexistent-xyz'],
      });

      expect(snap.status).toBe('partial');
      expect(snap.snapshotHash).toBeNull();
      const good = snap.datapoints.find((d) => d.name === 'dp-good');
      const bad = snap.datapoints.find((d) => d.name === 'dp-nonexistent-xyz');
      expect(good.status).toBe('refreshed');
      expect(bad.status).toBe('error');
      expect(bad.errorMessage).toContain('dp-nonexistent-xyz');
    });

    it('produces failed status when ALL datapoints fail', async () => {
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['non-existent-a', 'non-existent-b'],
      });

      expect(snap.status).toBe('failed');
      expect(snap.snapshotHash).toBeNull();
      expect(snap.datapoints.every((d) => d.status === 'error')).toBe(true);
    });

    it('accepts optional createdBy parameter', async () => {
      await promoteDatapoint(broker, 'dp-agent-caller');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-agent-caller'],
        createdBy: 'agent',
      });
      expect(snap.createdBy).toBe('agent');
    });

    it('accepts optional name and description', async () => {
      await promoteDatapoint(broker, 'dp-named');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-named'],
        name: 'my-snapshot',
        description: 'Q1 2026 validation',
      });
      expect(snap.name).toBe('my-snapshot');
      expect(snap.description).toBe('Q1 2026 validation');
    });

    it('resolves datapoints by tags (AP3 integration)', async () => {
      await promoteDatapoint(broker, 'dp-tagged-1', ['solar', 'twl-netze']);
      await promoteDatapoint(broker, 'dp-tagged-2', ['solar', 'twl-netze']);
      await promoteDatapoint(broker, 'dp-other-tag', ['wind']);

      const snap = await broker.call('datapoint.createSnapshot', {
        tags: 'solar,twl-netze',
      });

      expect(snap.status).toBe('complete');
      expect(snap.datapointNames).toHaveLength(2);
      expect(snap.datapointNames).toContain('dp-tagged-1');
      expect(snap.datapointNames).toContain('dp-tagged-2');
      expect(snap.datapointNames).not.toContain('dp-other-tag');
    });

    it('throws 400 when neither datapointNames nor tags are provided', async () => {
      await expect(broker.call('datapoint.createSnapshot', {})).rejects.toMatchObject({
        code: 400,
        type: 'MISSING_PARAMS',
      });
    });

    it('throws 404 when tags match no datapoints', async () => {
      await expect(
        broker.call('datapoint.createSnapshot', { tags: 'nonexistent-tag-xyz-abc' })
      ).rejects.toMatchObject({ code: 404, type: 'NO_DATAPOINTS' });
    });

    it('persists snapshot to PouchDB (getSnapshot retrieves it)', async () => {
      await promoteDatapoint(broker, 'dp-persist');
      const created = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-persist'],
      });

      const fetched = await broker.call('datapoint.getSnapshot', { id: created.id });
      expect(fetched.id).toBe(created.id);
      expect(fetched.snapshotHash).toBe(created.snapshotHash);
    });
  });

  // ── listSnapshots ───────────────────────────────────────────────────────

  describe('listSnapshots', () => {
    it('returns empty list when no snapshots exist', async () => {
      const result = await broker.call('datapoint.listSnapshots', {});
      expect(result.count).toBe(0);
      expect(result.snapshots).toEqual([]);
    });

    it('lists all snapshots with summary fields', async () => {
      await promoteDatapoint(broker, 'dp-list');
      await broker.call('datapoint.createSnapshot', { datapointNames: ['dp-list'] });
      await broker.call('datapoint.createSnapshot', { datapointNames: ['dp-list'] });

      const result = await broker.call('datapoint.listSnapshots', {});
      expect(result.count).toBe(2);
      expect(result.snapshots[0]).toHaveProperty('id');
      expect(result.snapshots[0]).toHaveProperty('status');
      expect(result.snapshots[0]).toHaveProperty('datapointCount', 1);
      expect(result.snapshots[0]).toHaveProperty('snapshotHash');
    });

    it('filters by status=complete', async () => {
      await promoteDatapoint(broker, 'dp-filter-status');
      await broker.call('datapoint.createSnapshot', { datapointNames: ['dp-filter-status'] });
      // Create a failed snapshot (no existing datapoint)
      await broker.call('datapoint.createSnapshot', { datapointNames: ['nonexistent-dp-xyz'] });

      const complete = await broker.call('datapoint.listSnapshots', { status: 'complete' });
      const failed = await broker.call('datapoint.listSnapshots', { status: 'failed' });
      expect(complete.count).toBe(1);
      expect(failed.count).toBe(1);
    });
  });

  // ── getSnapshot ─────────────────────────────────────────────────────────

  describe('getSnapshot', () => {
    it('returns full snapshot document with datapoints array', async () => {
      await promoteDatapoint(broker, 'dp-get-snap');
      const created = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-get-snap'],
      });

      const fetched = await broker.call('datapoint.getSnapshot', { id: created.id });
      expect(fetched.id).toBe(created.id);
      expect(fetched.datapoints).toHaveLength(1);
      expect(fetched.datapoints[0].name).toBe('dp-get-snap');
      expect(fetched.snapshotHash).toBe(created.snapshotHash);
    });

    it('throws 404 for unknown snapshot id', async () => {
      await expect(
        broker.call('datapoint.getSnapshot', { id: 'does-not-exist-abc' })
      ).rejects.toMatchObject({ code: 404, type: 'NOT_FOUND' });
    });
  });

  // ── validateSnapshot ────────────────────────────────────────────────────

  describe('validateSnapshot', () => {
    it('returns consistent:true when no datapoints have been refreshed since snapshot', async () => {
      await promoteDatapoint(broker, 'dp-validate-ok');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-validate-ok'],
      });

      const validation = await broker.call('datapoint.validateSnapshot', { id: snap.id });
      expect(validation.consistent).toBe(true);
      expect(validation.drift).toBeNull();
      expect(validation.timestamp).toBeDefined();
    });

    it('returns consistent:false with drift when a datapoint provenanceHash has changed', async () => {
      await promoteDatapoint(broker, 'dp-drift-detect');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-drift-detect'],
      });
      expect(snap.status).toBe('complete');
      const originalHash = snap.datapoints[0].provenanceHash;

      // Directly overwrite the provenanceHash in PouchDB to simulate a subsequent refresh
      const service = broker.services.find((s) => s.name === 'datapoint');
      const dpDoc = await service.db.get('dp:dp-drift-detect');
      dpDoc.provenanceHash = 'a'.repeat(64); // synthetic new hash (different data)
      await service.db.put(dpDoc);

      const validation = await broker.call('datapoint.validateSnapshot', { id: snap.id });
      expect(validation.consistent).toBe(false);
      expect(validation.drift).toHaveLength(1);
      expect(validation.drift[0].name).toBe('dp-drift-detect');
      expect(validation.drift[0].snapshotHash).toBe(originalHash);
      expect(validation.drift[0].currentHash).toBe('a'.repeat(64));
    });

    it('persists lastValidation back to snapshot document', async () => {
      await promoteDatapoint(broker, 'dp-val-persist');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-val-persist'],
      });

      await broker.call('datapoint.validateSnapshot', { id: snap.id });

      const updated = await broker.call('datapoint.getSnapshot', { id: snap.id });
      expect(updated.lastValidation.timestamp).toBeDefined();
      expect(updated.lastValidation.consistent).toBe(true);
    });

    it('skips error entries (null provenanceHash) when computing drift', async () => {
      // Create a partial snapshot (one good, one missing)
      await promoteDatapoint(broker, 'dp-partial-good');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-partial-good', 'dp-partial-missing'],
      });
      expect(snap.status).toBe('partial');

      // Validate: should only compare the good entry, skip the error entry
      const validation = await broker.call('datapoint.validateSnapshot', { id: snap.id });
      expect(validation.consistent).toBe(true); // good entry hash unchanged
      expect(validation.drift).toBeNull();
    });

    it('throws 404 for unknown snapshot id', async () => {
      await expect(
        broker.call('datapoint.validateSnapshot', { id: 'ghost-snap' })
      ).rejects.toMatchObject({ code: 404, type: 'NOT_FOUND' });
    });
  });

  // ── removeSnapshot ──────────────────────────────────────────────────────

  describe('removeSnapshot', () => {
    it('deletes a snapshot and confirms deletion', async () => {
      await promoteDatapoint(broker, 'dp-rm-snap');
      const snap = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-rm-snap'],
      });

      const result = await broker.call('datapoint.removeSnapshot', { id: snap.id });
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.id).toBe(snap.id);

      // Subsequent get must return 404
      await expect(broker.call('datapoint.getSnapshot', { id: snap.id })).rejects.toMatchObject({
        code: 404,
      });
    });

    it('throws 404 for unknown snapshot id', async () => {
      await expect(
        broker.call('datapoint.removeSnapshot', { id: 'no-such-snap-xyz' })
      ).rejects.toMatchObject({ code: 404, type: 'NOT_FOUND' });
    });

    it('does not affect other snapshots', async () => {
      await promoteDatapoint(broker, 'dp-rm-multi');
      const snap1 = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-rm-multi'],
      });
      const snap2 = await broker.call('datapoint.createSnapshot', {
        datapointNames: ['dp-rm-multi'],
      });

      await broker.call('datapoint.removeSnapshot', { id: snap1.id });

      const list = await broker.call('datapoint.listSnapshots', {});
      expect(list.count).toBe(1);
      expect(list.snapshots[0].id).toBe(snap2.id);
    });
  });
});
