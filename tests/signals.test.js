'use strict';

const { projectSignals, isFinding, scoreState } = require('../src/signal-projection');
const catalog = require('../signal-catalog.json');
const { createAdapter } = require('./helpers/shared-service/real-adapter');
const { deriveWake, eventMatches, WAKE_DEFAULTS } = require('../src/shared-service-wake');
const neutral = { operationId: 'neutral_read', functionIds: ['fn-b'], classification: 'standing' };
const response = {
  status: 'blocked',
  readinessScore: 0.4,
  missingEvidence: [{ id: 'a' }],
  blockingFindings: [{ code: 'a', severity: 'high' }],
  validationFindings: [{ code: 'b', severity: 'medium' }],
  timestamp: '2026-01-01T00:00:00.000Z',
};
let adapter;
afterEach(async () => {
  jest.restoreAllMocks();
  if (adapter) await adapter.close();
  adapter = null;
});
const meta = (tenantId = 'tenant-a') => ({
  authUser: { tenantId, id: 'person-a', roles: ['ROLE_USER'], scope: 'read-only' },
  tenantId,
});
const operation = {
  ...neutral,
  action: 'neutral.read',
  service: 'neutral',
  agentable: true,
  operationKind: 'data_read',
  consequenceLevel: 'none',
  sideEffects: [],
  parameters: { required: [] },
};
const model = {
  sourceHash: 'neutral',
  functions: [
    {
      functionId: 'fn-a',
      capabilities: [],
      operations: [],
      neighbors: [{ functionId: 'fn-b', weight: 0.8 }],
    },
    {
      functionId: 'fn-b',
      capabilities: [],
      operations: ['neutral.read'],
      neighbors: [{ functionId: 'fn-a', weight: 0.8 }],
    },
  ],
};
async function setup({ classification = 'standing', maxStatesPerTenant = 512 } = {}) {
  adapter = await createAdapter({
    jest,
    model,
    withAgents: true,
    agentSettings: { operationIndex: { operations: [operation] } },
    signalSettings: {
      maxStatesPerTenant,
      catalog: {
        version: 1,
        operations: [
          {
            ...neutral,
            action: operation.action,
            classification,
            parameterNames: ['caseId'],
            signals: [],
          },
        ],
      },
    },
  });
  return adapter;
}

test('AC-02/03: all Dashboard operations use committed classifications and probe responses, never live probes', () => {
  expect(catalog.statistics.coverage).toBeGreaterThanOrEqual(0.9);
  expect(catalog.operations.length).toBe(
    Object.keys(require('../services/dashboard-api.service').actions).length
  );
  for (const entry of catalog.operations) {
    expect(['standing', 'contextual']).toContain(entry.classification);
    if (!entry.probe.responded) {
      expect(entry.uncoveredReason).toBeTruthy();
      continue;
    }
    const signals = projectSignals(entry.probe.response, entry);
    expect(signals).toEqual(entry.signals);
    expect(projectSignals(entry.probe.response, entry)).toEqual(signals);
    if (/(^|_)(needs|missing)(_|$)/i.test(entry.probe.response.status || ''))
      expect(signals.some(isFinding)).toBe(false);
  }
  expect(catalog.statistics.findingsWithoutContext).toBe(0);
});

test('AC-04: field roles, severity, normalized scores and thresholds', () => {
  const signals = projectSignals(response, neutral);
  expect(signals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'state', state: 'breach' }),
      expect.objectContaining({ kind: 'score', value: 0.4, state: 'breach' }),
      expect.objectContaining({ kind: 'count', value: 1, state: 'warn' }),
      expect.objectContaining({ kind: 'finding', code: 'a', state: 'breach' }),
      expect.objectContaining({ kind: 'finding', code: 'b', state: 'warn' }),
    ])
  );
  expect(scoreState(0.51, 'breach')).toBe('breach');
  expect(scoreState(0.53, 'breach')).toBe('warn');
  expect(scoreState(0.81, 'warn')).toBe('warn');
  expect(scoreState(0.83, 'warn')).toBe('ok');
  expect(
    projectSignals({ ...response, status: 'needs_input' }, neutral).every(
      (s) => s.state === 'needs_context'
    )
  ).toBe(true);
  expect(projectSignals({ ...response, status: 'unknown' }, neutral).some(isFinding)).toBe(false);
});

