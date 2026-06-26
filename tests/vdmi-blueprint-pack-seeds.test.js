'use strict';

const {
  REQUIRED_DATA_CLASSES,
  REQUIRED_EVIDENCE,
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
