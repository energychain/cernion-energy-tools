'use strict';

const { ServiceBroker } = require('moleculer');

// ── Shared fixtures ──────────────────────────────────────────────────────────

const ASSET_ID = 'EEG-DE-TEST-001';

const MOCK_ASSET = {
  name: 'PV Testanlage Süd',
  technology: 'solar',
  capacityKw: 200,
  awCentsPerKwh: 8.5,
  commissioningDate: '2023-01-01',
};

// 4 hours of hourly prices (will be expanded to 16 × 15-min intervals)
function makePrices() {
  return [
    { timestamp: '2025-06-01T10:00:00Z', priceEurMwh: 45 },
    { timestamp: '2025-06-01T11:00:00Z', priceEurMwh: 50 },
    { timestamp: '2025-06-01T12:00:00Z', priceEurMwh: -5 },
    { timestamp: '2025-06-01T13:00:00Z', priceEurMwh: 60 },
  ];
}

// 16 × 15-min injection entries matching the expanded price grid
function makeInjection() {
  const entries = [];
  const base = new Date('2025-06-01T10:00:00Z').getTime();
  for (let i = 0; i < 16; i++) {
    entries.push({
      timestamp: new Date(base + i * 15 * 60000).toISOString(),
      volumeKwh: 25,
    });
  }
  return entries;
}

// ── Broker setup ─────────────────────────────────────────────────────────────

let broker;
const executedCalls = [];

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false, transporter: null });

  // Mock assets service
  broker.createService({
    name: 'assets',
    actions: {
      effective: jest.fn(async (ctx) => {
        executedCalls.push({ action: 'assets.effective', params: ctx.params });
        expect(ctx.params.assetId).toBe(ASSET_ID);
        return MOCK_ASSET;
      }),
    },
  });

  // Mock energy-market service
  broker.createService({
    name: 'energy-market',
    actions: {
      prices: jest.fn(async (ctx) => {
        executedCalls.push({ action: 'energy-market.prices', params: ctx.params });
        return { data: makePrices() };
      }),
    },
  });

  // Mock edm service
  broker.createService({
    name: 'edm',
    actions: {
      getTimeseries: jest.fn(async (ctx) => {
        executedCalls.push({ action: 'edm.getTimeseries', params: ctx.params });
        expect(ctx.params.meloId).toBe(ASSET_ID);
        return { data: makeInjection() };
      }),
    },
  });

  // Real eeg-clawback-calculator service under test
  broker.loadService('./services/eeg-clawback-calculator.service.js');

  await broker.start();
});

afterAll(async () => {
  await broker.stop();
});

beforeEach(() => {
  executedCalls.length = 0;
});

// Snapshot captured during the simulate beforeAll (immune to beforeEach reset)
let simulateCapturedCalls = [];

// ─────────────────────────────────────────────────────────────────────────────
// Integration: eeg-clawback-calculator.simulate
// ─────────────────────────────────────────────────────────────────────────────

