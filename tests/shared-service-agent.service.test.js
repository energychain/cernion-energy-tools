'use strict';

const { createAdapter } = require('./helpers/shared-service/real-adapter');
const { getFunctionModel } = require('../src/function-model');
const {
  deriveMandate,
  policyReason,
  collectFindings,
} = require('../src/shared-service-agent-policy');
const { compareCanonicalStrings } = require('../src/canonical-order');
const index = require('../operation-capability-index.json');
const operation = (extra = {}) => ({
  operationId: 'neutral_read',
  action: 'neutral.read',
  service: 'neutral',
  agentable: true,
  consequenceLevel: 'none',
  sideEffects: [],
  operationKind: 'data_read',
  requiredScopes: ['neutral:read'],
  parameters: { required: [] },
  ...extra,
});
const model = () => ({
  sourceHash: 'neutral-model',
  functions: [
    {
      functionId: 'fn-a',
      capabilities: [],
      operations: [],
      neighbors: [{ functionId: 'fn-b', weight: 0.8, evidence: [] }],
    },
    {
      functionId: 'fn-b',
      capabilities: [],
      operations: ['neutral.read'],
      neighbors: [{ functionId: 'fn-a', weight: 0.8, evidence: [] }],
    },
  ],
});
const meta = (tenantId = 'tenant-a', id = 'person-a', roles = ['ROLE_USER']) => ({
  authUser: { tenantId, id, roles },
  tenantId,
});
let adapter;
afterEach(async () => {
  jest.restoreAllMocks();
  if (adapter) await adapter.close();
  adapter = null;
});
async function setup(options = {}) {
  adapter = await createAdapter({
    jest,
    model: model(),
    withAgents: true,
    agentSettings: { operationIndex: { operations: [operation()] }, ...options.agentSettings },
    ...options,
  });
  return adapter;
}
async function touch(extra = {}) {
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'conversation-a',
      confidence: 1,
      ...extra,
    },
  });
}
async function agent() {
  return (await adapter.snapshot()).agents.find((item) => item.functionId === 'fn-b');
}
async function cycle() {
  const item = await agent();
  return adapter.broker.call('shared-service-agent.runCycle', {
    tenantId: item.tenantId,
    agentId: item.agentId,
  });
}
function neutralRead(handler = () => ({ findings: [] })) {
  return adapter.broker.createService({ name: 'neutral', actions: { read: { handler } } });
}

test('AC-01: one persisted agent per CET function; no timer; handoff and dormancy retire', async () => {
  await setup();
  neutralRead();
  expect((await adapter.snapshot()).agents).toEqual([]);
  await touch();
  const first = await agent();
  expect(first.lifecycle).toBe('active');
  expect(first.stats.cycles).toBe(1);
  expect(first.stats.consumedUnits).toBeCloseTo(0.35);
  await adapter.broker.emit(
    'function.activation.changed.v1',
    adapter.events.findLast((row) => row.functionId === 'fn-b')
  );
  await adapter.agents.settle();
  expect((await agent()).stats.cycles).toBe(1);
  await adapter.apply({
    event: 'function.coverage.changed.v1',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-b',
      functionId: 'fn-b',
      score: 1,
      origin: 'observed',
    },
  });
  expect((await agent()).lifecycle).toBe('retired');
  expect((await adapter.snapshot()).agents).toHaveLength(1);
});

test('AC-02: every actual external/high operation is rejected before invocation or consumption', async () => {
  await setup({ agentSettings: { operationIndex: index } });
  await touch();
  const item = await agent();
  const forbidden = index.operations.filter(
    (op) => op.sideEffects.includes('external_system_call') || op.consequenceLevel === 'high'
  );
  expect(forbidden.length).toBeGreaterThan(0);
  const before = (await agent()).stats.consumedUnits;
  for (const op of forbidden) {
    await expect(
      adapter.agents.actions.executeOperation(
        { tenantId: item.tenantId, agentId: item.agentId, operationId: op.operationId },
        { meta: meta() }
      )
    ).rejects.toThrow();
    expect(policyReason(op)).not.toBeNull();
  }
  expect((await agent()).stats.consumedUnits).toBe(before);
});

