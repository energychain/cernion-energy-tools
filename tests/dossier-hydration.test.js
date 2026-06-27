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
    it('loads all 96 static rules', () => {
      const rules = getStaticRules();
      expect(rules.length).toBe(96);
    });

    it('compiles all 96 static rules without error', () => {
      const rules = listRules();
      expect(rules.length).toBe(96);
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

    it('dashboard-api.steeringArtifactAcceptanceGateStatus is dossier-safe and formats acceptance facts', () => {
      const rule = getRule('dashboard-api.steeringArtifactAcceptanceGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Akzeptanz-Gate artefakt=grid-card rolle=netzplanung owner=lead laden'
        )
      ).toEqual({
        artifactName: 'grid-card',
        targetRole: 'netzplanung',
        owner: 'lead',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_maintenance_owner',
        artifact: {
          artifactName: 'Grid Planning Next Gate',
          targetRole: 'Netzplanung',
        },
        ownerContext: { owner: null },
        missingEvidence: [{ missingDataPoint: 'owner' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add accountable owner assignment',
          },
        ],
        timestamp: '2026-06-27T01:50:00.000Z',
      });

      expect(formatted).toContain('Acceptance Gate Status: needs_maintenance_owner');
      expect(formatted).toContain('Artifact: Grid Planning Next Gate');
      expect(formatted).toContain('Target Role: Netzplanung');
      expect(formatted).toContain('Leading Gap: owner');
    });

    it('dashboard-api.communicationBreakProcessRiskStatus is dossier-safe and formats process-risk facts', () => {
      const rule = getRule('dashboard-api.communicationBreakProcessRiskStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Kommunikationsbruch prozess=netzplanung entscheidung=zielnetz owner=lead blockiert=gate2 laden'
        )
      ).toEqual({
        processDomain: 'netzplanung',
        affectedDecision: 'zielnetz',
        owner: 'lead',
        blockedDecision: 'gate2',
      });

      const formatted = rule.formatEvidence({
        status: 'blocked_decision_needs_evidence',
        riskLevel: 'high',
        process: {
          affectedDecision: 'Zielnetz-Freigabe',
          blockedDecision: 'Gate 2',
        },
        ownerContext: { owner: 'Netzplanung Lead' },
        missingEvidence: [{ missingDataPoint: 'next_evidence_point' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add the next concrete evidence point for unblock',
          },
        ],
        sourceActions: { notCalled: ['hr.personScore'] },
        timestamp: '2026-06-27T03:20:00.000Z',
      });

      expect(formatted).toContain('Communication Risk Status: blocked_decision_needs_evidence');
      expect(formatted).toContain('Risk Level: high');
      expect(formatted).toContain('Affected Decision: Zielnetz-Freigabe');
      expect(formatted).toContain('Blocked Decision: Gate 2');
      expect(formatted).toContain('Leading Gap: next_evidence_point');
    });

    it('dashboard-api.anschlusskapazitaetEvidenceQueueStatus is dossier-safe and formats queue facts', () => {
      const rule = getRule('dashboard-api.anschlusskapazitaetEvidenceQueueStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Anschlusskapazitaet Evidenzqueue anfrage=ar-299 nvp=nvp-west kapazitaet=1250 owner=netzplanung frist=2026-07-15 gate=management-review laden'
        )
      ).toEqual({
        connectionRequestId: 'ar-299',
        netzverknuepfungspunktHint: 'nvp-west',
        capacityAssumptionKw: '1250',
        owner: 'netzplanung',
        dueDate: '2026-07-15',
        nextGate: 'management-review',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'anschlusskapazitaet_evidence_queue',
        status: 'missing_evidence',
        readinessScore: 0.4,
        evidenceQueue: {
          connectionRequestId: 'ar-299',
          netzverknuepfungspunktHint: 'nvp-west',
          capacityAssumptionKw: 1250,
          gridRestrictionHint: 'constraint-open',
          fnavOptionMarker: 'fnav-open',
          owner: 'netzplanung',
        },
        nextGate: 'management-review',
        missingEvidence: [{ missingDataPoint: 'legal_question_marker' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'route the open legal question without automated legal qualification' },
        ],
        sourceActions: {
          notCalled: ['grid-connection.reserveCapacity'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: missing_evidence'],
        },
      });

      expect(formatted).toContain('Capability: anschlusskapazitaet_evidence_queue');
      expect(formatted).toContain('Status: missing_evidence');
      expect(formatted).toContain('Connection Request: ar-299');
      expect(formatted).toContain('NVP Hint: nvp-west');
      expect(formatted).toContain('Capacity kW: 1250');
      expect(formatted).toContain('Side-Effect Guard: grid-connection.reserveCapacity');
    });

    it('dashboard-api.layer0AuditDrilldownNoteStatus is dossier-safe and formats audit note facts', () => {
      const rule = getRule('dashboard-api.layer0AuditDrilldownNoteStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Layer-0 Audit Drilldown kpi=l0-grid-duration datenquelle=layer0-export abweichung=+38pct owner=prozessmanagement 90tage=source-validation laden'
        )
      ).toEqual({
        kpiId: 'l0-grid-duration',
        dataSource: 'layer0-export',
        peerDeviation: '+38pct',
        owner: 'prozessmanagement',
        next90DayFocus: 'source-validation',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'layer0_audit_drilldown_note',
        status: 'needs_peer_deviation',
        auditNote: {
          kpiId: 'l0-grid-duration',
          dataSource: 'layer0-export',
          peerDeviation: '+38pct',
          hypothesis: 'Peer deviation requires validation before interpretation.',
          possibleMisinterpretation: 'Benchmark signal is not a final finding.',
          owner: 'prozessmanagement',
          next90DayStep: 'source-validation',
        },
        hypothesis: 'Peer deviation requires validation before interpretation.',
        possibleMisinterpretation: 'Benchmark signal is not a final finding.',
        checkFields: Array.from({ length: 10 }, (_, index) => ({ id: `check-${index + 1}` })),
        missingEvidence: [{ missingDataPoint: 'peer_deviation' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add the benchmark or peer deviation' },
        ],
        sourceActions: {
          notCalled: ['audit-queue.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_peer_deviation'],
        },
      });

      expect(formatted).toContain('Capability: layer0_audit_drilldown_note');
      expect(formatted).toContain('Status: needs_peer_deviation');
      expect(formatted).toContain('KPI: l0-grid-duration');
      expect(formatted).toContain('Data Source: layer0-export');
      expect(formatted).toContain('Peer Deviation: +38pct');
      expect(formatted).toContain('Owner: prozessmanagement');
      expect(formatted).toContain('Side-Effect Guard: audit-queue.create');
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

    it('dashboard-api.netzprozessReadinessGateStatus is dossier-safe and formats readiness facts', () => {
      const rule = getRule('dashboard-api.netzprozessReadinessGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Netzprozess Readiness Gate processType=redispatch processId=np-223 fuer Portalzugang und SFTP pruefen'
        )
      ).toEqual({
        processType: 'redispatch',
        processId: 'np-223',
      });

      const formatted = rule.formatEvidence({
        overallStatus: 'blocked',
        processType: 'redispatch',
        processRef: { processId: 'np-223' },
        readinessSignals: [{ code: 'sftp_route', status: 'blocked' }],
        blockers: [{ code: 'sftp_route' }],
        owners: ['Netzbetrieb'],
        nextDecision: 'produktivreife',
        missingEvidence: [
          {
            missingDataPoint: 'sftp_route',
            enablesDossierAddition: 'adds interface route readiness proof',
          },
        ],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Overall Status: blocked'],
        },
      });

      expect(formatted).toContain('Overall Status: blocked');
      expect(formatted).toContain('Process Type: redispatch');
      expect(formatted).toContain('Process ID: np-223');
      expect(formatted).toContain('Leading Blocker: sftp_route');
      expect(formatted).toContain('Owner: Netzbetrieb');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.rolePermissionAccessReadinessGateStatus is dossier-safe and formats access readiness facts', () => {
      const rule = getRule('dashboard-api.rolePermissionAccessReadinessGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Role Permission Readiness roleId=role-261 accessManagerRef=am:reapproval-3 pruefen'
        )
      ).toEqual({
        roleId: 'role-261',
        accessManagerRef: 'am:reapproval-3',
      });

      const formatted = rule.formatEvidence({
        status: 'blocked_by_access_gap',
        roleContext: {
          roleId: 'role-261',
          roleName: 'Flexibilitaetsdirigent',
          accessManagerRef: 'am:reapproval-3',
        },
        readinessSignals: [{ code: 'reapproval_status', status: 'blocked' }],
        evidenceGaps: [
          {
            missingDataPoint: 'reapproval_status',
            enablesDossierAddition: 'add AccessManager reapproval evidence',
          },
        ],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add AccessManager reapproval evidence',
          },
        ],
        sourceActions: {
          notCalled: ['access-manager.call'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: blocked_by_access_gap'],
        },
      });

      expect(formatted).toContain('Status: blocked_by_access_gap');
      expect(formatted).toContain('Role ID: role-261');
      expect(formatted).toContain('Role: Flexibilitaetsdirigent');
      expect(formatted).toContain('AccessManager Ref: am:reapproval-3');
      expect(formatted).toContain('Leading Signal: reapproval_status');
      expect(formatted).toContain('Leading Gap: reapproval_status');
      expect(formatted).toContain('Side-Effect Guard: access-manager.call');
    });

    it('dashboard-api.automationRiskGateStatus is dossier-safe and formats automation risk facts', () => {
      const rule = getRule('dashboard-api.automationRiskGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Automation Risk Gate processId=rpa-205 processName=Billing-Massenlauf'
        )
      ).toEqual({
        processId: 'rpa-205',
        processName: 'Billing-Massenlauf',
      });

      const formatted = rule.formatEvidence({
        status: 'blocked_by_uncontrolled_mass_run',
        processContext: {
          processId: 'rpa-205',
          processName: 'Billing Massenlauf',
        },
        riskContext: {
          riskLevel: 'critical',
        },
        readinessSignals: [{ code: 'rollback_path', status: 'blocked' }],
        evidenceGaps: [
          {
            missingDataPoint: 'uncontrolled_mass_run',
            enablesDossierAddition: 'document stop criteria, rollback path, monitoring, and risk acceptance before any mass automation run',
          },
        ],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'document stop criteria, rollback path, monitoring, and risk acceptance before any mass automation run',
          },
        ],
        sourceActions: {
          notCalled: ['rpa.execute'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: blocked_by_uncontrolled_mass_run'],
        },
      });

      expect(formatted).toContain('Status: blocked_by_uncontrolled_mass_run');
      expect(formatted).toContain('Process ID: rpa-205');
      expect(formatted).toContain('Process: Billing Massenlauf');
      expect(formatted).toContain('Risk: critical');
      expect(formatted).toContain('Leading Gap: uncontrolled_mass_run');
      expect(formatted).toContain('Side-Effect Guard: rpa.execute');
    });

    it('dashboard-api.stadtwerkMauerVdmiProfileStatus is dossier-safe and formats Stadtwerk Mauer facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerVdmiProfileStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer VDMI Profile tenant=stadtwerk-mauer sparte=gas fuer 69256 Mauer laden'
        )
      ).toEqual({
        tenantId: 'stadtwerk-mauer',
        focusSparte: 'gas',
      });

      const formatted = rule.formatEvidence({
        profileId: 'stadtwerk_mauer_vdmi_profile',
        tenantId: 'stadtwerk-mauer',
        municipality: 'Mauer',
        postcode: '69256',
        sparten: [{ label: 'Strom' }],
        roles: [{ label: 'Management' }],
        evidenceGaps: [
          {
            missingDataPoint: 'capability_projection',
            enablesDossierAddition: 'enable Phase 2 Eve-compatible capability projection',
          },
        ],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'enable Phase 2 Eve-compatible capability projection',
          },
        ],
        sourceActions: {
          notCalled: ['tenant.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Profile: stadtwerk_mauer_vdmi_profile'],
        },
      });

      expect(formatted).toContain('Profile: stadtwerk_mauer_vdmi_profile');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('Municipality: Mauer');
      expect(formatted).toContain('Postcode: 69256');
      expect(formatted).toContain('Leading Gap: capability_projection');
      expect(formatted).toContain('Side-Effect Guard: tenant.create');
    });

    it('dashboard-api.stadtwerkMauerCapabilityProjectionStatus is dossier-safe and formats role capability facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerCapabilityProjectionStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer Capability Projection tenant=stadtwerk-mauer roles=management,grid-planning laden'
        )
      ).toEqual({
        tenantId: 'stadtwerk-mauer',
        roles: 'management,grid-planning',
      });

      const formatted = rule.formatEvidence({
        projectionId: 'stadtwerk_mauer_capability_projection',
        tenantId: 'stadtwerk-mauer',
        municipality: 'Mauer',
        postcode: '69256',
        roles: [
          {
            label: 'Management',
            readOnlyCapabilities: [{ capability: 'stadtwerk_mauer_vdmi_profile' }],
            consequentialFollowUps: [{ capability: 'nova_proposal_for_portfolio_decision' }],
          },
        ],
        classificationSummary: {
          readOnly: 4,
          consequentialFollowUps: 3,
        },
        evidenceGaps: [
          {
            missingDataPoint: 'missing_consequential_boundary',
          },
        ],
        sourceActions: {
          notCalled: ['eve.runtime.execute'],
        },
        dossierEvidence: {
          dossierFacts: ['Projection: stadtwerk_mauer_capability_projection'],
        },
      });

      expect(formatted).toContain('Projection: stadtwerk_mauer_capability_projection');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('Leading Role: Management');
      expect(formatted).toContain('Read-only Capability: stadtwerk_mauer_vdmi_profile');
      expect(formatted).toContain('Consequential Follow-up: nova_proposal_for_portfolio_decision');
      expect(formatted).toContain('Side-Effect Guard: eve.runtime.execute');
    });

    it('dashboard-api.stadtwerkMauerEventReplayPreviewStatus is dossier-safe and formats replay facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerEventReplayPreviewStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer Event Replay Preview seed=cron-265 count=5 sparte=strom laden'
        )
      ).toEqual({
        seed: 'cron-265',
        count: '5',
        sparte: 'strom',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'stadtwerk_mauer_event_replay_preview',
        tenantId: 'stadtwerk-mauer',
        templateCount: 25,
        seed: 'cron-265',
        replayPreview: [
          {
            eventType: 'pv_anmeldung_elektriker',
            sparte: 'strom',
            marketRole: 'VNB',
            expectedRouting: { nextOwner: 'netzanschluss' },
            sideEffectPolicy: 'advisory_only',
          },
        ],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add supplied evidence for PV-Anmeldung Elektriker',
          },
        ],
        sourceActions: {
          notCalled: ['scheduler.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Capability: stadtwerk_mauer_event_replay_preview'],
        },
      });

      expect(formatted).toContain('Capability: stadtwerk_mauer_event_replay_preview');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('Templates: 25');
      expect(formatted).toContain('First Event: pv_anmeldung_elektriker');
      expect(formatted).toContain('Side-Effect Guard: scheduler.create');
    });

    it('dashboard-api.stadtwerkMauerSandboxRuntimeStatus is dossier-safe and formats sandbox facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerSandboxRuntimeStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer Sandbox Runtime tenant=stadtwerk-mauer Reset Status laden'
        )
      ).toEqual({
        tenantId: 'stadtwerk-mauer',
      });

      const formatted = rule.formatEvidence({
        status: 'sandbox_state_mutated_needs_reset_proof',
        tenantId: 'stadtwerk-mauer',
        eventCount: 1,
        artifactCount: 6,
        resetDeleteReadiness: { wouldDeleteArtifactCount: 6 },
        missingLifecycleEvidence: [{ missingDataPoint: 'reset_delete_proof' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add cleanup readiness and residue-free reset evidence',
          },
        ],
        timestamp: '2026-06-23T07:30:00.000Z',
      });

      expect(formatted).toContain('Sandbox Status: sandbox_state_mutated_needs_reset_proof');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('Events: 1');
      expect(formatted).toContain('Leading Gap: reset_delete_proof');
    });

    it('dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus is dossier-safe and formats stub facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer externe Schnittstellen Stubs tenant=stadtwerk-mauer laden'
        )
      ).toEqual({
        tenantId: 'stadtwerk-mauer',
      });

      const formatted = rule.formatEvidence({
        status: 'stub_transcripts_need_evidence',
        tenantId: 'stadtwerk-mauer',
        transcriptCount: 2,
        artifactCount: 8,
        recentTranscripts: [
          {
            stubFamily: 'mako_lieferantenwechsel',
            responseVariant: 'missing_data',
          },
        ],
        missingEvidence: [{ missingDataPoint: 'meloId' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add MaLo/MeLo and supplier reference for simulated MaKo exchange evidence',
          },
        ],
        timestamp: '2026-06-23T08:40:00.000Z',
      });

      expect(formatted).toContain('Stub Status: stub_transcripts_need_evidence');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('Transcripts: 2');
      expect(formatted).toContain('Latest Stub: mako_lieferantenwechsel');
      expect(formatted).toContain('Leading Gap: meloId');
    });

    it('dashboard-api.stadtwerkMauerE2eProcessDemoStatus is dossier-safe and formats demo facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerE2eProcessDemoStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer E2E Prozessdemo tenant=stadtwerk-mauer case=case-266 laden'
        )
      ).toEqual({
        tenantId: 'stadtwerk-mauer',
        caseId: 'case-266',
      });

      const formatted = rule.formatEvidence({
        status: 'e2e_demo_trace_needs_evidence',
        tenantId: 'stadtwerk-mauer',
        demoPath: 'pv_registration_electrician_missing_nap',
        caseId: 'case-266',
        traceCount: 1,
        artifactCount: 5,
        recentTraces: [{ transcriptId: 'smm-stub:test' }],
        evidenceQuality: 'incomplete_demo_evidence',
        missingEvidence: [{ missingDataPoint: 'napReference' }],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add NAP / Netzanschlusspunkt reference evidence to complete PV registration trace',
          },
        ],
        timestamp: '2026-06-23T10:40:00.000Z',
      });

      expect(formatted).toContain('E2E Demo Status: e2e_demo_trace_needs_evidence');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('Demo Path: pv_registration_electrician_missing_nap');
      expect(formatted).toContain('Case: case-266');
      expect(formatted).toContain('Stub Transcript: smm-stub:test');
      expect(formatted).toContain('Leading Gap: napReference');
    });

    it('dashboard-api.stadtwerkMauerMastrDataOverlayStatus is dossier-safe and formats overlay facts', () => {
      const rule = getRule('dashboard-api.stadtwerkMauerMastrDataOverlayStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Stadtwerk Mauer Blended MaStR Overlay tenant=stadtwerk-mauer plz=69256 ort=Mauer laden'
        )
      ).toEqual({
        tenantId: 'stadtwerk-mauer',
        postalCode: '69256',
        municipality: 'Mauer',
      });

      const formatted = rule.formatEvidence({
        status: 'blended_overlay_ready',
        tenantId: 'stadtwerk-mauer',
        municipality: 'Mauer',
        postalCode: '69256',
        assetCount: 2,
        totalCapacityKw: 20,
        operatorOverlay: {
          virtualGridOperator: { name: 'Stadtwerk Mauer' },
          realWorldOperatorHint: { name: 'Syna GmbH' },
          mutatesMastrRecords: false,
        },
        originalGridOperators: [{ name: 'Syna GmbH' }],
        sampleAssets: [{ mastrNummer: 'SEE-MAUER-001' }],
        timestamp: '2026-06-23T14:00:00.000Z',
      });

      expect(formatted).toContain('Overlay Status: blended_overlay_ready');
      expect(formatted).toContain('Tenant: stadtwerk-mauer');
      expect(formatted).toContain('MaStR Assets: 2');
      expect(formatted).toContain('Virtual Grid Operator: Stadtwerk Mauer');
      expect(formatted).toContain('Real-world Operator: Syna GmbH');
      expect(formatted).toContain('Original Operator Evidence: Syna GmbH');
      expect(formatted).toContain('Sample Asset: SEE-MAUER-001');
      expect(formatted).toContain('Mutates MaStR: false');
    });

    it('dashboard-api.legalClarificationOperatingModelStatus is dossier-safe and formats operating-model facts', () => {
      const rule = getRule('dashboard-api.legalClarificationOperatingModelStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Rechtsklaerung case=case-141 legalStatus=pending owner=netzanschluss laden'
        )
      ).toEqual({
        caseId: 'case-141',
        legalStatus: 'pending',
        owner: 'netzanschluss',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'legal_clarification_operating_model',
        status: 'pending_legal_clarification',
        legalStatus: 'pending',
        decisionReadiness: 'blocked_by_pending_legal_clarification',
        preparationModel: {
          caseId: 'case-141',
          clarificationPoint: 'Kapazitaetsfrage',
          affectedDecision: 'Anschlussfreigabe',
          rolesAndOwners: { owner: 'Netzanschluss' },
        },
        missingEvidence: [{ missingDataPoint: 'legal_status' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'state whether execution is legally cleared instead of pending' },
        ],
        sourceActions: {
          notCalled: ['legal.approve'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: pending_legal_clarification'],
        },
      });

      expect(formatted).toContain('Capability: legal_clarification_operating_model');
      expect(formatted).toContain('Status: pending_legal_clarification');
      expect(formatted).toContain('Legal Status: pending');
      expect(formatted).toContain('Decision Readiness: blocked_by_pending_legal_clarification');
      expect(formatted).toContain('Clarification: Kapazitaetsfrage');
      expect(formatted).toContain('Side-Effect Guard: legal.approve');
    });

    it('dashboard-api.drReadinessEvidenceStatus is dossier-safe and formats DR evidence facts', () => {
      const rule = getRule('dashboard-api.drReadinessEvidenceStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte DR Readiness tenant=public restore-drill=passed rto=2h rpo=1h owner=ops laden'
        )
      ).toEqual({
        tenantScope: 'public',
        restoreDrillStatus: 'passed',
        rtoTarget: '2h',
        rpoTarget: '1h',
        owner: 'ops',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'dr_readiness_evidence_gate',
        status: 'needs_snapshot_manifest',
        readinessLevel: 'needs_evidence',
        readinessScore: 0.38,
        requestContext: { tenantScope: 'public' },
        owner: 'Operations',
        missingEvidence: [{ missingDataPoint: 'snapshot_manifest' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add cutover snapshot manifest evidence' },
        ],
        sourceActions: {
          notCalled: ['backup.restore'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_snapshot_manifest'],
        },
      });

      expect(formatted).toContain('Capability: dr_readiness_evidence_gate');
      expect(formatted).toContain('Status: needs_snapshot_manifest');
      expect(formatted).toContain('Readiness Level: needs_evidence');
      expect(formatted).toContain('Tenant Scope: public');
      expect(formatted).toContain('Side-Effect Guard: backup.restore');
    });

    it('dashboard-api.fnavFastTrackContractGateStatus is dossier-safe and formats gate facts', () => {
      const rule = getRule('dashboard-api.fnavFastTrackContractGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte fNAV Fast Track gate=gate-221 netzbetreiber=SNB935578300972 anfrage=storage netzsignal=approved steuernachweis=ctrl-1 vertrag=signed recht=approved owner=netzplanung laden'
        )
      ).toEqual({
        gateId: 'gate-221',
        gridOperatorId: 'SNB935578300972',
        requestType: 'storage',
        netzsignalPriorityPolicy: 'approved',
        controlEvidenceRef: 'ctrl-1',
        contractStatus: 'signed',
        legalStatus: 'approved',
        ownerContact: 'netzplanung',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'fnav_fast_track_contract_gate',
        gateId: 'gate-221',
        decisionReadiness: 'needs_control_evidence',
        requestSummary: { requestType: 'storage' },
        technicalGate: {
          netzsignalPriorityPolicy: 'approved',
          controlEvidenceRef: null,
        },
        contractGate: {
          contractStatus: 'draft',
          legalStatus: 'approved',
        },
        missingEvidence: [{ missingDataPoint: 'control_evidence_ref' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add metering/control proof before fast-track release review' },
        ],
        sourceActions: {
          notCalled: ['contract.approve'],
        },
      });

      expect(formatted).toContain('Capability: fnav_fast_track_contract_gate');
      expect(formatted).toContain('Decision Readiness: needs_control_evidence');
      expect(formatted).toContain('Gate: gate-221');
      expect(formatted).toContain('Netzsignal Priority: approved');
      expect(formatted).toContain('Side-Effect Guard: contract.approve');
    });

    it('dashboard-api.crossChannelVnbSignalQueueStatus is dossier-safe and formats queue facts', () => {
      const rule = getRule('dashboard-api.crossChannelVnbSignalQueueStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Cross Channel VNB Signal Queue signal=sig-218 quelle=mail:42 prozess=netzanschluss risiko=owner_deadline owner=netzbetrieb frist=2026-12-31 evidenz=ready datenpunkt=malo pruefen'
        )
      ).toEqual({
        signalId: 'sig-218',
        sourceRef: 'mail:42',
        affectedProcess: 'netzanschluss',
        riskType: 'owner_deadline',
        ownerRole: 'netzbetrieb',
        dueAt: '2026-12-31',
        evidenceStatus: 'ready',
        nextDatapoint: 'malo',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'cross_channel_vnb_signal_queue',
        queueStatus: 'needs_evidence',
        signalCount: 1,
        normalizedSignals: [{ affectedProcess: 'netzanschluss', riskType: 'owner_deadline' }],
        missingEvidence: [{ missingDataPoint: 'evidence_status' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add evidence status or evidence reference' },
        ],
        sourceActions: {
          notCalled: ['mail.connector.ingest'],
        },
        dossierEvidence: {
          overdueCount: 0,
          needsOwnerCount: 0,
          needsEvidenceCount: 1,
        },
      });

      expect(formatted).toContain('Capability: cross_channel_vnb_signal_queue');
      expect(formatted).toContain('Queue Status: needs_evidence');
      expect(formatted).toContain('Signals: 1');
      expect(formatted).toContain('Leading Gap: evidence_status');
      expect(formatted).toContain('Side-Effect Guard: mail.connector.ingest');
    });

    it('dashboard-api.assetValuationTransformationGateStatus is dossier-safe and formats gate facts', () => {
      const rule = getRule('dashboard-api.assetValuationTransformationGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Asset Valuation Transformation Gate asset=asset-219 buchwert=provided zustand=provided option=h2-ready vertragsrisiko=reviewed regulatorik=bounded datenqualitaet=high owner=finance entscheidung=committee-q3 pruefen'
        )
      ).toEqual({
        assetId: 'asset-219',
        bookValueStatus: 'provided',
        assetConditionStatus: 'provided',
        transformationOption: 'h2-ready',
        contractRisk: 'reviewed',
        regulatoryUncertainty: 'bounded',
        dataQualityStatus: 'high',
        decisionOwner: 'finance',
        nextDecision: 'committee-q3',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'asset_valuation_transformation_gate',
        decisionReadiness: 'needs_book_value',
        assetScope: { assetId: 'asset-219' },
        bookValueStatus: { status: 'missing' },
        assetConditionStatus: { status: 'provided' },
        transformationOption: { option: 'h2-ready' },
        contractRisk: { status: 'reviewed' },
        regulatoryUncertainty: { status: 'bounded' },
        dataQualityStatus: { status: 'high' },
        missingEvidence: [{ missingDataPoint: 'book_value_source' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add book-value and residual-value basis to the management gate' },
        ],
        sourceActions: {
          notCalled: ['valuation.recordCreate'],
        },
      });

      expect(formatted).toContain('Capability: asset_valuation_transformation_gate');
      expect(formatted).toContain('Decision Readiness: needs_book_value');
      expect(formatted).toContain('Asset Scope: asset-219');
      expect(formatted).toContain('Leading Gap: book_value_source');
      expect(formatted).toContain('Side-Effect Guard: valuation.recordCreate');
    });

    it('dashboard-api.gasCapacityBookingReviewGateStatus is dossier-safe and formats review-gate facts', () => {
      const rule = getRule('dashboard-api.gasCapacityBookingReviewGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Gas-Kapazitaetsbestellung review=gas-260 jahr=2027 netzgebiet=gas-nord kapazitaetsannahme=rlm-plus-12 kaltjahr=stress-2025 rlm-rebound=rebound-8 engpasshistorie=hist-3 vdmi=gas-leitung decisionFrame=df-260 commercial=reviewed pruefen'
        )
      ).toEqual({
        reviewId: 'gas-260',
        bookingYear: '2027',
        networkArea: 'gas-nord',
        capacityAssumption: 'rlm-plus-12',
        coldYearEvidence: 'stress-2025',
        rlmReboundEvidence: 'rebound-8',
        congestionHistoryEvidence: 'hist-3',
        vdmiOwner: 'gas-leitung',
        decisionFrameRef: 'df-260',
        commercialSignoff: 'reviewed',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'gas_capacity_booking_review_gate',
        status: 'needs_scenario_evidence',
        reviewScope: { networkArea: 'gas-nord', bookingYear: '2027' },
        capacityAssumptionSummary: { assumption: 'rlm-plus-12' },
        scenarioEvidenceStatus: { coldYearEvidence: null, rlmReboundEvidence: 'rebound-8' },
        vdmiReview: { owner: 'gas-leitung' },
        commercialSignoff: { status: 'reviewed' },
        missingEvidence: [{ missingDataPoint: 'cold_year_evidence' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add cold-year stress evidence' }],
        sourceActions: {
          notCalled: ['gas-capacity-booking.submit'],
        },
      });

      expect(formatted).toContain('Capability: gas_capacity_booking_review_gate');
      expect(formatted).toContain('Gate Status: needs_scenario_evidence');
      expect(formatted).toContain('Network Area: gas-nord');
      expect(formatted).toContain('Leading Gap: cold_year_evidence');
      expect(formatted).toContain('Side-Effect Guard: gas-capacity-booking.submit');
    });

    it('dashboard-api.gasNetworkDecisionChainStatus is dossier-safe and formats decision-chain facts', () => {
      const rule = getRule('dashboard-api.gasNetworkDecisionChainStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Gasnetz Entscheidungskette chain=gas-255 netzbetreiber=vnb-gas segment=seg-1 kapazitaetsannahme=rlm-flat stilllegungspfad=partial-decommission eog=eog-255 kanu=kanu-255 asset=asset-42 buchwert=bw-42 fotojahr=2026 deadline=2026-09-30 owner=asset-lead folgeentscheidung=investment-q4 evidenzschritt=eog-note pruefen'
        )
      ).toEqual({
        chainId: 'gas-255',
        gridOperatorId: 'vnb-gas',
        segmentId: 'seg-1',
        capacityAssumption: 'rlm-flat',
        decommissioningPath: 'partial-decommission',
        eogRef: 'eog-255',
        kanuRef: 'kanu-255',
        assetRef: 'asset-42',
        bookValueRef: 'bw-42',
        photoYear: '2026',
        decisionDeadline: '2026-09-30',
        owner: 'asset-lead',
        blockedFollowUpDecision: 'investment-q4',
        nextEvidenceStep: 'eog-note',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'gas_network_decision_chain',
        status: 'needs_regulatory_refs',
        chainScope: { gridOperatorId: 'vnb-gas', segmentId: 'seg-1' },
        capacityAssumptionStatus: { assumption: 'rlm-flat' },
        decommissioningPathStatus: { path: 'partial-decommission' },
        assetBookValueStatus: { assetRef: 'asset-42', bookValueRef: 'bw-42' },
        photoYearWindow: { photoYear: '2026' },
        owner: { name: 'asset-lead' },
        blockedFollowUpDecision: 'investment-q4',
        missingEvidence: [{ missingDataPoint: 'regulatory_impact_refs' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add KANU/EOG refs' }],
        sourceActions: {
          notCalled: ['gas-network-flow.calculate'],
        },
      });

      expect(formatted).toContain('Capability: gas_network_decision_chain');
      expect(formatted).toContain('Decision Chain Status: needs_regulatory_refs');
      expect(formatted).toContain('Grid Operator: vnb-gas');
      expect(formatted).toContain('Leading Gap: regulatory_impact_refs');
      expect(formatted).toContain('Side-Effect Guard: gas-network-flow.calculate');
    });

    it('dashboard-api.waterPricingNetInvestmentAlignmentStatus is dossier-safe and formats alignment facts', () => {
      const rule = getRule('dashboard-api.waterPricingNetInvestmentAlignmentStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Alignment Gate case=water-259 waterPriceReference=wp-2026 netInvestmentReference=invest-42 anlagenbuchhaltung=asset-export pachtnetz=lease-42 regulierungswirkung=reg-42 owner=commercial-lead periode=2026-Q3 entscheidung=committee-ready pruefen'
        )
      ).toEqual({
        caseId: 'water-259',
        waterPriceReference: 'wp-2026',
        netInvestmentReference: 'invest-42',
        assetAccountingReference: 'asset-export',
        pachtnetzReference: 'lease-42',
        regulatoryImpactReference: 'reg-42',
        governanceOwner: 'commercial-lead',
        reviewPeriod: '2026-Q3',
        alignmentDecision: 'committee-ready',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'water_pricing_net_investment_alignment_gate',
        status: 'needs_asset_accounting_reference',
        alignmentScope: { caseId: 'water-259' },
        pricingEvidence: { waterPriceReference: 'wp-2026' },
        investmentEvidence: { netInvestmentReference: 'invest-42' },
        leaseConditionEvidence: { pachtnetzReference: 'lease-42' },
        regulatoryBoundaryEvidence: { regulatoryImpactReference: 'reg-42' },
        owner: { governanceOwner: 'commercial-lead' },
        reviewWindow: { reviewPeriod: '2026-Q3' },
        alignmentDecision: 'committee-ready',
        missingEvidence: [{ missingDataPoint: 'asset_accounting_reference' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add Anlagenbuchhaltung evidence' }],
        sourceActions: {
          notCalled: ['water-pricing.calculate'],
        },
      });

      expect(formatted).toContain('Capability: water_pricing_net_investment_alignment_gate');
      expect(formatted).toContain('Alignment Status: needs_asset_accounting_reference');
      expect(formatted).toContain('Water Price Ref: wp-2026');
      expect(formatted).toContain('Leading Gap: asset_accounting_reference');
      expect(formatted).toContain('Side-Effect Guard: water-pricing.calculate');
    });

    it('dashboard-api.arealNetworkIntegrationOfferGateStatus is dossier-safe and formats offer gate facts', () => {
      const rule = getRule('dashboard-api.arealNetworkIntegrationOfferGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Areal Angebotsgate case=areal-269 standort=site-west anschlusskapazitaet=12MW netzkapazitaet=grid-ok zielnetzpfad=znp-42 investition=capex-42 regulierungswirkung=reg-42 angebotsannahmen=offer-v1 owner=commercial-lead entscheidungstermin=2026-09-30 angebotsentscheidung=review-ready pruefen'
        )
      ).toEqual({
        caseId: 'areal-269',
        siteReference: 'site-west',
        requestedConnectionCapacity: '12MW',
        gridCapacityEvidence: 'grid-ok',
        targetGridPath: 'znp-42',
        investmentReference: 'capex-42',
        regulatoryImpactBoundary: 'reg-42',
        commercialOfferAssumptions: 'offer-v1',
        owner: 'commercial-lead',
        nextDecisionDate: '2026-09-30',
        offerDecisionStatus: 'review-ready',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'areal_network_integration_offer_gate',
        status: 'needs_grid_capacity_evidence',
        decisionScope: { siteReference: 'site-west' },
        capacityEvidence: { requestedConnectionCapacity: '12MW' },
        targetGridEvidence: { targetGridPath: 'znp-42' },
        investmentEvidence: { investmentReference: 'capex-42' },
        regulatoryBoundaryEvidence: { regulatoryImpactBoundary: 'reg-42' },
        commercialAssumptionEvidence: { commercialOfferAssumptions: 'offer-v1' },
        owner: { owner: 'commercial-lead' },
        decisionWindow: {
          nextDecisionDate: '2026-09-30',
          offerDecisionStatus: 'review-ready',
        },
        missingEvidence: [{ missingDataPoint: 'grid_capacity_evidence' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add grid capacity evidence' }],
        sourceActions: {
          notCalled: ['offer.calculate'],
        },
      });

      expect(formatted).toContain('Capability: areal_network_integration_offer_gate');
      expect(formatted).toContain('Offer Gate Status: needs_grid_capacity_evidence');
      expect(formatted).toContain('Site: site-west');
      expect(formatted).toContain('Leading Gap: grid_capacity_evidence');
      expect(formatted).toContain('Side-Effect Guard: offer.calculate');
    });

    it('dashboard-api.transformationFinancingScenarioViewStatus is dossier-safe and formats scenario facts', () => {
      const rule = getRule('dashboard-api.transformationFinancingScenarioViewStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Transformationsfinanzierung szenario=tf-206 netzbetreiber=vnb-mauer planungshorizont=2026-2030 typ=gas-heat cashflow=cf-42 rueckbaukosten=rb-42 kommunaleLast=komm-42 eog=eog-42 liquiditaet=liq-42 stressschwelle=dscr-1.2 gremiengate=board owner=cfo pruefen'
        )
      ).toEqual({
        scenarioId: 'tf-206',
        gridOperatorId: 'vnb-mauer',
        planningHorizon: '2026-2030',
        scenarioType: 'gas-heat',
        cashflowSource: 'cf-42',
        rollbackCostBasis: 'rb-42',
        municipalBurdenAssumption: 'komm-42',
        eogImpact: 'eog-42',
        liquidityImpact: 'liq-42',
        stressThreshold: 'dscr-1.2',
        committeeDecisionGate: 'board',
        owner: 'cfo',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'transformation_financing_scenario_view',
        status: 'needs_cashflow_source',
        scenarioSummary: {
          scenarioId: 'tf-206',
          gridOperatorId: 'vnb-mauer',
          planningHorizon: '2026-2030',
        },
        evidenceGroups: {
          cashflow: { cashflowSource: 'cf-42' },
          assetTransition: { rollbackCostBasis: 'rb-42' },
          municipalBurden: { municipalBurdenAssumption: 'komm-42' },
          regulatoryFinance: { eogImpact: 'eog-42' },
          liquidityStress: { liquidityImpact: 'liq-42', stressThreshold: 'dscr-1.2' },
          committeeGate: { committeeDecisionGate: 'board' },
        },
        missingEvidence: [{ missingDataPoint: 'cashflow_source' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add cashflow evidence' }],
        sourceActions: {
          notCalled: ['finance.createBooking'],
        },
      });

      expect(formatted).toContain('Capability: transformation_financing_scenario_view');
      expect(formatted).toContain('Transformation Financing Status: needs_cashflow_source');
      expect(formatted).toContain('Scenario: tf-206');
      expect(formatted).toContain('Leading Gap: cashflow_source');
      expect(formatted).toContain('Side-Effect Guard: finance.createBooking');
    });

    it('dashboard-api.investmentOwnerDeadlineBudgetGateStatus is dossier-safe and formats gate facts', () => {
      const rule = getRule('dashboard-api.investmentOwnerDeadlineBudgetGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Investitionsprozess massnahme=measure-278 owner=netzbetrieb frist=2026-09-30 budgetwirkung=capex-42 freigabe=review-ready folgeentscheidung=portfolio-prio eskalation=investment-board pruefen'
        )
      ).toEqual({
        measureId: 'measure-278',
        owner: 'netzbetrieb',
        deadline: '2026-09-30',
        budgetEffect: 'capex-42',
        approvalStatus: 'review-ready',
        blockedFollowUpDecision: 'portfolio-prio',
        nextEscalationStep: 'investment-board',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'investment_owner_deadline_budget_gate',
        status: 'needs_owner_deadline_budget_evidence',
        measure: { measureId: 'measure-278' },
        gateEvidence: {
          owner: 'netzbetrieb',
          deadline: '2026-09-30',
          budgetEffect: 'capex-42',
          approvalStatus: 'review-ready',
          blockedFollowUpDecision: 'portfolio-prio',
          nextEscalationStep: 'investment-board',
        },
        missingEvidence: [{ missingDataPoint: 'required_evidence' }],
        positiveFollowUps: [{ enablesDossierAddition: 'attach required approval evidence' }],
        sourceActions: {
          notCalled: ['investment.approve'],
        },
      });

      expect(formatted).toContain('Capability: investment_owner_deadline_budget_gate');
      expect(formatted).toContain('Investment Gate Status: needs_owner_deadline_budget_evidence');
      expect(formatted).toContain('Measure: measure-278');
      expect(formatted).toContain('Leading Gap: required_evidence');
      expect(formatted).toContain('Side-Effect Guard: investment.approve');
    });

    it('dashboard-api.noRegretMeasureDefinitionGateStatus is dossier-safe and formats definition facts', () => {
      const rule = getRule('dashboard-api.noRegretMeasureDefinitionGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte no-regret massnahme=measure-279 programm=trans-2030 szenario=load-plus wirkung=optionality budgetwirkung=capex-42 finanzierungsowner=invest regulatorik=fit priorisierung=no-regret-first datenqualitaet=reviewed kommunikationsregel=committee pruefgate=q3 frist=2026-09-30 owner=board pruefen'
        )
      ).toEqual({
        measureId: 'measure-279',
        programmeId: 'trans-2030',
        scenarioAssumption: 'load-plus',
        transformationEffect: 'optionality',
        budgetEffect: 'capex-42',
        fundingOwner: 'invest',
        regulatoryFit: 'fit',
        prioritisationRule: 'no-regret-first',
        dataQualityStatus: 'reviewed',
        communicationRule: 'committee',
        nextReviewGate: 'q3',
        dueDate: '2026-09-30',
        owner: 'board',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'no_regret_measure_definition_gate',
        status: 'needs_definition_evidence',
        measure: { measureId: 'measure-279' },
        definitionEvidence: {
          transformationEffect: 'optionality',
          budgetEffect: 'capex-42',
          regulatoryFit: 'fit',
          prioritisationRule: 'no-regret-first',
          dataQualityStatus: 'reviewed',
          communicationRule: 'committee',
          nextReviewGate: 'q3',
        },
        missingEvidence: [{ missingDataPoint: 'review_gate' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add next review gate evidence' }],
        sourceActions: {
          notCalled: ['measure.approve'],
        },
      });

      expect(formatted).toContain('Capability: no_regret_measure_definition_gate');
      expect(formatted).toContain('No-Regret Gate Status: needs_definition_evidence');
      expect(formatted).toContain('Measure: measure-279');
      expect(formatted).toContain('Leading Gap: review_gate');
      expect(formatted).toContain('Side-Effect Guard: measure.approve');
    });

    it('dashboard-api.gasGridTransformationAssetCockpitStatus is dossier-safe and formats asset-cockpit facts', () => {
      const rule = getRule('dashboard-api.gasGridTransformationAssetCockpitStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Gasnetztransformation programm=gas-2030 arbeitspaket=wp-zone-a segment=gas-seg-a option=h2_reuse h2status=ready rueckbaukosten=1250000 cashflow=cf-a totex=totex-a regulatorisch=areg-v1 waermenetz=heat-a stromnetz=power-a kundenuebergang=customers-a gremiengate=board owner=asset-strategy pruefen'
        )
      ).toEqual({
        transformationProgramId: 'gas-2030',
        workPackageId: 'wp-zone-a',
        assetSegmentRef: 'gas-seg-a',
        targetOption: 'h2_reuse',
        technicalReuseStatus: 'ready',
        decommissioningCostEur: '1250000',
        cashflowImpact: 'cf-a',
        totexImpact: 'totex-a',
        regulatoryRecognitionStatus: 'areg-v1',
        heatNetworkDependency: 'heat-a',
        powerGridDependency: 'power-a',
        customerTransitionDependency: 'customers-a',
        decisionGate: 'board',
        ownerRole: 'asset-strategy',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'gas_grid_transformation_asset_cockpit',
        status: 'needs_decommissioning_cost',
        programSummary: {
          transformationProgramId: 'gas-2030',
          workPackageId: 'wp-zone-a',
        },
        evidenceGroups: {
          assetScope: { assetSegmentRef: 'gas-seg-a', targetOption: 'h2_reuse' },
          technicalReuse: { technicalReuseStatus: 'ready' },
          decommissioning: { decommissioningCostEur: 1250000 },
          financialImpact: { cashflowImpact: 'cf-a', totexImpact: 'totex-a' },
          dependencies: { heatNetworkDependency: 'heat-a', powerGridDependency: 'power-a' },
          committeeGate: { decisionGate: 'board' },
        },
        missingEvidence: [{ missingDataPoint: 'decommissioning_cost_basis' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add rollback evidence' }],
        sourceActions: {
          notCalled: ['gas-assets.applyDecommissioning'],
        },
      });

      expect(formatted).toContain('Capability: gas_grid_transformation_asset_cockpit');
      expect(formatted).toContain('Gas Grid Transformation Status: needs_decommissioning_cost');
      expect(formatted).toContain('Program: gas-2030');
      expect(formatted).toContain('Leading Gap: decommissioning_cost_basis');
      expect(formatted).toContain('Side-Effect Guard: gas-assets.applyDecommissioning');
    });

    it('dashboard-api.leadershipDeltaCockpitStatus is dossier-safe and formats cockpit facts', () => {
      const rule = getRule('dashboard-api.leadershipDeltaCockpitStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Fuehrungscockpit Thema=zielnetzplanung domain=znp owner=netzstrategie frist=2026-Q3 evidenzstatus=partial entscheidung=zielnetzpfad eskalation=watch nextLever=resolve_gap pruefen'
        )
      ).toEqual({
        topic: 'zielnetzplanung',
        domain: 'znp',
        ownerRole: 'netzstrategie',
        dueAt: '2026-Q3',
        evidenceStatus: 'partial',
        blockedDecision: 'zielnetzpfad',
        escalationState: 'watch',
        nextLever: 'resolve_gap',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'leadership_delta_cockpit',
        status: 'blocked',
        topics: [
          {
            title: 'zielnetzplanung',
            domain: 'znp',
            owner: { role: 'netzstrategie' },
            dueAt: '2026-Q3',
            evidenceStatus: 'partial',
            blockedDecision: 'zielnetzpfad',
            nextLever: 'resolve_gap',
          },
        ],
        missingEvidence: [{ missingDataPoint: 'missing_source_signal' }],
        positiveFollowUps: [{ enablesDossierAddition: 'add source provenance' }],
        sourceActions: {
          notCalled: ['hitl.create'],
        },
      });

      expect(formatted).toContain('Capability: leadership_delta_cockpit');
      expect(formatted).toContain('Leadership Delta Status: blocked');
      expect(formatted).toContain('Topic: zielnetzplanung');
      expect(formatted).toContain('Owner: netzstrategie');
      expect(formatted).toContain('Blocked Decision: zielnetzpfad');
      expect(formatted).toContain('Side-Effect Guard: hitl.create');
    });

    it('dashboard-api.liveUpdateStreamContractStatus is dossier-safe and formats stream contract facts', () => {
      const rule = getRule('dashboard-api.liveUpdateStreamContractStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte live update contract channels=hitl_queue sourceService=hitl sourceAction=list authBoundary=bearer fallback=/api/hitl/items owner=platform pruefen'
        )
      ).toEqual({
        channels: 'hitl_queue',
        sourceService: 'hitl',
        sourceAction: 'list',
        authBoundary: 'bearer',
        fallbackPollingPath: '/api/hitl/items',
        ownerRole: 'platform',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'live_update_stream_contract_status',
        status: 'contract_ready',
        channels: [
          {
            key: 'hitl_queue',
            availability: 'planned',
            proposedTransport: 'sse_eventsource',
            fallbackPollingPath: '/api/hitl/items',
            authBoundary: 'bearer_token_and_x_tenant_id',
            ownerRole: 'platform-api',
          },
        ],
        missingEvidence: [],
        positiveFollowUps: [],
        sourceActions: {
          notCalled: ['sse.openConnection'],
        },
      });

      expect(formatted).toContain('Capability: live_update_stream_contract_status');
      expect(formatted).toContain('Live Update Contract Status: contract_ready');
      expect(formatted).toContain('Channel: hitl_queue');
      expect(formatted).toContain('Proposed Transport: sse_eventsource');
      expect(formatted).toContain('Side-Effect Guard: sse.openConnection');
    });

    it('dashboard-api.smgwConnectorReadinessStatus is dossier-safe and formats connector readiness facts', () => {
      const rule = getRule('dashboard-api.smgwConnectorReadinessStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte SMGW readiness scope=section14a gateway=bsi-tr-03109 adapter=openmuc intent=dimming nes2=module-2 eebus=ucp taf=taf7 audit=trail auth=bearer owner=flex pruefen'
        )
      ).toEqual({
        integrationScope: 'section14a',
        gatewayClass: 'bsi-tr-03109',
        adapterClass: 'openmuc',
        controlDomainIntent: 'dimming',
        nes2ModuleEvidence: 'module-2',
        eebusEvidence: 'ucp',
        tafEvidence: 'taf7',
        auditPrerequisites: 'trail',
        authBoundary: 'bearer',
        ownerRole: 'flex',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'smgw_connector_readiness_status',
        status: 'ready_for_connector_design',
        readinessScore: 1,
        connectorReadiness: {
          integrationScope: 'section14a_smgw_control',
          adapterClass: 'openmuc-reference',
          controlDomainIntent: 'dimming-readiness',
          authBoundary: 'bearer_token_and_x_tenant_id',
          fallbackReason: 'readiness evidence only',
        },
        missingEvidence: [],
        positiveFollowUps: [],
        sourceActions: {
          notCalled: ['smgw.register'],
        },
      });

      expect(formatted).toContain('Capability: smgw_connector_readiness_status');
      expect(formatted).toContain('SMGW Connector Readiness: ready_for_connector_design');
      expect(formatted).toContain('Adapter Class: openmuc-reference');
      expect(formatted).toContain('Side-Effect Guard: smgw.register');
    });

    it('dashboard-api.specialGridUsageImpactMapStatus is dossier-safe and formats impact-map facts', () => {
      const rule = getRule('dashboard-api.specialGridUsageImpactMapStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte besondere Netznutzung fall=sgu-201 frist=risk mengenbasis=metered-2025 berechnung=par19-v1 owner=regulierung laden'
        )
      ).toEqual({
        caseId: 'sgu-201',
        deadlineStatus: 'risk',
        quantityBasis: 'metered-2025',
        calculationLogicRef: 'par19-v1',
        ownerRole: 'regulierung',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'special_grid_usage_impact_map',
        status: 'deadline_risk',
        readinessLevel: 'risk',
        caseSummary: {
          caseId: 'sgu-201',
          caseType: 'stromnev19',
          ownerRole: 'Regulierungsmanagement',
        },
        deadlineRisk: true,
        missingEvidence: [{ missingDataPoint: 'quantity_basis' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add source-backed quantity evidence' },
        ],
        sourceActions: {
          notCalled: ['settlement.prepareBilling'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: deadline_risk'],
        },
      });

      expect(formatted).toContain('Capability: special_grid_usage_impact_map');
      expect(formatted).toContain('Status: deadline_risk');
      expect(formatted).toContain('Readiness Level: risk');
      expect(formatted).toContain('Case: sgu-201');
      expect(formatted).toContain('Side-Effect Guard: settlement.prepareBilling');
    });

    it('dashboard-api.liquidityPlanningGovernanceStatus is dossier-safe and formats liquidity facts', () => {
      const rule = getRule('dashboard-api.liquidityPlanningGovernanceStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Liquiditaetsplanung run=liq-204 quellenregister=finance-register dictionary=dict-v1 owner=treasury cashPool=cash-pool-v1 pruefen'
        )
      ).toEqual({
        planningRunId: 'liq-204',
        sourceRegister: 'finance-register',
        dictionaryVersion: 'dict-v1',
        ownerRaci: 'treasury',
        cashPoolSettlementRef: 'cash-pool-v1',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'liquidity_planning_governance_module',
        status: 'blocked_by_unvalidated_cash_pool_logic',
        readinessLevel: 'blocked',
        planningRunId: 'liq-204',
        sourceCoverage: { sourceRegister: 'finance-register' },
        governanceState: { ownerRaci: 'treasury' },
        missingEvidence: [{ missingDataPoint: 'vat_logic_reference' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add evidence boundary for Umsatzsteuer assumptions' },
        ],
        sourceActions: {
          notCalled: ['cashflow.calculate', 'sap.connector.call'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: blocked_by_unvalidated_cash_pool_logic'],
        },
      });

      expect(formatted).toContain('Capability: liquidity_planning_governance_module');
      expect(formatted).toContain('Status: blocked_by_unvalidated_cash_pool_logic');
      expect(formatted).toContain('Readiness Level: blocked');
      expect(formatted).toContain('Planning Run: liq-204');
      expect(formatted).toContain('Side-Effect Guard: cashflow.calculate');
    });

    it('dashboard-api.energySharingSimulationGateStatus is dossier-safe and formats simulation-gate facts', () => {
      const rule = getRule('dashboard-api.energySharingSimulationGateStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Energy Sharing Gate community=es-230 vnb=vnb-230 datenbasis=forecast marktrolle=pending pruefen'
        )
      ).toEqual({
        communityId: 'es-230',
        gridOperatorId: 'vnb-230',
        dataBasis: 'forecast',
        marketRoleReadiness: 'pending',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'energy_sharing_simulation_gate',
        gateStatus: 'learning_pilot',
        simulationStage: 'learning_pilot',
        communityId: 'es-230',
        missingEvidence: [{ missingDataPoint: 'market_role_readiness' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add market-role and balancing-group readiness evidence' },
        ],
        sourceActions: {
          notCalled: ['energy-sharing-allocation.allocate', 'settlement.exportA96'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: learning_pilot'],
        },
      });

      expect(formatted).toContain('Capability: energy_sharing_simulation_gate');
      expect(formatted).toContain('Status: learning_pilot');
      expect(formatted).toContain('Simulation Stage: learning_pilot');
      expect(formatted).toContain('Community: es-230');
      expect(formatted).toContain('Side-Effect Guard: energy-sharing-allocation.allocate');
    });

    it('dashboard-api.energySharing42cCutoverReadinessStatus is dossier-safe and formats cutover facts', () => {
      const rule = getRule('dashboard-api.energySharing42cCutoverReadinessStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte 42c cutover cutover=es42c-2026 tenant=tenant-hoeheinoed bilanzkreis=bk_hoeheinoed_es_001 pruefen'
        )
      ).toEqual({
        cutoverId: 'es42c-2026',
        pilotTenantId: 'tenant-hoeheinoed',
        balanceGroupId: 'bk_hoeheinoed_es_001',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'energy_sharing_42c_cutover_readiness',
        status: 'blocked',
        riskLevel: 'high',
        pilotTenantId: 'tenant-hoeheinoed',
        missingEvidence: [{ missingDataPoint: 'compliance_signoff_evidence' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add compliance and sign-off evidence without automating legal/regulatory interpretation' },
        ],
        sourceActions: {
          notCalled: ['tenant.migrate', 'settlement.exportA96'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: blocked'],
        },
      });

      expect(formatted).toContain('Capability: energy_sharing_42c_cutover_readiness');
      expect(formatted).toContain('Status: blocked');
      expect(formatted).toContain('Risk Level: high');
      expect(formatted).toContain('Pilot Tenant: tenant-hoeheinoed');
      expect(formatted).toContain('Side-Effect Guard: tenant.migrate');
    });

    it('dashboard-api.evuApiMigrationDiagnosticsStatus is dossier-safe and formats API migration facts', () => {
      const rule = getRule('dashboard-api.evuApiMigrationDiagnosticsStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte EVU API Migration endpoint=/api/v2/malo/patch PATCH scope=mako:process.write pruefen'
        )
      ).toEqual({
        endpoint: '/api/v2/malo/patch',
        method: 'patch',
        authScope: 'mako:process.write',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'evu_api_migration_diagnostics',
        status: 'partial_diagnostics',
        businessProcess: 'Lieferantenwechsel',
        endpoint: '/api/v2/malo/patch',
        authScope: 'mako:process.write',
        missingEvidence: [{ missingDataPoint: 'completion_criterion' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add the migration closure or readiness criterion' },
        ],
        sourceActions: {
          notCalled: ['external.connector.call', 'oauth.authorize'],
        },
      });

      expect(formatted).toContain('Capability: evu_api_migration_diagnostics');
      expect(formatted).toContain('Status: partial_diagnostics');
      expect(formatted).toContain('Process: Lieferantenwechsel');
      expect(formatted).toContain('Endpoint: /api/v2/malo/patch');
      expect(formatted).toContain('Side-Effect Guard: external.connector.call');
    });

    it('dashboard-api.novaDecisionLifecycleReadinessStatus is dossier-safe and formats NOVA lifecycle facts', () => {
      const rule = getRule('dashboard-api.novaDecisionLifecycleReadinessStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte NOVA readiness case=nova-trl7 kind=asset_override pruefen'
        )
      ).toEqual({
        caseId: 'nova-trl7',
        decisionKind: 'asset_override',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'nova_decision_lifecycle_readiness',
        status: 'blocked',
        riskLevel: 'high',
        decisionKind: 'asset_override',
        missingEvidence: [{ missingDataPoint: 'decision_lifecycle_model' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add a documented NOVA lifecycle model from proposed to applied/rejected/expired' },
        ],
        sourceActions: {
          notCalled: ['nova.decisions.create', 'hitl.create'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: blocked'],
        },
      });

      expect(formatted).toContain('Capability: nova_decision_lifecycle_readiness');
      expect(formatted).toContain('Status: blocked');
      expect(formatted).toContain('Risk Level: high');
      expect(formatted).toContain('Decision Kind: asset_override');
      expect(formatted).toContain('Side-Effect Guard: nova.decisions.create');
    });

    it('dashboard-api.redispatchProjectControllingKpiCockpitStatus is dossier-safe and formats controlling facts', () => {
      const rule = getRule('dashboard-api.redispatchProjectControllingKpiCockpitStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte Redispatch KPI Cockpit cockpitId=rd-222 period=2026-Q3 audit=aud-222 settlement=sett-222 owner=netzbetrieb laden'
        )
      ).toEqual({
        cockpitId: 'rd-222',
        period: '2026-Q3',
        redispatchAuditId: 'aud-222',
        settlementRef: 'sett-222',
        taskOwner: 'netzbetrieb',
      });

      const formatted = rule.formatEvidence({
        capabilityKey: 'redispatch_project_controlling_kpi_cockpit',
        status: 'blocked_by_decision_gap',
        projectContext: {
          cockpitId: 'rd-222',
          period: '2026-Q3',
          redispatchAuditId: 'aud-222',
          settlementRef: 'sett-222',
        },
        taskSignals: [{ owner: 'Netzbetrieb' }],
        evidenceGaps: [{ missingDataPoint: 'blocked_decision' }],
        decisionBlockers: [{ message: 'add explicit blocker and required decision context' }],
        positiveFollowUps: [
          { enablesDossierAddition: 'add explicit blocker and required decision context' },
        ],
        sourceActions: {
          notCalled: ['redispatch.execute'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: blocked_by_decision_gap'],
        },
      });

      expect(formatted).toContain('Capability: redispatch_project_controlling_kpi_cockpit');
      expect(formatted).toContain('Status: blocked_by_decision_gap');
      expect(formatted).toContain('Cockpit: rd-222');
      expect(formatted).toContain('Redispatch Audit: aud-222');
      expect(formatted).toContain('Decision Blocker: add explicit blocker and required decision context');
      expect(formatted).toContain('Side-Effect Guard: redispatch.execute');
    });

    it('znp.productionReadinessStatus is dossier-safe and formats ZNP readiness facts', () => {
      const rule = getRule('znp.productionReadinessStatus');
      expect(rule).not.toBeNull();
      expect(isSafetyRejectedAction(rule.action)).toBe(false);
      expect(
        rule.extractParams(
          [],
          'Bitte ZNP Production Readiness Evidence Gate fuer project=znp-71 layer1=present layer2=present g-factor=present acceptance=ref-71 novaHandoff=advisory-ready laden'
        )
      ).toEqual({
        projectId: 'znp-71',
        layer1Evidence: 'present',
        layer2Evidence: 'present',
        gfactorValidation: 'present',
        acceptanceReference: 'ref-71',
        novaHandoff: 'advisory-ready',
      });

      const formatted = rule.formatEvidence({
        status: 'needs_gfactor_validation',
        gateStatus: 'evidence_gap',
        projectContext: { projectId: 'znp-71' },
        readinessSignals: [
          { code: 'layer1_evidence', status: 'present' },
          { code: 'layer2_evidence', status: 'present' },
          { code: 'gfactor_validation', status: 'missing' },
          { code: 'acceptance_reference', status: 'missing' },
          { code: 'nova_handoff', status: 'present' },
        ],
        evidenceGaps: [
          {
            missingDataPoint: 'gfactor_validation',
            enablesDossierAddition: 'add measured/reference G-Factor comparison basis',
          },
        ],
        positiveFollowUps: [
          {
            enablesDossierAddition: 'add measured/reference G-Factor comparison basis',
          },
        ],
        sourceActions: {
          notCalled: ['overpass.fetch'],
        },
        dossierEvidence: {
          dossierFacts: ['Status: needs_gfactor_validation'],
        },
      });

      expect(formatted).toContain('ZNP Readiness: needs_gfactor_validation');
      expect(formatted).toContain('Project: znp-71');
      expect(formatted).toContain('G-Factor: missing');
      expect(formatted).toContain('Leading Gap: gfactor_validation');
      expect(formatted).toContain('Side-Effect Guard: overpass.fetch');
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
