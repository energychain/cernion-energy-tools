'use strict';

// ─── LLM mock (must be hoisted before service require) ────────────────────────
const mockGenerateStructured = jest.fn();
jest.mock('../src/llm-client', () => ({
  generateStructured: mockGenerateStructured,
  SchemaType: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
  },
}));

const { ServiceBroker } = require('moleculer');
const DecisionFrameService = require('../services/decision-frame.service');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFrame(overrides = {}) {
  return {
    situation:
      'Versorgungsgebiet 44021 hat 280 EV-Ladepunkte, aber kein aktives §14a-Steuermodell.',
    complication:
      '§14a EnWG verlangt Steuerbarkeit aller NS-Lasten >4,2 kW bis Gate-Datum 2026-09-30. Aktuelle Coverage: 22 %.',
    question:
      'Welche Asset-Gruppen müssen bis Q3 priorisiert werden, um Gate-Konformität zu erreichen?',
    domain: 'infrastructure',
    ...overrides,
  };
}

const STARTER_LLM_RESPONSE = {
  situation: 'KI-generierte Ausgangslage.',
  complication: 'KI-generierte Komplikation.',
  question: 'KI-generierte Kernfrage?',
  suggestedDomain: 'infrastructure',
  confidence: 'medium',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('decision-frame.service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    // Mock ZNP service for generateStarter downstream calls
    broker.createService({
      name: 'znp',
      actions: {
        getProjectMeta: {
          handler() {
            return { projectId: 'proj-test-001', name: 'Test-Netz', layers: ['L0'], assetCount: 42 };
          },
        },
        strategicPrompts: {
          handler() {
            return { questions: ['Welche Assets sind Typ-B?', 'Wann ist Gate-Datum?'] };
          },
        },
      },
    });

    broker.createService({
      ...DecisionFrameService,
      settings: {
        ...DecisionFrameService.settings,
        dbPath: `./data/decision-frames-test-${Date.now()}`,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    mockGenerateStructured.mockReset();
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('returns a frame with generated frameId and status=draft', async () => {
      const result = await broker.call('decision-frame.create', makeFrame());
      expect(result.frameId).toMatch(/^df-[0-9a-f]{12}$/);
      expect(result.status).toBe('draft');
      expect(result.situation).toContain('280 EV-Ladepunkte');
      expect(result.linkedEntities).toEqual([]);
      expect(result.answer).toBeNull();
    });

    it('stores domain and role correctly', async () => {
      const result = await broker.call(
        'decision-frame.create',
        makeFrame({ domain: 'regulatory', role: 'finance' })
      );
      expect(result.domain).toBe('regulatory');
      expect(result.role).toBe('finance');
    });

    it('stores optional answer when provided', async () => {
      const result = await broker.call(
        'decision-frame.create',
        makeFrame({ answer: 'Rollout 180 Steuereinheiten bis Q3.' })
      );
      expect(result.answer).toBe('Rollout 180 Steuereinheiten bis Q3.');
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      const result = await broker.call('decision-frame.create', makeFrame());
      expect(new Date(result.createdAt)).not.toBeNaN();
      expect(result.createdAt).toBe(result.updatedAt);
    });

    it('rejects when situation is too short', async () => {
      await expect(
        broker.call('decision-frame.create', makeFrame({ situation: 'kurz' }))
      ).rejects.toThrow();
    });

    it('rejects when domain is invalid', async () => {
      await expect(
        broker.call('decision-frame.create', makeFrame({ domain: 'invalid_domain' }))
      ).rejects.toThrow();
    });
  });

  // ── get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('retrieves a created frame by frameId', async () => {
      const created = await broker.call('decision-frame.create', makeFrame());
      const fetched = await broker.call('decision-frame.get', { frameId: created.frameId });
      expect(fetched.frameId).toBe(created.frameId);
      expect(fetched.situation).toBe(created.situation);
    });

    it('throws 404 for unknown frameId', async () => {
      await expect(
        broker.call('decision-frame.get', { frameId: 'df-000000000000' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── update ───────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('sets answer and increments updatedAt', async () => {
      const created = await broker.call('decision-frame.create', makeFrame());
      await new Promise((r) => setTimeout(r, 5)); // ensure timestamp diff
      const updated = await broker.call('decision-frame.update', {
        frameId: created.frameId,
        answer: 'Rollout Phase 1 + VDMI-Nominierung.',
      });
      expect(updated.answer).toBe('Rollout Phase 1 + VDMI-Nominierung.');
      expect(updated.updatedAt > updated.createdAt).toBe(true);
    });

    it('promotes status to active', async () => {
      const created = await broker.call('decision-frame.create', makeFrame());
      const updated = await broker.call('decision-frame.update', {
        frameId: created.frameId,
        status: 'active',
      });
      expect(updated.status).toBe('active');
    });

    it('clears answer when null string passed', async () => {
      const created = await broker.call(
        'decision-frame.create',
        makeFrame({ answer: 'Initial answer.' })
      );
      const updated = await broker.call('decision-frame.update', {
        frameId: created.frameId,
        answer: '',
      });
      expect(updated.answer).toBeNull();
    });

    it('throws 404 for unknown frameId', async () => {
      await expect(
        broker.call('decision-frame.update', { frameId: 'df-000000000000', status: 'active' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── linkEntity ───────────────────────────────────────────────────────────────

  describe('linkEntity', () => {
    it('appends a new entity link', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      const updated = await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'znp_project',
        entityId: 'proj-lu-001',
      });
      expect(updated.linkedEntities).toHaveLength(1);
      expect(updated.linkedEntities[0]).toMatchObject({
        type: 'znp_project',
        id: 'proj-lu-001',
      });
      expect(updated.linkedEntities[0].linkedAt).toBeDefined();
    });

    it('is idempotent — same link twice produces one entry', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'vdmi_matrix',
        entityId: 'vdmi-nn-44021',
      });
      const second = await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'vdmi_matrix',
        entityId: 'vdmi-nn-44021',
      });
      expect(second.linkedEntities).toHaveLength(1);
    });

    it('allows linking multiple different entities', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'znp_project',
        entityId: 'proj-lu-001',
      });
      const updated = await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'process_intent',
        entityId: 'pi-001',
      });
      expect(updated.linkedEntities).toHaveLength(2);
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns all frames without filter', async () => {
      await broker.call('decision-frame.create', makeFrame({ domain: 'strategic' }));
      const { frames } = await broker.call('decision-frame.list', {});
      expect(frames.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by domain', async () => {
      await broker.call('decision-frame.create', makeFrame({ domain: 'financial' }));
      const { frames } = await broker.call('decision-frame.list', { domain: 'financial' });
      expect(frames.every((f) => f.domain === 'financial')).toBe(true);
    });

    it('filters by status', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      await broker.call('decision-frame.update', { frameId: frame.frameId, status: 'closed' });
      const { frames } = await broker.call('decision-frame.list', { status: 'closed' });
      expect(frames.every((f) => f.status === 'closed')).toBe(true);
    });

    it('filters by linkedEntityId via post-filter', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'investment_plan',
        entityId: 'plan-unique-abc',
      });
      const { frames } = await broker.call('decision-frame.list', {
        linkedEntityId: 'plan-unique-abc',
      });
      expect(frames).toHaveLength(1);
      expect(frames[0].frameId).toBe(frame.frameId);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 3; i++) {
        await broker.call('decision-frame.create', makeFrame({ domain: 'operational' }));
      }
      const { frames } = await broker.call('decision-frame.list', {
        domain: 'operational',
        limit: 2,
      });
      expect(frames.length).toBeLessThanOrEqual(2);
    });
  });

  // ── generateStarter ──────────────────────────────────────────────────────────

  describe('generateStarter', () => {
    it('returns AI-generated starter fields', async () => {
      mockGenerateStructured.mockResolvedValueOnce(STARTER_LLM_RESPONSE);
      const result = await broker.call('decision-frame.generateStarter', {
        contextHint: 'Netzengpass in Bezirk 44021',
        domain: 'infrastructure',
      });
      expect(result.situation).toBe('KI-generierte Ausgangslage.');
      expect(result.complication).toBe('KI-generierte Komplikation.');
      expect(result.question).toBe('KI-generierte Kernfrage?');
      expect(result.suggestedDomain).toBe('infrastructure');
      expect(result.confidence).toBe('medium');
    });

    it('calls generateStructured exactly once', async () => {
      mockGenerateStructured.mockResolvedValueOnce(STARTER_LLM_RESPONSE);
      await broker.call('decision-frame.generateStarter', { contextHint: 'Test' });
      expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    });

    it('incorporates ZNP context when znpProjectId provided', async () => {
      mockGenerateStructured.mockResolvedValueOnce(STARTER_LLM_RESPONSE);
      await broker.call('decision-frame.generateStarter', {
        znpProjectId: 'proj-test-001',
      });
      const [, prompt] = mockGenerateStructured.mock.calls[0];
      expect(prompt).toContain('ZNP-Projekt');
      expect(prompt).toContain('proj-test-001');
    });

    it('incorporates strategic prompts as Question context', async () => {
      mockGenerateStructured.mockResolvedValueOnce(STARTER_LLM_RESPONSE);
      await broker.call('decision-frame.generateStarter', {
        znpProjectId: 'proj-test-001',
      });
      const [, prompt] = mockGenerateStructured.mock.calls[0];
      expect(prompt).toContain('Strategische Planungsfragen');
    });

    it('falls back to strategic domain when LLM returns unknown domain', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        ...STARTER_LLM_RESPONSE,
        suggestedDomain: 'totally_unknown',
      });
      const result = await broker.call('decision-frame.generateStarter', {});
      expect(result.suggestedDomain).toBe('strategic');
    });

    it('respects domain param as fallback when LLM returns unknown domain', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        ...STARTER_LLM_RESPONSE,
        suggestedDomain: 'not_valid',
      });
      const result = await broker.call('decision-frame.generateStarter', {
        domain: 'financial',
      });
      expect(result.suggestedDomain).toBe('financial');
    });

    it('includes contextUsed metadata in response', async () => {
      mockGenerateStructured.mockResolvedValueOnce(STARTER_LLM_RESPONSE);
      const result = await broker.call('decision-frame.generateStarter', {
        znpProjectId: 'proj-test-001',
        contextHint: 'Engpass',
      });
      expect(result.contextUsed.znpProjectId).toBe('proj-test-001');
      expect(result.contextUsed.contextHintProvided).toBe(true);
      expect(result.contextUsed.vdmiMatrixId).toBeNull();
    });

    it('does NOT persist a frame — create must be called separately', async () => {
      mockGenerateStructured.mockResolvedValueOnce(STARTER_LLM_RESPONSE);
      await broker.call('decision-frame.generateStarter', { contextHint: 'Test' });
      const { frames } = await broker.call('decision-frame.list', {});
      const hasGeneratedFrame = frames.some(
        (f) => f.situation === 'KI-generierte Ausgangslage.'
      );
      expect(hasGeneratedFrame).toBe(false);
    });
  });

  // ── exportSummary ────────────────────────────────────────────────────────────

  describe('exportSummary', () => {
    it('exports markdown with all SCQA sections', async () => {
      const frame = await broker.call(
        'decision-frame.create',
        makeFrame({ answer: 'Rollout 180 Einheiten.' })
      );
      const result = await broker.call('decision-frame.exportSummary', {
        frameId: frame.frameId,
      });
      expect(result.format).toBe('markdown');
      expect(result.content).toContain('## Situation');
      expect(result.content).toContain('## Complication');
      expect(result.content).toContain('## Question (Kernfrage)');
      expect(result.content).toContain('## Answer');
      expect(result.content).toContain('Rollout 180 Einheiten.');
    });

    it('shows placeholder for missing answer', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      const result = await broker.call('decision-frame.exportSummary', {
        frameId: frame.frameId,
      });
      expect(result.content).toContain('_Noch nicht befüllt._');
    });

    it('includes linked entities section when present', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      await broker.call('decision-frame.linkEntity', {
        frameId: frame.frameId,
        entityType: 'znp_project',
        entityId: 'proj-lu-001',
      });
      const result = await broker.call('decision-frame.exportSummary', {
        frameId: frame.frameId,
      });
      expect(result.content).toContain('## Verknüpfte Objekte');
      expect(result.content).toContain('znp_project');
      expect(result.content).toContain('proj-lu-001');
    });

    it('exports JSON format when requested', async () => {
      const frame = await broker.call('decision-frame.create', makeFrame());
      const result = await broker.call('decision-frame.exportSummary', {
        frameId: frame.frameId,
        format: 'json',
      });
      expect(result.format).toBeUndefined();
      expect(result.frame).toBeDefined();
      expect(result.frame.frameId).toBe(frame.frameId);
      expect(result.exportedAt).toBeDefined();
    });

    it('throws 404 for unknown frameId', async () => {
      await expect(
        broker.call('decision-frame.exportSummary', { frameId: 'df-000000000000' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });
});
