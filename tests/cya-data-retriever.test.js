'use strict';

const {
  buildFocusQuery,
  runSingleFocusQuery,
  retrieveContextData,
} = require('../src/cya-data-retriever');

describe('cya-data-retriever', () => {
  it('builds focus query with location and context', () => {
    const query = buildFocusQuery(
      'capacity',
      { location: 'Ludwigshafen', trigger: 'Presseanfrage' },
      'grid_operator',
      'Aufsichtsrat'
    );

    expect(query).toContain('Ludwigshafen');
    expect(query).toContain('Rolle=grid_operator');
    expect(query).toContain('Zielgruppe=Aufsichtsrat');
  });

  it('returns successful normalized query result', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({
        answer: 'Kapazität angespannt.',
        data: { score: 42 },
        sources: ['mastr_db'],
        metadata: { executionTime: 1.2 },
      }),
    };

    const result = await runSingleFocusQuery(ctx, 'capacity', 'foo');

    expect(result.ok).toBe(true);
    expect(result.focusArea).toBe('capacity');
    expect(result.answer).toBe('Kapazität angespannt.');
    expect(result.sources).toEqual(['mastr_db']);
  });

  it('returns failed normalized query result on call error', async () => {
    const ctx = {
      call: jest.fn().mockRejectedValue(new Error('upstream timeout')),
    };

    const result = await runSingleFocusQuery(ctx, 'redispatch', 'foo');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('upstream timeout');
  });

  it('retrieves all focus areas and summarizes success/failure', async () => {
    const ctx = {
      call: jest
        .fn()
        .mockResolvedValueOnce({ answer: 'A', data: {}, sources: ['s1'] })
        .mockRejectedValueOnce(new Error('failed')),
    };

    const result = await retrieveContextData(ctx, {
      profile: { actor: { role: 'grid_operator' } },
      target_audience: 'Vorstand',
      context: {
        location: 'Heidelberg',
        trigger: 'Politische Anfrage',
        focus_areas: ['capacity', 'redispatch'],
      },
    });

    expect(result.items).toHaveLength(2);
    expect(result.summary.requested).toBe(2);
    expect(result.summary.success).toBe(1);
    expect(result.summary.failed).toBe(1);
  });
});
