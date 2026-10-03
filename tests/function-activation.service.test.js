'use strict';

const { createAdapter } = require('./helpers/shared-service/real-adapter');
const { compareCanonicalStrings } = require('../src/canonical-order');

const graph = (edges) => ({
  sourceHash: 'fixture-v1',
  functions: Object.entries(edges).map(([functionId, neighbors]) => ({
    functionId,
    neighbors: neighbors.map(([id, weight]) => ({
      functionId: id,
      weight,
      evidence: [{ kind: 'fixture', ref: `${functionId}:${id}` }],
    })),
  })),
});
const chain = () =>
  graph({
    'fn-a': [
      ['fn-b', 0.7],
      ['fn-c', 0.19],
    ],
    'fn-b': [['fn-c', 0.8]],
    'fn-c': [],
    'fn-d': [],
  });
let adapter;
beforeEach(async () => {
  adapter = await createAdapter({ model: chain(), jest });
});
afterEach(async () => {
  if (adapter) await adapter.close();
});
const touch = (functionId, extra = {}) => ({
  tenantId: 'tenant-a',
  actorId: 'actor-a',
  functionId,
  conversationId: 'conversation-a',
  confidence: 1,
  at: new Date(adapter.clock.value).toISOString(),
  ...extra,
});
const sendTouch = async (functionId, extra = {}) => {
  await adapter.broker.emit('function.touched.v1', touch(functionId, extra));
  await adapter.service.settle();
};
const coverage = async (functionId, score, actorId = 'actor-b', tenantId = 'tenant-a') => {
  await adapter.broker.emit('function.coverage.changed.v1', {
    tenantId,
    actorId,
    functionId,
    score,
    origin: 'observed',
  });
  await adapter.service.settle();
};
const list = (tenantId = 'tenant-a') => adapter.broker.call('activation.list', { tenantId });
const row = async (id, tenantId) => (await list(tenantId)).find((item) => item.functionId === id);

