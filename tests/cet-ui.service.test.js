'use strict';

const service = require('../services/cet-ui.service');
const { RC2_ROLE_IDS } = require('../src/cet-ui-rc2/fixtures/reference-tenant');

function runtime() {
  const calls = [];
  return {
    calls,
    rc2Gateway: {
      getSessionContext: (context) => ({ schemaVersion: 'session', context }),
      getDailySurface: (context) => ({ schemaVersion: 'daily', context }),
      getCase: (context, args) => ({ schemaVersion: 'case', context, args }),
      getEvidence: (context, args) => ({ schemaVersion: 'evidence', context, args }),
      claimCase: (context, args) => {
        calls.push({ type: 'claim', context, args });
        return { ok: true, card: { basisRev: 'rev-2', assignment: { status: 'mir_zugewiesen' } } };
      },
      freezeCase: (context, args) => {
        calls.push({ type: 'freeze', context, args });
        return { ok: true, card: { evidenceState: { status: 'eingefroren' } } };
      },
      requestApproval: (context, args) => {
        calls.push({ type: 'approval', context, args });
        return { ok: true, card: { hitlRequests: [{ status: 'angefordert' }] } };
      },
      listOperations: (context) => ({ schemaVersion: 'operations', context, available: [] }),
      prepareOperation: (context, args) => ({
        operationId: args.operationId,
        projectionStatus: 'nicht_projiziert',
        unprojected: { raw: { operationId: args.operationId, tenantId: context.tenantId } },
      }),
    },
  };
}

function authenticatedCtx(params = {}) {
  return {
    params,
    meta: {
      tenantId: 'rc2-stadtwerk-a',
      user: { id: 'user-mako-1', displayName: 'Ada' },
      authUser: {
        userId: 'user-mako-1',
        tenantId: 'rc2-stadtwerk-a',
        roles: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      },
      activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      now: '2026-09-21T12:07:00Z',
    },
  };
}

describe('cet-ui service REST contract', () => {
  it('exposes the experimental /api/ui/v0 gateway action surface only', () => {
    expect(service.name).toBe('cet-ui');
    expect(service.settings.rest).toBe('/ui/v0');
    expect(service.actions.sessionContext.rest).toBe('GET /session-context');
    expect(service.actions.dailySurface.rest).toBe('GET /daily-surface');
    expect(service.actions.getCase.rest).toBe('GET /cases/:caseId');
    expect(service.actions.evidence.rest).toBe('GET /cases/:caseId/evidence');
    expect(service.actions.claimCase.rest).toBe('POST /cases/:caseId/claim');
    expect(service.actions.freeze.rest).toBe('POST /cases/:caseId/freeze');
    expect(service.actions.requestApproval.rest).toBe('POST /cases/:caseId/approval-requests');
    expect(service.actions.operations.rest).toBe('GET /operations');
    expect(service.actions.prepareOperation.rest).toBe('POST /operations/:operationId/prepare');
    expect(service.actions.recordAudit.rest).toBe('POST /audit-events');
    expect(service.actions.daily).toBeUndefined();
    expect(service.actions.takeOver).toBeUndefined();
  });

  it('rejects unauthenticated UI contexts instead of using default tenant/user fallbacks', () => {
    expect(() =>
      service.actions.dailySurface.handler.call(runtime(), { params: {}, meta: {} })
    ).toThrow(/authenticated tenant/);
    expect(() =>
      service.actions.claimCase.handler.call(runtime(), { params: { caseId: 'case-1' }, meta: {} })
    ).toThrow(/authenticated tenant/);
  });

  it('maps authUser identity and ignores requested roles outside authenticated roles', () => {
    const result = service.actions.dailySurface.handler.call(runtime(), {
      params: { activeRoleId: RC2_ROLE_IDS.NETZPLANUNG },
      meta: {
        authUser: {
          userId: 'user-department-head',
          tenantId: 'rc2-stadtwerk-a',
          roles: [RC2_ROLE_IDS.ABTEILUNGSLEITUNG],
        },
        activeRoleId: RC2_ROLE_IDS.NETZPLANUNG,
        now: '2026-09-21T12:07:00Z',
      },
    });

    expect(result.context).toEqual(
      expect.objectContaining({
        tenantId: 'rc2-stadtwerk-a',
        userId: 'user-department-head',
        activeRoleId: RC2_ROLE_IDS.ABTEILUNGSLEITUNG,
      })
    );
  });

  it('passes authenticated tenant, user and role metadata to the canonical gateway', () => {
    const rt = runtime();
    const result = service.actions.claimCase.handler.call(
      rt,
      authenticatedCtx({ caseId: 'vorgang-cr-lka-rv-001-article-id-change', basisRev: 'rev-1' })
    );

    expect(result.ok).toBe(true);
    expect(rt.calls[0]).toEqual(
      expect.objectContaining({
        type: 'claim',
        context: expect.objectContaining({
          tenantId: 'rc2-stadtwerk-a',
          userId: 'user-mako-1',
          activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
        }),
      })
    );
  });

  it('routes freeze and approval through the same canonical gateway as case/evidence', () => {
    const rt = runtime();

    service.actions.freeze.handler.call(
      rt,
      authenticatedCtx({ caseId: 'case-1', basisRev: 'rev-2' })
    );
    service.actions.requestApproval.handler.call(
      rt,
      authenticatedCtx({
        caseId: 'case-1',
        basisRev: 'rev-3',
        roleId: RC2_ROLE_IDS.ABTEILUNGSLEITUNG,
      })
    );

    expect(rt.calls.map((call) => call.type)).toEqual(['freeze', 'approval']);
  });

  it('stores audit events only inside the authenticated UI gateway boundary', () => {
    const runtime = {};
    const result = service.actions.recordAudit.handler.call(
      runtime,
      authenticatedCtx({
        event: 'view_opened',
        transport: 'ui_gateway',
        view: 'tagesflaeche',
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        stored: true,
        auditEvent: expect.objectContaining({
          event: 'view_opened',
          transport: 'ui_gateway',
          tenantId: 'rc2-stadtwerk-a',
          userId: 'user-mako-1',
        }),
      })
    );
    expect(runtime.auditEvents).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('http');
  });

  it('prepares operation output through the canonical gateway contract', async () => {
    const result = await service.actions.prepareOperation.handler.call(
      runtime(),
      authenticatedCtx({ operationId: 'mako.case.lookup' })
    );

    expect(result).toEqual(
      expect.objectContaining({
        operationId: 'mako.case.lookup',
        projectionStatus: 'nicht_projiziert',
        unprojected: expect.objectContaining({
          raw: expect.objectContaining({ operationId: 'mako.case.lookup' }),
        }),
      })
    );
    expect(result).not.toHaveProperty('kind');
    expect(result).not.toHaveProperty('rawPayload');
  });
});
