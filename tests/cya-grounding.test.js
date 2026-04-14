'use strict';

const { buildGrounding } = require('../src/cya-grounding');

describe('cya-grounding', () => {
  it('builds facts, confidence and no clarification on healthy input', () => {
    const grounding = buildGrounding({
      context: { location: 'Mannheim' },
      retrieval: {
        items: [
          { ok: true, focusArea: 'capacity', answer: 'Netzkapazität ist angespannt.', sources: ['mastr'] },
          { ok: true, focusArea: 'compliance', answer: 'Regulatorische Anforderungen steigen.', sources: ['bnetza'] },
        ],
      },
      regulatoryGraph: { signals: [{ ruleId: 'HIGH_CURTAILMENT', severity: 'warning' }] },
    });

    expect(grounding.facts).toHaveLength(2);
    expect(grounding.confidence).toBe('high');
    expect(grounding.requiresClarification).toBe(false);
  });

  it('requires clarification when location is missing and gaps exist', () => {
    const grounding = buildGrounding({
      context: {},
      retrieval: {
        items: [{ ok: false, focusArea: 'redispatch', error: 'timeout' }],
      },
      regulatoryGraph: { signals: [] },
    });

    expect(grounding.requiresClarification).toBe(true);
    expect(grounding.clarification).toBeTruthy();
    expect(grounding.dataGaps).toHaveLength(1);
    expect(grounding.confidence).toBe('low');
  });
});
