'use strict';

const { ServiceBroker } = require('moleculer');
const DomainRoutesManagementService = require('../services/domain-routes-management.service');
const {
  reloadDomainRoutes,
  getStaticRoutes,
  getRuntimeRoutes,
  getRuntimeRoute,
  findRuntimeCapability,
  _resetRegistry,
} = require('../src/domain-routes-registry');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRoute(overrides = {}) {
  return {
    id: 'test_edm_mk40_evidence',
    label: 'EDM MK40 Metering Concept Evidence (test)',
    capability: 'edm_metering_concept_evidence',
    score: 121,
    triggers: ['mk40', 'messkonzept-qualitaetspruefung', 'edm-qualitaetspruefschritte'],
    combos: [{ all: ['edm', 'qualitaet'] }],
    negativeTriggers: ['abrechnungsfreigabe'],
    coverageCluster: 'metering_edm',
    ...overrides,
  };
}

// ── Test Setup ────────────────────────────────────────────────────────────────

const TEST_DB_PATH = `./data/domain-routes-registry-test-${Date.now()}`;

function makeBroker() {
  const broker = new ServiceBroker({ logger: false });

  // Capability-broker mock that inspects current runtime routes so we can verify
  // that the test endpoint temporarily installs the draft route.
  broker.createService({
    name: 'capability-broker',
    actions: {
      recommend: {
        handler(ctx) {
          const task = String(ctx.params.task || '').toLowerCase();

          // Check runtime routes so temporary-install tests can pass/fail correctly
          const runtimeIds = new Set(getRuntimeRoutes().map((r) => r.id));

          if (
            (task.includes('mk40') || task.includes('messkonzept-qualitaetspruefung')) &&
            runtimeIds.has('draft_only_test_route')
          ) {
            return { capability: 'draft_only_gap_capability', score: 121 };
          }
          if (task.includes('mk40') || task.includes('messkonzept-qualitaetspruefung')) {
            return { capability: 'edm_metering_concept_evidence', score: 121 };
          }
          if (
            task.includes('vdmi') ||
            task.includes('asset-relation') ||
            task.includes('netzasset')
          ) {
            return { capability: 'vdmi_asset_validation_governance', score: 120 };
          }
          return { capability: 'query.ask', score: 50 };
        },
      },
    },
  });

  broker.createService({
    ...DomainRoutesManagementService,
    settings: {
      ...DomainRoutesManagementService.settings,
      dbPath: TEST_DB_PATH,
    },
  });

  return broker;
}

