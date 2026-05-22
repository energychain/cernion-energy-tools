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
      expect(classifyWorkflowType({ message: 'Wie erklärt ihr KI-Entscheidungen dem Aufsichtsrat?' })).toBe(
        WORKFLOW_TYPES.ADVISORY_ONLY
      );
      expect(classifyWorkflowType({ message: 'Was ist euer Governance-Ansatz?' })).toBe(
        WORKFLOW_TYPES.ADVISORY_ONLY
      );
      expect(classifyWorkflowType({ message: 'Strategische Haftungsfragen bei black-box AI' })).toBe(
        WORKFLOW_TYPES.ADVISORY_ONLY
      );
    });

    it('PA-CEB-002: BESS with location+capacity resolves to bess_development', () => {
      expect(
        classifyWorkflowType({
          message: 'Großspeicher planen',
          knownContext: { municipality: 'Troisdorf', powerMW: 10 },
        })
      ).toBe(WORKFLOW_TYPES.BESS_DEVELOPMENT);
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

    it('PA-CEB-015: BESS with location+capacity in auto mode produces ready plan with steps', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Batteriespeicher planen',
        knownContext: { municipality: 'Troisdorf', powerMW: 15 },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.BESS_DEVELOPMENT);
      expect(plan.executableSteps.length).toBeGreaterThan(0);
      expect(plan.executableSteps.every((s) => s.action)).toBe(true);
      // MaStR disclaimer must appear in assumptions
      const disclaimers = plan.assumptions.filter((a) =>
        a.statement.includes('Kontextindikator')
      );
      expect(disclaimers.length).toBeGreaterThan(0);
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

    it('PA-CEB-018: VNB workflow with location produces executable VNB lookup step', () => {
      const plan = buildConsultationExecutionPlan({
        message: 'Wer ist der Netzbetreiber in Heidelberg?',
        knownContext: { municipality: 'Heidelberg' },
        executionMode: 'auto',
      });
      expect(plan.workflowType).toBe(WORKFLOW_TYPES.VNB_IDENTIFICATION);
      const vnbStep = plan.executableSteps.find((s) => s.action.includes('vnbLookup'));
      expect(vnbStep).toBeDefined();
      expect(vnbStep.canExecute).toBe(true);
    });
  });
});
