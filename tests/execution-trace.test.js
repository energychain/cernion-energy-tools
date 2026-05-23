'use strict';

const { createExecutionTrace } = require('../src/execution-trace');

describe('execution-trace', () => {
  it('tracks llm calls, tool calls, broker decisions, and state transitions', () => {
    const trace = createExecutionTrace({ sessionId: 'pa_trace' });
    trace.recordLLMCall({ phase: 'chat_mode_classifier', latencyMs: 120 });
    trace.recordToolInvocation({
      phase: 'execution',
      tool: 'grid-connection.validate',
      success: true,
    });
    trace.recordBrokerDecision({ intent: 'grid-connection.validate', confidence: 0.82 });
    trace.recordStateTransition({ from: 'classified', to: 'execution_node', reason: 'api' });

    const summary = trace.summarize();
    expect(summary.sessionId).toBe('pa_trace');
    expect(summary.llmCallCount).toBe(1);
    expect(summary.toolCallCount).toBe(1);
    expect(summary.brokerDecisions).toHaveLength(1);
    expect(summary.stateTransitions).toHaveLength(1);
  });
});
