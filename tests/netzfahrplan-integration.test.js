'use strict';

/**
 * Integration tests for Phase 5 — Netzfahrplan / fNAV
 *
 * Tests grid-operations.netzfahrplanGenerate and grid-connection.fnavValidate
 * via a stub broker. Finance-agent.fnavEconomics is tested inline (no PouchDB needed).
 */

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const GridOpsService = require('../services/grid-operations.service');
const GridConnectionService = require('../services/grid-connection.service');
const FinanceAgentService = require('../services/finance-agent.service');

const tmpDb = (name) => path.join(os.tmpdir(), `${name}-fnav-test-${Date.now()}`);

// Minimal stubs
const EOG_CAPEX_EUR = 1_500_000;

describe('netzfahrplan integration — netzfahrplanGenerate', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    // Grid Operations needs no external deps for netzfahrplanGenerate (pure computation)
    broker.createService({ ...GridOpsService });

    await broker.start();
  });

  afterAll(() => broker.stop());

  it('returns FLEX_NAV_FEASIBLE for a valid hybrid profile that passes N-1', async () => {
    const result = await broker.call('grid-operations.netzfahrplanGenerate', {
      gridOperatorName: 'TWL Netze',
      voltageLevel: 'MS',
      requestedCapacityKW: 5000,
      firmCapacityKW: 3000,
      flexibleCapacityKW: 2000,
      curtailmentWindow: 4,
      contractStatus: 'signed',
      legalStatus: 'approved',
      ownerContact: 'netzplanung@twl.de',
    });

    expect(result.feasibility).toBe('feasible');
    expect(result.capacityModel.profileType).toBe('hybrid');
    expect(result.n1Check.passes).toBe(true);
    // Governance APPROVED because legal+contract+owner all present
    expect(result.governanceStatus).toBe('approved');
    expect(result.governanceBlockers).toHaveLength(0);
    expect(result.findings.some((f) => f.finding === 'FN_FLEX_NAV_FEASIBLE')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'FN_GOVERNANCE_APPROVED')).toBe(true);
  });

  it('enforces governance blocker when legalStatus is pending (Option B)', async () => {
    const result = await broker.call('grid-operations.netzfahrplanGenerate', {
      voltageLevel: 'MS',
      requestedCapacityKW: 5000,
      firmCapacityKW: 3000,
      flexibleCapacityKW: 2000,
      curtailmentWindow: 4,
      contractStatus: 'signed',
      legalStatus: 'pending', // NOT approved
      ownerContact: 'netzplanung@twl.de',
    });

    expect(result.governanceStatus).toBe('requires_governance_decision');
    expect(result.governanceBlockers.some((b) => b.includes('legalStatus'))).toBe(true);
    expect(result.findings.some((f) => f.finding === 'FN_GOVERNANCE_REQUIRED')).toBe(true);
  });

  it('returns FN_N1_FAIL when effective capacity exceeds N-1 threshold', async () => {
    // Default MS threshold = 20 MVA; request 25 MW static cap → exceeds
    const result = await broker.call('grid-operations.netzfahrplanGenerate', {
      voltageLevel: 'MS',
      requestedCapacityKW: 25_000, // 25 MW — exceeds 20 MVA default
      firmCapacityKW: 25_000,
      flexibleCapacityKW: 0,
      contractStatus: 'signed',
      legalStatus: 'approved',
    });

    expect(result.n1Check.passes).toBe(false);
    expect(result.feasibility).toBe('copper_needed');
    expect(result.findings.some((f) => f.finding === 'FN_N1_FAIL')).toBe(true);
    expect(result.findings.some((f) => f.finding === 'FN_CAPACITY_COPPER_NEEDED')).toBe(true);
  });

  it('uses project N-1 override (Option C)', async () => {
    const result = await broker.call('grid-operations.netzfahrplanGenerate', {
      voltageLevel: 'HS',
      requestedCapacityKW: 70_000, // 70 MW
      firmCapacityKW: 70_000,
      contractStatus: 'signed',
      legalStatus: 'approved',
      n1ThresholdOverride: { project: 78 }, // 78 MVA override (default HS=81)
    });

    expect(result.n1Check.thresholdMVA).toBe(78);
    expect(result.n1Check.thresholdSource).toBe('project_override');
    expect(result.n1Check.overrideApplied).toBe(true);
    expect(result.n1Check.passes).toBe(true); // 70 < 78
  });

  it('FN_PROFILE_INSUFFICIENT when most fields are missing', async () => {
    const result = await broker.call('grid-operations.netzfahrplanGenerate', {
      voltageLevel: 'MS',
      requestedCapacityKW: 3000,
      // contractStatus and legalStatus missing → partial evidence
    });

    expect(result.findings.some((f) => f.finding === 'FN_PROFILE_INSUFFICIENT')).toBe(true);
  });
});