test('AC-02: tenant, role, scope, No-Call and existing backend guards remain enforced', async () => {
  const forbiddenAction = require('../src/capability-catalog').GLOBAL_DO_NOT_USE[0].action;
  const ops = [
    operation(),
    operation({ operationId: 'blocked', action: forbiddenAction }),
    operation({
      operationId: 'draft',
      operationKind: 'draft_write',
      sideEffects: ['creates_draft_or_intent'],
      consequenceLevel: 'low',
      requiredScopes: ['neutral:write'],
    }),
  ];
  await setup({ agentSettings: { operationIndex: { operations: ops } } });
  const backend = neutralRead(() => {
    throw Object.assign(new Error('backend guard'), { type: 'BACKEND_DENIED' });
  });
  await touch();
  const item = await agent();
  const call = (operationId, input = {}, auth = meta()) =>
    adapter.agents.actions.executeOperation(
      { tenantId: item.tenantId, agentId: item.agentId, operationId, input },
      { meta: auth }
    );
  await expect(call('neutral_read', { tenantId: 'tenant-b' })).rejects.toThrow('Tenant mismatch');
  await expect(call('neutral_read', {}, meta('tenant-b'))).rejects.toThrow('Tenant mismatch');
  await expect(call('blocked')).rejects.toThrow('no_call');
  await expect(call('draft')).rejects.toThrow();
  adapter.agents.settings.actorRoles = [];
  await expect(call('neutral_read')).rejects.toThrow('Authenticated actor');
  adapter.agents.settings.actorRoles = ['ROLE_USER'];
  backend.schema.actions.read.requiredRoles = ['ROLE_ADMIN'];
  await expect(call('neutral_read')).rejects.toThrow('Role required');
  backend.schema.actions.read.requiredRoles = [];
  await expect(call('neutral_read')).rejects.toThrow('backend guard');
  const entries = await adapter.journal.readEntries('tenant-a');
  expect(entries.some((entry) => entry.summary.includes('BACKEND_DENIED'))).toBe(true);
});

test('AC-03: identical generic lifecycle/mandate behavior for 24 randomly sampled real functions', async () => {
  const functions = [...getFunctionModel().functions];
  let seed = 697;
  const selected = [];
  while (selected.length < 24) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    selected.push(functions.splice(seed % functions.length, 1)[0]);
  }
  const real = { ...getFunctionModel(), functions: selected };
  await setup({ model: real, agentSettings: { operationIndex: index } });
  for (const fn of selected) {
    await adapter.broker.emit('function.activation.changed.v1', {
      tenantId: 'tenant-a',
      functionId: fn.functionId,
      state: 'active',
      responsibility: { humans: [], cet: true },
      attention: { allowance: 0, allowanceExhausted: true, tier: 'transient' },
    });
  }
  await adapter.agents.settle();
  const agents = adapter.agents.publicAgents(await adapter.agents.readDocument('tenant-a'));
  expect(agents).toHaveLength(24);
  expect(new Set(agents.map((item) => item.lifecycle))).toEqual(new Set(['sleeping']));
  for (const item of agents) {
    const fn = selected.find((row) => row.functionId === item.functionId);
    expect(item.mandate).toEqual(deriveMandate(fn, index.operations));
    expect(item.mandate.operations).toEqual(
      index.operations
        .filter((op) => fn.operations.includes(op.action) && !policyReason(op))
        .map((op) => op.operationId)
        .sort(compareCanonicalStrings)
    );
  }
});

