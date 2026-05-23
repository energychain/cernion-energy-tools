'use strict';

const {
  createExecutionStateGraph,
  advanceExecutionStateGraph,
  summarizeExecutionStateGraph,
  createMessageFingerprint,
} = require('../src/personal-agent-execution-state-graph');

describe('personal-agent-execution-state-graph', () => {
  it('prefers deterministic state transitions for api param and routing readiness', () => {
    let graph = createExecutionStateGraph({
      sessionId: 'pa_exec_graph',
      message: 'Prüfe MaStR',
      executionMode: 'auto',
    });

    graph = advanceExecutionStateGraph(graph, 'api_params_validated', {
      chatMode: 'execution',
      source: 'api',
      confidence: 1,
    });
    graph = advanceExecutionStateGraph(graph, 'execution_mode_resolved', {
      executionMode: 'auto',
    });
    graph = advanceExecutionStateGraph(graph, 'ready_for_routing', {
      chatMode: 'execution',
    });

    const summary = summarizeExecutionStateGraph(graph);
    expect(summary.currentState).toBe('ready_for_routing');
    expect(summary.chatMode).toBe('execution');
    expect(summary.transitions.map((item) => item.state)).toEqual([
      'initialized',
      'api_params_validated',
      'execution_mode_resolved',
      'ready_for_routing',
    ]);
  });

  it('creates stable message fingerprints for cache matching', () => {
    expect(createMessageFingerprint('Hallo Welt')).toBe(createMessageFingerprint('Hallo Welt'));
    expect(createMessageFingerprint('Hallo Welt')).not.toBe(
      createMessageFingerprint('Prüfe MaStR')
    );
  });
});
