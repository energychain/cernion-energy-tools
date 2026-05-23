'use strict';

const PERSONAL_AGENT_STATES = Object.freeze({
  INIT: 'init',
  SESSION_LOADED: 'session_loaded',
  KNOWLEDGE_ORIENTED: 'knowledge_oriented',
  BROKER_RECOMMENDED: 'broker_recommended',
  CHAT_MODE_RESOLVED: 'chat_mode_resolved',
  CONSULTATION_ACTIVE: 'consultation_active',
  EXECUTION_PLANNED: 'execution_planned',
  EXECUTION_RUNNING: 'execution_running',
  SYNTHESIZING: 'synthesizing',
  AWAITING_USER_INPUT: 'awaiting_user_input',
  HITL_BLOCKED: 'hitl_blocked',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const TERMINAL_STATES = new Set([
  PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
  PERSONAL_AGENT_STATES.HITL_BLOCKED,
  PERSONAL_AGENT_STATES.COMPLETED,
  PERSONAL_AGENT_STATES.FAILED,
]);

const ALLOWED_TRANSITIONS = {
  [PERSONAL_AGENT_STATES.INIT]: new Set([PERSONAL_AGENT_STATES.SESSION_LOADED]),
  [PERSONAL_AGENT_STATES.SESSION_LOADED]: new Set([PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED]),
  [PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED]: new Set([PERSONAL_AGENT_STATES.BROKER_RECOMMENDED]),
  [PERSONAL_AGENT_STATES.BROKER_RECOMMENDED]: new Set([PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED]),
  [PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED]: new Set([
    PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE,
    PERSONAL_AGENT_STATES.EXECUTION_PLANNED,
  ]),
  [PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE]: new Set([
    PERSONAL_AGENT_STATES.SYNTHESIZING,
    PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
    PERSONAL_AGENT_STATES.COMPLETED,
  ]),
  [PERSONAL_AGENT_STATES.EXECUTION_PLANNED]: new Set([
    PERSONAL_AGENT_STATES.EXECUTION_RUNNING,
    PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
    PERSONAL_AGENT_STATES.HITL_BLOCKED,
  ]),
  [PERSONAL_AGENT_STATES.EXECUTION_RUNNING]: new Set([
    PERSONAL_AGENT_STATES.SYNTHESIZING,
    PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
    PERSONAL_AGENT_STATES.HITL_BLOCKED,
    PERSONAL_AGENT_STATES.COMPLETED,
  ]),
  [PERSONAL_AGENT_STATES.SYNTHESIZING]: new Set([
    PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
    PERSONAL_AGENT_STATES.HITL_BLOCKED,
    PERSONAL_AGENT_STATES.COMPLETED,
  ]),
  [PERSONAL_AGENT_STATES.AWAITING_USER_INPUT]: new Set([]),
  [PERSONAL_AGENT_STATES.HITL_BLOCKED]: new Set([]),
  [PERSONAL_AGENT_STATES.COMPLETED]: new Set([]),
  [PERSONAL_AGENT_STATES.FAILED]: new Set([]),
};

function truncateValue(value, maxLength = 240) {
  if (value == null) return value;
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function sanitizeDetails(details = {}) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {};
  }

  return Object.entries(details).reduce((acc, [key, value]) => {
    if (value == null) {
      acc[key] = value;
      return acc;
    }
    if (Array.isArray(value)) {
      acc[key] = value
        .slice(0, 10)
        .map((item) =>
          item && typeof item === 'object'
            ? truncateValue(JSON.stringify(item))
            : truncateValue(item)
        );
      return acc;
    }
    if (typeof value === 'object') {
      acc[key] = truncateValue(JSON.stringify(value));
      return acc;
    }
    acc[key] = typeof value === 'string' ? truncateValue(value) : value;
    return acc;
  }, {});
}

function buildTransition(state, details = {}, at = new Date().toISOString()) {
  return {
    state,
    at,
    details: sanitizeDetails(details),
  };
}

function cloneMachine(machine = null) {
  if (!machine || typeof machine !== 'object') return null;

  return {
    turnId: machine.turnId || null,
    currentState: machine.currentState || PERSONAL_AGENT_STATES.INIT,
    status: machine.status || 'active',
    chatMode: machine.chatMode || null,
    executionMode: machine.executionMode || null,
    messageHash: machine.messageHash || null,
    startedAt: machine.startedAt || new Date().toISOString(),
    updatedAt: machine.updatedAt || machine.startedAt || new Date().toISOString(),
    completedAt: machine.completedAt || null,
    transitions: Array.isArray(machine.transitions)
      ? machine.transitions.map((item) => ({
          state: item?.state || PERSONAL_AGENT_STATES.INIT,
          at: item?.at || new Date().toISOString(),
          details: sanitizeDetails(item?.details || {}),
        }))
      : [],
  };
}

function createStateMachine({
  sessionId,
  chatMode = null,
  executionMode = null,
  message = '',
} = {}) {
  const startedAt = new Date().toISOString();
  const messageText = String(message || '');
  const messageHash = `${messageText.length.toString(16)}-${Buffer.from(messageText)
    .slice(0, 8)
    .toString('hex')}`;

  return {
    turnId: `turn_${sessionId || 'pa'}_${Date.now()}`,
    currentState: PERSONAL_AGENT_STATES.INIT,
    status: 'active',
    chatMode,
    executionMode,
    messageHash,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    transitions: [
      buildTransition(
        PERSONAL_AGENT_STATES.INIT,
        { chatMode, executionMode, messageHash },
        startedAt
      ),
    ],
  };
}

function canTransition(machine, nextState) {
  if (!machine || !nextState) return false;
  if (nextState === PERSONAL_AGENT_STATES.FAILED) return true;
  if (machine.currentState === nextState) return true;

  const allowed = ALLOWED_TRANSITIONS[machine.currentState];
  return Boolean(allowed && allowed.has(nextState));
}

function transitionStateMachine(machine, nextState, details = {}) {
  const current = cloneMachine(machine) || createStateMachine();
  const state = nextState || PERSONAL_AGENT_STATES.FAILED;

  if (!canTransition(current, state)) {
    const failed = cloneMachine(current);
    failed.currentState = PERSONAL_AGENT_STATES.FAILED;
    failed.status = 'failed';
    failed.updatedAt = new Date().toISOString();
    failed.completedAt = failed.updatedAt;
    failed.transitions = [
      ...(failed.transitions || []),
      buildTransition(
        PERSONAL_AGENT_STATES.FAILED,
        {
          reason: 'invalid_transition',
          fromState: current.currentState,
          requestedState: state,
        },
        failed.updatedAt
      ),
    ].slice(-20);
    return failed;
  }

  const updatedAt = new Date().toISOString();
  const next = cloneMachine(current);
  next.currentState = state;
  next.updatedAt = updatedAt;
  next.transitions = [
    ...(next.transitions || []),
    buildTransition(state, details, updatedAt),
  ].slice(-20);

  if (TERMINAL_STATES.has(state)) {
    next.status = state === PERSONAL_AGENT_STATES.FAILED ? 'failed' : 'completed';
    next.completedAt = updatedAt;
  }

  if (details.chatMode) next.chatMode = details.chatMode;
  if (details.executionMode) next.executionMode = details.executionMode;

  return next;
}

function deriveTerminalState({ execution = null, consultation = null, status = null } = {}) {
  if (consultation) {
    return PERSONAL_AGENT_STATES.COMPLETED;
  }
  if (execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL') {
    return PERSONAL_AGENT_STATES.HITL_BLOCKED;
  }
  if (status === 'awaiting-onboarding' || status === 'partial') {
    return PERSONAL_AGENT_STATES.AWAITING_USER_INPUT;
  }
  return PERSONAL_AGENT_STATES.COMPLETED;
}

function summarizeStateMachine(machine = null) {
  if (!machine || typeof machine !== 'object') {
    return null;
  }

  return {
    turnId: machine.turnId || null,
    currentState: machine.currentState || PERSONAL_AGENT_STATES.INIT,
    status: machine.status || 'active',
    chatMode: machine.chatMode || null,
    executionMode: machine.executionMode || null,
    messageHash: machine.messageHash || null,
    startedAt: machine.startedAt || null,
    updatedAt: machine.updatedAt || null,
    completedAt: machine.completedAt || null,
    transitions: Array.isArray(machine.transitions)
      ? machine.transitions.map((item) => ({
          state: item?.state || PERSONAL_AGENT_STATES.INIT,
          at: item?.at || null,
          details: sanitizeDetails(item?.details || {}),
        }))
      : [],
  };
}

module.exports = {
  PERSONAL_AGENT_STATES,
  createStateMachine,
  transitionStateMachine,
  deriveTerminalState,
  summarizeStateMachine,
};
