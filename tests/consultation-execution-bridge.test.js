'use strict';

const {
  WORKFLOW_TYPES,
  EXECUTION_READINESS,
  classifyWorkflowType,
  analyzeInputReadiness,
  buildExecutablePlan,
  assessExecutionReadiness,
  buildConsultationExecutionPlan,
} = require('../src/consultation-execution-bridge');

describe('consultation-execution-bridge', () => {
  // ── classifyWorkflowType ───────────────────────────────────────────────

  describe('classifyWorkflowType', () => {
    it('PA-CEB-001: governance/AI keywords always resolve to advisory_only', () => {
      expect(
        classifyWorkflowType({ message: 'Wie erklärt ihr KI-Entscheidungen dem Aufsichtsrat?' })
      ).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
      expect(classifyWorkflowType({ message: 'Was ist euer Governance-Ansatz?' })).toBe(
        WORKFLOW_TYPES.ADVISORY_ONLY
      );
      expect(
        classifyWorkflowType({ message: 'Strategische Haftungsfragen bei black-box AI' })
      ).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
    });

    it('PA-CEB-002: BESS with location+capacity resolves to bess_development', () => {
      expect(
        classifyWorkflowType({
          message: 'Großspeicher planen',
          knownContext: { municipality: 'Troisdorf', powerMW: 10 },
        })
      ).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    it('PA-CEB-003: BESS without location resolves to bess_screening', () => {
      expect(
        classifyWorkflowType({
          message: 'Ich interessiere mich für Batteriespeicher',
          knownContext: {},
        })
      ).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    it('PA-CEB-004: energy sharing keywords resolve to energy_sharing_readiness', () => {
      // Generic energy sharing without municipal context → energy_sharing_readiness
      expect(classifyWorkflowType({ message: 'Wir wollen Energy Sharing implementieren' })).toBe(
        WORKFLOW_TYPES.ENERGY_SHARING_READINESS
      );
      expect(classifyWorkflowType({ message: 'Mieterstrom Projekt starten' })).toBe(
        WORKFLOW_TYPES.ENERGY_SHARING_READINESS
      );
      // With municipal context → municipal_energy_sharing_assessment
      expect(classifyWorkflowType({ message: 'Wir wollen Energy Sharing im Quartier' })).toBe(
        WORKFLOW_TYPES.MUNICIPAL_ENERGY_SHARING_ASSESSMENT
      );
    });

    it('PA-CEB-005: VNB keywords resolve to vnb_identification', () => {
      expect(classifyWorkflowType({ message: 'Wer ist der zuständige Netzbetreiber?' })).toBe(
        WORKFLOW_TYPES.VNB_IDENTIFICATION
      );
    });

    it('PA-CEB-006: MaStR keywords resolve to mastr_inventory', () => {
      expect(classifyWorkflowType({ message: 'MaStR-Bestand in der Region abfragen' })).toBe(
        WORKFLOW_TYPES.MASTR_INVENTORY
      );
    });

    it('PA-CEB-007: unknown/unrelated message resolves to advisory_only', () => {
      expect(classifyWorkflowType({ message: 'Guten Morgen!' })).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
    });

    it('PA-CEB-019: semantic portfolio drift is reconciled to bess_screening for a BESS project', () => {
      const workflowType = classifyWorkflowType({
        message:
          'Wir planen einen Batteriespeicher in Thüringen mit flexibler Anschlusslösung am Netzanschlusspunkt.',
        consultation: {
          factsUsed: [{ source: 'message', value: 'Batteriespeicher' }],
          nextActions: [{ action: 'netzanschluss_pruefen', description: 'Netzanschluss klären' }],
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
        },
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
        brokerRecommendation: { intent: 'supplier_portfolio_flex_assessment' },
        extractedInputs: [
          { param: 'municipality', value: 'Arnstadt', source: 'message', confidence: 'high' },
          { param: 'powerMW', value: 20, source: 'message', confidence: 'high' },
          { param: 'capacityMWh', value: 40, source: 'message', confidence: 'high' },
        ],
      });

      expect(workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    it('PA-CEB-020: prosumer NAP wallet signals override semantic bess_screening', () => {
      const workflowType = classifyWorkflowType({
        message:
          'Haushaltskunde mit PV, Speicher, Wärmepumpe und Wallbox: NAP-Wallet Onboarding mit Rohdaten aus dem Daten-Honeypot vorbereiten.',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.BESS_SCREENING,
          },
          factsUsed: [{ source: 'message', value: 'Haushaltskunde PV Speicher Wallbox' }],
        },
        brokerRecommendation: { intent: 'mastr_asset_inventory' },
      });

      expect(workflowType).toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
    });

    it('PA-CEB-021: governance plus AI/HITL overrides any operational semantic workflow', () => {
      const workflowType = classifyWorkflowType({
        message: 'Wie transparent ist euer KI-Governance-Framework mit Blackbox-Risiken und HITL?',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
        },
        brokerRecommendation: { intent: 'residual_load_forecast' },
      });

      expect(workflowType).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
    });

    it('PA-CEB-022: EDM/MaKo/Bilanzierung/MaBiS/WiM overrides semantic mastr inventory', () => {
      const workflowType = classifyWorkflowType({
        message: 'EDM, MaKo, Bilanzierung, MaBiS und WiM in der Marktkommunikation analysieren.',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.MASTR_INVENTORY,
          },
        },
        brokerRecommendation: { intent: 'mastr_asset_inventory' },
      });

      expect(workflowType).toBe(WORKFLOW_TYPES.EDM_MARKET_COMMUNICATION_DIAGNOSTICS);
    });

    it('PA-CEB-023: exact Dev T1 message with domain+region resolves to bess_screening', () => {
      const workflowType = classifyWorkflowType({
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

      expect(workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });
  });

  // ── analyzeInputReadiness ──────────────────────────────────────────────

  describe('analyzeInputReadiness', () => {
    it('PA-CEB-008: BESS_DEVELOPMENT marks location and powerMW as critical when missing', () => {
      const { missingInputs } = analyzeInputReadiness({
        workflowType: WORKFLOW_TYPES.BESS_DEVELOPMENT,
        knownContext: {},
      });
      const params = missingInputs.map((m) => m.param);
      expect(params).toContain('location');
      expect(params).toContain('powerMW');
      const criticals = missingInputs.filter((m) => m.priority === 'critical');
      expect(criticals.length).toBeGreaterThanOrEqual(2);
    });

    it('PA-CEB-009: BESS_DEVELOPMENT with location+powerMW has no critical missing inputs', () => {
      const { missingInputs } = analyzeInputReadiness({
        workflowType: WORKFLOW_TYPES.BESS_DEVELOPMENT,
        knownContext: { municipality: 'Köln', powerMW: 20 },
      });
      const criticals = missingInputs.filter((m) => m.priority === 'critical');
      expect(criticals.length).toBe(0);
    });

    it('PA-CEB-010: ADVISORY_ONLY has no required inputs', () => {
      const { missingInputs } = analyzeInputReadiness({
        workflowType: WORKFLOW_TYPES.ADVISORY_ONLY,
        knownContext: {},
      });
      expect(missingInputs).toHaveLength(0);
    });
  });

  // ── assessExecutionReadiness ───────────────────────────────────────────

  describe('assessExecutionReadiness', () => {
    it('PA-CEB-011: advisory_only workflow returns advisory_only readiness with canExecuteNow=false', () => {
      const result = assessExecutionReadiness({ workflowType: WORKFLOW_TYPES.ADVISORY_ONLY });
      expect(result.readiness).toBe(EXECUTION_READINESS.ADVISORY_ONLY);
      expect(result.canExecuteNow).toBe(false);
      expect(result.nextUserQuestion).toBeNull();
    });

    it('PA-CEB-012: missing critical inputs returns awaiting_input with nextUserQuestion', () => {
      const result = assessExecutionReadiness({
        workflowType: WORKFLOW_TYPES.BESS_DEVELOPMENT,
        missingInputs: [{ param: 'location', label: 'Projektort', priority: 'critical' }],
        executableSteps: [],
        canAutoExecute: false,
      });
      expect(result.readiness).toBe(EXECUTION_READINESS.AWAITING_INPUT);
      expect(result.canExecuteNow).toBe(false);
      expect(typeof result.nextUserQuestion).toBe('string');
      expect(result.nextUserQuestion.length).toBeLessThanOrEqual(200);
    });

    it('PA-CEB-013: all inputs present with auto mode sets canExecuteNow=true and readiness=ready', () => {
      const result = assessExecutionReadiness({
        workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION,
        missingInputs: [],
        executableSteps: [{ step: 1, canExecute: true }],
        canAutoExecute: true,
      });
      expect(result.readiness).toBe(EXECUTION_READINESS.READY);
      expect(result.canExecuteNow).toBe(true);
    });
  });

  // ── buildConsultationExecutionPlan ─────────────────────────────────────

  describe('buildConsultationExecutionPlan', () => {
    it('PA-CEB-014: governance message produces advisory_only plan with canExecuteNow=false', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Wie transparent ist euer KI-Governance-Framework für den Aufsichtsrat?',
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
      expect(plan.readiness).toBe(EXECUTION_READINESS.ADVISORY_ONLY);
      expect(plan.canExecuteNow).toBe(false);
      expect(plan.executableSteps).toHaveLength(0);
    });

    it('PA-CEB-015: BESS with state context in auto mode produces ready screening plan with steps', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Batteriespeicher planen',
        knownContext: { state: 'Thüringen', municipality: 'Troisdorf', powerMW: 15 },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
      expect(plan.executableSteps.length).toBeGreaterThan(0);
      expect(plan.executableSteps.every((s) => s.action)).toBe(true);
      expect(plan.evidenceGates.length).toBeGreaterThan(0);
      expect(plan.canExecuteNow).toBe(true);
    });

    it('PA-CEB-016: hitl mode never sets canExecuteNow=true even with all inputs', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Netzbetreiber identifizieren',
        knownContext: { municipality: 'Düsseldorf' },
        executionMode: 'hitl',
      });
      expect(plan.canExecuteNow).toBe(false);
    });

    it('PA-CEB-017: plan includes audience and abstractionLevel from responseStrategy', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'MaStR-Bestand abfragen',
        knownContext: { municipality: 'Bonn' },
        responseStrategy: { audience: 'leadership', abstractionLevel: 'high' },
        executionMode: 'auto',
      });
      expect(plan.audience).toBe('leadership');
      expect(plan.abstractionLevel).toBe('high');
    });

    it('PA-CEB-018: VNB workflow with city-only location produces 2-step plan; vnbLookup NOT canExecute without operatorScope', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Wer ist der Netzbetreiber in Heidelberg?',
        knownContext: { municipality: 'Heidelberg' },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.VNB_IDENTIFICATION);

      // Step 1 must be marketPartners (resolve operator candidates from locationScope)
      const step1 = plan.executableSteps.find((s) => s.action.includes('marketPartners'));
      expect(step1).toBeDefined();
      expect(step1.canExecute).toBe(true);
      expect(step1.scopeType).toBe('locationScope');

      // Step 2: vnbLookup must NOT be canExecute — operatorScope not yet resolved
      const vnbStep = plan.executableSteps.find((s) => s.action.includes('vnbLookup'));
      expect(vnbStep).toBeDefined();
      expect(vnbStep.canExecute).toBe(false);
      expect(vnbStep.scopeRequirement).toBe('operatorScope');

      // scopeClassification must show locationScope only, no operatorScope
      expect(plan.scopeClassification).toBeDefined();
      expect(plan.scopeClassification.locationScopeAvailable).toBe(true);
      expect(plan.scopeClassification.operatorScopeResolved).toBe(false);
    });

    it('PA-CEB-018b: VNB workflow with BDEW code (operatorScope) uses direct vnbLookup as step 1', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'VNB für BDEW 9900277000000',
        knownContext: { bdew: '9900277000000' },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.VNB_IDENTIFICATION);

      // With operatorScope: direct vnbLookup as step 1
      const step1 = plan.executableSteps.find((s) => s.step === 1);
      expect(step1).toBeDefined();
      expect(step1.action).toContain('vnbLookup');
      expect(step1.canExecute).toBe(true);
      expect(step1.scopeType).toBe('operatorScope');

      // scopeClassification shows operatorScope resolved
      expect(plan.scopeClassification.operatorScopeResolved).toBe(true);
    });

    it('PA-CEB-019: buildConsultationExecutionPlan reconciles semantic portfolio drift to bess_screening', () => {
      const plan = buildConsultationExecutionPlan({
        message:
          'Wir planen einen Batteriespeicher in Thüringen mit flexibler Anschlusslösung am Netzanschlusspunkt.',
        consultation: {
          semanticClassification: {
            workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
          },
          factsUsed: [{ source: 'message', value: 'Batteriespeicher' }],
          nextActions: [{ action: 'netzanschluss_pruefen', description: 'Netzanschluss klären' }],
        },
        brokerRecommendation: { intent: 'supplier_portfolio_flex_assessment' },
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
        extractedInputs: [
          { param: 'municipality', value: 'Arnstadt', source: 'message', confidence: 'high' },
          { param: 'powerMW', value: 20, source: 'message', confidence: 'high' },
          { param: 'capacityMWh', value: 40, source: 'message', confidence: 'high' },
        ],
        executionMode: 'auto',
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    it('PA-CEB-024: exact Dev T1 plan resolves workflowType to bess_screening', () => {
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
        executionMode: 'auto',
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    });

    it('PA-CEB-026: BESS_SCREENING with knownContext.region satisfies state requirement', () => {
      const { missingInputs } = analyzeInputReadiness({
        workflowType: WORKFLOW_TYPES.BESS_SCREENING,
        knownContext: { region: 'Thueringen' },
      });
      const missingState = missingInputs.find((m) =>
        ['state', 'bundesland', 'region'].includes(m.param)
      );
      expect(missingState).toBeUndefined();
      const missingMunicipality = missingInputs.find((m) => m.param === 'municipality');
      expect(missingMunicipality).toBeDefined();
      expect(missingMunicipality.priority).toBe('high');
    });

    it('PA-CEB-026b: BESS_SCREENING region-only plan has readiness=awaiting_input, canExecuteNow=false, nextUserQuestion set', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Batteriespeicher in Thueringen',
        consultation: {},
        knownContext: { region: 'Thueringen' },
        executionMode: 'auto',
      });
      expect(plan.readiness).toBe(EXECUTION_READINESS.AWAITING_INPUT);
      expect(plan.canExecuteNow).toBe(false);
      expect(plan.nextUserQuestion).toBeTruthy();
      expect(plan.nextUserQuestion.toLowerCase()).toMatch(
        /gemeinde|plz|standort|ort|municipality/i
      );
    });

    it('PA-CEB-027: BESS_SCREENING with municipality satisfies both state and municipality requirements', () => {
      const { missingInputs } = analyzeInputReadiness({
        workflowType: WORKFLOW_TYPES.BESS_SCREENING,
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
      });
      const missingState = missingInputs.find((m) =>
        ['state', 'bundesland', 'region', 'municipality'].includes(m.param)
      );
      expect(missingState).toBeUndefined();
    });

    it('PA-CEB-027b: BESS_SCREENING municipality plan has readiness=ready and canExecuteNow=true in auto mode', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'BESS 20 MW in Arnstadt',
        consultation: {},
        knownContext: { municipality: 'Arnstadt', powerMW: 20, capacityMWh: 40 },
        executionMode: 'auto',
      });
      expect([EXECUTION_READINESS.READY, EXECUTION_READINESS.PARTIAL]).toContain(plan.readiness);
      expect(
        plan.missingInputs.filter((m) =>
          ['state', 'bundesland', 'region', 'municipality'].includes(m.param)
        )
      ).toHaveLength(0);
    });

    it('PA-CEB-028: Prosumer NAP wallet with DID asks for connection context before execution', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'NAP Wallet angelegt mit DID did:corrently:asset:Jjq2rt0EvYtjfdDmGxUgzQ',
        consultation: {},
        knownContext: {},
        extractedInputs: [
          {
            param: 'did',
            value: 'did:corrently:asset:Jjq2rt0EvYtjfdDmGxUgzQ',
            source: 'message',
            confidence: 'high',
          },
        ],
        executionMode: 'auto',
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
      expect(plan.readiness).toBe(EXECUTION_READINESS.AWAITING_INPUT);
      expect(plan.canExecuteNow).toBe(false);
      expect(plan.missingInputs.find((m) => m.param === 'did')).toBeUndefined();
      expect(plan.missingInputs.find((m) => m.param === 'location_or_melo')).toBeDefined();
      expect(plan.nextUserQuestion.toLowerCase()).toMatch(/plz|ort|melo|netzanschluss/);
      expect(plan.assumptions.find((a) => a.type === 'identity_anchor')).toBeDefined();
    });

    it('PA-CEB-029: Prosumer NAP wallet with DID and PLZ builds executable context steps and consent gates', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'NAP Wallet Onboarding für PV und Wärmepumpe',
        consultation: {},
        knownContext: {
          did: 'did:corrently:asset:Jjq2rt0EvYtjfdDmGxUgzQ',
          postalCode: '68159',
          assetType: 'PV, Wärmepumpe',
        },
        executionMode: 'auto',
      });

      expect(plan.workflowType).toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
      expect(plan.missingInputs.find((m) => m.param === 'did')).toBeUndefined();
      expect(plan.missingInputs.find((m) => m.param === 'location_or_melo')).toBeUndefined();
      expect(plan.executableSteps.map((step) => step.action)).toContain('grid-operations.marketPartners');
      expect(plan.executableSteps.map((step) => step.action)).toContain('osm-geo.infrastructureNearby');
      expect(plan.evidenceGates.map((gate) => gate.id)).toContain('nap_consent_gate');
      expect(plan.evidenceGates.map((gate) => gate.id)).toContain('nap_dlr_publication_gate');
    });
  });
});
