'use strict';

const { RC2_ROLE_IDS, resolveRoleActors } = require('./fixtures/reference-tenant');

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function parseRevision(basisRev) {
  const match = String(basisRev || 'rev-0').match(/^(.*?)(\d+)$/);
  if (!match) return `${basisRev}-next`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

function currentIso(now) {
  if (!now) throw new Error('state transition requires explicit now timestamp');
  return now;
}

function cloneActor(actor) {
  return actor ? clone(actor) : null;
}

function validateClaimActor(card, actor, roleId) {
  if (!actor || actor.tenantId !== card.tenantId) {
    return { ok: false, code: 'actor_tenant_mismatch', expectedTenantId: card.tenantId };
  }
  if (!Array.isArray(actor.roleIds) || !actor.roleIds.includes(roleId)) {
    return { ok: false, code: 'actor_role_mismatch', roleId };
  }
  return { ok: true };
}

function createReferenceRunCard({
  tenantId = 'rc2-stadtwerk-a',
  caseId = 'vorgang-cr-lka-rv-001-article-id-change',
  basisRev = 'rev-1',
  responsibleRoleId = RC2_ROLE_IDS.MARKTKOMMUNIKATION,
  unclaimedUntil = null,
} = {}) {
  return {
    schemaVersion: 'rc2.run-card-state.v1',
    tenantId,
    caseId,
    basisRev,
    responsibleRoleId,
    unclaimedUntil,
    assignment: { status: 'offen', actor: null, at: null },
    evidenceState: { status: 'offen', appendOnly: false, frozenAt: null, actor: null },
    hitlRequests: [],
    externalExecutions: [],
    decision: null,
    history: [],
  };
}

function mismatch(card, requestedBasisRev) {
  return {
    ok: false,
    code: 'basisRev_mismatch',
    currentBasisRev: card.basisRev,
    requestedBasisRev,
    assignedTo: cloneActor(card.assignment?.actor),
  };
}

function withRevision(card, event) {
  const next = clone(card);
  next.basisRev = parseRevision(card.basisRev);
  next.history = [...(card.history || []), event];
  return next;
}

function assertCurrentRevision(card, basisRev) {
  return card.basisRev === basisRev;
}

function claimRunCard(card, { basisRev, actor, roleId, now } = {}) {
  if (!assertCurrentRevision(card, basisRev)) return mismatch(card, basisRev);
  const actorValidation = validateClaimActor(card, actor, roleId);
  if (!actorValidation.ok) return actorValidation;
  if (card.assignment?.status === 'mir_zugewiesen' && card.assignment.actor) {
    return {
      ok: false,
      code: 'already_assigned',
      currentBasisRev: card.basisRev,
      requestedBasisRev: basisRev,
      assignedTo: cloneActor(card.assignment.actor),
    };
  }

  const at = currentIso(now);
  const assignmentActor = cloneActor(actor);
  const next = withRevision(card, {
    type: 'claimed',
    at,
    actor: assignmentActor,
    roleId,
  });
  next.assignment = { status: 'mir_zugewiesen', actor: assignmentActor, roleId, at };
  return { ok: true, card: next };
}

function assignExpiredUnclaimedRunCard(card, { fixture, now } = {}) {
  const effectiveNow = currentIso(now);
  if (card.assignment?.status === 'mir_zugewiesen' && card.assignment.actor) {
    return {
      ok: false,
      code: 'already_assigned',
      assignedTo: cloneActor(card.assignment.actor),
      currentBasisRev: card.basisRev,
    };
  }
  if (!card.unclaimedUntil || card.unclaimedUntil > effectiveNow) {
    return { ok: false, code: 'not_expired', card: clone(card) };
  }
  const actors = resolveRoleActors(fixture, {
    tenantId: card.tenantId,
    roleId: card.responsibleRoleId,
  });
  if (actors.length === 0) return { ok: false, code: 'no_actor_for_role', card: clone(card) };
  const actor = cloneActor(actors[0]);
  const next = withRevision(card, {
    type: 'assigned_after_expiry',
    at: effectiveNow,
    actor,
    roleId: card.responsibleRoleId,
  });
  next.assignment = {
    status: 'mir_zugewiesen',
    actor,
    roleId: card.responsibleRoleId,
    at: effectiveNow,
  };
  return { ok: true, card: next };
}

function freezeRunCard(card, { basisRev, actor, now } = {}) {
  if (!assertCurrentRevision(card, basisRev)) return mismatch(card, basisRev);
  const frozenAt = currentIso(now);
  const eventActor = cloneActor(actor);
  const next = withRevision(card, { type: 'frozen', at: frozenAt, actor: eventActor });
  next.evidenceState = {
    status: 'eingefroren',
    appendOnly: true,
    frozenAt,
    actor: eventActor,
    basisRev,
  };
  return { ok: true, card: next };
}

function requestApproval(card, { basisRev, roleId, actor, now } = {}) {
  if (!assertCurrentRevision(card, basisRev)) return mismatch(card, basisRev);
  const requestedAt = currentIso(now);
  const requestActor = cloneActor(actor);
  const request = {
    id: `hitl-${(card.hitlRequests || []).length + 1}`,
    roleId,
    status: 'angefordert',
    actor: requestActor,
    at: requestedAt,
    externalExecute: false,
  };
  const next = withRevision(card, {
    type: 'approval_requested',
    at: requestedAt,
    actor: requestActor,
    roleId,
    hitlRequestId: request.id,
  });
  next.hitlRequests = [...(card.hitlRequests || []), request];
  next.externalExecutions = [...(card.externalExecutions || [])];
  next.decision = card.decision || null;
  return { ok: true, card: next };
}

function recordDecisionReturn(card, { basisRev, decision } = {}) {
  if (!assertCurrentRevision(card, basisRev)) return mismatch(card, basisRev);
  if (!decision?.at) throw new Error('decision return requires explicit decision.at timestamp');
  const returnedDecision = clone(decision);
  const next = withRevision(card, {
    type: 'decision_returned',
    at: returnedDecision.at,
    decision: returnedDecision,
  });
  next.decision = returnedDecision;
  return { ok: true, card: next };
}

module.exports = {
  assignExpiredUnclaimedRunCard,
  claimRunCard,
  createReferenceRunCard,
  freezeRunCard,
  recordDecisionReturn,
  requestApproval,
};
