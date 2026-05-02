'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');

const HOEHEINOED_INSTALLATIONS = [
  {
    mastrNummer: 'SEE999952467552',
    name: 'Solarpark Höheinöd',
    type: 'solar',
    nettonennleistung: 2103.7,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2009-12-16T00:00:00.000Z',
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: {
      messlokation: 'DE0003966698900000000000052335107',
      spannungsebene: 352,
      spannungsebeneLabel: 'Mittelspannung (MV)',
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE969028349266',
    name: 'WEA Höheinöd HOE01',
    type: 'wind',
    nettonennleistung: 3300,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2016-09-26T00:00:00.000Z',
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: {
      messlokation: 'DE0003966698900000000000052335108',
      spannungsebene: 352,
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE976608984557',
    name: 'BHKW 1 Biogasanlage Höheinöd',
    type: 'biomass',
    nettonennleistung: 600,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2011-10-20T00:00:00.000Z',
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: {
      messlokation: 'DE0003966771400000000000053025164',
      spannungsebene: 352,
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE982890040772',
    name: 'Speicher',
    type: 'storage',
    nettonennleistung: 6.93,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2019-04-29T00:00:00.000Z',
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: {
      messlokation: 'DE0003966698900000000000052335109',
      spannungsebene: 354,
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
];

function createTempDir() {
  return path.join(
    os.tmpdir(),
    `edm-e2e-hoeheinoed-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe('EDM E2E Demo — Höheinöd (PLZ 66989)', () => {
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
                results: HOEHEINOED_INSTALLATIONS,
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

    broker.createService({
      ...SlpService,
      settings: {
        ...SlpService.settings,
        dbPath,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  describe('Phase A: MaStR → MeLo-Registry', () => {
    test('A1: createFromMastr erstellt MeLos aus PLZ 66989', async () => {
      const result = await broker.call('edm.createFromMastr', {
        postleitzahl: '66989',
      });
      expect(result.success).toBe(true);
      expect(result.created).toBe(4);
      expect(result.skipped).toBe(0);
    });

    test('A2: listMelos zeigt 4 physische MeLos', async () => {
      const result = await broker.call('edm.listMelos', { type: 'physical' });
      expect(result.data.length).toBe(4);
    });

    test('A3: Solarpark-MeLo hat korrekte OBIS-Register', async () => {
      const result = await broker.call('edm.getMelo', {
        meloId: 'DE0003966698900000000000052335107',
      });
      expect(result.success).toBe(true);
      expect(result.data.type).toBe('physical');
      expect(result.data.installationMastrNummer).toBe('SEE999952467552');
      const feedin = result.data.obisRegisters.find((register) => register.obis === '1-0:2.8.0');
      expect(feedin).toBeDefined();
    });

    test('A4: Speicher-MeLo hat Bezug + Einspeisung', async () => {
      const result = await broker.call('edm.getMelo', {
        meloId: 'DE0003966698900000000000052335109',
      });
      expect(result.data.obisRegisters.length).toBe(2);
      const obis = result.data.obisRegisters.map((register) => register.obis);
      expect(obis).toContain('1-0:1.8.0');
      expect(obis).toContain('1-0:2.8.0');
    });
  });

  describe('Phase B: Zeitreihen-Import', () => {
    test('B1: CSV-Import für Solarpark (deutsches Format)', async () => {
      const csv = [
        'Zeitstempel;Einspeisung_kWh',
        '01.04.2026 06:00;0.5',
        '01.04.2026 06:15;2.1',
        '01.04.2026 06:30;5.8',
        '01.04.2026 06:45;12.3',
        '01.04.2026 07:00;25.6',
        '01.04.2026 07:15;38.4',
        '01.04.2026 07:30;52.1',
        '01.04.2026 07:45;61.7',
      ].join('\n');

      const result = await broker.call('edm.importTimeseries', {
        meloId: 'DE0003966698900000000000052335107',
        obis: '1-0:2.8.0',
        format: 'csv',
        config: {
          delimiter: ';',
          timestampColumn: 'Zeitstempel',
          timestampFormat: 'DD.MM.YYYY HH:mm',
          valueColumn: 'Einspeisung_kWh',
          timezone: 'Europe/Berlin',
        },
        data: csv,
      });
      expect(result.success).toBe(true);
      expect(result.imported).toBe(8);
    });

    test('B2: JSON-Import für WEA (ISO-Format)', async () => {
      const data = [
        { ts: '2026-04-01T04:00:00.000Z', value: 820.5 },
        { ts: '2026-04-01T04:15:00.000Z', value: 795.3 },
        { ts: '2026-04-01T04:30:00.000Z', value: 810.7 },
        { ts: '2026-04-01T04:45:00.000Z', value: 835.2 },
      ];
      const result = await broker.call('edm.importTimeseries', {
        meloId: 'DE0003966698900000000000052335108',
        obis: '1-0:2.8.0',
        format: 'json',
        data,
      });
      expect(result.success).toBe(true);
      expect(result.imported).toBe(4);
    });

    test('B3: JSON-Import für Speicher (Bezug + Einspeisung)', async () => {
      await broker.call('edm.importTimeseries', {
        meloId: 'DE0003966698900000000000052335109',
        obis: '1-0:1.8.0',
        format: 'json',
        data: [
          { ts: '2026-04-01T02:00:00.000Z', value: 1.2 },
          { ts: '2026-04-01T02:15:00.000Z', value: 1.3 },
        ],
      });

      const result = await broker.call('edm.importTimeseries', {
        meloId: 'DE0003966698900000000000052335109',
        obis: '1-0:2.8.0',
        format: 'json',
        data: [
          { ts: '2026-04-01T18:00:00.000Z', value: 0.8 },
          { ts: '2026-04-01T18:15:00.000Z', value: 0.9 },
        ],
      });
      expect(result.imported).toBe(2);
    });
  });

  describe('Phase C: Zeitreihen-Query', () => {
    test('C1: getTimeseries 15-min Raw für Solarpark', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: 'DE0003966698900000000000052335107',
        obis: '1-0:2.8.0',
        from: '2026-03-31T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        resolution: '15min',
      });
      expect(result.success).toBe(true);
      expect(result.values.length).toBe(8);
      expect(result.summary.total_kwh).toBeGreaterThan(0);
    });

    test('C2: getTimeseries hourly Aggregation', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: 'DE0003966698900000000000052335107',
        obis: '1-0:2.8.0',
        from: '2026-03-31T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        resolution: 'hourly',
      });
      expect(result.values.length).toBe(2);
    });

    test('C3: getTimeseries daily Aggregation', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: 'DE0003966698900000000000052335107',
        obis: '1-0:2.8.0',
        from: '2026-03-31T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        resolution: 'daily',
      });
      expect(result.values.length).toBe(1);
      expect(result.values[0].value).toBeCloseTo(
        0.5 + 2.1 + 5.8 + 12.3 + 25.6 + 38.4 + 52.1 + 61.7,
        0
      );
    });

    test('C4: getTimeseriesSummary daily für WEA', async () => {
      const result = await broker.call('edm.getTimeseriesSummary', {
        meloId: 'DE0003966698900000000000052335108',
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        groupBy: 'day',
      });
      expect(result.success).toBe(true);
      expect(result.groups.length).toBe(1);
      expect(result.groups[0].count).toBe(4);
      expect(result.groups[0].total_kwh).toBeCloseTo(820.5 + 795.3 + 810.7 + 835.2, 0);
    });

    test('C5: CSV-Export-Format', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: 'DE0003966698900000000000052335108',
        obis: '1-0:2.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        format: 'csv',
      });
      expect(typeof result).toBe('string');
      expect(result).toContain('ts');
      expect(result).toContain('value');
    });
  });

  describe('Phase D: SLP + virtueller Zähler', () => {
    test('D1: H0-Profil für Höheinöd generieren', async () => {
      const result = await broker.call('slp.generateTimeseries', {
        profileId: 'H0',
        date: '2026-04-01',
        annualConsumptionKwh: 3500,
      });
      expect(result.values.length).toBe(96);
      expect(result.totalKwh).toBeGreaterThan(5);
      expect(result.totalKwh).toBeLessThan(20);
    });

    test('D2: Dummy-MeLo für simulierten Haushalt erstellen', async () => {
      const result = await broker.call('edm.createMelo', {
        meloId: 'virtual:haushalt_hoeheinoed_001',
        type: 'dummy',
        name: 'Simulierter Haushalt Höheinöd #1',
        spannungsebene: 'NS',
        gridOperatorMastrId: 'SNB961471621746',
        sourceType: 'calc',
        obisRegisters: [
          { obis: '1-0:1.8.0', label: 'Bezug', unit: 'kWh', direction: 'consumption' },
        ],
      });
      expect(result.success).toBe(true);
    });

    test('D3: SLP-generierte Zeitreihe als Dummy-Verbrauch importieren', async () => {
      const slp = await broker.call('slp.generateTimeseries', {
        profileId: 'H0',
        date: '2026-04-01',
        annualConsumptionKwh: 3500,
      });

      const jsonData = slp.values.map((value, index) => ({
        ts: new Date(Date.UTC(2026, 3, 1, 0, index * 15, 0)).toISOString(),
        value,
        quality: 'estimated',
      }));

      const result = await broker.call('edm.importTimeseries', {
        meloId: 'virtual:haushalt_hoeheinoed_001',
        obis: '1-0:1.8.0',
        format: 'json',
        data: jsonData,
      });
      expect(result.imported).toBe(96);
    });

    test('D4: Dummy-Zeitreihe abrufbar mit korrekter Quality', async () => {
      const result = await broker.call('edm.getTimeseries', {
        meloId: 'virtual:haushalt_hoeheinoed_001',
        obis: '1-0:1.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
      });
      expect(result.values.length).toBe(96);
      const estimated = result.values.filter((value) => value.quality === 'estimated');
      expect(estimated.length).toBe(96);
    });

    test('D5: Daily Summary des Dummy-Verbrauchs plausibel', async () => {
      const result = await broker.call('edm.getTimeseriesSummary', {
        meloId: 'virtual:haushalt_hoeheinoed_001',
        obis: '1-0:1.8.0',
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
        groupBy: 'day',
      });
      expect(result.groups.length).toBe(1);
      expect(result.groups[0].total_kwh).toBeGreaterThan(5);
      expect(result.groups[0].total_kwh).toBeLessThan(20);
    });
  });

  describe('Phase E: Datenqualität und Cleanup', () => {
    test('E1: listMelos zeigt 5 MeLos (4 physisch + 1 dummy)', async () => {
      const result = await broker.call('edm.listMelos', {});
      expect(result.data.length).toBe(5);
    });

    test('E2: deleteTimeseries entfernt Import-Daten', async () => {
      const deleted = await broker.call('edm.deleteTimeseries', {
        meloId: 'DE0003966698900000000000052335107',
        from: '2026-03-31T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
      });
      expect(deleted.success).toBe(true);
      expect(deleted.deleted).toBe(8);

      const result = await broker.call('edm.getTimeseries', {
        meloId: 'DE0003966698900000000000052335107',
        obis: '1-0:2.8.0',
        from: '2026-03-31T00:00:00.000Z',
        to: '2026-04-02T00:00:00.000Z',
      });
      expect(result.values.length).toBe(0);
    });

    test('E3: deleteMelo mit cascade löscht MeLo + Zeitreihen', async () => {
      const deleted = await broker.call('edm.deleteMelo', {
        meloId: 'virtual:haushalt_hoeheinoed_001',
        cascade: true,
      });
      expect(deleted.success).toBe(true);
      expect(deleted.deletedTimeseriesRows).toBeGreaterThanOrEqual(0);

      await expect(
        broker.call('edm.getMelo', { meloId: 'virtual:haushalt_hoeheinoed_001' })
      ).rejects.toMatchObject({ code: 404 });
    });

    test('E4: Fixture-Daten sind plausibel', () => {
      const totalMW =
        HOEHEINOED_INSTALLATIONS.reduce((sum, installation) => {
          return sum + (installation.nettonennleistung || 0);
        }, 0) / 1000;

      expect(totalMW).toBeGreaterThan(5);
      expect(totalMW).toBeLessThan(10);

      HOEHEINOED_INSTALLATIONS.forEach((installation) => {
        expect(installation.napData.messlokation).toBeTruthy();
        expect(installation.napData.messlokation.startsWith('DE')).toBe(true);
      });
    });
  });
});
