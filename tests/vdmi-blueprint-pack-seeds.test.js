'use strict';

const {
  REQUIRED_DATA_CLASSES,
  REQUIRED_CONNECTION_DEADLINE_EVIDENCE,
  REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE,
  REQUIRED_EVIDENCE,
  REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_EVIDENCE,
  REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_EVIDENCE,
  REQUIRED_REDISPATCH_READINESS_EVIDENCE,
  REQUIRED_SUBSTATION_LOAD_ASSESSMENT_EVIDENCE,
  buildDemoProcessMatrixSync,
  buildLandingRegistryDraftFromBlueprintSeed,
  buildWorkbenchClarificationItems,
  getVdmiBlueprintPackSeed,
  listVdmiBlueprintPackSeeds,
  stadtwerkMauerConnectionDeadlineEvidenceQueue,
  stadtwerkMauerEnergySharingCollectiveApproval,
  stadtwerkMauerGasTransformationDataroomReview,
  stadtwerkMauerPvMissingNap,
  stadtwerkMauerPortfolioMarketValueReadiness,
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

  test('exposes the Anschlussfristen Evidence Queue seed as read-only metadata', () => {
    expect(stadtwerkMauerConnectionDeadlineEvidenceQueue).toMatchObject({
      id: 'stadtwerk-mauer-connection-deadline-evidence-queue-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'connection_deadline_governance',
      controlCase: 'connection_deadline_evidence_queue',
      sourceApi: {
        operation: 'GET /api/dashboard/connection-deadline-evidence-queue',
        path: '/api/dashboard/connection-deadline-evidence-queue',
        method: 'GET',
        readOnly: true,
      },
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-connection-deadline-evidence-queue-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-connection-deadline-evidence-queue-v1')).toBe(
      stadtwerkMauerConnectionDeadlineEvidenceQueue
    );
  });

  test('exposes the Portfolio Market Value Readiness seed as read-only metadata', () => {
    expect(stadtwerkMauerPortfolioMarketValueReadiness).toMatchObject({
      id: 'stadtwerk-mauer-portfolio-market-value-readiness-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'energy_market_portfolio_readiness',
      controlCase: 'portfolio_market_value_readiness',
      sourceApi: {
        operation: 'POST /api/energy-market/portfolio-backtest',
        path: '/api/energy-market/portfolio-backtest',
        method: 'POST',
        capability: 'energy-market.portfolioBacktest',
        readOnly: true,
        invocation: 'source_hint_only',
      },
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-portfolio-market-value-readiness-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-portfolio-market-value-readiness-v1')).toBe(
      stadtwerkMauerPortfolioMarketValueReadiness
    );
  });

  test('exposes the Gas Transformation Dataroom Review seed as read-only metadata', () => {
    expect(stadtwerkMauerGasTransformationDataroomReview).toMatchObject({
      id: 'stadtwerk-mauer-gas-transformation-dataroom-review-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'gas_transformation_dataroom_review',
      controlCase: 'gas_transformation_dataroom_status_review',
      sourceApi: {
        operation: 'GET /api/dashboard/gas-transformation-dataroom',
        path: '/api/dashboard/gas-transformation-dataroom',
        method: 'GET',
        workbenchBrick: 'gas_transformation_dataroom_status',
        readOnly: true,
        invocation: 'source_hint_only',
      },
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-gas-transformation-dataroom-review-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-gas-transformation-dataroom-review-v1')).toBe(
      stadtwerkMauerGasTransformationDataroomReview
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

  test('validates Anschlussfristen Evidence Queue evidence without connection-process side effects', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerConnectionDeadlineEvidenceQueue);
    expect(result).toEqual({ valid: true, errors: [] });

    const evidenceIds = stadtwerkMauerConnectionDeadlineEvidenceQueue.evidenceRequirements.map(
      (item) => item.id
    );
    expect(evidenceIds).toEqual(expect.arrayContaining(REQUIRED_CONNECTION_DEADLINE_EVIDENCE));
    for (const item of stadtwerkMauerConnectionDeadlineEvidenceQueue.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }

    expect(stadtwerkMauerConnectionDeadlineEvidenceQueue.forbiddenActions).toEqual(
      expect.arrayContaining([
        'connection_approval',
        'connection_rejection',
        'connection_conditioning',
        'capacity_reservation',
        'legal_deadline_calculation',
        'customer_communication',
        'crm_write',
        'mail_send',
        'workflow_create',
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

  test('validates Portfolio Market Value Readiness evidence without market or publication side effects', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerPortfolioMarketValueReadiness);
    expect(result).toEqual({ valid: true, errors: [] });

    const evidenceIds = stadtwerkMauerPortfolioMarketValueReadiness.evidenceRequirements.map(
      (item) => item.id
    );
    expect(evidenceIds).toEqual(
      expect.arrayContaining(REQUIRED_PORTFOLIO_MARKET_VALUE_READINESS_EVIDENCE)
    );
    for (const item of stadtwerkMauerPortfolioMarketValueReadiness.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }

    expect(stadtwerkMauerPortfolioMarketValueReadiness.forbiddenActions).toEqual(
      expect.arrayContaining([
        'portfolio_persistence',
        'portfolio_upload_storage',
        'object_store_mutation',
        'cache_mutation',
        'real_customer_data',
        'real_meter_data',
        'trading_approval',
        'supplier_approval',
        'balancing_group_approval',
        'investment_advice',
        'market_value_commitment',
        'dispatch_curtailment',
        'device_control',
        'mako_write',
        'billing',
        'settlement',
        'tariff_mutation',
        'smgw_cls_device_control',
        'external_connector_call',
        'hitl_create',
        'budibase_table_write',
        'landing_registry_publication',
        'cernion_de_publication',
        'production_mutation',
        'personal_agent_hardcoding',
      ])
    );
  });

  test('validates Gas Transformation Dataroom Review evidence without dataroom or publication side effects', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerGasTransformationDataroomReview);
    expect(result).toEqual({ valid: true, errors: [] });

    const evidenceIds = stadtwerkMauerGasTransformationDataroomReview.evidenceRequirements.map(
      (item) => item.id
    );
    expect(evidenceIds).toEqual(
      expect.arrayContaining(REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_EVIDENCE)
    );
    for (const item of stadtwerkMauerGasTransformationDataroomReview.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }

    expect(stadtwerkMauerGasTransformationDataroomReview.forbiddenActions).toEqual(
      expect.arrayContaining([
        'object_store_write',
        'dataroom_persistence',
        'rag_ingestion',
        'tenant_knowledge_promotion',
        'legal_regulatory_decision',
        'investment_approval',
        'h2_conversion_execution',
        'decommissioning_execution',
        'gremium_approval',
        'hitl_create',
        'workflow_create',
        'mail_send',
        'mako_write',
        'billing',
        'settlement',
        'tariff_mutation',
        'smgw_cls_device_control',
        'external_connector_call',
        'budibase_table_write',
        'landing_registry_publication',
        'cernion_de_publication',
        'public_context_mutation',
        'production_mutation',
        'personal_agent_hardcoding',
      ])
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

  test('exposes a canonical Demo-Raum process matrix for Anschlussfristen Evidence Queue sync', () => {
    const matrix = stadtwerkMauerConnectionDeadlineEvidenceQueue.demoProcessMatrix;

    expect(matrix.slug).toBe('connection-deadline-evidence-queue');
    expect(matrix.roleLegend.M).toBe('Mitwirkend');
    expect(matrix.rows).toHaveLength(4);
    expect(matrix.allowedDataClasses).toEqual(REQUIRED_DATA_CLASSES);
    expect(matrix.downstreamHandoff).toMatchObject({
      blueprintPack: 'complete',
      landingRegistry: 'pending',
      productiveDemoRoom: 'pending',
    });
    expect(matrix.rows[2]).toMatchObject({
      phase: '3',
      v: 'ROLE_NETZPLANUNG',
      d: 'ROLE_ANSCHLUSSWESEN',
      m: 'ROLE_CUSTOMER_COMMUNICATION',
      i: 'ROLE_COMMERCIAL_AUDIT',
      evidenceRequirements: ['clarificationOwnerEvidence', 'communicationNoteDraftEvidence'],
      gateOutcome: 'clarification_owner_and_non_sending_note_available',
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

  test('exposes a canonical Demo-Raum process matrix for Portfolio Market Value Readiness sync', () => {
    const matrix = stadtwerkMauerPortfolioMarketValueReadiness.demoProcessMatrix;

    expect(matrix.slug).toBe('portfolio-market-value-readiness');
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
      v: 'ROLE_ENERGY_MARKET_ANALYST',
      d: 'ROLE_CERNION_GOVERNANCE',
      m: 'ROLE_MARKET_DATA_PROVIDER',
      i: 'ROLE_COMMERCIAL_AUDIT',
      evidenceRequirements: [
        'spotPriceCoverageEvidence',
        'cacheCoverageEvidence',
        'noExternalCallEvidence',
      ],
      gateOutcome: 'price_cache_coverage_verified_read_only',
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

  test('exposes a canonical Demo-Raum process matrix for Gas Transformation Dataroom Review sync', () => {
    const matrix = stadtwerkMauerGasTransformationDataroomReview.demoProcessMatrix;

    expect(matrix.slug).toBe('gas-transformation-dataroom-review');
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
      v: 'ROLE_REGULATORY_AFFAIRS',
      d: 'ROLE_CERNION_GOVERNANCE',
      m: 'ROLE_ENERGY_ECONOMICS',
      i: 'ROLE_MANAGEMENT',
      evidenceRequirements: [
        'scenarioReferenceEvidence',
        'eogKanuBoundaryEvidence',
        'noLegalDecisionEvidence',
      ],
      gateOutcome: 'scenario_and_regulatory_boundary_review_only',
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

  test('exposes the Energy Sharing collective approval seed as read-only metadata', () => {
    expect(stadtwerkMauerEnergySharingCollectiveApproval).toMatchObject({
      id: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
      kind: 'vdmi_blueprint_pack_seed',
      version: '1.0.0',
      safetyClassification: 'read_only_blueprint_seed',
      processFamily: 'energy_sharing_governance',
      controlCase: 'energy_sharing_collective_approval',
      sourceTemplateId: 'energy-sharing-collective-approval',
      demoTenant: {
        tenantId: 'stadtwerk-mauer',
        classification: 'synthetic_demo_tenant',
      },
    });

    expect(listVdmiBlueprintPackSeeds()).toContainEqual(
      expect.objectContaining({
        id: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
        demoTenantId: 'stadtwerk-mauer',
      })
    );
    expect(getVdmiBlueprintPackSeed('stadtwerk-mauer-energy-sharing-collective-approval-v1')).toBe(
      stadtwerkMauerEnergySharingCollectiveApproval
    );
  });

  test('builds scalar matrix-sync facts for Anschlussfristen Evidence Queue verification', () => {
    const sync = buildDemoProcessMatrixSync(stadtwerkMauerConnectionDeadlineEvidenceQueue);

    expect(sync).toMatchObject({
      slug: 'connection-deadline-evidence-queue',
      expectedSlug: 'connection-deadline-evidence-queue',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 4,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
    });
    expect(sync.evidenceRequirements).toEqual(
      expect.arrayContaining(REQUIRED_CONNECTION_DEADLINE_EVIDENCE)
    );
    expect(sync.rows[2]).toMatchObject({
      phase: '3',
      roles: {
        V: 'ROLE_NETZPLANUNG',
        D: 'ROLE_ANSCHLUSSWESEN',
        M: 'ROLE_CUSTOMER_COMMUNICATION',
        I: 'ROLE_COMMERCIAL_AUDIT',
      },
      gateOutcome: 'clarification_owner_and_non_sending_note_available',
    });
  });

  test('builds scalar matrix-sync facts for Gas Transformation Dataroom Review verification', () => {
    const sync = buildDemoProcessMatrixSync(stadtwerkMauerGasTransformationDataroomReview);

    expect(sync).toMatchObject({
      slug: 'gas-transformation-dataroom-review',
      expectedSlug: 'gas-transformation-dataroom-review',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
    });
    expect(sync.evidenceRequirements).toEqual(
      expect.arrayContaining(REQUIRED_GAS_TRANSFORMATION_DATAROOM_REVIEW_EVIDENCE)
    );
    expect(sync.rows[3]).toMatchObject({
      phase: '4',
      roles: {
        V: 'ROLE_DATAROOM_OWNER',
        D: 'ROLE_CERNION_GOVERNANCE',
        M: 'ROLE_EXTERNAL_REVIEWER',
        I: 'ROLE_COMMERCIAL_AUDIT',
      },
      gateOutcome: 'evidence_register_and_decision_log_review_pending',
    });
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

  test('validates Energy Sharing collective approval evidence without onboarding or settlement side effects', () => {
    const result = validateVdmiBlueprintPackSeed(stadtwerkMauerEnergySharingCollectiveApproval);
    expect(result).toEqual({ valid: true, errors: [] });

    const evidenceIds = stadtwerkMauerEnergySharingCollectiveApproval.evidenceRequirements.map(
      (item) => item.id
    );
    expect(evidenceIds).toEqual(
      expect.arrayContaining(REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE)
    );
    for (const item of stadtwerkMauerEnergySharingCollectiveApproval.evidenceRequirements) {
      expect(item.dataClass).toBe('syntheticTenantSeed');
      expect(item.enablesDossierAddition).toEqual(expect.any(String));
    }

    expect(stadtwerkMauerEnergySharingCollectiveApproval.forbiddenActions).toEqual(
      expect.arrayContaining([
        'participant_onboarding',
        'customer_communication',
        'contract_signing',
        'allocation_execution',
        'a96_settlement_export',
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

  test('exposes a canonical Demo-Raum process matrix for Energy Sharing collective approval sync', () => {
    const matrix = stadtwerkMauerEnergySharingCollectiveApproval.demoProcessMatrix;

    expect(matrix.slug).toBe('energy-sharing-collective-approval');
    expect(matrix.roleLegend.M).toBe('Mitwirkend');
    expect(matrix.rows).toHaveLength(5);
    expect(matrix.allowedDataClasses).toEqual(REQUIRED_DATA_CLASSES);
    expect(matrix.downstreamHandoff).toMatchObject({
      blueprintPack: 'complete',
      landingRegistry: 'pending',
      productiveDemoRoom: 'pending',
    });
    expect(matrix.rows[3]).toMatchObject({
      phase: '4',
      v: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
      d: 'ROLE_CERNION_GOVERNANCE',
      m: 'ROLE_SETTLEMENT_BILLING_SPECIALIST',
      i: 'ROLE_COMMERCIAL_AUDIT',
      evidenceRequirements: ['allocationBillingSettlementGapEvidence'],
      gateOutcome: 'allocation_a96_billing_settlement_evidence_gap',
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

  test('builds scalar matrix-sync facts for Energy Sharing collective approval verification', () => {
    const sync = buildDemoProcessMatrixSync(stadtwerkMauerEnergySharingCollectiveApproval);

    expect(sync).toMatchObject({
      slug: 'energy-sharing-collective-approval',
      expectedSlug: 'energy-sharing-collective-approval',
      synced: true,
      roleLegendM: 'Mitwirkend',
      rowCount: 5,
      rowCountValid: true,
      roleCellsClean: true,
      dataClassesLimited: true,
      forbiddenActionsStatus: 'not_introduced',
    });
    expect(sync.evidenceRequirements).toEqual(
      expect.arrayContaining(REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE)
    );
    expect(sync.rows[3]).toMatchObject({
      phase: '4',
      roles: {
        V: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
        D: 'ROLE_CERNION_GOVERNANCE',
        M: 'ROLE_SETTLEMENT_BILLING_SPECIALIST',
        I: 'ROLE_COMMERCIAL_AUDIT',
      },
      gateOutcome: 'allocation_a96_billing_settlement_evidence_gap',
    });
  });

  test('derives a Landing-Registry draft from the canonical substation matrix', () => {
    const draft = buildLandingRegistryDraftFromBlueprintSeed(stadtwerkMauerSubstationLoadAssessment);

    expect(draft).toMatchObject({
      slug: 'substation-load-assessment',
      processFamily: 'grid_capacity_governance',
      controlCase: 'substation_load_assessment',
      seedId: 'stadtwerk-mauer-substation-load-assessment-v1',
      canonicalSource:
        'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-substation-load-assessment-v1.json',
      roleHeaders: [
        'Phase',
        'V = Verantwortlich',
        'D = Durchfuehrend',
        'M = Mitwirkend',
        'I = Informiert',
        'Nachweise',
      ],
      rowCount: 5,
      syncProof: {
        blueprintPack: expect.objectContaining({ status: 'complete' }),
        landingRegistryDraft: expect.objectContaining({ status: 'draft_ready' }),
        productiveDemoRoom: expect.objectContaining({ status: 'pending' }),
      },
    });
    expect(draft.roleLegend.M).toBe('Mitwirkend');
    expect(draft.rows[2]).toMatchObject({
      phase: '3',
      V: 'ROLE_ASSET_PLANNING_LEAD',
      D: 'ROLE_CERNION_GOVERNANCE',
      M: 'ROLE_GRID_OPERATIONS',
      I: 'ROLE_COMMERCIAL_AUDIT',
      evidenceRequirements: ['flexOptionEvidence', 'capexOptionEvidence'],
      gateOutcome: 'flex_capex_scenario_review_only',
      positiveFollowUp: expect.stringContaining('Flex'),
    });
    expect(draft.publicationBlockers).toEqual(
      expect.arrayContaining(['productive_demo_room_publication_issue_missing'])
    );
    expect(draft.sourceActions.notCalled).toEqual(
      expect.arrayContaining([
        'cernion.de.publish',
        'landing-registry.write',
        'budibase.table.write',
        'operations-runbook.execute',
        'personal-agent.execute',
      ])
    );
  });

  test('derives an Energy Sharing Landing-Registry draft from the canonical collective approval matrix', () => {
    const draft = buildLandingRegistryDraftFromBlueprintSeed(
      stadtwerkMauerEnergySharingCollectiveApproval
    );

    expect(draft).toMatchObject({
      slug: 'energy-sharing-collective-approval',
      processFamily: 'energy_sharing_governance',
      controlCase: 'energy_sharing_collective_approval',
      seedId: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
      canonicalSource:
        'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-energy-sharing-collective-approval-v1.json',
      roleHeaders: [
        'Phase',
        'V = Verantwortlich',
        'D = Durchfuehrend',
        'M = Mitwirkend',
        'I = Informiert',
        'Nachweise',
      ],
      rowCount: 5,
      syncProof: {
        blueprintPack: expect.objectContaining({ status: 'complete' }),
        landingRegistryDraft: expect.objectContaining({ status: 'draft_ready' }),
        productiveDemoRoom: expect.objectContaining({ status: 'pending' }),
      },
    });
    expect(draft.roleLegend.M).toBe('Mitwirkend');
    expect(draft.rows).toHaveLength(5);
    expect(draft.rows[3]).toMatchObject({
      phase: '4',
      V: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
      D: 'ROLE_CERNION_GOVERNANCE',
      M: 'ROLE_SETTLEMENT_BILLING_SPECIALIST',
      I: 'ROLE_COMMERCIAL_AUDIT',
      evidenceRequirements: ['allocationBillingSettlementGapEvidence'],
      gateOutcome: 'allocation_a96_billing_settlement_evidence_gap',
      positiveFollowUp: expect.stringContaining('A96'),
    });
    expect(draft.syntheticDataStatement).toContain('synthetic review data');
    expect(draft.sourceActions.notCalled).toEqual(
      expect.arrayContaining([
        'cernion.de.publish',
        'landing-registry.write',
        'budibase.table.write',
        'allocation_execution',
        'a96_settlement_export',
        'billing',
        'settlement',
        'mako_write',
        'device-control.execute',
        'personal-agent.execute',
      ])
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

  test('maps Energy Sharing collective approval missing evidence to non-executing workbench additions', () => {
    const items = buildWorkbenchClarificationItems(stadtwerkMauerEnergySharingCollectiveApproval);

    expect(items).toHaveLength(REQUIRED_ENERGY_SHARING_COLLECTIVE_APPROVAL_EVIDENCE.length);
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'allocationBillingSettlementGapEvidence',
        state: 'evidence_gap',
        roleHint: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
        execution: 'none',
        enablesDossierAddition: expect.stringContaining('never execution'),
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        evidenceId: 'approvalReadinessDecision',
        state: 'clarification',
        execution: 'none',
        enablesDossierAddition: expect.stringContaining('next safe governance gate'),
      })
    );
  });
});
