'use strict';

const { ServiceBroker } = require('moleculer');
const FlexService = require('../services/flex.service');

describe('flex.service', () => {
  let broker;
  const store = new Map();

  function getNs(namespace) {
    if (!store.has(namespace)) {
      store.set(namespace, new Map());
    }
    return store.get(namespace);
  }

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'object-store',
      actions: {
        put: {
          handler(ctx) {
            const { namespace, key, payload } = ctx.params;
            const ns = getNs(namespace);
            ns.set(key, payload);
            return { namespace, key, payload };
          },
        },
        get: {
          handler(ctx) {
            const { namespace, key } = ctx.params;
            const ns = getNs(namespace);
            if (!ns.has(key)) {
              const err = new Error('Not found');
              err.code = 404;
              err.type = 'OBJECT_NOT_FOUND';
              throw err;
            }
            return { namespace, key, payload: ns.get(key) };
          },
        },
        list: {
          handler(ctx) {
            const { namespace } = ctx.params;
            const ns = getNs(namespace);
            return {
              data: [...ns.entries()].map(([key, payload]) => ({ key, payload })),
            };
          },
        },
        query: {
          handler(ctx) {
            const { namespace } = ctx.params;
            const ns = getNs(namespace);
            return {
              docs: [...ns.entries()].map(([key, payload]) => ({ key, payload })),
            };
          },
        },
      },
    });

    broker.createService({
      name: 'mqtt-broker',
      actions: {
        publish: {
          handler() {
            return { success: true };
          },
        },
      },
    });

    broker.createService({
      name: 'forecast-engine',
      actions: {
        forecastLoad: {
          handler() {
            return {
              forecast: {
                values: Array.from({ length: 96 }, (_, i) => ({
                  ts: new Date(Date.UTC(2026, 3, 20, 0, i * 15, 0)).toISOString(),
                  value: i >= 72 && i <= 84 ? 23.75 : 15,
                })),
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'edm',
      actions: {
        getTimeseries: {
          handler() {
            return { values: [] };
          },
        },
      },
    });

    broker.createService(FlexService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  test('registerDevice: registriert Wallbox', async () => {
    const result = await broker.call('flex.registerDevice', {
      deviceId: 'wb_test_001',
      type: 'wallbox',
      capacityKw: 11,
      minDimmingKw: 4.2,
      customerName: 'Max Mustermann',
      postalCode: '66989',
    });

    expect(result.success).toBe(true);
    expect(result.section14aStatus).toBe('registered');
  });

  test('registerDevice: registriert Speicher', async () => {
    const result = await broker.call('flex.registerDevice', {
      deviceId: 'bat_test_001',
      type: 'storage',
      capacityKw: 10,
    });

    expect(result.success).toBe(true);
  });

  test('listDevices: zeigt registrierte Geräte', async () => {
    const result = await broker.call('flex.listDevices');
    expect(result.data.length).toBeGreaterThanOrEqual(2);
  });

  test('getDevice: gibt Gerätedaten zurück', async () => {
    const result = await broker.call('flex.getDevice', {
      deviceId: 'wb_test_001',
    });

    expect(result.payload.type).toBe('wallbox');
    expect(result.payload.capacityKw).toBe(11);
  });

  test('updateDeviceStatus: setzt auf maintenance', async () => {
    const result = await broker.call('flex.updateDeviceStatus', {
      deviceId: 'wb_test_001',
      status: 'maintenance',
    });

    expect(result.success).toBe(true);

    await broker.call('flex.updateDeviceStatus', {
      deviceId: 'wb_test_001',
      status: 'active',
    });
  });

  test('planDimming: erstellt Dimming-Plan', async () => {
    const result = await broker.call('flex.planDimming', {
      date: '2026-04-20',
      gridCapacityKw: 100,
      loadForecastOverride: Array.from({ length: 96 }, (_, i) => ({
        ts: new Date(Date.UTC(2026, 3, 20, 0, i * 15, 0)).toISOString(),
        value: i >= 72 && i <= 84 ? 95 : 60,
      })),
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalEvents).toBeGreaterThanOrEqual(0);
  });

  test('executeDimming: sendet MQTT-Befehl', async () => {
    const result = await broker.call('flex.executeDimming', {
      deviceId: 'wb_test_001',
      durationMinutes: 30,
      dimmedPowerKw: 4.2,
    });

    expect(result.success).toBe(true);
    expect(result.executedEvents).toBeGreaterThanOrEqual(1);
  });

  test('getReliefProof: gibt Entlastungsnachweis zurück', async () => {
    const result = await broker.call('flex.getReliefProof', {
      period: '2026-04',
    });

    expect(result.success).toBe(true);
    expect(result.proof).toBeDefined();
  });

  test('getTariffReduction: berechnet Netzentgelt-Reduktion', async () => {
    const result = await broker.call('flex.getTariffReduction', {
      deviceId: 'wb_test_001',
    });

    expect(result.success).toBe(true);
    expect(result.reduction.annualReduction_eur).toBeGreaterThan(0);
  });
});
