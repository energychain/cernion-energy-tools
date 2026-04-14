'use strict';

const { buildRegulatoryGraph } = require('../src/cya-regulatory-graph');

describe('cya-regulatory-graph', () => {
  it('triggers expected rules from retrieval text', () => {
    const graph = buildRegulatoryGraph({
      context: { focus_areas: ['renewables', 'energy_sharing'] },
      retrieval: {
        items: [
          {
            ok: true,
            focusArea: 'renewables',
            answer: 'Hoher erneuerbarer Anteil mit Einspeisespitzen und Redispatch.',
          },
          {
            ok: true,
            focusArea: 'energy_sharing',
            answer: 'Frist 01.06.2026 ist kritisch für §42c-Prozesse.',
          },
        ],
      },
    });

    const ruleIds = graph.signals.map((signal) => signal.ruleId);
    expect(ruleIds).toContain('HIGH_CURTAILMENT');
    expect(ruleIds).toContain('ENERGY_SHARING_DEADLINE');
    expect(ruleIds).toContain('HIGH_RENEWABLE_SHARE');
  });

  it('returns empty signals when no rules match', () => {
    const graph = buildRegulatoryGraph({
      context: { focus_areas: [] },
      retrieval: { items: [{ ok: true, focusArea: 'customer', answer: 'Keine Auffälligkeiten.' }] },
    });

    expect(graph.signals).toEqual([]);
    expect(graph.triggeredRules).toBe(0);
  });
});
