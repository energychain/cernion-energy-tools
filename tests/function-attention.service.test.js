'use strict';
const { createAdapter } = require('./helpers/shared-service/real-adapter');
const { assertInvariants } = require('./helpers/shared-service/invariants');
const functions = [
  {
    functionId: 'fn-a',
    neighbors: [
      { functionId: 'fn-b', weight: 0.9 },
      { functionId: 'fn-c', weight: 0.8 },
      { functionId: 'fn-d', weight: 0.7 },
    ],
  },
  ...['fn-b', 'fn-c', 'fn-d', 'fn-e'].map((functionId) => ({ functionId, neighbors: [] })),
];
let adapter;
let ref;
beforeEach(async () => {
  ref = 0;
  adapter = await createAdapter({
    jest,
    model: { sourceHash: 'neutral-v1', functions },
    settings: { halfLifeTurns: 2, allowanceCap: 10, allowancePerTurn: 2 },
  });
});
afterEach(async () => {
  await adapter.close();
});
const turn = async (functionId = 'fn-a', patch = {}) => {
  adapter.clock.value += 1;
  const payload = {
    tenantId: 'tenant-a',
    actorId: 'actor-a',
    conversationId: 'conv-a',
    turnRef: `turn-${ref++}`,
    functionId,
    confidence: 1,
    at: new Date(adapter.clock.value).toISOString(),
    ...patch,
  };
  await adapter.service.acceptTouch(payload);
  return payload;
};
const rows = () => adapter.broker.call('activation.list', { tenantId: 'tenant-a' });
const attention = async (id = 'fn-b') =>
  (await rows()).find((row) => row.functionId === id).attention;
const agentEvent = (patch = {}) => ({
  tenantId: 'tenant-a',
  agentId: 'agent-a',
  functionId: 'fn-b',
  at: new Date(adapter.clock.value).toISOString(),
  ...patch,
});
const feedback = (outcome = 'accepted') =>
  adapter.service.acceptFeedback(agentEvent({ outcome, ref: `feedback-${ref++}` }));
const correction = (kind, roles = ['ROLE_USER'], extra = {}) =>
  adapter.service.acceptCorrection(
    {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      target: 'agent',
      ref: 'agent-a',
      correction: { functionId: 'fn-b', kind, ...extra },
    },
    { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles } }
  );

test('AC-01/06: strongest two neighbors; only relevant strong turns decay; time is inert', async () => {
  await turn();
  expect(
    (await rows()).filter((row) => row.responsibility.cet).map((row) => row.functionId)
  ).toEqual(['fn-b', 'fn-c']);
  await adapter.service.acceptCoverage({
    tenantId: 'tenant-a',
    actorId: 'actor-a',
    functionId: 'fn-a',
    score: 0.5,
    origin: 'observed',
  });
  await turn('fn-e', { actorId: 'actor-b' });
  await turn('fn-e', { confidence: 0.19 });
  expect((await attention()).turnsSinceRefresh).toBe(0);
  await turn('fn-e');
  expect((await attention()).relevance).toBeCloseTo(Math.pow(0.5, 0.5));
  const before = await attention();
  adapter.clock.value += 1000;
  await adapter.service.sweep();
  expect(await attention()).toEqual(before);
  await turn('fn-a');
  expect((await attention()).turnsSinceRefresh).toBe(0);
});

test('AC-01: multi-function turn counted once; legacy identity and restart deduplication', async () => {
  const first = await turn();
  await adapter.service.acceptTouch({ ...first, functionId: 'fn-e' });
  await adapter.service.acceptTouch(first);
  expect((await adapter.service.readDocument('tenant-a')).activatingTurns).toBe(1);
  const legacy = await turn('fn-e', { turnRef: undefined });
  await adapter.service.acceptTouch({ ...legacy, functionId: 'fn-d' });
  expect((await adapter.service.readDocument('tenant-a')).activatingTurns).toBe(2);
  const stores = new Map();
  const settings = { halfLifeTurns: 2 };
  await adapter.close();
  adapter = await createAdapter({
    jest,
    model: { sourceHash: 'neutral-v1', functions },
    stores,
    dbPath: '/tmp/attention-restart-fixture',
    settings,
  });
  const event = await turn();
  const before = await attention();
  const clock = adapter.clock;
  await adapter.close();
  adapter = await createAdapter({
    jest,
    model: { sourceHash: 'neutral-v1', functions },
    stores,
    dbPath: '/tmp/attention-restart-fixture',
    clock,
    settings,
  });
  await adapter.service.acceptTouch(event);
  expect(await attention()).toEqual(before);
});

