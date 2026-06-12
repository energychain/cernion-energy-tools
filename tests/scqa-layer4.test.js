'use strict';

/**
 * SCQA Layer 4 — downstream service integration tests
 *
 * Verifies decisionFrameId / urgencyDriver / questionSeed / decisionFrame params
 * are accepted, stored, and filtered correctly across all 6 affected services.
 */

const { ServiceBroker } = require('moleculer');
const CopilotProcessService = require('../services/copilot-process.service');
const CapexPrioritizationService = require('../services/capex-prioritization.service');
const InvestmentPlanningService = require('../services/investment-planning.service');
const VdmiGatekeepingService = require('../services/vdmi-portfolio-gatekeeping.service');

// ─── ProcessIntentStore unit tests ──────────────────────────────────────────

describe('ProcessIntentStore (unit)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(CopilotProcessService);
    broker.createService({
      name: 'vdmi',
      actions: {
        get: { handler() { return { success: true, matrix: { id: 'vm-1', name: 'TestMatrix' } }; } },
        evidence: { handler() { return { success: true }; } },
      },
    });
    broker.createService({
      name: 'znp',
      actions: {
        getProjectMeta: { handler() { return { projectId: 'znp-1', name: 'TestProject' }; } },
        addAssumption: { handler() { return { success: true }; } },
      },
    });
    broker.createService({
      name: 'grid-connection',
      actions: { validate: { handler() { return { success: true }; } } },
    });
    broker.createService({
      name: 'connection-rejection-evidence',
      actions: { create: { handler() { return { success: true }; } } },
    });
    await broker.start();
  });

  afterAll(() => broker.stop());

  // ── prepareVdmiEvidence ────────────────────────────────────────────────────

  describe('prepareVdmiEvidence', () => {
    it('stores decisionFrameId when provided', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vm-1',
        evidenceType: 'aktenvermerk',
        reference: 'REF-001',
        reason: 'Prüfung abgeschlossen',
        decisionFrameId: 'df-aabbccddeeff',
      });
      expect(result.decisionFrameId).toBe('df-aabbccddeeff');
    });

    it('returns null decisionFrameId when not provided', async () => {
      const result = await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vm-1',
        evidenceType: 'aktenvermerk',
        reference: 'REF-002',
        reason: 'Prüfung',
      });
      expect(result.decisionFrameId).toBeNull();
    });
  });

  // ── prepareZnpAssumption ───────────────────────────────────────────────────

  describe('prepareZnpAssumption', () => {
    it('stores decisionFrameId when provided', async () => {
      const result = await broker.call('copilot-process.prepareZnpAssumption', {
        projectId: 'znp-1',
        text: 'Netzkapazität ausreichend für Q3 2026 Planungsstand.',
        reason: 'Planungsstand Q2',
        decisionFrameId: 'df-112233445566',
      });
      expect(result.decisionFrameId).toBe('df-112233445566');
    });
  });

  // ── prepareConnectionRejectionEvidence ─────────────────────────────────────

  describe('prepareConnectionRejectionEvidence', () => {
    it('stores decisionFrameId when provided', async () => {
      const result = await broker.call('copilot-process.prepareConnectionRejectionEvidence', {
        gridOperatorId: 'SNB935578300972',
        applicantReference: 'APP-001',
        loadAssumptionKw: 150,
        netzverknuepfungspunktId: 'NVP-001',
        voltageLevel: 'NS',
        bottleneckDescription: 'Trafoüberlastung',
        n1QualityStatus: 'NON_COMPLIANT',
        decision: 'REJECTED',
        reason: 'Kapazität nicht ausreichend',
        decisionFrameId: 'df-ffeeddccbbaa',
      });
      expect(result.decisionFrameId).toBe('df-ffeeddccbbaa');
    });
  });

  // ── listProcessIntents — decisionFrameId filter ─────────────────────────────

  describe('listProcessIntents decisionFrameId filter', () => {
    it('returns only intents matching decisionFrameId', async () => {
      const frameId = 'df-scqa-filter-test-1';

      // Create one intent with the frame
      await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vm-1',
        evidenceType: 'aktenvermerk',
        reference: 'REF-FRAME',
        reason: 'Frame test',
        decisionFrameId: frameId,
      });
      // Create one without the frame
      await broker.call('copilot-process.prepareVdmiEvidence', {
        matrixId: 'vm-1',
        evidenceType: 'aktenvermerk',
        reference: 'REF-NOFRAME',
        reason: 'No frame test',
      });

      const { intents } = await broker.call('copilot-process.listProcessIntents', {
        decisionFrameId: frameId,
      });

      expect(intents.length).toBeGreaterThanOrEqual(1);
      expect(intents.every((i) => i.decisionFrameId === frameId)).toBe(true);
    });
  });
});

// ─── capex-prioritization.service ───────────────────────────────────────────

