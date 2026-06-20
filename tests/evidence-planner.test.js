'use strict';

/**
 * T-EV-001: evidence-planner unit tests (Phase 1 – annotation only)
 * T-EV-002: buildExecutionPlan attaches evidencePlan sidecar for known routes
 * T-EV-003: Personal Agent response includes evidencePlan field
 * T-EV-004: Phase 2 synthesis gate logic
 * T-EV-005: Phase 3 generic fallback for unregistered routes
 * T-EV-006: Phase 4 routing-matrix shortcuts — registry entries for all ROUTING_MATRIX keys
 * T-EV-007: Phase 5 semantic forecast evidence detection for near-term Redispatch probability
 */

const {
  planEvidence,
  isSourceSatisfied,
  computeConfidence,
  shouldBlockSynthesisOnGaps,
  buildEvidenceGapPresentation,
} = require('../src/evidence-planner');
const { buildExecutionPlan } = require('../src/personal-agent-routing');
const { listRegisteredKeys } = require('../src/evidence-registry');

// ── T-EV-001 ─────────────────────────────────────────────────────────────────
describe('T-EV-001 — evidence-planner: planEvidence() pure-function contract', () => {
  it('returns null for an unknown route key', () => {
    const plan = { routeKey: 'unknown-route-xyz', primaryIntent: 'some_intent' };
    expect(planEvidence(plan, {})).toBeNull();
  });

  it('returns null when plan is null or missing key', () => {
    expect(planEvidence(null, {})).toBeNull();
    expect(planEvidence({}, {})).toBeNull();
  });

  it('returns a valid evidencePlan for residual_load_forecast_for_dso with no context', () => {
    const plan = {
      routeKey: null,
      routeLabel: 'residual_load_forecast_for_dso',
      primaryIntent: 'residual_load_forecast_for_dso',
    };
    const result = planEvidence(plan, {});

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('residual_load_forecast_for_dso');
    expect(Array.isArray(result.requiredSources)).toBe(true);
    expect(result.requiredSources.length).toBeGreaterThan(0);
    expect(Array.isArray(result.checkedSources)).toBe(true);
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(typeof result.confidence).toBe('number');
    expect(result.phaseNote).toBe('evidence-plan-phase1-annotation-only');
  });

  it('marks vnb_identity as gap when knownContext has no VNB keys', () => {
    const plan = { routeLabel: 'residual_load_forecast_for_dso' };
    const result = planEvidence(plan, {});
    const gapIds = result.gaps.map((g) => g.id);
    expect(gapIds).toContain('vnb_identity');
  });

  it('marks vnb_identity as checked when gridOperatorId is present in context', () => {
    const plan = { routeLabel: 'residual_load_forecast_for_dso' };
    const result = planEvidence(plan, { gridOperatorId: 'SNB123' });
    expect(result.checkedSources).toContain('vnb_identity');
    const gapIds = result.gaps.map((g) => g.id);
    expect(gapIds).not.toContain('vnb_identity');
  });

  it('confidence is 0.0 when no required sources are satisfied', () => {
    const plan = { routeLabel: 'residual_load_forecast_for_dso' };
    const result = planEvidence(plan, {});
    expect(result.confidence).toBe(0.0);
  });

  it('confidence is 1.0 when all required sources are satisfied', () => {
    const plan = { routeLabel: 'residual_load_forecast_for_dso' };
    // vnb_identity is the only required source; satisfying it gives full confidence
    const result = planEvidence(plan, { gridOperatorId: 'SNB999' });
    expect(result.confidence).toBeGreaterThanOrEqual(1.0);
  });

  it('treats market-communication portal material as hint-only and keeps official evidence gaps', () => {
    const result = planEvidence(
      { routeLabel: 'market_communication_evidence_chain' },
      { portalScreenshot: 'portal-view-1' }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('market_communication_evidence_chain');
    expect(result.checkedSources).toContain('portal_or_provider_hint');
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining(['malo_identity', 'utilmd_masterdata_path', 'meter_values'])
    );
    expect(result.confidence).toBe(0);
  });

  it('marks market-communication official evidence checked only from structured MaKo/EDM context', () => {
    const result = planEvidence(
      { routeLabel: 'market_communication_evidence_chain' },
      {
        maloId: 'DE-MALO-1',
        meloId: 'DE-MELO-1',
        utilmdMasterdataPath: 'utilmd:123',
        meterValueBatchId: 'mscons:123',
        consumptionRetrievalStatus: 'available',
        dataQualityStatus: 'usable',
        nextBillingStep: 'settlement_review',
      }
    );

    expect(result.gaps).toEqual([]);
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'malo_identity',
        'melo_identity',
        'utilmd_masterdata_path',
        'meter_values',
        'consumption_retrieval',
        'data_quality_status',
        'next_billing_step',
      ])
    );
    expect(result.confidence).toBeGreaterThanOrEqual(1);
  });

  it('plans E2E controllability governance as explicit handover evidence, not inferred readiness', () => {
    const result = planEvidence(
      { routeLabel: 'e2e_controllability_check_governance' },
      {
        connectionIntake: 'grid-connection:ok',
        owner: 'netzanschluss',
        deadline: '2026-07-01',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('e2e_controllability_check_governance');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['connection_intake', 'owner_deadline_open_measure'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'metering_concept',
        'asset_control_capability',
        'grid_operations_decision',
        'market_communication_handover',
        'billing_impact_check',
      ])
    );
  });

  it('plans controllability asset handover as explicit asset and owner evidence', () => {
    const result = planEvidence(
      { routeLabel: 'controllability_asset_handover' },
      {
        assetId: 'asset-194',
        mastrId: 'SEE-194',
        technicalStatus: 'checked',
        lineOwnerRole: 'Assetmanagement',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('controllability_asset_handover');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['asset_inventory', 'technical_status', 'line_owner'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'nap_melo_mapping',
        'feedback_capability',
        'controllability_scope',
        'data_source_snapshot',
        'check_result',
        'next_reporting_cycle',
        'handover_decision',
      ])
    );
  });

  it('plans controllability submission cockpit as explicit submission and handover evidence', () => {
    const result = planEvidence(
      { routeLabel: 'controllability_submission_cockpit' },
      {
        submissionId: 'submission-176',
        coordinator: 'Netzbetrieb',
        sourceList: ['vdmi:176'],
        dataReconciliationStatus: 'reconciled',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('controllability_submission_cockpit');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'submission_identity',
        'coordinator',
        'source_list',
        'data_reconciliation_status',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'submission_deadline',
        'reason_catalog',
        'asset_group_statuses',
        'open_measures',
        'handover_decision',
        'handover_owner',
        'next_cycle_tasks',
      ])
    );
  });

  it('plans regulatory change readiness as explicit data and audit evidence', () => {
    const result = planEvidence(
      { routeLabel: 'regulatory_change_simulator_readiness' },
      {
        changeId: 'reg-change:eeg-2027',
        effectiveDate: '2027-01-01',
        mechanismType: 'EEG',
        dictionaryVersion: 'dd-v1',
        intervalCoverage: 'complete',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('regulatory_change_simulator_readiness');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['data_contract', 'dictionary_version', 'interval_profile_coverage'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'source_datapoints',
        'master_data_quality',
        'substitute_value_policy',
        'market_communication_cases',
        'operator_declaration',
        'billing_rule_reference',
        'audit_trail',
        'test_case_pack',
      ])
    );
  });

  it('plans investment two-track control as tactical and target-process evidence', () => {
    const result = planEvidence(
      { routeLabel: 'investment_two_track_control' },
      {
        submissionId: 'submission-195',
        deadline: '2026-09-30',
        submissionFormat: 'finance-board-pack',
        tacticalOwner: 'Assetmanagement',
        financeReviewStatus: 'reviewed',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('investment_two_track_control');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['submission_contract', 'tactical_owner', 'finance_review'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'measures_and_budget',
        'board_format',
        'source_datapoints',
        'data_quality_plan',
        'target_owner',
        'approval_model',
        'handover_status',
      ])
    );
  });

  it('plans SAP Budget PSP Gate as budget and PSP evidence', () => {
    const result = planEvidence(
      { routeLabel: 'sap_budget_psp_gate' },
      {
        measureId: 'measure-196',
        measureName: 'Trafostation Migration',
        migrationWave: 'wave-2026-q3',
        pspElementId: 'PSP-2026-4711',
        pspCarryOverEur: 18000,
        sourceSnapshotId: 'snapshot:sap-psp-196',
        ownerRole: 'Finance Asset Owner',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('sap_budget_psp_gate');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['measure_context', 'psp_snapshot', 'budget_owner'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'sap_mapping',
        'budget_values',
        'asset_benefit',
        'finance_gate',
        'approval_status',
        'data_quality',
      ])
    );
  });

  it('plans Energy Tax Information Package as dictionary and handover evidence', () => {
    const result = planEvidence(
      { routeLabel: 'energy_tax_information_package' },
      {
        packageId: 'etip-188',
        dataSourceId: 'datasource-tax-metering',
        dictionaryVersion: 'dd-v1',
        period: '2026-Q1',
        responsibleOwner: 'Tax Data Owner',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('energy_tax_information_package');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['package_identity', 'data_dictionary', 'period_definition', 'responsible_owner'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'aggregation_logic',
        'validation_status',
        'handover_contact',
        'sla',
        'audit_reference',
        'handover_decision',
      ])
    );
  });

  it('plans Investment Risk Translation Status as source and handover evidence', () => {
    const result = planEvidence(
      { routeLabel: 'investment_risk_translation_status' },
      {
        sourceRef: 'gf-slide-191',
        sourceType: 'gf_slide',
        period: '2026-Q3',
        division: 'Stromnetz',
        classification: 'decision_basis',
        ownerRole: 'Asset Risk Owner',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('investment_risk_translation_status');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['source_identity', 'period_division', 'classification', 'owner_role'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'impact_context',
        'decision_readiness',
        'blocked_decision',
        'next_action',
        'source_snapshot',
        'evidence_refs',
      ])
    );
  });

  it('plans Budget Waterfall Governance as baseline, sign and approval evidence', () => {
    const result = planEvidence(
      { routeLabel: 'budget_waterfall_governance' },
      {
        waterfallId: 'bwg-189',
        period: '2026-Q3',
        division: 'Stromnetz',
        baselineRef: 'baseline:2026',
        signConvention: 'positive reduces headroom',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('budget_waterfall_governance');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['source_identity', 'period_division', 'baseline_reference', 'sign_convention'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'forecast_cutoff',
        'carryover_logic',
        'owner_role',
        'approval_status',
        'follow_up_decision',
        'source_snapshot_ref',
        'evidence_ref',
      ])
    );
  });

  it('plans Gas Decommissioning Roadmap as phase, dependency and gate evidence', () => {
    const result = planEvidence(
      { routeLabel: 'gas_decommissioning_roadmap_status' },
      {
        roadmapId: 'gdr-190',
        currentPhase: 'committee-gate',
        owner: 'Netzstrategie',
        assetRiskEvidence: 'asset-risk:west-loop',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('gas_decommissioning_roadmap_status');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['roadmap_identity', 'current_phase', 'owner', 'asset_risk_evidence'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'dependency_map',
        'investment_impact_ref',
        'committee_gate_date',
        'execution_handover_owner',
        'next_decision_gate',
        'source_snapshot_ref',
        'evidence_ref',
      ])
    );
  });

  it('plans Jour-Fixe Decision Closure as owner, KPI and gate evidence', () => {
    const result = planEvidence(
      { routeLabel: 'jour_fixe_decision_closure_tracker' },
      {
        topicId: 'jf-186',
        jourFixeId: 'jf-weekly',
        owner: 'Netzstrategie',
        kpi: 'closure-rate',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('jour_fixe_decision_closure_tracker');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining(['topic_identity', 'jour_fixe_context', 'topic_owner', 'kpi'])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'decision_criterion',
        'next_gate',
        'closure_status',
        'closure_proof',
        'source_snapshot_ref',
        'evidence_ref',
      ])
    );
  });

  it('plans Off-Balancing Metering Pruefmatrix as finance, EOG and headroom evidence', () => {
    const result = planEvidence(
      { routeLabel: 'off_balancing_metering_pruefmatrix' },
      {
        meteringScope: 'smart-meter-rollout-west',
        financingModel: 'leasing',
        capexOpexBaseline: 'baseline:2026',
        financierConditions: 'covenants:documented',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('off_balancing_metering_pruefmatrix');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'metering_scope',
        'financing_model',
        'capex_opex_baseline',
        'financier_conditions',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'eog_regulatory_effect',
        'cost_recognition_assumption',
        'data_quality_status',
        'interface_risk_status',
        'grid_investment_space_proof',
      ])
    );
  });

  it('plans Automation Requirements Decision Value as source, flow and decision evidence', () => {
    const result = planEvidence(
      { routeLabel: 'automation_requirements_decision_value' },
      {
        requirementId: 'ardv:181',
        requestType: 'PowerBI dashboard',
        sourceSystem: 'edm',
        movingDataFlow: 'edm-to-dashboard',
        decisionValue: 'weekly redispatch exception decision',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('automation_requirements_decision_value');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'request_identity',
        'request_type',
        'source_system',
        'moving_data_flow',
        'decision_value',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'follow_up_process',
        'data_quality',
        'rollback_or_stop_criterion',
      ])
    );
  });

  it('plans iMSys Schedule Value Chain as metering, forecast and handover evidence', () => {
    const result = planEvidence(
      { routeLabel: 'imsys_schedule_value_chain_readiness' },
      {
        caseId: 'isvc:199',
        meteringScope: 'imsys-west',
        sourceDatapoints: ['taf7-load'],
        forecastWindow: '2026-Q3 rolling',
        congestionSignal: 'lv-congestion',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('imsys_schedule_value_chain_readiness');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'metering_scope',
        'source_datapoints',
        'forecast_window',
        'congestion_signal',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'controllability_status',
        'control_readiness',
        'line_owner_role',
      ])
    );
  });

  it('plans Smart-Meter Off-Balancing Purpose Lock as finance and purpose evidence', () => {
    const result = planEvidence(
      { routeLabel: 'smart_meter_off_balancing_purpose_lock' },
      {
        caseId: 'smopl:198',
        assetScope: 'smart-meter-west',
        financingModel: 'service-lease',
        freedLiquidityEur: 820000,
        purposeLockedMeasures: ['leitwarte-upgrade'],
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('smart_meter_off_balancing_purpose_lock');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'asset_scope',
        'financing_model',
        'freed_liquidity_eur',
        'purpose_lock_measures_missing',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'regulatory_recognition_status',
        'finance_review_missing',
        'budget_dilution_risk_open',
      ])
    );
  });

  it('plans CLS Digital Twin Compliance Gate as governance and evidence bundle', () => {
    const result = planEvidence(
      { routeLabel: 'cls_digital_twin_compliance_gate' },
      {
        procurementId: 'proc-197',
        systemPurpose: 'cls-digital-twin-review',
        dataFlowMap: 'dfm:197',
        rolesAccessRights: ['leitwarte-read'],
        avvStatus: 'available',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('cls_digital_twin_compliance_gate');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'system_purpose',
        'data_flow_map',
        'roles_access_rights',
        'avv_status',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'rbac_refs',
        'dsfa_status',
        'billing_module_impact',
        'regulatory_evidence_status',
        'security_evidence_refs',
      ])
    );
  });

  it('plans Legacy Control Technology Transition as feedback, testability and roadmap evidence', () => {
    const result = planEvidence(
      { routeLabel: 'legacy_control_technology_transition' },
      {
        assetGroupId: 'legacy-group-175',
        controlTechnology: 'rundsteuertechnik-gruppensignal',
        feedbackCapability: 'available',
        testFeasibility: 'maintenance-window',
      }
    );

    expect(result).not.toBeNull();
    expect(result.registryKey).toBe('legacy_control_technology_transition');
    expect(result.checkedSources).toEqual(
      expect.arrayContaining([
        'asset_group_or_asset',
        'control_technology',
        'feedback_capability',
        'test_feasibility',
      ])
    );
    expect(result.gaps.map((gap) => gap.id)).toEqual(
      expect.arrayContaining([
        'test_status',
        'non_execution_reason',
        'migration_roadmap',
        'owner_next_action',
      ])
    );
  });

  it('isSourceSatisfied returns false when contextKeys is empty', () => {
    expect(isSourceSatisfied({ contextKeys: [] }, { foo: 'bar' })).toBe(false);
  });

  it('isSourceSatisfied returns false for null/empty values', () => {
    expect(isSourceSatisfied({ contextKeys: ['gridOperatorId'] }, { gridOperatorId: null })).toBe(
      false
    );
    expect(isSourceSatisfied({ contextKeys: ['gridOperatorId'] }, { gridOperatorId: '' })).toBe(
      false
    );
  });

  it('computeConfidence returns 1.0 when no sources defined', () => {
    expect(computeConfidence([], new Set())).toBe(1.0);
  });
});

