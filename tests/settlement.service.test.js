'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');
const ObjectStoreService = require('../services/object-store.service');
const SettlementService = require('../services/settlement.service');

function createTempPath(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

describe('settlement.service', () => {
  const MELO_SOLARPARK = 'DE0003966698900000000000052335107';
  const MASTR_SOLARPARK = 'SEE999952467552';

  let broker;
  let edmPath;
  let objectStorePath;

  beforeAll(async () => {
    edmPath = createTempPath('edm-settlement');
    objectStorePath = createTempPath('object-store-settlement');

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
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: objectStorePath,
      },
    });

    broker.createService({
      name: 'forecast',
      actions: {
        generationForecast: {
          handler() {
            const base = Date.parse('2026-04-01T10:00:00.000Z');
            const values = Array.from({ length: 8 }, (_, i) => ({
              ts: new Date(base + i * 15 * 60 * 1000).toISOString(),
              value: 300 + i * 10,
            }));
            return { success: true, values };
          },
        },
      },
    });

    broker.createService({
      name: 'entsoe',
      actions: {
        dayAheadPrices: {
          handler() {
            return {
              success: true,
              prices: [
                { timestamp: '2026-04-01T10:00:00.000Z', price: 60 },
                { timestamp: '2026-04-01T11:00:00.000Z', price: 55 },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler() {
            return {
              data: {
                installations: [
                  {
                    mastrNummer: MASTR_SOLARPARK,
                    inbetriebnahmedatum: '2009-12-16',
                    nettonennleistung: 2103.7,
                    type: 'solar',
                    napData: {
                      messlokation: MELO_SOLARPARK,
                    },
                  },
                ],
              },
            };
          },
        },
      },
    });

    broker.createService(SettlementService);

    await broker.start();

    await broker.call('edm.createMelo', {
      meloId: MELO_SOLARPARK,
      type: 'physical',
      installationMastrNummer: MASTR_SOLARPARK,
      sourceType: 'manual',
      obisRegisters: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
    });

    const base = Date.parse('2026-04-01T08:00:00.000Z');
    const actualRows = Array.from({ length: 32 }, (_, i) => ({
      ts: new Date(base + i * 15 * 60 * 1000).toISOString(),
      value: 150 + (i % 8) * 6,
      quality: 'measured',
      source: 'test',
    }));

    await broker.call('edm.importTimeseries', {
      meloId: MELO_SOLARPARK,
      obis: '1-0:2.8.0',
      format: 'json',
      data: actualRows,
    });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(edmPath, { recursive: true, force: true });
    fs.rmSync(objectStorePath, { recursive: true, force: true });
  });

  test('calculateRedispatch: berechnet Entschädigung', async () => {
    const result = await broker.call('settlement.calculateRedispatch', {
      installations: [
        {
          mastrNummer: MASTR_SOLARPARK,
          meloId: MELO_SOLARPARK,
          capacityKw: 2103.7,
          commissioningDate: '2009-12-16',
          type: 'solar',
          curtailmentEvents: [
            {
              start: '2026-04-01T10:00:00Z',
              end: '2026-04-01T12:00:00Z',
              reason: 'grid_congestion',
            },
          ],
        },
      ],
      period: { from: '2026-04-01', to: '2026-04-30' },
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalCompensation_eur).toBeGreaterThan(0);
    expect(result.summary.totalLostKwh).toBeGreaterThan(0);
  });

  test('getRedispatchReport: gespeichertes Settlement abrufbar', async () => {
    const list = await broker.call('settlement.listSettlements', {
      type: 'redispatch',
    });
    expect(list.data.length).toBeGreaterThanOrEqual(1);

    const report = await broker.call('settlement.getRedispatchReport', {
      settlementId: list.data[0].key,
    });
    expect(report.success).toBe(true);
    expect(report.events.length).toBeGreaterThan(0);
  });

  test('calculateEeg: berechnet EEG-Vergütung', async () => {
    const result = await broker.call('settlement.calculateEeg', {
      mastrNummer: MASTR_SOLARPARK,
      meloId: MELO_SOLARPARK,
      period: { from: '2026-04-01', to: '2026-04-30' },
      commissioningDate: '2009-12-16',
      capacityKwp: 2103.7,
      type: 'solar',
    });

    expect(result.success).toBe(true);
    expect(result.revenue_eur).toBeGreaterThanOrEqual(0);
    expect(result.tariff).toBeDefined();
  });

  test('lookupEegTariff: gibt Tarif zurück', async () => {
    const result = await broker.call('settlement.lookupEegTariff', {
      commissioningDate: '2024-03-15',
      capacityKwp: 10,
      type: 'solar',
    });
    expect(result.tariff).toBe(8.11);
  });

  test('prepareA96: formatiert als A96-Rows', async () => {
    const list = await broker.call('settlement.listSettlements', {
      type: 'redispatch',
    });

    const result = await broker.call('settlement.prepareA96', {
      settlementId: list.data[0].key,
    });

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.format).toBe('a96');
  });

  test('exportA96: CSV-Export', async () => {
    const list = await broker.call('settlement.listSettlements', {
      type: 'redispatch',
    });

    const csv = await broker.call('settlement.exportA96', {
      settlementId: list.data[0].key,
      format: 'csv',
    });

    expect(typeof csv).toBe('string');
    expect(csv).toContain('mastrNummer');
    expect(csv).toContain('compensation_eur');
  });

  test('tenant isolation: settlements bleiben pro Tenant getrennt', async () => {
    const tenantA = { meta: { tenantId: 'stadtwerk-a' } };
    const tenantB = { meta: { tenantId: 'stadtwerk-b' } };

    const resultA = await broker.call(
      'settlement.calculateRedispatch',
      {
        installations: [
          {
            mastrNummer: MASTR_SOLARPARK,
            meloId: MELO_SOLARPARK,
            capacityKw: 2103.7,
            commissioningDate: '2009-12-16',
            type: 'solar',
            curtailmentEvents: [
              {
                start: '2026-04-01T10:00:00Z',
                end: '2026-04-01T12:00:00Z',
                reason: 'grid_congestion',
              },
            ],
          },
        ],
        period: { from: '2026-04-01', to: '2026-04-30' },
      },
      tenantA
    );

    const listA = await broker.call('settlement.listSettlements', { type: 'redispatch' }, tenantA);
    const listB = await broker.call('settlement.listSettlements', { type: 'redispatch' }, tenantB);
    const reportA = await broker.call(
      'settlement.getRedispatchReport',
      { settlementId: resultA.settlementId },
      tenantA
    );

    expect(listA.count).toBeGreaterThanOrEqual(1);
    expect(listB.count).toBe(0);
    expect(reportA.success).toBe(true);
  });
});
