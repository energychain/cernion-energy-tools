'use strict';

const {
  buildCaseTypeRoutingContext,
  renderCaseTypeRoutingPromptLines,
} = require('../src/case-type-routing-context');

describe('case-type-routing-context', () => {
  it('projects capability-broker caseTypeRouting into OpenWebUI/ChatGPT context fields', () => {
    const context = buildCaseTypeRoutingContext({
      caseTypeRouting: {
        assistancePrinciple: 'Unsicherheit halten.',
        primary: {
          id: 'messwert_edm_plausibilitaetsfall',
          title: 'Messwert',
          maturity: 'observed',
          confidence: 0.9,
        },
        candidates: [
          {
            id: 'messwert_edm_plausibilitaetsfall',
            title: 'Messwert',
            maturity: 'observed',
            confidence: 0.9,
            clarificationQuestions: ['Welcher Zeitraum?'],
            evidenceRequirements: ['Messobjekt und Wertstatus'],
            nextBestActions: ['Auffälligkeit markieren'],
          },
        ],
      },
      recommendedPlan: [{ action: 'edm.getLoadProfile' }],
    });

    expect(context.case_type_candidates[0].id).toBe('messwert_edm_plausibilitaetsfall');
    expect(context.clarification_questions).toContain('Welcher Zeitraum?');
    expect(context.evidence_requirements).toContain('Messobjekt und Wertstatus');
    expect(context.next_best_actions).toContain('Auffälligkeit markieren');
    expect(context.allowed_tools).toContain('edm.getLoadProfile');
  });

  it('renders prompt lines that prefer case structure before tool selection', () => {
    const lines = renderCaseTypeRoutingPromptLines({
      case_type_candidates: [{ id: 'kunden_service_klaerfall' }],
      primary_case_type: { id: 'kunden_service_klaerfall' },
      clarification_questions: ['Welches Vertragskonto fehlt?'],
      evidence_requirements: ['HITL vor externer Antwort'],
      next_best_actions: ['Antwortentwurf vorbereiten'],
    });

    expect(lines.join('\n')).toMatch(/kunden_service_klaerfall/);
    expect(lines.join('\n')).toMatch(/Next best actions/);
    expect(lines.join('\n')).toMatch(/missing final evidence/);
  });
});
