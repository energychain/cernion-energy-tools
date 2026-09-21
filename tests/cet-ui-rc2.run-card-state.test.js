'use strict';

const {
  RC2_ROLE_IDS,
  buildReferenceTenantFixture,
} = require('../src/cet-ui-rc2/fixtures/reference-tenant');
const {
  claimRunCard,
  assignExpiredUnclaimedRunCard,
  freezeRunCard,
  requestApproval,
  recordDecisionReturn,
  createReferenceRunCard,
} = require('../src/cet-ui-rc2/run-card-state');

describe('CET UI RC2 Laufkarten state transitions', () => {
  test('claim succeeds only with current basisRev and second claim returns structured Auskunft', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({ tenantId: fixture.tenant.id, basisRev: 'rev-1' });

    const claimed = claimRunCard(card, {
      basisRev: 'rev-1',
      actor: {
        id: 'user-mako-1',
        tenantId: fixture.tenant.id,
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        displayName: 'Mako Person 1',
      },
      roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      now: '2026-09-21T12:00:00Z',
    });

    expect(claimed.ok).toBe(true);
    expect(claimed.card.assignment.status).toBe('mir_zugewiesen');
    expect(claimed.card.basisRev).toBe('rev-2');
    expect(claimed.card.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'claimed', at: '2026-09-21T12:00:00Z' }),
      ])
    );

    const second = claimRunCard(claimed.card, {
      basisRev: 'rev-1',
      actor: { id: 'user-mako-2', displayName: 'Mako Person 2' },
      roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      now: '2026-09-21T12:01:00Z',
    });

    expect(second).toEqual({
      ok: false,
      code: 'basisRev_mismatch',
      currentBasisRev: 'rev-2',
      requestedBasisRev: 'rev-1',
      assignedTo: {
        id: 'user-mako-1',
        tenantId: fixture.tenant.id,
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        displayName: 'Mako Person 1',
      },
    });
  });

  test('expired unclaimed case becomes named assignment and empty role routes to placeholder agent', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({
      tenantId: fixture.tenant.id,
      responsibleRoleId: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG,
      unclaimedUntil: '2026-09-21T11:59:00Z',
    });

    const assigned = assignExpiredUnclaimedRunCard(card, {
      fixture,
      now: '2026-09-21T12:00:00Z',
    });

    expect(assigned.ok).toBe(true);
    expect(assigned.card.assignment.status).toBe('mir_zugewiesen');
    expect(assigned.card.assignment.actor.kind).toBe('placeholder-agent');
    expect(assigned.card.assignment.actor.canHandleHitl).toBe(true);
    expect(assigned.card.assignment.actor.tenantId).toBe(fixture.tenant.id);
  });

  test('expired assignment does not overwrite an already assigned card', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({
      tenantId: fixture.tenant.id,
      responsibleRoleId: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG,
      unclaimedUntil: '2026-09-21T11:59:00Z',
    });
    const claimed = claimRunCard(card, {
      basisRev: 'rev-1',
      actor: {
        id: 'user-mako-1',
        tenantId: fixture.tenant.id,
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        displayName: 'Mako Person 1',
      },
      roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      now: '2026-09-21T12:00:00Z',
    });

    const reassigned = assignExpiredUnclaimedRunCard(claimed.card, {
      fixture,
      now: '2026-09-21T12:01:00Z',
    });

    expect(reassigned).toEqual({
      ok: false,
      code: 'already_assigned',
      assignedTo: claimed.card.assignment.actor,
      currentBasisRev: 'rev-2',
    });
  });

  test('claim rejects actors from the wrong tenant or without the claimed role', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({ tenantId: fixture.tenant.id, basisRev: 'rev-1' });

    expect(
      claimRunCard(card, {
        basisRev: 'rev-1',
        actor: {
          id: 'user-other-tenant',
          tenantId: 'anderer-mandant',
          roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        },
        roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
        now: '2026-09-21T12:00:00Z',
      })
    ).toEqual({ ok: false, code: 'actor_tenant_mismatch', expectedTenantId: fixture.tenant.id });

    expect(
      claimRunCard(card, {
        basisRev: 'rev-1',
        actor: {
          id: 'user-mako-1',
          tenantId: fixture.tenant.id,
          roleIds: [RC2_ROLE_IDS.NETZPLANUNG],
        },
        roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
        now: '2026-09-21T12:00:00Z',
      })
    ).toEqual({
      ok: false,
      code: 'actor_role_mismatch',
      roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
    });
  });

  test('freeze creates append-only evidence state', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({ tenantId: fixture.tenant.id, basisRev: 'rev-1' });
    const frozen = freezeRunCard(card, {
      basisRev: 'rev-1',
      actor: {
        id: 'user-mako-1',
        tenantId: fixture.tenant.id,
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        displayName: 'Mako Person 1',
      },
      now: '2026-09-21T12:02:00Z',
    });

    expect(frozen.ok).toBe(true);
    expect(frozen.card.evidenceState.status).toBe('eingefroren');
    expect(frozen.card.evidenceState.appendOnly).toBe(true);
    expect(frozen.card.history.map((entry) => entry.type)).toEqual(['frozen']);
    expect(card.history).toEqual([]);
  });

  test('approval request creates HITL state but no external write', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({ tenantId: fixture.tenant.id, basisRev: 'rev-1' });
    const requested = requestApproval(card, {
      basisRev: 'rev-1',
      roleId: RC2_ROLE_IDS.ABTEILUNGSLEITUNG,
      actor: {
        id: 'user-mako-1',
        tenantId: fixture.tenant.id,
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        displayName: 'Mako Person 1',
      },
      now: '2026-09-21T12:03:00Z',
    });

    expect(requested.ok).toBe(true);
    expect(requested.card.hitlRequests).toEqual([
      expect.objectContaining({
        id: 'hitl-1',
        roleId: RC2_ROLE_IDS.ABTEILUNGSLEITUNG,
        status: 'angefordert',
        externalExecute: false,
      }),
    ]);
    expect(requested.card.externalExecutions).toEqual([]);
  });

  test('Rückfluss is the only path to set decision', () => {
    const fixture = buildReferenceTenantFixture();
    const card = createReferenceRunCard({ tenantId: fixture.tenant.id, basisRev: 'rev-1' });
    const rejected = requestApproval(card, {
      basisRev: 'rev-1',
      roleId: RC2_ROLE_IDS.ABTEILUNGSLEITUNG,
      actor: {
        id: 'user-mako-1',
        tenantId: fixture.tenant.id,
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
        displayName: 'Mako Person 1',
      },
      decision: { status: 'erteilt' },
      now: '2026-09-21T12:03:00Z',
    });
    const decided = recordDecisionReturn(card, {
      basisRev: 'rev-1',
      decision: { status: 'erteilt', actorId: 'user-head', at: '2026-09-21T12:04:00Z' },
    });

    expect(rejected.card.decision).toBeNull();
    expect(decided.ok).toBe(true);
    expect(decided.card.decision).toEqual({
      status: 'erteilt',
      actorId: 'user-head',
      at: '2026-09-21T12:04:00Z',
    });
  });
});