test('AC-04/06: findings precede quota-bound LLM; only neighboring observed people receive proposals and feedback', async () => {
  await setup();
  neutralRead(() => ({ findings: [{ kind: 'neutral' }] }));
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
          {
            id: 'persona-other',
            tenantId: 'tenant-a',
            openclawUserId: 'person-other',
            personaType: 'human',
            status: 'active',
          },
        ],
      }),
    },
  });
  // Isolated modules load a separate facade instance; spy on its method at the existing boundary.
  const generate = jest
    .spyOn(adapter.agents.llmClient, 'generateStructured')
    .mockResolvedValue({ summary: 'Review the observed finding.' });
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
  await touch();
  expect(generate).toHaveBeenCalledWith(
    expect.any(Object),
    expect.any(String),
    expect.objectContaining({ tenantId: 'tenant-a' })
  );
  const messages = await adapter.inbox.getTenantInboxMessages('tenant-a');
  expect(messages).toHaveLength(1);
  expect(messages[0].personaId).toBe('persona-a');
  const item = await agent();
  expect(item.stats.consumedUnits).toBeCloseTo(1.85);
  const proposal = (await adapter.agents.readDocument('tenant-a')).agents[0].proposals[0];
  await expect(
    adapter.agents.actions.resolveProposal(
      { tenantId: 'tenant-a', ref: proposal.ref, outcome: 'accepted' },
      { meta: meta('tenant-a', 'person-other') }
    )
  ).rejects.toThrow('Proposal not accessible');
  await adapter.agents.actions.resolveProposal(
    { tenantId: 'tenant-a', ref: proposal.ref, outcome: 'accepted' },
    { meta: meta() }
  );
  await adapter.agents.settle();
  const feedback = adapter.agentEvents.filter((event) => event.outcome);
  expect(feedback).toEqual([
    expect.objectContaining({ agentId: item.agentId, functionId: 'fn-b', outcome: 'accepted' }),
  ]);
  await adapter.agents.actions.resolveProposal(
    { tenantId: 'tenant-a', ref: proposal.ref, outcome: 'accepted' },
    { meta: meta() }
  );
  expect(adapter.agentEvents.filter((event) => event.outcome)).toHaveLength(1);
  expect((await adapter.inbox.getTenantInboxMessages('tenant-a'))[0].status).toBe('resolved');
});

test('AC-05/06: exhausted or insufficient allowance sleeps; every aborted/error cycle is journaled', async () => {
  await setup();
  neutralRead();
  await touch();
  const item = await agent();
  const row = (await adapter.broker.call('activation.list', { tenantId: 'tenant-a' }))[1];
  await adapter.broker.emit('shared-agent.consumption.v1', {
    tenantId: 'tenant-a',
    agentId: item.agentId,
    functionId: 'fn-b',
    kind: 'operation',
    units: row.attention.allowance,
    at: new Date(adapter.clock.value).toISOString(),
  });
  await adapter.agents.settle();
  expect((await agent()).lifecycle).toBe('sleeping');
  const generate = jest.spyOn(adapter.agents.llmClient, 'generateStructured');
  const before = (await adapter.journal.readEntries('tenant-a')).length;
  expect(await cycle()).toEqual({ findings: 0, consumedUnits: 0, proposals: 0 });
  expect(generate).not.toHaveBeenCalled();
  const entries = await adapter.journal.readEntries('tenant-a');
  expect(entries.length).toBeGreaterThan(before);
  expect(entries.some((entry) => entry.summary.includes('AGENT_ALLOWANCE'))).toBe(true);
});

test('AC-01/06: tier changes are inherited; a handoff during a read prevents further costs', async () => {
  await setup();
  neutralRead(async (ctx) => {
    expect(ctx.meta.actorType).toBe('shared-service-agent');
    expect(ctx.meta.authUser.roles).toEqual(['ROLE_USER']);
    await adapter.broker.emit('function.coverage.changed.v1', {
      tenantId: 'tenant-a',
      actorId: 'person-b',
      functionId: 'fn-b',
      score: 1,
      origin: 'observed',
    });
    return { findings: [{}] };
  });
  await touch();
  expect((await agent()).lifecycle).toBe('retired');
  expect((await agent()).stats.consumedUnits).toBeCloseTo(0.35);
});

