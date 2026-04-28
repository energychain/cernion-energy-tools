'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const MqttBrokerService = require('../services/mqtt-broker.service');

describe('mqtt-broker.service', () => {
  let broker;
  let dbPath;

  beforeEach(async () => {
    dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cernion-mqtt-broker-'));
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...MqttBrokerService,
      settings: {
        ...MqttBrokerService.settings,
        dbPath,
        cleanupIntervalMs: 10,
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    if (broker) {
      await broker.stop();
    }
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  test('publish persists QoS2 messages and recoverPendingMessages returns them', async () => {
    const published = await broker.call('mqtt-broker.publish', {
      topic: 'cernion/test/device-1/dimming',
      payload: { action: 'dim', targetPowerKw: 4.2 },
      qos: 2,
      messageType: 'control_command',
      ttlSeconds: 120,
      sourceService: 'flex',
    });

    expect(published.success).toBe(true);
    expect(published.persisted).toBe(true);
    expect(published.state).toBe('pending_ack');
    expect(published.messageId).toBeDefined();

    const recovered = await broker.call('mqtt-broker.recoverPendingMessages');
    expect(recovered.count).toBe(1);
    expect(recovered.messages[0].messageId).toBe(published.messageId);

    const stats = await broker.call('mqtt-broker.getStats');
    expect(stats.stats.totalMessages).toBe(1);
    expect(stats.stats.pendingAck).toBe(1);
    expect(stats.stats.controlMessages).toBe(1);
  });

  test('acknowledge marks QoS2 messages as acked and removes them from recovery', async () => {
    const published = await broker.call('mqtt-broker.publish', {
      topic: 'cernion/flex/wb_test_001/dimming',
      payload: { action: 'dim', targetPowerKw: 4.2 },
      qos: 2,
      messageType: 'control_command',
      ttlSeconds: 120,
    });

    const acknowledged = await broker.call('mqtt-broker.acknowledge', {
      messageId: published.messageId,
      phase: 'PUBCOMP',
    });

    expect(acknowledged.success).toBe(true);
    expect(acknowledged.state).toBe('acked');
    expect(acknowledged.ackedAt).toBeTruthy();

    const recovered = await broker.call('mqtt-broker.recoverPendingMessages');
    expect(recovered.count).toBe(0);

    const stats = await broker.call('mqtt-broker.getStats');
    expect(stats.stats.acked).toBe(1);
    expect(stats.stats.pendingAck).toBe(0);
  });

  test('control commands get a short default expiry and expire out of recovery', async () => {
    const published = await broker.call('mqtt-broker.publish', {
      topic: 'cernion/flex/wb_test_001/dimming',
      payload: { action: 'dim', targetPowerKw: 4.2 },
      qos: 2,
      messageType: 'control_command',
    });

    expect(published.expiresAt).toBeTruthy();
    expect(published.retain).toBe(false);

    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await expect(
      broker.call('mqtt-broker.publish', {
        topic: 'cernion/flex/wb_test_002/dimming',
        payload: { action: 'dim', targetPowerKw: 4.2 },
        qos: 2,
        messageType: 'control_command',
        expiresAt: expiredAt,
      })
    ).rejects.toMatchObject({ type: 'MQTT_EXPIRES_AT_IN_PAST' });

    const shortLived = await broker.call('mqtt-broker.publish', {
      topic: 'cernion/flex/wb_test_003/dimming',
      payload: { action: 'dim', targetPowerKw: 4.2 },
      qos: 2,
      messageType: 'control_command',
      ttlSeconds: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await broker.call('mqtt-broker.purgeExpired');

    const recovered = await broker.call('mqtt-broker.recoverPendingMessages');
    expect(recovered.messages.find((entry) => entry.messageId === shortLived.messageId)).toBeFalsy();

    const stats = await broker.call('mqtt-broker.getStats');
    expect(stats.stats.expired).toBeGreaterThanOrEqual(1);
  });

  test('retained control commands are rejected for safety', async () => {
    await expect(
      broker.call('mqtt-broker.publish', {
        topic: 'cernion/flex/wb_test_001/dimming',
        payload: { action: 'dim', targetPowerKw: 4.2 },
        qos: 1,
        retain: true,
        messageType: 'control_command',
      })
    ).rejects.toMatchObject({ type: 'MQTT_RETAIN_NOT_ALLOWED' });
  });
});
