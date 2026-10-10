'use strict';

const { ServiceBroker } = require('moleculer');
const schema = require('../services/function-coverage.service');
const { memoryPouch } = require('./helpers/shared-service/memory-pouch');
const { visible } = require('../src/domain-router-policy');
const { configuration, project, mapSignals } = require('../src/function-coverage');
const turn = require('../src/function-coverage-turn');
const { compareCanonicalStrings } = require('../src/canonical-order');
const model = {
  functions: [
    { functionId: 'fn-a', capabilities: ['cap-a'], operations: ['svc-a.read'] },
    { functionId: 'fn-b', capabilities: ['cap-a', 'cap-b'], operations: ['svc-b.read'] },
  ],
};
const meta = (actor = 'actor-a', tenant = 'tenant-a', roles = ['ROLE_USER']) => ({
  apiToken: { id: actor, userId: actor, tenantId: tenant, roles },
});
const input = (sourceRef = 'ref-a', extra = {}) => ({
  tenantId: 'tenant-a',
  actorId: 'actor-a',
  sourceType: 'completed_turn',
  sourceRef,
  conversationId: 'conv-a',
  signalClass: 'case_start',
  capabilities: ['cap-a'],
  ...extra,
});

function createService(options = {}) {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const Pouch = memoryPouch();
  const db = new Pouch('coverage');
  db.put = jest.fn(db.put.bind(db));
  Object.defineProperty(db, 'writes', { get: () => db.put.mock.calls.length });
  const service = broker.createService({
    ...schema,
    mixins: [
      {
        ...schema.mixins[0],
        created() {
          this.db = db;
        },
        async started() {},
      },
    ],
    settings: {
      ...schema.settings,
      coverage: { maxOperationFunctionShare: 1 },
      model,
      clock: () => Date.UTC(2026, 0, 1),
      ...options,
    },
  });
  service.db = db;
  broker.emit = jest.fn().mockResolvedValue();
  return {
    broker,
    db,
    service,
    call: (name, params = {}, auth = meta()) => service.actions[name](params, { meta: auth }),
  };
}