test('AC-06: configurable costs and tier inheritance never refill allowance', async () => {
  await setup({
    agentSettings: {
      operationIndex: { operations: [operation()] },
      unitCosts: { wake: 0.2, operation: 0.5, llm: 2 },
    },
  });
  neutralRead();
  await touch();
  expect((await agent()).stats.consumedUnits).toBeCloseTo(0.7);
  const item = await agent();
  await adapter.apply({
    event: 'shared-service.correction.v1',
    meta: { apiToken: { tenantId: 'tenant-a', id: 'person-a', roles: ['ROLE_TENANT_ADMIN'] } },
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      target: 'agent',
      ref: item.agentId,
      correction: { functionId: 'fn-b', kind: 'pin' },
    },
  });
  expect((await agent()).attention.tier).toBe('inventory');
  expect((await adapter.snapshot()).activatingTurns).toBe(1);
  expect((await agent()).stats.consumedUnits).toBeCloseTo(1.4);
  const cycles = (await agent()).stats.cycles;
  await adapter.apply({ type: 'advance', milliseconds: 1000 });
  expect((await agent()).stats.cycles).toBe(cycles);
});

test('AC-05/07: a failed journal append is durably retried before further spending', async () => {
  await setup();
  neutralRead();
  await touch();
  const append = jest
    .spyOn(adapter.journal, 'appendEntry')
    .mockRejectedValueOnce(
      Object.assign(new Error('unavailable'), { type: 'JOURNAL_UNAVAILABLE' })
    );
  await expect(cycle()).rejects.toThrow('unavailable');
  const pending = (await adapter.agents.readDocument('tenant-a')).agents[0].pendingJournal;
  expect(pending).toEqual(expect.objectContaining({ agentId: (await agent()).agentId }));
  append.mockRestore();
  await cycle();
  expect((await adapter.agents.readDocument('tenant-a')).agents[0].pendingJournal).toBeNull();
  expect(
    (await adapter.journal.readEntries('tenant-a')).filter(
      (entry) => entry.entryId === pending.entryId
    )
  ).toHaveLength(1);
});

test('AC-01: authenticated list/get and admin retire action preserve tenant boundaries', async () => {
  await setup();
  neutralRead();
  await touch();
  const item = await agent();
  expect(
    await adapter.agents.actions.get(
      { tenantId: 'tenant-a', agentId: item.agentId },
      { meta: meta() }
    )
  ).toEqual(item);
  await expect(
    adapter.agents.actions.list({ tenantId: 'tenant-a' }, { meta: meta('tenant-b') })
  ).rejects.toThrow('Tenant mismatch');
  await expect(
    adapter.agents.actions.retire({ tenantId: 'tenant-a', agentId: item.agentId }, { meta: meta() })
  ).rejects.toThrow('Management role');
  await adapter.agents.actions.retire(
    { tenantId: 'tenant-a', agentId: item.agentId },
    { meta: meta('tenant-a', 'person-a', ['ROLE_TENANT_ADMIN']) }
  );
  expect((await agent()).lifecycle).toBe('retired');
  expect(adapter.agentEvents.some((event) => event.lifecycle === 'retired')).toBe(true);
  expect(await cycle()).toEqual({ findings: 0, proposals: 0, consumedUnits: 0 });
});

test('AC-06: no findings means no LLM; positive findings with too little budget cannot call LLM', async () => {
  await setup();
  neutralRead();
  const generate = jest.spyOn(adapter.agents.llmClient, 'generateStructured');
  await touch();
  expect(generate).not.toHaveBeenCalled();
  const item = await agent();
  const initial = (await adapter.service.readRows('tenant-a')).find(
    (row) => row.functionId === 'fn-b'
  );
  await adapter.broker.emit('shared-agent.consumption.v1', {
    tenantId: 'tenant-a',
    agentId: item.agentId,
    functionId: 'fn-b',
    kind: 'operation',
    units: initial.attention.allowance - 0.05,
    at: new Date(adapter.clock.value).toISOString(),
  });
  await adapter.agents.settle();
  const before = adapter.agentEvents.length;
  expect(await cycle()).toEqual({ findings: 0, proposals: 0, consumedUnits: 0 });
  expect(adapter.agentEvents.slice(before).filter((event) => event.kind)).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
});

