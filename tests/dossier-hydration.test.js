'use strict';

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
    it('loads all 17 static rules', () => {
      const rules = getStaticRules();
      expect(rules.length).toBe(17);
    });

    it('compiles all 17 static rules without error', () => {
      const rules = listRules();
      expect(rules.length).toBe(17);
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