describe('observed function coverage', () => {
  test('maps multiple functions and concurrent retries exactly once; emits closed contracts', async () => {
    const { call, broker, db } = createService();
    await Promise.all(
      Array.from({ length: 5 }, () =>
        call('recordTouch', input('ref-a', { operations: ['svc-a.read'] }))
      )
    );
    const rows = (await call('byActor')).items;
    expect(rows.map((row) => row.functionId)).toEqual(['fn-a', 'fn-b']);
    expect(rows.every((row) => row.signalCount === 1 && row.observedActivity)).toBe(true);
    expect(db.records.size).toBe(2);
    expect(broker.emit.mock.calls).toHaveLength(4);
    for (const [name, payload] of broker.emit.mock.calls) {
      expect(Object.keys(payload).sort(compareCanonicalStrings)).toEqual(
        (name === 'function.touched.v1'
          ? ['tenantId', 'actorId', 'functionId', 'conversationId', 'confidence', 'at', 'turnRef']
          : ['tenantId', 'actorId', 'functionId', 'score', 'origin']
        ).sort(compareCanonicalStrings)
      );
    }
  });

  test('weights recurring conversations above questions; deterministic half-life reads write nothing', async () => {
    let now = Date.UTC(2026, 0, 1);
    const { call, db, broker } = createService({ clock: () => now });
    await call('recordTouch', input('q-a', { signalClass: 'knowledge_query' }));
    const low = (await call('byActor')).items[0].score;
    await call(
      'recordTouch',
      input('q-b', { conversationId: 'conv-b', signalClass: 'case_followup' })
    );
    const high = (await call('byActor')).items[0];
    expect(high.score).toBeGreaterThan(low);
    const writes = db.writes,
      events = broker.emit.mock.calls.length;
    now += configuration().halfLifeMs;
    const decayed = await call('byActor', { asOf: new Date(now).toISOString() });
    expect(decayed).toEqual(await call('byActor', { asOf: new Date(now).toISOString() }));
    expect(decayed.items[0].score).toBeCloseTo(1 - Math.sqrt(1 - high.score));
    expect(db.writes).toBe(writes);
    expect(broker.emit).toHaveBeenCalledTimes(events);
  });

  test('hysteresis suppresses small changes and reads never emit', async () => {
    const { call, broker } = createService({ coverage: { hysteresis: 0.2 } });
    await call('recordTouch', input('q-a', { signalClass: 'knowledge_query' }));
    await call('recordTouch', input('q-b', { signalClass: 'knowledge_query' }));
    expect(
      broker.emit.mock.calls.filter(([name]) => name === 'function.coverage.changed.v1')
    ).toHaveLength(0);
    await call('recordTouch', input('q-c'));
    expect(
      broker.emit.mock.calls.filter(([name]) => name === 'function.coverage.changed.v1')
    ).toHaveLength(2);
  });

  test('two actors, pagination, tenant isolation and self/management audience', async () => {
    const { call } = createService();
    await call('recordTouch', input());
    await call('recordTouch', input('ref-b', { actorId: 'actor-b' }), meta('actor-b'));
    await expect(call('matrix')).rejects.toThrow('Management');
    await expect(call('byActor', { actorId: 'actor-b' })).rejects.toThrow('Management');
    await expect(call('byActor', { tenantId: 'tenant-b' })).rejects.toThrow('Tenant');
    expect((await call('byActor', {}, meta('actor-a', 'tenant-b'))).items).toEqual([]);
    const admin = meta('admin-a', 'tenant-a', ['ROLE_TENANT_ADMIN']);
    const matrix = await call('byFunction', { functionId: 'fn-a' }, admin);
    expect(matrix.items.map((row) => row.actorId)).toEqual(['actor-a', 'actor-b']);
    const page = await call('matrix', { limit: 1 }, admin);
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
    const minimized = await call('matrix', {}, meta('manager-a', 'tenant-a', ['ROLE_UTILITY_HQ']));
    expect(minimized.items[0].actorId).not.toBe('actor-a');
    expect(minimized.items[0].recentSourceReferences).toEqual([]);
    await expect(call('recordTouch', input('ref-c', { actorId: 'actor-b' }))).rejects.toThrow(
      'Actor'
    );
  });

  test('closed stored documents contain no arbitrary contents or policy; high coverage cannot authorize', async () => {
    const { call, db } = createService();
    const policy = {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      roles: ['ROLE_USER'],
      clearance: [],
      domainsAllowed: ['scope-a'],
      roleFamilies: ['family-a'],
      sensitivityClearance: [],
    };
    const state = {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      accessRoles: ['ROLE_ADMIN'],
      sensitivityFlags: [],
      sharedWithRoles: [],
    };
    const foreignState = { ...state, tenantId: 'tenant-b' };
    const foreignBefore = visible(policy, foreignState);
    const before = visible(policy, state),
      snapshot = structuredClone(policy);
    for (let index = 0; index < 20; index++)
      await call(
        'recordTouch',
        input(`ref-${index}`, {
          message: 'SECRET_CONTENT',
          response: 'SECRET_CONTENT',
          evidence: { token: 'SECRET_CONTENT' },
        })
      );
    expect((await call('byActor')).items[0].score).toBeGreaterThan(0.99);
    expect(visible(policy, state)).toBe(before);
    expect(before).toBe(true);
    expect(visible(policy, foreignState)).toBe(foreignBefore);
    expect(foreignBefore).toBe(false);
    expect(policy).toEqual(snapshot);
    expect(JSON.stringify([...db.records.values()])).not.toMatch(
      /SECRET_CONTENT|domainsAllowed|roleFamilies|sensitivityClearance|message|response|token/
    );
  });

  test('outbox survives event failure and duplicate delivery replays without recounting', async () => {
    const { call, broker, db } = createService();
    broker.emit.mockRejectedValue(new Error('offline'));
    await call('recordTouch', input());
    expect([...db.records.values()].every((doc) => doc.pendingEvents.length === 2)).toBe(true);
    broker.emit.mockResolvedValue();
    await call('recordTouch', input());
    expect([...db.records.values()].every((doc) => doc.pendingEvents.length === 0)).toBe(true);
    expect((await call('byActor')).items[0].signalCount).toBe(1);
  });

  test('lineage resolves on read without copying ambiguous observations', async () => {
    const { call, service } = createService();
    await call('recordTouch', input());
    service.settings.model = {
      functions: [
        {
          functionId: 'fn-c',
          capabilities: ['cap-a'],
          operations: [],
          derivation: { lineage: [{ previousId: 'fn-a', relation: 'merged', overlap: 1 }] },
        },
      ],
    };
    expect((await call('byActor')).items[0].functionId).toBe('fn-c');
    expect((await call('recordTouch', input())).recorded).toBe(0);
    expect((await call('byActor')).items[0].signalCount).toBe(1);
    service.settings.model.functions.push({
      functionId: 'fn-d',
      capabilities: [],
      operations: [],
      derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
    });
    expect((await call('byActor')).items).toEqual([]);
  });

  test('retention and deletion remove coverage artifacts only', async () => {
    let now = Date.UTC(2026, 0, 1);
    const { call, db } = createService({ clock: () => now });
    await call('recordTouch', input());
    now += configuration().retentionMs + 1;
    expect((await call('byActor')).items).toEqual([]);
    await call('maintain', {}, meta('admin-a', 'tenant-a', ['ROLE_TENANT_ADMIN']));
    expect(db.records.size).toBe(0);
  });

  test('completed-turn seam observes structured facts and never waits for persistence', async () => {
    const { broker, service } = createService();
    const ctx = {
      broker,
      meta: meta(),
      params: {
        message: 'neutral',
        intentMode: 'knowledge_query',
        requestId: 'req-a',
        conversationId: 'conv-a',
      },
      requestID: 'req-a',
      call: jest.fn().mockResolvedValue({ selectedCapabilities: [{ capability: 'cap-a' }] }),
    };
    const original = ctx.call;
    turn.before(ctx);
    await ctx.call('svc-a.read', {});
    const response = { responseText: 'SECRET_CONTENT' };
    expect(turn.after(ctx, response)).toBe(response);
    expect(ctx.call).toBe(original);
    await new Promise(setImmediate);
    await service.queue;
    expect((await service.actions.byActor({}, { meta: meta() })).items).toHaveLength(2);
    service.db.allDocs = jest.fn().mockRejectedValue(new Error('offline'));
    turn.before(ctx);
    expect(turn.after(ctx, response)).toBe(response);
    await new Promise(setImmediate);
  });

  test('unknown mappings do not fabricate functions; configuration fails closed', async () => {
    const { call, service } = createService();
    expect(await call('recordTouch', input('ref-a', { capabilities: ['cap-unknown'] }))).toEqual({
      recorded: 0,
      unresolved: 1,
      suppressedOperations: 0,
      overflow: 0,
    });
    expect(service.unresolvedSignals).toBe(1);
    await expect(
      call('recordTouch', input('invalid', { signalClass: 'constructor' }))
    ).rejects.toThrow('Unknown signal class');
    expect(() => configuration({ halfLifeMs: 0 })).toThrow();
    const config = configuration();
    const docs = [
      {
        tenantId: 'tenant-a',
        actorId: 'actor-a',
        functionId: 'fn-a',
        _id: 'a',
        at: 0,
        weight: 1,
        signalClass: 'case_start',
      },
    ];
    expect(project(docs, 0, config).score).toBeCloseTo(1 - Math.exp(-1));
  });
});

