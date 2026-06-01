'use strict';

/**
 * Phase 2 Tests: EV Charging Blueprint + L1 energy-market.service.js cleanup
 */

const path = require('path');
const fs = require('fs');
const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const EnergyMarketService = require('../services/energy-market.service');
const { validateBlueprint, executeBlueprint } = require('../src/l2-blueprint-interpreter');
const {
  loadBlueprint,
  listBlueprints,
  _resetCache,
  BLUEPRINTS_DIR,
} = require('../src/blueprint-registry');

// ─── Blueprint JSON File Tests ────────────────────────────────────────────────

describe('ev-charging-co2-optimization-v1.json — blueprint file', () => {
  let blueprint;

  beforeAll(() => {
    const filePath = path.join(BLUEPRINTS_DIR, 'ev-charging-co2-optimization-v1.json');
    blueprint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  });

  test('file exists and is valid JSON', () => {
    expect(blueprint).toBeDefined();
    expect(typeof blueprint).toBe('object');
  });

  test('has correct id', () => {
    expect(blueprint.id).toBe('ev-charging-co2-optimization-v1');
  });

  test('has semver version', () => {
    expect(blueprint.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('meta.targetAudience is end_user', () => {
    expect(blueprint.meta.targetAudience).toBe('end_user');
  });

  test('meta has required title and description', () => {
    expect(typeof blueprint.meta.title).toBe('string');
    expect(blueprint.meta.title.length).toBeGreaterThan(3);
    expect(typeof blueprint.meta.description).toBe('string');
    expect(blueprint.meta.description.length).toBeGreaterThan(10);
  });

  test('routing has EV-related intent signals', () => {
    const signals = blueprint.routing?.intentSignals || [];
    expect(signals.some((s) => /laden|wallbox|EV|elektro/i.test(s))).toBe(true);
  });

  test('routing has negative signals to avoid false triggers', () => {
    expect(Array.isArray(blueprint.routing?.negativeSignals)).toBe(true);
    expect(blueprint.routing.negativeSignals.length).toBeGreaterThan(0);
  });

  test('inputs declares postalCode as required', () => {
    expect(blueprint.inputs?.postalCode?.required).toBe(true);
    expect(blueprint.inputs?.postalCode?.semanticType).toBe('OEO:PostalCode');
  });

  test('inputs declares chargingDurationHours with default 4', () => {
    expect(blueprint.inputs?.chargingDurationHours?.resolveStrategy?.defaultValue).toBe(4);
  });

  test('inputs declares chargerPowerKW with default 11', () => {
    expect(blueprint.inputs?.chargerPowerKW?.resolveStrategy?.defaultValue).toBe(11);
  });

  test('execution has exactly 2 steps', () => {
    expect(blueprint.execution.steps).toHaveLength(2);
  });

  test('first step calls energy-market.co2Intensity with location template', () => {
    const step = blueprint.execution.steps[0];
    expect(step.action).toBe('energy-market.co2Intensity');
    expect(step.params.location).toBe('{{inputs.postalCode}}');
    expect(step.params.forecast).toBe(true);
  });

  test('second step calls energy-market.prices for Deutschland', () => {
    const step = blueprint.execution.steps[1];
    expect(step.action).toBe('energy-market.prices');
    expect(step.params.market).toBe('day-ahead');
    expect(step.params.region).toBe('Deutschland');
  });

  test('all step ids are unique', () => {
    const ids = blueprint.execution.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('postProcessing.calculations includes chargingEnergyKWh formula', () => {
    const calc = blueprint.postProcessing?.calculations?.chargingEnergyKWh;
    expect(typeof calc).toBe('string');
    expect(calc).toMatch(
      /chargingDurationHours.*chargerPowerKW|chargerPowerKW.*chargingDurationHours/
    );
  });

  test('postProcessing.mappings.optimalChargingWindow uses find_lowest_contiguous_average', () => {
    const mapping = blueprint.postProcessing?.mappings?.optimalChargingWindow;
    expect(mapping).toBeDefined();
    expect(mapping.strategy).toBe('find_lowest_contiguous_average');
    expect(mapping.source).toContain('fetch_co2_forecast');
    expect(mapping.source).toContain('forecast');
  });

  test('synthesis.evidenceRequired includes CO2 step output', () => {
    expect(blueprint.synthesis?.evidenceRequired).toContain('steps.fetch_co2_forecast.output');
  });

  test('synthesis.templates.success mentions PLZ and CO2', () => {
    const template = blueprint.synthesis?.templates?.success || '';
    expect(template).toContain('postalCode');
    expect(template).toContain('averageValue');
  });

  test('persistence.l3_facts stores evChargingOptimalWindow', () => {
    expect(blueprint.persistence?.l3_facts?.evChargingOptimalWindow).toBeTruthy();
  });

  test('passes L2 blueprint schema validation', () => {
    const result = validateBlueprint(blueprint);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Blueprint Registry Tests ─────────────────────────────────────────────────

describe('blueprint-registry', () => {
  beforeEach(() => {
    _resetCache();
  });

  test('BLUEPRINTS_DIR points to existing directory', () => {
    expect(fs.existsSync(BLUEPRINTS_DIR)).toBe(true);
  });

  test('loadBlueprint returns the EV blueprint by id', () => {
    const bp = loadBlueprint('ev-charging-co2-optimization-v1');
    expect(bp).not.toBeNull();
    expect(bp.id).toBe('ev-charging-co2-optimization-v1');
  });

  test('loadBlueprint returns null for unknown id', () => {
    expect(loadBlueprint('does-not-exist')).toBeNull();
  });

  test('listBlueprints returns at least one blueprint', () => {
    const list = listBlueprints();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  test('listBlueprints entries have required fields', () => {
    const list = listBlueprints();
    for (const entry of list) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.title).toBe('string');
    }
  });

  test('listBlueprints includes ev-charging-co2-optimization-v1', () => {
    const list = listBlueprints();
    const found = list.find((e) => e.id === 'ev-charging-co2-optimization-v1');
    expect(found).toBeDefined();
    expect(found.intentSignals).toContain('laden');
  });

  test('loadBlueprint result passes schema validation', () => {
    const bp = loadBlueprint('ev-charging-co2-optimization-v1');
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(true);
  });
});

// ─── L1 energy-market.co2Intensity — location now required ───────────────────

describe('energy-market.co2Intensity — L1 cleanup: location required', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (_toolName, params) => ({
      success: true,
      co2_intensity_gco2eq_kwh: 320,
      average_today_gco2eq_kwh: 300,
      data: {
        location: params.location || 'unknown',
        timestamp: new Date().toISOString(),
        forecast_next_24h_gco2eq_kwh: [
          320, 300, 280, 260, 240, 220, 200, 190, 185, 188, 210, 230, 250, 270, 290, 310, 330, 350,
          360, 350, 340, 320, 300, 280,
        ],
      },
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(EnergyMarketService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  afterEach(() => {
    callWithNewSession.mockClear();
  });

  test('rejects call without location parameter', async () => {
    await expect(broker.call('energy-market.co2Intensity', {})).rejects.toThrow();
  });

  test('rejects call with empty location string', async () => {
    await expect(broker.call('energy-market.co2Intensity', { location: '' })).rejects.toThrow();
  });

  test('accepts call with explicit location (city name)', async () => {
    const result = await broker.call('energy-market.co2Intensity', {
      location: 'Stuttgart',
    });
    expect(result).toBeDefined();
    expect(callWithNewSession).toHaveBeenCalledWith(
      'cernion_co2_intensity',
      expect.objectContaining({ location: 'Stuttgart' }),
      undefined
    );
  });

  test('accepts call with explicit location (postal code)', async () => {
    const result = await broker.call('energy-market.co2Intensity', {
      location: '70173',
    });
    expect(result).toBeDefined();
    expect(callWithNewSession).toHaveBeenCalledWith(
      'cernion_co2_intensity',
      expect.objectContaining({ location: '70173' }),
      undefined
    );
  });

  test('does NOT pass location to MCP without value (no silent default)', async () => {
    const result = await broker.call('energy-market.co2Intensity', {
      location: '68259',
      forecast: true,
    });
    expect(result).toBeDefined();
    // The MCP call should have the explicit location, not fall back to a hardcoded default
    expect(callWithNewSession).toHaveBeenCalledWith(
      'cernion_co2_intensity',
      expect.objectContaining({ location: '68259' }),
      undefined
    );
  });

  test('forecast array is normalized to [{timestamp, gCO2eqPerKWh}] objects', async () => {
    const result = await broker.call('energy-market.co2Intensity', {
      location: 'München',
      forecast: true,
    });
    const forecast = result?.data?.forecast;
    expect(Array.isArray(forecast)).toBe(true);
    expect(forecast.length).toBe(24);
    expect(typeof forecast[0].gCO2eqPerKWh).toBe('number');
  });
});

// ─── Full Blueprint Execution via Registry ────────────────────────────────────

describe('executeBlueprint with ev-charging-co2-optimization-v1 from registry', () => {
  const co2Forecast = [
    350, 330, 310, 290, 270, 250, 230, 210, 195, 190, 195, 210, 230, 250, 270, 290, 310, 330, 350,
    360, 350, 330, 310, 290,
  ];

  beforeEach(() => {
    _resetCache();
  });

  test('loads blueprint from registry and executes successfully', async () => {
    const blueprint = loadBlueprint('ev-charging-co2-optimization-v1');
    expect(blueprint).not.toBeNull();

    const callAction = jest.fn().mockImplementation((action) => {
      if (action === 'energy-market.co2Intensity') {
        return Promise.resolve({
          data: { forecast: co2Forecast },
          co2_intensity_gco2eq_kwh: 310,
        });
      }
      if (action === 'energy-market.prices') {
        return Promise.resolve({ prices: [], latestPrice: 0.28 });
      }
      return Promise.reject(new Error(`Unknown action: ${action}`));
    });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259', chargingDurationHours: 4, chargerPowerKW: 11 },
      callAction,
    });

    expect(result.success).toBe(true);
    expect(result.blueprintId).toBe('ev-charging-co2-optimization-v1');
    expect(result.postProcessing.chargingEnergyKWh).toBe(44);
    expect(result.postProcessing.optimalChargingWindow).not.toBeNull();
    expect(result.postProcessing.optimalChargingWindow.windowSize).toBe(4);
    expect(result.l3Facts.evChargingPostalCode).toBe('68259');
  });

  test('synthesis message contains postalCode', async () => {
    const blueprint = loadBlueprint('ev-charging-co2-optimization-v1');
    const callAction = jest.fn().mockImplementation((action) => {
      if (action === 'energy-market.co2Intensity') {
        return Promise.resolve({ data: { forecast: co2Forecast } });
      }
      return Promise.resolve({});
    });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '12345', chargingDurationHours: 4, chargerPowerKW: 11 },
      callAction,
    });

    expect(result.success).toBe(true);
    expect(result.synthesis.message).toContain('12345');
  });
});