test('AC-01: a fresh tenant is wholly latent and reading has no writes', async () => {
  const before = await adapter.service.db.allDocs();
  const rows = await list();
  expect(rows).toHaveLength(4);
  expect(
    rows.every((item) => item.state === 'latent' && !item.responsibility.cet && !item.touchedAt)
  ).toBe(true);
  expect(await adapter.service.db.allDocs()).toEqual(before);
  expect(adapter.events).toEqual([]);
});
test('AC-02/05: one hop, inclusive weight threshold, evidence and read-only explanation', async () => {
  adapter.service.settings.minWeight = 0.7;
  await sendTouch('fn-a');
  expect((await row('fn-a')).state).toBe('active');
  expect((await row('fn-a')).responsibility.cet).toBe(false);
  expect((await row('fn-b')).responsibility.cet).toBe(true);
  expect((await row('fn-c')).state).toBe('latent');
  const explained = await adapter.broker.call('activation.explain', {
    tenantId: 'tenant-a',
    functionId: 'fn-b',
  });
  expect(explained.activations[0].reason).toContainEqual({
    kind: 'neighbor',
    functionId: 'fn-a',
    weight: 0.7,
    evidence: [{ kind: 'fixture', ref: 'fn-a:fn-b' }],
  });
  expect(adapter.events.map((event) => Object.keys(event).sort(compareCanonicalStrings))).toEqual([
    ['functionId', 'responsibility', 'state', 'tenantId'],
    ['functionId', 'responsibility', 'state', 'tenantId'],
  ]);
});
test('AC-02: supplied high coverage excludes a neighbor; exact threshold qualifies', async () => {
  await coverage('fn-b', 0.5);
  await sendTouch('fn-a');
  expect((await row('fn-b')).responsibility).toEqual({ humans: ['actor-b'], cet: false });
  expect((await row('fn-b')).state).toBe('latent');
});
test('AC-03: budget zero never caps human touches', async () => {
  adapter.service.settings.tenantBudget = 0;
  for (const id of ['fn-a', 'fn-b', 'fn-c', 'fn-d']) await sendTouch(id);
  expect((await list()).filter((item) => item.state === 'active')).toHaveLength(4);
  expect((await list()).filter((item) => item.responsibility.cet)).toHaveLength(0);
});
test('AC-03: tenant budget override and strongest-edge/canonical tie selection', async () => {
  await adapter.close();
  adapter = await createAdapter({
    jest,
    model: graph({
      'fn-a': [
        ['fn-d', 0.7],
        ['fn-c', 0.9],
        ['fn-b', 0.9],
      ],
      'fn-b': [],
      'fn-c': [],
      'fn-d': [],
    }),
    settings: { tenantBudget: 3, tenantBudgets: { 'tenant-a': 1 } },
  });
  await sendTouch('fn-a');
  expect(
    (await list()).filter((item) => item.responsibility.cet).map((item) => item.functionId)
  ).toEqual(['fn-b']);
  expect((await row('fn-c')).reason).toContainEqual({ kind: 'budget_deferred', budget: 1 });
  await sendTouch('fn-a', { tenantId: 'constructor' });
  expect((await list('constructor')).filter((item) => item.responsibility.cet)).toHaveLength(3);
});
test('AC-04: handoff is durable, observable and emits the contractual event', async () => {
  await sendTouch('fn-a');
  await coverage('fn-b', 0.9);
  expect((await row('fn-b')).responsibility).toEqual({ humans: ['actor-b'], cet: false });
  const explained = await adapter.broker.call('activation.explain', {
    tenantId: 'tenant-a',
    functionId: 'fn-b',
  });
  expect(explained.history).toContainEqual(
    expect.objectContaining({
      kind: 'handoff',
      actorId: 'actor-b',
      responsibility: { humans: ['actor-b'], cet: false },
    })
  );
  expect(explained.activations[0].reason).toContainEqual(
    expect.objectContaining({ kind: 'handoff', actorId: 'actor-b' })
  );
  expect(adapter.events.at(-1)).toEqual({
    tenantId: 'tenant-a',
    functionId: 'fn-b',
    state: 'dormant',
    responsibility: { humans: ['actor-b'], cet: false },
  });
});
test('AC-04: another high-coverage actor retains human responsibility when one score falls', async () => {
  await sendTouch('fn-a');
  await coverage('fn-b', 1);
  await coverage('fn-b', 1, 'actor-c');
  await coverage('fn-b', 0);
  expect((await row('fn-b')).responsibility).toEqual({ humans: ['actor-c'], cet: false });
  await coverage('fn-b', 0, 'actor-c');
  expect((await row('fn-b')).responsibility).toEqual({ humans: [], cet: true });
});
test('rest window is inclusive; later dormant transition releases CET budget', async () => {
  await sendTouch('fn-a');
  adapter.clock.value += adapter.service.settings.restWindowMs;
  await adapter.service.sweep();
  expect((await row('fn-a')).state).toBe('active');
  adapter.clock.value++;
  await adapter.service.sweep();
  expect((await row('fn-a')).state).toBe('dormant');
  expect((await row('fn-b')).state).toBe('dormant');
  expect((await row('fn-b')).responsibility.cet).toBe(false);
});
test('agent lifecycle activity prolongs the rest window without spreading to another hop', async () => {
  await sendTouch('fn-a');
  adapter.clock.value += 1000;
  await adapter.broker.emit('shared-agent.lifecycle.v1', {
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    functionId: 'fn-b',
    lifecycle: 'active',
  });
  await adapter.service.settle();
  adapter.clock.value += adapter.service.settings.restWindowMs;
  await adapter.service.sweep();
  expect((await row('fn-b')).state).toBe('active');
  expect((await row('fn-c')).state).toBe('latent');
});
test('a subsequent explicit touch supplies one more step; no recursive propagation', async () => {
  await sendTouch('fn-a');
  await sendTouch('fn-b');
  expect((await row('fn-c')).responsibility.cet).toBe(true);
  expect((await row('fn-b')).responsibility.cet).toBe(true);
});
test('AC-07: duplicate touch/coverage events are durable no-ops; stale touches ignored', async () => {
  await sendTouch('fn-a');
  let before = await adapter.service.db.get('activation:tenant-a');
  let count = adapter.events.length;
  await sendTouch('fn-a');
  expect(await adapter.service.db.get('activation:tenant-a')).toEqual(before);
  expect(adapter.events).toHaveLength(count);
  await coverage('fn-b', 1);
  before = await adapter.service.db.get('activation:tenant-a');
  count = adapter.events.length;
  await coverage('fn-b', 1);
  expect(await adapter.service.db.get('activation:tenant-a')).toEqual(before);
  expect(adapter.events).toHaveLength(count);
  await sendTouch('fn-a', { at: '2025-01-01T00:00:00.000Z' });
  expect(await adapter.service.db.get('activation:tenant-a')).toEqual(before);
});
test('AC-07: concurrent handlers serialize a tenant and isolate other tenants', async () => {
  await Promise.all([
    adapter.service.acceptTouch(touch('fn-a')),
    adapter.service.acceptTouch(touch('fn-b')),
  ]);
  expect((await row('fn-a')).state).toBe('active');
  expect((await row('fn-b')).state).toBe('active');
  expect((await list('tenant-b')).every((item) => item.state === 'latent')).toBe(true);
  await coverage('fn-b', 1, 'actor-z', 'tenant-b');
  expect((await row('fn-b')).responsibility.humans).toEqual([]);
  await expect(
    adapter.broker.call(
      'activation.list',
      { tenantId: 'tenant-b' },
      { meta: { tenantId: 'tenant-a' } }
    )
  ).rejects.toThrow('Tenant mismatch');
});
test('read APIs resolve merged stored IDs and fail closed on unknown IDs', async () => {
  await sendTouch('fn-a');
  const next = chain();
  next.sourceHash = 'fixture-v2';
  next.functions[0].functionId = 'fn-x';
  next.functions[0].derivation = {
    lineage: [{ previousId: 'fn-a', relation: 'merged', overlap: 1 }],
  };
  adapter.service.model = next;
  const result = await adapter.broker.call('activation.get', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
  });
  expect(result.activations[0]).toMatchObject({
    functionId: 'fn-x',
    state: 'active',
    touchedBy: ['actor-a'],
  });
  expect(
    (
      await adapter.broker.call('activation.get', {
        tenantId: 'tenant-a',
        functionId: 'fn-unknown',
      })
    ).activations
  ).toEqual([]);
  await expect(adapter.service.acceptTouch(touch('fn-unknown'))).rejects.toThrow('Unresolved');
});
test('split lineage maps touches to both successors but does not duplicate coverage', async () => {
  await sendTouch('fn-a');
  await coverage('fn-a', 1);
  adapter.service.model = {
    sourceHash: 'fixture-v2',
    functions: ['fn-x', 'fn-y'].map((functionId) => ({
      functionId,
      neighbors: [],
      derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
    })),
  };
  const rows = await list();
  expect(rows.every((item) => item.state === 'active' && !item.responsibility.humans.length)).toBe(
    true
  );
  await expect(
    adapter.service.acceptCoverage({
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      functionId: 'fn-a',
      score: 1,
      origin: 'observed',
    })
  ).rejects.toThrow('Ambiguous');
});
test('latest coverage after lineage merge supersedes the same actor previous score', async () => {
  await coverage('fn-b', 1);
  const next = chain();
  next.sourceHash = 'fixture-v2';
  next.functions[1].functionId = 'fn-x';
  next.functions[1].derivation = {
    lineage: [{ previousId: 'fn-b', relation: 'merged', overlap: 1 }],
  };
  next.functions[0].neighbors = [{ functionId: 'fn-x', weight: 0.7, evidence: [] }];
  adapter.service.model = next;
  await coverage('fn-x', 0);
  await sendTouch('fn-a');
  expect((await row('fn-x')).responsibility.cet).toBe(true);
});
test('outbox retries after publication failure, including on duplicate delivery', async () => {
  const emit = jest.spyOn(adapter.broker, 'emit');
  emit.mockRejectedValueOnce(new Error('publish unavailable'));
  await expect(adapter.service.acceptTouch(touch('fn-a'))).rejects.toThrow('publish unavailable');
  expect((await adapter.service.db.get('activation:tenant-a')).outbox).toHaveLength(2);
  await adapter.service.acceptTouch(touch('fn-a'));
  expect((await adapter.service.db.get('activation:tenant-a')).outbox).toEqual([]);
  emit.mockRestore();
});
test('restart preserves events and tenant state through the lifecycle seam', async () => {
  const stores = new Map();
  await adapter.close();
  adapter = await createAdapter({
    model: chain(),
    jest,
    stores,
    dbPath: '/tmp/activation-restart-db',
  });
  await sendTouch('fn-a');
  const before = await list();
  await adapter.close();
  adapter = await createAdapter({
    model: chain(),
    jest,
    stores,
    dbPath: '/tmp/activation-restart-db',
  });
  expect(await list()).toEqual(before);
  await sendTouch('fn-a');
  expect(adapter.events).toEqual([]);
});
test.each([
  { confidence: 2 },
  { at: 'invalid' },
  { at: '2099-01-01' },
  { actorId: [] },
  { tenantId: '' },
])('invalid touches fail without persisting: %j', async (patch) => {
  await expect(adapter.service.acceptTouch(touch('fn-a', patch))).rejects.toThrow();
  expect((await adapter.service.db.allDocs()).rows).toEqual([]);
});
test.each([{ score: 2 }, { origin: 'other' }, { actorId: [] }])(
  'invalid coverage fails without persisting: %j',
  async (patch) => {
    await expect(
      adapter.service.acceptCoverage({
        tenantId: 'tenant-a',
        actorId: 'actor-a',
        functionId: 'fn-a',
        score: 1,
        origin: 'observed',
        ...patch,
      })
    ).rejects.toThrow();
    expect((await adapter.service.db.allDocs()).rows).toEqual([]);
  }
);
test('AC-03: seeded random chain/star/hub traces satisfy all three budget bounds', async () => {
  await adapter.close();
  let seed = 696;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const shape of ['chain', 'star', 'hub']) {
    const ids = Array.from({ length: 12 }, (_, i) => `fn-${i}`);
    const edges = Object.fromEntries(
      ids.map((id, i) => [
        id,
        ids
          .filter(
            (_other, j) =>
              j !== i &&
              (shape === 'hub' ||
                (shape === 'chain' && j === i + 1) ||
                (shape === 'star' && i === 0))
          )
          .map((other) => [other, random()]),
      ])
    );
    adapter = await createAdapter({
      jest,
      model: graph(edges),
      settings: { tenantBudget: 3, minWeight: 0.4 },
    });
    for (let step = 0; step < 100; step++) {
      await sendTouch(ids[Math.floor(random() * ids.length)], {
        conversationId: `conversation-${step}`,
      });
      if (step % 7 === 0) await coverage(ids[Math.floor(random() * ids.length)], random());
      const rows = await list();
      const touched = new Set(rows.filter((item) => item.touchedAt).map((item) => item.functionId));
      const cet = rows.filter((item) => item.responsibility.cet);
      expect(cet.length).toBeLessThanOrEqual(3);
      expect(rows.filter((item) => item.state === 'active').length).toBeLessThanOrEqual(
        touched.size + 3
      );
      for (const item of cet)
        expect(
          adapter.service.model.functions.some(
            (source) =>
              touched.has(source.functionId) &&
              source.neighbors.some(
                (edge) => edge.functionId === item.functionId && edge.weight >= 0.4
              )
          )
        ).toBe(true);
    }
    await adapter.close();
  }
  adapter = null;
});

