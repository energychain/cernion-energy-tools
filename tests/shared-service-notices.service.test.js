'use strict';

const { ServiceBroker } = require('moleculer');
const { memoryPouch } = require('./helpers/shared-service/memory-pouch');
const { classifyWorkbenchIntent } = require('../src/workbench-intent-router');
const { answerSystemActivity, renderSystemActivity } = require('../src/workbench-system-activity');
const { resolveFunctions } = require('../src/function-resolver');
const { getFunctionModel } = require('../src/function-model');
const { renderNoticeBlock } = require('../src/shared-service-notices');
const openai = require('../services/openai-compatible.service');
const hook = require('../src/function-coverage-turn');

const model = {
  functions: [
    {
      functionId: 'fn-a',
      label: 'Function A',
      operations: [],
      neighbors: [{ functionId: 'fn-b', weight: 1 }],
    },
    {
      functionId: 'fn-b',
      label: 'Function B',
      operations: ['notice-source.read'],
      neighbors: [{ functionId: 'fn-a', weight: 1 }],
    },
  ],
};
const meta = {
  apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_USER'], scope: 'read-only' },
};
const identity = { tenantId: 'tenant-a', actorId: 'actor-a' };
async function setup(settings = {}, stores = new Map()) {
  let schema;
  let signalsSchema;
  jest.doMock('pouchdb', () => memoryPouch(stores));
  jest.isolateModules(() => {
    schema = require('../services/shared-service-notices.service');
    signalsSchema = require('../services/signals.service');
  });
  jest.dontMock('pouchdb');
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const service = broker.createService({
    ...schema,
    settings: { ...schema.settings, model, dbPath: '/tmp/cet-notice-unit', ...settings },
  });
  const proposals = Array.from({ length: 12 }, (_, n) => ({
    ref: `proposal-${n}`,
    recipients: ['actor-a'],
    outcome: null,
  }));
  broker.createService({
    name: 'shared-service-agent',
    methods: {
      async readDocument(tenantId) {
        return { tenantId, agents: [{ agentId: 'agent-a', functionId: 'fn-b', proposals }] };
      },
      resolvedAgents(rows) {
        return rows;
      },
    },
  });
  const activation = broker.createService({
    name: 'activation',
    actions: {
      explain: (ctx) => ({
        activations: [{ tenantId: ctx.params.tenantId, functionId: ctx.params.functionId }],
      }),
    },
  });
  const access = { allowed: true };
  const observation = { status: 'ok' };
  const operation = {
    operationId: 'notice-source-read',
    action: 'notice-source.read',
    agentable: true,
    operationKind: 'dashboard_read',
    consequenceLevel: 'none',
    sideEffects: [],
  };
  const signals = broker.createService({
    ...signalsSchema,
    settings: {
      ...signalsSchema.settings,
      model,
      dbPath: '/tmp/cet-notice-signals-unit',
      catalog: {
        version: 2,
        operations: [
          {
            operationId: operation.operationId,
            action: operation.action,
            classification: 'standing',
            parameterNames: ['caseId'],
          },
        ],
      },
      operationIndex: { operations: [operation] },
    },
  });
  const source = broker.createService({
    name: 'notice-source',
    actions: { read: { handler: () => ({ status: observation.status }) } },
  });
  broker.createService({
    name: 'journal',
    methods: {
      async referenceVisible(_ctx, p, ref) {
        return access.allowed && p.tenantId === 'tenant-a' && ref.id === 'case-a';
      },
    },
  });
  await broker.start();
  const call = (name, params = {}) =>
    broker.call(`notices.${name}`, { ...identity, ...params }, { meta });
  const emit = async (name, payload) => {
    await broker.emit(name, { tenantId: 'tenant-a', ...payload });
    await service.settle();
  };
  await emit('function.coverage.changed.v1', {
    actorId: 'actor-a',
    functionId: 'fn-a',
    score: 0.8,
  });
  const proposal = (n = 0) =>
    emit('shared-agent.proposal.created.v1', {
      agentId: 'agent-a',
      functionId: 'fn-b',
      proposalRef: `proposal-${n}`,
      summary: 'PRIVATE NOT FOR PRESENTATION',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  const observe = async (status, context = { kind: 'case', ref: 'case-a' }) => {
    observation.status = status;
    const result = await broker.call(
      'signals.observe',
      { tenantId: identity.tenantId, functionId: 'fn-b', ...(context ? { context } : {}) },
      { meta }
    );
    await service.settle();
    return result;
  };
  return {
    broker,
    service,
    activation,
    proposals,
    call,
    emit,
    proposal,
    access,
    stores,
    signals,
    source,
    observe,
  };
}
let env;
afterEach(async () => {
  if (env) await env.broker.stop();
  env = null;
});

test('AC-01/02/09: covered neighbor, once, recipient visibility, tenant and stable reference', async () => {
  env = await setup();
  await env.proposal();
  await env.proposal();
  let result = await env.call('list');
  expect(result.items).toHaveLength(1);
  expect(result.block).toContain('V-1');
  expect(result.block).not.toContain('PRIVATE');
  const ref = result.items[0].ref;
  result = await env.call('completeTurn', { turnRef: 'turn-a' });
  expect(result.items).toHaveLength(1);
  expect((await env.call('completeTurn', { turnRef: 'turn-a' })).items).toEqual([]);
  expect((await env.call('completeTurn', { turnRef: 'turn-b' })).items).toEqual([]);
  expect(await env.call('resolveRef', { ref })).toMatchObject({
    objectRef: 'proposal-0',
    functionId: 'fn-b',
  });
  env.proposals[0].recipients = ['actor-b'];
  expect(await env.call('resolveRef', { ref })).toBeNull();
  await expect(env.call('list', { tenantId: 'tenant-b' })).rejects.toMatchObject({ code: 403 });
  await expect(env.call('list', { actorId: 'actor-b' })).rejects.toMatchObject({ code: 403 });
});

test('AC-02: coverage does not authorize a private proposal or signal', async () => {
  env = await setup();
  env.proposals[0].recipients = ['actor-b'];
  await env.proposal();
  expect((await env.call('list')).items).toEqual([]);
  await env.observe('ok');
  await env.observe('warn');
  env.access.allowed = false;
  expect((await env.call('list')).items).toEqual([]);
  env.access.allowed = true;
  expect((await env.call('list')).items).toHaveLength(1);
});

test('AC-03/04: cap, remaining, bounded queue, own turns rather than time', async () => {
  env = await setup({ maxQueue: 5, expireAfterTurns: 2 });
  for (let n = 0; n < 8; n++) await env.proposal(n);
  const result = await env.call('completeTurn', { turnRef: 'turn-a' });
  expect(result.items).toHaveLength(3);
  expect(result.remaining).toBe(2);
  expect(result.block).toContain('Was gibt es Neues?');
  expect((await env.service.read('tenant-a', 'actor-a')).queue).toHaveLength(2);
  jest.useFakeTimers();
  jest.setSystemTime(Date.UTC(2099, 0, 1));
  expect((await env.call('list')).items).toHaveLength(2);
  jest.useRealTimers();
  await env.call('completeTurn', { actorId: 'actor-a', turnRef: 'turn-b', structured: true });
  expect((await env.call('list')).items).toEqual([]);
});

test('AC-05/06: structured suppression, off and proposals_only preserve base result', async () => {
  env = await setup();
  await env.proposal();
  await env.emit('function.activation.changed.v1', {
    functionId: 'fn-b',
    responsibility: { cet: true },
    attention: { tier: 'inventory' },
  });
  await env.call('setPreference', { preference: 'off' });
  expect((await env.call('completeTurn', { turnRef: 'off' })).block).toBe('');
  await env.call('setPreference', { preference: 'proposals_only' });
  expect((await env.call('list')).items.map((item) => item.kind)).toEqual(['proposal']);
  expect((await env.call('completeTurn', { turnRef: 'structured', structured: true })).block).toBe(
    ''
  );
  expect((await env.call('list')).items).toHaveLength(1);
  const ctx = {
    broker: env.broker,
    meta,
    params: { requestId: 'plain' },
    action: { name: 'workbench.chat' },
    call: (name, input, options) => env.broker.call(name, input, options),
  };
  hook.before(ctx);
  const base = { responseText: 'Original answer.' };
  const result = await hook.after(ctx, base);
  expect(result.responseText).toMatch(/Hinweise für dich:[\s\S]*\n\nOriginal answer\.$/);
  expect(base.responseText).toBe('Original answer.');
});

test('AC-05: a notice failure never prevents the answer; counter increases', async () => {
  env = await setup();
  await env.proposal();
  const dbPut = jest.spyOn(env.service.db, 'put').mockRejectedValue(new Error('write failure'));
  const ctx = {
    broker: env.broker,
    meta,
    params: {},
    action: { name: 'workbench.chat' },
    call: (name, input, options) => env.broker.call(name, input, options),
  };
  hook.before(ctx);
  expect(await hook.after(ctx, { responseText: 'Original.' })).toEqual({
    responseText: 'Original.',
  });
  expect(env.service.failures).toBeGreaterThan(0);
  dbPut.mockRestore();
});

test('AC-04/09: restart keeps references, delivery receipts and bounded history', async () => {
  env = await setup({ maxHistory: 2, dedupLimit: 3 });
  const stores = env.stores;
  await env.proposal();
  const first = await env.call('completeTurn', { turnRef: 'turn-a' });
  await env.broker.stop();
  env = await setup({ maxHistory: 2, dedupLimit: 3 }, stores);
  await env.proposal();
  expect((await env.call('list')).items).toEqual([]);
  expect(await env.call('resolveRef', { ref: first.items[0].ref })).not.toBeNull();
  for (let n = 1; n < 8; n++) {
    await env.proposal(n);
    await env.call('completeTurn', { turnRef: `turn-${n}` });
  }
  const doc = await env.service.read('tenant-a', 'actor-a');
  expect(doc.history).toHaveLength(2);
  expect(doc.seen).toHaveLength(3);
  expect(doc.turnRefs).toHaveLength(3);
});

test('full news queue: no resolver, embeddings, Knowledge or RAG; consumed by shared hook', async () => {
  env = await setup();
  for (let n = 0; n < 7; n++) await env.proposal(n);
  const ctx = {
    broker: env.broker,
    meta,
    params: { intentMode: 'system_activity_query', requestId: 'news-turn' },
    action: { name: 'workbench.query' },
    call: jest.fn((name, input, options) => env.broker.call(name, input, { ...options, meta })),
  };
  hook.before(ctx);
  const answer = await answerSystemActivity(ctx, 'Was gibt es Neues?', { model });
  expect(answer.state).toBe('notices');
  expect(answer.noticeQueue.items).toHaveLength(7);
  const result = await hook.after(ctx, answer);
  expect(result.noticeQueue.items).toHaveLength(7);
  expect(renderSystemActivity(result)).toContain('V-7');
  expect((await env.call('list')).items).toEqual([]);
});

test.each([
  'Was gibt es Neues?',
  "Gibt's was Neues?",
  'Was ist passiert?',
  'Irgendwelche Hinweise für mich?',
  "What's new?",
])('news regression: %s', async (message) => {
  expect(classifyWorkbenchIntent(message)).toBe('system_activity_query');
  const call = jest.fn(async () => ({ items: [], block: '' }));
  const result = await answerSystemActivity({ meta, call }, message, {
    model: getFunctionModel(),
    resolverOptions: {
      client: {
        embeddings: () => {
          throw new Error('Must not embed');
        },
      },
    },
  });
  expect(result.state).toBe('notices');
  expect(call).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][0]).toBe('notices.list');
  expect(result.resolution).toBeUndefined();
});

