'use strict';

const { decideRoutingTarget } = require('../src/personal-agent-routing-graph');

describe('personal-agent-routing-graph', () => {
  it('routes greetings to consultation intro', () => {
    const decision = decideRoutingTarget({
      effectiveChatMode: 'consultation',
      message: 'Hallo, was kannst du tun?',
      brokerRecommendation: { confidence: 0.1 },
      chatModeSource: 'heuristic',
    });

    expect(decision.target).toBe('consultation_intro');
    expect(decision.determinism).toBe('deterministic');
  });

  it('routes explicit execution with low broker confidence to an execution gap', () => {
    const decision = decideRoutingTarget({
      effectiveChatMode: 'execution',
      message: 'Prüfe irgendwas',
      brokerRecommendation: { confidence: 0.2, intent: 'unknown.intent' },
      chatModeSource: 'api',
    });

    expect(decision.target).toBe('mark_unknown_execution_gap');
    expect(decision.gap.reason).toBe('low_confidence_broker');
  });

  it('routes execution with sufficient confidence to execution node', () => {
    const decision = decideRoutingTarget({
      effectiveChatMode: 'execution',
      message: 'Prüfe den MaStR-Eintrag',
      brokerRecommendation: { confidence: 0.84, intent: 'mastr.validate' },
      chatModeSource: 'api',
    });

    expect(decision.target).toBe('execution_node');
    expect(decision.confidence).toBe(0.84);
  });
});