test('model hash changes preserve the saved membership within a historical split', async () => {
  adapter.service.model.functions[0].capabilities = ['cap-a'];
  await sendTouch('fn-a');
  adapter.service.model = {
    sourceHash: 'fixture-v2',
    functions: [
      {
        functionId: 'fn-a',
        capabilities: ['cap-a'],
        neighbors: [],
        derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
      },
      {
        functionId: 'fn-x',
        capabilities: ['cap-b'],
        neighbors: [],
        derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
      },
    ],
  };
  expect((await row('fn-a')).state).toBe('active');
  expect((await row('fn-x')).state).toBe('latent');
});

test('duplicate lifecycle events do not manufacture recent activity', async () => {
  await sendTouch('fn-a');
  const event = {
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    functionId: 'fn-b',
    lifecycle: 'active',
  };
  await adapter.service.acceptActivity(event);
  const before = await adapter.service.db.get('activation:tenant-a');
  adapter.clock.value += 1000;
  await adapter.service.acceptActivity(event);
  expect(await adapter.service.db.get('activation:tenant-a')).toEqual(before);
});

test('failed publication followed by human handoff publishes only current responsibility', async () => {
  const emit = jest.spyOn(adapter.broker, 'emit');
  emit.mockRejectedValueOnce(new Error('publish unavailable'));
  await expect(adapter.service.acceptTouch(touch('fn-a'))).rejects.toThrow('publish unavailable');
  await adapter.service.acceptCoverage({
    tenantId: 'tenant-a',
    actorId: 'actor-b',
    functionId: 'fn-b',
    score: 1,
    origin: 'observed',
  });
  expect(adapter.events.filter((entry) => entry.functionId === 'fn-b')).toEqual([
    {
      tenantId: 'tenant-a',
      functionId: 'fn-b',
      state: 'dormant',
      responsibility: { humans: ['actor-b'], cet: false },
    },
  ]);
  emit.mockRestore();
});

