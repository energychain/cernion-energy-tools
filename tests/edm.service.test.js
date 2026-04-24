'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const EdmService = require('../services/edm.service');

function createTempDir() {
  return path.join(
    os.tmpdir(),
    `edm-service-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe('edm.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = createTempDir();
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          async handler() {
            return {
              success: true,
              data: {
                results: [
                  {
                    mastrNummer: 'SEE123',
                    type: 'solar',
                    napData: {
                      messlokation: 'DE0012345678901234567890123456789',
                      napMastrNummer: 'SAN123',
                      spannungsebene: 'Niederspannung',
                      netzbetreiberMastrNummer: 'SNB935578300972',
                    },
                  },
                  {
                    mastrNummer: 'SEE999',
                    type: 'wind',
                  },
                ],
              },
            };
          },
        },
      },
    });

    broker.createService({
      ...EdmService,
      settings: {
        ...EdmService.settings,
        dbPath,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it("Service name ist 'edm'", () => {
    expect(EdmService.name).toBe('edm');
  });

  it('createMelo: physische MeLo erstellt', async () => {
    const res = await broker.call('edm.createMelo', {
      meloId: 'DE_PHYSICAL_1',
      type: 'physical',
      obisRegisters: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
    });

    expect(res.success).toBe(true);
    expect(res.type).toBe('physical');
  });

  it('createMelo: virtuelle MeLo erstellt', async () => {
    const res = await broker.call('edm.createMelo', {
      meloId: 'VIRTUAL_1',
      type: 'virtual',
    });

    expect(res.success).toBe(true);
    expect(res.type).toBe('virtual');
  });

  it('createMelo: dummy MeLo erstellt', async () => {
    const res = await broker.call('edm.createMelo', {
      meloId: 'DUMMY_1',
      type: 'dummy',
    });

    expect(res.success).toBe(true);
    expect(res.type).toBe('dummy');
  });

  it('createMelo: Duplikat wirft Fehler', async () => {
    await expect(
      broker.call('edm.createMelo', {
        meloId: 'DE_PHYSICAL_1',
        type: 'physical',
      })
    ).rejects.toMatchObject({ code: 409 });
  });

  it('getMelo: gibt erstellte MeLo mit geparstem obisRegisters zurück', async () => {
    const res = await broker.call('edm.getMelo', { meloId: 'DE_PHYSICAL_1' });

    expect(res.success).toBe(true);
    expect(Array.isArray(res.data.obisRegisters)).toBe(true);
  });

  it('getMelo: 404 für unbekannte MeLo', async () => {
    await expect(broker.call('edm.getMelo', { meloId: 'UNKNOWN' })).rejects.toMatchObject({
      code: 404,
    });
  });

  it('listMelos: alle MeLos', async () => {
    const res = await broker.call('edm.listMelos');
    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(3);
  });

  it("listMelos: Filter nach type='virtual'", async () => {
    const res = await broker.call('edm.listMelos', { type: 'virtual' });
    expect(res.data.length).toBe(1);
    expect(res.data[0].type).toBe('virtual');
  });

  it('listMelos: Filter nach gridOperatorMastrId', async () => {
    await broker.call('edm.createMelo', {
      meloId: 'GRID_FILTER_1',
      type: 'physical',
      gridOperatorMastrId: 'SNB_FILTER',
    });

    const res = await broker.call('edm.listMelos', {
      gridOperatorMastrId: 'SNB_FILTER',
    });

    expect(res.data.length).toBe(1);
    expect(res.data[0].gridOperatorMastrId).toBe('SNB_FILTER');
  });

  it("listMelos: Filter nach sourceType='mscons'", async () => {
    await broker.call('edm.createMelo', {
      meloId: 'MSCONS_FILTER_1',
      type: 'physical',
      sourceType: 'mscons',
    });

    const res = await broker.call('edm.listMelos', {
      sourceType: 'mscons',
    });

    expect(res.data.length).toBeGreaterThanOrEqual(1);
    expect(res.data.every((item) => item.sourceType === 'mscons')).toBe(true);
  });

  it('updateMelo: Name aktualisiert, updated_at ändert sich', async () => {
    const before = await broker.call('edm.getMelo', { meloId: 'DE_PHYSICAL_1' });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const updated = await broker.call('edm.updateMelo', {
      meloId: 'DE_PHYSICAL_1',
      name: 'Neue MeLo Bezeichnung',
    });

    expect(updated.success).toBe(true);
    expect(updated.data.name).toBe('Neue MeLo Bezeichnung');
    expect(updated.data.updatedAt).not.toBe(before.data.updatedAt);
  });

  it('deleteMelo: MeLo gelöscht, getMelo danach 404', async () => {
    await broker.call('edm.createMelo', {
      meloId: 'DELETE_ME',
      type: 'dummy',
    });

    const del = await broker.call('edm.deleteMelo', { meloId: 'DELETE_ME' });
    expect(del.success).toBe(true);

    await expect(broker.call('edm.getMelo', { meloId: 'DELETE_ME' })).rejects.toMatchObject({
      code: 404,
    });
  });

  it('createFromMastr: erstellt MeLos aus napData.messlokation', async () => {
    const res = await broker.call('edm.createFromMastr', {
      gridOperatorMastrId: 'SNB935578300972',
      type: 'all',
      limit: 100,
    });

    expect(res.success).toBe(true);
    expect(res.created).toBeGreaterThanOrEqual(1);
    expect(res.melos[0].meloId).toBe('DE0012345678901234567890123456789');
  });

  describe('edm.service — timeseries', () => {
    const TEST_MELO = 'TS_TEST_MELO_1';

    beforeAll(async () => {
      await broker.call('edm.createMelo', {
        meloId: TEST_MELO,
        type: 'physical',
        gridOperatorMastrId: 'SNB_TEST_001',
        obisRegisters: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
      });
    });

    test('importTimeseries — JSON array', async () => {
      const data = [
        { ts: '2026-04-01T00:00:00.000Z', value: 12.4 },
        { ts: '2026-04-01T00:15:00.000Z', value: 11.8 },
        { ts: '2026-04-01T00:30:00.000Z', value: 13.1 },
        { ts: '2026-04-01T00:45:00.000Z', value: 12.9 },
      ];
      const result = await broker.call('edm.importTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        format: 'json',
        data,
      });
      expect(result.success).toBe(true);
      expect(result.imported).toBe(4);
      expect(result.partitions).toContain('2026_Q2');
    });

    test('importTimeseries — CSV string', async () => {
      const csv = 'ts;val\n2026-04-01T01:00:00.000Z;14.2\n2026-04-01T01:15:00.000Z;13.9';
      const result = await broker.call('edm.importTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        format: 'csv',
        config: { delimiter: ';', timestampColumn: 'ts', valueColumn: 'val', timestampFormat: 'ISO' },
        data: csv,
      });
      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
    });

    test('importTimeseries — 404 wenn MeLo nicht existiert', async () => {
      await expect(
        broker.call('edm.importTimeseries', {
          meloId: 'NONEXISTENT',
          data: [{ ts: '2026-04-01T00:00:00Z', value: 1 }],
        })
      ).rejects.toMatchObject({ code: 404 });
    });

    test('getTimeseries — Raw 15-min Daten', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-01T02:00:00.000Z',
        resolution: '15min',
      });
      expect(result.success).toBe(true);
      expect(result.values.length).toBe(6);
      expect(result.summary.total_kwh).toBeGreaterThan(0);
    });

    test('getTimeseries — hourly Aggregation', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-01T02:00:00.000Z',
        resolution: 'hourly',
      });
      expect(result.values.length).toBe(2);
      expect(result.values[0].value).toBeCloseTo(12.4 + 11.8 + 13.1 + 12.9, 1);
    });

    test('getTimeseries — daily Aggregation', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        resolution: 'daily',
      });
      expect(result.values.length).toBe(1);
      expect(result.values[0].value).toBeCloseTo(12.4 + 11.8 + 13.1 + 12.9 + 14.2 + 13.9, 1);
    });

    test('getTimeseries — CSV format', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-01T02:00:00.000Z',
        format: 'csv',
      });
      expect(typeof result).toBe('string');
      expect(result).toContain('ts;value;quality');
      const lines = result.trim().split('\n');
      expect(lines.length).toBe(7);
    });

    test('getTimeseriesSummary — daily grouping', async () => {
      const result = await broker.call('edm.getTimeseriesSummary', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        groupBy: 'day',
      });
      expect(result.success).toBe(true);
      expect(result.groups.length).toBe(1);
      expect(result.groups[0].total_kwh).toBeGreaterThan(0);
      expect(result.groups[0].count).toBe(6);
    });

    test('getTimeseriesSummary — monthly grouping', async () => {
      const result = await broker.call('edm.getTimeseriesSummary', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-30T23:59:59.000Z',
        groupBy: 'month',
      });
      expect(result.success).toBe(true);
      expect(result.groups.length).toBe(1);
      expect(result.groups[0].period).toBe('2026-04');
    });

    test('deleteTimeseries — löscht Daten im Zeitraum', async () => {
      const deleted = await broker.call('edm.deleteTimeseries', {
        meloId: TEST_MELO,
        from: '2026-04-01T01:00:00.000Z',
        to: '2026-04-01T02:00:00.000Z',
      });
      expect(deleted.success).toBe(true);
      expect(deleted.deleted).toBe(2);

      const remaining = await broker.call('edm.getTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
      });
      expect(remaining.values.length).toBe(4);
    });

    test('Cross-Quarter-Query — Daten über Q1/Q2-Grenze', async () => {
      await broker.call('edm.importTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        format: 'json',
        data: [
          { ts: '2026-03-31T23:00:00.000Z', value: 5.0 },
          { ts: '2026-03-31T23:15:00.000Z', value: 5.5 },
        ],
      });

      const result = await broker.call('edm.getTimeseries', {
        meloId: TEST_MELO,
        obis: '1-0:2.8.0',
        from: '2026-03-31T23:00:00.000Z',
        to: '2026-04-01T01:00:00.000Z',
      });
      expect(result.values.length).toBe(6);
      expect(result.summary.total_kwh).toBeGreaterThan(0);
    });
  });
});