test('malformed observation data cannot fail the original downstream call', async () => {
  const { broker } = createService();
  const result = { candidateCapabilities: 42 };
  const ctx = { broker, meta: meta(), params: {}, call: jest.fn().mockResolvedValue(result) };
  turn.before(ctx);
  expect(await ctx.call('svc-a.read')).toBe(result);
  expect(turn.after(ctx, result)).toBe(result);
});

test('real harness adapter supplies denied authorization and unchanged policy observations', async () => {
  const { createAdapter } = require('./helpers/shared-service/real-adapter');
  jest.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
  const adapter = await createAdapter({ functions: model.functions, jest });
  try {
    await adapter.apply({
      type: 'signal',
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      functionId: 'fn-a',
      conversationId: 'conv-a',
      signalKind: 'session',
    });
    const state = await adapter.snapshot();
    expect(state.coverage).toHaveLength(2);
    expect(state.authorizationChecks).toHaveLength(1);
    expect(state.authorizationChecks[0].before).toBe(false);
    const { assertInvariants } = require('./helpers/shared-service/invariants');
    assertInvariants(state, ['I-8']);
  } finally {
    await adapter.close();
    jest.useRealTimers();
  }
});

test.each([-Number.EPSILON, 0, Number.EPSILON])('hysteresis exact boundary %s', async (delta) => {
  const boundary = 1 - Math.exp(-0.04);
  const { call, broker } = createService({ coverage: { hysteresis: boundary + delta } });
  await call('recordTouch', input('q-boundary', { signalClass: 'knowledge_query' }));
  const events = broker.emit.mock.calls.filter(([name]) => name === 'function.coverage.changed.v1');
  expect(events).toHaveLength(delta > 0 ? 0 : 2);
});

