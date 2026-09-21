'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildReferenceUiGateway,
  buildReferenceUiGatewayContext,
} = require('../src/cet-ui-rc2/ui-gateway-adapter');
const { RC2_ROLE_IDS } = require('../src/cet-ui-rc2/fixtures/reference-tenant');

const apiServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'api.service.js'),
  'utf8'
);
const uiMainSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'cet-ui', 'src', 'main.js'),
  'utf8'
);

describe('CET UI RC2 REST gateway', () => {
  test('registers explicit /api/ui/v0 route aliases without direct RC1 paths', () => {
    expect(apiServiceSource).toContain("'GET /ui/v0/session-context'");
    expect(apiServiceSource).toContain("'GET /ui/v0/daily-surface'");
    expect(apiServiceSource).toContain("'GET /ui/v0/cases/:caseId'");
    expect(apiServiceSource).toContain("'GET /ui/v0/cases/:caseId/evidence'");
    expect(apiServiceSource).toContain("'POST /ui/v0/cases/:caseId/claim'");
    expect(apiServiceSource).toContain("'POST /ui/v0/cases/:caseId/freeze'");
    expect(apiServiceSource).toContain("'POST /ui/v0/cases/:caseId/approval-requests'");
    expect(apiServiceSource).toContain("'GET /ui/v0/operations'");
    expect(apiServiceSource).toContain("'POST /ui/v0/operations/:operationId/prepare'");
    expect(apiServiceSource).not.toContain('/ui/v0/governanceArchitecture');
    expect(apiServiceSource).not.toContain('/ui/v0/rc1');
    expect(apiServiceSource).not.toContain("rest: 'GET /daily'");
    expect(apiServiceSource).not.toContain("rest: 'POST /cases/:caseId/takeover'");
    expect(apiServiceSource).toContain("pathOnly.startsWith('/api/ui/v0/') && m === 'POST'");
    expect(apiServiceSource).toContain('Authentication required for protected endpoints.');
    expect(apiServiceSource).toContain(
      'Valid API or session token required for protected endpoints.'
    );
  });

  test('session context exposes tenant, user, roles and placeholder-agent flags', () => {
    const gateway = buildReferenceUiGateway();
    const response = gateway.getSessionContext(
      buildReferenceUiGatewayContext({
        tenantId: 'rc2-stadtwerk-a',
        userId: 'user-mako-1',
      })
    );

    expect(response).toEqual(
      expect.objectContaining({
        schemaVersion: 'rc2.ui-session-context.v1',
        tenant: { id: 'rc2-stadtwerk-a', label: 'RC2 Stadtwerk A' },
        user: expect.objectContaining({ id: 'user-mako-1', tenantId: 'rc2-stadtwerk-a' }),
      })
    );
    expect(response.roles.map((role) => role.id)).toContain(RC2_ROLE_IDS.MARKTKOMMUNIKATION);
    expect(response.activeRoleCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
          placeholderAgent: false,
        }),
        expect.objectContaining({
          roleId: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG,
          placeholderAgent: true,
        }),
      ])
    );
  });

  test('daily surface returns interaction projections only', () => {
    const response = buildReferenceUiGateway().getDailySurface(
      buildReferenceUiGatewayContext({ activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION })
    );

    expect(response.schemaVersion).toBe('rc2.ui-daily-surface.v1');
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toEqual({
      caseId: 'vorgang-cr-lka-rv-001-article-id-change',
      title: 'Artikel-ID-Änderung prüfen',
      aufmerksamkeitsgrund: 'uebergabe_an_mich',
      rollenwirkung: '14 Klärfälle müssen fachlich zugeordnet werden',
      status: 'Mir zugewiesen',
      interactionProjection: expect.objectContaining({
        schemaVersion: 'rc2.interaction-projection.v1',
        activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      }),
    });
    expect(JSON.stringify(response)).not.toContain('governanceArchitecture');
  });

  test('case endpoint returns view model from presentation contract', () => {
    const response = buildReferenceUiGateway().getCase(
      buildReferenceUiGatewayContext({ activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION }),
      { caseId: 'vorgang-cr-lka-rv-001-article-id-change' }
    );

    expect(response.schemaVersion).toBe('rc2.ui-case-view.v1');
    expect(response.caseId).toBe('vorgang-cr-lka-rv-001-article-id-change');
    expect(response.presentationContract.schemaVersion).toBe('rc2.presentation-contract.v1');
    expect(response.visibleStatus).toBe('mir_zugewiesen');
    expect(JSON.stringify(response)).not.toContain('resolutionValue');
  });

  test('claim writes CET-owned run-card state', () => {
    const gateway = buildReferenceUiGateway();
    const context = buildReferenceUiGatewayContext({
      activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      userId: 'user-mako-1',
      now: '2026-09-21T12:10:00Z',
    });

    const response = gateway.claimCase(context, {
      caseId: 'vorgang-cr-lka-rv-001-article-id-change',
      basisRev: 'rev-1',
    });

    expect(response.ok).toBe(true);
    expect(response.card.assignment.status).toBe('mir_zugewiesen');
    expect(response.card.externalExecutions).toEqual([]);
    expect(response.card.history).toContainEqual(
      expect.objectContaining({ type: 'claimed', at: '2026-09-21T12:10:00Z' })
    );
  });

  test('operations endpoint does not trust client-requested roles outside the user roles', () => {
    const response = buildReferenceUiGateway().listOperations(
      buildReferenceUiGatewayContext({
        userId: 'user-mako-1',
        activeRoleId: RC2_ROLE_IDS.NETZPLANUNG,
      })
    );

    expect(response.activeRoleId).toBe(RC2_ROLE_IDS.MARKTKOMMUNIKATION);
    expect(response.available).toEqual([
      expect.objectContaining({
        id: 'mako.case.lookup',
        riskClass: 'read',
        method: 'GET',
        governancePolicyId: 'rc2.mako.read',
      }),
    ]);
    expect(response.available.map((operation) => operation.id)).not.toContain('grid.raw.context');
  });

  test('operation prepare uses filtered catalog and canonical unprojected result contract', () => {
    const gateway = buildReferenceUiGateway();
    const allowed = gateway.prepareOperation(
      buildReferenceUiGatewayContext({ activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION }),
      { operationId: 'mako.case.lookup' }
    );
    expect(allowed).toEqual(
      expect.objectContaining({
        operationId: 'mako.case.lookup',
        projectionStatus: 'nicht_projiziert',
        unprojected: expect.objectContaining({ raw: expect.any(Object) }),
        audit: expect.objectContaining({
          schemaVersion: 'rc2.operation-console-audit.v1',
          event: 'operation_console_used',
          projectionStatus: 'nicht_projiziert',
        }),
      })
    );
    expect(allowed).not.toHaveProperty('rawPayload');
    expect(allowed).not.toHaveProperty('kind');

    const denied = gateway.prepareOperation(
      buildReferenceUiGatewayContext({
        userId: 'user-mako-1',
        activeRoleId: RC2_ROLE_IDS.NETZPLANUNG,
      }),
      { operationId: 'grid.raw.context' }
    );
    expect(denied).toEqual({
      ok: false,
      code: 'operation_not_available',
      operationId: 'grid.raw.context',
    });
  });

  test('SPA uses the explicit gateway routes and current response shapes', () => {
    expect(uiMainSource).toContain("daily: '/api/ui/v0/daily-surface'");
    expect(uiMainSource).toContain('surface.items');
    expect(uiMainSource).toContain('operations.available');
    expect(uiMainSource).toContain('presentationContract?.aussagen');
    expect(uiMainSource).toContain('/claim');
    expect(uiMainSource).not.toContain("daily: '/api/ui/v0/daily'");
    expect(uiMainSource).not.toContain('operations.operations');
    expect(uiMainSource).not.toContain('presentationContract?.elements');
    expect(uiMainSource).not.toContain('/takeover');
  });
});
