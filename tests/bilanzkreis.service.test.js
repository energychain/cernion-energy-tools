'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');
const BilanzkreisService = require('../services/bilanzkreis.service');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

describe('bilanzkreis.service', () => {
  const MELO_PV = 'BK_TEST_PV';
  const MELO_CONSUMER = 'BK_TEST_CONSUMER';

  let broker;
  let edmPath;

  const objectStoreMap = new Map();

  beforeAll(async () => {
    edmPath = createTempDir('edm-bk');

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
        delete: {
          handler(ctx) {
            const { namespace, key } = ctx.params;
            const ns = objectStoreMap.get(namespace);
            if (ns) ns.delete(key);
            return { success: true, namespace, key };
          },
        },
      },
    });

    broker.createService(BilanzkreisService);

    await broker.start();

    await broker.call('edm.createMelo', {
      meloId: MELO_PV,
      type: 'physical',
      sourceType: 'manual',
      obisRegisters: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
    });

    await broker.call('edm.createMelo', {
      meloId: MELO_CONSUMER,
      type: 'physical',
      sourceType: 'manual',
      obisRegisters: [{ obis: '1-0:1.8.0', direction: 'consumption' }],
    });

    const baseTs = Date.parse('2026-04-01T00:00:00Z');
    const pvValues = [100, 120, 80, 0].map((value, index) => ({
      ts: new Date(baseTs + index * 15 * 60 * 1000).toISOString(),
      value,
      quality: 'measured',
      source: 'test',
    }));
    const consumerValues = [30, 35, 40, 50].map((value, index) => ({
      ts: new Date(baseTs + index * 15 * 60 * 1000).toISOString(),
      value,
      quality: 'measured',
      source: 'test',
    }));

    await broker.call('edm.importTimeseries', {
      meloId: MELO_PV,
      obis: '1-0:2.8.0',
      format: 'json',
      data: pvValues,
    });

    await broker.call('edm.importTimeseries', {
      meloId: MELO_CONSUMER,
      obis: '1-0:1.8.0',
      format: 'json',
      data: consumerValues,
    });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(edmPath, { recursive: true, force: true });
  });

  test('create: erstellt virtuellen Energy-Sharing BK', async () => {
    const result = await broker.call('bilanzkreis.create', {
      id: 'bk_es_test',
      name: 'Energy Sharing Test-Quartier',
      type: 'virtual_energy_sharing',
      participants: [
        { meloId: MELO_PV, role: 'producer', share: 1.0 },
        { meloId: MELO_CONSUMER, role: 'consumer', share: 1.0 },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.participantCount).toBe(2);
  });

  test('list: zeigt erstellten BK', async () => {
    const result = await broker.call('bilanzkreis.list');
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });

  test('get: gibt BK mit Participants zurück', async () => {
    const result = await broker.call('bilanzkreis.get', { id: 'bk_es_test' });
    expect(result.payload.type).toBe('virtual_energy_sharing');
    expect(result.payload.participants.length).toBe(2);
  });

  test('calculate: berechnet BK-Saldo', async () => {
    const result = await broker.call('bilanzkreis.calculate', {
      id: 'bk_es_test',
      from: '2026-04-01T00:00:00Z',
      to: '2026-04-01T01:00:00Z',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary.totalShared_kwh).toBeGreaterThanOrEqual(0);
  });

  test('checkReadiness: prüft Datenvollständigkeit', async () => {
    const result = await broker.call('bilanzkreis.checkReadiness', {
      id: 'bk_es_test',
      from: '2026-04-01T00:00:00Z',
      to: '2026-04-01T01:00:00Z',
    });

    expect(result.ready).toBeDefined();
    expect(typeof result.dataQuality).toBe('number');
  });

  test('delete: entfernt BK', async () => {
    const result = await broker.call('bilanzkreis.delete', { id: 'bk_es_test' });
    expect(result.success).toBe(true);
  });

  test('tenant isolation: gleicher BK-Key bleibt pro Tenant getrennt', async () => {
    const tenantA = { meta: { tenantId: 'stadtwerk-a' } };
    const tenantB = { meta: { tenantId: 'stadtwerk-b' } };

    await broker.call(
      'bilanzkreis.create',
      {
        id: 'bk_shared',
        name: 'Tenant A BK',
        type: 'virtual_energy_sharing',
        participants: [
          { meloId: MELO_PV, role: 'producer', share: 1.0 },
          { meloId: MELO_CONSUMER, role: 'consumer', share: 1.0 },
        ],
      },
      tenantA
    );

    await broker.call(
      'bilanzkreis.create',
      {
        id: 'bk_shared',
        name: 'Tenant B BK',
        type: 'virtual_energy_sharing',
        participants: [
          { meloId: MELO_PV, role: 'producer', share: 1.0 },
          { meloId: MELO_CONSUMER, role: 'consumer', share: 1.0 },
        ],
      },
      tenantB
    );

    const fromA = await broker.call('bilanzkreis.get', { id: 'bk_shared' }, tenantA);
    const fromB = await broker.call('bilanzkreis.get', { id: 'bk_shared' }, tenantB);
    const listA = await broker.call('bilanzkreis.list', {}, tenantA);
    const listB = await broker.call('bilanzkreis.list', {}, tenantB);

    expect(fromA.payload.name).toBe('Tenant A BK');
    expect(fromB.payload.name).toBe('Tenant B BK');
    expect(listA.data.some((item) => item.key === 'bk_shared')).toBe(true);
    expect(listB.data.some((item) => item.key === 'bk_shared')).toBe(true);
  });
});
