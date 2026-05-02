'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');
const ForecastEngineService = require('../services/forecast-engine.service');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

describe('forecast-engine.service', () => {
  const TEST_MELO = 'FORECAST_TEST_MELO';

  let broker;
  let edmPath;
  const objectStoreMap = new Map();

  beforeAll(async () => {
    edmPath = createTempDir('edm-forecast-engine');

    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      ...EdmService,
      settings: {
        ...EdmService.settings,
        dbPath: edmPath,
      },
    });

    broker.createService({
      ...SlpService,
      settings: {
        ...SlpService.settings,
        dbPath: edmPath,
      },
    });

    broker.createService({
      name: 'object-store',
      actions: {
        put: {
          handler(ctx) {
            const { namespace, key, payload } = ctx.params;
            if (!objectStoreMap.has(namespace)) {
              objectStoreMap.set(namespace, new Map());
            }
            objectStoreMap.get(namespace).set(key, payload);
            return { success: true, namespace, key, payload };
          },
        },
        get: {
          handler(ctx) {
            const { namespace, key } = ctx.params;
            const ns = objectStoreMap.get(namespace);
            if (!ns || !ns.has(key)) {
              const error = new Error('Document not found');
              error.code = 404;
              error.type = 'OBJECT_NOT_FOUND';
              throw error;
            }
            return { namespace, key, payload: ns.get(key) };
          },
        },
        list: {
          handler(ctx) {
            const ns = objectStoreMap.get(ctx.params.namespace) || new Map();
            return {
              data: [...ns.entries()].map(([key, payload]) => ({ key, payload })),
            };
          },
        },
      },
    });

    broker.createService(ForecastEngineService);

    await broker.start();

    await broker.call('edm.createMelo', {
      meloId: TEST_MELO,
      type: 'physical',
      sourceType: 'manual',
      obisRegisters: [{ obis: '1-0:1.8.0', direction: 'consumption' }],
    });

    const baseTs = Date.parse('2026-04-13T00:00:00Z');
    const values = [];

    for (let day = 0; day < 7; day += 1) {
      for (let i = 0; i < 96; i += 1) {
        values.push({
          ts: new Date(baseTs + (day * 96 + i) * 15 * 60 * 1000).toISOString(),
          value: 0.08 + (i % 24) * 0.002,
          quality: 'measured',
          source: 'test',
        });
      }
    }

    await broker.call('edm.importTimeseries', {
      meloId: TEST_MELO,
      obis: '1-0:1.8.0',
      format: 'json',
      data: values,
    });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(edmPath, { recursive: true, force: true });
  });

  test('forecastLoad: generiert 96-Punkt-Prognose', async () => {
    const result = await broker.call('forecast-engine.forecastLoad', {
      profileId: 'H0',
      date: '2026-04-20',
      annualConsumptionKwh: 3500,
    });
    expect(result.success).toBe(true);
    expect(result.forecast.values.length).toBe(96);
    expect(result.forecast.totalKwh).toBeGreaterThan(5);
  });

  test('forecastLoad: mit meloId nutzt historische Korrektur', async () => {
    const result = await broker.call('forecast-engine.forecastLoad', {
      meloId: TEST_MELO,
      profileId: 'H0',
      date: '2026-04-20',
      annualConsumptionKwh: 3500,
    });
    expect(result.success).toBe(true);
    expect(['slp_corrected', 'slp_only', 'slp_temperature_corrected']).toContain(
      result.forecast.method
    );
  });

  test('forecastGeneration: gibt Prognose zurück (Fallback)', async () => {
    const result = await broker.call('forecast-engine.forecastGeneration', {
      postleitzahl: '66989',
      installationType: 'solar',
      date: '2026-04-20',
    });
    expect(result.success).toBe(true);
    expect(result.source).toBe('fallback');
  });

  test('forecastResidual: berechnet Residuallast', async () => {
    const result = await broker.call('forecast-engine.forecastResidual', {
      profileId: 'H0',
      annualConsumptionKwh: 3500,
      postleitzahl: '66989',
      date: '2026-04-20',
    });
    expect(result.success).toBe(true);
    expect(result.residual.intervals.length).toBeGreaterThan(0);
    expect(result.residual.summary).toBeDefined();
  });

  test('createSchedule: erstellt Day-Ahead-Fahrplan', async () => {
    const result = await broker.call('forecast-engine.createSchedule', {
      date: '2026-04-20',
      profileId: 'H0',
      annualConsumptionKwh: 3500,
      postleitzahl: '66989',
    });
    expect(result.success).toBe(true);
    expect(result.scheduleId).toBeTruthy();
    expect(result.schedule.length).toBeGreaterThan(0);
  });

  test('getSchedule: gespeicherter Fahrplan abrufbar', async () => {
    const list = await broker.call('forecast-engine.listSchedules');
    expect(list.data.length).toBeGreaterThanOrEqual(1);

    const schedule = await broker.call('forecast-engine.getSchedule', {
      scheduleId: list.data[0].key,
    });
    expect(schedule.payload).toBeDefined();
  });

  test('evaluateQuality: RMSE/MAE/MAPE für Testdaten', async () => {
    const result = await broker.call('forecast-engine.evaluateQuality', {
      meloId: TEST_MELO,
      from: '2026-04-13T00:00:00Z',
      to: '2026-04-14T00:00:00Z',
      profileId: 'H0',
      annualConsumptionKwh: 3500,
    });
    expect(result.success).toBe(true);
    expect(result.quality.rmse).toBeDefined();
    expect(result.quality.mape).toBeDefined();
    expect(result.quality.rating).toBeDefined();
  });

  test('storageDispatch: Speicher-Optimierung', async () => {
    const result = await broker.call('forecast-engine.storageDispatch', {
      date: '2026-04-20',
      profileId: 'H0',
      annualConsumptionKwh: 3500,
      postleitzahl: '66989',
      storageConfig: {
        capacityKwh: 10,
        maxChargePowerKw: 5,
        maxDischargePowerKw: 5,
        efficiency: 0.92,
        currentSocPercent: 50,
      },
    });
    expect(result.success).toBe(true);
    expect(result.dispatch.length).toBeGreaterThan(0);
    expect(result.summary.storageCycles).toBeGreaterThanOrEqual(0);
  });
});