test('generic #713 vocabulary never resolves a function by itself', () => {
  const generic = require('../scripts/domain-free-core.generic-vocabulary.json')
    .terms.map(({ term }) => term)
    .join(' ');
  expect(resolveFunctions(generic).status).toBe('none');
});

test('AC-07: governance renderer prepends deferred block and leaves original content intact', async () => {
  const workbench = {
    responseText: 'Original.',
    noticeBlock: 'Hinweise für dich:\nV-1: Neuer Vorschlag – Function A.',
  };
  const ctx = {
    params: {
      model: 'cernion-governance-assistant',
      stream: true,
      messages: [{ role: 'user', content: 'Bitte hilf mir.' }],
    },
    meta,
    call: jest.fn(async () => workbench),
  };
  const result = await openai.actions.chatCompletions.handler(ctx);
  expect(result.choices[0].message.content.startsWith(`${workbench.noticeBlock}\n\n`)).toBe(true);
  expect(result.choices[0].message.content).toContain('Original.');
});

test('same function is grouped deterministically while every short reference remains visible', () => {
  const block = renderNoticeBlock(
    [
      { kind: 'proposal', ref: 'V-1', functionId: 'fn-a' },
      { kind: 'proposal', ref: 'V-2', functionId: 'fn-a' },
    ],
    0,
    model
  );
  expect(block).toContain('V-1');
  expect(block).toContain('V-2');
});