// ── T-EV-002 ─────────────────────────────────────────────────────────────────
describe('T-EV-002 — buildExecutionPlan attaches evidencePlan sidecar', () => {
  it('attaches evidencePlan for residual_load_forecast_for_dso via capability-broker path', () => {
    const plan = buildExecutionPlan({
      message: 'Residuallast für Stadtwerke Heidelberg berechnen',
      brokerRecommendation: {
        recommendedCapabilities: [
          { capability: 'residual_load_forecast_for_dso', confidence: 0.9 },
        ],
      },
      knownContext: {},
    });

    expect(plan).toHaveProperty('evidencePlan');
    expect(plan.evidencePlan).not.toBeNull();
    expect(plan.evidencePlan.registryKey).toBe('residual_load_forecast_for_dso');
    expect(plan.evidencePlan.phaseNote).toBe('evidence-plan-phase1-annotation-only');
  });

  it('evidencePlan shows gap for vnb_identity when knownContext is empty', () => {
    const plan = buildExecutionPlan({
      message: 'Residuallast für VNB berechnen',
      brokerRecommendation: {
        recommendedCapabilities: [
          { capability: 'residual_load_forecast_for_dso', confidence: 0.9 },
        ],
      },
      knownContext: {},
    });

    const gapIds = plan.evidencePlan.gaps.map((g) => g.id);
    expect(gapIds).toContain('vnb_identity');
  });

  it('evidencePlan uses generic fallback for unknown/unregistered capability (Phase 3)', () => {
    const plan = buildExecutionPlan({
      message: 'Irgendwas unbekanntes',
      brokerRecommendation: null,
      knownContext: {},
    });

    // Phase 3: unknown routes now get a generic coverage plan (not null)
    expect(plan).toHaveProperty('evidencePlan');
    // Generic plan can be null if no steps are present, but should not be undefined
    if (plan.evidencePlan !== null) {
      expect(plan.evidencePlan.source).toBe('generic');
    }
  });

  it('does not block execution — plan.status is still ready/partial after evidencePlan annotation', () => {
    const plan = buildExecutionPlan({
      message: 'Residuallast für Stadtwerke berechnen',
      brokerRecommendation: {
        recommendedCapabilities: [
          { capability: 'residual_load_forecast_for_dso', confidence: 0.9 },
        ],
      },
      knownContext: {},
    });

    expect(['ready', 'partial']).toContain(plan.status);
  });
});