test('AC-04: finding identities survive row order; native signals have priority and retain safe context state', () => {
  const input = {
    ...response,
    blockingFindings: [
      { code: 'b', severity: 'high' },
      { code: 'a', severity: 'medium' },
    ],
  };
  expect(projectSignals(input, neutral)).toEqual(
    projectSignals({ ...input, blockingFindings: [...input.blockingFindings].reverse() }, neutral)
  );
  expect(projectSignals({ ...response, signals: [] }, neutral)).toEqual([]);
  const native = projectSignals(
    { ...response, signals: [{ signalId: 'a', kind: 'finding', state: 'breach', label: 'A' }] },
    { ...neutral, classification: 'contextual' }
  );
  expect(native).toHaveLength(1);
  expect(native[0].state).toBe('needs_context');
  expect(isFinding(native[0])).toBe(false);
});

test('AC-05/09: same identity, state change only, hysteresis, tenant isolation and bounded persistence', async () => {
  await setup({ maxStatesPerTenant: 2 });
  let value = 0.4;
  const calls = [];
  adapter.broker.createService({
    name: 'neutral',
    actions: {
      read: (ctx) => {
        calls.push(ctx.meta);
        return { readinessScore: value };
      },
    },
  });
  const events = [];
  adapter.broker.createService({
    name: 'signal-events',
    events: { 'signal.state.changed.v1': (ctx) => events.push(ctx.params) },
  });
  const observe = (tenantId = 'tenant-a', context) =>
    adapter.observeSignals(
      { tenantId, functionId: 'fn-b', ...(context ? { context } : {}) },
      { meta: meta(tenantId) }
    );
  await adapter.broker.waitForServices(['neutral']);
  await observe();
  await observe();
  value = 0.51;
  await observe();
  expect(events).toEqual([]);
  value = 0.53;
  await observe();
  await new Promise(setImmediate);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    tenantId: 'tenant-a',
    fromState: 'breach',
    toState: 'warn',
    functionIds: ['fn-b'],
  });
  await observe('tenant-b');
  expect(events).toHaveLength(1);
  expect(calls[0].authUser).toEqual(meta().authUser);
  for (const ref of ['a', 'b', 'c']) await observe('tenant-a', { kind: 'case', ref });
  expect((await adapter.signals.db.get('signals:tenant-a')).states).toHaveLength(2);
  await expect(
    adapter.observeSignals({ tenantId: 'tenant-a', functionId: 'fn-b' }, { meta: meta('tenant-b') })
  ).rejects.toThrow('Tenant mismatch');
  expect((await adapter.signals.db.get('signals:tenant-b')).states).toHaveLength(1);
});

test('AC-03/09: contextual operations never called without valid context, even native findings; read-only roles remain authoritative', async () => {
  await setup({ classification: 'contextual' });
  const handler = jest.fn((ctx) => {
    expect(ctx.params.caseId).toBe('case-a');
    return response;
  });
  const backend = adapter.broker.createService({ name: 'neutral', actions: { read: { handler } } });
  const call = (context) =>
    adapter.observeSignals(
      { tenantId: 'tenant-a', functionId: 'fn-b', ...(context ? { context } : {}) },
      { meta: meta() }
    );
  await adapter.broker.waitForServices(['neutral']);
  expect(await call()).toEqual({ signals: [], calledOperations: 0 });
  expect(handler).not.toHaveBeenCalled();
  expect((await call({ kind: 'case', ref: 'case-a' })).calledOperations).toBe(1);
  backend.schema.actions.read.requiredRoles = ['ROLE_ADMIN'];
  await expect(call({ kind: 'case', ref: 'case-a' })).rejects.toThrow('Role required');
  expect(handler).toHaveBeenCalledTimes(1);
  await expect(
    call({ kind: 'case', ref: 'case-a', params: { tenantId: 'tenant-b' } })
  ).rejects.toThrow('Tenant mismatch');
});

test('AC-07: starting services and advancing time alone never observes signals', async () => {
  await setup();
  const observe = jest.spyOn(adapter.signals.actions, 'observe');
  await adapter.apply({ type: 'advance', milliseconds: 100000 });
  expect(observe).not.toHaveBeenCalled();
  expect(adapter.signalObservations).toEqual([]);
});