test('repeated responsibility transfers and tier entries remain distinct, equal retries do not', async () => {
  env = await setup();
  for (const cet of [true, true, false, false, true])
    await env.emit('function.activation.changed.v1', {
      functionId: 'fn-b',
      responsibility: { cet },
      attention: { tier: 'transient' },
    });
  expect((await env.call('list')).items.map((item) => item.cet)).toEqual([true, false, true]);
  await env.emit('function.activation.changed.v1', {
    functionId: 'fn-b',
    responsibility: { cet: true },
    attention: { tier: 'established' },
  });
  await env.emit('function.activation.changed.v1', {
    functionId: 'fn-b',
    responsibility: { cet: true },
    attention: { tier: 'inventory' },
  });
  expect(
    (await env.call('list')).items.filter((item) => item.kind === 'tier').map((item) => item.tier)
  ).toEqual(['established', 'inventory']);
});

test('real signal producer delivers warn/breach/recovery, excludes equal and unknown states', async () => {
  env = await setup();
  for (const state of ['ok', 'warn', 'blocked', 'ok', 'ok', 'unknown']) await env.observe(state);
  expect((await env.call('list')).items.map((item) => item.state)).toEqual([
    'warn',
    'breach',
    'ok',
  ]);
});

test('standing signal visibility rechecks backend roles without observing again', async () => {
  env = await setup();
  await env.observe('ok', null);
  await env.observe('warn', null);
  const before = await env.signals.db.get('signals:tenant-a');
  const result = await env.call('list');
  expect(result.items).toHaveLength(1);
  const ref = result.items[0].ref;
  expect(await env.call('resolveRef', { ref })).toMatchObject({ kind: 'signal' });
  expect(await env.signals.db.get('signals:tenant-a')).toEqual(before);
  env.source.schema.actions.read.requiredRoles = ['ROLE_ADMIN'];
  expect((await env.call('list')).items).toEqual([]);
  expect(await env.call('resolveRef', { ref })).toBeNull();
});

