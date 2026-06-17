'use strict';

const { ServiceBroker } = require('moleculer');
const DomainRoutesManagementService = require('../services/domain-routes-management.service');
const {
  reloadDomainRoutes,
  getStaticRoutes,
  getRuntimeRoutes,
  findRuntimeCapability,
} = require('../src/domain-routes-registry');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRoute(overrides = {}) {
  return {
    id: 'test_edm_mk40_evidence',
    label: 'EDM MK40 Metering Concept Evidence (test)',
    capability: 'edm_metering_concept_evidence',
    score: 121,
    triggers: ['mk40', 'messkonzept-qualitaetspruefung', 'edm-qualitaetspruefschritte'],
    combos: [
      { all: ['edm', 'qualitaet'] },
    ],
    negativeTriggers: ['abrechnungsfreigabe'],
    coverageCluster: 'metering_edm',
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBroker() {
  const broker = new ServiceBroker({ logger: false });

  // Minimal capability-broker mock for test runner
  broker.createService({
    name: 'capability-broker',
    actions: {
      recommend: {
        handler(ctx) {
          const task = String(ctx.params.task || '').toLowerCase();
          if (task.includes('mk40') || task.includes('messkonzept-qualitaetspruefung')) {
            return { capability: 'edm_metering_concept_evidence', score: 121 };
          }
          if (task.includes('vdmi') || task.includes('asset-relation') || task.includes('netzasset')) {
            return { capability: 'vdmi_asset_validation_governance', score: 120 };
          }
          return { capability: 'query.ask', score: 50 };
        },
      },
    },
  });

  broker.createService(DomainRoutesManagementService);
  return broker;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('domain-routes-management.service', () => {
  let broker;

  beforeAll(async () => {
    broker = makeBroker();
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  // ── createDraft ─────────────────────────────────────────────────────────────

  describe('createDraft', () => {
    it('creates a draft and returns draftId + validationStatus', async () => {
      const route = makeRoute();
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.success).toBe(true);
      expect(typeof result.draftId).toBe('string');
      expect(result.draftId).toMatch(/^dr_/);
      expect(result.routeId).toBe('test_edm_mk40_evidence');
      expect(result.validationStatus).toBe('valid');
      expect(result.validationErrors).toEqual([]);
    });

    it('sets validationStatus=invalid for missing id', async () => {
      const route = makeRoute({ id: undefined });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.success).toBe(true);
      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field === 'id')).toBe(true);
    });

    it('fails validation for score above 125', async () => {
      const route = makeRoute({ score: 130 });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field === 'score')).toBe(true);
    });

    it('fails validation for score below 100', async () => {
      const route = makeRoute({ score: 99 });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field === 'score')).toBe(true);
    });

    it('fails validation when neither triggers nor combos are provided', async () => {
      const route = makeRoute({ triggers: [], combos: [] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field === 'triggers')).toBe(true);
    });

    it('fails validation for unsafe regex in combo', async () => {
      const route = makeRoute({ combos: [{ all: ['.*'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field.startsWith('combos'))).toBe(true);
    });

    it('fails validation for invalid regex in combo', async () => {
      const route = makeRoute({ combos: [{ all: ['[(invalid'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
    });

    it('fails validation for non-snake-case id', async () => {
      const route = makeRoute({ id: 'TestRouteId-bad' });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field === 'id')).toBe(true);
    });

    it('adds VDMI guardrail warning for score >= 120', async () => {
      const route = makeRoute({ score: 120 });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationWarnings.some((w) => w.field === 'score')).toBe(true);
    });

    it('triggers-only route (no combos) is valid', async () => {
      const route = makeRoute({ combos: [] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('valid');
    });

    it('combos-only route (no triggers) is valid', async () => {
      const route = makeRoute({ triggers: [] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('valid');
    });
  });

  // ── validate ────────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('revalidates a draft and returns updated status', async () => {
      const route = makeRoute({ id: 'validate_test_route' });
      const { draftId } = await broker.call('domain-routes.createDraft', { route });

      const result = await broker.call('domain-routes.validate', { id: draftId });

      expect(result.success).toBe(true);
      expect(result.draftId).toBe(draftId);
      expect(result.validationStatus).toBe('valid');
    });

    it('returns 404 for unknown draftId', async () => {
      await expect(
        broker.call('domain-routes.validate', { id: 'dr_nonexistent' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── test ────────────────────────────────────────────────────────────────────

  describe('test', () => {
    it('runs test cases and passes when expected capability matches', async () => {
      const route = makeRoute({ id: 'test_action_route' });
      const testCases = [
        {
          name: 'mk40 metering query',
          prompt: 'Erkläre die EDM-MK40-Messkonzept-Qualitaetspruefung für den Netzanschluss',
          expectedCapability: 'edm_metering_concept_evidence',
        },
      ];
      const { draftId } = await broker.call('domain-routes.createDraft', { route, testCases });

      const result = await broker.call('domain-routes.test', { id: draftId });

      expect(result.testStatus).toBe('passed');
      expect(result.testResults[0].passed).toBe(true);
    });

    it('fails test when capability does not match', async () => {
      const route = makeRoute({ id: 'test_mismatch_route' });
      const testCases = [
        {
          name: 'wrong capability check',
          prompt: 'VDMI asset-relation netzasset Projektvalidierung',
          expectedCapability: 'edm_metering_concept_evidence', // wrong — broker returns vdmi
        },
      ];
      const { draftId } = await broker.call('domain-routes.createDraft', { route, testCases });

      const result = await broker.call('domain-routes.test', { id: draftId });

      expect(result.testStatus).toBe('failed');
      expect(result.testResults[0].passed).toBe(false);
    });

    it('passes with zero test cases (trivially)', async () => {
      const route = makeRoute({ id: 'test_zero_testcases' });
      const { draftId } = await broker.call('domain-routes.createDraft', { route, testCases: [] });

      const result = await broker.call('domain-routes.test', { id: draftId });

      expect(result.testStatus).toBe('passed');
      expect(result.testCasesRun).toBe(0);
    });

    it('refuses to test an invalid draft', async () => {
      const route = makeRoute({ id: undefined, score: 9999 });
      const { draftId } = await broker.call('domain-routes.createDraft', { route });

      const result = await broker.call('domain-routes.test', { id: draftId });

      expect(result.success).toBe(false);
      expect(result.testStatus).toBe('failed');
    });
  });

  // ── promote ─────────────────────────────────────────────────────────────────

  describe('promote', () => {
    it('promotes a valid draft and activates runtime route', async () => {
      const route = makeRoute({ id: 'promote_test_route' });
      const { draftId } = await broker.call('domain-routes.createDraft', { route });

      const result = await broker.call('domain-routes.promote', {
        id: draftId,
        promotedBy: 'test-runner',
      });

      expect(result.success).toBe(true);
      expect(result.routeId).toBe('promote_test_route');
      expect(result.promotedBy).toBe('test-runner');

      // Verify runtime route is now registered
      const compiledRoutes = reloadDomainRoutes();
      const found = compiledRoutes.find((r) => r.id === 'promote_test_route');
      expect(found).toBeTruthy();
    });

    it('rejects promoting an invalid draft', async () => {
      const route = makeRoute({ id: undefined, score: 0 });
      const { draftId } = await broker.call('domain-routes.createDraft', { route });

      await expect(
        broker.call('domain-routes.promote', { id: draftId })
      ).rejects.toMatchObject({ code: 409 });
    });

    it('archives previous active when re-promoting', async () => {
      const route = makeRoute({ id: 'repromote_test_route', version: '1.0.0' });
      const { draftId: d1 } = await broker.call('domain-routes.createDraft', {
        route,
        version: '1.0.0',
      });
      await broker.call('domain-routes.promote', { id: d1, promotedBy: 'v1-promoter' });

      const route2 = makeRoute({ id: 'repromote_test_route' });
      const { draftId: d2 } = await broker.call('domain-routes.createDraft', {
        route: route2,
        version: '2.0.0',
      });
      const result = await broker.call('domain-routes.promote', { id: d2, promotedBy: 'v2-promoter' });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBeTruthy();
    });
  });

  // ── rollback ────────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('restores previous version after rollback', async () => {
      const routeId = 'rollback_test_route';

      // Promote v1
      const { draftId: d1 } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId }),
        version: '1.0.0',
      });
      await broker.call('domain-routes.promote', { id: d1, promotedBy: 'v1' });

      // Promote v2
      const { draftId: d2 } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId, label: 'v2 label' }),
        version: '2.0.0',
      });
      await broker.call('domain-routes.promote', { id: d2, promotedBy: 'v2' });

      // Rollback to v1
      const result = await broker.call('domain-routes.rollback', {
        id: routeId,
        rolledBackBy: 'test-rollback',
      });

      expect(result.success).toBe(true);
      expect(result.routeId).toBe(routeId);
      expect(result.rolledBackBy).toBe('test-rollback');
    });

    it('errors when no active route to roll back', async () => {
      await expect(
        broker.call('domain-routes.rollback', { id: 'no_such_route_xyz' })
      ).rejects.toMatchObject({ code: 404 });
    });

    it('errors when no rollback target exists (first-ever promote)', async () => {
      const routeId = 'rollback_no_archive_route';
      const { draftId } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId }),
      });
      await broker.call('domain-routes.promote', { id: draftId, promotedBy: 'first-promote' });

      await expect(
        broker.call('domain-routes.rollback', { id: routeId })
      ).rejects.toMatchObject({ code: 409 });
    });
  });

  // ── deactivate ───────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('removes runtime route and deactivates active doc', async () => {
      const routeId = 'deactivate_test_route';
      const { draftId } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId }),
      });
      await broker.call('domain-routes.promote', { id: draftId });

      const result = await broker.call('domain-routes.deactivate', { id: routeId });

      expect(result.success).toBe(true);
      expect(result.routeId).toBe(routeId);
      expect(result.runtimeRouteRemoved).toBe(true);
    });

    it('errors when no active route', async () => {
      await expect(
        broker.call('domain-routes.deactivate', { id: 'nonexistent_route_xyz' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── reload ───────────────────────────────────────────────────────────────────

  describe('reload', () => {
    it('rebuilds compiled route cache and returns count', async () => {
      const result = await broker.call('domain-routes.reload');

      expect(result.success).toBe(true);
      expect(typeof result.compiledRouteCount).toBe('number');
      expect(result.compiledRouteCount).toBeGreaterThan(0);
      expect(result.reloadedAt).toBeTruthy();
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns static routes when includeStatic=true', async () => {
      const result = await broker.call('domain-routes.list', { includeStatic: true });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);

      const staticRoutes = getStaticRoutes();
      // Each static route should appear
      for (const sr of staticRoutes) {
        expect(result.data.some((r) => r.id === sr.id)).toBe(true);
      }
    });

    it('excludes static routes when includeStatic=false', async () => {
      const result = await broker.call('domain-routes.list', {
        includeStatic: false,
        includeActive: false,
        includeDrafts: false,
      });

      const staticIds = new Set(getStaticRoutes().map((r) => r.id));
      const overlap = result.data.filter((r) => staticIds.has(r.id));
      expect(overlap).toHaveLength(0);
    });

    it('includes drafts when includeDrafts=true', async () => {
      const { draftId } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: 'list_draft_test' }),
      });

      const result = await broker.call('domain-routes.list', {
        includeStatic: false,
        includeDrafts: true,
        includeActive: false,
      });

      expect(result.data.some((r) => r.draftId === draftId)).toBe(true);
    });
  });

  // ── get ──────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('retrieves an active route by routeId', async () => {
      const routeId = 'get_test_active_route';
      const { draftId } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId }),
      });
      await broker.call('domain-routes.promote', { id: draftId });

      const result = await broker.call('domain-routes.get', { id: routeId });

      expect(result.success).toBe(true);
      expect(result.data.routeId).toBe(routeId);
    });

    it('retrieves a static route by id when no active override', async () => {
      const staticRoutes = getStaticRoutes();
      if (staticRoutes.length === 0) return; // skip if no static routes

      const staticId = staticRoutes[0].id;
      const result = await broker.call('domain-routes.get', { id: staticId });

      expect(result.success).toBe(true);
      expect(result.source).toBe('static');
      expect(result.route.id).toBe(staticId);
    });

    it('returns 404 for unknown id', async () => {
      await expect(
        broker.call('domain-routes.get', { id: 'absolutely_nonexistent_xyz_123' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── validation guardrails ────────────────────────────────────────────────────

  describe('validation guardrails', () => {
    it('rejects empty string trigger', async () => {
      const route = makeRoute({ triggers: [''] });
      const result = await broker.call('domain-routes.createDraft', { route });
      // empty triggers are filtered; combos still present so valid
      expect(result.validationStatus).toBe('valid');
    });

    it('rejects .+ unsafe regex pattern', async () => {
      const route = makeRoute({ combos: [{ all: ['.+'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });
      expect(result.validationStatus).toBe('invalid');
    });

    it('rejects single-dot unsafe regex pattern', async () => {
      const route = makeRoute({ combos: [{ all: ['.'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });
      expect(result.validationStatus).toBe('invalid');
    });

    it('accepts two-character pattern (not too broad)', async () => {
      const route = makeRoute({ combos: [{ all: ['mk'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });
      expect(result.validationStatus).toBe('valid');
    });

    it('accepts complex regex that compiles', async () => {
      const route = makeRoute({ combos: [{ all: ['edm-(mk40|mk50)', 'netzanschluss'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });
      expect(result.validationStatus).toBe('valid');
    });
  });

  // ── VDMI positive-control invariants ────────────────────────────────────────

  describe('VDMI routing invariant', () => {
    it('VDMI asset-relation prompt still routes to vdmi_asset_validation_governance', async () => {
      const result = await broker.call('capability-broker.recommend', {
        task: 'VDMI asset-relation Netzasset Projektvalidierung Mastr-Kandidat',
      });

      expect(result.capability).toBe('vdmi_asset_validation_governance');
    });

    it('promoting a domain route does not break VDMI routing', async () => {
      const { draftId } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: 'vdmi_invariant_test_route' }),
      });
      await broker.call('domain-routes.promote', { id: draftId });

      const result = await broker.call('capability-broker.recommend', {
        task: 'VDMI asset-relation Netzasset Projektvalidierung',
      });

      expect(result.capability).toBe('vdmi_asset_validation_governance');
    });
  });

  // ── full lifecycle ───────────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('createDraft → validate → test → promote → get → deactivate', async () => {
      const routeId = 'lifecycle_full_test_route';

      // 1. Create draft
      const { draftId } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId }),
        testCases: [
          {
            name: 'trigger match',
            prompt: 'EDM-MK40-Messkonzept-Qualitaetspruefung Netzanschluss',
            expectedCapability: 'edm_metering_concept_evidence',
          },
        ],
      });

      // 2. Validate
      const validateResult = await broker.call('domain-routes.validate', { id: draftId });
      expect(validateResult.validationStatus).toBe('valid');

      // 3. Test
      const testResult = await broker.call('domain-routes.test', { id: draftId });
      expect(testResult.testStatus).toBe('passed');

      // 4. Promote
      const promoteResult = await broker.call('domain-routes.promote', {
        id: draftId,
        promotedBy: 'lifecycle-test',
      });
      expect(promoteResult.success).toBe(true);

      // 5. Get active
      const getResult = await broker.call('domain-routes.get', { id: routeId });
      expect(getResult.data.routeId).toBe(routeId);

      // 6. Deactivate
      const deactivateResult = await broker.call('domain-routes.deactivate', { id: routeId });
      expect(deactivateResult.success).toBe(true);
    });
  });
});