// ── T-EV-004 ─────────────────────────────────────────────────────────────────
describe('T-EV-004 — Phase 2 synthesis gate: shouldBlockSynthesisOnGaps()', () => {
  const {
    shouldBlockSynthesisOnGaps,
    buildEvidenceGapPresentation,
  } = require('../src/evidence-planner');

  it('returns false when evidencePlan is null', () => {
    expect(shouldBlockSynthesisOnGaps(null)).toBe(false);
  });

  it('returns false when confidence is high (≥0.8)', () => {
    const ep = {
      confidence: 0.9,
      gaps: [],
      checkedSources: ['vnb_identity'],
      requiredSources: [],
    };
    expect(shouldBlockSynthesisOnGaps(ep)).toBe(false);
  });

  it('returns true when vnb_identity is in gaps (critical source missing)', () => {
    const ep = {
      confidence: 0.0,
      gaps: [
        {
          id: 'vnb_identity',
          label: 'VNB-Identität',
          resolvedBy: ['grid-operations.marketPartners'],
        },
      ],
      checkedSources: [],
      requiredSources: [],
    };
    expect(shouldBlockSynthesisOnGaps(ep)).toBe(true);
  });

  it('returns true when asset_profile is missing', () => {
    const ep = {
      confidence: 0.4,
      gaps: [
        {
          id: 'asset_profile',
          label: 'Asset-Profil',
          resolvedBy: ['finance-agent.analyze'],
        },
      ],
      checkedSources: ['netzanschlusszusage'],
      requiredSources: [],
    };
    expect(shouldBlockSynthesisOnGaps(ep)).toBe(true);
  });

  it('returns true when confidence is 0.0 (no sources satisfied)', () => {
    const ep = {
      confidence: 0.0,
      gaps: [
        {
          id: 'some_other_gap',
          label: 'Other Gap',
          resolvedBy: [],
        },
      ],
      checkedSources: [],
      requiredSources: [],
    };
    expect(shouldBlockSynthesisOnGaps(ep)).toBe(true);
  });

  it('returns false when optional sources are missing but required are satisfied', () => {
    const ep = {
      confidence: 0.5,
      gaps: [
        {
          id: 'co2_intensity',
          label: 'CO₂-Intensität',
          resolvedBy: ['energy-market.co2Intensity'],
        },
      ],
      checkedSources: ['vnb_identity'],
      requiredSources: [{ id: 'vnb_identity', optional: false }],
    };
    expect(shouldBlockSynthesisOnGaps(ep)).toBe(false);
  });

  it('buildEvidenceGapPresentation returns structured payload from evidencePlan', () => {
    const ep = {
      registryKey: 'residual_load_forecast_for_dso',
      requiredSources: [
        { id: 'vnb_identity', label: 'VNB-Identität', optional: false },
        { id: 'forecast_horizon', label: 'Forecast-Horizont', optional: true },
      ],
      checkedSources: [],
      gaps: [
        {
          id: 'vnb_identity',
          label: 'VNB-Identität',
          resolvedBy: ['grid-operations.marketPartners'],
        },
      ],
      confidence: 0.0,
    };

    const result = buildEvidenceGapPresentation(ep);
    expect(result.confidence).toBe(0.0);
    expect(result.evidenceGaps).toHaveLength(1);
    expect(result.evidenceGaps[0].id).toBe('vnb_identity');
    expect(result.requiredSources).toHaveLength(1); // only required (not optional)
    expect(result.phaseNote).toBe('evidence-plan-phase2-synthesis-gate');
  });
});