describe('domain-routes-management.service', () => {
  let broker;

  beforeAll(async () => {
    broker = makeBroker();
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    _resetRegistry();
  });

  beforeEach(() => {
    _resetRegistry();
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

    it('fails validation for unsafe regex .* in combo', async () => {
      const route = makeRoute({ combos: [{ all: ['.*'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field.startsWith('combos'))).toBe(true);
    });

    it('fails validation for unsafe regex .+ in combo', async () => {
      const route = makeRoute({ combos: [{ all: ['.+'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
    });

    it('fails validation for single-dot regex in combo', async () => {
      const route = makeRoute({ combos: [{ all: ['.'] }] });
      const result = await broker.call('domain-routes.createDraft', { route });

      expect(result.validationStatus).toBe('invalid');
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

    it('temporarily installs draft route so broker sees it during test run', async () => {
      // draft_only_test_route is NOT in static routes and NOT in the registry.
      // The mock capability-broker returns 'draft_only_gap_capability' only when
      // 'draft_only_test_route' is present in getRuntimeRoutes() during the call.
      const route = makeRoute({
        id: 'draft_only_test_route',
        capability: 'draft_only_gap_capability',
        triggers: ['messkonzept-qualitaetspruefung'],
        combos: [],
      });
      const testCases = [
        {
          name: 'draft-only route visible during test',
          prompt: 'EDM Messkonzept-Qualitaetspruefung Netzanschluss',
          expectedCapability: 'draft_only_gap_capability',
        },
      ];
      const { draftId } = await broker.call('domain-routes.createDraft', { route, testCases });

      // Verify route is NOT in runtime before the test call
      expect(getRuntimeRoute('draft_only_test_route')).toBeNull();

      const result = await broker.call('domain-routes.test', { id: draftId });

      // Draft-only route was installed during test → test case should pass
      expect(result.testStatus).toBe('passed');

      // After test completes, route must NOT remain in the runtime overlay
      expect(getRuntimeRoute('draft_only_test_route')).toBeNull();
    });

    it('cleans up runtime overlay even when test cases fail', async () => {
      const route = makeRoute({
        id: 'cleanup_on_fail_test_route',
        capability: 'some_gap_cap',
        triggers: ['unique-cleanup-trigger'],
        combos: [],
      });
      const testCases = [
        {
          name: 'expected to fail',
          prompt: 'something unrelated',
          expectedCapability: 'this_will_not_match',
        },
      ];
      const { draftId } = await broker.call('domain-routes.createDraft', { route, testCases });

      const result = await broker.call('domain-routes.test', { id: draftId });

      expect(result.testStatus).toBe('failed');
      // Cleanup still happens
      expect(getRuntimeRoute('cleanup_on_fail_test_route')).toBeNull();
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

      // Runtime route is now registered
      const compiledRoutes = reloadDomainRoutes();
      const found = compiledRoutes.find((r) => r.id === 'promote_test_route');
      expect(found).toBeTruthy();
    });

    it('rejects promoting an invalid draft', async () => {
      const route = makeRoute({ id: undefined, score: 0 });
      const { draftId } = await broker.call('domain-routes.createDraft', { route });

      await expect(broker.call('domain-routes.promote', { id: draftId })).rejects.toMatchObject({
        code: 409,
      });
    });

    it('archives previous active when re-promoting', async () => {
      const route = makeRoute({ id: 'repromote_test_route' });
      const { draftId: d1 } = await broker.call('domain-routes.createDraft', {
        route,
        version: '1.0.0',
      });
      await broker.call('domain-routes.promote', { id: d1, promotedBy: 'v1-promoter' });

      const { draftId: d2 } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: 'repromote_test_route' }),
        version: '2.0.0',
      });
      const result = await broker.call('domain-routes.promote', {
        id: d2,
        promotedBy: 'v2-promoter',
      });

      expect(result.success).toBe(true);
      expect(result.previousVersion).toBeTruthy();
      expect(result.data.rollbackTarget).toBeTruthy(); // rollbackTarget is set
    });

    it('re-promoting the same version still sets rollbackTarget (no archive collision)', async () => {
      // This tests the fix for finding #1: archive ID collision.
      const routeId = 'same_version_repromote_route';
      const routeV1 = makeRoute({ id: routeId });

      // Promote v1 twice with the same version string
      const { draftId: d1 } = await broker.call('domain-routes.createDraft', {
        route: routeV1,
        version: '1.0.0',
      });
      await broker.call('domain-routes.promote', { id: d1, promotedBy: 'first' });

      const { draftId: d2 } = await broker.call('domain-routes.createDraft', {
        route: routeV1,
        version: '1.0.0', // same version — used to cause archive collision
      });
      const result = await broker.call('domain-routes.promote', { id: d2, promotedBy: 'second' });

      // Must have a rollback target despite same version
      expect(result.success).toBe(true);
      expect(result.data.rollbackTarget).toBeTruthy();

      // Rollback must succeed
      const rbResult = await broker.call('domain-routes.rollback', { id: routeId });
      expect(rbResult.success).toBe(true);
    });
  });

  // ── rollback ────────────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('restores previous version after rollback', async () => {
      const routeId = 'rollback_test_route';

      const { draftId: d1 } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId }),
        version: '1.0.0',
      });
      await broker.call('domain-routes.promote', { id: d1, promotedBy: 'v1' });

      const { draftId: d2 } = await broker.call('domain-routes.createDraft', {
        route: makeRoute({ id: routeId, label: 'v2 label' }),
        version: '2.0.0',
      });
      await broker.call('domain-routes.promote', { id: d2, promotedBy: 'v2' });

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

      await expect(broker.call('domain-routes.rollback', { id: routeId })).rejects.toMatchObject({
        code: 409,
      });
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
      if (staticRoutes.length === 0) return;

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

  // ── runtime gap capability constraints ───────────────────────────────────────

  describe('runtime gap capability action constraints', () => {
    it('warns on non-placeholder preferredActions', async () => {
      const route = makeRoute({
        id: 'unsafe_actions_test_route',
        preferredActions: ['vdmi.dossier', 'interface-placeholder.markGap'],
      });
      const result = await broker.call('domain-routes.createDraft', { route });

      const hasActionWarning = result.validationWarnings.some(
        (w) => w.field === 'preferredActions' && w.message.includes('vdmi.dossier')
      );
      expect(hasActionWarning).toBe(true);
      // Should still be valid (warning, not error)
      expect(result.validationStatus).toBe('valid');
    });

    it('warns on non-placeholder fallbackActions', async () => {
      const route = makeRoute({
        id: 'unsafe_fallback_test_route',
        fallbackActions: ['query.ask'],
      });
      const result = await broker.call('domain-routes.createDraft', { route });

      const hasActionWarning = result.validationWarnings.some((w) => w.field === 'fallbackActions');
      expect(hasActionWarning).toBe(true);
    });

    it('buildGapMarkerCapability drops non-placeholder actions and uses safe fallback', async () => {
      const routeId = 'gap_cap_action_filter_route';
      const route = makeRoute({
        id: routeId,
        capability: 'gap_cap_action_filter_capability',
        // This non-placeholder action must be dropped by buildGapMarkerCapability
        preferredActions: ['vdmi.dossier', 'query.ask'],
        fallbackActions: ['interface-placeholder.requestEvidence'],
      });

      const { draftId } = await broker.call('domain-routes.createDraft', { route });
      await broker.call('domain-routes.promote', { id: draftId });

      // Runtime capability should have been materialized (capability not in static catalog)
      const runtimeCap = findRuntimeCapability('gap_cap_action_filter_capability');
      expect(runtimeCap).toBeTruthy();

      // Non-placeholder actions must have been dropped → fallback to safe default
      expect(runtimeCap.preferredActions.every((a) => a.startsWith('interface-placeholder.'))).toBe(
        true
      );

      // fallbackActions kept the one safe entry
      expect(runtimeCap.fallbackActions).toEqual(['interface-placeholder.requestEvidence']);
    });

    it('buildGapMarkerCapability keeps all-placeholder preferredActions unchanged', async () => {
      const routeId = 'gap_cap_safe_actions_route';
      const route = makeRoute({
        id: routeId,
        capability: 'gap_cap_safe_actions_capability',
        preferredActions: [
          'interface-placeholder.markGap',
          'interface-placeholder.requestEvidence',
        ],
      });

      const { draftId } = await broker.call('domain-routes.createDraft', { route });
      await broker.call('domain-routes.promote', { id: draftId });

      const runtimeCap = findRuntimeCapability('gap_cap_safe_actions_capability');
      expect(runtimeCap).toBeTruthy();
      expect(runtimeCap.preferredActions).toEqual([
        'interface-placeholder.markGap',
        'interface-placeholder.requestEvidence',
      ]);
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

      const validateResult = await broker.call('domain-routes.validate', { id: draftId });
      expect(validateResult.validationStatus).toBe('valid');

      const testResult = await broker.call('domain-routes.test', { id: draftId });
      expect(testResult.testStatus).toBe('passed');

      const promoteResult = await broker.call('domain-routes.promote', {
        id: draftId,
        promotedBy: 'lifecycle-test',
      });
      expect(promoteResult.success).toBe(true);

      const getResult = await broker.call('domain-routes.get', { id: routeId });
      expect(getResult.data.routeId).toBe(routeId);

      const deactivateResult = await broker.call('domain-routes.deactivate', { id: routeId });
      expect(deactivateResult.success).toBe(true);
    });
  });
});