test.each(['LLM_QUOTA_EXCEEDED', 'AGENT_LLM_RESULT'])(
  'AC-05/06: model failure %s journals its class and never delivers a proposal',
  async (errorClass) => {
    await setup();
    neutralRead(() => ({ findings: [{ summary: 'Check observed state.' }] }));
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
    const generate = jest.spyOn(adapter.agents.llmClient, 'generateStructured');
    if (errorClass === 'LLM_QUOTA_EXCEEDED')
      generate.mockRejectedValue(Object.assign(new Error('quota'), { type: errorClass }));
    else generate.mockResolvedValue(null);
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
    await touch();
    expect(
      (await adapter.journal.readEntries('tenant-a')).some((entry) =>
        entry.summary.includes(errorClass)
      )
    ).toBe(true);
    expect(await adapter.inbox.getTenantInboxMessages('tenant-a')).toEqual([]);
    expect((await agent()).stats.consumedUnits).toBeCloseTo(1.6);
  }
);

test('AC-06: findings with insufficient remaining allowance stop before the LLM and stay sleeping until funding', async () => {
  await setup();
  let finding = false;
  neutralRead(() => ({ findings: finding ? [{}] : [] }));
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
  await touch();
  finding = true;
  const item = await agent();
  const row = (await adapter.service.readRows('tenant-a')).find(
    (entry) => entry.functionId === 'fn-b'
  );
  await adapter.broker.emit('shared-agent.consumption.v1', {
    tenantId: item.tenantId,
    agentId: item.agentId,
    functionId: item.functionId,
    units: row.attention.allowance - 0.8,
    kind: 'operation',
    at: new Date(adapter.clock.value).toISOString(),
  });
  await adapter.agents.settle();
  const result = await cycle();
  await adapter.agents.settle();
  expect(result).toEqual({ findings: 1, proposals: 0, consumedUnits: 0.6 });
  expect(generate).not.toHaveBeenCalled();
  expect((await agent()).lifecycle).toBe('sleeping');
  adapter.clock.value += 1;
  await touch({ conversationId: 'funding-turn' });
  expect(generate).toHaveBeenCalledTimes(1);
});

test('AC-03/05: neutral structured findings and overdue timestamps are bounded and exclude malformed input', () => {
  const now = Date.UTC(2026, 0, 1);
  const rows = [
    null,
    { dueAt: 'invalid' },
    { dueAt: new Date(now + 1).toISOString() },
    {
      dueAt: new Date(now).toISOString(),
      deviation: true,
      findings: [null, 'invalid', { summary: 'Observed difference.' }],
    },
  ];
  expect(collectFindings(rows, now, 10)).toEqual([
    { kind: 'finding', summary: 'Observed difference.' },
    { kind: 'deadline' },
    { kind: 'deviation' },
  ]);
  expect(collectFindings({ findings: [{ summary: 'a'.repeat(1000) }, {}] }, now, 1)).toEqual([
    { kind: 'finding', summary: 'a'.repeat(240) },
  ]);
  expect(collectFindings('invalid', now, 10)).toEqual([]);
});

