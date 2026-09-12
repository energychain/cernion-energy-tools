'use strict';

const { ServiceBroker } = require('moleculer');
const ForecastSandboxService = require('../services/forecast-sandbox.service');
const { ERROR_CODES, SANDBOX_VERSION } = require('../src/forecast-sandbox-baseline');

const TIMEZONE = 'Europe/Berlin';
const QUARTER_HOUR_MS = 15 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Emits explicit +01:00/+02:00 local offsets (matching real payloads) rather than UTC "Z"
// timestamps. All ranges used in these tests stay clear of a DST transition, so a single
// fixed offset for the whole range is exact. See tests/forecast-sandbox-baseline.test.js
// for why this matters (Europe/Berlin calendar-day bucketing vs. UTC "Z" instants).
function constantSeries(startDateIso, days, value) {
  const [y, m, d] = startDateIso.split('-').map(Number);
  const offsetMinutes = m >= 4 && m <= 9 ? 120 : 60;
  const offsetStr = `+${pad2(offsetMinutes / 60)}:00`;
  let wallMs = Date.UTC(y, m - 1, d, 0, 0, 0);
  const rows = [];
  for (let i = 0; i < days * 96; i += 1) {
    const wall = new Date(wallMs);
    const ts = `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}T${pad2(
      wall.getUTCHours()
    )}:${pad2(wall.getUTCMinutes())}:00${offsetStr}`;
    rows.push({ ts, value });
    wallMs += QUARTER_HOUR_MS;
  }
  return rows;
}

describe('forecast-sandbox.service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(ForecastSandboxService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('exposes REST aliases matching CR-CET-FORECAST-SANDBOX-V0.1', () => {
    const schema = broker.getLocalService('forecast-sandbox').schema;
    expect(schema.actions.validateConsumptionSeries.rest).toBe('POST /consumption/validate');
    expect(schema.actions.dayAheadConsumption.rest).toBe('POST /consumption/day-ahead');
    expect(schema.actions.backtestConsumption.rest).toBe('POST /consumption/backtest');
    expect(schema.actions.openapi.rest).toBe('GET /openapi.json');
  });

  it('validateConsumptionSeries returns a commercialBoundary and no HTTP error status on success', async () => {
    const meta = {};
    const result = await broker.call(
      'forecast-sandbox.validateConsumptionSeries',
      {
        seriesId: 'cells-demo-001',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        values: constantSeries('2025-06-01', 1, 10),
      },
      { meta }
    );

    expect(result.status).toBe('ok');
    expect(result.commercialBoundary).toMatchObject({ productionUse: false, sla: false });
    expect(meta.$statusCode).toBeUndefined();
  });

  it('validateConsumptionSeries returns a structured error and sets $statusCode 400 for a bad payload', async () => {
    const meta = {};
    const result = await broker.call(
      'forecast-sandbox.validateConsumptionSeries',
      {
        seriesId: 'bad-unit',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'MWh',
        values: constantSeries('2025-06-01', 1, 10),
      },
      { meta }
    );

    expect(result.status).toBe('error');
    expect(result.sandboxVersion).toBe(SANDBOX_VERSION);
    expect(result.error.code).toBe(ERROR_CODES.UNSUPPORTED_UNIT);
    expect(meta.$statusCode).toBe(400);
  });

  it('dayAheadConsumption produces 96 intervals with method metadata', async () => {
    const result = await broker.call('forecast-sandbox.dayAheadConsumption', {
      seriesId: 'cells-demo-001',
      forecastDate: '2026-09-16',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      historicalValues: constantSeries('2025-06-01', 30, 10),
    });

    expect(result.status).toBe('ok');
    expect(result.method.id).toBe('baseline_weekday_profile_v0');
    expect(result.forecast).toHaveLength(96);
    expect(result.commercialBoundary.forecastQualityGuarantee).toBe(false);
  });

  it('dayAheadConsumption rejects a malformed forecastDate via moleculer params validation', async () => {
    await expect(
      broker.call('forecast-sandbox.dayAheadConsumption', {
        seriesId: 'cells-demo-001',
        forecastDate: 'not-a-date',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        historicalValues: constantSeries('2025-06-01', 30, 10),
      })
    ).rejects.toThrow();
  });

  it('backtestConsumption computes metrics and readiness', async () => {
    const result = await broker.call('forecast-sandbox.backtestConsumption', {
      seriesId: 'cells-demo-001',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      trainFrom: '2024-01-01',
      trainTo: '2024-03-01',
      testFrom: '2025-01-01',
      testTo: '2025-01-07',
      historicalValues: constantSeries('2024-01-01', 60, 10),
      actualValues: constantSeries('2025-01-01', 7, 10),
    });

    expect(result.status).toBe('ok');
    expect(result.metrics).toHaveProperty('maeKwh');
    expect(result.metrics).toHaveProperty('rmseKwh');
    expect(result.metrics).toHaveProperty('mapePercent');
    expect(result.metrics).toHaveProperty('biasKwh');
    expect(result.readiness.backtestReady).toBe(true);
  });

  it('backtestConsumption returns a structured error with $statusCode 400 for an invalid period', async () => {
    const meta = {};
    const result = await broker.call(
      'forecast-sandbox.backtestConsumption',
      {
        seriesId: 'bad-period',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        trainFrom: '2024-01-01',
        trainTo: '2025-06-01',
        testFrom: '2025-01-01',
        testTo: '2025-01-07',
        historicalValues: constantSeries('2024-01-01', 60, 10),
        actualValues: constantSeries('2025-01-01', 7, 10),
      },
      { meta }
    );

    expect(result.status).toBe('error');
    expect(result.error.code).toBe(ERROR_CODES.INVALID_BACKTEST_PERIOD);
    expect(meta.$statusCode).toBe(400);
  });

  it('openapi action returns a standalone OpenAPI 3.x document scoped to this service', async () => {
    const spec = await broker.call('forecast-sandbox.openapi');
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('Cernion Forecast Sandbox API');
    expect(Object.keys(spec.paths).sort()).toEqual(
      [
        '/api/forecast-sandbox/consumption/validate',
        '/api/forecast-sandbox/consumption/day-ahead',
        '/api/forecast-sandbox/consumption/backtest',
        '/api/forecast-sandbox/openapi.json',
      ].sort()
    );
  });
});
