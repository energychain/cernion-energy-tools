'use strict';

const {
  buildOperationAuditPayload,
  classifyOperationResult,
  filterOperationCatalog,
} = require('../src/cet-ui-rc2/operation-console-contract');

const { RC2_ROLE_IDS } = require('../src/cet-ui-rc2/fixtures/reference-tenant');

function catalog() {
  return [
    {
      id: 'mako.case.lookup',
      label: 'MaKo Vorgang prüfen',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      mode: 'projected',
      riskClass: 'read',
      method: 'GET',
      governancePolicy: { id: 'rc2.mako.read', allowed: true, allowedMethods: ['GET'] },
    },
    {
      id: 'grid.raw.context',
      label: 'Netzkontext Rohdaten ansehen',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.NETZPLANUNG],
      mode: 'unprojected',
      riskClass: 'read_raw',
      method: 'GET',
      governancePolicy: { id: 'rc2.grid.raw.read', allowed: true, allowedMethods: ['GET'] },
    },
    {
      id: 'other.tenant.operation',
      label: 'Fremdmandant Operation',
      tenantIds: ['other-tenant'],
      roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      mode: 'projected',
      riskClass: 'read',
      method: 'GET',
      governancePolicy: { id: 'rc2.other.read', allowed: true, allowedMethods: ['GET'] },
    },
    {
      id: 'admin.all.access',
      label: 'Nicht erlaubter All Access',
      tenantIds: ['*'],
      roleIds: ['*'],
      mode: 'unprojected',
      riskClass: 'admin_raw',
      method: 'POST',
      governancePolicy: { id: 'rc2.admin.raw', allowed: true, allowedMethods: ['POST'] },
    },
    {
      id: 'policy.denied.operation',
      label: 'Governance gesperrte Operation',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      mode: 'unprojected',
      riskClass: 'write',
      method: 'POST',
      governancePolicy: { id: 'rc2.write.blocked', allowed: false, allowedMethods: ['POST'] },
    },
    {
      id: 'method.denied.operation',
      label: 'Methode nicht zulässig',
      tenantIds: ['rc2-stadtwerk-a'],
      roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      mode: 'unprojected',
      riskClass: 'write',
      method: 'DELETE',
      governancePolicy: { id: 'rc2.write.no-delete', allowed: true, allowedMethods: ['POST'] },
    },
  ];
}

function presentationContract() {
  return {
    schemaVersion: 'rc2.presentation-contract.v1',
    form: 'gate',
    titel: 'Operation Ergebnis',
    stand: '2026-09-21T12:00:00Z',
    aussagen: [
      {
        id: 'operation_result_count',
        label: 'Treffer',
        wert: 2,
        aggregatzustand: 'nachweisakte',
        granularitaet: 'aggregat',
        sicherheit: 'belegt',
        quelle: {
          klasse: 'abgeleitet',
          ref: 'operation://mako.case.lookup',
          stand: '2026-09-21T12:00:00Z',
        },
      },
    ],
    befunde: [],
    handlungen: [],
    nichtHandlungen: [
      {
        was: 'Rohdaten als Aussage darstellen',
        grund: 'Operationskonsole nur projiziert belegbar',
      },
    ],
  };
}

describe('CET UI RC2 operation console contract', () => {
  test('filters operation catalog by tenant and active role without all-access fallback', () => {
    const filtered = filterOperationCatalog(catalog(), {
      tenantId: 'rc2-stadtwerk-a',
      activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
    });

    expect(filtered.available).toEqual([
      {
        id: 'mako.case.lookup',
        label: 'MaKo Vorgang prüfen',
        mode: 'projected',
        riskClass: 'read',
        method: 'GET',
        governancePolicyId: 'rc2.mako.read',
      },
    ]);
    expect(filtered.denied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'grid.raw.context', boundaryReason: 'role_not_allowed' }),
        expect.objectContaining({
          id: 'other.tenant.operation',
          boundaryReason: 'tenant_not_allowed',
        }),
        expect.objectContaining({
          id: 'admin.all.access',
          boundaryReason: 'all_access_not_allowed',
        }),
        expect.objectContaining({
          id: 'policy.denied.operation',
          boundaryReason: 'governance_policy_denied',
        }),
        expect.objectContaining({
          id: 'method.denied.operation',
          boundaryReason: 'method_not_allowed_by_policy',
        }),
      ])
    );
  });

  test('wraps projected operation result as presentation contract only', () => {
    const result = classifyOperationResult({
      operationId: 'mako.case.lookup',
      projection: presentationContract(),
      raw: { governanceArchitecture: { resolutionValue: 'must-not-leak' } },
    });

    expect(result).toEqual({
      operationId: 'mako.case.lookup',
      projectionStatus: 'projiziert',
      presentationContract: presentationContract(),
    });
    expect(JSON.stringify(result)).not.toContain('governanceArchitecture');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  test('wraps unprojected operation result without markers or aggregate semantics', () => {
    const result = classifyOperationResult({
      operationId: 'grid.raw.context',
      raw: { rows: [{ id: 'raw-1', value: 7 }] },
    });

    expect(result).toEqual({
      operationId: 'grid.raw.context',
      projectionStatus: 'nicht_projiziert',
      unprojected: {
        notice: 'nicht_projiziert',
        raw: { rows: [{ id: 'raw-1', value: 7 }] },
      },
    });
    expect(result).not.toHaveProperty('aussagen');
    expect(JSON.stringify(result)).not.toContain('aggregatzustand');
    expect(JSON.stringify(result)).not.toContain('marker');
  });

  test('emits deterministic audit payload for operation use', () => {
    expect(
      buildOperationAuditPayload({
        tenantId: 'rc2-stadtwerk-a',
        userId: 'user-mako-1',
        activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
        operationId: 'mako.case.lookup',
        projectionStatus: 'projiziert',
        at: '2026-09-21T12:01:00Z',
      })
    ).toEqual({
      schemaVersion: 'rc2.operation-console-audit.v1',
      tenantId: 'rc2-stadtwerk-a',
      userId: 'user-mako-1',
      activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      operationId: 'mako.case.lookup',
      projectionStatus: 'projiziert',
      at: '2026-09-21T12:01:00Z',
      event: 'operation_console_used',
    });
  });
});
