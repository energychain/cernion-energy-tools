'use strict';

const {
  PERSONAL_AGENT_STATES,
  createStateMachine,
  transitionStateMachine,
  deriveTerminalState,
  summarizeStateMachine,
} = require('../src/personal-agent-state-machine');

describe('personal-agent-state-machine', () => {
  it('tracks valid transitions through a normal consultation turn', () => {
    let machine = createStateMachine({
      sessionId: 'pa-test',
      chatMode: 'consultation',
      executionMode: 'auto',
      message: 'Wie ist die Netzsituation?',
    });

    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.SESSION_LOADED);
    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED);
    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.BROKER_RECOMMENDED);
    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED, {
      chatMode: 'consultation',
    });
    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE);
    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.SYNTHESIZING);
    machine = transitionStateMachine(machine, PERSONAL_AGENT_STATES.COMPLETED);

    expect(machine.currentState).toBe(PERSONAL_AGENT_STATES.COMPLETED);
    expect(machine.status).toBe('completed');
    expect(machine.transitions.map((item) => item.state)).toEqual([
      PERSONAL_AGENT_STATES.INIT,
      PERSONAL_AGENT_STATES.SESSION_LOADED,
      PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED,
      PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
      PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED,
      PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE,
      PERSONAL_AGENT_STATES.SYNTHESIZING,
      PERSONAL_AGENT_STATES.COMPLETED,
    ]);
  });

  it('fails closed on invalid transitions', () => {
    const machine = transitionStateMachine(
      createStateMachine({ sessionId: 'pa-invalid', message: 'foo' }),
      PERSONAL_AGENT_STATES.EXECUTION_RUNNING
    );

    expect(machine.currentState).toBe(PERSONAL_AGENT_STATES.FAILED);
    expect(machine.status).toBe('failed');
    expect(machine.transitions[machine.transitions.length - 1].details.reason).toBe(
      'invalid_transition'
    );
  });

  it('derives terminal states from execution outcomes', () => {
    expect(deriveTerminalState({ status: 'partial' })).toBe(
      PERSONAL_AGENT_STATES.AWAITING_USER_INPUT
    );
    expect(
      deriveTerminalState({ execution: { stopPoint: { reasonCode: 'MANDATORY_HITL_APPROVAL' } } })
    ).toBe(PERSONAL_AGENT_STATES.HITL_BLOCKED);
    expect(deriveTerminalState({ status: 'completed' })).toBe(PERSONAL_AGENT_STATES.COMPLETED);
  });

  it('summarizes transitions with sanitized details', () => {
    const machine = transitionStateMachine(
      createStateMachine({ sessionId: 'pa-summary', message: 'Hallo' }),
      PERSONAL_AGENT_STATES.SESSION_LOADED,
      {
        nested: { foo: 'bar' },
        list: [{ a: 1 }],
      }
    );

    const summary = summarizeStateMachine(machine);
    expect(summary.transitions[1].details.nested).toContain('foo');
    expect(summary.transitions[1].details.list).toHaveLength(1);
  });
});
