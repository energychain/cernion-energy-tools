'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const DossierHydrationManagementService = require('../services/dossier-hydration-management.service');
const {
  getRule,
  listRules,
  validateRule,
  compileRule,
  isBlockedAction,
  isSafetyRejectedAction,
  getStaticRules,
  getRuntimeRules,
  getRuntimeRule,
  setRuntimeRule,
  removeRuntimeRule,
  reloadRegistry,
  _resetRegistry,
  KNOWN_EXTRACTORS,
  KNOWN_FORMATTERS,
} = require('../src/dossier-hydration-registry');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRule(overrides = {}) {
  return {
    id: 'test.safeReadAction',
    action: 'test.safeReadAction',
    label: 'Test Safe Read Action',
    enabled: true,
    safety: { readOnly: true, nonConsequential: true, hitlRequired: false, allowsMutation: false },
    paramTemplate: {
      location: { extractor: 'locationFromPromptOrFacts', required: true },
    },
    formatter: {
      type: 'fieldSummary',
      fields: [{ paths: ['value', 'data.value'], label: 'Wert' }],
    },
    evidenceQuality: 'validated',
    timeoutMs: 5000,
    ...overrides,
  };
}

const TEST_DB_PATH = `./data/dossier-hydration-test-${Date.now()}`;

function makeBroker() {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  const broker = new ServiceBroker({ logger: false });
  broker.createService({
    ...DossierHydrationManagementService,
    settings: {
      ...DossierHydrationManagementService.settings,
      dbPath: TEST_DB_PATH,
    },
  });
  return broker;
}

// ── Registry unit tests (no broker needed) ────────────────────────────────────