describe('vnb-rcs: eeg-clawback-calculator.simulate', () => {
  let result;

  beforeAll(async () => {
    executedCalls.length = 0; // fresh slate for this test group
    result = await broker.call('eeg-clawback-calculator.simulate', {
      assetId: ASSET_ID,
      timeframe: { start: '2025-06-01T10:00:00Z', end: '2025-06-01T13:45:00Z' },
    });
    simulateCapturedCalls = [...executedCalls]; // snapshot before beforeEach can clear it
  });

  test('assets.effective wird mit korrekter assetId aufgerufen', () => {
    const call = simulateCapturedCalls.find((c) => c.action === 'assets.effective');
    expect(call).toBeDefined();
    expect(call.params.assetId).toBe(ASSET_ID);
  });

  test('energy-market.prices wird aufgerufen', () => {
    const call = simulateCapturedCalls.find((c) => c.action === 'energy-market.prices');
    expect(call).toBeDefined();
    expect(call.params.start).toBe('2025-06-01T10:00:00Z');
    expect(call.params.end).toBe('2025-06-01T13:45:00Z');
  });

  test('edm.getTimeseries wird aufgerufen', () => {
    const call = simulateCapturedCalls.find((c) => c.action === 'edm.getTimeseries');
    expect(call).toBeDefined();
    expect(call.params.meloId).toBe(ASSET_ID);
  });

  test('alle drei Upstream-Services wurden orchestriert', () => {
    const actions = simulateCapturedCalls.map((c) => c.action);
    expect(actions).toContain('assets.effective');
    expect(actions).toContain('energy-market.prices');
    expect(actions).toContain('edm.getTimeseries');
  });

  test('Ergebnis enthält assetId und assetName', () => {
    expect(result.assetId).toBe(ASSET_ID);
    expect(result.assetName).toBe(MOCK_ASSET.name);
  });

  test('summary ist vorhanden und enthält totalVolumeKwh', () => {
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalVolumeKwh).toBe('number');
    expect(result.summary.totalVolumeKwh).toBeGreaterThan(0);
  });

  test('summary.calculatedUnderOldLaw ist vollständig', () => {
    const old = result.summary.calculatedUnderOldLaw;
    expect(typeof old.totalRevenueCents).toBe('number');
    expect(typeof old.curtailedHoursCount).toBe('number');
  });

  test('summary.calculatedUnderNewLaw ist vollständig', () => {
    const n = result.summary.calculatedUnderNewLaw;
    expect(typeof n.totalRefinancingContributionCents).toBe('number');
    expect(typeof n.retainedRevenueCents).toBe('number');
    expect(typeof n.clawbackTriggeredIntervalsCount).toBe('number');
  });

  test('liquidityRiskIndex ist ein gültiger Wert', () => {
    expect(['low', 'medium', 'high']).toContain(result.summary.liquidityRiskIndex);
  });

  test('intervals-Array entspricht der interpolierten Auflösung (16 Viertelstunden)', () => {
    // 4 Stunden × 4 = 16 Intervalle nach Interpolation
    expect(result.intervals).toHaveLength(16);
  });

  test('Negativpreis-Intervall (12 Uhr) triggert Clawback', () => {
    const negIv = result.intervals.find((iv) => iv.priceCentsPerKwh < 0);
    expect(negIv).toBeDefined();
    expect(negIv.clawbackActive).toBe(true);
    expect(negIv.clawbackAmountEur).toBeGreaterThan(0);
  });

  test('blueprintId referenziert rcs-eeg2027-clawback-v1', () => {
    expect(result.blueprintId).toBe('rcs-eeg2027-clawback-v1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: eeg-clawback-calculator.calculate (direkter L1-Aufruf)
// ─────────────────────────────────────────────────────────────────────────────

describe('vnb-rcs: eeg-clawback-calculator.calculate (L1 direktaufruf)', () => {
  test('liefert summary und intervals bei validen Eingaben', async () => {
    const r = await broker.call('eeg-clawback-calculator.calculate', {
      asset: {
        technology: 'wind_onshore',
        capacityKw: 1000,
        awCentsPerKwh: 9.0,
        commissioningDate: '2022-01-01',
      },
      prices: makePrices(),
      injection: makeInjection(),
    });
    expect(r.summary).toBeDefined();
    expect(Array.isArray(r.intervals)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Blueprint-JSON: Syntaktische Validierung
// ─────────────────────────────────────────────────────────────────────────────

describe('vnb-rcs: Blueprint regulatory-change-eeg2027-v1.json', () => {
  const blueprint = require('../src/blueprints/regulatory-change-eeg2027-v1.json');

  test('id ist korrekt', () => {
    expect(blueprint.id).toBe('rcs-eeg2027-clawback-v1');
  });

  test('version ist gesetzt', () => {
    expect(typeof blueprint.version).toBe('string');
    expect(blueprint.version.trim()).not.toBe('');
  });

  test('inputs enthält assetId und timeframe', () => {
    expect(blueprint.inputs.assetId).toBeDefined();
    expect(blueprint.inputs.timeframe).toBeDefined();
  });

  test('execution.steps enthält 4 Schritte', () => {
    expect(blueprint.execution.steps).toHaveLength(4);
  });

  test('letzter Schritt ruft eeg-clawback-calculator.calculate auf', () => {
    const lastStep = blueprint.execution.steps.at(-1);
    expect(lastStep.action).toBe('eeg-clawback-calculator.calculate');
  });

  test('synthesis.templates.success und error sind definiert', () => {
    expect(typeof blueprint.synthesis.templates.success).toBe('string');
    expect(typeof blueprint.synthesis.templates.error).toBe('string');
  });

  test('routing.intentSignals enthält "eeg 2027"', () => {
    expect(blueprint.routing.intentSignals).toContain('eeg 2027');
  });
});