describe('netzfahrplan integration — grid-connection.fnavValidate', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({ ...GridOpsService, settings: { ...GridOpsService.settings, dbPath: tmpDb('grid-ops-gc') } });
    broker.createService({ ...GridConnectionService, settings: { ...GridConnectionService.settings, dbPath: tmpDb('grid-conn') } });

    await broker.start();
  });

  afterAll(() => broker.stop());

  it('delegates to netzfahrplanGenerate and returns source tag', async () => {
    const result = await broker.call('grid-connection.fnavValidate', {
      gridOperatorName: 'TWL Netze',
      voltageLevel: 'MS',
      fnavProfile: {
        requestedCapacity: 4000,
        firmCapacity: 2500,
        flexibleCapacity: 1500,
        curtailmentWindow: 4,
        contractStatus: 'signed',
        legalStatus: 'approved',
      },
      ownerContact: 'netzplanung@twl.de',
    });

    expect(result.source).toBe('grid-connection.fnavValidate');
    expect(result.feasibility).toBeDefined();
    expect(result.governanceStatus).toBeDefined();
    expect(Array.isArray(result.findings)).toBe(true);
  });
});

describe('netzfahrplan integration — finance-agent.fnavEconomics', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({ ...FinanceAgentService, settings: { ...FinanceAgentService.settings, dbPath: tmpDb('finance-agent') } });

    // Stub eog-calculator to return a known CAPEX
    broker.createService({
      name: 'eog-calculator',
      actions: {
        capexEstimate: {
          handler() {
            return { capexEur: EOG_CAPEX_EUR };
          },
        },
      },
    });

    // Stub knowledge-rag (required by finance-agent but not needed for fnavEconomics)
    broker.createService({
      name: 'knowledge-rag',
      actions: {
        retrieve: { handler() { return { results: [] }; } },
        hybridSearch: { handler() { return { results: [] }; } },
      },
    });

    await broker.start();
  });

  afterAll(() => broker.stop());

  it('returns avoided CAPEX from eog-calculator when available', async () => {
    const result = await broker.call('finance-agent.fnavEconomics', {
      fnavProfile: {
        requestedCapacity: 5000,
        firmCapacity: 3000,
        flexibleCapacity: 2000,
        curtailmentWindow: 4,
        contractStatus: 'signed',
        legalStatus: 'approved',
      },
      voltageLevel: 'MS',
      gridOperator: 'TWL Netze',
      annualFeeEur: 15000,
      ownerContact: 'netzplanung@twl.de',
    });

    expect(result.capexSource).toBe('eog_calculator');
    expect(result.avoidedCopperCapexEur).toBe(EOG_CAPEX_EUR);
    expect(result.annualFeeEur).toBe(15000);
    expect(result.paybackYears).toBe(parseFloat((EOG_CAPEX_EUR / 15000).toFixed(1)));
    expect(result.governanceStatus).toBe('approved');
    expect(result.findings.some((f) => f.finding === 'FN_ECONOMICS_AVAILABLE')).toBe(true);
  });

  it('falls back to parametric estimate when eog-calculator unavailable', async () => {
    // Use a broker where eog-calculator is not available
    const broker2 = new ServiceBroker({ logger: false });
    broker2.createService({ ...FinanceAgentService, settings: { ...FinanceAgentService.settings, dbPath: tmpDb('finance-agent-b2') } });
    broker2.createService({
      name: 'knowledge-rag',
      actions: {
        retrieve: { handler() { return { results: [] }; } },
        hybridSearch: { handler() { return { results: [] }; } },
      },
    });
    await broker2.start();

    const result = await broker2.call('finance-agent.fnavEconomics', {
      fnavProfile: {
        requestedCapacity: 5000,
        contractStatus: 'negotiating',
        legalStatus: 'pending',
      },
      voltageLevel: 'MS',
      annualFeeEur: 12000,
    });

    expect(result.capexSource).toBe('parametric_fallback');
    expect(result.avoidedCopperCapexEur).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.finding === 'FN_ECONOMICS_PARTIAL')).toBe(true);
    expect(result.governanceStatus).toBe('requires_governance_decision');

    await broker2.stop();
  });

  it('uses avoidedCapexOverrideEur when provided', async () => {
    const result = await broker.call('finance-agent.fnavEconomics', {
      fnavProfile: {
        requestedCapacity: 5000,
        contractStatus: 'signed',
        legalStatus: 'approved',
      },
      avoidedCapexOverrideEur: 2_000_000,
      annualFeeEur: 20000,
      ownerContact: 'test@test.de',
    });

    expect(result.capexSource).toBe('override');
    expect(result.avoidedCopperCapexEur).toBe(2_000_000);
    expect(result.paybackYears).toBe(100);
  });
});
