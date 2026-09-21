'use strict';

const service = require('../services/cet-ui.service');

describe('cet-ui service REST contract', () => {
  it('exposes only the stabilized experimental /api/ui/v0 action surface', () => {
    expect(service.name).toBe('cet-ui');
    expect(service.settings.rest).toBe('/ui/v0');
    expect(service.actions.sessionContext.rest).toBe('GET /session-context');
    expect(service.actions.dailySurface.rest).toBe('GET /daily-surface');
    expect(service.actions.daily.rest).toBeUndefined();
    expect(service.actions.getCase.rest).toBe('GET /cases/:caseId');
    expect(service.actions.evidence.rest).toBe('GET /cases/:caseId/evidence');
    expect(service.actions.claimCase.rest).toBe('POST /cases/:caseId/claim');
    expect(service.actions.takeOver.rest).toBeUndefined();
    expect(service.actions.freeze.rest).toBe('POST /cases/:caseId/freeze');
    expect(service.actions.requestApproval.rest).toBe('POST /cases/:caseId/approval-requests');
    expect(service.actions.operations.rest).toBe('GET /operations');
    expect(service.actions.prepareOperation.rest).toBe('POST /operations/:operationId/prepare');
  });

  it('wraps prepared operation output with the canonical RC2 unprojected contract', () => {
    const ctx = {
      params: { operationId: 'mako.case.lookup', tenantId: 'client-supplied-ignored' },
      meta: {
        tenantId: 'rc2-stadtwerk-a',
        user: { id: 'user-mako-1', displayName: 'Ada' },
        activeRoleId: 'RC2_ROLE_MARKTKOMMUNIKATION',
      },
    };

    const result = service.actions.prepareOperation.handler.call({}, ctx);

    expect(result).toEqual(
      expect.objectContaining({
        operationId: 'mako.case.lookup',
        projectionStatus: 'nicht_projiziert',
        unprojected: expect.objectContaining({ raw: expect.any(Object) }),
      })
    );
    expect(result).not.toHaveProperty('kind');
    expect(result).not.toHaveProperty('rawPayload');
  });

  it('does not prepare operations outside the resolved tenant/role catalog', () => {
    const ctx = {
      params: { operationId: 'grid.raw.context' },
      meta: {
        tenantId: 'rc2-stadtwerk-a',
        user: { id: 'user-mako-1', displayName: 'Ada' },
        activeRoleId: 'RC2_ROLE_NETZPLANUNG',
      },
    };

    expect(service.actions.prepareOperation.handler.call({}, ctx)).toEqual({
      ok: false,
      code: 'operation_not_available',
      operationId: 'grid.raw.context',
    });
  });
});