test('AC-02/03: rejection refreshes, positives establish, same feedback is idempotent, hysteresis decays', async () => {
  await turn();
  await turn('fn-e');
  await feedback('rejected');
  expect(await attention()).toMatchObject({ turnsSinceRefresh: 0, reactivationScore: 0 });
  const event = agentEvent({ outcome: 'used', ref: 'ref-a' });
  await adapter.service.acceptFeedback(event);
  await adapter.service.acceptFeedback(event);
  expect((await attention()).reactivationScore).toBe(1);
  await feedback();
  await feedback();
  expect(await attention()).toMatchObject({ tier: 'established', halfLifeTurns: 20 });
  for (let i = 0; i < 21; i++) await turn('fn-e');
  expect((await attention()).tier).toBe('transient');
});

test('AC-04: tenant users retain with cap; only authenticated admins pin; reversals are journaled', async () => {
  await turn();
  await correction('retain', ['ROLE_USER'], { factor: 100 });
  expect(await attention()).toMatchObject({ tier: 'retained', retainFactor: 20 });
  await expect(correction('pin')).rejects.toMatchObject({ code: 403 });
  await expect(
    adapter.service.acceptCorrection({
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      target: 'agent',
      ref: 'fn-b',
      correction: { kind: 'retain' },
    })
  ).rejects.toMatchObject({ code: 403 });
  await expect(
    adapter.service.acceptCorrection(
      {
        tenantId: 'tenant-a',
        actorId: 'actor-b',
        target: 'agent',
        ref: 'fn-b',
        correction: { kind: 'retain' },
      },
      { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_ADMIN'] } }
    )
  ).rejects.toMatchObject({ code: 403 });
  await correction('pin', ['ROLE_TENANT_ADMIN']);
  const before = await attention();
  adapter.clock.value += adapter.service.settings.restWindowMs + 1;
  await adapter.service.sweep();
  expect(await attention()).toEqual(before);
  expect((await rows()).find((row) => row.functionId === 'fn-b').responsibility.cet).toBe(true);
  await correction('unpin', ['ROLE_ADMIN']);
  await correction('unretain');
  expect((await attention()).tier).toBe('transient');
  await adapter.journal.writeQueue;
  expect(
    (await adapter.journal.rawEntries('tenant-a')).some((entry) =>
      entry.summary.includes('attention_inventory')
    )
  ).toBe(true);
});

test('AC-05: no units from feedback, corrections, lifecycle, sweep or reads; overspend blocked', async () => {
  await turn();
  const before = await attention();
  await adapter.service.acceptConsumption(agentEvent({ units: before.allowance + 1, kind: 'llm' }));
  expect(await attention()).toMatchObject({
    allowance: before.allowance,
    consumedUnits: 0,
    allowanceExhausted: true,
  });
  expect(adapter.events.at(-1).attention.allowanceExhausted).toBe(true);
  await feedback();
  await correction('pin', ['ROLE_ADMIN']);
  await adapter.service.acceptActivity(agentEvent({ lifecycle: 'active' }));
  adapter.clock.value += 100000;
  await adapter.service.sweep();
  expect((await attention()).allowance).toBe(before.allowance);
  await adapter.service.acceptConsumption(
    agentEvent({ units: before.allowance, kind: 'operation' })
  );
  expect((await attention()).allowance).toBe(0);
  await turn('fn-e');
  expect((await attention()).allowance).toBeGreaterThan(0);
});

test('AC-01/08: decay retires persistently; triggering turn revives without manufacturing units', async () => {
  await turn();
  for (let i = 0; i < 9; i++) await turn('fn-e');
  expect((await rows()).find((row) => row.functionId === 'fn-b')).toMatchObject({
    state: 'dormant',
    responsibility: { cet: false },
  });
  await adapter.service.sweep();
  expect((await attention()).retired).toBe(true);
  await turn();
  expect((await rows()).find((row) => row.functionId === 'fn-b').responsibility.cet).toBe(true);
  expect((await attention()).relevance).toBe(1);
  expect(
    (await adapter.broker.call('activation.list', { tenantId: 'tenant-b' })).every(
      (row) => !row.attention
    )
  ).toBe(true);
});

test.each([715, 693, 20261003])(
  'AC-05/07: randomized costs bounded by activating turns seed=%i',
  async (seed) => {
    let value = seed;
    const random = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 0x100000000;
    };
    await turn();
    for (let i = 0; i < 100; i++) {
      const choice = random();
      if (choice < 0.35) await turn(random() < 0.5 ? 'fn-a' : 'fn-e');
      else if (choice < 0.65)
        await adapter.service.acceptConsumption(
          agentEvent({ units: random() * 4 + 0.01, kind: 'wake' })
        );
      else if (choice < 0.8) await feedback(random() < 0.5 ? 'rejected' : 'accepted');
      else if (choice < 0.9) await correction(random() < 0.5 ? 'retain' : 'unretain');
      else {
        adapter.clock.value += 10;
        await adapter.service.sweep();
      }
      const state = await adapter.snapshot();
      assertInvariants(state, ['I-3', 'I-10']);
      const spent = state.activations.reduce(
        (sum, row) => sum + (row.attention?.consumedUnits || 0),
        0
      );
      expect(spent).toBeLessThanOrEqual(state.activatingTurns * state.allowancePerTurn + 1e-9);
    }
  }
);