test('a formerly touched but now uncovered neighbor may receive CET responsibility again', async () => {
  await sendTouch('fn-b');
  adapter.clock.value += adapter.service.settings.restWindowMs + 1;
  await adapter.service.sweep();
  await sendTouch('fn-a');
  expect((await row('fn-b')).responsibility.cet).toBe(true);
});

test('10,000 touches across conversations stay bounded with identical list and explain results', async () => {
  const reference = await createAdapter({ model: chain(), jest });
  try {
    const initial = adapter.clock.value;
    await sendTouch('fn-a');
    await reference.broker.emit('function.touched.v1', touch('fn-a'));
    await reference.service.settle();
    const before = await adapter.service.readDocument('tenant-a');
    for (let index = 1; index <= 10000; index++) {
      adapter.clock.value = initial + index;
      await sendTouch('fn-a', { conversationId: `conversation-${index}` });
    }
    reference.clock.value = adapter.clock.value;
    await reference.broker.emit(
      'function.touched.v1',
      touch('fn-a', { conversationId: 'conversation-10000' })
    );
    await reference.service.settle();
    const document = await adapter.service.readDocument('tenant-a');
    expect(document.touches).toHaveLength(1);
    expect(document.history).toHaveLength(before.history.length);
    expect(document.activations.every((entry) => entry.state !== 'latent')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(document))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(before)) + 100
    );
    expect(await list()).toEqual(
      await reference.broker.call('activation.list', { tenantId: 'tenant-a' })
    );
    for (const functionId of ['fn-a', 'fn-b', 'fn-c']) {
      const params = { tenantId: 'tenant-a', functionId };
      expect(await adapter.broker.call('activation.explain', params)).toEqual(
        await reference.broker.call('activation.explain', params)
      );
    }
  } finally {
    await reference.close();
  }
}, 30000);

