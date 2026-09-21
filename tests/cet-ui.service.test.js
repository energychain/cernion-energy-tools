'use strict';

const service = require('../services/cet-ui.service');

describe('cet-ui service REST contract', () => {
  it('exposes the experimental /api/ui/v0 action surface', () => {
    expect(service.name).toBe('cet-ui');
    expect(service.settings.rest).toBe('/ui/v0');
    expect(service.actions.daily.rest).toBe('GET /daily');
    expect(service.actions.getCase.rest).toBe('GET /cases/:caseId');
    expect(service.actions.evidence.rest).toBe('GET /cases/:caseId/evidence');
    expect(service.actions.takeOver.rest).toBe('POST /cases/:caseId/takeover');
    expect(service.actions.freeze.rest).toBe('POST /cases/:caseId/freeze');
    expect(service.actions.requestApproval.rest).toBe('POST /cases/:caseId/approval-requests');
    expect(service.actions.operations.rest).toBe('GET /operations');
    expect(service.actions.prepareOperation.rest).toBe('POST /operations/:operationId/prepare');
  });

  it('wraps prepared operation output as not-projected JSON for the renderer', async () => {
    const ctx = {
      params: { operationId: 'capability.openapi.lookup', tenantId: 'sw-beispiel' },
      meta: { user: { id: 'u1', displayName: 'Ada' } },
    };
    const fakeRuntime = {
      store: {
        async prepareOperation(input) {
          expect(input.tenantId).toBe('sw-beispiel');
          expect(input.operationId).toBe('capability.openapi.lookup');
          expect(input.actor.displayName).toBe('Ada');
          return {
            projectionStatus: 'not_projected',
            rawPayload: { operationId: input.operationId },
            rawPayloadNotice: 'Noch nicht projiziert',
            usageLogRef: 'cet-ui-operation-usage:test',
          };
        },
      },
    };

    const result = await service.actions.prepareOperation.handler.call(fakeRuntime, ctx);

    expect(result.kind).toBe('not_projected_json');
    expect(result.evidenceMarkers).toEqual([]);
    expect(result.usageLogRef).toBe('cet-ui-operation-usage:test');
  });
});