describe('dossier-hydration-registry (unit)', () => {
  beforeEach(() => _resetRegistry());
  afterAll(() => _resetRegistry());

  // ── Static baseline ──────────────────────────────────────────────────────

  describe('static baseline rules', () => {
    it('loads all 56 static rules', () => {
      const rules = getStaticRules();
      expect(rules.length).toBe(56);
    });

    it('compiles all 56 static rules without error', () => {
      const rules = listRules();
      expect(rules.length).toBe(56);
      for (const rule of rules) {
        expect(typeof rule.extractParams).toBe('function');
        expect(typeof rule.formatEvidence).toBe('function');
      }
    });

    it('energy-market.co2Intensity compiles and has correct evidenceQuality', () => {
      const rule = getRule('energy-market.co2Intensity');
      expect(rule).not.toBeNull();
      expect(rule.evidenceQuality).toBe('validated');
      expect(rule.timeoutMs).toBe(7000);
    });

    it('residual-load.netResidualLoad has 14000ms timeout', () => {
      const rule = getRule('residual-load.netResidualLoad');
      expect(rule).not.toBeNull();
      expect(rule.timeoutMs).toBe(14000);
    });

    it('all 15 actions are retrievable by getRule()', () => {
      const expected = [
        'energy-market.co2Intensity',
        'gas-storage.countryStorage',
        'gas-storage.supplySecurityCheck',
        'entsoe.loadForecast',
        'entsoe.windSolarForecast',
        'entsoe.dayAheadPrices',
        'energy-market.prices',
        'residual-load.netResidualLoad',
        'redispatch-readiness-gate.getStatus',
        're4de-variable-grid-fee.getEvidence',
        'battery-redispatch-special-gate.getStatus',
        'flexibility-conductor-role-model.getStatus',
        'knowledge-continuity-governance-gate.getStatus',
        'investment-maturity-off-balance-gate.getStatus',
        'gas-capacity-order-revision-gate.getStatus',
      ];
      for (const action of expected) {
        expect(getRule(action)).not.toBeNull();
      }
    });
  });

  // ── Extractors ────────────────────────────────────────────────────────────

  describe('extractors', () => {
    it('co2Intensity extracts city from "74889 Sinsheim" pattern', () => {
      const rule = getRule('energy-market.co2Intensity');
      const params = rule.extractParams([], 'Prüfe CO2 in 74889 Sinsheim');
      expect(params).not.toBeNull();
      expect(params.location).toBe('Sinsheim');
      expect(params.forecast).toBe(true);
    });

    it('co2Intensity extracts PLZ when no city present', () => {
      const rule = getRule('energy-market.co2Intensity');
      const params = rule.extractParams([], 'CO2-Intensität für 69115');
      expect(params).not.toBeNull();
      expect(params.location).toBe('69115');
    });

    it('co2Intensity extracts city-only follow-up location facts', () => {
      const rule = getRule('energy-market.co2Intensity');
      const facts = [{ factType: 'city', value: 'Heidelberg', projectScope: { location: 'Heidelberg' } }];
      const params = rule.extractParams(facts, 'Ich wohne in Heidelberg');
      expect(params).not.toBeNull();
      expect(params.location).toBe('Heidelberg');
      expect(params.forecast).toBe(true);
    });

    it('co2Intensity returns null when no location available', () => {
      const rule = getRule('energy-market.co2Intensity');
      const params = rule.extractParams([], 'Was ist die aktuelle CO2-Intensität?');
      expect(params).toBeNull();
    });

    it('gas-storage.countryStorage returns constant params', () => {
      const rule = getRule('gas-storage.countryStorage');
      const params = rule.extractParams([], 'Wie ist der Gasspeicherstand?');
      expect(params).toEqual({ country: 'DE', includeOperators: false, includeFacilities: false });
    });

    it('gas-storage.supplySecurityCheck returns constant params', () => {
      const rule = getRule('gas-storage.supplySecurityCheck');
      const params = rule.extractParams([], 'Versorgungssicherheit prüfen');
      expect(params).toEqual({ country: 'DE', winterMandateCheck: true });
    });

    it('entsoe.loadForecast extracts date range', () => {
      const rule = getRule('entsoe.loadForecast');
      const params = rule.extractParams([], 'Lastprognose für morgen');
      expect(params).not.toBeNull();
      expect(params.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.region).toBe('Germany');
    });

    it('energy-market.prices uses startDate/endDate keys (not dateFrom/dateTo)', () => {
      const rule = getRule('energy-market.prices');
      const params = rule.extractParams([], 'Day-Ahead Preise heute');
      expect(params).not.toBeNull();
      expect(params.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.dateFrom).toBeUndefined();
      expect(params.market).toBe('day-ahead');
    });

    it('residual-load.netResidualLoad extracts city+PLZ', () => {
      const rule = getRule('residual-load.netResidualLoad');
      const params = rule.extractParams([], 'Residuallast für 74889 Sinsheim');
      expect(params).not.toBeNull();
      expect(params.gemeinde).toBe('Sinsheim');
      expect(params.postleitzahl).toBe('74889');
      expect(params.forecastDays).toBe(1);
    });

    it('residual-load.netResidualLoad returns null without city', () => {
      const rule = getRule('residual-load.netResidualLoad');
      const params = rule.extractParams([], 'Wie ist die Residuallast?');
      expect(params).toBeNull();
    });

    it('residual-load.netResidualLoad uses location fact if no city in prompt', () => {
      const rule = getRule('residual-load.netResidualLoad');
      const facts = [{ factType: 'location', value: 'Heidelberg', projectScope: { city: 'Heidelberg' } }];
      const params = rule.extractParams(facts, 'Residuallast prüfen');
      expect(params).not.toBeNull();
      expect(params.gemeinde).toBe('Heidelberg');
    });
  });

  // ── Formatters ────────────────────────────────────────────────────────────

  describe('formatters', () => {
    it('co2Intensity fieldSummary formats valid response', () => {
      const rule = getRule('energy-market.co2Intensity');
      const formatted = rule.formatEvidence({
        index: 85,
        co2: 120,
        average_today_gco2eq_kwh: 130,
        renewable: 0.42,
        location: 'Sinsheim',
      });
      expect(formatted).toContain('GruenstromIndex: 85');
      expect(formatted).toContain('CO2-Intensitaet: 120 g/kWh');
      expect(formatted).toContain('Erneuerbare: 42%');
      expect(formatted).toContain('Sinsheim');
    });

    it('co2Intensity fieldSummary returns null for empty result', () => {
      const rule = getRule('energy-market.co2Intensity');
      expect(rule.formatEvidence({})).toBeNull();
    });

    it('redispatch-readiness-gate.getStatus is dossier-safe and formats status facts', () => {
      const rule = getRule('redispatch-readiness-gate.getStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(rule.extractParams([], 'Redispatch Readiness pruefen')).toEqual({});

      const formatted = rule.formatEvidence({
        overallStatus: 'ready',
        accessMatrixStatus: 'complete',
        testCallStatus: 'passed',
        productionProofConfirmed: true,
        templateVersionCurrent: true,
        openQuestionsCount: 0,
        responsibleRole: 'Redispatch IT/Fachkoordination',
        acceptanceDeadline: '2026-07-01',
        daysUntilDeadline: 12,
        evaluatedAt: '2026-06-19T08:00:00.000Z',
      });

      expect(formatted).toContain('Status: ready');
      expect(formatted).toContain('Zugangsmatrix: complete');
      expect(formatted).toContain('Testabruf: passed');
      expect(formatted).toContain('Produktivnachweis: true');
      expect(formatted).toContain('Offene Fragen: 0');
    });

    it('redispatch-readiness-gate.getStatus formats not-found message as fallback evidence', () => {
      const rule = getRule('redispatch-readiness-gate.getStatus');
      expect(rule.formatEvidence({ found: false, message: 'No readiness evaluation yet' })).toBe(
        'No readiness evaluation yet'
      );
    });

    it('dashboard-api.redispatchCallQualityGate is dossier-safe and formats call-gate evidence', () => {
      const rule = getRule('dashboard-api.redispatchCallQualityGate');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Redispatch Abruf fuer SNB935578300972 und DE0012345678901234567890123456789 pruefen'
        )
      ).toEqual({
        gridOperatorId: 'SNB935578300972',
        meloId: 'DE0012345678901234567890123456789',
      });

      const formatted = rule.formatEvidence({
        gateStatus: 'needs_metering_clarification',
        callContext: {
          gridOperatorId: 'SNB935578300972',
          meloId: 'DE0012345678901234567890123456789',
        },
        leadingProcessSignal: { blocker: 'loadProfileCompleteness' },
        masterDataReadiness: { status: 'available' },
        meteringReadiness: { status: 'needs_clarification' },
        forecastReadiness: { status: 'needs_clarification' },
        controlEvidenceReadiness: { status: 'available' },
        settlementReadiness: { status: 'not_ready', readinessPercent: 88.1 },
        timestamp: '2026-06-19T15:50:00.000Z',
      });

      expect(formatted).toContain('Gate Status: needs_metering_clarification');
      expect(formatted).toContain('Leading Blocker: loadProfileCompleteness');
      expect(formatted).toContain('Grid Operator: SNB935578300972');
      expect(formatted).toContain('Settlement: not_ready');
    });

    it('dashboard-api.redispatchCallQualityGate formats not-found message as fallback evidence', () => {
      const rule = getRule('dashboard-api.redispatchCallQualityGate');
      expect(
        rule.formatEvidence({ found: false, message: 'No Redispatch call gate evidence yet' })
      ).toBe('No Redispatch call gate evidence yet');
    });

    it('dashboard-api.evidenceGroundingConfidenceAudit is dossier-safe and formats confidence evidence', () => {
      const rule = getRule('dashboard-api.evidenceGroundingConfidenceAudit');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Confidence Audit fuer domain=grid_connection SNB935578300972 datapoint:confirmed:1 laden'
        )
      ).toEqual({
        domain: 'grid_connection',
        gridOperatorId: 'SNB935578300972',
        datapointId: 'datapoint:confirmed:1',
      });

      const formatted = rule.formatEvidence({
        answerStatus: 'requires_operator_confirmation',
        routingConfidence: { score: 0.92 },
        evidenceConfidence: { level: 'low', score: 0.45 },
        requiresNetworkOperatorConfirmation: true,
        requestContext: {
          domain: 'grid_connection',
          gridOperatorId: 'SNB935578300972',
        },
        missingEvidence: [{ missingDataPoint: 'network_operator_confirmation' }],
        timestamp: '2026-06-19T16:30:00.000Z',
      });

      expect(formatted).toContain('Answer Status: requires_operator_confirmation');
      expect(formatted).toContain('Routing Confidence: 0.92');
      expect(formatted).toContain('Evidence Confidence: low');
      expect(formatted).toContain('Leading Gap: network_operator_confirmation');
    });

    it('dashboard-api.receiptGroundedPresentationContract is dossier-safe and formats grounding evidence', () => {
      const rule = getRule('dashboard-api.receiptGroundedPresentationContract');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Presentation Contract renderer=vdmi_matrix_table action=mock.kpi gap=missing_vdmi_roles laden'
        )
      ).toEqual({
        preferredFormat: 'vdmi_matrix_table',
        sourceAction: 'mock.kpi',
        evidenceGapId: 'missing_vdmi_roles',
      });

      const formatted = rule.formatEvidence({
        selectedType: 'debug_summary',
        allowedTypes: ['debug_summary', 'kpi_fact'],
        blockedReason: 'requested_renderer_not_grounded:vdmi_matrix_table',
        sourceActions: ['mock.kpi'],
        evidenceGapIds: ['missing_vdmi_roles'],
        timestamp: '2026-06-19T17:45:00.000Z',
      });

      expect(formatted).toContain('Selected Renderer: debug_summary');
      expect(formatted).toContain('Allowed Renderer: debug_summary');
      expect(formatted).toContain('Blocked Reason: requested_renderer_not_grounded:vdmi_matrix_table');
      expect(formatted).toContain('Source Action: mock.kpi');
      expect(formatted).toContain('Evidence Gap: missing_vdmi_roles');
    });

    it('dashboard-api.marketCommunicationEvidenceChainStatus is dossier-safe and formats evidence-chain facts', () => {
      const rule = getRule('dashboard-api.marketCommunicationEvidenceChainStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Marktkommunikations Evidenzkette malo=DE-MALO-1 melo=DE-MELO-1 case=case-123 laden'
        )
      ).toEqual({
        maloId: 'DE-MALO-1',
        meloId: 'DE-MELO-1',
        caseId: 'case-123',
        includeHints: true,
      });

      const formatted = rule.formatEvidence({
        status: 'needs_official_evidence',
        officialEvidence: [{ id: 'malo_identity' }],
        hintsOnly: [{ id: 'portal_screenshot' }],
        missingEvidence: [{ missingDataPoint: 'utilmd_masterdata_path' }],
        positiveFollowUps: [
          {
            enablesDossierAddition:
              'replace portal hints with official master-data provenance',
          },
        ],
        timestamp: '2026-06-19T21:30:00.000Z',
      });

      expect(formatted).toContain('Evidence Status: needs_official_evidence');
      expect(formatted).toContain('Official Evidence: malo_identity');
      expect(formatted).toContain('Hint Only: portal_screenshot');
      expect(formatted).toContain('Leading Gap: utilmd_masterdata_path');
    });

    it('dashboard-api.e2eControllabilityGovernanceStatus is dossier-safe and formats governance facts', () => {
      const rule = getRule('dashboard-api.e2eControllabilityGovernanceStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte E2E Steuerbarkeitscheck Governance case=case-173 owner=netzanschluss frist=2026-07-01 laden'
        )
      ).toEqual({
        caseId: 'case-173',
        owner: 'netzanschluss',
        deadline: '2026-07-01',
      });

      const formatted = rule.formatEvidence({
        status: 'partial_governance_evidence',
        processSteps: [{ label: 'Netzanschluss-/Asset-Identifikation' }],
        gaps: [{ missingDataPoint: 'metering_concept' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add TAF and Messkonzept readiness',
          },
        ],
        owners: [{ value: 'netzanschluss' }],
        timestamp: '2026-06-19T22:30:00.000Z',
      });

      expect(formatted).toContain('Governance Status: partial_governance_evidence');
      expect(formatted).toContain('First Step: Netzanschluss-/Asset-Identifikation');
      expect(formatted).toContain('Leading Gap: metering_concept');
      expect(formatted).toContain('Owner: netzanschluss');
    });

    it('dashboard-api.controllabilityAssetHandoverStatus is dossier-safe and formats handover facts', () => {
      const rule = getRule('dashboard-api.controllabilityAssetHandoverStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Steuerbarkeitscheck Asset Linienuebergabe asset=asset-194 owner=assetmanagement case=case-194 laden'
        )
      ).toEqual({
        caseId: 'case-194',
        assetId: 'asset-194',
        lineOwnerRole: 'assetmanagement',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_feedback_capability',
        asset: { assetId: 'asset-194' },
        lineOwnerRole: 'assetmanagement',
        missingEvidence: [{ missingDataPoint: 'feedback_capability' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add Rueckmelde-/Fernsteuerbarkeits evidence',
          },
        ],
        timestamp: '2026-06-19T23:50:00.000Z',
      });

      expect(formatted).toContain('Handover Status: needs_feedback_capability');
      expect(formatted).toContain('Asset: asset-194');
      expect(formatted).toContain('Owner: assetmanagement');
      expect(formatted).toContain('Leading Gap: feedback_capability');
    });

    it('dashboard-api.regulatoryChangeReadinessStatus is dossier-safe and formats readiness facts', () => {
      const rule = getRule('dashboard-api.regulatoryChangeReadinessStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Regulatory Change Readiness fuer reg-change:eeg-2027 zum 2027-01-01 EEG pruefen'
        )
      ).toEqual({
        changeId: 'reg-change:eeg-2027',
        effectiveDate: '2027-01-01',
        mechanismType: 'eeg',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_interval_profile',
        readinessScore: 0.36,
        requestContext: {
          changeId: 'reg-change:eeg-2027',
          effectiveDate: '2027-01-01',
          mechanismType: 'EEG',
        },
        sourceEvidence: {
          dictionaryVersion: 'dd-v1',
          billingRuleReference: 'eeg-rule-v1',
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_interval_profile'],
        },
      });

      expect(formatted).toContain('Readiness Status: needs_interval_profile');
      expect(formatted).toContain('Readiness: 0.36');
      expect(formatted).toContain('Change: reg-change:eeg-2027');
      expect(formatted).toContain('Dictionary: dd-v1');
    });

    it('dashboard-api.investmentTwoTrackControlStatus is dossier-safe and formats two-track facts', () => {
      const rule = getRule('dashboard-api.investmentTwoTrackControlStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Investment Two-Track Control fuer submission:2026-capex bis 2026-09-30 owner Assetmanagement pruefen'
        )
      ).toEqual({
        submissionId: 'submission:2026-capex',
        deadline: '2026-09-30',
        tacticalOwner: 'Assetmanagement',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_finance_review',
        readinessScore: 0.3,
        requestContext: {
          submissionId: 'submission:2026-capex',
          deadline: '2026-09-30',
        },
        tacticalTrack: {
          owner: 'Assetmanagement',
          readiness: '2/5',
        },
        targetTrack: {
          owner: 'Strategic Asset Management',
          readiness: '0/4',
        },
        missingEvidence: [
          { missingDataPoint: 'finance_review' },
        ],
        dossierEvidence: {
          dossierFacts: ['Status: needs_finance_review'],
        },
      });

      expect(formatted).toContain('Control Status: needs_finance_review');
      expect(formatted).toContain('Readiness: 0.30');
      expect(formatted).toContain('Submission: submission:2026-capex');
      expect(formatted).toContain('Tactical Owner: Assetmanagement');
      expect(formatted).toContain('Leading Gap: finance_review');
    });

    it('dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus is dossier-safe and formats scenario facts', () => {
      const rule = getRule('dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Zaehlpark Finanzierung Szenario fuer gridOperatorId=VNB-143 und scenarioId=sc-2026-rollout pruefen'
        )
      ).toEqual({
        gridOperatorId: 'VNB-143',
        scenarioId: 'sc-2026-rollout',
      });

      const formatted = rule.formatEvidence({
        status: 'ready_for_decision',
        gateStatus: 'review_required',
        readinessScore: 1,
        requestContext: {
          gridOperatorId: 'VNB-143',
          scenarioId: 'sc-2026-rollout',
        },
        complianceEvidence: {
          assetScope: 'imsys,gateway',
          investmentVolume: 6200000,
          imsysCount: 4200,
          financingModel: 'leasing',
          opexAnnual: 310000,
          regulatoryRelevance: 'paragraph_14a',
        },
        missingEvidence: [],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: ready_for_decision'],
        },
      });

      expect(formatted).toContain('Scenario Readiness: ready_for_decision');
      expect(formatted).toContain('Decision Status: review_required');
      expect(formatted).toContain('DSO ID: VNB-143');
      expect(formatted).toContain('Scenario ID: sc-2026-rollout');
      expect(formatted).toContain('Financing Model: leasing');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.processSensitizationReadinessMapStatus is dossier-safe and formats readiness facts', () => {
      const rule = getRule('dashboard-api.processSensitizationReadinessMapStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Prozess-Sensibilisierung processType=netzanschluss als Readiness Map pruefen'
        )
      ).toEqual({
        processType: 'netzanschluss',
      });

      const formatted = rule.formatEvidence({
        readinessStatus: 'needs_evidence',
        processTopic: 'netzanschluss',
        readinessScore: 0.55,
        requestContext: {
          owner: 'Netzanschluss',
          dueDate: '2026-07-01',
        },
        missingEvidence: [
          {
            missingDataPoint: 'missing_evidence',
            value: 'rollenmatrix',
          },
        ],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add evidence-backed readiness statement for rollenmatrix',
          },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Readiness Status: needs_evidence'],
        },
      });

      expect(formatted).toContain('Readiness Status: needs_evidence');
      expect(formatted).toContain('Process Topic: netzanschluss');
      expect(formatted).toContain('Readiness Score: 0.55');
      expect(formatted).toContain('Owner: Netzanschluss');
      expect(formatted).toContain('Leading Gap: rollenmatrix');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.sapBudgetPspGateStatus is dossier-safe and formats SAP/PSP gate facts', () => {
      const rule = getRule('dashboard-api.sapBudgetPspGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte SAP Budget PSP Gate fuer measure:196 psp=PSP-2026-4711 snapshot=snapshot:sap-psp-196 laden'
        )
      ).toEqual({
        measureId: 'measure:196',
        pspElementId: 'PSP-2026-4711',
        sourceSnapshotId: 'snapshot:sap-psp-196',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_budget_owner',
        readinessScore: 0.44,
        requestContext: {
          measureId: 'measure:196',
        },
        measureContext: {
          pspElementId: 'PSP-2026-4711',
        },
        budgetEvidence: {
          budgetOverhangEur: 50000,
          effectiveBudgetGapEur: -50000,
        },
        gateEvidence: {
          financeGate: 'board-pack-ready',
        },
        missingEvidence: [
          { missingDataPoint: 'budget_owner' },
        ],
        sourceActions: {
          notCalled: ['sap.psp.write'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_budget_owner'],
        },
      });

      expect(formatted).toContain('Gate Status: needs_budget_owner');
      expect(formatted).toContain('Readiness: 0.44');
      expect(formatted).toContain('Measure: measure:196');
      expect(formatted).toContain('PSP: PSP-2026-4711');
      expect(formatted).toContain('Leading Gap: budget_owner');
      expect(formatted).toContain('Side-Effect Guard: sap.psp.write');
    });

    it('dashboard-api.energyTaxInformationPackageStatus is dossier-safe and formats package facts', () => {
      const rule = getRule('dashboard-api.energyTaxInformationPackageStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Energiesteuer Package package=etip:188 datasource=datasource:tax dictionary=dd-v1 laden'
        )
      ).toEqual({
        packageId: 'etip:188',
        dataSourceId: 'datasource:tax',
        dictionaryVersion: 'dd-v1',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_owner_sla',
        readinessScore: 0.5,
        requestContext: {
          packageId: 'etip:188',
        },
        packageContext: {
          dataSourceId: 'datasource:tax',
          dictionaryVersion: 'dd-v1',
          period: '2026-Q1',
        },
        handoverContext: {
          auditReference: 'audit:188',
        },
        missingEvidence: [
          { missingDataPoint: 'responsible_owner' },
        ],
        sourceActions: {
          notCalled: ['tax.calculate'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_owner_sla'],
        },
      });

      expect(formatted).toContain('Package Status: needs_owner_sla');
      expect(formatted).toContain('Readiness: 0.5');
      expect(formatted).toContain('Package: etip:188');
      expect(formatted).toContain('Source: datasource:tax');
      expect(formatted).toContain('Dictionary: dd-v1');
      expect(formatted).toContain('Leading Gap: responsible_owner');
      expect(formatted).toContain('Side-Effect Guard: tax.calculate');
    });

    it('dashboard-api.investmentRiskTranslationStatus is dossier-safe and formats translation facts', () => {
      const rule = getRule('dashboard-api.investmentRiskTranslationStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Invest Risiko Quelle source=gf-slide:191 sourceType=gf_slide classification=decision_basis laden'
        )
      ).toEqual({
        sourceRef: 'gf-slide:191',
        sourceType: 'gf_slide',
        classification: 'decision_basis',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_owner_role',
        readinessScore: 0.5,
        requestContext: {
          sourceRef: 'gf-slide:191',
        },
        translationContext: {
          sourceType: 'gf_slide',
          classification: 'decision_basis',
        },
        handoverContext: {
          blockedDecisionId: 'decision:capex-q3',
          nextAction: 'prepare handover',
        },
        missingEvidence: [
          { missingDataPoint: 'owner_role' },
        ],
        sourceActions: {
          notCalled: ['vdmi.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_owner_role'],
        },
      });

      expect(formatted).toContain('Translation Status: needs_owner_role');
      expect(formatted).toContain('Readiness: 0.5');
      expect(formatted).toContain('Source: gf-slide:191');
      expect(formatted).toContain('Source Type: gf_slide');
      expect(formatted).toContain('Classification: decision_basis');
      expect(formatted).toContain('Blocked Decision: decision:capex-q3');
      expect(formatted).toContain('Leading Gap: owner_role');
      expect(formatted).toContain('Side-Effect Guard: vdmi.create');
    });

    it('dashboard-api.budgetWaterfallGovernanceStatus is dossier-safe and formats governance facts', () => {
      const rule = getRule('dashboard-api.budgetWaterfallGovernanceStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Budget Wasserfall waterfall=bwg:189 baseline=baseline:2026 vorzeichen=positive laden'
        )
      ).toEqual({
        waterfallId: 'bwg:189',
        baselineRef: 'baseline:2026',
        signConvention: 'positive',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_forecast_cutoff',
        readinessScore: 0.55,
        requestContext: {
          waterfallId: 'bwg:189',
        },
        waterfallContext: {
          period: '2026-Q3',
          division: 'Stromnetz',
        },
        governanceEvidence: {
          baselineRef: 'baseline:2026',
          signConvention: 'positive reduces headroom',
          approvalStatus: 'draft',
        },
        missingEvidence: [
          { missingDataPoint: 'forecast_cutoff' },
        ],
        sourceActions: {
          notCalled: ['finance-agent.mutate'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_forecast_cutoff'],
        },
      });

      expect(formatted).toContain('Governance Status: needs_forecast_cutoff');
      expect(formatted).toContain('Readiness: 0.55');
      expect(formatted).toContain('Waterfall: bwg:189');
      expect(formatted).toContain('Period: 2026-Q3');
      expect(formatted).toContain('Division: Stromnetz');
      expect(formatted).toContain('Baseline: baseline:2026');
      expect(formatted).toContain('Sign Convention: positive reduces headroom');
      expect(formatted).toContain('Leading Gap: forecast_cutoff');
      expect(formatted).toContain('Side-Effect Guard: finance-agent.mutate');
    });

    it('dashboard-api.gasDecommissioningRoadmapStatus is dossier-safe and formats roadmap facts', () => {
      const rule = getRule('dashboard-api.gasDecommissioningRoadmapStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Gasnetz Stilllegung roadmap=gdr:190 phase=committee-gate owner=Netzstrategie laden'
        )
      ).toEqual({
        roadmapId: 'gdr:190',
        currentPhase: 'committee-gate',
        owner: 'Netzstrategie',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_investment_impact',
        readinessScore: 0.64,
        requestContext: {
          roadmapId: 'gdr:190',
        },
        roadmapContext: {
          currentPhase: 'risk-assessment',
          owner: 'Netzstrategie',
        },
        phaseEvidence: {
          assetRiskEvidence: 'asset-risk:west-loop',
          committeeGateDate: '2026-09-15',
        },
        nextDecisionGate: 'committee:decommissioning-q3',
        missingEvidence: [
          { missingDataPoint: 'investment_impact_ref' },
        ],
        sourceActions: {
          notCalled: ['gas-transformation.executeDecommissioning'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_investment_impact'],
        },
      });

      expect(formatted).toContain('Roadmap Status: needs_investment_impact');
      expect(formatted).toContain('Readiness: 0.64');
      expect(formatted).toContain('Roadmap: gdr:190');
      expect(formatted).toContain('Phase: risk-assessment');
      expect(formatted).toContain('Owner: Netzstrategie');
      expect(formatted).toContain('Asset Risk: asset-risk:west-loop');
      expect(formatted).toContain('Committee Gate: 2026-09-15');
      expect(formatted).toContain('Next Gate: committee:decommissioning-q3');
      expect(formatted).toContain('Leading Gap: investment_impact_ref');
      expect(formatted).toContain('Side-Effect Guard: gas-transformation.executeDecommissioning');
    });

    it('dashboard-api.jourFixeDecisionClosureStatus is dossier-safe and formats closure facts', () => {
      const rule = getRule('dashboard-api.jourFixeDecisionClosureStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Jour Fixe Decision Closure topic=jf:186 jourFixeId=weekly owner=Netzstrategie laden'
        )
      ).toEqual({
        topicId: 'jf:186',
        jourFixeId: 'weekly',
        owner: 'Netzstrategie',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_next_gate',
        readinessScore: 0.64,
        requestContext: {
          topicId: 'jf:186',
        },
        topic: {
          topicId: 'jf:186',
          jourFixeId: 'weekly',
        },
        closureEvidence: {
          owner: 'Netzstrategie',
          kpi: 'closure-rate',
          decisionCriterion: 'committee-approved',
          blockedFollowUpAction: 'investment-gate',
        },
        missingEvidence: [
          { missingDataPoint: 'next_gate' },
        ],
        sourceActions: {
          notCalled: ['vdmi.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_next_gate'],
        },
      });

      expect(formatted).toContain('Closure Status: needs_next_gate');
      expect(formatted).toContain('Readiness: 0.64');
      expect(formatted).toContain('Topic: jf:186');
      expect(formatted).toContain('Jour Fixe: weekly');
      expect(formatted).toContain('Owner: Netzstrategie');
      expect(formatted).toContain('KPI: closure-rate');
      expect(formatted).toContain('Decision Criterion: committee-approved');
      expect(formatted).toContain('Blocked Follow-Up: investment-gate');
      expect(formatted).toContain('Leading Gap: next_gate');
      expect(formatted).toContain('Side-Effect Guard: vdmi.create');
    });

    it('dashboard-api.offBalancingMeteringPruefmatrixStatus is dossier-safe and formats matrix facts', () => {
      const rule = getRule('dashboard-api.offBalancingMeteringPruefmatrixStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Off-Balancing Metering pruefmatrix=obm:187 scope=zaehlpark-west financingModel=leasing laden'
        )
      ).toEqual({
        matrixId: 'obm:187',
        meteringScope: 'zaehlpark-west',
        financingModel: 'leasing',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_grid_investment_proof',
        readinessScore: 0.69,
        requestContext: {
          matrixId: 'obm:187',
        },
        matrixContext: {
          matrixId: 'obm:187',
          meteringScope: 'zaehlpark-west',
          financingModel: 'leasing',
        },
        financingEvidence: {
          regulatoryEffectEvidence: 'eog:scenario-187',
          financierConditions: 'covenants:documented',
        },
        gridInvestmentVerdict: {
          gridInvestmentSpaceProof: null,
          usableGridInvestmentHeadroomProven: false,
        },
        missingEvidence: [
          { missingDataPoint: 'grid_investment_space_proof' },
        ],
        sourceActions: {
          notCalled: ['finance-agent.mutate'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_grid_investment_proof'],
        },
      });

      expect(formatted).toContain('Pruefmatrix Status: needs_grid_investment_proof');
      expect(formatted).toContain('Readiness: 0.69');
      expect(formatted).toContain('Matrix: obm:187');
      expect(formatted).toContain('Metering Scope: zaehlpark-west');
      expect(formatted).toContain('Financing Model: leasing');
      expect(formatted).toContain('Regulatory Effect: eog:scenario-187');
      expect(formatted).toContain('Financier Terms: covenants:documented');
      expect(formatted).toContain('Usable Headroom: false');
      expect(formatted).toContain('Leading Gap: grid_investment_space_proof');
      expect(formatted).toContain('Side-Effect Guard: finance-agent.mutate');
    });

    it('dashboard-api.automationRequirementsDecisionValueStatus is dossier-safe and formats decision-value facts', () => {
      const rule = getRule('dashboard-api.automationRequirementsDecisionValueStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Automation Requirements requirement=ardv:181 type=powerbi decisionValue=redispatch-kpi laden'
        )
      ).toEqual({
        requirementId: 'ardv:181',
        requestType: 'powerbi',
        decisionValue: 'redispatch-kpi',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_follow_up_process',
        readinessScore: 0.67,
        requestContext: {
          requirementId: 'ardv:181',
        },
        requirementContext: {
          requirementId: 'ardv:181',
          requestTitle: 'Redispatch KPI Dashboard',
          requestType: 'PowerBI',
          processArea: 'redispatch',
          decisionOwner: 'Netzbetrieb',
        },
        decisionEvidence: {
          sourceSystem: 'edm',
          movingDataFlow: 'edm-to-dashboard',
          controlPoint: 'redispatch-monitoring',
          decisionValue: 'redispatch-kpi',
          followUpProcess: null,
        },
        missingEvidence: [
          { missingDataPoint: 'follow_up_process' },
        ],
        sourceActions: {
          notCalled: ['powerbi.createDashboard'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_follow_up_process'],
        },
      });

      expect(formatted).toContain('Decision-Value Status: needs_follow_up_process');
      expect(formatted).toContain('Readiness: 0.67');
      expect(formatted).toContain('Requirement: ardv:181');
      expect(formatted).toContain('Request Type: PowerBI');
      expect(formatted).toContain('Process Area: redispatch');
      expect(formatted).toContain('Source System: edm');
      expect(formatted).toContain('Data Flow: edm-to-dashboard');
      expect(formatted).toContain('Decision Value: redispatch-kpi');
      expect(formatted).toContain('Leading Gap: follow_up_process');
      expect(formatted).toContain('Side-Effect Guard: powerbi.createDashboard');
    });

    it('dashboard-api.smartMeterOffBalancingPurposeLockStatus is dossier-safe and formats purpose-lock facts', () => {
      const rule = getRule('dashboard-api.smartMeterOffBalancingPurposeLockStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Smart Meter Purpose Lock case=smopl:198 scope=smart-meter-west financingModel=leasing laden'
        )
      ).toEqual({
        caseId: 'smopl:198',
        assetScope: 'smart-meter-west',
        financingModel: 'leasing',
      });

      const formatted = rule.formatEvidence({
        status: 'budget_dilution_risk',
        readinessScore: 0.69,
        requestContext: {
          caseId: 'smopl:198',
        },
        purposeLockContext: {
          caseId: 'smopl:198',
          assetScope: 'smart-meter-west',
          financingModel: 'leasing',
        },
        financeSummary: {
          freedLiquidityEur: 820000,
          financierCostEur: 64000,
          regulatoryRecognitionStatus: 'recognized-with-caveat',
          financeReviewStatus: 'pending',
        },
        purposeLockCoverage: {
          purposeLockEvidenced: true,
        },
        investmentEffectEvidence: {
          usableOperationalInvestmentEffect: true,
        },
        budgetDilutionRisk: {
          status: 'open',
        },
        missingEvidence: [
          { missingDataPoint: 'budget_dilution_risk_open' },
        ],
        sourceActions: {
          notCalled: ['finance-agent.mutate'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: budget_dilution_risk'],
        },
      });

      expect(formatted).toContain('Purpose-Lock Status: budget_dilution_risk');
      expect(formatted).toContain('Readiness: 0.69');
      expect(formatted).toContain('Case: smopl:198');
      expect(formatted).toContain('Asset Scope: smart-meter-west');
      expect(formatted).toContain('Financing Model: leasing');
      expect(formatted).toContain('Freed Liquidity EUR: 820000');
      expect(formatted).toContain('Regulatory Recognition: recognized-with-caveat');
      expect(formatted).toContain('Purpose Lock Evidenced: true');
      expect(formatted).toContain('Investment Effect: true');
      expect(formatted).toContain('Leading Gap: budget_dilution_risk_open');
      expect(formatted).toContain('Side-Effect Guard: finance-agent.mutate');
    });

    it('dashboard-api.imsysScheduleValueChainReadinessStatus is dossier-safe and formats value-chain facts', () => {
      const rule = getRule('dashboard-api.imsysScheduleValueChainReadinessStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte iMSys Fahrplan Value Chain case=isvc:199 scope=imsys-west control=ready laden'
        )
      ).toEqual({
        caseId: 'isvc:199',
        meteringScope: 'imsys-west',
        controlReadiness: 'ready',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_flex_mapping',
        readinessScore: 0.57,
        requestContext: {
          caseId: 'isvc:199',
        },
        valueChainContext: {
          caseId: 'isvc:199',
          gridOperatorId: 'vnb-west',
          meteringScope: 'imsys-west',
        },
        readinessEvidence: {
          dataQualityStatus: 'green',
          forecastWindow: '2026-Q3 rolling',
          congestionSignal: 'lv-congestion',
          controllabilityStatus: null,
          netzfahrplanAssessmentRef: 'fnav:199',
          operationalDecision: 'control-room-review',
          controlReadiness: 'missing',
          lineOwnerRole: 'Leitwarte',
        },
        missingEvidence: [
          { missingDataPoint: 'controllability_status' },
        ],
        sourceActions: {
          notCalled: ['device-control.execute'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_flex_mapping'],
        },
      });

      expect(formatted).toContain('iMSys Value-Chain Status: needs_flex_mapping');
      expect(formatted).toContain('Readiness: 0.57');
      expect(formatted).toContain('Case: isvc:199');
      expect(formatted).toContain('Grid Operator: vnb-west');
      expect(formatted).toContain('Metering Scope: imsys-west');
      expect(formatted).toContain('Forecast Window: 2026-Q3 rolling');
      expect(formatted).toContain('Congestion Signal: lv-congestion');
      expect(formatted).toContain('Netzfahrplan: fnav:199');
      expect(formatted).toContain('Operational Decision: control-room-review');
      expect(formatted).toContain('Control Readiness: missing');
      expect(formatted).toContain('Leading Gap: controllability_status');
      expect(formatted).toContain('Side-Effect Guard: device-control.execute');
    });

    it('dashboard-api.gasTransformationDependencyMapStatus is dossier-safe and formats dependency map facts', () => {
      const rule = getRule('dashboard-api.gasTransformationDependencyMapStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Gasnetztransformation Abhaengigkeitslandkarte projectId=project-155 laden'
        )
      ).toEqual({
        projectId: 'project-155',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_division',
        readinessScore: 0.1,
        requestContext: {
          projectId: 'project-155',
        },
        complianceContext: {
          projectId: 'project-155',
        },
        complianceEvidence: {
          division: 'Gas',
          nodes: [],
          dependencies: [],
          dataQualityGaps: [],
          investmentPaths: [],
          decommissionRepurposePaths: [],
          customerGroups: [],
          owner: null,
          nextAction: null,
        },
        missingEvidence: [
          { missingDataPoint: 'division' },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_division'],
        },
      });

      expect(formatted).toContain('Dependency Map Status: needs_division');
      expect(formatted).toContain('Readiness: 0.1');
      expect(formatted).toContain('Sparte: Gas');
      expect(formatted).toContain('Leading Gap: division');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.gridConnectionTransformationGateStatus is dossier-safe and formats transformations gate facts', () => {
      const rule = getRule('dashboard-api.gridConnectionTransformationGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Netzanschlusspunkt Transformations Gate meteringPointId=melo-144 laden'
        )
      ).toEqual({
        meteringPointId: 'melo-144',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_division',
        gateStatus: 'needs_evidence',
        readinessScore: 0.1,
        requestContext: {
          meteringPointId: 'melo-144',
        },
        complianceContext: {
          meteringPointId: 'melo-144',
        },
        complianceEvidence: {
          division: 'Gas',
          transformationOption: 'h2_ready',
          dataQualityStatus: null,
          investmentPath: null,
          decommissionPath: null,
          owner: null,
          nextAction: null,
        },
        missingEvidence: [
          { missingDataPoint: 'division' },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_division'],
        },
      });

      expect(formatted).toContain('Gate Status: needs_division');
      expect(formatted).toContain('Transformation Stage: needs_evidence');
      expect(formatted).toContain('Readiness: 0.1');
      expect(formatted).toContain('Sparte: Gas');
      expect(formatted).toContain('Leading Gap: division');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.heatAssetTariffSteeringStatus is dossier-safe and formats heat steering facts', () => {
      const rule = getRule('dashboard-api.heatAssetTariffSteeringStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Fernwaerme Asset Tarif Steuerung portfolio=portfolio-146 laden'
        )
      ).toEqual({
        heatPortfolioId: 'portfolio-146',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_division',
        gateStatus: 'needs_evidence',
        readinessScore: 0.1,
        requestContext: {
          heatPortfolioId: 'portfolio-146',
        },
        complianceContext: {
          heatPortfolioId: 'portfolio-146',
        },
        complianceEvidence: {
          division: 'Fernwärme',
          technicalMeasures: null,
          tariffImpactStatus: null,
          regulatoryUncertainty: null,
          fundingStatus: null,
          customerImpact: null,
          investmentPriority: null,
          owner: null,
          nextDecisionGate: null,
          blockedFollowUpAction: null,
        },
        missingEvidence: [
          { missingDataPoint: 'division' },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_division'],
        },
      });

      expect(formatted).toContain('Gate Status: needs_division');
      expect(formatted).toContain('Transformation Stage: needs_evidence');
      expect(formatted).toContain('Readiness: 0.1');
      expect(formatted).toContain('Sparte: Fernwärme');
      expect(formatted).toContain('Leading Gap: division');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.clsDigitalTwinComplianceGateStatus is dossier-safe and formats compliance facts', () => {
      const rule = getRule('dashboard-api.clsDigitalTwinComplianceGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte CLS Digital Twin Compliance procurement=proc-197 vendor=vendor-1 systemPurpose=grid-twin laden'
        )
      ).toEqual({
        procurementId: 'proc-197',
        vendorId: 'vendor-1',
        systemPurpose: 'grid-twin',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_rbac_decision',
        readinessScore: 0.53,
        requestContext: {
          procurementId: 'proc-197',
        },
        gateContext: {
          procurementId: 'proc-197',
          vendorId: 'vendor-1',
          systemPurpose: 'grid-twin',
          digitalTwinScope: 'lv-grid',
          clsInterfaceScope: 'taf7-status',
        },
        complianceEvidence: {
          dataFlowMap: 'dfm:197',
          avvStatus: 'available',
          ndaStatus: 'available',
          worksCouncilStatus: 'pending',
          dsfaStatus: 'screening',
          billingModuleImpact: 'review-only',
          regulatoryEvidenceStatus: 'bnetza-ref',
        },
        missingEvidence: [
          { missingDataPoint: 'rbac_refs' },
        ],
        sourceActions: {
          notCalled: ['procurement.approve'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_rbac_decision'],
        },
      });

      expect(formatted).toContain('CLS Compliance Status: needs_rbac_decision');
      expect(formatted).toContain('Readiness: 0.53');
      expect(formatted).toContain('Procurement: proc-197');
      expect(formatted).toContain('Vendor: vendor-1');
      expect(formatted).toContain('System Purpose: grid-twin');
      expect(formatted).toContain('Twin Scope: lv-grid');
      expect(formatted).toContain('CLS Scope: taf7-status');
      expect(formatted).toContain('Data Flow: dfm:197');
      expect(formatted).toContain('AVV: available');
      expect(formatted).toContain('DSFA: screening');
      expect(formatted).toContain('Leading Gap: rbac_refs');
      expect(formatted).toContain('Side-Effect Guard: procurement.approve');
    });

    it('dashboard-api.legacyControlTechnologyTransitionStatus is dossier-safe and formats transition facts', () => {
      const rule = getRule('dashboard-api.legacyControlTechnologyTransitionStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Rundsteuertechnik Uebergang assetGroup=legacy-175 asset=asset-175 steuertechnik=rst-gruppe laden'
        )
      ).toEqual({
        assetGroupId: 'legacy-175',
        assetId: 'asset-175',
        controlTechnology: 'rst-gruppe',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_testability_evidence',
        controlReadiness: 'limited',
        transitionStatus: 'legacy_operational',
        readinessScore: 0.5,
        requestContext: {
          assetGroupId: 'legacy-175',
        },
        transitionContext: {
          assetGroupId: 'legacy-175',
          assetId: 'asset-175',
          powerClass: 'lt-100kw',
          controlTechnology: 'rundsteuertechnik',
        },
        transitionEvidence: {
          feedbackCapability: 'available',
          switchingRisk: 'medium',
          testFeasibility: 'maintenance-window',
          testStatus: 'open',
          nonExecutionReason: 'not-yet-scheduled',
          targetTechnology: 'steuerbox-cls',
          migrationRoadmap: 'roadmap-2026-q4',
        },
        missingEvidence: [
          { missingDataPoint: 'owner_next_action' },
        ],
        sourceActions: {
          notCalled: ['grid-operations.executeControl'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_testability_evidence'],
        },
      });

      expect(formatted).toContain('Legacy Control Status: needs_testability_evidence');
      expect(formatted).toContain('Control Readiness: limited');
      expect(formatted).toContain('Transition: legacy_operational');
      expect(formatted).toContain('Asset Group: legacy-175');
      expect(formatted).toContain('Asset: asset-175');
      expect(formatted).toContain('Power Class: lt-100kw');
      expect(formatted).toContain('Control Technology: rundsteuertechnik');
      expect(formatted).toContain('Feedback: available');
      expect(formatted).toContain('Test Feasibility: maintenance-window');
      expect(formatted).toContain('Leading Gap: owner_next_action');
      expect(formatted).toContain('Side-Effect Guard: grid-operations.executeControl');
    });

    it('dashboard-api.controllabilitySubmissionCockpitStatus is dossier-safe and formats submission facts', () => {
      const rule = getRule('dashboard-api.controllabilitySubmissionCockpitStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Steuerbarkeitscheck Abgabe Cockpit submission=submission-176 koordinator=netzbetrieb handover=submitted laden'
        )
      ).toEqual({
        submissionId: 'submission-176',
        coordinator: 'netzbetrieb',
        handoverDecision: 'submitted',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_data_reconciliation',
        submissionReadiness: 'needs_data_reconciliation',
        handoverStatus: 'carry_over',
        readinessScore: 0.5,
        requestContext: {
          submissionId: 'submission-176',
          submissionDeadline: '2026-07-01',
          coordinator: 'Netzbetrieb',
        },
        submissionContext: {
          submissionId: 'submission-176',
          submissionDeadline: '2026-07-01',
          coordinator: 'Netzbetrieb',
        },
        submissionEvidence: {
          sourceList: ['vdmi:176'],
          dataReconciliationStatus: 'open',
          reasonCatalog: ['non-execution-reason'],
          assetGroupStatuses: ['wp-open'],
          openMeasures: ['measure-1'],
          handoverOwner: 'Assetmanagement',
        },
        missingEvidence: [
          { missingDataPoint: 'handover_decision' },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_data_reconciliation'],
        },
      });

      expect(formatted).toContain('Submission Status: needs_data_reconciliation');
      expect(formatted).toContain('Handover: carry_over');
      expect(formatted).toContain('Submission: submission-176');
      expect(formatted).toContain('Deadline: 2026-07-01');
      expect(formatted).toContain('Coordinator: Netzbetrieb');
      expect(formatted).toContain('Data Reconciliation: open');
      expect(formatted).toContain('Source: vdmi:176');
      expect(formatted).toContain('Reason: non-execution-reason');
      expect(formatted).toContain('Asset Group: wp-open');
      expect(formatted).toContain('Leading Gap: handover_decision');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.crisisDecisionRoutineStatus is dossier-safe and formats management routine facts', () => {
      const rule = getRule('dashboard-api.crisisDecisionRoutineStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Krisenmodus Entscheidungsroutine thema=netzstress owner=netzbetrieb gate=gf-lage laden'
        )
      ).toEqual({
        topic: 'netzstress',
        owner: 'netzbetrieb',
        nextGate: 'gf-lage',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_finance_impact',
        decisionReadiness: 'needs_finance_impact',
        readinessScore: 0.7,
        requestContext: {
          topic: 'Netzstress',
          owner: 'Netzbetrieb',
          nextGate: 'GF-Lage',
        },
        routineContext: {
          topic: 'Netzstress',
          owner: 'Netzbetrieb',
          nextGate: 'GF-Lage',
        },
        routineEvidence: {
          serviceImpact: 'Leitwarte unter Druck',
          populationImpact: 'Waermepumpen-Kundengruppe',
          financeImpact: 'unknown',
          knowledgeState: 'verified facts available',
          requiredMeasures: ['hotline priorisieren'],
          blockedFollowUp: ['budget commitment'],
        },
        missingEvidence: [
          { missingDataPoint: 'finance_impact' },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_finance_impact'],
        },
      });

      expect(formatted).toContain('Decision Routine: needs_finance_impact');
      expect(formatted).toContain('Topic: Netzstress');
      expect(formatted).toContain('Owner: Netzbetrieb');
      expect(formatted).toContain('Next Gate: GF-Lage');
      expect(formatted).toContain('Service Impact: Leitwarte unter Druck');
      expect(formatted).toContain('Finance: unknown');
      expect(formatted).toContain('Measure: hotline priorisieren');
      expect(formatted).toContain('Leading Gap: finance_impact');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.investmentCommitteeSteeringCardsStatus is dossier-safe and formats committee-card facts', () => {
      const rule = getRule('dashboard-api.investmentCommitteeSteeringCardsStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Investmittel Gremiensteuerung investment=inv-182 asset=asset-182 owner=assetmanagement laden'
        )
      ).toEqual({
        investmentItemId: 'inv-182',
        assetId: 'asset-182',
        owner: 'assetmanagement',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_evidence',
        readinessScore: 0.75,
        requestContext: {
          investmentItemId: 'inv-182',
          assetId: 'asset-182',
          owner: 'Assetmanagement',
          committeeWindow: '2026-Q3',
        },
        cardContext: {
          investmentItemId: 'inv-182',
          assetId: 'asset-182',
          projectId: 'proj-182',
        },
        committeeContext: {
          reviewStatus: 'technical-review-open',
          evidenceStatus: 'missing',
          committeeWindow: '2026-Q3',
          owner: 'Assetmanagement',
          blockedFollowUpAction: 'committee-release',
        },
        missingEvidence: [
          { missingDataPoint: 'source_refs' },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_evidence'],
        },
      });

      expect(formatted).toContain('Committee Card: needs_evidence');
      expect(formatted).toContain('Investment Item: inv-182');
      expect(formatted).toContain('Asset: asset-182');
      expect(formatted).toContain('Project: proj-182');
      expect(formatted).toContain('Review: technical-review-open');
      expect(formatted).toContain('Evidence: missing');
      expect(formatted).toContain('Committee Window: 2026-Q3');
      expect(formatted).toContain('Owner: Assetmanagement');
      expect(formatted).toContain('Blocked Follow-up: committee-release');
      expect(formatted).toContain('Leading Gap: source_refs');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('re4de-variable-grid-fee.getEvidence is dossier-safe and formats calculation evidence', () => {
      const rule = getRule('re4de-variable-grid-fee.getEvidence');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams([], 'Bitte Evidenz fuer re4de-vgf:123e4567-e89b-12d3-a456-426614174000 laden')
      ).toEqual({ calculationId: 're4de-vgf:123e4567-e89b-12d3-a456-426614174000' });

      const formatted = rule.formatEvidence({
        tariffSheetId: 'vgf-sheet-001',
        tariffSheetVersion: '1.0.0',
        gridAreaId: 'grid-area-demo',
        totalKwh: 12.3456,
        variableFeeEur: 1.23,
        basePriceEur: 0.04,
        totalEur: 1.27,
        section14aApplied: true,
        calculatedAt: '2026-06-19T09:00:00.000Z',
      });

      expect(formatted).toContain('Tariff Sheet: vgf-sheet-001');
      expect(formatted).toContain('Energy: 12.346 kWh');
      expect(formatted).toContain('Total: 1.27 EUR');
      expect(formatted).toContain('Section14a Context: true');
    });

    it('battery-redispatch-special-gate.getStatus is dossier-safe and formats gate evidence', () => {
      const rule = getRule('battery-redispatch-special-gate.getStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams([], 'Bitte Speicher-Sondergate brs:123e4567-e89b-12d3-a456-426614174000 laden')
      ).toEqual({ gateId: 'brs:123e4567-e89b-12d3-a456-426614174000' });

      const formatted = rule.formatEvidence({
        gateId: 'brs:test',
        assetId: 'bess-001',
        evidenceStatus: 'ready',
        answerFacts: {
          maloDecision: 'separate-injection-and-withdrawal-malo',
          injectionDirection: 'injection',
          withdrawalDirection: 'withdrawal',
          controllabilityDirection: 'bidirectional',
          testCallProofPresent: true,
          productionProofConfirmed: true,
          settlementReadiness: 'ready',
          clearingDecision: 'approved',
          billingDecision: 'approved',
        },
        recommendedNextDecision: 'Proceed to Redispatch storage clearing review',
      });

      expect(formatted).toContain('Evidence Status: ready');
      expect(formatted).toContain('Asset: bess-001');
      expect(formatted).toContain('Injection: injection');
      expect(formatted).toContain('Clearing: approved');
    });

    it('battery-redispatch-special-gate.getStatus formats not-found message as fallback evidence', () => {
      const rule = getRule('battery-redispatch-special-gate.getStatus');
      expect(rule.formatEvidence({ found: false, message: 'No battery gate evidence yet' })).toBe(
        'No battery gate evidence yet'
      );
    });

    it('flexibility-conductor-role-model.getStatus is dossier-safe and formats role evidence', () => {
      const rule = getRule('flexibility-conductor-role-model.getStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams([], 'Bitte Rollenmodell flex-role:process-001 fuer Flexibilitaetsdirigent laden')
      ).toEqual({ processId: 'flex-role:process-001' });

      const formatted = rule.formatEvidence({
        processId: 'flex-role:process-001',
        roleModelId: 'fcrm:test',
        evidenceStatus: 'ready',
        answerFacts: {
          flexAssetScope: { scopeId: 'scope-low-voltage-flex-001' },
          roleCoverage: {
            forecastIntake: { accountable: 'Netzbetrieb' },
            controlCommandPolicy: { accountable: 'Leitwarte' },
          },
          controlCommandBoundary: 'No automatic control commands from dossier hydration',
          softwareMonitoringOwner: 'OT Plattformbetrieb',
          commercialValueOwner: 'Assetmanagement/Controlling',
          evaluatedAt: '2026-06-19T11:30:00.000Z',
        },
      });

      expect(formatted).toContain('Evidence Status: ready');
      expect(formatted).toContain('Process: flex-role:process-001');
      expect(formatted).toContain('Control Policy Owner: Leitwarte');
      expect(formatted).toContain('Monitoring Owner: OT Plattformbetrieb');
    });

    it('flexibility-conductor-role-model.getStatus formats not-found message as fallback evidence', () => {
      const rule = getRule('flexibility-conductor-role-model.getStatus');
      expect(rule.formatEvidence({ found: false, message: 'No role-model evidence yet' })).toBe(
        'No role-model evidence yet'
      );
    });

    it('knowledge-continuity-governance-gate.getStatus is dossier-safe and formats governance evidence', () => {
      const rule = getRule('knowledge-continuity-governance-gate.getStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams([], 'Bitte Wissenssicherung knowledge-process:dispatch-001 laden')
      ).toEqual({ processId: 'knowledge-process:dispatch-001' });

      const formatted = rule.formatEvidence({
        criticalProcessId: 'knowledge-process:dispatch-001',
        processName: 'Redispatch Rollenwechsel Leitwarte',
        gateId: 'kcgg:test',
        evidenceStatus: 'ready',
        readinessScore: 1,
        answerFacts: {
          mainFolderRef: 'sharepoint://netzprozesse/redispatch',
          permissionOwner: 'IT Berechtigungsmanagement',
          adminOwner: 'M365 Plattformbetrieb',
          guestAccessPolicy: 'Quartalspruefung',
          handoverDocumentRef: 'sharepoint://netzprozesse/redispatch/uebergabe.md',
          chatMailBoundary: 'Teams volatil, Entscheidungen in Hauptordner',
          retentionPolicy: '10 Jahre',
          deletionDeadline: '2036-12-31',
          itApprovalStatus: 'approved',
          roleChangeRisk: 'medium',
          evaluatedAt: '2026-06-19T13:30:00.000Z',
        },
      });

      expect(formatted).toContain('Evidence Status: ready');
      expect(formatted).toContain('Process: knowledge-process:dispatch-001');
      expect(formatted).toContain('Permission Owner: IT Berechtigungsmanagement');
      expect(formatted).toContain('IT Approval: approved');
    });

    it('knowledge-continuity-governance-gate.getStatus formats not-found message as fallback evidence', () => {
      const rule = getRule('knowledge-continuity-governance-gate.getStatus');
      expect(rule.formatEvidence({ found: false, message: 'No governance evidence yet' })).toBe(
        'No governance evidence yet'
      );
    });

    it('investment-maturity-off-balance-gate.getStatus is dossier-safe and formats gate evidence', () => {
      const rule = getRule('investment-maturity-off-balance-gate.getStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams([], 'Bitte investment-case:process-001 Off-Balance Gate laden')
      ).toEqual({ investmentCaseId: 'investment-case:process-001' });

      const formatted = rule.formatEvidence({
        investmentCaseId: 'investment-case:process-001',
        gateId: 'imob:test',
        evidenceStatus: 'ready_with_warnings',
        answerFacts: {
          maturityLevel: 'gate-3-investment-ready',
          processQualityScore: 0.86,
          additionalFinancingCostEur: 125000,
          regulatoryReturnHypothesis: { summary: 'Return headroom remains a hypothesis' },
          assetRiskReference: { referenceId: 'asset-risk:grid-001' },
          isoRiskReference: { referenceId: 'iso-risk:control-001' },
          decisionForum: { name: 'Investitionsausschuss Netz' },
          evaluatedAt: '2026-06-19T12:30:00.000Z',
        },
      });

      expect(formatted).toContain('Evidence Status: ready_with_warnings');
      expect(formatted).toContain('Investment Case: investment-case:process-001');
      expect(formatted).toContain('Process Quality: 0.86');
      expect(formatted).toContain('Financing Cost: 125000.00 EUR');
      expect(formatted).toContain('Decision Forum: Investitionsausschuss Netz');
    });

    it('investment-maturity-off-balance-gate.getStatus formats not-found message as fallback evidence', () => {
      const rule = getRule('investment-maturity-off-balance-gate.getStatus');
      expect(rule.formatEvidence({ found: false, message: 'No off-balance gate evidence yet' })).toBe(
        'No off-balance gate evidence yet'
      );
    });

    it('gas-capacity-order-revision-gate.getStatus is dossier-safe and formats revision evidence', () => {
      const rule = getRule('gas-capacity-order-revision-gate.getStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams([], 'Bitte Gaskapazitaetsbestellung 2028 fuer gas-vnb:stadtwerk-a laden')
      ).toEqual({ orderYear: '2028', gridOperatorId: 'gas-vnb:stadtwerk-a' });

      const formatted = rule.formatEvidence({
        revisionId: 'gcorg:test',
        orderYear: 2028,
        gridOperatorId: 'gas-vnb:stadtwerk-a',
        toolValueMwhPerDay: 1250,
        securityMarkupPercent: 8,
        revisedCapacityHypothesisMwhPerDay: 1350,
        evidenceStatus: 'ready',
        readinessScore: 1,
        answerFacts: {
          coldYearScenario: { summary: 'Kaltjahr P95 hebt Spitzenbedarf' },
          industrialReboundScenario: { summary: 'RLM-Rebound plausibilisiert' },
          tariffImpact: { summary: 'Entgeltwirkung im Zielkorridor' },
          pressureMaintenanceFlexibility: { summary: 'Wartungsfenster vermeidet Winterspitze' },
          decisionForum: 'Gasnetz Jahresbestellrunde',
          decisionStatus: 'revision_evidence_ready',
          evaluatedAt: '2026-06-19T14:45:00.000Z',
        },
      });

      expect(formatted).toContain('Evidence Status: ready');
      expect(formatted).toContain('Order Year: 2028');
      expect(formatted).toContain('Tool Value: 1250.000 MWh/d');
      expect(formatted).toContain('Revision Hypothesis: 1350.000 MWh/d');
      expect(formatted).toContain('Decision Forum: Gasnetz Jahresbestellrunde');
    });

    it('gas-capacity-order-revision-gate.getStatus formats not-found message as fallback evidence', () => {
      const rule = getRule('gas-capacity-order-revision-gate.getStatus');
      expect(rule.formatEvidence({ found: false, message: 'No gas revision evidence yet' })).toBe(
        'No gas revision evidence yet'
      );
    });

    it('listSummary formats empty arrays as explicit negative evidence', () => {
      const rule = compileRule(makeRule({
        id: 'test.emptyList',
        action: 'test.emptyList',
        paramTemplate: {},
        formatter: {
          type: 'listSummary',
          arrayPaths: ['items'],
          itemLabelField: 'name',
          countLabel: 'Testeintraege',
        },
      }));

      expect(rule.formatEvidence({ items: [] })).toBe('Testeintraege: 0');
    });

    it('listSummary supports a custom emptyMessage', () => {
      const rule = compileRule(makeRule({
        id: 'test.emptyListMessage',
        action: 'test.emptyListMessage',
        paramTemplate: {},
        formatter: {
          type: 'listSummary',
          arrayPaths: ['items'],
          itemLabelField: 'name',
          countLabel: 'Testeintraege',
          emptyMessage: 'Keine aktiven Testeintraege gefunden',
        },
      }));

      expect(rule.formatEvidence({ items: [] })).toBe('Keine aktiven Testeintraege gefunden');
    });

    it('listSummary still returns null when no configured array path exists', () => {
      const rule = compileRule(makeRule({
        id: 'test.missingList',
        action: 'test.missingList',
        paramTemplate: {},
        formatter: {
          type: 'listSummary',
          arrayPaths: ['items'],
          itemLabelField: 'name',
          countLabel: 'Testeintraege',
        },
      }));

      expect(rule.formatEvidence({ data: [] })).toBeNull();
    });

    it('gas-storage.countryStorage formats nested storage data', () => {
      const rule = getRule('gas-storage.countryStorage');
      const formatted = rule.formatEvidence({
        data: {
          country: 'DE',
          storage: {
            fillPercentage: 88.5,
            gasInStorage: 95.2,
            trend: 'steigend',
          },
        },
      });
      expect(formatted).toContain('Fuellstand: 88.5 %');
      expect(formatted).toContain('Gas im Speicher: 95.2 TWh');
      expect(formatted).toContain('Trend: steigend');
    });

    it('entsoe.loadForecast formats statistics', () => {
      const rule = getRule('entsoe.loadForecast');
      const formatted = rule.formatEvidence({
        data: {
          region: 'Germany',
          statistics: { avgLoadMW: 55000, maxLoadMW: 72000, minLoadMW: 38000 },
          dataPoints: new Array(24).fill({ loadMW: 55000 }),
        },
      });
      expect(formatted).toContain('Last Durchschnitt: 55000.0');
      expect(formatted).toContain('Datenpunkte: 24');
    });

    it('energy-market.prices formats price array', () => {
      const rule = getRule('energy-market.prices');
      const formatted = rule.formatEvidence({
        data: {
          prices: [
            { priceEURMWh: 80 },
            { priceEURMWh: 90 },
            { priceEURMWh: 100 },
          ],
          unit: 'EUR/MWh',
          market: 'day-ahead',
        },
      });
      expect(formatted).toContain('Mittel: 90.00 EUR/MWh');
      expect(formatted).toContain('Bandbreite:');
      expect(formatted).toContain('3 Stunden');
    });

    it('energy-market.prices unconditional fallback when no prices', () => {
      const rule = getRule('energy-market.prices');
      const formatted = rule.formatEvidence({ data: { market: 'day-ahead', region: 'DE' } });
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted).toContain('day-ahead');
    });

    it('residual-load.netResidualLoad formats kpis', () => {
      const rule = getRule('residual-load.netResidualLoad');
      const formatted = rule.formatEvidence({
        summary: {
          kpis: { avgResidualLoadMW: 350.5, peakResidualLoadMW: 480.0 },
          region: 'Rhein-Neckar',
          dataPoints: 24,
        },
      });
      expect(formatted).toContain('Residuallast Mittel: 350.5 MW');
      expect(formatted).toContain('Peak: 480.0 MW');
    });

    it('residual-load.netResidualLoad falls back to forecast array when kpis absent', () => {
      const rule = getRule('residual-load.netResidualLoad');
      // Do NOT include summary.region here: the arrayFallback condition is "firstFieldNull",
      // so any matched field (including region) would suppress the fallback.
      const formatted = rule.formatEvidence({
        forecast: [
          { residualLoadMW: 300 },
          { residualLoadMW: 400 },
          { residualLoadMW: 500 },
        ],
      });
      expect(formatted).toContain('Residuallast Mittel: 400.0 MW');
    });

    it('investment-data-review-queue-status formats review evidence', () => {
      const rule = getRule('dashboard-api.investmentDataReviewQueueStatus');
      const formatted = rule.formatEvidence({
        status: 'review_ready',
        readinessScore: 1,
        reviewContext: {
          sourceId: 'datasource-171',
          assetRef: 'asset-171',
          qualityStatus: 'quality-reviewed',
          owner: 'Assetmanagement',
          committeeWindow: '2026-Q3',
          blockedDecision: 'CAPEX-Priorisierung',
          reviewStatus: 'review-complete',
        },
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: review_ready'],
        },
      });

      expect(formatted).toContain('Review Queue: review_ready');
      expect(formatted).toContain('Source: datasource-171');
      expect(formatted).toContain('Owner: Assetmanagement');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('gas-infrastructure-risk-governance-status formats risk governance evidence', () => {
      const rule = getRule('dashboard-api.gasInfrastructureRiskGovernanceStatus');
      const formatted = rule.formatEvidence({
        status: 'ready_for_risk_decision',
        readinessScore: 1,
        riskContext: {
          technicalFact: 'Hochdruckleitung HD-17 Druckhaltung auffaellig',
          impactArea: 'Netzkopplung West',
          owner: 'Assetmanagement Gas',
          nextDecisionWindow: 'Risikogremium 2026-Q3',
        },
        riskEvidence: {
          probability: 'medium',
          criticality: 'high',
          riskRegisterDecision: 'formal risk register',
        },
        sourceActions: {
          notCalled: ['gas-risk-register.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: ready_for_risk_decision'],
        },
      });

      expect(formatted).toContain('Gas Risk: ready_for_risk_decision');
      expect(formatted).toContain('Technical Fact: Hochdruckleitung HD-17');
      expect(formatted).toContain('Owner: Assetmanagement Gas');
      expect(formatted).toContain('Side-Effect Guard: gas-risk-register.create');
    });

    it('metering-rollout-process-indicator-status formats process evidence', () => {
      const rule = getRule('dashboard-api.meteringRolloutProcessIndicatorStatus');
      const formatted = rule.formatEvidence({
        status: 'process_indicator_ready',
        readinessScore: 1,
        indicatorContext: {
          division: 'Strom/MSB',
          sourceType: 'administrative-monthly-statistic',
          owner: 'Messstellenbetrieb',
          nextControlStep: 'Rollout-Steuerkreis 2026-Q3',
        },
        processEvidence: {
          targetCount: 1000,
          actualCount: 940,
          backlogCount: 60,
          backlogRate: 0.06,
          dataQualityStatus: 'quality-reviewed',
          contractorLoad: 'normal',
        },
        sourceActions: {
          notCalled: ['datasource-cache.query'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: process_indicator_ready'],
        },
      });

      expect(formatted).toContain('Metering Rollout: process_indicator_ready');
      expect(formatted).toContain('Division: Strom/MSB');
      expect(formatted).toContain('Backlog: 60');
      expect(formatted).toContain('Side-Effect Guard: datasource-cache.query');
    });

    it('heat-transformation-line-asset-model-status formats process evidence', () => {
      const rule = getRule('dashboard-api.heatTransformationLineAssetModelStatus');
      const formatted = rule.formatEvidence({
        status: 'ready_for_transformation_decision',
        readinessScore: 1,
        modelContext: {
          lineAssetId: 'segment-174',
          division: 'Wärme/Stadtmitte',
          owner: 'Assetmanagement Waerme',
          nextDecision: 'Waermeplanung-Ausschuss-2026',
        },
        lineEvidence: {
          geometryRef: 'gis:poly-line-174',
          connectedPointAssetIds: ['point-asset-1', 'point-asset-2'],
          networkCalculationRef: 'calc:hydraulic-174',
          dataQualityStatus: 'reviewed',
          transformationStatus: 'repurpose',
          futureOption: 'district_heating_network',
          investmentNeed: 1500000,
        },
        sourceActions: {
          notCalled: ['znp.createProject'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: ready_for_transformation_decision'],
        },
      });

      expect(formatted).toContain('Heat Line Asset: ready_for_transformation_decision');
      expect(formatted).toContain('Division: Wärme/Stadtmitte');
      expect(formatted).toContain('Line Asset ID: segment-174');
      expect(formatted).toContain('Side-Effect Guard: znp.createProject');
    });
  });

  // ── Safety validation ─────────────────────────────────────────────────────

  describe('validateRule', () => {
    it('accepts a valid safe read rule', () => {
      const r = validateRule(makeRule());
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it('rejects readOnly: false', () => {
      const r = validateRule(makeRule({ safety: { readOnly: false, allowsMutation: false, hitlRequired: false } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === 'safety.readOnly')).toBe(true);
    });

    it('rejects allowsMutation: true', () => {
      const r = validateRule(makeRule({ safety: { readOnly: true, allowsMutation: true, hitlRequired: false } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === 'safety.allowsMutation')).toBe(true);
    });

    it('rejects hitlRequired: true', () => {
      const r = validateRule(makeRule({ safety: { readOnly: true, allowsMutation: false, hitlRequired: true } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === 'safety.hitlRequired')).toBe(true);
    });

    it('rejects blocked action prefix (delete)', () => {
      const r = validateRule(makeRule({ action: 'some-service.delete' }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === 'action')).toBe(true);
    });

    it('rejects blocked service prefix (hitl)', () => {
      const r = validateRule(makeRule({ action: 'hitl.query' }));
      expect(r.valid).toBe(false);
    });

    it('rejects blocked service prefix (webhooks)', () => {
      const r = validateRule(makeRule({ action: 'webhooks.list' }));
      expect(r.valid).toBe(false);
    });

    it('rejects unknown formatter type', () => {
      const r = validateRule(makeRule({ formatter: { type: 'unknownType123' } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === 'formatter.type')).toBe(true);
    });

    it('rejects unknown extractor type', () => {
      const r = validateRule(makeRule({ paramTemplate: { foo: { extractor: 'nonExistentExtractor123' } } }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field.startsWith('paramTemplate'))).toBe(true);
    });

    it('rejects unsafe regex in regexCaptureSafe extractor', () => {
      const r = validateRule(makeRule({
        paramTemplate: {
          value: { extractor: 'regexCaptureSafe', config: { pattern: '.*' } },
        },
      }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field.includes('pattern'))).toBe(true);
    });

    it('rejects timeoutMs above 30000', () => {
      const r = validateRule(makeRule({ timeoutMs: 99999 }));
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.field === 'timeoutMs')).toBe(true);
    });

    it('warns when no formatter', () => {
      const r = validateRule(makeRule({ formatter: null }));
      expect(r.warnings.some((w) => w.field === 'formatter')).toBe(true);
    });

    it('KNOWN_EXTRACTORS includes all expected types', () => {
      const expected = [
        'constant', 'dateRangeFromPrompt', 'locationFromPromptOrFacts',
        'cityFromPromptOrFacts', 'postalCodeFromPromptOrFacts', 'regionFromPromptOrDefault',
        'knownContextPath', 'userFactByType', 'regexCaptureSafe',
      ];
      for (const e of expected) {
        expect(KNOWN_EXTRACTORS.has(e)).toBe(true);
      }
    });

    it('KNOWN_FORMATTERS includes all expected types', () => {
      const expected = ['fieldSummary', 'timeseriesStats', 'priceArrayStats', 'listSummary', 'statusSummary', 'scalarValue', 'noDataMessage'];
      for (const f of expected) {
        expect(KNOWN_FORMATTERS.has(f)).toBe(true);
      }
    });
  });

  // ── isBlockedAction ───────────────────────────────────────────────────────

  describe('isBlockedAction', () => {
    it('blocks .create verbs', () => expect(isBlockedAction('foo.create')).toBe(true));
    it('blocks .delete verbs', () => expect(isBlockedAction('foo.delete')).toBe(true));
    it('blocks .update verbs', () => expect(isBlockedAction('foo.update')).toBe(true));
    it('blocks hitl service', () => expect(isBlockedAction('hitl.list')).toBe(true));
    it('blocks webhooks service', () => expect(isBlockedAction('webhooks.trigger')).toBe(true));
    it('allows energy-market.co2Intensity', () => expect(isBlockedAction('energy-market.co2Intensity')).toBe(false));
    it('allows entsoe.loadForecast', () => expect(isBlockedAction('entsoe.loadForecast')).toBe(false));
    it('allows gas-storage.countryStorage', () => expect(isBlockedAction('gas-storage.countryStorage')).toBe(false));
  });

  // ── compileRule safety gate includes isBlockedAction ─────────────────────

  describe('compileRule blocked-action gate', () => {
    it('rejects a rule whose action matches a blocked verb', () => {
      const rule = makeRule({ id: 'my-svc.delete', action: 'my-svc.delete' });
      expect(compileRule(rule)).toBeNull();
    });

    it('rejects a rule from a blocked service prefix', () => {
      const rule = makeRule({ id: 'hitl.query', action: 'hitl.query' });
      expect(compileRule(rule)).toBeNull();
    });

    it('accepts a safe read action through compileRule', () => {
      const rule = makeRule();
      expect(compileRule(rule)).not.toBeNull();
    });
  });

  // ── isSafetyRejectedAction ────────────────────────────────────────────────

  describe('isSafetyRejectedAction', () => {
    it('returns false for an unknown action (no rule defined)', () => {
      expect(isSafetyRejectedAction('nonexistent.xyz')).toBe(false);
    });

    it('returns false for a valid compiled rule', () => {
      expect(isSafetyRejectedAction('energy-market.co2Intensity')).toBe(false);
    });

    it('returns true for a runtime rule with blocked action verb', () => {
      const unsafeRule = makeRule({ id: 'foo.delete', action: 'foo.delete' });
      setRuntimeRule('foo.delete', unsafeRule);
      expect(isSafetyRejectedAction('foo.delete')).toBe(true);
      removeRuntimeRule('foo.delete');
    });

    it('returns true for a runtime rule with readOnly:false', () => {
      const unsafeRule = makeRule({
        id: 'my-svc.getData',
        action: 'my-svc.getData',
        safety: { readOnly: false, allowsMutation: false, hitlRequired: false },
      });
      setRuntimeRule('my-svc.getData', unsafeRule);
      expect(isSafetyRejectedAction('my-svc.getData')).toBe(true);
      removeRuntimeRule('my-svc.getData');
    });

    it('returns false (not safety-rejected) for a disabled rule', () => {
      const disabledRule = makeRule({ id: 'disabled.action', action: 'disabled.action', enabled: false });
      setRuntimeRule('disabled.action', disabledRule);
      // disabled rules are not compiled but also not "safety-rejected"
      expect(isSafetyRejectedAction('disabled.action')).toBe(false);
      removeRuntimeRule('disabled.action');
    });
  });

  // ── Runtime overlay ───────────────────────────────────────────────────────

  describe('runtime overlay', () => {
    it('runtime rule overrides static rule', () => {
      const overrideRule = {
        id: 'energy-market.co2Intensity',
        action: 'energy-market.co2Intensity',
        label: 'Override Label',
        enabled: true,
        safety: { readOnly: true, allowsMutation: false, hitlRequired: false },
        paramTemplate: { location: { extractor: 'locationFromPromptOrFacts', required: true } },
        formatter: { type: 'fieldSummary', fields: [{ paths: ['value'], label: 'Test' }] },
        evidenceQuality: 'validated',
        timeoutMs: 5000,
      };
      setRuntimeRule('energy-market.co2Intensity', overrideRule);
      const rule = getRule('energy-market.co2Intensity');
      expect(rule.label).toBe('Override Label');
      removeRuntimeRule('energy-market.co2Intensity');
    });

    it('getRule returns null for unknown action', () => {
      expect(getRule('nonexistent.action')).toBeNull();
    });

    it('removeRuntimeRule falls back to static rule', () => {
      const overrideRule = makeRule({ action: 'energy-market.co2Intensity', id: 'energy-market.co2Intensity', label: 'tmp' });
      setRuntimeRule('energy-market.co2Intensity', overrideRule);
      removeRuntimeRule('energy-market.co2Intensity');
      const rule = getRule('energy-market.co2Intensity');
      expect(rule.label).not.toBe('tmp');
    });

    it('runtime-only rule (not in static) is returned by getRule', () => {
      const runtimeRule = makeRule({ id: 'my-service.customQuery', action: 'my-service.customQuery', label: 'Custom Query' });
      setRuntimeRule('my-service.customQuery', runtimeRule);
      const rule = getRule('my-service.customQuery');
      expect(rule).not.toBeNull();
      expect(rule.label).toBe('Custom Query');
      removeRuntimeRule('my-service.customQuery');
    });

    it('disabled rule is not returned by getRule', () => {
      const disabledRule = makeRule({ id: 'disabled.action', action: 'disabled.action', enabled: false });
      setRuntimeRule('disabled.action', disabledRule);
      expect(getRule('disabled.action')).toBeNull();
      removeRuntimeRule('disabled.action');
    });
  });
});

// ── Management service tests ──────────────────────────────────────────────────

describe('dossier-hydration-management.service', () => {
  let broker;

  beforeAll(async () => {
    broker = makeBroker();
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    _resetRegistry();
  });

  beforeEach(() => _resetRegistry());

  // ── createDraft ────────────────────────────────────────────────────────

  describe('createDraft', () => {
    it('creates a valid draft and returns draftId', async () => {
      const result = await broker.call('dossier-hydration.createDraft', { rule: makeRule() });
      expect(result.success).toBe(true);
      expect(result.draftId).toMatch(/^dh_/);
      expect(result.validationStatus).toBe('valid');
    });

    it('rejects mutating action', async () => {
      const rule = makeRule({ action: 'foo.delete', id: 'foo.delete' });
      const result = await broker.call('dossier-hydration.createDraft', { rule });
      expect(result.validationStatus).toBe('invalid');
      expect(result.validationErrors.some((e) => e.field === 'action')).toBe(true);
    });

    it('rejects allowsMutation: true', async () => {
      const rule = makeRule({ safety: { readOnly: true, allowsMutation: true, hitlRequired: false } });
      const result = await broker.call('dossier-hydration.createDraft', { rule });
      expect(result.validationStatus).toBe('invalid');
    });

    it('rejects unknown formatter type', async () => {
      const rule = makeRule({ formatter: { type: 'nonExistentFormatter' } });
      const result = await broker.call('dossier-hydration.createDraft', { rule });
      expect(result.validationStatus).toBe('invalid');
    });
  });

  // ── test (dry-run) ────────────────────────────────────────────────────

  describe('test', () => {
    it('runs param extraction and formatter against fixtures', async () => {
      const rule = makeRule({
        id: 'test.dryrun',
        action: 'test.dryrun',
        paramTemplate: { country: 'DE' },
        formatter: { type: 'fieldSummary', fields: [{ paths: ['value'], label: 'Wert' }] },
      });
      const testCases = [
        {
          name: 'fixture test',
          prompt: 'any prompt',
          userFacts: [],
          fixtureResult: { value: 42 },
          requireNonNullOutput: true,
        },
      ];
      const { draftId } = await broker.call('dossier-hydration.createDraft', { rule, testCases });
      const result = await broker.call('dossier-hydration.test', { id: draftId });
      expect(result.testStatus).toBe('passed');
      expect(result.testResults[0].formatted).toBe('Wert: 42');
    });

    it('fails test when formatter returns null for fixture', async () => {
      const rule = makeRule({
        id: 'test.dryrun.null',
        action: 'test.dryrun.null',
        paramTemplate: { country: 'DE' },
        formatter: { type: 'fieldSummary', fields: [{ paths: ['nonexistent'], label: 'X' }] },
      });
      const testCases = [
        {
          name: 'null formatter test',
          prompt: 'any',
          userFacts: [],
          fixtureResult: { something: 'else' },
          requireNonNullOutput: true,
        },
      ];
      const { draftId } = await broker.call('dossier-hydration.createDraft', { rule, testCases });
      const result = await broker.call('dossier-hydration.test', { id: draftId });
      expect(result.testStatus).toBe('failed');
    });

    it('fails test when required params are missing from fixture prompt', async () => {
      const rule = makeRule({ id: 'test.req.params', action: 'test.req.params' });
      const testCases = [
        {
          name: 'no location in prompt',
          prompt: 'CO2 intensity for Germany in general',
          userFacts: [],
          fixtureResult: { value: 99 },
          requireParams: true,
          requireNonNullOutput: false,
        },
      ];
      const { draftId } = await broker.call('dossier-hydration.createDraft', { rule, testCases });
      const result = await broker.call('dossier-hydration.test', { id: draftId });
      expect(result.testResults[0].paramsOk).toBe(false);
      expect(result.testResults[0].passed).toBe(false);
    });
  });

  // ── Full lifecycle ─────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('createDraft → validate → test → promote → rollback → deactivate', async () => {
      const ruleId = 'lifecycle.test.action';
      const rule = makeRule({
        id: ruleId,
        action: ruleId,
        paramTemplate: { country: 'DE' },
        formatter: { type: 'fieldSummary', fields: [{ paths: ['status'], label: 'Status' }] },
      });

      // 1. Create draft v1
      const { draftId: d1 } = await broker.call('dossier-hydration.createDraft', {
        rule, version: '1.0.0',
      });

      // 2. Validate
      const vr = await broker.call('dossier-hydration.validate', { id: d1 });
      expect(vr.validationStatus).toBe('valid');

      // 3. Test
      const tr = await broker.call('dossier-hydration.test', { id: d1 });
      expect(tr.testStatus).toBe('passed');

      // 4. Promote v1
      const pr1 = await broker.call('dossier-hydration.promote', {
        id: d1, promotedBy: 'test-runner',
      });
      expect(pr1.success).toBe(true);

      // Rule is now live in runtime
      const liveRule = getRule(ruleId);
      expect(liveRule).not.toBeNull();

      // 5. Promote v2 (creates archive)
      const { draftId: d2 } = await broker.call('dossier-hydration.createDraft', {
        rule: { ...rule, label: 'Updated Label' }, version: '2.0.0',
      });
      const pr2 = await broker.call('dossier-hydration.promote', {
        id: d2, promotedBy: 'test-runner-v2',
      });
      expect(pr2.data.rollbackTarget).toBeTruthy();

      // 6. Rollback to v1
      const rb = await broker.call('dossier-hydration.rollback', {
        id: ruleId, rolledBackBy: 'ops',
      });
      expect(rb.success).toBe(true);
      expect(rb.version).toBe('1.0.0');

      // 7. Deactivate
      const da = await broker.call('dossier-hydration.deactivate', { id: ruleId });
      expect(da.success).toBe(true);
      expect(da.runtimeRuleRemoved).toBe(true);
    });

    it('cannot rollback with no previous version archived', async () => {
      const ruleId = 'no.archive.rule';
      const { draftId } = await broker.call('dossier-hydration.createDraft', {
        rule: makeRule({ id: ruleId, action: ruleId, paramTemplate: { country: 'DE' } }),
      });
      await broker.call('dossier-hydration.promote', { id: draftId });

      await expect(
        broker.call('dossier-hydration.rollback', { id: ruleId })
      ).rejects.toMatchObject({ code: 409 });
    });
  });

  // ── reload ─────────────────────────────────────────────────────────────

  describe('reload', () => {
    it('returns compiledRuleCount >= 8 (static baseline)', async () => {
      const result = await broker.call('dossier-hydration.reload');
      expect(result.success).toBe(true);
      expect(result.compiledRuleCount).toBeGreaterThanOrEqual(8);
    });
  });

  // ── list ───────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns static rules', async () => {
      const result = await broker.call('dossier-hydration.list', { includeStatic: true });
      expect(result.success).toBe(true);
      expect(result.data.some((r) => r.action === 'energy-market.co2Intensity')).toBe(true);
    });
  });

  // ── get ────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('retrieves a static rule by action id', async () => {
      const result = await broker.call('dossier-hydration.get', { id: 'energy-market.co2Intensity' });
      expect(result.success).toBe(true);
      expect(result.source).toBe('static');
    });

    it('returns 404 for unknown id', async () => {
      await expect(
        broker.call('dossier-hydration.get', { id: 'nonexistent.xyz.abc' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ── safety invariants ──────────────────────────────────────────────────

  describe('safety invariants', () => {
    it('cannot promote a rule with readOnly: false', async () => {
      const rule = makeRule({
        id: 'unsafe.rule',
        action: 'unsafe.rule',
        safety: { readOnly: false, allowsMutation: false, hitlRequired: false },
      });
      const { draftId } = await broker.call('dossier-hydration.createDraft', { rule });
      await expect(
        broker.call('dossier-hydration.promote', { id: draftId })
      ).rejects.toMatchObject({ code: 409 });
    });

    it('compileRule returns null for unsafe rule', () => {
      const rule = makeRule({
        safety: { readOnly: false, allowsMutation: false, hitlRequired: false },
      });
      expect(compileRule(rule)).toBeNull();
    });

    it('compileRule returns null for mutating rule', () => {
      const rule = makeRule({
        safety: { readOnly: true, allowsMutation: true, hitlRequired: false },
      });
      expect(compileRule(rule)).toBeNull();
    });

    it('compileRule returns null for hitl-required rule', () => {
      const rule = makeRule({
        safety: { readOnly: true, allowsMutation: false, hitlRequired: true },
      });
      expect(compileRule(rule)).toBeNull();
    });

    it('compileRule returns null for blocked action verb (regression: was only checking safety flags)', () => {
      const rule = makeRule({ id: 'legit-svc.delete', action: 'legit-svc.delete' });
      expect(compileRule(rule)).toBeNull();
    });

    it('compileRule returns null for blocked service prefix (regression)', () => {
      const rule = makeRule({ id: 'hitl.query', action: 'hitl.query' });
      expect(compileRule(rule)).toBeNull();
    });
  });

  // ── Known action validation (action-exists warning) ────────────────────────

  describe('known action validation', () => {
    it('createDraft adds a warning when action is not registered in the broker', async () => {
      const rule = makeRule({
        id: 'unregistered.service.getData',
        action: 'unregistered.service.getData',
        paramTemplate: { country: 'DE' },
      });
      const result = await broker.call('dossier-hydration.createDraft', { rule });
      expect(result.validationWarnings.some((w) => w.field === 'action')).toBe(true);
      expect(result.validationWarnings.some((w) => w.message.includes('not currently registered'))).toBe(true);
    });

    it('validate adds a warning when action is not registered in the broker', async () => {
      const rule = makeRule({
        id: 'another.unregistered.getData',
        action: 'another.unregistered.getData',
        paramTemplate: { country: 'DE' },
      });
      const { draftId } = await broker.call('dossier-hydration.createDraft', { rule });
      const result = await broker.call('dossier-hydration.validate', { id: draftId });
      expect(result.validationWarnings.some((w) => w.field === 'action')).toBe(true);
    });

    it('validationStatus remains valid despite action-not-registered warning', async () => {
      const rule = makeRule({
        id: 'yet.another.unregistered.getData',
        action: 'yet.another.unregistered.getData',
        paramTemplate: { country: 'DE' },
      });
      const result = await broker.call('dossier-hydration.createDraft', { rule });
      expect(result.validationStatus).toBe('valid');
    });
  });
});
