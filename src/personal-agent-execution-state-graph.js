'use strict';

const crypto = require('crypto');

const EXECUTION_STATE_GRAPH_STATES = Object.freeze({
  INITIALIZED: 'initialized',
  API_PARAMS_VALIDATED: 'api_params_validated',
  CHAT_MODE_CACHED: 'chat_mode_cached',
  CHAT_MODE_CLASSIFIED: 'chat_mode_classified',
  CHAT_MODE_FALLBACK: 'chat_mode_fallback',
  EXECUTION_MODE_RESOLVED: 'execution_mode_resolved',
  READY_FOR_ROUTING: 'ready_for_routing',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [EXECUTION_STATE_GRAPH_STATES.INITIALIZED]: [
    EXECUTION_STATE_GRAPH_STATES.API_PARAMS_VALIDATED,
    EXECUTION_STATE_GRAPH_STATES.CHAT_MODE_CACHED,
    EXECUTION_STATE_GRAPH_STATES.CHAT_MODE_CLASSIFIED,
    EXECUTION_STATE_GRAPH_STATES.CHAT_MODE_FALLBACK,
  ],
  [EXECUTION_STATE_GRAPH_STATES.API_PARAMS_VALIDATED]: [
    EXECUTION_STATE_GRAPH_STATES.EXECUTION_MODE_RESOLVED,
  ],
  [EXECUTION_STATE_GRAPH_STATES.CHAT_MODE_CACHED]: [
    EXECUTION_STATE_GRAPH_STATES.EXECUTION_MODE_RESOLVED,
  ],
  [EXECUTION_STATE_GRAPH_STATES.CHAT_MODE_CLASSIFIED]: [
    EXECUTION_STATE_GRAPH_STATES.EXECUTION_MODE_RESOLVED,
  ],
  [EXECUTION_STATE_GRAPH_STATES.CHAT_MODE_FALLBACK]: [
    EXECUTION_STATE_GRAPH_STATES.EXECUTION_MODE_RESOLVED,
  ],
  [EXECUTION_STATE_GRAPH_STATES.EXECUTION_MODE_RESOLVED]: [
    EXECUTION_STATE_GRAPH_STATES.READY_FOR_ROUTING,
  ],
  [EXECUTION_STATE_GRAPH_STATES.READY_FOR_ROUTING]: [],
});

function sanitizeValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeValue(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, child]) => [key, sanitizeValue(child)])
    );
  }
  if (typeof value === 'string') {
    return value.slice(0, 240);
  }
  return value;
}

function createMessageFingerprint(message = '') {
  return crypto
    .createHash('sha1')
    .update(String(message || ''))
    .digest('hex')
    .slice(0, 16);
}

function createExecutionStateGraph({
  sessionId,
  message,
  chatMode = null,
  executionMode = null,
} = {}) {
  const createdAt = new Date().toISOString();
  return {
    graphId: `exec_state_${sessionId || 'session'}_${createdAt}`,
    sessionId: sessionId || null,
    fingerprint: createMessageFingerprint(message),
    currentState: EXECUTION_STATE_GRAPH_STATES.INITIALIZED,
    chatMode: chatMode || null,
    executionMode: executionMode || null,
    createdAt,
    updatedAt: createdAt,
    transitions: [
      {
        state: EXECUTION_STATE_GRAPH_STATES.INITIALIZED,
        at: createdAt,
        details: sanitizeValue({ chatMode, executionMode }),
      },
    ],
  };
}

function advanceExecutionStateGraph(graph, targetState, details = {}) {
  const currentState = graph?.currentState || EXECUTION_STATE_GRAPH_STATES.INITIALIZED;
  const allowedTargets = ALLOWED_TRANSITIONS[currentState] || [];
  if (!allowedTargets.includes(targetState)) {
    return graph;
  }

  const updatedAt = new Date().toISOString();
  const next = {
    ...graph,
    currentState: targetState,
    updatedAt,
    transitions: [
      ...(Array.isArray(graph?.transitions) ? graph.transitions : []),
      {
        state: targetState,
        at: updatedAt,
        details: sanitizeValue(details),
      },
    ].slice(-16),
  };

  if (details?.chatMode) next.chatMode = details.chatMode;
  if (details?.executionMode) next.executionMode = details.executionMode;
  return next;
}

function summarizeExecutionStateGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    return null;
  }
  return {
    graphId: graph.graphId || null,
    sessionId: graph.sessionId || null,
    fingerprint: graph.fingerprint || null,
    currentState: graph.currentState || EXECUTION_STATE_GRAPH_STATES.INITIALIZED,
    chatMode: graph.chatMode || null,
    executionMode: graph.executionMode || null,
    createdAt: graph.createdAt || null,
    updatedAt: graph.updatedAt || null,
    transitions: Array.isArray(graph.transitions)
      ? graph.transitions.map((transition) => ({
          state: transition.state || null,
          at: transition.at || null,
          details: sanitizeValue(transition.details || null),
        }))
      : [],
  };
}

module.exports = {
  EXECUTION_STATE_GRAPH_STATES,
  createExecutionStateGraph,
  advanceExecutionStateGraph,
  summarizeExecutionStateGraph,
  createMessageFingerprint,
};
