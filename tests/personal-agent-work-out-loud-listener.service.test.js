'use strict';

const { ServiceBroker } = require('moleculer');
const ListenerService = require('../services/personal-agent-work-out-loud-listener.service');
const {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildContextFieldWorkOutLoudPayload,
} = require('../src/personal-agent-work-out-loud');

describe('personal-agent-work-out-loud-listener.service', () => {
  let broker;
  let svc;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(ListenerService);
    await broker.start();
    svc = broker.getLocalService('personal-agent-work-out-loud-listener');
  });

  afterEach(async () => {
    await broker.stop();
  });

  test('rejects event with missing tenantId', async () => {
    const result = await svc.schema.methods.handleWorkOutLoudEvent.call(svc, {
      userId: 'user-1',
      agentId: 'personal-agent',
      signal: {
        type: 'bootstrap_context_updated',
        category: 'organization',
        value: 'utility',
        confidence: 0.8,
      },
      relevance: {
        suggestedCapabilities: [],
        suggestedRoles: [],
      },
      evidence: {
        sourceKind: 'bootstrap_context',
        contextField: 'organizationType',
        scope: 'user',
        updateReason: 'context_append',
      },
      timestamp: new Date().toISOString(),
    });

    expect(result).toBeNull();
  });

  test('accepts valid event and returns sanitized payload', async () => {
    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: 'tenant-a',
      userId: 'user-1',
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.BOOTSTRAP_CONTEXT_UPDATED,
      contextField: 'organizationType',
      rawValue: 'utility',
      sourceKind: 'bootstrap_context',
      scope: 'user',
      updateReason: 'context_append',
    });

    const result = await svc.schema.methods.handleWorkOutLoudEvent.call(svc, payload);

    expect(result).toEqual(payload);
  });

  test('rejects incoming payloads with raw/additional evidence fields', async () => {
    const payload = {
      ...buildContextFieldWorkOutLoudPayload({
        tenantId: 'tenant-a',
        userId: 'user-1',
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.BOOTSTRAP_CONTEXT_UPDATED,
        contextField: 'organizationType',
        rawValue: 'utility',
        sourceKind: 'bootstrap_context',
        scope: 'user',
        updateReason: 'context_append',
      }),
      evidence: {
        sourceKind: 'bootstrap_context',
        contextField: 'organizationType',
        scope: 'user',
        updateReason: 'context_append',
        prompt: 'raw prompt text must never pass',
      },
    };

    const result = await svc.schema.methods.handleWorkOutLoudEvent.call(svc, payload);

    expect(result).toBeNull();
  });

  test('broker event path validates without persistence side effects', async () => {
    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: 'tenant-a',
      userId: 'user-1',
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
      contextField: 'roleId',
      rawValue: 'grid_planner',
      sourceKind: 'known_context',
      scope: 'role',
      updateReason: 'known_context_merge',
    });

    const result = await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

    expect(result).toBe(true);
    expect(svc.db).toBeUndefined();
  });
});
