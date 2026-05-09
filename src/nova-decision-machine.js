'use strict';

const STATES = Object.freeze({
  PROPOSED: 'proposed',
  TRIAGED: 'triaged',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  APPLIED: 'applied',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
});

const FINAL_STATES = new Set([STATES.APPLIED, STATES.REJECTED, STATES.EXPIRED]);

const TRANSITIONS = Object.freeze({
  [STATES.PROPOSED]: [STATES.TRIAGED, STATES.REJECTED, STATES.EXPIRED],
  [STATES.TRIAGED]: [STATES.PENDING_APPROVAL, STATES.APPROVED, STATES.REJECTED, STATES.EXPIRED],
  [STATES.PENDING_APPROVAL]: [STATES.APPROVED, STATES.REJECTED, STATES.EXPIRED],
  [STATES.APPROVED]: [STATES.APPLIED, STATES.REJECTED, STATES.EXPIRED],
  [STATES.APPLIED]: [],
  [STATES.REJECTED]: [],
  [STATES.EXPIRED]: [],
});

function nowIso() {
  return new Date().toISOString();
}

function canTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

function transition(doc, nextState, actor = 'system', reason = null, extra = {}) {
  const currentState = doc?.lifecycle?.current;
  if (!currentState || !canTransition(currentState, nextState)) {
    const err = new Error(`Invalid NOVA transition: ${currentState || 'unknown'} -> ${nextState}`);
    err.code = 'NOVA_INVALID_TRANSITION';
    throw err;
  }

  const at = nowIso();
  const entry = {
    from: currentState,
    to: nextState,
    at,
    actor,
    reason,
    ...extra,
  };

  const history = Array.isArray(doc.lifecycle?.history) ? doc.lifecycle.history.slice() : [];
  history.push(entry);

  return {
    ...doc,
    lifecycle: {
      current: nextState,
      history,
    },
    updatedAt: at,
  };
}

function initLifecycle() {
  const at = nowIso();
  return {
    current: STATES.PROPOSED,
    history: [
      {
        from: null,
        to: STATES.PROPOSED,
        at,
        actor: 'system',
        reason: 'decision-created',
      },
    ],
  };
}

module.exports = {
  STATES,
  FINAL_STATES,
  TRANSITIONS,
  canTransition,
  transition,
  initLifecycle,
};