describe('capex-prioritization.service — SCQA Layer 4', () => {
  let broker;

  const VALID_PARAMS = {
    gridOperatorId: 'SNB123456789',
    measures: [
      {
        measureId: 'm-001',
        description: 'Trafo-Upgrade Süd',
        isN1Gap: true,
        supplySecurityImpact: 'HIGH',
        capexEur: 1_200_000,
        currentLoadingPct: 92,
      },
    ],
  };

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...CapexPrioritizationService,
      settings: {
        ...CapexPrioritizationService.settings,
        dbPath: `./data/capex-layer4-test-${Date.now()}`,
      },
    });
    await broker.start();
  });

  afterAll(() => broker.stop());

  it('stores and returns urgencyDriver when provided', async () => {
    const result = await broker.call('capex-prioritization.analyze', {
      ...VALID_PARAMS,
      urgencyDriver: '§14a Steuerbarkeit Pflicht bis 2026-09-30',
    });
    expect(result.urgencyDriver).toBe('§14a Steuerbarkeit Pflicht bis 2026-09-30');
    expect(result.clevelTemplate.scqaUrgencyDriver).toBe('§14a Steuerbarkeit Pflicht bis 2026-09-30');
  });

  it('stores and returns decisionFrameId when provided', async () => {
    const result = await broker.call('capex-prioritization.analyze', {
      ...VALID_PARAMS,
      decisionFrameId: 'df-capex-001',
    });
    expect(result.decisionFrameId).toBe('df-capex-001');
  });

  it('returns null urgencyDriver and decisionFrameId when not provided', async () => {
    const result = await broker.call('capex-prioritization.analyze', VALID_PARAMS);
    expect(result.urgencyDriver).toBeNull();
    expect(result.decisionFrameId).toBeNull();
    expect(result.clevelTemplate.scqaUrgencyDriver).toBeNull();
  });
});

// ─── investment-planning.service ────────────────────────────────────────────

describe('investment-planning.service — SCQA Layer 4', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...InvestmentPlanningService,
      settings: {
        ...InvestmentPlanningService.settings,
        dbPath: `./data/investment-layer4-test-${Date.now()}`,
      },
    });

    broker.createService({
      name: 'redispatch-expost',
      actions: { list: { handler() { return { audits: [] }; } } },
    });
    broker.createService({
      name: 'vdmi',
      actions: { list: { handler() { return { items: [] }; } } },
    });
    broker.createService({
      name: 'hitl',
      actions: { create: { handler() { return { item: null }; } } },
    });
    broker.createService({
      name: 'interface-placeholder',
      actions: {
        listGaps: { handler() { return { placeholders: [] }; } },
        markGap: { handler() { return { placeholder: null }; } },
      },
    });

    await broker.start();
  });

  afterAll(() => broker.stop());

  it('stores decisionFrameId in metadata when provided', async () => {
    const result = await broker.call('investment-planning.createPlan', {
      gridOperatorId: 'SNB123456789',
      decisionFrameId: 'df-invest-001',
    });
    expect(result.metadata.decisionFrameId).toBe('df-invest-001');
  });

  it('stores null decisionFrameId when not provided', async () => {
    const result = await broker.call('investment-planning.createPlan', {
      gridOperatorId: 'SNB123456789',
    });
    expect(result.metadata.decisionFrameId).toBeNull();
  });
});

// ─── vdmi-portfolio-gatekeeping.service ─────────────────────────────────────

describe('vdmi-portfolio-gatekeeping.service — SCQA Layer 4', () => {
  let broker;

  const VALID_GATE_PARAMS = {
    gridOperatorId: 'SNB123456789',
    proposalTitle: 'Trafo-Austausch Ost',
    assetIds: ['asset-001', 'asset-002'],
    technicalFeasibilityConfirmed: true,
    regulatoryAlignmentConfirmed: true,
    estimatedCostEur: 500_000,
  };

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...VdmiGatekeepingService,
      settings: {
        ...VdmiGatekeepingService.settings,
        dbPath: `./data/vpg-layer4-test-${Date.now()}`,
      },
    });
    await broker.start();
  });

  afterAll(() => broker.stop());

  it('stores decisionFrameId in proposal document via ...ctx.params spread', async () => {
    const result = await broker.call('vdmi-portfolio-gatekeeping.gate', {
      ...VALID_GATE_PARAMS,
      decisionFrameId: 'df-gate-001',
    });
    // The stored doc includes decisionFrameId via ...ctx.params spread.
    // We verify by fetching the stored proposal directly (internal state check via PouchDB).
    const svc = broker.getLocalService('vdmi-portfolio-gatekeeping');
    const doc = await svc.db.get(result.proposalId);
    expect(doc.decisionFrameId).toBe('df-gate-001');
  });

  it('gate action accepts proposal without decisionFrameId', async () => {
    const result = await broker.call('vdmi-portfolio-gatekeeping.gate', VALID_GATE_PARAMS);
    expect(result.proposalId).toBeDefined();
    expect(result.decision).toBeDefined();
  });
});
