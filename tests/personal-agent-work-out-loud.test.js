'use strict';

const {
  PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildWorkOutLoudPayload,
  buildContextFieldWorkOutLoudPayload,
  validateWorkOutLoudPayload,
} = require('../src/personal-agent-work-out-loud');

describe('personal-agent-work-out-loud contract', () => {
  test('builds valid payload for a safe context field', () => {
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

    expect(payload).toMatchObject({
      tenantId: 'tenant-a',
      userId: 'user-1',
      agentId: PERSONAL_AGENT_WORK_OUT_LOUD_AGENT_ID,
      signal: {
        type: 'bootstrap_context_updated',
        category: 'organization',
        value: 'utility',
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
    });
  });

  test('missing tenantId is rejected', () => {
    expect(
      buildWorkOutLoudPayload({
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
      })
    ).toBeNull();
  });

  test('forbidden raw-like evidence keys cause strict validation failure', () => {
    const payload = {
      tenantId: 'tenant-a',
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
        prompt: 'raw prompt text',
      },
      timestamp: new Date().toISOString(),
    };

    expect(() => validateWorkOutLoudPayload(payload)).toThrow(
      'Unexpected evidence keys in Work Out Loud payload'
    );
  });

  test('safe payload never contains raw onboarding message text', () => {
    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: 'tenant-a',
      userId: 'user-1',
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.ONBOARDING_FACT_LEARNED,
      contextField: 'fnavProfile',
      rawValue: { requestedCapacity: 5000 },
      sourceKind: 'onboarding_answer',
      scope: 'user',
      updateReason: 'onboarding_answer',
    });

    expect(payload.signal.value).toBe('fnavProfile');
    expect(JSON.stringify(payload)).not.toContain('requestedCapacity');
    expect(JSON.stringify(payload)).not.toContain('Hybridprofil');
  });
});
