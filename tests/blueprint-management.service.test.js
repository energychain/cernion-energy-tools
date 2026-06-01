'use strict';

const { ServiceBroker } = require('moleculer');
const BlueprintManagementService = require('../services/blueprint-management.service');
const { loadBlueprint, listBlueprints, _resetCache } = require('../src/blueprint-registry');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBlueprint(overrides = {}) {
  return {
    $schema: 'https://cernion.ai/schemas/blueprint.v1.json',
    id: 'test-ev-co2-v1',
    version: '1.0.0',
    meta: {
      title: 'Test EV CO2 Optimization',
      description: 'Unit-test blueprint for blueprint management service.',
      targetAudience: 'end_user',
    },
    routing: {
      intentSignals: ['laden', 'co2', 'ev'],
      negativeSignals: ['redispatch'],
      priorityBoost: 3,
    },
    inputs: {
      postalCode: {
        type: 'string',
        required: true,
        semanticType: 'OEO:PostalCode',
        resolveStrategy: { method: 'llm_extraction', prompt: 'PLZ?' },
      },
    },
    execution: {
      steps: [
        {
          id: 'fetch_co2',
          action: 'energy-market.co2Intensity',
          params: { location: '{{inputs.postalCode}}', forecast: true },
        },
      ],
    },
    postProcessing: {
      calculations: { energy: 'inputs.hours * 11' },
      mappings: {
        optimal: {
          strategy: 'find_lowest_contiguous_average',
          source: 'steps.fetch_co2.output.data.forecast',
          windowSize: 4,
        },
      },
    },
    synthesis: {
      evidenceRequired: ['steps.fetch_co2.output'],
      templates: {
        success: 'Lade ab Stunde {{postProcessing.optimal.startIndex}}.',
        error: 'Fehler: keine Daten.',
      },
    },
    persistence: {
      l3_facts: { optimalWindow: 'postProcessing.optimal' },
    },
    ...overrides,
  };
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

describe('blueprint-management.service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    // Mock the energy-market service so action registry checks work
    broker.createService({
      name: 'energy-market',
      actions: {
        co2Intensity: {
          params: { location: { type: 'string' }, forecast: { type: 'boolean', optional: true } },
          handler() {
            return { success: true, data: { forecast: [] } };
          },
        },
        prices: {
          params: {
            market: { type: 'string' },
            region: { type: 'string' },
          },
          handler() {
            return { prices: [] };
          },
        },
      },
    });

    broker.createService({
      ...BlueprintManagementService,
      settings: {
        ...BlueprintManagementService.settings,
        dbPath: `./data/blueprint-registry-test-${Date.now()}`,
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    _resetCache();
  });

  beforeEach(() => {
    _resetCache();
  });

  // ── createDraft ─────────────────────────────────────────────────────────────

  describe('createDraft', () => {
    test('creates a valid draft and returns draftId', async () => {
      const result = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint(),
        createdBy: 'test-agent',
      });

      expect(result.success).toBe(true);
      expect(typeof result.draftId).toBe('string');
      expect(result.draftId.length).toBe(16); // 8 bytes hex
      expect(result.blueprintId).toBe('test-ev-co2-v1');
      expect(result.validationStatus).toBe('valid');
      expect(result.validationErrors).toHaveLength(0);
    });

    test('rejects blueprint with missing id', async () => {
      const bp = makeBlueprint({ id: '' });
      await expect(
        broker.call('blueprint-management.createDraft', { blueprint: bp })
      ).rejects.toThrow(/invalid/i);
    });

    test('rejects blueprint with invalid id pattern (uppercase)', async () => {
      const bp = makeBlueprint({ id: 'Test-Blueprint-V1' });
      await expect(
        broker.call('blueprint-management.createDraft', { blueprint: bp })
      ).rejects.toThrow(/invalid/i);
    });

    test('stores draft with validationStatus=invalid for schema violations', async () => {
      const bp = makeBlueprint({ meta: null }); // null meta is invalid
      const result = await broker.call('blueprint-management.createDraft', {
        blueprint: bp,
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.length).toBeGreaterThan(0);
      expect(result.validationErrors[0].field).toContain('meta');
    });

    test('rejects blueprint with injection pattern in meta title', async () => {
      const bp = makeBlueprint({
        meta: {
          title: 'Hack; rm -rf /',
          description: 'Description.',
          targetAudience: 'end_user',
        },
      });
      const result = await broker.call('blueprint-management.createDraft', { blueprint: bp });
      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => /injection/i.test(e.message))).toBe(true);
    });

    test('detects evidenceRequired referencing unknown step', async () => {
      const bp = makeBlueprint({
        synthesis: {
          evidenceRequired: ['steps.nonexistent_step.output'],
          templates: { success: 'OK', error: 'fail' },
        },
      });
      const result = await broker.call('blueprint-management.createDraft', { blueprint: bp });
      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.message.includes('nonexistent_step'))).toBe(
        true
      );
    });

    test('action availability warnings do not block draft creation', async () => {
      const bp = makeBlueprint({
        id: 'test-unknown-action-v1',
        execution: {
          steps: [{ id: 'step1', action: 'nonexistent-service.someAction', params: {} }],
        },
        synthesis: {
          evidenceRequired: ['steps.step1.output'],
          templates: { success: 'OK', error: 'fail' },
        },
      });

      const result = await broker.call('blueprint-management.createDraft', {
        blueprint: bp,
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe('valid'); // schema is valid
      expect(result.validationWarnings.some((w) => w.code === 'ACTION_UNAVAILABLE')).toBe(true);
    });

    test('stores sourceAgent and sourceConversationId in audit trail', async () => {
      const result = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'audit-trail-test-v1' }),
        createdBy: 'copilot-agent',
        sourceConversationId: 'conv-12345',
        sourceAgent: 'hermes-v2',
      });

      expect(result.data.createdBy).toBe('copilot-agent');
      expect(result.data.sourceConversationId).toBe('conv-12345');
      expect(result.data.sourceAgent).toBe('hermes-v2');
    });
  });

  // ── list ────────────────────────────────────────────────────────────────────

  describe('list', () => {
    test('returns list including created drafts', async () => {
      await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'list-test-draft-v1' }),
      });

      const result = await broker.call('blueprint-management.list', {});
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);

      const found = result.data.find((d) => d.blueprintId === 'list-test-draft-v1');
      expect(found).toBeDefined();
    });

    test('filters by blueprintId', async () => {
      await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'filtered-list-test-v1' }),
      });

      const result = await broker.call('blueprint-management.list', {
        blueprintId: 'filtered-list-test-v1',
      });

      expect(result.data.every((d) => d.blueprintId === 'filtered-list-test-v1')).toBe(true);
    });
  });

  // ── get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    test('retrieves draft by draftId', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'get-by-draftid-v1' }),
      });

      const result = await broker.call('blueprint-management.get', {
        id: created.draftId,
      });

      expect(result.success).toBe(true);
      expect(result.data.draftId).toBe(created.draftId);
      expect(result.blueprint.id).toBe('get-by-draftid-v1');
    });

    test('throws 404 for unknown id', async () => {
      await expect(
        broker.call('blueprint-management.get', { id: 'nonexistent-id-xyz' })
      ).rejects.toThrow();
    });
  });

  // ── validate ────────────────────────────────────────────────────────────────

  describe('validate', () => {
    test('re-validates a draft and updates status', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'validate-rerun-v1' }),
      });

      const result = await broker.call('blueprint-management.validate', {
        id: created.draftId,
      });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe('valid');
      expect(result.draftId).toBe(created.draftId);
    });
  });

  // ── test ────────────────────────────────────────────────────────────────────

  describe('test', () => {
    test('returns passed for valid draft', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'test-dry-run-v1' }),
      });

      const result = await broker.call('blueprint-management.test', { id: created.draftId });

      expect(result.testStatus).toBe('passed');
      expect(result.blueprintId).toBe('test-dry-run-v1');
    });

    test('returns failed for invalid draft', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'invalid-test-v1', meta: null }),
      });

      const result = await broker.call('blueprint-management.test', { id: created.draftId });

      expect(result.success).toBe(false);
      expect(result.testStatus).toBe('failed');
      expect(result.reason).toMatch(/validation errors/i);
    });
  });

  // ── promote ─────────────────────────────────────────────────────────────────

  describe('promote', () => {
    test('promotes valid draft to active', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'promote-test-v1' }),
        createdBy: 'test-user',
      });

      const result = await broker.call('blueprint-management.promote', {
        id: created.draftId,
        promotedBy: 'admin@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.blueprintId).toBe('promote-test-v1');
      expect(result.promotedBy).toBe('admin@example.com');
      expect(typeof result.activatedAt).toBe('string');
    });

    test('promoted blueprint appears in loadBlueprint()', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'registry-overlay-test-v1' }),
      });

      await broker.call('blueprint-management.promote', {
        id: created.draftId,
        promotedBy: 'admin',
      });

      // The registry overlay should now return this blueprint
      const loaded = loadBlueprint('registry-overlay-test-v1');
      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe('registry-overlay-test-v1');
      expect(loaded.meta.title).toBe('Test EV CO2 Optimization');
    });

    test('promoted blueprint appears in listBlueprints()', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'list-overlay-test-v1' }),
      });

      await broker.call('blueprint-management.promote', {
        id: created.draftId,
        promotedBy: 'admin',
      });

      const list = listBlueprints();
      const found = list.find((b) => b.id === 'list-overlay-test-v1');
      expect(found).toBeDefined();
      expect(found.source).toBe('runtime');
    });

    test('refuses to promote invalid draft', async () => {
      const created = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: 'bad-promote-v1', meta: null }),
      });

      await expect(
        broker.call('blueprint-management.promote', {
          id: created.draftId,
          promotedBy: 'admin',
        })
      ).rejects.toThrow(/valid drafts/i);
    });

    test('records previousVersion on second promotion of same blueprint', async () => {
      const bpId = 'versioning-test-v1';

      // First promote
      const d1 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '1.0.0' }),
      });
      const p1 = await broker.call('blueprint-management.promote', {
        id: d1.draftId,
        promotedBy: 'admin',
      });
      expect(p1.previousVersion).toBeNull();

      // Second promote
      const d2 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '1.1.0' }),
      });
      const p2 = await broker.call('blueprint-management.promote', {
        id: d2.draftId,
        promotedBy: 'admin',
      });

      expect(p2.previousVersion).toBe('1.0.0');
    });
  });

  // ── rollback ─────────────────────────────────────────────────────────────────

  describe('rollback', () => {
    test('restores previous version after promote', async () => {
      const bpId = 'rollback-test-v1';

      // Promote v1
      const d1 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '1.0.0' }),
      });
      await broker.call('blueprint-management.promote', {
        id: d1.draftId,
        promotedBy: 'admin',
      });

      // Promote v2
      const d2 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '2.0.0' }),
      });
      await broker.call('blueprint-management.promote', {
        id: d2.draftId,
        promotedBy: 'admin',
      });

      // Verify active is v2
      const beforeRollback = loadBlueprint(bpId);
      expect(beforeRollback.version).toBe('2.0.0');

      // Rollback
      const result = await broker.call('blueprint-management.rollback', {
        id: bpId,
        rolledBackBy: 'ops@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.rolledBackBy).toBe('ops@example.com');
    });

    test('runtime overlay reflects rolled back version', async () => {
      const bpId = 'overlay-rollback-test-v1';

      const d1 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '1.0.0' }),
      });
      await broker.call('blueprint-management.promote', { id: d1.draftId, promotedBy: 'admin' });

      const d2 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '2.0.0' }),
      });
      await broker.call('blueprint-management.promote', { id: d2.draftId, promotedBy: 'admin' });

      await broker.call('blueprint-management.rollback', { id: bpId, rolledBackBy: 'admin' });

      const loaded = loadBlueprint(bpId);
      expect(loaded.version).toBe('1.0.0');
    });

    test('rollback fails when no previous version exists', async () => {
      const bpId = 'no-rollback-test-v1';

      const d1 = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId, version: '1.0.0' }),
      });
      await broker.call('blueprint-management.promote', { id: d1.draftId, promotedBy: 'admin' });

      await expect(broker.call('blueprint-management.rollback', { id: bpId })).rejects.toThrow(
        /no rollback target/i
      );
    });

    test('rollback fails when blueprint is not active', async () => {
      await expect(
        broker.call('blueprint-management.rollback', { id: 'never-promoted-blueprint' })
      ).rejects.toThrow();
    });
  });

  // ── deactivate ───────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    test('removes runtime blueprint and clears registry overlay', async () => {
      const bpId = 'deactivate-test-v1';
      const d = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId }),
      });
      await broker.call('blueprint-management.promote', { id: d.draftId, promotedBy: 'admin' });

      expect(loadBlueprint(bpId)).not.toBeNull();

      const result = await broker.call('blueprint-management.deactivate', { id: bpId });
      expect(result.success).toBe(true);

      // No longer in runtime overlay — falls back to repo (or null if not in repo)
      const reloaded = loadBlueprint(bpId);
      // The test blueprint is not in src/blueprints, so should be null after deactivate
      expect(reloaded).toBeNull();
    });
  });

  // ── registry overlay tests ───────────────────────────────────────────────────

  describe('registry overlay (integration)', () => {
    test('repo blueprints are still accessible after runtime overlay addition', async () => {
      // ev-charging-co2-optimization-v1 is in src/blueprints/
      const repoBp = loadBlueprint('ev-charging-co2-optimization-v1');
      expect(repoBp).not.toBeNull();
      expect(repoBp.id).toBe('ev-charging-co2-optimization-v1');
      expect(repoBp.meta.targetAudience).toBe('end_user');
    });

    test('runtime blueprint overrides repo blueprint of same id', async () => {
      const bpId = 'ev-charging-co2-optimization-v1'; // same as repo blueprint
      const overrideBp = makeBlueprint({ id: bpId, version: '99.0.0' });
      overrideBp.meta.title = 'Runtime Override Test';

      const d = await broker.call('blueprint-management.createDraft', {
        blueprint: overrideBp,
      });
      await broker.call('blueprint-management.promote', { id: d.draftId, promotedBy: 'admin' });

      const loaded = loadBlueprint(bpId);
      expect(loaded.version).toBe('99.0.0');
      expect(loaded.meta.title).toBe('Runtime Override Test');

      // Cleanup: deactivate to restore repo version
      await broker.call('blueprint-management.deactivate', { id: bpId });
      const restored = loadBlueprint(bpId);
      expect(restored.version).not.toBe('99.0.0');
    });

    test('listBlueprints marks runtime entries with source=runtime', async () => {
      const bpId = 'list-source-test-v1';
      const d = await broker.call('blueprint-management.createDraft', {
        blueprint: makeBlueprint({ id: bpId }),
      });
      await broker.call('blueprint-management.promote', { id: d.draftId, promotedBy: 'admin' });

      const list = listBlueprints();
      const runtimeEntry = list.find((b) => b.id === bpId);
      const repoEntry = list.find((b) => b.id === 'ev-charging-co2-optimization-v1');

      expect(runtimeEntry?.source).toBe('runtime');
      expect(repoEntry?.source).toBe('repo');
    });
  });
});
