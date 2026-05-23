'use strict';

const MAX_NODES = 80;
const MAX_EDGES = 140;

function safeText(value, max = 240) {
  if (value == null) return null;
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sanitizeData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (value == null) {
      acc[key] = value;
      return acc;
    }
    if (typeof value === 'object') {
      acc[key] = safeText(JSON.stringify(value), 500);
      return acc;
    }
    acc[key] = typeof value === 'string' ? safeText(value, 500) : value;
    return acc;
  }, {});
}

function normalizeNodeId(input, fallbackPrefix = 'node') {
  const raw = String(input || '').trim();
  if (!raw) {
    return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120);
}

function createTurnGraph({ sessionId, message = '', chatMode = null, executionMode = null } = {}) {
  const now = new Date().toISOString();
  const rootId = 'msg:user';
  const graph = {
    turnId: `graph_${sessionId || 'pa'}_${Date.now()}`,
    status: 'active',
    chatMode,
    executionMode,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: rootId,
        type: 'message',
        label: 'User message',
        data: sanitizeData({ text: safeText(message, 600) }),
      },
    ],
    edges: [],
  };
  return graph;
}

function addNode(graph, node = {}) {
  const next = graph && typeof graph === 'object' ? graph : createTurnGraph();
  const nodeId = normalizeNodeId(node.id, node.type || 'node');
  const exists = Array.isArray(next.nodes) && next.nodes.some((item) => item.id === nodeId);
  if (exists) return next;
  const payload = {
    id: nodeId,
    type: String(node.type || 'unknown'),
    label: safeText(node.label || node.type || 'Node', 120),
    data: sanitizeData(node.data || {}),
  };
  next.nodes = [...(Array.isArray(next.nodes) ? next.nodes : []), payload].slice(-MAX_NODES);
  next.updatedAt = new Date().toISOString();
  return next;
}

function addEdge(graph, edge = {}) {
  const next = graph && typeof graph === 'object' ? graph : createTurnGraph();
  const from = normalizeNodeId(edge.from || 'node:unknown');
  const to = normalizeNodeId(edge.to || 'node:unknown');
  const relation = String(edge.type || 'related_to');
  const edgeId = `${from}->${relation}->${to}`;
  const exists = Array.isArray(next.edges) && next.edges.some((item) => item.id === edgeId);
  if (exists) return next;
  const payload = {
    id: edgeId,
    from,
    to,
    type: relation,
    data: sanitizeData(edge.data || {}),
  };
  next.edges = [...(Array.isArray(next.edges) ? next.edges : []), payload].slice(-MAX_EDGES);
  next.updatedAt = new Date().toISOString();
  return next;
}

function finalizeTurnGraph(graph, { status = 'completed' } = {}) {
  const next = graph && typeof graph === 'object' ? graph : createTurnGraph();
  next.status = status;
  next.updatedAt = new Date().toISOString();
  return next;
}

function summarizeTurnGraph(graph = null) {
  if (!graph || typeof graph !== 'object') return null;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const byType = nodes.reduce((acc, node) => {
    const type = String(node?.type || 'unknown');
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return {
    turnId: graph.turnId || null,
    status: graph.status || 'active',
    chatMode: graph.chatMode || null,
    executionMode: graph.executionMode || null,
    createdAt: graph.createdAt || null,
    updatedAt: graph.updatedAt || null,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    byType,
    nodes,
    edges,
  };
}

/**
 * Adds a workflow_plan node (and evidence_gate child nodes) for the
 * consultation-to-execution bridge artifact. Must be called AFTER
 * finalizeTurnGraph so the strategy node already exists.
 *
 * @param {object} graph          - TurnGraph object
 * @param {object} planArtifact   - Result of buildConsultationExecutionPlan()
 * @returns {object} updated graph
 */
function addWorkflowPlanNode(graph, planArtifact = {}) {
  const workflowType = String(planArtifact.workflowType || 'advisory_only');
  const planNodeId = `workflow:plan:${workflowType}`;

  let next = addNode(graph, {
    id: planNodeId,
    type: 'workflow_plan',
    label: `Execution plan: ${workflowType}`,
    data: {
      workflowType,
      readiness: planArtifact.readiness || null,
      canExecuteNow: Boolean(planArtifact.canExecuteNow),
      executableStepCount: Array.isArray(planArtifact.executableSteps)
        ? planArtifact.executableSteps.length
        : 0,
      missingInputCount: Array.isArray(planArtifact.missingInputs)
        ? planArtifact.missingInputs.length
        : 0,
      nextUserQuestion: planArtifact.nextUserQuestion || null,
    },
  });

  // Edge: response:strategy → workflow:plan (materializes_into)
  next = addEdge(next, {
    from: 'response:strategy',
    to: planNodeId,
    type: 'materializes_into',
  });

  // Evidence gate nodes (up to 5)
  const gates = Array.isArray(planArtifact.evidenceGates)
    ? planArtifact.evidenceGates.slice(0, 5)
    : [];

  gates.forEach((gate) => {
    const gateId = `evidence:gate:${String(gate.id || gate.label || 'gate')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 60)}`;
    next = addNode(next, {
      id: gateId,
      type: 'evidence_gate',
      label: gate.label || gate.id || 'Evidence gate',
      data: {
        blockedBy: gate.blockedBy || null,
        required: Boolean(gate.required),
        description: gate.description || null,
      },
    });

    // Edge: workflow:plan → evidence_gate (gated_by)
    next = addEdge(next, {
      from: planNodeId,
      to: gateId,
      type: 'gated_by',
    });
  });

  return next;
}

module.exports = {
  createTurnGraph,
  addNode,
  addEdge,
  finalizeTurnGraph,
  summarizeTurnGraph,
  addWorkflowPlanNode,
};
