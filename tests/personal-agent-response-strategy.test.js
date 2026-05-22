'use strict';

const {
  AUDIENCES,
  EPISTEMIC_STATES,
  buildOnboardingQuestionText,
  buildResponseStrategy,
  buildStrategyLead,
} = require('../src/personal-agent-response-strategy');

describe('personal-agent-response-strategy', () => {
  it('classifies technical inferable contexts and labels a working assumption', () => {
    const strategy = buildResponseStrategy({
      message: 'Bitte prüfe das JSON-Schema und den BDEW-Code.',
      knownContext: {
        gridOperatorName: 'Stadtwerke Beispiel',
      },
      missingParams: ['gridOperatorBdew'],
    });

    expect(strategy.audience).toBe(AUDIENCES.TECHNICAL);
    expect(strategy.epistemicState).toBe(EPISTEMIC_STATES.INFERABLE);
    expect(strategy.assumptions.length).toBeGreaterThan(0);
    expect(strategy.assumptions[0].statement).toMatch(/Vorläufige Annahme/);
    expect(buildStrategyLead(strategy)).toBe('Vorläufige Annahme:');
  });

  it('classifies leadership contexts with executive abstraction', () => {
    const strategy = buildResponseStrategy({
      message: 'Bitte gib mir eine Entscheidungsvorlage für den Vorstand.',
      knownContext: {
        targetAudience: 'Vorstand',
      },
    });

    expect(strategy.audience).toBe(AUDIENCES.LEADERSHIP);
    expect(strategy.abstractionLevel).toBe('executive');
    expect(strategy.nextMove).toBe('recommend_action');
    expect(strategy.lead).toBe('Für die Entscheidungsebene:');
  });

  it('builds schema-safe onboarding questions without leaking raw param keys', () => {
    const questionText = buildOnboardingQuestionText({
      paramKey: 'customSchemaField',
      strategy: {
        audience: AUDIENCES.LEADERSHIP,
        epistemicState: EPISTEMIC_STATES.MISSING,
      },
    });

    expect(questionText).toContain('Entscheidungsebene');
    expect(questionText).not.toContain('customSchemaField');
  });

  it('treats mixed technical and leadership cues as ambiguous', () => {
    const strategy = buildResponseStrategy({
      message: 'Bitte eine technische Prüfung für die Geschäftsführung vorbereiten.',
      missingParams: ['operatorEvidence'],
    });

    expect([AUDIENCES.GENERAL, AUDIENCES.MIXED, AUDIENCES.LEADERSHIP, AUDIENCES.TECHNICAL]).toContain(
      strategy.audience
    );
    expect([EPISTEMIC_STATES.AMBIGUOUS, EPISTEMIC_STATES.MISSING]).toContain(strategy.epistemicState);
    expect(strategy.shouldHideInternalSchema).toBe(true);
  });

  it('includes decisionRole in strategy output', () => {
    const leadershipStrategy = buildResponseStrategy({
      message: 'Bitte gib mir eine Entscheidungsvorlage für den Vorstand.',
      knownContext: { targetAudience: 'Vorstand' },
    });
    expect(leadershipStrategy.decisionRole).toBe('strategic_decision');

    const technicalStrategy = buildResponseStrategy({
      message: 'Bitte prüfe den BDEW-Code und das JSON-Schema.',
      knownContext: { gridOperatorName: 'Stadtwerke X' },
    });
    expect(technicalStrategy.decisionRole).toBe('technical_validation');

    const missingStrategy = buildResponseStrategy({
      message: 'Analysiere das bitte.',
      missingParams: ['location', 'operator'],
    });
    expect(['information_gathering', 'advisory']).toContain(missingStrategy.decisionRole);
  });

  it('includes userFacingQuestionStyle in strategy output', () => {
    const missingStrategy = buildResponseStrategy({
      message: 'Was ist der Netzanschlusspunkt?',
      missingParams: ['location', 'gridOperatorName'],
    });
    expect(missingStrategy.userFacingQuestionStyle).toBe('parametric');

    const inferableStrategy = buildResponseStrategy({
      message: 'Bitte prüfe den BDEW-Code.',
      knownContext: { gridOperatorName: 'Stadtwerke X' },
      missingParams: ['gridOperatorBdew'],
    });
    expect(inferableStrategy.userFacingQuestionStyle).toBe('confirmation');

    const clearStrategy = buildResponseStrategy({
      message: 'Bitte gib mir eine Entscheidungsvorlage für den Vorstand.',
      knownContext: { targetAudience: 'Vorstand', location: 'Berlin', gridOperatorName: 'Netze BW' },
    });
    expect(['none', 'confirmation']).toContain(clearStrategy.userFacingQuestionStyle);
  });

  it('includes confidence in strategy output between 0 and 1', () => {
    const strategy = buildResponseStrategy({
      message: 'Bitte gib mir eine Entscheidungsvorlage.',
      knownContext: { targetAudience: 'Vorstand' },
    });
    expect(typeof strategy.confidence).toBe('number');
    expect(strategy.confidence).toBeGreaterThan(0);
    expect(strategy.confidence).toBeLessThanOrEqual(1);
  });
});
