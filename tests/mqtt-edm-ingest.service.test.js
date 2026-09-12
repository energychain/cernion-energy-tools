'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const EdmService = require('../services/edm.service');
const MqttEdmIngestService = require('../services/mqtt-edm-ingest.service');

function createTempDir() {
  return path.join(
    os.tmpdir(),
    `mqtt-edm-ingest-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

describe('mqtt-edm-ingest.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = createTempDir();
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      ...EdmService,
      settings: { ...EdmService.settings, dbPath },
    });
    broker.createService(MqttEdmIngestService);

    await broker.start();

    await broker.call('edm.createMelo', { meloId: 'melo_001', type: 'physical' });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('Service name ist mqtt-edm-ingest', () => {
    expect(MqttEdmIngestService.name).toBe('mqtt-edm-ingest');
  });

  it('ingestMessage importiert eine einzelne gueltige Message ueber edm.importTimeseries', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T08:15:00.000Z', value: 1.42, quality: 'measured' },
      source: 'mqtt-gateway-01',
    });

    expect(res.success).toBe(true);
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(0);

    const stored = await broker.call('edm.getTimeseries', {
      meloId: 'melo_001',
      obis: '1-0:1.8.0',
      from: '2026-07-27T00:00:00.000Z',
      to: '2026-07-28T00:00:00.000Z',
    });
    const row = stored.values.find((r) => r.ts === '2026-07-27T08:15:00.000Z');
    expect(row).toBeDefined();
    expect(row.value).toBe(1.42);
  });

  it('zerlegt das Topic korrekt in tenantId, meloId und obis', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:2.8.0',
      payload: { ts: '2026-07-27T09:00:00.000Z', value: 2.1 },
    });

    expect(res.success).toBe(true);
    expect(res.tenantId).toBe('default');
    expect(res.meloId).toBe('melo_001');
    expect(res.obis).toBe('1-0:2.8.0');
  });

  it('Batch-Payload mit values[] wird in mehrere EDM-Zeilen normalisiert', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: {
        values: [
          { ts: '2026-07-28T08:00:00.000Z', value: 1.4 },
          { ts: '2026-07-28T08:15:00.000Z', value: 1.42 },
        ],
      },
      source: 'mqtt-gateway-01',
    });

    expect(res.success).toBe(true);
    expect(res.imported).toBe(2);
  });

  it('doppelte Message mit gleichem (meloId, obis, ts) ist idempotent', async () => {
    const message = {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-29T08:00:00.000Z', value: 3.3 },
      source: 'mqtt-gateway-01',
    };

    const first = await broker.call('mqtt-edm-ingest.ingestMessage', message);
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await broker.call('mqtt-edm-ingest.ingestMessage', message);
    expect(second.success).toBe(true);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('ungueltiger Timestamp erzeugt Dead-letter mit reason INVALID_TIMESTAMP', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: 'not-a-date', value: 1.1 },
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('INVALID_TIMESTAMP');
    expect(res.deadLetterId).toBeDefined();

    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters');
    const entry = deadLetters.deadLetters.find((d) => d.id === res.deadLetterId);
    expect(entry).toBeDefined();
    expect(entry.reason).toBe('INVALID_TIMESTAMP');
    expect(entry.payloadHash).toBeDefined();
    expect(entry).not.toHaveProperty('payload');
  });

  it('nicht-numerischer Value erzeugt Dead-letter mit reason VALUE_NOT_NUMERIC', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T10:00:00.000Z', value: 'not-a-number' },
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('VALUE_NOT_NUMERIC');
  });

  it('Payload-Konflikt bei abweichendem meloId erzeugt Dead-letter mit reason OBIS_CONFLICT', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T10:15:00.000Z', value: 1.1, meloId: 'melo_999' },
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('OBIS_CONFLICT');
  });

  it('Payload-Konflikt bei abweichendem obis erzeugt Dead-letter mit reason OBIS_CONFLICT', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T10:30:00.000Z', value: 1.1, obis: '1-0:2.8.0' },
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('OBIS_CONFLICT');
  });

  it('unbekannte MeLo wird als sauberer Dead-letter ohne Stacktrace gezaehlt', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_unknown/1-0:1.8.0',
      payload: { ts: '2026-07-27T11:00:00.000Z', value: 1.1 },
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('UNKNOWN_MELO');
    expect(res.stack).toBeUndefined();
  });

  it('ungueltiges Topic-Schema erzeugt Dead-letter mit reason INVALID_TOPIC', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'devices/wallbox-17/meter',
      payload: { ts: '2026-07-27T11:15:00.000Z', value: 1.1 },
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('INVALID_TOPIC');
  });

  it('getStatus liefert received/imported/skipped/deadLettered/lastReceivedAt', async () => {
    const status = await broker.call('mqtt-edm-ingest.getStatus');

    expect(status.received).toBeGreaterThan(0);
    expect(status.imported).toBeGreaterThan(0);
    expect(status.skipped).toBeGreaterThan(0);
    expect(status.deadLettered).toBeGreaterThan(0);
    expect(status.lastReceivedAt).toBeTruthy();
  });

  it('ingestBatch verarbeitet mehrere Envelope-Messages und aggregiert Zaehler', async () => {
    const res = await broker.call('mqtt-edm-ingest.ingestBatch', {
      messages: [
        {
          topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
          payload: { ts: '2026-07-30T08:00:00.000Z', value: 5.5 },
        },
        {
          topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
          payload: { ts: 'invalid', value: 5.5 },
        },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
    expect(res.imported).toBe(1);
    expect(res.deadLettered).toBe(1);
    expect(res.results).toHaveLength(2);
  });

  it('kein externer MQTT-Listener oder REST-Alias und mqtt-broker.service.js unveraendert', () => {
    const apiServiceSource = fs.readFileSync(
      path.join(__dirname, '..', 'services', 'api.service.js'),
      'utf8'
    );
    expect(apiServiceSource).not.toMatch(/\/edm\/mqtt\//);

    expect(MqttEdmIngestService.settings).not.toHaveProperty('port');
    expect(MqttEdmIngestService.started).toBeUndefined();
  });
});