// ── T-EV-005 — Phase 3: Generic tool-coverage fallback ─────────────────────
describe('T-EV-005 — evidence-planner: Phase 3 generic fallback for unregistered routes', () => {
  it('falls back to generic coverage when route is not in Evidence Registry', () => {
    const plan = {
      routeLabel: 'unknown-capability-xyz',
      steps: [
        { action: 'grid-operations.marketPartners', paramsTemplate: { gridOperatorId: null } },
      ],
    };
    const context = {};
    const result = planEvidence(plan, context);

    // Phase 3: should not return null anymore, should have generic plan
    expect(result).not.toBeNull();
    expect(result.source).toBe('generic');
    expect(result.phaseNote).toContain('Phase 3');
  });

  it('generic coverage analyzes plan.steps to infer missing params', () => {
    const plan = {
      routeLabel: 'custom-route-no-registry',
      steps: [
        // Use an action with a paramsTemplate but not in the actionOutputMap
        {
          action: 'unknown-action-xyz',
          paramsTemplate: { gridOperatorId: null, customParam: null },
        },
      ],
    };
    const context = {}; // no context values for these params
    const result = planEvidence(plan, context);

    expect(result).not.toBeNull();
    expect(result.source).toBe('generic');
    // Generic plan should have gaps for the missing params
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1.0);
  });

  it('generic coverage confidence improves when context has param values', () => {
    const plan = {
      routeLabel: 'custom-route-no-registry',
      steps: [
        // Unknown action that won't produce outputs in the map
        { action: 'unknown-xyz', paramsTemplate: { customParam1: null, customParam2: null } },
      ],
    };

    // First: no context
    const resultEmpty = planEvidence(plan, {});
    const confEmpty = resultEmpty ? resultEmpty.confidence : 0;

    // Second: with context values
    const resultFull = planEvidence(plan, { customParam1: 'value1', customParam2: 'value2' });
    const confFull = resultFull ? resultFull.confidence : 0;

    expect(resultFull).not.toBeNull();
    expect(confFull).toBeGreaterThanOrEqual(confEmpty);
    expect(confFull).toBe(1.0); // All params provided
  });

  it('registry-based plan takes precedence over generic for registered routes', () => {
    const plan = { routeLabel: 'residual_load_forecast_for_dso' };
    const result = planEvidence(plan, {});

    expect(result).not.toBeNull();
    expect(result.source).toBe('registry'); // registry, not generic
    expect(result.registryKey).toBe('residual_load_forecast_for_dso');
  });

  it('generic plan has required structure (registryKey, gaps, confidence, source)', () => {
    const plan = {
      routeLabel: 'unknown-route',
      steps: [{ action: 'some-action', paramsTemplate: { param1: null } }],
    };
    const result = planEvidence(plan, {});

    expect(result).not.toBeNull();
    expect(result.source).toBe('generic');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(typeof result.phaseNote).toBe('string');
  });
});

