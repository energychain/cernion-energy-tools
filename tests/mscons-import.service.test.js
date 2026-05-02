'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');
const EdmValidationService = require('../services/edm-validation.service');
const MsconsImportService = require('../services/mscons-import.service');

const SAMPLE_MSCONS = [
  "UNH+1+MSCONS:D:04B:UN:2.3e'",
  "BGM+7+DOC20260401001+9'",
  "DTM+137:20260401:102'",
  "NAD+MS+9900992720003::293'",
  "NAD+MR+9907015000008::293'",
  "LOC+172+DE0003966698900000000000052335107'",
  "DTM+163:202604010000:303'",
  "DTM+164:202604012359:303'",
  "CCI+11++Z06'",
  "QTY+220:12.4:KWH'",
  "DTM+163:202604010000:303'",
  "DTM+164:202604010015:303'",
  "STS+7++67'",
  "QTY+220:11.8:KWH'",
  "DTM+163:202604010015:303'",
  "DTM+164:202604010030:303'",
  "STS+7++67'",
  "QTY+220:0:KWH'",
  "DTM+163:202604010030:303'",
  "DTM+164:202604010045:303'",
  "STS+7++79'",
  "QTY+220:13.1:KWH'",
  "DTM+163:202604010045:303'",
  "DTM+164:202604010100:303'",
  "STS+7++67'",
  "UNT+25+1'",
].join('');

function createTempDir() {
  return path.join(
    os.tmpdir(),
    `mscons-import-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe('mscons-import.service', () => {
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

    broker.createService(EdmValidationService);
    broker.createService(MsconsImportService);

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  test('parse: gibt strukturierte MSCONS-Daten zurück', async () => {
    const result = await broker.call('mscons-import.parse', {
      data: SAMPLE_MSCONS,
    });

    expect(result.success).toBe(true);
    expect(result.locations).toBe(1);
    expect(result.totalValues).toBe(4);
    expect(result.parsed.locations[0].meloId).toBe('DE0003966698900000000000052335107');
  });

  test('import: erstellt MeLo und importiert Zeitreihen', async () => {
    const result = await broker.call('mscons-import.import', {
      data: SAMPLE_MSCONS,
      autoCreateMelo: true,
      gridOperatorMastrId: 'SNB961471621746',
    });

    expect(result.success).toBe(true);
    expect(result.melosCreated).toBe(1);
    expect(result.totalValues).toBe(4);
  });

  test('import: MeLo hat sourceType=mscons', async () => {
    const melo = await broker.call('edm.getMelo', {
      meloId: 'DE0003966698900000000000052335107',
    });

    expect(melo.data.sourceType).toBe('mscons');
    expect(melo.data.gridOperatorMastrId).toBe('SNB961471621746');
  });

  test('import: Zeitreihe ist abrufbar', async () => {
    const ts = await broker.call('edm.getTimeseries', {
      meloId: 'DE0003966698900000000000052335107',
      obis: '1-0:1.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T01:00:00.000Z',
    });

    expect(ts.values.length).toBe(4);
    expect(ts.values[0].value).toBe(12.4);
    expect(ts.values[0].quality).toBe('measured');
    expect(ts.values[2].quality).toBe('estimated');
  });

  test('import: zweiter Import mit autoCreateMelo=true skipped MeLo', async () => {
    const result = await broker.call('mscons-import.import', {
      data: SAMPLE_MSCONS,
      autoCreateMelo: true,
    });

    expect(result.melosCreated).toBe(0);
    expect(result.melosExisting).toBe(1);
  });

  test('import: validateOnImport gibt Findings zurück', async () => {
    const result = await broker.call('mscons-import.import', {
      data: SAMPLE_MSCONS,
      validateOnImport: true,
      overwriteExisting: true,
    });

    expect(result.validationFindings).toBeDefined();
  });

  test('listImports: zeigt MSCONS-importierte MeLos', async () => {
    const result = await broker.call('mscons-import.listImports');

    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data[0].sourceType).toBe('mscons');
  });

  test('parse: ungültiger EDIFACT gibt Fehler', async () => {
    await expect(broker.call('mscons-import.parse', { data: 'NOT EDIFACT' })).rejects.toBeTruthy();
  });
});
