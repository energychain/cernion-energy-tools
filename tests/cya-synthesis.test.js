'use strict';

const mockGenerateStructured = jest.fn();

jest.mock('../src/llm-client', () => ({
  generateStructured: mockGenerateStructured,
  SchemaType: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
  },
}));

const { buildPrompt, synthesizeNarrative } = require('../src/cya-synthesis');

describe('cya-synthesis', () => {
  beforeEach(() => {
    mockGenerateStructured.mockReset();
  });

  it('builds synthesis prompt with sanitized payload', () => {
    const prompt = buildPrompt({
      profile: {
        actor: { role: 'grid_operator' },
        strategic_goals: ['Sicherheit'],
        tone: 'sachlich',
      },
      target_audience: 'Aufsichtsrat',
      context: { trigger: 'Anfrage', location: 'Mannheim', focus_areas: ['capacity'] },
      grounding: { facts: [], dataGaps: [], confidence: 'high' },
      regulatoryGraph: { signals: [] },
    });

    expect(prompt).toContain('Senior-Policy-Advisor');
    expect(prompt).toContain('Aufsichtsrat');
  });

  it('returns normalized narrative from llm response', async () => {
    mockGenerateStructured.mockResolvedValueOnce({
      headline: 'Kernaussage',
      executiveSummary: 'Zusammenfassung',
      keyPoints: ['P1'],
      recommendedActions: ['A1'],
      riskNotes: ['R1'],
    });

    const result = await synthesizeNarrative({
      profile: { actor: { role: 'grid_operator' } },
      target_audience: 'Vorstand',
      context: { trigger: 'Anfrage', focus_areas: ['capacity'] },
      grounding: { facts: [], dataGaps: [] },
      regulatoryGraph: { signals: [] },
    });

    expect(result.narrative.headline).toBe('Kernaussage');
    expect(result.narrative.keyPoints).toEqual(['P1']);
    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
  });
});