test('AC-05: wake signal events match only catalog functions and retain observation/context push gaps', () => {
  const fn = { functionId: 'fn-b', events: { listens: [] } };
  const settings = {
    ...WAKE_DEFAULTS,
    signalCatalog: {
      operations: [
        {
          functionIds: ['fn-b'],
          operationId: 'neutral',
          classification: 'contextual',
          signals: [{}],
        },
      ],
    },
  };
  const wake = deriveWake(fn, settings, ['signal.state.changed.v1']);
  expect(wake.events).toContain('signal.state.changed.v1');
  expect(wake.pushGaps).toContainEqual({
    eventType: 'signal.state.changed.v1',
    operationId: 'neutral',
    reason: 'context_required',
  });
  expect(
    eventMatches(
      fn,
      'signal.state.changed.v1',
      { tenantId: 'tenant-a', functionIds: ['fn-b'] },
      wake
    )
  ).toBe(true);
  expect(
    eventMatches(
      fn,
      'signal.state.changed.v1',
      { tenantId: 'tenant-b', functionIds: ['fn-a'] },
      wake
    )
  ).toBe(false);
});

test.each(['blocked', 'findings'])(
  'AC-06: real Dashboard operation %s yields no proposal without context and exactly one with a referenced case',
  async (kind) => {
    const fixture = require('./fixtures/signals/context.json')[kind];
    const entry = catalog.operations.find((o) => o.action === fixture.action);
    const index = require('../operation-capability-index.json');
    const op = index.operations.find((o) => o.action === entry.action);
    const functions = structuredClone(model.functions);
    functions[1].operations = [entry.action];
    adapter = await createAdapter({
      jest,
      model: { sourceHash: 'neutral', functions },
      withAgents: true,
      agentSettings: { operationIndex: { operations: [op] } },
      signalSettings: { catalog: { version: 1, operations: [entry] } },
    });
    adapter.broker.createService(require('../services/dashboard-api.service'));
    adapter.broker.createService({
      name: 'domain-router',
      methods: {
        loadCase(p, ref) {
          expect(p.tenantId).toBe('tenant-a');
          expect(p.roles).toEqual(['ROLE_USER']);
          expect(ref).toBe('case-a');
          return { knownContext: fixture.params };
        },
      },
    });
    adapter.broker.createService({
      name: 'agent-persona',
      actions: {
        list: () => ({
          items: [
            {
              id: 'persona-a',
              tenantId: 'tenant-a',
              openclawUserId: 'person-a',
              personaType: 'human',
              status: 'active',
            },
          ],
        }),
      },
    });
    await adapter.broker.waitForServices(['dashboard-api', 'agent-persona']);
    const generate = jest
      .spyOn(adapter.agents.llmClient, 'generateStructured')
      .mockResolvedValue({ summary: 'Review observed state.' });
    await adapter.apply({
      event: 'function.coverage.changed.v1',
      payload: {
        tenantId: 'tenant-a',
        actorId: 'person-a',
        functionId: 'fn-a',
        score: 1,
        origin: 'observed',
      },
    });
    await adapter.apply({
      type: 'touch',
      payload: {
        tenantId: 'tenant-a',
        actorId: 'person-a',
        functionId: 'fn-a',
        conversationId: 'conv-a',
        confidence: 1,
      },
    });
    expect(generate).not.toHaveBeenCalled();
    expect(await adapter.inbox.getTenantInboxMessages('tenant-a')).toEqual([]);
    expect(adapter.signalObservations).toEqual([]);
    await adapter.journal.actions.append(
      {
        tenantId: 'tenant-a',
        functionId: 'fn-b',
        kind: 'observed',
        summary: 'Existing reference.',
        refs: [{ kind: 'case', id: 'case-a' }],
      },
      { meta: meta() }
    );
    const agent = (await adapter.snapshot()).agents[0];
    const result = await adapter.broker.call('shared-service-agent.runCycle', {
      tenantId: 'tenant-a',
      agentId: agent.agentId,
    });
    expect(result.findings).toBe(kind === 'blocked' ? 18 : 5);
    expect(result.proposals).toBe(1);
    expect(result.consumedUnits).toBeCloseTo(1.85);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await adapter.inbox.getTenantInboxMessages('tenant-a')).toHaveLength(1);
    const signals = adapter.signalObservations.flatMap((row) => row.signals);
    expect(signals.some(isFinding)).toBe(true);
    if (kind === 'blocked')
      expect(signals).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'state', state: 'breach' })])
      );
    else
      expect(signals).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'finding' })])
      );
  }
);

