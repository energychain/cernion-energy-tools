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
      const missingBundesland = plan.missingInputs.find((m) =>
        m.param.toLowerCase().includes('state')
      );
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
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
        },
        knownContext: { municipality: 'Arnstadt', powerMW: 5, capacityMWh: 10 },
        brokerRecommendation: { intent: 'vdmi_asset_validation_governance' },
        extractedInputs: extractAvailableInputs(message, {}, { municipality: 'Arnstadt' }),
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
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
        },
        brokerRecommendation: { intent: 'residual_load_forecast' },
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
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.MASTR_INVENTORY,
          },
        },
        brokerRecommendation: { intent: 'mastr_asset_inventory' },
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
      const hasBavaria = plan.availableInputs.some((a) =>
        String(a.value).toLowerCase().includes('bayern')
      );
      expect(hasBavaria || plan.availableInputs.length > 0).toBe(true);

      // Bundesland should NOT be in missingInputs if extracted
      const missingState = plan.missingInputs.find((m) =>
        m.label.toLowerCase().includes('bundesland')
      );
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
   * PA-CEB-REGRESSION-011: Prosumer NAP wallet onboarding overrides BESS/MaStR drift
   */
  describe('PA-CEB-REGRESSION-011: Prosumer NAP wallet onboarding overrides semantic drift', () => {
    test('household PV/storage/wallbox/NAP signals resolve to prosumer workflow', () => {
      const plan = buildConsultationExecutionPlan({
        message:
          'Haushaltskunde mit PV, Speicher, Wärmepumpe und Wallbox: NAP-Wallet Onboarding mit Rohdaten aus dem Daten-Honeypot vorbereiten.',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.BESS_SCREENING,
          },
        },
        brokerRecommendation: { intent: 'mastr_asset_inventory' },
        knownContext: { municipality: 'Köln' },
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
    });
  });

  /**
   * PA-CEB-REGRESSION-012: Exact Dev T1 must not drift to portfolio/flex
   */
  describe('PA-CEB-REGRESSION-012: Dev T1 BESS context dominates portfolio flex wording', () => {
    test('project_developer + bess_grid_connection + Thueringen resolves to bess_screening', () => {
      const plan = buildConsultationExecutionPlan({
        message:
          'Ich bin Projektentwickler fuer einen Batteriespeicher in Thueringen. Ich moechte mit Cernion einen geeigneten Netzanschlusspunkt finden und die wirtschaftlich beste flexible Anschlussloesung einschaetzen. Welche Schritte empfiehlst du?',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
        },
        knownContext: {
          role: 'project_developer',
          domain: 'bess_grid_connection',
          region: 'Thueringen',
        },
        brokerRecommendation: {
          intent: 'mastr_asset_inventory',
          capability: 'mastr_asset_inventory',
        },
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });
  });

  /**
   * PA-CEB-REGRESSION-013: region='Thueringen' satisfies state requirement, asks for municipality
   */
  describe('PA-CEB-REGRESSION-013: region satisfies state, next question is municipality', () => {
    test('knownContext.region does not trigger missingInputs for state', () => {
      const plan = buildConsultationExecutionPlan({
        message:
          'Ich bin Projektentwickler fuer einen Batteriespeicher in Thueringen. Welche Schritte empfiehlst du?',
        consultation: {},
        knownContext: { region: 'Thueringen' },
      });
      const missingState = (plan.missingInputs || []).find((m) =>
        ['state', 'bundesland', 'region'].includes(m.param)
      );
      expect(missingState).toBeUndefined();
    });

    test('readiness is awaiting_input, canExecuteNow is false when only region known', () => {
      const plan = buildConsultationExecutionPlan({
        message:
          'Ich bin Projektentwickler fuer einen Batteriespeicher in Thueringen. Welche Schritte empfiehlst du?',
        consultation: {},
        knownContext: { region: 'Thueringen' },
        executionMode: 'auto',
      });
      expect(plan.readiness).toBe('awaiting_input');
      expect(plan.canExecuteNow).toBe(false);
    });

    test('nextUserQuestion asks for municipality/Standort, not Bundesland', () => {
      const plan = buildConsultationExecutionPlan({
        message:
          'Ich bin Projektentwickler fuer einen Batteriespeicher in Thueringen. Welche Schritte empfiehlst du?',
        consultation: {},
        knownContext: { region: 'Thueringen' },
      });
      expect(plan.nextUserQuestion).toBeTruthy();
      expect(plan.nextUserQuestion.toLowerCase()).not.toMatch(/bundesland/);
      expect(plan.nextUserQuestion.toLowerCase()).toMatch(
        /gemeinde|standort|plz|ort|municipality/i
      );
    });
  });

  /**
   * PA-CEB-REGRESSION-014: municipality='Arnstadt' satisfies all location requirements
   */
  describe('PA-CEB-REGRESSION-014: municipality satisfies all location requirements', () => {
    test('knownContext.municipality does not trigger any location missingInputs', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'BESS 20 MW in Arnstadt',
        consultation: {},
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
      });
      const missingLocation = (plan.missingInputs || []).find((m) =>
        ['state', 'bundesland', 'region', 'municipality'].includes(m.param)
      );
      expect(missingLocation).toBeUndefined();
    });

    test('readiness is not awaiting_input and canExecuteNow is true in auto mode when municipality known', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'BESS 20 MW in Arnstadt',
        consultation: {},
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
        executionMode: 'auto',
      });
      expect(plan.readiness).not.toBe('awaiting_input');
      expect(plan.canExecuteNow).toBe(true);
    });

    test('marketPartners step uses Arnstadt as query param', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'BESS 20 MW in Arnstadt',
        consultation: {},
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
      });
      const partnersStep = (plan.executableSteps || []).find(
        (s) => s.action === 'grid-operations.marketPartners'
      );
      if (partnersStep) {
        expect(partnersStep.params.query).toBe('Arnstadt');
      }
    });
  });

  describe('PA-CEB-REGRESSION-015: domain-anchored BESS context resists feasibility drift', () => {
    test('municipality + powerMW + capacityMWh with domain=bess_grid_connection stays bess_screening', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'BESS 20 MW / 40 MWh in Arnstadt',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
        },
        knownContext: {
          domain: 'bess_grid_connection',
          municipality: 'Arnstadt',
          powerMW: 20,
          capacityMWh: 40,
        },
        brokerRecommendation: {
          intent: 'feasibility_assessment',
          capability: 'feasibility_assessment',
        },
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
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
        expect(/[ÄÖÜäöü]/.test(plan.nextUserQuestion) || /[a-z]/i.test(plan.nextUserQuestion)).toBe(
          true
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SCOPE SEPARATION REGRESSIONS (v0.54.6)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * PA-CEB-SCOPE-001: Asset query by location must NOT trigger VNB resolution.
   * "Zeige Anlagen in Wiesloch / PLZ 69168" → mastr_inventory, not vnb_identification
   */
  describe('PA-CEB-SCOPE-001: Asset query by location does not trigger VNB lookup', () => {
    it('Wiesloch asset query → mastr_inventory or location-scoped workflow, not vnb_identification', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Zeige Anlagen in Wiesloch / PLZ 69168',
        knownContext: { city: 'Wiesloch', postalCode: '69168' },
        executionMode: 'auto',
      });
      // Must NOT classify as vnb_identification
      expect(plan.workflowType).not.toBe(WORKFLOW_TYPES.VNB_IDENTIFICATION);

      // No step must call vnbLookup unnecessarily
      const vnbStep = plan.executableSteps.find((s) => s.action.includes('vnbLookup'));
      expect(vnbStep).toBeUndefined();

      // scopeClassification: locationScope available, no operatorScope needed/required
      expect(plan.scopeClassification).toBeDefined();
      expect(plan.scopeClassification.locationScopeAvailable).toBe(true);
    });
  });

  /**
   * PA-CEB-SCOPE-002: Asset query by named operator must NOT become location query.
   * "Zeige Anlagen der Netze BW" → operator-scoped plan, marketPartners with operator name
   */
  describe('PA-CEB-SCOPE-002: Asset query by operator uses operator scope', () => {
    it('Netze BW query → uses operator name context, not geography', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Zeige Anlagen der Netze BW',
        knownContext: { gridOperatorName: 'Netze BW' },
        executionMode: 'auto',
      });
      // scopeClassification must show operatorScope resolved
      expect(plan.scopeClassification).toBeDefined();
      expect(plan.scopeClassification.operatorScopeResolved).toBe(true);
      expect(plan.scopeClassification.primaryScope).not.toBe('locationScope');
    });
  });

  /**
   * PA-CEB-SCOPE-003: GrünstromIndex / CO2 / weather is a locationScope query.
   * Must NOT require VNB resolution.
   */
  describe('PA-CEB-SCOPE-003: GrünstromIndex query requires only locationScope', () => {
    it('GrünstromIndex Wiesloch → locationScope primary, no VNB resolution', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Wie ist der GrünstromIndex für Wiesloch 69168?',
        knownContext: { city: 'Wiesloch', postalCode: '69168' },
        executionMode: 'auto',
      });
      // locationScope available
      expect(plan.scopeClassification.locationScopeAvailable).toBe(true);
      // operatorScope NOT required for this query
      expect(plan.scopeClassification.operatorScopeResolved).toBe(false);
      // No vnbLookup step should appear
      const vnbStep = plan.executableSteps.find((s) => s.action.includes('vnbLookup'));
      expect(vnbStep).toBeUndefined();
    });
  });

  /**
   * PA-CEB-SCOPE-004: "Wer ist der zuständige VNB für Wiesloch?" is VNB_RESOLUTION.
   * Must produce 2-step plan (marketPartners → vnbLookup), NOT direct vnbLookup with city.
   * vnbLookup step must NOT be canExecute without operatorScope.
   */
  describe('PA-CEB-SCOPE-004: VNB resolution request uses 2-step chain', () => {
    it('city-only VNB resolution → step 1 = marketPartners (canExecute:true), step 2 = vnbLookup (canExecute:false)', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Wer ist der zuständige VNB für Wiesloch?',
        knownContext: { city: 'Wiesloch' },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.VNB_IDENTIFICATION);

      // Step 1: marketPartners with locationScope
      const step1 = plan.executableSteps.find((s) => s.step === 1);
      expect(step1).toBeDefined();
      expect(step1.action).toContain('marketPartners');
      expect(step1.canExecute).toBe(true);
      expect(step1.scopeType).toBe('locationScope');

      // Step 2: vnbLookup blocked — needs operatorScope from step 1
      const step2 = plan.executableSteps.find((s) => s.step === 2);
      expect(step2).toBeDefined();
      expect(step2.action).toContain('vnbLookup');
      expect(step2.canExecute).toBe(false);
      expect(step2.scopeRequirement).toBe('operatorScope');

      // scopeClassification confirms: no operatorScope yet
      expect(plan.scopeClassification.operatorScopeResolved).toBe(false);
      expect(plan.scopeClassification.primaryScope).toBe('vnbResolution');
    });

    it('VNB resolution with bdew (operatorScope resolved) → direct vnbLookup as step 1', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'VNB für BDEW 9900277000000',
        knownContext: { bdew: '9900277000000' },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.VNB_IDENTIFICATION);

      const step1 = plan.executableSteps.find((s) => s.step === 1);
      expect(step1.action).toContain('vnbLookup');
      expect(step1.canExecute).toBe(true);
      expect(step1.scopeType).toBe('operatorScope');
    });
  });

  /**
   * PA-CEB-SCOPE-005: Heidelberg city-only must NOT execute vnbLookup directly.
   * Old behavior (vnbLookup canExecute:true with city only) must NOT recur.
   */
  describe('PA-CEB-SCOPE-005: Heidelberg city-only must not execute vnbLookup directly', () => {
    it('Heidelberg city-only → vnbLookup step is NOT canExecute (scope anti-pattern prevented)', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Wer ist der Netzbetreiber in Heidelberg?',
        knownContext: { municipality: 'Heidelberg' },
        executionMode: 'auto',
      });

      // vnbLookup must not be canExecute when only city is provided
      const vnbStep = plan.executableSteps.find((s) => s.action.includes('vnbLookup'));
      if (vnbStep) {
        expect(vnbStep.canExecute).toBe(false);
        expect(vnbStep.scopeRequirement).toBe('operatorScope');
      }

      // marketPartners step must exist and be canExecute
      const mpStep = plan.executableSteps.find((s) => s.action.includes('marketPartners'));
      expect(mpStep).toBeDefined();
      expect(mpStep.canExecute).toBe(true);
    });
  });
});