test('DB pages and read provenance remain bounded across many touches', async () => {
  const { call, db } = createService();
  for (let index = 0; index < 130; index++) await call('recordTouch', input(`page-${index}`));
  const rows = (await call('byActor')).items;
  expect(rows.every((row) => row.signalCount === 130)).toBe(true);
  expect(rows.every((row) => row.recentSourceReferences.length === 8)).toBe(true);
  expect(db.records.size).toBe(260);
  expect([...db.records.values()].every((doc) => doc.pendingEvents.length <= 2)).toBe(true);
});

test('failed turns restore the call function and do not record observations', async () => {
  const { broker, db } = createService();
  const failure = new Error('original failure');
  const call = jest.fn().mockRejectedValue(failure);
  const ctx = { broker, meta: meta(), params: {}, call };
  turn.before(ctx);
  await expect(ctx.call('svc-a.read')).rejects.toBe(failure);
  expect(() => turn.error(ctx, failure)).toThrow(failure);
  expect(ctx.call).toBe(call);
  expect(db.records.size).toBe(0);
});

test('shared adapter delivers coverage events to real activation without changing authority', async () => {
  const { createAdapter } = require('./helpers/shared-service/real-adapter');
  const functions = [
    {
      functionId: 'fn-a',
      capabilities: ['cap-a'],
      operations: [],
      neighbors: [{ functionId: 'fn-b', weight: 0.8, evidence: [] }],
    },
    { functionId: 'fn-b', capabilities: ['cap-b'], operations: [], neighbors: [] },
  ];
  const adapter = await createAdapter({ functions, jest });
  const signal = (functionId, actorId, conversationId) =>
    adapter.apply({
      type: 'signal',
      tenantId: 'tenant-a',
      functionId,
      actorId,
      conversationId,
      signalKind: 'session',
    });
  try {
    await signal('fn-a', 'actor-a', 'conv-a');
    expect(
      (await adapter.snapshot()).activations.find((row) => row.functionId === 'fn-b').responsibility
        .cet
    ).toBe(true);
    await signal('fn-b', 'actor-b', 'conv-b');
    await signal('fn-b', 'actor-b', 'conv-c');
    const state = await adapter.snapshot();
    expect(state.activations.find((row) => row.functionId === 'fn-b').responsibility).toEqual({
      humans: ['actor-b'],
      cet: false,
    });
    expect(state.authorizationChecks).toHaveLength(3);
    expect(
      state.authorizationChecks.every((check) => check.before === false && check.after === false)
    ).toBe(true);
  } finally {
    await adapter.close();
  }
});

