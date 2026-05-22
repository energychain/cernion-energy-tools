'use strict';

const { buildExecutionPlan, fuzzyClassifyConsultationIntent } = require('../src/personal-agent-routing');
const {
  buildConsultationExecutionPlan,
  WORKFLOW_TYPES,
} = require('../src/consultation-execution-bridge');
const { extractAvailableInputs } = require('../src/consultation-input-extractor');

describe('consultation-to-execution hybrid router regressions', () => {
  it('RG-001: BESS + Bundesland bleibt bess_screening ohne erneute Bundesland-Missing-Question', () => {
    const message = 'Wir planen einen Batteriespeicher in Thüringen';
    const extractedInputs = extractAvailableInputs(message, {}, {});

    const plan = buildConsultationExecutionPlan({
      message,
      consultation: {},
      knownContext: {},
      extractedInputs,
    });

    expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    expect(plan.canExecuteNow).toBe(false);
    expect(plan.missingInputs.some((item) => /bundesland|region/i.test(item.label))).toBe(false);
  });

  it('RG-002: BESS Arnstadt 20MW/40MWh bleibt consultation-first (bess_screening), nicht VDMI', () => {
    const message = 'BESS-Projekt in Arnstadt mit 20 MW und 40 MWh';

    const consultationPlan = buildConsultationExecutionPlan({
      message,
      consultation: {},
      knownContext: {},
      extractedInputs: extractAvailableInputs(message, {}, {}),
    });

    const executionPlan = buildExecutionPlan({
      message,
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(consultationPlan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    expect(executionPlan.primaryIntent).not.toBe('vdmi_asset_validation_governance');
  });

  it('RG-003: AI-Governance/Blackbox bleibt advisory-only und nicht residual-load/forecast', () => {
    const message = 'Wie erklären wir Blackbox-Entscheidungen der KI gegenüber der Aufsicht?';

    const consultationPlan = buildConsultationExecutionPlan({
      message,
      consultation: {},
      knownContext: {},
    });

    const executionPlan = buildExecutionPlan({
      message,
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(consultationPlan.workflowType).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
    expect(executionPlan.primaryIntent).not.toBe('residual_load_forecast_for_dso');
  });

  it('RG-004: Prozess/Gremium wird nicht zu VDMI Asset Validation geroutet', () => {
    const message = 'Wir brauchen eine Entscheidungsmatrix für das Gremium im Freigabeprozess';

    const consultationPlan = buildConsultationExecutionPlan({
      message,
      consultation: {},
      knownContext: {},
    });

    const executionPlan = buildExecutionPlan({
      message,
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(consultationPlan.workflowType).toBe(WORKFLOW_TYPES.PROCESS_GOVERNANCE_DECISION_MATRIX);
    expect(executionPlan.primaryIntent).not.toBe('vdmi_asset_validation_governance');
  });

  it('RG-005: EDM/MaKo/Bilanzierung wird als edm_market_communication_diagnostics erkannt', () => {
    const message = 'Wir haben in der MaKo/EDM Bilanzierung wiederholt Nachrichtenfehler';

    const consultationPlan = buildConsultationExecutionPlan({
      message,
      consultation: {},
      knownContext: {},
    });

    expect(consultationPlan.workflowType).toBe(WORKFLOW_TYPES.EDM_MARKET_COMMUNICATION_DIAGNOSTICS);
  });

  it('RG-006: EDM/MaKo/Bilanzierung wird nicht zu VDMI Asset Validation geroutet', () => {
    const message = 'EDM-Marktkommunikation und Bilanzierungsprobleme analysieren';

    const executionPlan = buildExecutionPlan({
      message,
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(executionPlan.primaryIntent).not.toBe('vdmi_asset_validation_governance');
  });

  it('RG-007: Prosumer/NAP-Wallet wird als prosumer_nap_wallet_onboarding erkannt', () => {
    const message = 'Prosumer-NAP-Wallet Onboarding für neue Kunden vorbereiten';

    const consultationPlan = buildConsultationExecutionPlan({
      message,
      consultation: {},
      knownContext: {},
    });

    expect(consultationPlan.workflowType).toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
  });

  it('RG-008: Prosumer/NAP-Wallet wird nicht auf MaStR Inventory gekippt', () => {
    const message = 'NAP Wallet Prozess für Prosumer klären';

    const executionPlan = buildExecutionPlan({
      message,
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(executionPlan.primaryIntent).not.toBe('mastr_asset_inventory');
  });

  it('RG-009: Fuzzy classifier liefert strukturierte Hybrid-Klassifikation', () => {
    const message = 'EDM-MaKo Bilanzierung in der Marktkommunikation verbessern';
    const classified = fuzzyClassifyConsultationIntent(message, {}, []);

    expect(classified).toEqual(
      expect.objectContaining({
        workflowType: expect.any(String),
        personaType: expect.any(String),
        domainIntent: expect.any(String),
        executionReadinessIntent: expect.any(String),
        advisoryOnly: expect.any(Boolean),
        availableInputs: expect.any(Array),
        missingInputs: expect.any(Array),
        confidence: expect.any(Number),
        rationale: expect.any(String),
      })
    );
  });
});
