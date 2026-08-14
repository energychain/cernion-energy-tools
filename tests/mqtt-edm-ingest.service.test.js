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
      settings: {
        ...EdmService.settings,
        dbPath,
      },
    });
    broker.createService(MqttEdmIngestService);

    await broker.start();

    await broker.call('edm.createMelo', {
      meloId: 'melo_001',
      type: 'physical',
      obisRegisters: [{ obis: '1-0:1.8.0', direction: 'consumption' }],
    });
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('does not expose a REST alias or dependency on mqtt-broker/personal-agent', () => {
    expect(MqttEdmIngestService.actions.ingestMessage.rest).toBeUndefined();
    expect(MqttEdmIngestService.actions.ingestBatch.rest).toBeUndefined();
    expect(MqttEdmIngestService.actions.getStatus.rest).toBeUndefined();
    expect(MqttEdmIngestService.actions.listDeadLetters.rest).toBeUndefined();
    expect(broker.getLocalService('mqtt-broker')).toBeUndefined();
    expect(broker.getLocalService('personal-agent')).toBeUndefined();
  });

  it('imports a single valid MQTT-shaped message via edm.importTimeseries', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T08:15:00.000Z', value: 1.42, quality: 'measured' },
      source: 'mqtt-gateway-01',
    });

    expect(result.received).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.deadLettered).toBe(0);

    const stored = await broker.call('edm.getTimeseries', {
      meloId: 'melo_001',
      obis: '1-0:1.8.0',
      from: '2026-07-27T00:00:00.000Z',
      to: '2026-07-28T00:00:00.000Z',
    });
    expect(stored.success).toBe(true);
  });

  it('parses the self-describing topic into tenantId/meloId/obis', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/tenant-a/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T09:00:00.000Z', value: 2.1 },
    });

    expect(result.imported).toBe(1);
  });

  it('normalizes a values[] batch payload into multiple rows', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: {
        values: [
          { ts: '2026-07-27T10:00:00.000Z', value: 1.5 },
          { ts: '2026-07-27T10:15:00.000Z', value: 1.6 },
        ],
      },
      source: 'mqtt-gateway-01',
    });

    expect(result.received).toBe(2);
    expect(result.imported).toBe(2);
  });

  it('rejects malformed topics with INVALID_TOPIC', async () => {
    await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'devices/wallbox-17/meter',
      payload: { ts: '2026-07-27T11:00:00.000Z', value: 1 },
    });

    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    expect(deadLetters.deadLetters[0].reason).toBe('INVALID_TOPIC');
  });

  it('rejects a syntactically invalid tenantId with INVALID_TENANT', async () => {
    await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/bad tenant/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T11:05:00.000Z', value: 1 },
    });

    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    expect(deadLetters.deadLetters[0].reason).toBe('INVALID_TENANT');
  });

  it('dead-letters an invalid timestamp with INVALID_TIMESTAMP', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: 'not-a-date', value: 1.2 },
    });

    expect(result.deadLettered).toBe(1);
    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    expect(deadLetters.deadLetters[0].reason).toBe('INVALID_TIMESTAMP');
  });

  it('dead-letters a non-numeric value with VALUE_NOT_NUMERIC', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T12:00:00.000Z', value: 'abc' },
    });

    expect(result.deadLettered).toBe(1);
    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    expect(deadLetters.deadLetters[0].reason).toBe('VALUE_NOT_NUMERIC');
  });

  it('rejects a topic/payload identifier conflict', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { meloId: 'melo_999', ts: '2026-07-27T13:00:00.000Z', value: 1 },
    });

    expect(result.deadLettered).toBe(1);
    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    expect(deadLetters.deadLetters[0].reason).toBe('TOPIC_PAYLOAD_CONFLICT');
  });

  it('converts UNKNOWN_MELO into a sanitized dead letter with no stack leakage', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'cernion/edm/default/unknown_melo/1-0:1.8.0',
      payload: { ts: '2026-07-27T14:00:00.000Z', value: 1 },
    });

    expect(result.deadLettered).toBe(1);
    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    const entry = deadLetters.deadLetters[0];
    expect(entry.reason).toBe('UNKNOWN_MELO');
    expect(entry.payloadHash).toBeDefined();
    expect(JSON.stringify(entry)).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
    expect(JSON.stringify(entry)).not.toContain('stack');
  });

  it('delegates duplicate (meloId, obis, ts) idempotently with overwriteExisting:false', async () => {
    const message = {
      topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
      payload: { ts: '2026-07-27T15:00:00.000Z', value: 3.3 },
    };

    const first = await broker.call('mqtt-edm-ingest.ingestMessage', message);
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await broker.call('mqtt-edm-ingest.ingestMessage', message);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('keeps the dead-letter list bounded to metadata only, never the raw payload', async () => {
    await broker.call('mqtt-edm-ingest.ingestMessage', {
      topic: 'invalid-topic-for-bounded-check',
      payload: { secret: 'do-not-leak-this-value', ts: '2026-07-27T16:00:00.000Z', value: 1 },
    });

    const deadLetters = await broker.call('mqtt-edm-ingest.listDeadLetters', { limit: 1 });
    const entry = deadLetters.deadLetters[0];
    expect(Object.keys(entry).sort()).toEqual(
      ['id', 'payloadHash', 'reason', 'receivedAt', 'source', 'topic'].sort()
    );
    expect(JSON.stringify(entry)).not.toContain('do-not-leak-this-value');
  });

  it('reports received/imported/skipped/deadLettered counters and lastReceivedAt via getStatus', async () => {
    const status = await broker.call('mqtt-edm-ingest.getStatus');

    expect(status.success).toBe(true);
    expect(status.status.received).toBeGreaterThan(0);
    expect(status.status.imported).toBeGreaterThan(0);
    expect(status.status.skipped).toBeGreaterThan(0);
    expect(status.status.deadLettered).toBeGreaterThan(0);
    expect(status.status.lastReceivedAt).toBeTruthy();
  });

  it('ingestBatch aggregates counts across multiple messages', async () => {
    const result = await broker.call('mqtt-edm-ingest.ingestBatch', {
      messages: [
        {
          topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
          payload: { ts: '2026-07-27T17:00:00.000Z', value: 4.4 },
        },
        {
          topic: 'cernion/edm/default/melo_001/1-0:1.8.0',
          payload: { ts: 'bad-timestamp', value: 5 },
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.received).toBe(2);
    expect(result.imported).toBe(1);
    expect(result.deadLettered).toBe(1);
    expect(result.results).toHaveLength(2);
  });
});