test('expired non-influencing touches are removed without changing list or explain', async () => {
  adapter.service.settings.touchRetentionWindows = 2;
  await sendTouch('fn-a');
  adapter.clock.value += adapter.service.settings.restWindowMs * 3;
  const beforeCompaction = await list();
  await adapter.service.sweep();
  expect(await list()).toEqual(beforeCompaction);
  const beforeList = await list();
  const params = { tenantId: 'tenant-a', functionId: 'fn-a' };
  const beforeExplain = await adapter.broker.call('activation.explain', params);
  const document = await adapter.service.readDocument('tenant-a');
  expect(document.touches).toEqual([]);
  expect(document.activations).toHaveLength(2);
  await adapter.service.sweep();
  expect(await list()).toEqual(beforeList);
  expect(await adapter.broker.call('activation.explain', params)).toEqual(beforeExplain);
});

test('history count and age are bounded while the latest handoff stays explainable', async () => {
  adapter.service.settings.historyLimit = 7;
  adapter.service.settings.historyRetentionMs = 1000;
  await sendTouch('fn-a');
  for (let index = 0; index < 30; index++) {
    adapter.clock.value += 1;
    await coverage('fn-b', index % 2 ? 1 : 0);
  }
  expect((await adapter.service.readDocument('tenant-a')).history).toHaveLength(7);
  const before = await row('fn-b');
  adapter.clock.value += 1001;
  await adapter.service.sweep();
  expect((await adapter.service.readDocument('tenant-a')).history).toEqual([]);
  expect(await row('fn-b')).toEqual(before);
  expect(before.reason.some((entry) => entry.kind === 'handoff')).toBe(true);
});

