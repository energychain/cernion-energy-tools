'use strict';

const {
  REQUIRED_DATA_CLASSES,
  REQUIRED_EVIDENCE,
  buildDemoProcessMatrixSync,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  listVdmiBlueprintPackSeeds,
  stadtwerkMauerPvMissingNap,
  validateVdmiBlueprintPackSeed,
} = require('../src/vdmi-blueprint-pack-seeds');

describe('VDMI Blueprint Pack seeds', () => {
  test('exposes the Stadtwerk Mauer PV missing NAP seed as versioned read-only metadata', () => {
    expect(stadtwerkMauerPvMissingNap).toMatchObject({
      id: 'stadtwerk-mauer-pv-missing-nap-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'pv_registration',
      controlCase: 'electrician_missing_nap',
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-pv-missing-nap-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-pv-missing-nap-v1')).toBe(
      stadtwerkMauerPvMissingNap
    );
  });

  test('validates required data-class separation and required evidence points', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerPvMissingNap);
    expect(result).toEqual({ valid: true, errors: [] });

    for (const dataClass of REQUIRED_DATA_CLASSES) {
      expect(stadtwerkMauerPvMissingNap.dataClasses[dataClass]).toBeDefined();
    }

    const evidenceIds = stadtwerkMauerPvMissingNap.evidenceRequirements.map((item) => item.id);
    expect(evidenceIds).toEqual(expect.arrayContaining(REQUIRED_EVIDENCE));
    for (const item of stadtwerkMauerPvMissingNap.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }
  });

  test('models role relations for Netzplanung, Grid Operator, and an informed audit role', () => {
    expect(stadtwerkMauerPvMissingNap.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: 'ROLE_NETZPLANUNG', relation: 'verantwortlich' }),
        expect.objectContaining({ roleId: 'ROLE_GRID_OPERATOR', relation: 'mitwirkend' }),
        expect.objectContaining({ roleId: 'ROLE_COMMERCIAL_AUDIT', relation: 'information' }),
      ])
    );
  });

  test('keeps runbook/workbench hints as metadata only and forbids write-side effects', () => {
    expect(stadtwerkMauerPvMissingNap.allowedCommandHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rundeck:stadtwerk-mauer-e2e-smoke',
          execution: 'metadata_only',
        }),
      ])
    );

    expect(stadtwerkMauerPvMissingNap.forbiddenActions).toEqual(
      expect.arrayContaining([
        'mako_write',
        'billing',
        'settlement',
        'smgw_cls_device_control',
        'external_connector_call',
        'hitl_create',
        'public_context_mutation',
        'production_mutation',
        'personal_agent_hardcoding',
      ])
    );
    expect(stadtwerkMauerPvMissingNap.publicContextMutationAllowed).toBe(false);
    expect(stadtwerkMauerPvMissingNap.tenantProvisioningAllowed).toBe(false);
    expect(stadtwerkMauerPvMissingNap.realWorldClaim).toBe('synthetic_demo_only');
  });

  test('exposes a canonical Demo-Raum process matrix for PV missing NAP sync', () => {
    const matrix = stadtwerkMauerPvMissingNap.demoProcessMatrix;

    expect(matrix.slug).toBe('pv-registration-missing-nap');
    expect(matrix.roleLegend.M).toBe('Mitwirkend');
    expect(matrix.rows).toHaveLength(4);
    expect(matrix.rows.length).toBeGreaterThanOrEqual(3);
    expect(matrix.rows.length).toBeLessThanOrEqual(5);
    expect(matrix.allowedDataClasses).toEqual(REQUIRED_DATA_CLASSES);
    expect(matrix.downstreamHandoff).toMatchObject({
      blueprintPack: 'complete',
      landingRegistry: 'pending',
      productiveDemoRoom: 'pending',
    });

    for (const row of matrix.rows) {
      expect(row).toEqual(
        expect.objectContaining({
          phase: expect.any(String),
          v: expect.stringMatching(/^ROLE_/),
          d: expect.stringMatching(/^ROLE_/),
          m: expect.stringMatching(/^ROLE_/),
          i: expect.stringMatching(/^ROLE_/),
          evidenceRequirements: expect.arrayContaining([expect.any(String)]),
          dataClassRefs: expect.arrayContaining([expect.any(String)]),
          gateOutcome: expect.any(String),
          enablesDossierAddition: expect.any(String),
        })
      );

      for (const roleCell of [row.v, row.d, row.m, row.i]) {
        expect(REQUIRED_DATA_CLASSES).not.toContain(roleCell);
        expect(roleCell).not.toMatch(/Phase|Verantwortlich|Durchfuehrend|Mitwirkend|Informiert|Nachweise/);
      }

      for (const dataClass of row.dataClassRefs) {
        expect(REQUIRED_DATA_CLASSES).toContain(dataClass);
      }
    }
  });

  test('builds scalar matrix-sync facts for Workbench verification', () => {
    const sync = buildDemoProcessMatrixSync(stadtwerkMauerPvMissingNap);

    expect(sync).toMatchObject({
      slug: 'pv-registration-missing-nap',
      expectedSlug: 'pv-registration-missing-nap',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
    });
    expect(sync.evidenceRequirements).toEqual(
      expect.arrayContaining([
        'napReference',
        'maloId',
        'meloId',
        'meterId',
        'customerConsentStatus',
      ])
    );
    expect(sync.dataClassRefs).toEqual(
      expect.arrayContaining(['publicContextLayer', 'syntheticTenantSeed', 'sandboxRuntimeArtifact'])
    );
  });

  test('maps missing evidence to clarification/workbench additions without execution', () => {
    const items = buildWorkbenchClarificationItems(stadtwerkMauerPvMissingNap);

    expect(items).toHaveLength(REQUIRED_EVIDENCE.length);
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'napReference',
        state: 'clarification',
        roleHint: 'ROLE_NETZPLANUNG',
        execution: 'none',
        enablesDossierAddition: expect.stringContaining('Netzanschlusspunkt'),
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'customerConsentStatus',
        state: 'clarification',
        execution: 'none',
      })
    );
  });
});