// ── T-EV-006 — Phase 4: Routing-matrix shortcuts (registry entries) ────────
describe('T-EV-006 — evidence-planner: Phase 4 registry shortcuts for all routing-matrix routes', () => {
  const ROUTING_MATRIX_KEYS = [
    'investment-grid-check',
    'energy-sharing-znp',
    'redispatch-settlement',
    'fnav-finance',
    'forecast-flex',
  ];

  it('all routing-matrix keys are now registered in the Evidence Registry', () => {
    const registeredKeys = listRegisteredKeys();
    for (const key of ROUTING_MATRIX_KEYS) {
      expect(registeredKeys).toContain(key);
    }
  });

  it.each(ROUTING_MATRIX_KEYS)(
    'planEvidence() returns source="registry" for %s (not generic fallback)',
    (routeKey) => {
      const plan = { routeKey };
      const result = planEvidence(plan, {});

      expect(result).not.toBeNull();
      expect(result.source).toBe('registry');
      expect(result.registryKey).toBe(routeKey);
    }
  );

  it.each(ROUTING_MATRIX_KEYS)(
    'planEvidence() for %s has at least one required source with contextKeys',
    (routeKey) => {
      const plan = { routeKey };
      const result = planEvidence(plan, {});

      const requiredSources = result.requiredSources.filter((s) => !s.optional);
      expect(requiredSources.length).toBeGreaterThan(0);
    }
  );

  it('energy-sharing-znp: requires grid_operator_identity and energy_sharing_community', () => {
    const plan = { routeKey: 'energy-sharing-znp' };
    const result = planEvidence(plan, {});

    const requiredIds = result.requiredSources.filter((s) => !s.optional).map((s) => s.id);
    expect(requiredIds).toContain('grid_operator_identity');
    expect(requiredIds).toContain('energy_sharing_community');
  });

  it('energy-sharing-znp: znp_project is optional', () => {
    const plan = { routeKey: 'energy-sharing-znp' };
    const result = planEvidence(plan, {});

    const znpSource = result.requiredSources.find((s) => s.id === 'znp_project');
    expect(znpSource).toBeDefined();
    expect(znpSource.optional).toBe(true);
  });

  it('redispatch-settlement: requires grid_operator_identity and audit_period', () => {
    const plan = { routeKey: 'redispatch-settlement' };
    const result = planEvidence(plan, {});

    const requiredIds = result.requiredSources.filter((s) => !s.optional).map((s) => s.id);
    expect(requiredIds).toContain('grid_operator_identity');
    expect(requiredIds).toContain('audit_period');
  });

  it('redispatch-settlement: confidence improves when dateFrom is in context', () => {
    const plan = { routeKey: 'redispatch-settlement' };
    const resultEmpty = planEvidence(plan, {});
    const resultWithDates = planEvidence(plan, {
      gridOperatorId: 'GNB-123',
      dateFrom: '2025-01-01',
      dateTo: '2025-03-31',
    });

    expect(resultWithDates.confidence).toBeGreaterThan(resultEmpty.confidence);
    expect(resultWithDates.gaps.length).toBeLessThan(resultEmpty.gaps.length);
  });

  it('fnav-finance: requires fnav_profile and grid_operator_identity', () => {
    const plan = { routeKey: 'fnav-finance' };
    const result = planEvidence(plan, {});

    const requiredIds = result.requiredSources.filter((s) => !s.optional).map((s) => s.id);
    expect(requiredIds).toContain('fnav_profile');
    expect(requiredIds).toContain('grid_operator_identity');
  });

  it('fnav-finance: voltage_level and owner_contact are optional', () => {
    const plan = { routeKey: 'fnav-finance' };
    const result = planEvidence(plan, {});

    const voltageSrc = result.requiredSources.find((s) => s.id === 'voltage_level');
    const ownerSrc = result.requiredSources.find((s) => s.id === 'owner_contact');
    expect(voltageSrc?.optional).toBe(true);
    expect(ownerSrc?.optional).toBe(true);
  });

  it('forecast-flex: requires forecast_location', () => {
    const plan = { routeKey: 'forecast-flex' };
    const result = planEvidence(plan, {});

    const requiredIds = result.requiredSources.filter((s) => !s.optional).map((s) => s.id);
    expect(requiredIds).toContain('forecast_location');
  });

  it('forecast-flex: confidence is 1.0 when postleitzahl is in context', () => {
    const plan = { routeKey: 'forecast-flex' };
    const result = planEvidence(plan, { postleitzahl: '67063' });

    // forecast_location satisfied; all others are optional → confidence = 1.0
    expect(result.confidence).toBe(1.0);
    const locationGap = result.gaps.find((g) => g.id === 'forecast_location');
    expect(locationGap).toBeUndefined();
  });
});