test('unobserved or evicted signal references fail closed despite visible context', async () => {
  env = await setup();
  await env.observe('ok');
  await env.observe('warn');
  const doc = await env.signals.db.get('signals:tenant-a');
  doc.states = [];
  await env.signals.db.put(doc);
  expect((await env.call('list')).items).toEqual([]);
});

test('own turns of a different person do not expire the covered recipient queue', async () => {
  env = await setup({ expireAfterTurns: 2 });
  await env.proposal();
  for (let n = 0; n < 3; n++)
    await env.broker.call(
      'notices.completeTurn',
      { tenantId: 'tenant-a', actorId: 'actor-b', turnRef: `other-${n}` },
      { meta: { apiToken: { tenantId: 'tenant-a', id: 'actor-b', roles: ['ROLE_USER'] } } }
    );
  expect((await env.call('list')).items).toHaveLength(1);
});

test('proposal timestamp retries deduplicate by the source object reference', async () => {
  env = await setup();
  await env.proposal();
  await env.emit('shared-agent.proposal.created.v1', {
    functionId: 'fn-b',
    agentId: 'agent-a',
    proposalRef: 'proposal-0',
    createdAt: '2099-01-01T00:00:00.000Z',
  });
  expect((await env.call('list')).items).toHaveLength(1);
});

test('failed full news queue claim never displays unclaimed entries', async () => {
  env = await setup();
  await env.proposal();
  const ctx = {
    broker: env.broker,
    meta,
    params: { intentMode: 'system_activity_query', requestId: 'failed-news' },
    action: { name: 'workbench.query' },
    call: (name, input, options) => env.broker.call(name, input, { ...options, meta }),
  };
  hook.before(ctx);
  const answer = await answerSystemActivity(ctx, 'Was gibt es Neues?', { model });
  const failure = jest.spyOn(env.service.db, 'put').mockRejectedValue(new Error('write failure'));
  const result = await hook.after(ctx, answer);
  expect(result.state).toBe('notices_unavailable');
  expect(renderSystemActivity(result)).not.toContain('V-1');
  failure.mockRestore();
  expect((await env.call('list')).items).toHaveLength(1);
});

test('two service instances cannot return a duplicate delivery claim', async () => {
  env = await setup();
  await env.proposal();
  const second = await setup({}, env.stores);
  try {
    const results = await Promise.allSettled([
      env.call('completeTurn', { turnRef: 'concurrent-a' }),
      second.call('completeTurn', { turnRef: 'concurrent-b' }),
    ]);
    expect(
      results
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value.items)
    ).toHaveLength(1);
    expect((await env.call('list')).items).toEqual([]);
  } finally {
    await second.broker.stop();
  }
});

test('no recipient is selected without qualifying function/neighbor coverage', async () => {
  env = await setup();
  await env.emit('function.coverage.changed.v1', {
    actorId: 'actor-a',
    functionId: 'fn-a',
    score: 0.1,
  });
  await env.proposal();
  expect((await env.call('list')).items).toEqual([]);
});

test('tool-call output remains intact and does not claim queued notices', async () => {
  env = await setup();
  await env.proposal();
  const ctx = {
    broker: env.broker,
    meta,
    params: {},
    action: { name: 'workbench.chat' },
    call: (name, input, options) => env.broker.call(name, input, { ...options, meta }),
  };
  hook.before(ctx);
  const result = {
    toolCalls: [{ name: 'neutral-read' }],
    responseText: 'Original structured result.',
  };
  expect(await hook.after(ctx, result)).toEqual(result);
  expect((await env.call('list')).items).toHaveLength(1);
});

test.each(['neu', 'Neues', 'laufen', 'gerade', 'aktuell', 'momentan', 'new', 'running'])(
  'generic activity vocabulary has no Function target: %s',
  (word) => {
    expect(resolveFunctions(word).status).toBe('none');
  }
);
