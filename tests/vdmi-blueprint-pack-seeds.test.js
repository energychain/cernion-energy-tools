'use strict';

const {
  REQUIRED_DATA_CLASSES,
  REQUIRED_EVIDENCE,
  REQUIRED_REDISPATCH_READINESS_EVIDENCE,
  REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE,
  buildDemoProcessMatrixSync,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  listVdmiBlueprintPackSeeds,
  stadtwerkMauerPvMissingNap,
  stadtwerkMauerRedispatchParticipationReadiness,
  stadtwerkMauerSubstationLoadAssessment,
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

  test('exposes the Redispatch participation readiness seed as read-only metadata', () => {
    expect(stadtwerkMauerRedispatchParticipationReadiness).toMatchObject({
      id: 'stadtwerk-mauer-redispatch-participation-readiness-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'redispatch_readiness',
      controlCase: 'redispatch_participation_readiness',
      sourceTemplateId: 'redispatch-participation-confirmation',
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-redispatch-participation-readiness-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-redispatch-participation-readiness-v1')).toBe(
      stadtwerkMauerRedispatchParticipationReadiness
    );
  });

  test('exposes the substation load assessment seed as read-only metadata', () => {
    expect(stadtwerkMauerSubstationLoadAssessment).toMatchObject({
      id: 'stadtwerk-mauer-substation-load-assessment-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'grid_capacity_governance',
      controlCase: 'substation_load_assessment',
      sourceTemplateId: 'substation-load-assessment',
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-substation-load-assessment-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-substation-load-assessment-v1')).toBe(
      stadtwerkMauerSubstationLoadAssessment
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

  test('validates Redispatch readiness evidence without operational side effects', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerRedispatchParticipationReadiness);
    expect(result).toEqual({ valid: true, errors: [] });

    const evidenceIds = stadtwerkMauerRedispatchParticipationReadiness.evidenceRequirements.map(
      (item) => item.id
    );
    expect(evidenceIds).toEqual(expect.arrayContaining(REQUIRED_REDISPATCH_READINESS_EVIDENCE));
    for (const item of stadtwerkMauerRedispatchParticipationReadiness.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }

    expect(stadtwerkMauerRedispatchParticipationReadiness.forbiddenActions).toEqual(
      expect.arrayContaining([
        'redispatch_enrollment',
        'dispatch_control',
        'mako_write',
        'billing',
        'settlement',
        'tariff_mutation',
        'smgw_cls_device_control',
        'external_connector_call',
        'hitl_create',
        'production_mutation',
        'personal_agent_hardcoding',
      ])
    );
  });

  test('validates substation load assessment evidence without investment or control side effects', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerSubstationLoadAssessment);
    expect(result).toEqual({ valid: true, errors: [] });

    const evidenceIds = stadtwerkMauerSubstationLoadAssessment.evidenceRequirements.map(
      (item) => item.id
    );
    expect(evidenceIds).toEqual(
      expect.arrayContaining(REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE)
    );
    for (const item of stadtwerkMauerSubstationLoadAssessment.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }

    expect(stadtwerkMauerSubstationLoadAssessment.forbiddenActions).toEqual(
      expect.arrayContaining([
        'grid_expansion_decision',
        'procurement_start',
        'budget_approval',
        'section_14a_switching',
        'flex_dispatch',
        'device_control',
        'billing',
        'settlement',
        'tariff_mutation',
        'external_connector_call',
        'production_mutation',
        'personal_agent_hardcoding',
      ])
    );
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

  test('exposes a canonical Demo-Raum process matrix for Redispatch readiness sync', () => {
    const matrix = stadtwerkMauerRedispatchParticipationReadiness.demoProcessMatrix;

    expect(matrix.slug).toBe('redispatch-participation-readiness');
    expect(matrix.roleLegend.M).toBe('Mitwirkend');
    expect(matrix.rows).toHaveLength(5);
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
        expect(roleCell).not.toMatch(
          /Phase|Verantwortlich|Durchfuehrend|Mitwirkend|Informiert|Nachweise/
        );
      }
    }
  });

  test('exposes a canonical Demo-Raum process matrix for substation load assessment sync', () => {
    const matrix = stadtwerkMauerSubstationLoadAssessment.demoProcessMatrix;

    expect(matrix.slug).toBe('substation-load-assessment');
    expect(matrix.roleLegend.M).toBe('Mitwirkend');
    expect(matrix.rows).toHaveLength(5);
    expect(matrix.allowedDataClasses).toEqual(REQUIRED_DATA_CLASSES);
    expect(matrix.downstreamHandoff).toMatchObject({
      blueprintPack: 'complete',
      landingRegistry: 'pending',
      productiveDemoRoom: 'pending',
    });
    expect(matrix.rows[2]).toMatchObject({
      phase: '3',
      v: 'ROLE_ASSET_PLANNING_LEAD',
      d: 'ROLE_CERNION_GOVERNANCE',
      m: 'ROLE_GRID_OPERATIONS',
      i: 'ROLE_COMMERCIAL_AUDIT',
      evidenceRequirements: ['flexOptionEvidence', 'capexOptionEvidence'],
      gateOutcome: 'flex_capex_scenario_review_only',
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
        expect(roleCell).not.toMatch(
          /Phase|Verantwortlich|Durchfuehrend|Mitwirkend|Informiert|Nachweise/
        );
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

  test('builds scalar matrix-sync facts for Redispatch readiness verification', () => {
    const sync = buildDemoProcessMatrixSync(stadtwerkMauerRedispatchParticipationReadiness);

    expect(sync).toMatchObject({
      slug: 'redispatch-participation-readiness',
      expectedSlug: 'redispatch-participation-readiness',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
    });
    expect(sync.evidenceRequirements).toEqual(
      expect.arrayContaining([
        'syntheticRedispatchAssetPortfolio',
        'installationGridLocationEvidence',
        'remoteControlCommunicationTestEvidence',
        'forecastDispatchTestProof',
        'readinessReviewDecision',
      ])
    );
  });

  test('builds scalar matrix-sync facts for substation load assessment verification', () => {
    const sync = buildDemoProcessMatrixSync(stadtwerkMauerSubstationLoadAssessment);

    expect(sync).toMatchObject({
      slug: 'substation-load-assessment',
      expectedSlug: 'substation-load-assessment',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
    });
    expect(sync.evidenceRequirements).toEqual(
      expect.arrayContaining(REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE)
    );
    expect(sync.rows[2]).toMatchObject({
      phase: '3',
      roles: {
        V: 'ROLE_ASSET_PLANNING_LEAD',
        D: 'ROLE_CERNION_GOVERNANCE',
        M: 'ROLE_GRID_OPERATIONS',
        I: 'ROLE_COMMERCIAL_AUDIT',
      },
      gateOutcome: 'flex_capex_scenario_review_only',
    });
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

  test('maps Redispatch readiness missing evidence to non-executing workbench additions', () => {
    const items = buildWorkbenchClarificationItems(stadtwerkMauerRedispatchParticipationReadiness);

    expect(items).toHaveLength(REQUIRED_REDISPATCH_READINESS_EVIDENCE.length);
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'remoteControlCommunicationTestEvidence',
        state: 'evidence_gap',
        roleHint: 'ROLE_GRID_OPERATIONS_LEAD',
        execution: 'none',
        enablesDossierAddition: expect.stringContaining('never as a control action'),
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'readinessReviewDecision',
        state: 'clarification',
        execution: 'none',
      })
    );
  });

  test('maps substation load assessment missing evidence to non-executing workbench additions', () => {
    const items = buildWorkbenchClarificationItems(stadtwerkMauerSubstationLoadAssessment);

    expect(items).toHaveLength(REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE.length);
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'stationBoundaryEvidence',
        state: 'evidence_gap',
        roleHint: 'ROLE_ASSET_PLANNING_LEAD',
        execution: 'none',
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'reviewGateMarker',
        state: 'clarification',
        execution: 'none',
        enablesDossierAddition: expect.stringContaining('next safe review gate'),
      })
    );
  });
});
