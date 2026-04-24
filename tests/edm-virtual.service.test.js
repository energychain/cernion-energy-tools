'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');
const EdmMesskonzeptService = require('../services/edm-messkonzept.service');
const EdmVirtualService = require('../services/edm-virtual.service');

function createTempDir() {
  return path.join(
    os.tmpdir(),
    `edm-virtual-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe('edm-virtual.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = createTempDir();
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      ...EdmService,
      settings: {
        ...EdmService.settings,
        dbPath,
      },
    });

    broker.createService({
      ...SlpService,
      settings: {
        ...SlpService.settings,
        dbPath,
      },
    });

    broker.createService(EdmMesskonzeptService);
    broker.createService(EdmVirtualService);

    await broker.start();

    await broker.call('edm.createMelo', {
      meloId: 'VIRTUAL_POP_1',
      type: 'virtual',
      sourceType: 'forecast',
      obisRegisters: [{ obis: '1-0:1.8.0' }],
    });

    await broker.call('edm.createMelo', {
      meloId: 'DUMMY_POP_1',
      type: 'dummy',
      sourceType: 'manual',
      obisRegisters: [{ obis: '1-0:1.8.0' }],
    });

    await broker.call('edm.createMelo', {
      meloId: 'PHYSICAL_NOT_ALLOWED',
      type: 'physical',
      sourceType: 'manual',
      obisRegisters: [{ obis: '1-0:1.8.0' }],
    });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  test('populateBySlp populates one virtual melo', async () => {
    const result = await broker.call('edm-virtual.populateBySlp', {
      meloId: 'VIRTUAL_POP_1',
      date: '2026-05-01',
      profileId: 'H0',
      annualConsumptionKwh: 3000,
      overwriteExisting: true,
    });

    expect(result.success).toBe(true);
    expect(result.imported).toBe(96);

    const ts = await broker.call('edm.getTimeseries', {
      meloId: 'VIRTUAL_POP_1',
      obis: '1-0:1.8.0',
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-01T23:59:59.999Z',
      resolution: '15min',
    });

    expect(ts.values.length).toBe(96);
  });

  test('populateBySlp rejects physical melo', async () => {
    await expect(
      broker.call('edm-virtual.populateBySlp', {
        meloId: 'PHYSICAL_NOT_ALLOWED',
        date: '2026-05-01',
      })
    ).rejects.toMatchObject({ code: 422 });
  });

  test('autoPopulateDay populates all virtual and dummy melos', async () => {
    const result = await broker.call('edm-virtual.autoPopulateDay', {
      date: '2026-05-02',
      typeFilter: 'all',
      includeCalc: false,
      includeSlp: true,
      overwriteExisting: true,
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.slpPopulated).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(result.failures)).toBe(true);
    expect(result.failures.length).toBe(0);
  });
});
