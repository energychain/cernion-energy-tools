'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const EdmService = require('../services/edm.service');
const SlpService = require('../services/slp.service');
const EdmValidationService = require('../services/edm-validation.service');

function createTempDir() {
  return path.join(
    os.tmpdir(),
    `edm-validation-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe('edm-validation.service', () => {
  let broker;
  let dbPath;

  const TEST_MELO = 'VALIDATION_TEST_MELO';
  const TEST_DATA = [
    { ts: '2026-04-01T00:00:00.000Z', value: 0 },
    { ts: '2026-04-01T00:15:00.000Z', value: 0 },
    { ts: '2026-04-01T00:45:00.000Z', value: 0.1 },
    { ts: '2026-04-01T06:00:00.000Z', value: 0.5 },
    { ts: '2026-04-01T06:15:00.000Z', value: 500 },
    { ts: '2026-04-01T06:30:00.000Z', value: 1.2 },
  ];

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

    await broker.start();

    await broker.call('edm.createMelo', {
      meloId: TEST_MELO,
      type: 'physical',
      obisRegisters: [{ obis: '1-0:2.8.0', direction: 'feedin' }],
      metadata: {
        capacityKw: 10,
        slpProfileId: 'H0',
        annualConsumptionKwh: 3500,
      },
    });

    await broker.call('edm.importTimeseries', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      format: 'json',
      data: TEST_DATA,
    });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  test('validate erkennt GAP_DETECTION Finding', async () => {
    const result = await broker.call('edm-validation.validate', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T07:00:00.000Z',
      capacityKw: 10,
    });

    expect(result.success).toBe(true);
    const gapFindings = result.findings.filter((finding) => finding.ruleId === 'GAP_DETECTION');
    expect(gapFindings.length).toBeGreaterThan(0);
  });

  test('validate erkennt BANDWIDTH_CHECK Verletzung (500 kWh)', async () => {
    const result = await broker.call('edm-validation.validate', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T07:00:00.000Z',
      capacityKw: 10,
    });

    const bandwidthFindings = result.findings.filter((finding) => finding.ruleId === 'BANDWIDTH_CHECK');
    expect(bandwidthFindings.length).toBeGreaterThan(0);
    expect(bandwidthFindings[0].value).toBe(500);
  });

  test('validate summary hat korrekte Zählung', async () => {
    const result = await broker.call('edm-validation.validate', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T07:00:00.000Z',
      capacityKw: 10,
    });

    expect(result.summary.totalValues).toBe(6);
    expect(result.summary.findings).toBeGreaterThan(0);
    expect(result.summary.dataQuality).toBeLessThan(1);
  });

  test('fillGaps füllt Lücken mit Interpolation', async () => {
    const result = await broker.call('edm-validation.fillGaps', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T01:00:00.000Z',
      method: 'interpolate',
    });

    expect(result.success).toBe(true);
    expect(result.filled).toBeGreaterThan(0);

    if (result.replacements && result.replacements.length > 0) {
      expect(result.replacements[0].quality).toBe('interpolated');
    }
  });

  test('fillGaps — Zeitreihe hat danach keine Lücke mehr', async () => {
    const result = await broker.call('edm-validation.validate', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T01:00:00.000Z',
      rules: ['GAP_DETECTION'],
    });

    const gapFindings = result.findings.filter((finding) => finding.ruleId === 'GAP_DETECTION');
    expect(gapFindings.length).toBe(0);
  });

  test('validate mit autoFix füllt Lücken automatisch', async () => {
    await broker.call('edm.importTimeseries', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      format: 'json',
      data: [
        { ts: '2026-04-02T00:00:00.000Z', value: 1.0 },
        { ts: '2026-04-02T00:30:00.000Z', value: 1.5 },
      ],
    });

    const result = await broker.call('edm-validation.validate', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-02T00:00:00.000Z',
      to: '2026-04-02T01:00:00.000Z',
      autoFix: true,
      capacityKw: 10,
    });

    expect(result.summary.autoFixed).toBeGreaterThan(0);
  });

  test('listRules gibt mindestens 6 Regeln zurück', async () => {
    const result = await broker.call('edm-validation.listRules');

    expect(result.rules.length).toBeGreaterThanOrEqual(6);
    expect(result.rules.map((rule) => rule.id)).toContain('BANDWIDTH_CHECK');
    expect(result.rules.map((rule) => rule.id)).toContain('GAP_DETECTION');
  });

  test('getReport gibt formatierten Bericht zurück', async () => {
    const result = await broker.call('edm-validation.getReport', {
      meloId: TEST_MELO,
      obis: '1-0:2.8.0',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-01T07:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.recommendations).toBeDefined();
  });
});
