'use strict';

const {
  buildFocusQuery,
  runSingleFocusQuery,
  retrieveContextData,
  mergeProvidedData,
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

  describe('mergeProvidedData', () => {
    const baseRetrieval = {
      retrievedAt: '2026-04-15T00:00:00.000Z',
      location: 'Mauer',
      trigger: 'Test',
      items: [
        { focusArea: 'capacity', ok: false, answer: '', sources: [], error: 'Unauthorized' },
        { focusArea: 'redispatch', ok: true, answer: 'Bekannte Abregelung.', sources: ['mastr'] },
      ],
      summary: { requested: 2, success: 1, failed: 1, trusted: 0, sources: ['mastr'] },
      topologyHop: null,
    };

    it('replaces a failed item with trusted user-asserted fact', () => {
      const result = mergeProvidedData(baseRetrieval, {
        capacity: 'Lokale PV 8 MW, Speicher ans 110-kV-UW Meckesheim.',
      });

      const capacityItem = result.items.find((i) => i.focusArea === 'capacity');
      expect(capacityItem.ok).toBe(true);
      expect(capacityItem.trusted).toBe(true);
      expect(capacityItem.dataProvenance).toBe('user_asserted');
      expect(capacityItem.answer).toBe('Lokale PV 8 MW, Speicher ans 110-kV-UW Meckesheim.');
      expect(capacityItem.sources).toEqual([]);
    });

    it('recalculates summary with trusted count after merge', () => {
      const result = mergeProvidedData(baseRetrieval, {
        capacity: 'Nutzerangabe Kapazität.',
        nova: 'Nutzerangabe NOVA.',
      });

      // nova was not in original items → appended
      expect(result.items).toHaveLength(3);
      expect(result.summary.trusted).toBe(2);
      expect(result.summary.success).toBe(3); // capacity + redispatch + nova all ok
      expect(result.summary.failed).toBe(0);
      expect(result.mergedAt).toBeTruthy();
    });

    it('marks trusted:true and dataProvenance:user_asserted on appended item', () => {
      const result = mergeProvidedData(baseRetrieval, {
        investment: 'Kommune Mauer will Gewerbesteuer sichern.',
      });

      const investmentItem = result.items.find((i) => i.focusArea === 'investment');
      expect(investmentItem).toBeTruthy();
      expect(investmentItem.trusted).toBe(true);
      expect(investmentItem.dataProvenance).toBe('user_asserted');
    });
  });
});