// ── T-EV-007 — Phase 5: semantic forecast evidence detection ───────────────
describe('T-EV-007 — semantic Evidence planning for near-term Redispatch probability prompts', () => {
  it('detects forecast evidence for "nächste Tage" Redispatch probability prompt (without explicit "Prognose" keyword)', () => {
    const plan = buildExecutionPlan({
      message:
        'Große PV-Anlage mit Speicher in Burgbernheim; wie hoch ist die Wahrscheinlichkeit für Redispatch 2.0 in den nächsten Tagen?',
      brokerRecommendation: null,
      knownContext: {
        gridOperatorName: 'Stadtwerke Burgbernheim',
      },
    });

    expect(plan.evidencePlan).not.toBeNull();
    expect(plan.evidencePlan.source).toBe('registry');
    expect(plan.evidencePlan.registryKey).toBe('redispatch_probability_forecast');

    const requiredIds = plan.evidencePlan.requiredSources
      .filter((s) => !s.optional)
      .map((s) => s.id);
    expect(requiredIds).toContain('forecast_horizon');
    expect(requiredIds).toContain('gruenstromindex_forecast');
    expect(requiredIds).toContain('temporal_probability_window');
  });

  it('keeps explicit forecast capability path intact (no regression)', () => {
    const plan = buildExecutionPlan({
      message: 'Bitte eine Prognose der Residuallast für die nächsten Tage erstellen',
      brokerRecommendation: {
        recommendedCapabilities: [
          { capability: 'residual_load_forecast_for_dso', confidence: 0.92 },
        ],
      },
      knownContext: {
        gridOperatorId: 'GNB123',
      },
    });

    expect(plan.evidencePlan).not.toBeNull();
    expect(plan.evidencePlan.source).toBe('registry');
    expect(plan.evidencePlan.registryKey).toBe('residual_load_forecast_for_dso');
  });

  it('does not pull forecast probability evidence for non-forecast historical redispatch audit prompt', () => {
    const plan = buildExecutionPlan({
      message: 'Redispatch Audit vom 2025-01-01 bis 2025-03-01 für Netzgebiet auswerten',
      brokerRecommendation: null,
      knownContext: {
        gridOperatorId: 'GNB-123',
        dateFrom: '2025-01-01',
        dateTo: '2025-03-01',
      },
    });

    if (plan.evidencePlan?.source === 'registry') {
      expect(plan.evidencePlan.registryKey).not.toBe('redispatch_probability_forecast');
    }
  });

  it('blocks synthesis gate when critical forecast evidence is missing', () => {
    const evidencePlan = {
      confidence: 0.25,
      gaps: [
        {
          id: 'forecast_horizon',
          label: 'Prognose-Horizont (nächste Tage)',
          resolvedBy: ['forecast.generationForecast'],
        },
      ],
      requiredSources: [
        { id: 'forecast_horizon', optional: false },
        { id: 'gruenstromindex_forecast', optional: false },
      ],
      checkedSources: [],
    };

    expect(shouldBlockSynthesisOnGaps(evidencePlan)).toBe(true);
  });
});