test('AC-08: resolving a split conserves allowance instead of multiplying it', async () => {
  await turn();
  const before = await attention();
  adapter.service.model = {
    sourceHash: 'neutral-v2',
    functions: [
      {
        functionId: 'fn-a',
        neighbors: [
          { functionId: 'fn-x', weight: 0.9 },
          { functionId: 'fn-y', weight: 0.8 },
        ],
      },
      ...['fn-x', 'fn-y'].map((functionId) => ({
        functionId,
        neighbors: [],
        derivation: { lineage: [{ previousId: 'fn-b', relation: 'split', overlap: 0.5 }] },
      })),
    ],
  };
  const result = (await rows()).filter((row) => row.attention);
  expect(result).toHaveLength(2);
  expect(result.reduce((sum, row) => sum + row.attention.allowance, 0)).toBe(before.allowance);
  await adapter.service.sweep();
  expect(
    (await rows())
      .filter((row) => row.attention)
      .reduce((sum, row) => sum + row.attention.allowance, 0)
  ).toBe(before.allowance);
});

test('AC-04: real correction event applies authorized metadata and logs denials', async () => {
  await turn();
  await adapter.apply({
    event: 'shared-service.correction.v1',
    meta: { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_USER'] } },
    payload: {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      target: 'agent',
      ref: 'agent-a',
      correction: { functionId: 'fn-b', kind: 'retain' },
    },
  });
  expect((await attention()).tier).toBe('retained');
  const warn = jest.spyOn(adapter.service.logger, 'warn');
  await expect(correction('pin')).rejects.toThrow('Admin role');
  expect(warn).toHaveBeenCalledWith(
    'Attention correction rejected',
    expect.objectContaining({ reason: 'Admin role required' })
  );
  warn.mockRestore();
});

test.each([
  { units: -1, kind: 'llm' },
  { units: Infinity, kind: 'wake' },
  { units: 1, kind: 'unknown' },
  { units: 1, kind: 'llm', functionId: 'unknown' },
  { units: 1, kind: 'llm', at: 'invalid' },
])('rejects malformed consumption %j', async (patch) => {
  await turn();
  const before = await attention();
  await expect(adapter.service.acceptConsumption(agentEvent(patch))).rejects.toThrow();
  expect(await attention()).toEqual(before);
});

test('each insufficient consumption request publishes exhaustion, without double charging', async () => {
  await turn();
  const before = await attention();
  const event = agentEvent({ units: 100, kind: 'llm' });
  await adapter.service.acceptConsumption(event);
  const count = adapter.events.length;
  await adapter.service.acceptConsumption(event);
  expect(adapter.events.length).toBe(count + 1);
  expect(await attention()).toMatchObject({
    allowance: before.allowance,
    consumedUnits: 0,
    allowanceExhausted: true,
  });
});

test('retired neighbors release their slot to another eligible candidate', async () => {
  adapter.service.settings.tenantBudget = 1;
  await turn();
  for (let i = 0; i < 9; i++) await turn('fn-e');
  expect((await rows()).find((row) => row.functionId === 'fn-b').responsibility.cet).toBe(false);
  expect((await rows()).find((row) => row.functionId === 'fn-c').responsibility.cet).toBe(true);
});
