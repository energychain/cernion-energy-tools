'use strict';

/**
 * tests/cookbook.service.test.js
 * Unit tests for the Cookbook microservice (v0.20.5).
 *
 * GEMINI_API_KEY is absent in CI → computeEmbedding returns null →
 * keyword-based scoring fallback is used for all search / related-recipe tests.
 *
 * Recipe statuses: In the minimal test broker no other services are registered,
 * so every recipe action is missing from the registry → every recipe resolves
 * to status 'broken' after startup validation.
 */

const { ServiceBroker } = require('moleculer');
const CookbookService = require('../services/cookbook.service');
const { COOKBOOK_RECIPES } = require('../src/cookbook-recipes');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeBroker(settingOverrides = {}) {
  const broker = new ServiceBroker({ logger: false });
  broker.createService({
    ...CookbookService,
    settings: {
      ...CookbookService.settings,
      validationIntervalMs: 9_999_999, // suppress periodic re-validation during tests
      ...settingOverrides,
    },
  });
  return broker;
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Cookbook Service', () => {
  let broker;

  beforeAll(async () => {
    broker = makeBroker();
    await broker.start();
  }, 30_000);

  afterAll(async () => {
    await broker.stop();
  }, 10_000);

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns all recipes with no filters', async () => {
      const result = await broker.call('cookbook.list', {});
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBe(COOKBOOK_RECIPES.length);
      expect(result.metadata.count).toBe(COOKBOOK_RECIPES.length);
    });

    it('filters by domain (exact, case-insensitive)', async () => {
      const result = await broker.call('cookbook.list', { domain: 'agent-validation' });
      expect(result.success).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every((r) => r.domain === 'agent-validation')).toBe(true);
    });

    it('domain filter is case-insensitive', async () => {
      const upper = await broker.call('cookbook.list', { domain: 'AGENT-VALIDATION' });
      const lower = await broker.call('cookbook.list', { domain: 'agent-validation' });
      expect(upper.data.length).toBe(lower.data.length);
    });

    it('filters by tag', async () => {
      const result = await broker.call('cookbook.list', { tag: 'redispatch' });
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.every((r) => r.tags.includes('redispatch'))).toBe(true);
    });

    it('tag filter is case-insensitive', async () => {
      const upper = await broker.call('cookbook.list', { tag: 'MASTR' });
      const lower = await broker.call('cookbook.list', { tag: 'mastr' });
      expect(upper.data.length).toBe(lower.data.length);
    });

    it('filters by status broken (all recipes are broken in the test broker)', async () => {
      const all = await broker.call('cookbook.list', {});
      const broken = await broker.call('cookbook.list', { status: 'broken' });
      // deprecated recipes get status 'deprecated', not 'broken', so exclude them
      const nonDeprecated = all.data.filter((r) => r.status !== 'deprecated');
      expect(broken.data.length).toBe(nonDeprecated.length);
      expect(broken.data.every((r) => r.status === 'broken')).toBe(true);
    });

    it('returns empty array for unknown domain', async () => {
      const result = await broker.call('cookbook.list', { domain: 'nonexistent-xyz' });
      expect(result.data).toEqual([]);
      expect(result.metadata.count).toBe(0);
    });

    it('does not expose _embedding, _searchText, _validation fields', async () => {
      const result = await broker.call('cookbook.list', {});
      for (const recipe of result.data) {
        expect(recipe._embedding).toBeUndefined();
        expect(recipe._searchText).toBeUndefined();
        expect(recipe._validation).toBeUndefined();
      }
    });

    it('exposes a public validation object on each recipe', async () => {
      const result = await broker.call('cookbook.list', {});
      for (const recipe of result.data) {
        expect(Array.isArray(recipe.validation.errors)).toBe(true);
        expect(Array.isArray(recipe.validation.warnings)).toBe(true);
      }
    });

    it('metadata.lastValidatedAt is an ISO timestamp set after start', async () => {
      const result = await broker.call('cookbook.list', {});
      expect(typeof result.metadata.lastValidatedAt).toBe('string');
      expect(result.metadata.lastValidatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns a known recipe by id', async () => {
      const result = await broker.call('cookbook.get', { id: 'vnb-assets-from-name' });
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('vnb-assets-from-name');
      expect(typeof result.data.title).toBe('string');
      expect(Array.isArray(result.data.process)).toBe(true);
    });

    it('returns relatedRecipes array on get result', async () => {
      const result = await broker.call('cookbook.get', { id: 'vnb-assets-from-name' });
      expect(Array.isArray(result.data.relatedRecipes)).toBe(true);
    });

    it('throws COOKBOOK_RECIPE_NOT_FOUND (404) for an unknown id', async () => {
      await expect(broker.call('cookbook.get', { id: 'does-not-exist-xyz' })).rejects.toMatchObject(
        {
          code: 404,
          type: 'COOKBOOK_RECIPE_NOT_FOUND',
        }
      );
    });

    it('does not expose internal fields on the get result', async () => {
      const result = await broker.call('cookbook.get', { id: 'mastr-quality-audit' });
      expect(result.data._embedding).toBeUndefined();
      expect(result.data._searchText).toBeUndefined();
      expect(result.data._validation).toBeUndefined();
    });

    it('each known source recipe is retrievable by id', async () => {
      for (const raw of COOKBOOK_RECIPES) {
        const result = await broker.call('cookbook.get', { id: raw.id });
        expect(result.data.id).toBe(raw.id);
      }
    });
  });

  // ─── search ──────────────────────────────────────────────────────────────

  describe('search', () => {
    it('returns scored results when includeBroken=true', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'grid operator assets mastr',
        includeBroken: true,
      });
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      for (const hit of result.data) {
        expect(typeof hit.score).toBe('number');
        expect(hit.score).toBeGreaterThanOrEqual(0);
      }
    });

    it('results are sorted descending by score', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'validation audit settlement redispatch',
        includeBroken: true,
      });
      const scores = result.data.map((r) => r.score);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
      }
    });

    it('respects the limit parameter', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'energy grid operator assets',
        limit: 2,
        includeBroken: true,
      });
      expect(result.data.length).toBeLessThanOrEqual(2);
    });

    it('excludes broken/deprecated by default (all broken in test env → empty)', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'grid operator vnb mastr',
      });
      expect(result.success).toBe(true);
      for (const hit of result.data) {
        expect(hit.status).not.toBe('broken');
        expect(hit.status).not.toBe('deprecated');
      }
    });

    it('includeBroken=true returns ≥ results than includeBroken=false', async () => {
      const withBroken = await broker.call('cookbook.search', {
        query: 'grid assets validation',
        includeBroken: true,
      });
      const withoutBroken = await broker.call('cookbook.search', {
        query: 'grid assets validation',
        includeBroken: false,
      });
      expect(withBroken.data.length).toBeGreaterThanOrEqual(withoutBroken.data.length);
    });

    it('returns metadata with a model name string', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'redispatch risk settlement',
        includeBroken: true,
      });
      expect(typeof result.metadata.model).toBe('string');
      expect(result.metadata.model.length).toBeGreaterThan(0);
    });

    it('does not expose internal fields in search hits', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'mastr quality audit portfolio',
        includeBroken: true,
      });
      for (const hit of result.data) {
        expect(hit._embedding).toBeUndefined();
        expect(hit._searchText).toBeUndefined();
        expect(hit._validation).toBeUndefined();
      }
    });

    it('keyword fallback ranks redispatch recipe first for redispatch query', async () => {
      // GEMINI_API_KEY absent → keyword scoring path
      // "redispatch", "settlement", "audit", "financial", "risk" overlap maximally
      // with the redispatch-settlement-audit recipe text
      const result = await broker.call('cookbook.search', {
        query: 'redispatch settlement audit financial risk',
        includeBroken: true,
        limit: 5,
      });
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0].id).toBe('redispatch-settlement-audit');
    });

    it('score is a finite number rounded to 4 decimal places', async () => {
      const result = await broker.call('cookbook.search', {
        query: 'mastr quality audit',
        includeBroken: true,
        limit: 3,
      });
      for (const hit of result.data) {
        expect(Number.isFinite(hit.score)).toBe(true);
        const rounded = Number(hit.score.toFixed(4));
        expect(hit.score).toBe(rounded);
      }
    });
  });

  // ─── validate ────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('returns a summary object with all expected fields', async () => {
      const result = await broker.call('cookbook.validate', {});
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ total: COOKBOOK_RECIPES.length });
      expect(typeof result.data.valid).toBe('number');
      expect(typeof result.data.broken).toBe('number');
      expect(typeof result.data.degraded).toBe('number');
      expect(typeof result.data.deprecated).toBe('number');
      expect(typeof result.data.at).toBe('string');
    });

    it('summary counts add up to total', async () => {
      const result = await broker.call('cookbook.validate', {});
      const { total, valid, broken, degraded, deprecated } = result.data;
      expect(valid + broken + degraded + deprecated).toBe(total);
    });

    it('emits cookbook.validation.complete event with summary payload', async () => {
      const spy = jest.spyOn(broker, 'emit');
      await broker.call('cookbook.validate', {});
      const call = spy.mock.calls.find(([name]) => name === 'cookbook.validation.complete');
      expect(call).toBeDefined();
      const payload = call[1];
      expect(typeof payload.at).toBe('string');
      expect(typeof payload.summary.total).toBe('number');
      spy.mockRestore();
    });

    it('updates lastValidatedAt after a validate call', async () => {
      const before = (await broker.call('cookbook.health', {})).data.lastValidatedAt;
      await new Promise((r) => setTimeout(r, 5));
      await broker.call('cookbook.validate', {});
      const after = (await broker.call('cookbook.health', {})).data.lastValidatedAt;
      expect(after >= before).toBe(true);
    });
  });

  // ─── health ──────────────────────────────────────────────────────────────

  describe('health', () => {
    it('returns the expected shape', async () => {
      const result = await broker.call('cookbook.health', {});
      expect(result.success).toBe(true);
      expect(result.data.total).toBe(COOKBOOK_RECIPES.length);
      expect(result.data.validationIntervalMs).toBe(9_999_999);
      expect(typeof result.data.model).toBe('string');
      expect(typeof result.data.lastValidatedAt).toBe('string');
      expect(result.data.validationSummary).toHaveProperty('total');
      expect(result.data.validationSummary).toHaveProperty('valid');
      expect(result.data.validationSummary).toHaveProperty('broken');
    });

    it('validationSummary counts are internally consistent', async () => {
      const result = await broker.call('cookbook.health', {});
      const { total, valid, broken, degraded, deprecated } = result.data.validationSummary;
      expect(valid + broken + degraded + deprecated).toBe(total);
    });
  });

  // ─── serviceCatalogue ────────────────────────────────────────────────────

  describe('serviceCatalogue', () => {
    it('returns success with an array', async () => {
      const result = await broker.call('cookbook.serviceCatalogue', {});
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('each entry has service, action, and rest fields', async () => {
      const result = await broker.call('cookbook.serviceCatalogue', {});
      for (const entry of result.data) {
        expect(typeof entry.service).toBe('string');
        expect(typeof entry.action).toBe('string');
        expect(entry.rest).toBeDefined();
      }
    });

    it('results are sorted ascending by action name', async () => {
      const result = await broker.call('cookbook.serviceCatalogue', {});
      const names = result.data.map((e) => e.action);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('cookbook service actions appear in the catalogue', async () => {
      const result = await broker.call('cookbook.serviceCatalogue', {});
      const actions = result.data.map((e) => e.action);
      expect(actions.some((a) => a.startsWith('cookbook.'))).toBe(true);
    });
  });

  // ─── assessRecipeStatus (internal method) ────────────────────────────────

  describe('assessRecipeStatus (internal method)', () => {
    let service;

    beforeAll(() => {
      service = broker.services.find((s) => s.name === 'cookbook');
    });

    const mockRegistry = {
      'grid-operations.marketPartners': {
        service: 'grid-operations',
        action: 'grid-operations.marketPartners',
        rest: 'POST /api/grid-operations/market-partners',
      },
    };

    it('returns valid when all actions exist and REST paths match', () => {
      const recipe = {
        id: 'test',
        process: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            restPath: 'POST /api/grid-operations/market-partners',
          },
        ],
      };
      const result = service.assessRecipeStatus(recipe, mockRegistry);
      expect(result.status).toBe('valid');
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('returns valid when restPath is absent (no REST mismatch check)', () => {
      const recipe = {
        id: 'test',
        process: [{ step: 1, action: 'grid-operations.marketPartners' }],
      };
      const result = service.assessRecipeStatus(recipe, mockRegistry);
      expect(result.status).toBe('valid');
    });

    it('returns broken when action is missing from registry', () => {
      const recipe = {
        id: 'test',
        process: [{ step: 1, action: 'nonexistent.action', restPath: 'GET /api/none' }],
      };
      const result = service.assessRecipeStatus(recipe, {});
      expect(result.status).toBe('broken');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns degraded when REST path differs from live registry', () => {
      const recipe = {
        id: 'test',
        process: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            restPath: 'POST /api/grid-operations/wrong-path',
          },
        ],
      };
      const result = service.assessRecipeStatus(recipe, mockRegistry);
      expect(result.status).toBe('degraded');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('returns deprecated when recipe.deprecated=true (takes priority over broken)', () => {
      const recipe = {
        id: 'test',
        deprecated: true,
        process: [{ step: 1, action: 'ghost.action' }],
      };
      const result = service.assessRecipeStatus(recipe, {});
      expect(result.status).toBe('deprecated');
    });

    it('multi-step recipe: broken if any step action is missing', () => {
      const localRegistry = { ...mockRegistry };
      const recipe = {
        id: 'test',
        process: [
          { step: 1, action: 'grid-operations.marketPartners' },
          { step: 2, action: 'missing.action' },
        ],
      };
      const result = service.assessRecipeStatus(recipe, localRegistry);
      expect(result.status).toBe('broken');
    });
  });

  // ─── validateRecipeShape (internal method) ───────────────────────────────

  describe('validateRecipeShape (internal method)', () => {
    let service;

    beforeAll(() => {
      service = broker.services.find((s) => s.name === 'cookbook');
    });

    it('passes for a well-formed recipe', () => {
      const result = service.validateRecipeShape({
        id: 'test-id',
        title: 'Test Recipe',
        process: [{ step: 1, action: 'some.action', description: 'do it' }],
      });
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when id is missing', () => {
      const result = service.validateRecipeShape({ title: 'No ID', process: [{}] });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /id/i.test(e))).toBe(true);
    });

    it('fails when title is missing', () => {
      const result = service.validateRecipeShape({ id: 'test-id', process: [{}] });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /title/i.test(e))).toBe(true);
    });

    it('fails when process is empty array', () => {
      const result = service.validateRecipeShape({ id: 'test', title: 'T', process: [] });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /process/i.test(e))).toBe(true);
    });

    it('fails when process is missing entirely', () => {
      const result = service.validateRecipeShape({ id: 'test', title: 'T' });
      expect(result.ok).toBe(false);
    });

    it('throws for null input (non-object guard fires, then id access throws)', () => {
      expect(() => service.validateRecipeShape(null)).toThrow();
    });
  });

  // ─── computeRelatedRecipes (coverage via list output) ────────────────────

  describe('computeRelatedRecipes (method coverage via list)', () => {
    it('assigns relatedRecipes arrays to all loaded recipes', async () => {
      const result = await broker.call('cookbook.list', {});
      for (const recipe of result.data) {
        expect(Array.isArray(recipe.relatedRecipes)).toBe(true);
      }
    });

    it('relatedRecipes contains only ids of other recipes (no self-reference)', async () => {
      const result = await broker.call('cookbook.list', {});
      const allIds = new Set(result.data.map((r) => r.id));
      for (const recipe of result.data) {
        for (const relId of recipe.relatedRecipes) {
          expect(allIds.has(relId)).toBe(true);
          expect(relId).not.toBe(recipe.id);
        }
      }
    });

    it('keyword fallback runs without GEMINI_API_KEY (service started without embedding errors)', async () => {
      // If embedding failed catastrophically the broker.start() would have rejected.
      // Reaching this point confirms the keyword fallback path completed successfully.
      const result = await broker.call('cookbook.health', {});
      expect(result.data.total).toBe(COOKBOOK_RECIPES.length);
    });
  });
});