test('AC-04/07: feedback publication is durable and retries without creating another positive reaction', async () => {
  await setup();
  neutralRead(() => ({ findings: [{}] }));
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
  jest
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
  await touch();
  const proposal = (await adapter.agents.readDocument('tenant-a')).agents[0].proposals[0];
  const emit = adapter.broker.emit.bind(adapter.broker);
  let fail = true;
  const failing = jest.spyOn(adapter.broker, 'emit').mockImplementation((name, ...args) => {
    if (name === 'shared-agent.feedback.v1' && fail) {
      fail = false;
      return Promise.reject(new Error('publication unavailable'));
    }
    return emit(name, ...args);
  });
  const resolve = () =>
    adapter.agents.actions.resolveProposal(
      { tenantId: 'tenant-a', ref: proposal.ref, outcome: 'used' },
      { meta: meta() }
    );
  await expect(resolve()).rejects.toThrow('publication unavailable');
  expect(
    (await adapter.agents.readDocument('tenant-a')).agents[0].proposals[0].pendingFeedback
  ).toBe(true);
  await resolve();
  await adapter.agents.settle();
  failing.mockRestore();
  const row = (await adapter.service.readRows('tenant-a')).find(
    (item) => item.functionId === 'fn-b'
  );
  expect(row.attention.reactivationScore).toBe(1);
  expect(
    (await adapter.agents.readDocument('tenant-a')).agents[0].proposals[0].pendingFeedback
  ).toBe(false);
  expect(
    (await adapter.journal.readEntries('tenant-a')).filter(
      (entry) => entry.entryId === `feedback-${proposal.ref}`
    )
  ).toHaveLength(1);
});

test('AC-07: saved function identities follow real resolver lineage instead of stale references', async () => {
  await setup();
  neutralRead();
  await touch();
  const prior = await agent();
  adapter.agents.model = {
    sourceHash: 'neutral-next',
    functions: [
      {
        functionId: 'fn-next',
        capabilities: [],
        operations: ['neutral.read'],
        neighbors: [],
        derivation: { lineage: [{ previousId: 'fn-b', relation: 'merge', overlap: 1 }] },
      },
    ],
  };
  const result = await adapter.agents.actions.get(
    { tenantId: 'tenant-a', agentId: prior.agentId },
    { meta: meta() }
  );
  expect(result.functionId).toBe('fn-next');
});

test('AC-07: bounded coverage and unresolved proposal associations apply backpressure', async () => {
  await setup({
    agentSettings: {
      operationIndex: { operations: [operation()] },
      maxProposalsPerAgent: 1,
      maxCoverageRecords: 3,
    },
  });
  neutralRead(() => ({ findings: [{}] }));
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
  await touch();
  adapter.clock.value += 1;
  await touch({ conversationId: 'funding-again' });
  expect(generate).toHaveBeenCalledTimes(1);
  expect((await adapter.agents.readDocument('tenant-a')).agents[0].proposals).toHaveLength(1);
  for (let index = 0; index < 10; index++)
    await adapter.broker.emit('function.coverage.changed.v1', {
      tenantId: 'tenant-a',
      actorId: `person-${index}`,
      functionId: 'fn-a',
      score: 0.1,
      origin: 'observed',
    });
  await adapter.agents.settle();
  expect((await adapter.agents.readDocument('tenant-a')).coverage).toHaveLength(3);
});

test('AC-04: resolving through the original Inbox action automatically publishes associated human feedback', async () => {
  await setup();
  neutralRead(() => ({ findings: [{}] }));
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
  jest
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
  await touch();
  const proposal = (await adapter.agents.readDocument('tenant-a')).agents[0].proposals[0];
  await adapter.broker.call(
    'persona-inbox.resolveByHitlItem',
    { tenantId: 'tenant-a', hitlItemId: proposal.ref, resolutionSource: 'rejected' },
    { meta: meta() }
  );
  await adapter.agents.settle();
  expect(adapter.agentEvents.filter((event) => event.outcome)).toEqual([
    expect.objectContaining({ outcome: 'rejected', functionId: 'fn-b' }),
  ]);
  expect(
    (await adapter.service.readRows('tenant-a')).find((row) => row.functionId === 'fn-b').attention
      .reactivationScore
  ).toBe(0);
});
