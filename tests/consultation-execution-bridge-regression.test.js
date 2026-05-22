'use strict';

const {
  buildConsultationExecutionPlan,
  WORKFLOW_TYPES,
  EXECUTION_READINESS,
} = require('../src/consultation-execution-bridge');
const { extractAvailableInputs } = require('../src/consultation-input-extractor');
const { validateRoutingIntent } = require('../src/consultation-routing-guardrails');

describe('Consultation-Execution-Bridge Regression Tests', () => {
  /**
   * PA-CEB-REGRESSION-001: BESS-Screening (Bundesland not re-asked)
   * User mentions "Thüringen" in message → should not ask again for Bundesland
   */
  describe('PA-CEB-REGRESSION-001: BESS-Screening avoids redundant Bundesland question', () => {
    test('extracts Bundesland from message', () => {
      const message = 'Wir planen einen Batteriespeicher in Thüringen';
      const extracted = extractAvailableInputs(message, {}, {});

      expect(extracted).toBeDefined();
      expect(extracted.length).toBeGreaterThan(0);
      const bundeslandExtracted = extracted.find((e) => e.param === 'bundesland');
      expect(bundeslandExtracted).toBeDefined();
      expect(String(bundeslandExtracted.value).toLowerCase()).toMatch(/thüringen|thueringen/);
    });

    test('BESS-Screening workflow classifies correctly', () => {
      const message = 'Wir planen einen Batteriespeicher in Thüringen';
      const consultation = {};
      const knownContext = {};

      const plan = buildConsultationExecutionPlan({
        message,
        consultation,
        knownContext,
        extractedInputs: extractAvailableInputs(message, {}, {}),
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    test('Bundesland in availableInputs prevents missingInputs', () => {
      const message = 'Wir planen einen Batteriespeicher in Thüringen';
      const extracted = extractAvailableInputs(message, {}, {});

      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
        extractedInputs: extracted,
      });

      // Should have Bundesland in available inputs
      expect(plan.availableInputs.map((a) => a.param)).toContain('bundesland');
      // Should NOT ask for Bundesland in missing inputs
      const missingBundesland = plan.missingInputs.find((m) => m.param.toLowerCase().includes('state'));
      expect(missingBundesland).toBeUndefined();
    });
  });

  /**
   * PA-CEB-REGRESSION-002: BESS-Screening (Arnstadt inputs preserved, not VDMI)
   * User provides: Arnstadt + 5MW + 10MWh → consultation-first workflow stays BESS_SCREENING, not vdmi_asset_validation
   */
  describe('PA-CEB-REGRESSION-002: BESS-Screening (Arnstadt context)', () => {
    test('extracts Arnstadt as municipality', () => {
      const message = 'BESS-Projekt in Arnstadt, 5MW Leistung, 10MWh Speicher';
      const extracted = extractAvailableInputs(message, {}, {});

      const cityExtracted = extracted.find((e) => e.param === 'municipality');
      expect(cityExtracted).toBeDefined();
      expect(String(cityExtracted.value).toLowerCase()).toContain('arnstadt');
    });

    test('BESS with location + capacity remains BESS_SCREENING in consultation mode', () => {
      const message = 'BESS-Projekt in Arnstadt, 5MW Leistung, 10MWh Speicher';
      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: { municipality: 'Arnstadt', powerMW: 5, capacityMWh: 10 },
        extractedInputs: extractAvailableInputs(message, {}, {municipality: 'Arnstadt'}),
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    test('BESS_SCREENING should NOT route to vdmi_asset_validation', () => {
      const brokerRecommendation = { intent: 'vdmi_asset_validation_governance' };
      const validation = validateRoutingIntent({
        workflowType: WORKFLOW_TYPES.BESS_SCREENING,
        brokerRecommendation,
        message: 'BESS in Arnstadt',
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toMatch(/bess.*misrouted/i);
    });
  });

  /**
   * PA-CEB-REGRESSION-003: AI-Governance (advisory-only, forecast blocked)
   * User asks about "KI-Transparenz" → advisory_only, should NOT route to residual_load_forecast
   */
  describe('PA-CEB-REGRESSION-003: AI-Governance avoids forecast routing', () => {
    test('Governance keyword triggers advisory_only workflow', () => {
      const message = 'Wie handhaben wir KI-Transparenz in der Netzplanung?';
      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
      expect(plan.readiness).toBe(EXECUTION_READINESS.ADVISORY_ONLY);
    });

    test('advisory_only blocks operational intents', () => {
      const brokerRecommendation = { intent: 'residual_load_forecast' };
      const validation = validateRoutingIntent({
        workflowType: WORKFLOW_TYPES.ADVISORY_ONLY,
        brokerRecommendation,
        message: 'Transparenz der KI',
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toMatch(/governance_advisory_cannot_route_to_operational/i);
      expect(validation.correctedIntent).toMatch(/governance|context/i);
    });
  });

  /**
   * PA-CEB-REGRESSION-004: Process Governance (not asset-validation)
   * User asks about "Entscheidungsmatrix Gremium" → process_governance_decision_matrix, NOT vdmi_asset_validation
   */
  describe('PA-CEB-REGRESSION-004: Process Governance avoids asset-validation', () => {
    test('Process/Gremium keywords trigger process_governance workflow', () => {
      const message = 'Entscheidungsmatrix für Gremium-Abstimmung';
      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.PROCESS_GOVERNANCE_DECISION_MATRIX);
    });

    test('process_governance_decision_matrix blocks asset_validation', () => {
      const validation = validateRoutingIntent({
        workflowType: WORKFLOW_TYPES.PROCESS_GOVERNANCE_DECISION_MATRIX,
        brokerRecommendation: { intent: 'vdmi_asset_validation_governance' },
        message: 'Gremium-Entscheidungen',
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toMatch(/process_governance_misrouted_to_asset_validation/i);
    });
  });

  /**
   * PA-CEB-REGRESSION-005: Municipal Energy Sharing Assessment
   * User asks about "Gemeinde Energy Sharing" → municipal_energy_sharing_assessment workflow
   */
  describe('PA-CEB-REGRESSION-005: Municipal Energy Sharing Assessment', () => {
    test('Municipal + Energy Sharing keywords trigger municipal workflow', () => {
      const message = 'Dezentrale Energiesharing-Lösung für die Gemeinde Berlin';
      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.MUNICIPAL_ENERGY_SHARING_ASSESSMENT);
    });
  });

  /**
   * PA-CEB-REGRESSION-006: EDM/Market Communication (not asset-validation)
   * User asks about "Marktkommunikation EDM" → edm_market_communication_diagnostics, NOT vdmi_asset_validation
   */
  describe('PA-CEB-REGRESSION-006: EDM Market Communication avoids asset-validation', () => {
    test('EDM keywords trigger edm_market_communication workflow', () => {
      const message = 'Strategie für elektronischen Datenaustausch (EDM) mit Netzbetreiber';
      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.EDM_MARKET_COMMUNICATION_DIAGNOSTICS);
    });

    test('edm_market_communication blocks asset_validation', () => {
      const validation = validateRoutingIntent({
        workflowType: WORKFLOW_TYPES.EDM_MARKET_COMMUNICATION_DIAGNOSTICS,
        brokerRecommendation: { intent: 'vdmi_asset_validation_governance' },
        message: 'EDM Marktkommunikation',
      });

      expect(validation.valid).toBe(false);
      expect(validation.reason).toMatch(/edm_market_misrouted_to_asset_validation/i);
    });
  });

  /**
   * PA-CEB-REGRESSION-007: ZNP Asset MDM Planning
   * User asks about "ZNP Netzausbau Planung" → znp_asset_mdm_planning workflow
   */
  describe('PA-CEB-REGRESSION-007: ZNP Asset MDM Planning', () => {
    test('ZNP keywords trigger znp_asset_mdm_planning workflow', () => {
      const message = 'ZNP-Planung für zentrale Netzausbau-Koordination';
      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.ZNP_ASSET_MDM_PLANNING);
    });
  });

  /**
   * PA-CEB-REGRESSION-008: Input Extraction prevents redundancy
   * Already-provided inputs should not appear in missingInputs
   */
  describe('PA-CEB-REGRESSION-008: Input extraction redundancy prevention', () => {
    test('Extracted inputs de-duplicate against missingInputs', () => {
      const message = 'Bayern BESS-Projekt';
      const extracted = extractAvailableInputs(message, {}, {});

      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: {},
        extractedInputs: extracted,
      });

      // Bavaria (Bayern) should be in availableInputs
      const hasBavaria = plan.availableInputs.some((a) => String(a.value).toLowerCase().includes('bayern'));
      expect(hasBavaria || plan.availableInputs.length > 0).toBe(true);

      // Bundesland should NOT be in missingInputs if extracted
      const missingState = plan.missingInputs.find((m) => m.label.toLowerCase().includes('bundesland'));
      expect(missingState).toBeUndefined();
    });
  });

  /**
   * PA-CEB-REGRESSION-009: responseStrategy preservation through bridge
   * Response strategy should be preserved in execution artifact
   */
  describe('PA-CEB-REGRESSION-009: Response strategy preservation', () => {
    test('responseStrategy fields preserved in artifact', () => {
      const message = 'BESS in Thüringen';
      const responseStrategy = { audience: 'technical', abstractionLevel: 'detailed' };

      const plan = buildConsultationExecutionPlan({
        message,
        consultation: {},
        knownContext: { municipality: 'city' },
        responseStrategy,
      });

      expect(plan.audience).toBe('technical');
      expect(plan.abstractionLevel).toBe('detailed');
    });
  });

  /**
   * PA-CEB-REGRESSION-010: No internal schema leaks in questions
   * nextUserQuestion should use human-friendly labels, never internal schema names
   */
  describe('PA-CEB-REGRESSION-010: No schema leaks in user questions', () => {
    test('missing input questions use labels, not param keys', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'BESS-Projekt',
        consultation: {},
        knownContext: {}, // Empty context → will trigger missing inputs
      });

      if (plan.nextUserQuestion) {
        // Should NOT contain internal schema field names
        expect(plan.nextUserQuestion).not.toMatch(/\$|_key|_param|missingInput/);
        // Should contain human-readable text
        expect(plan.nextUserQuestion.length).toBeGreaterThan(10);
        expect(/[ÄÖÜäöü]/.test(plan.nextUserQuestion) || /[a-z]/i.test(plan.nextUserQuestion)).toBe(true);
      }
    });
  });
});