test('AC-06: real Dashboard standing observations across the complete catalog produce no proposals without context', async () => {
  const index = require('../operation-capability-index.json');
  const functions = structuredClone(model.functions);
  functions[1].operations = catalog.operations.map((o) => o.action);
  adapter = await createAdapter({
    jest,
    model: { sourceHash: 'neutral', functions },
    withAgents: true,
    settings: { allowancePerTurn: 100, allowanceCap: 100 },
    agentSettings: { operationIndex: index, maxOperationsPerCycle: 128 },
    signalSettings: { catalog },
  });
  adapter.broker.createService(require('../services/dashboard-api.service'));
  await adapter.broker.waitForServices(['dashboard-api']);
  const generate = jest.spyOn(adapter.agents.llmClient, 'generateStructured');
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'conv-a',
      confidence: 1,
    },
  });
  const agent = (await adapter.snapshot()).agents[0];
  expect(agent.stats.findings).toBe(0);
  expect(agent.stats.proposals).toBe(0);
  expect(generate).not.toHaveBeenCalled();
  expect(adapter.signalObservations.length).toBeGreaterThan(0);
  expect(adapter.signalObservations.every((r) => !r.findings.length)).toBe(true);
});

test('AC-05: changed-state event wakes only the affected tenant/function through the real scheduler', async () => {
  const signalCatalog = {
    version: 1,
    operations: [
      { ...neutral, action: operation.action, parameterNames: [], signals: [{ kind: 'score' }] },
    ],
  };
  adapter = await createAdapter({
    jest,
    model,
    withAgents: true,
    agentSettings: { operationIndex: { operations: [operation] } },
    signalSettings: { catalog: signalCatalog },
    wakeSettings: { signalCatalog, pushMode: 'event' },
  });
  let value = 0.9;
  adapter.broker.createService({
    name: 'neutral',
    actions: { read: () => ({ neutralScore: value }) },
  });
  await adapter.broker.waitForServices(['neutral']);
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'conv-a',
      confidence: 1,
    },
  });
  // A second human turn supplies a committed funding-only rearm (#699).
  adapter.clock.value += 1;
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'conv-funding',
      confidence: 1,
    },
  });
  const agent = (await adapter.snapshot()).agents[0];
  const before = agent.stats.cycles;
  expect((await adapter.wake.records('tenant-a'))[0].wake.events).toContain(
    'signal.state.changed.v1'
  );
  await adapter.broker.emit('signal.state.changed.v1', {
    tenantId: 'tenant-b',
    functionIds: ['fn-b'],
    signalId: 'a',
    fromState: 'ok',
    toState: 'breach',
  });
  await adapter.wake.settle();
  expect((await adapter.snapshot()).agents[0].stats.cycles).toBe(before);
  expect((await adapter.wake.records('tenant-a'))[0].blocked).toBe(false);
  value = 0.4;
  await adapter.observeSignals({ tenantId: 'tenant-a', functionId: 'fn-b' }, { meta: meta() });
  await new Promise(setImmediate);
  await adapter.wake.settle();
  await adapter.agents.settle();
  expect((await adapter.wake.records('tenant-a'))[0].wake.mode).toBe('event');
  expect((await adapter.snapshot()).agents[0].stats.cycles).toBe(before + 1);
  expect((await adapter.wake.records('tenant-a'))[0].stats.pushWakes).toBe(1);
  const gaps = await adapter.wake.actions.pushGaps({ tenantId: 'tenant-a' }, { meta: meta() });
  expect(gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ operationId: 'neutral_read', reason: 'observation_required' }),
    ])
  );
});

test('AC-09: agent observation denied by a backend role spends no operation unit and never widens identity', async () => {
  await setup();
  const handler = jest.fn(() => response);
  adapter.broker.createService({
    name: 'neutral',
    actions: { read: { requiredRoles: ['ROLE_ADMIN'], handler } },
  });
  await adapter.broker.waitForServices(['neutral']);
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'conv-a',
      confidence: 1,
    },
  });
  const agent = (await adapter.snapshot()).agents[0];
  expect(handler).not.toHaveBeenCalled();
  expect(agent.stats.consumedUnits).toBeCloseTo(0.1);
  expect(agent.stats.findings).toBe(0);
});
