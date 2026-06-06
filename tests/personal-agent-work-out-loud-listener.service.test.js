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
  let correlateFactMock;

  beforeEach(async () => {
    correlateFactMock = jest.fn(async (ctx) => ({
      success: true,
      tenantId: ctx.params.tenantId,
      requestedFact: ctx.params.requestedFact,
      matchedCount: 0,
      correlated: [],
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(ListenerService);
    broker.createService({
      name: 'evidence-revalidation',
      actions: {
        correlateFact: {
          handler(ctx) {
            return correlateFactMock(ctx);
          },
        },
      },
    });
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

  describe('evidence revalidation auto-trigger', () => {
    test('calls evidence-revalidation.correlateFact for a valid scoped_fact_learned event with a safe contextField', async () => {
      const payload = buildContextFieldWorkOutLoudPayload({
        tenantId: 'tenant-a',
        userId: 'user-1',
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
        contextField: 'gridOperatorBdew',
        rawValue: '9907473000008',
        sourceKind: 'known_context',
        scope: 'tenant_operational',
        updateReason: 'known_context_merge',
      });

      await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

      expect(correlateFactMock).toHaveBeenCalledTimes(1);
      const [ctxArg] = correlateFactMock.mock.calls[0];
      expect(ctxArg.params).toEqual({ tenantId: 'tenant-a', requestedFact: 'gridOperatorBdew' });
      expect(ctxArg.meta).toMatchObject({ tenantId: 'tenant-a', $gateway: false });
    });

    test('does not call evidence-revalidation.correlateFact for bootstrap_context_updated signals', async () => {
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

      await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

      expect(correlateFactMock).not.toHaveBeenCalled();
    });

    test('derives requestedFact from evidence.contextField and never forwards signal.value', async () => {
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

      // Sanity check on the fixture: signal.value (the learned value) and
      // evidence.contextField (the safe field name) must differ for this
      // assertion to be meaningful.
      expect(payload.signal.value).toBe('grid_planner');
      expect(payload.evidence.contextField).toBe('roleId');

      await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

      expect(correlateFactMock).toHaveBeenCalledTimes(1);
      const [ctxArg] = correlateFactMock.mock.calls[0];
      expect(ctxArg.params.requestedFact).toBe('roleId');
      expect(ctxArg.params.requestedFact).not.toBe(payload.signal.value);
      expect(JSON.stringify(ctxArg.params)).not.toContain('grid_planner');
    });

    test('does not call evidence-revalidation.correlateFact for rejected payloads with raw/extra fields', async () => {
      const payload = {
        ...buildContextFieldWorkOutLoudPayload({
          tenantId: 'tenant-a',
          userId: 'user-1',
          signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
          contextField: 'gridOperatorBdew',
          rawValue: '9907473000008',
          sourceKind: 'known_context',
          scope: 'tenant_operational',
          updateReason: 'known_context_merge',
        }),
        evidence: {
          sourceKind: 'known_context',
          contextField: 'gridOperatorBdew',
          scope: 'tenant_operational',
          updateReason: 'known_context_merge',
          prompt: 'raw prompt text must never pass',
        },
      };

      const result = await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

      expect(result).toBe(true);
      expect(correlateFactMock).not.toHaveBeenCalled();
    });

    test('fails open and logs a warning when evidence-revalidation correlation fails', async () => {
      const failure = new Error('correlation backend offline');
      correlateFactMock.mockRejectedValueOnce(failure);
      const warnSpy = jest.spyOn(svc.logger, 'warn').mockImplementation(() => {});

      const payload = buildContextFieldWorkOutLoudPayload({
        tenantId: 'tenant-a',
        userId: 'user-1',
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
        contextField: 'gridOperatorBdew',
        rawValue: '9907473000008',
        sourceKind: 'known_context',
        scope: 'tenant_operational',
        updateReason: 'known_context_merge',
      });

      await expect(broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload)).resolves.toBe(true);

      expect(correlateFactMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('correlation backend offline'));

      warnSpy.mockRestore();
    });

    test('forwards the validated event tenantId — never a different or cross-tenant id — to correlateFact', async () => {
      const payload = buildContextFieldWorkOutLoudPayload({
        tenantId: 'tenant-b',
        userId: 'user-2',
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
        contextField: 'gridOperatorBdew',
        rawValue: '9907473000099',
        sourceKind: 'known_context',
        scope: 'tenant_operational',
        updateReason: 'known_context_merge',
      });

      await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

      expect(correlateFactMock).toHaveBeenCalledTimes(1);
      const [ctxArg] = correlateFactMock.mock.calls[0];
      expect(ctxArg.params.tenantId).toBe(payload.tenantId);
      expect(ctxArg.meta.tenantId).toBe(payload.tenantId);
    });
  });
});
