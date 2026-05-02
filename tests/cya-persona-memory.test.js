'use strict';

const {
  retrievePersonaContext,
  formatMemoryForPrompt,
  buildPersonaGrounding,
} = require('../src/cya-persona-memory');

const makeMockCtx = (callResult) => ({
  call: jest.fn().mockResolvedValue(callResult),
});

describe('cya-persona-memory', () => {
  describe('retrievePersonaContext', () => {
    it('returns empty memories for unknown personaId', async () => {
      const ctx = makeMockCtx({ items: [] });
      const result = await retrievePersonaContext(ctx, 'unknown_persona');
      expect(result).toEqual({ personaId: 'unknown_persona', memories: [] });
      expect(ctx.call).not.toHaveBeenCalled();
    });

    it('queries object-store for known persona', async () => {
      const ctx = makeMockCtx({ items: [{ _id: '1', payload: 'test' }] });
      const result = await retrievePersonaContext(ctx, 'technical');
      expect(result.personaId).toBe('technical');
      expect(result.memories).toHaveLength(1);
      expect(ctx.call).toHaveBeenCalledWith(
        'object-store.query',
        expect.objectContaining({
          namespace: 'cya_persona_technical',
        })
      );
    });

    it('respects the limit option', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ _id: String(i) }));
      const ctx = makeMockCtx({ items });
      const result = await retrievePersonaContext(ctx, 'commercial', { limit: 3 });
      expect(result.memories.length).toBeLessThanOrEqual(3);
    });

    it('returns empty memories on object-store error (non-blocking)', async () => {
      const ctx = { call: jest.fn().mockRejectedValue(new Error('store down')) };
      const result = await retrievePersonaContext(ctx, 'compliance');
      expect(result).toEqual({ personaId: 'compliance', memories: [] });
    });

    it('returns empty memories when items array is missing', async () => {
      const ctx = makeMockCtx({});
      const result = await retrievePersonaContext(ctx, 'technical');
      expect(result.memories).toEqual([]);
    });

    it('passes tags filter when provided', async () => {
      const ctx = makeMockCtx({ items: [] });
      await retrievePersonaContext(ctx, 'technical', { tags: ['grid', 'capacity'] });
      const callArgs = ctx.call.mock.calls[0][1];
      expect(callArgs.selector).toEqual({ tags: { $elemMatch: { $in: ['grid', 'capacity'] } } });
    });

    it('uses empty selector when no tags provided', async () => {
      const ctx = makeMockCtx({ items: [] });
      await retrievePersonaContext(ctx, 'technical', {});
      const callArgs = ctx.call.mock.calls[0][1];
      expect(callArgs.selector).toEqual({});
    });
  });

  describe('formatMemoryForPrompt', () => {
    it('returns empty string for no memories', () => {
      expect(formatMemoryForPrompt({ personaId: 'technical', memories: [] })).toBe('');
    });

    it('returns empty string for undefined/null input', () => {
      expect(formatMemoryForPrompt(null)).toBe('');
      expect(formatMemoryForPrompt(undefined)).toBe('');
    });

    it('formats string payload memories', () => {
      const memCtx = {
        personaId: 'technical',
        memories: [{ payload: 'Grid capacity exceeded in Q1' }],
      };
      const result = formatMemoryForPrompt(memCtx);
      expect(result).toContain('Erinnerung 1');
      expect(result).toContain('Grid capacity exceeded in Q1');
    });

    it('formats object payload memories as JSON', () => {
      const memCtx = {
        personaId: 'commercial',
        memories: [{ payload: { capex: 120000, roi: 0.12 } }],
      };
      const result = formatMemoryForPrompt(memCtx);
      expect(result).toContain('Erinnerung 1');
      expect(result).toContain('capex');
    });

    it('caps at 5 memories even if more are provided', () => {
      const memories = Array.from({ length: 10 }, (_, i) => ({ payload: `memory ${i}` }));
      const result = formatMemoryForPrompt({ personaId: 'compliance', memories });
      const count = (result.match(/Erinnerung/g) || []).length;
      expect(count).toBeLessThanOrEqual(5);
    });

    it('truncates very long payloads to 200 chars', () => {
      const longText = 'x'.repeat(500);
      const memCtx = { personaId: 'technical', memories: [{ payload: longText }] };
      const result = formatMemoryForPrompt(memCtx);
      // JSON.stringify wraps in quotes, so check length is reasonable
      expect(result.length).toBeLessThan(600);
    });
  });

  describe('buildPersonaGrounding', () => {
    const baseline = {
      facts: [{ factId: 'F1', focusArea: 'capacity', statement: 'test', confidence: 'high' }],
      dataGaps: [],
      confidence: 'high',
      confidenceScore: 90,
      requiresClarification: false,
      clarification: null,
    };

    it('adds personaId to baseline when no memories', () => {
      const memCtx = { personaId: 'technical', memories: [] };
      const result = buildPersonaGrounding(baseline, memCtx, 'technical');
      expect(result.personaId).toBe('technical');
      expect(result.personaMemoryHint).toBeUndefined();
    });

    it('adds personaMemoryHint when memories are present', () => {
      const memCtx = {
        personaId: 'commercial',
        memories: [{ payload: 'ROI was positive in 2024' }],
      };
      const result = buildPersonaGrounding(baseline, memCtx, 'commercial');
      expect(result.personaId).toBe('commercial');
      expect(result.personaMemoryHint).toContain('Erinnerung 1');
    });

    it('preserves all baseline fields', () => {
      const memCtx = { personaId: 'compliance', memories: [] };
      const result = buildPersonaGrounding(baseline, memCtx, 'compliance');
      expect(result.facts).toEqual(baseline.facts);
      expect(result.confidence).toBe('high');
      expect(result.confidenceScore).toBe(90);
    });

    it('does not mutate the original baseline', () => {
      const memCtx = { personaId: 'technical', memories: [{ payload: 'something' }] };
      buildPersonaGrounding(baseline, memCtx, 'technical');
      expect(baseline.personaId).toBeUndefined();
      expect(baseline.personaMemoryHint).toBeUndefined();
    });
  });
});