test('operation hubs use frequency and both automatic and configured model features', () => {
  const functions = Array.from({ length: 20 }, (_, index) => ({
    functionId: `fn-${index}`,
    capabilities: [],
    operations: index < 3 ? ['svc-a.read'] : [],
  }));
  const input = { operations: ['svc-a.read'] };
  expect(mapSignals(input, { functions }, configuration()).suppressedOperations).toBe(1);
  expect(
    mapSignals(input, { functions }, configuration({ maxOperationFunctionShare: 0.15 })).functionIds
  ).toHaveLength(3);
  for (const model of [
    { functions, statistics: { automaticHubs: ['operations:svc-a.read'] } },
    { functions, statistics: { automaticHubs: ['declaredActions:svc-a.read'] } },
    { functions, parameters: { hubFeatures: { services: ['svc-a'] } } },
  ])
    expect(
      mapSignals(input, model, configuration({ maxOperationFunctionShare: 1 })).functionIds
    ).toEqual([]);
  expect(
    mapSignals(
      input,
      { functions },
      configuration({ maxOperationFunctionShare: 1, hubFeatures: { operations: ['svc-a.read'] } })
    ).functionIds
  ).toEqual([]);
  expect(() => configuration({ maxOperationFunctionShare: 0 })).toThrow();
  expect(() => configuration({ hubFeatures: { operations: 1 } })).toThrow();
});

test('turn budget counts overflow and gives selections priority over operation fanout', async () => {
  const functions = Array.from({ length: 9 }, (_, index) => ({
    functionId: `fn-${index}`,
    capabilities: [`cap-${index}`],
    operations: ['svc-a.read'],
  }));
  const { service, call } = createService({
    model: { functions },
    coverage: { maxOperationFunctionShare: 1, maxSignalsPerTurn: 2 },
  });
  const result = await call(
    'recordTouch',
    input('budget-a', { capabilities: ['cap-8'], operations: ['svc-a.read'] })
  );
  expect(result).toMatchObject({ recorded: 2, overflow: 7 });
  expect(service.signalOverflow).toBe(7);
  expect((await call('byActor')).items.map((row) => row.functionId)).toContain('fn-8');
});

test('router candidates and recommendation objects never become touches', async () => {
  const { broker, service } = createService();
  const result = {
    capability: 'cap-a',
    candidateCapabilities: ['cap-a'],
    recommendedCapabilities: ['cap-a'],
    operationCandidates: ['svc-a.read'],
  };
  const ctx = {
    broker,
    meta: meta(),
    params: { intentMode: 'case_start', requestId: 'proposal-a' },
    call: jest.fn().mockResolvedValue(result),
  };
  turn.before(ctx);
  await ctx.call('router-a.classify');
  turn.after(ctx, result);
  await new Promise(setImmediate);
  await service.queue;
  expect((await service.actions.byActor({}, { meta: meta() })).items).toEqual([]);
});

test('repetition changes score mass but never promotes weak touch confidence', async () => {
  const { call, broker } = createService({ coverage: { crossConversationMultiplier: 10 } });
  for (const conversationId of ['conv-a', 'conv-b'])
    await call(
      'recordTouch',
      input(conversationId, { conversationId, signalClass: 'data_lookup' })
    );
  const touches = broker.emit.mock.calls.filter(([name]) => name === 'function.touched.v1');
  expect(touches.every(([, payload]) => payload.confidence === 0.1)).toBe(true);
});
