'use strict';

const {
  createTurnGraph,
  addNode,
  addEdge,
  finalizeTurnGraph,
  summarizeTurnGraph,
} = require('../src/personal-agent-turn-graph');

describe('personal-agent-turn-graph', () => {
  it('creates a graph with a user message root node', () => {
    const graph = createTurnGraph({
      sessionId: 'pa_graph',
      message: 'Prüfe bitte die Netzlage.',
      chatMode: 'consultation',
      executionMode: 'auto',
    });

    expect(graph.turnId).toContain('graph_pa_graph');
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'msg:user')).toBe(true);
  });

  it('adds nodes and edges without duplicating ids', () => {
    let graph = createTurnGraph({ sessionId: 'pa_graph2', message: 'Hallo' });
    graph = addNode(graph, { id: 'knowledge:orientation', type: 'knowledge', label: 'Knowledge' });
    graph = addNode(graph, { id: 'knowledge:orientation', type: 'knowledge', label: 'Knowledge' });
    graph = addEdge(graph, {
      from: 'msg:user',
      to: 'knowledge:orientation',
      type: 'oriented_by',
    });
    graph = addEdge(graph, {
      from: 'msg:user',
      to: 'knowledge:orientation',
      type: 'oriented_by',
    });

    const summary = summarizeTurnGraph(graph);
    expect(summary.nodeCount).toBe(2);
    expect(summary.edgeCount).toBe(1);
  });

  it('finalizes graph status', () => {
    const graph = finalizeTurnGraph(createTurnGraph({ sessionId: 'pa_graph3' }), {
      status: 'completed',
    });
    expect(graph.status).toBe('completed');
  });
});