test('failed notifications coalesce per function while history remains bounded', async () => {
  adapter.service.settings.historyLimit = 5;
  const emit = jest.spyOn(adapter.broker, 'emit').mockRejectedValue(new Error('unavailable'));
  await expect(adapter.service.acceptTouch(touch('fn-a'))).rejects.toThrow('unavailable');
  for (let index = 0; index < 30; index++) {
    await expect(
      adapter.service.acceptCoverage({
        tenantId: 'tenant-a',
        actorId: 'actor-b',
        functionId: 'fn-b',
        score: index % 2,
        origin: 'observed',
      })
    ).rejects.toThrow('unavailable');
  }
  const document = await adapter.service.readDocument('tenant-a');
  expect(document.history).toHaveLength(5);
  expect(document.outbox).toHaveLength(2);
  emit.mockRestore();
  await adapter.service.sweep();
  expect((await adapter.service.readDocument('tenant-a')).outbox).toEqual([]);
});

test('real adapter closes under fake timers and restores normal timer behavior', async () => {
  await adapter.close();
  adapter = null;
  jest.useFakeTimers({ now: Date.UTC(2026, 0, 1), doNotFake: ['hrtime', 'performance'] });
  let timed;
  try {
    timed = await createAdapter({ model: chain(), jest });
    await timed.close();
    timed = null;
  } finally {
    if (timed) await timed.close();
    jest.useRealTimers();
  }
});

test('expired source records may be compacted while recent neighbor activity retains responsibility', async () => {
  adapter.service.settings.touchRetentionWindows = 2;
  await sendTouch('fn-a');
  adapter.clock.value += adapter.service.settings.restWindowMs * 3;
  await adapter.broker.emit('shared-agent.lifecycle.v1', {
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    functionId: 'fn-b',
    lifecycle: 'active',
  });
  await adapter.service.settle();
  const before = await list();
  expect((await row('fn-b')).responsibility.cet).toBe(true);
  expect((await adapter.service.readDocument('tenant-a')).touches).toEqual([]);
  await adapter.service.sweep();
  expect(await list()).toEqual(before);
});

test('latent functions are omitted from storage but retain received coverage in read results and notifications', async () => {
  await coverage('fn-d', 1);
  expect((await adapter.service.readDocument('tenant-a')).activations).toEqual([]);
  expect((await row('fn-d')).responsibility.humans).toEqual(['actor-b']);
  expect(adapter.events.at(-1)).toEqual({
    tenantId: 'tenant-a',
    functionId: 'fn-d',
    state: 'latent',
    responsibility: { humans: ['actor-b'], cet: false },
  });
  const before = await adapter.service.readDocument('tenant-a');
  await coverage('fn-d', 1);
  await adapter.service.sweep();
  expect(await adapter.service.readDocument('tenant-a')).toEqual(before);
  await coverage('fn-d', 0);
  expect(adapter.events.at(-1).responsibility.humans).toEqual([]);
});
