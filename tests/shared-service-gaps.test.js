'use strict';

const { projectSignals, isFinding } = require('../src/signal-projection');
const { handleCorrectionTurn } = require('../src/workbench-corrections');
const { WorkbenchStore } = require('../src/workbench-store');
const { memoryPouch } = require('./helpers/shared-service/memory-pouch');
const {
  createGapAdapter,
  model,
  operation,
  meta,
} = require('./helpers/shared-service/gap-adapter');
let adapter, response, backend, store, generate, contextRef;
beforeEach(async () => {
  adapter = await createGapAdapter(jest);
  response = adapter.gapFixture.response;
  backend = adapter.gapFixture.backend;
  contextRef = adapter.gapFixture.contextRef;
  generate = jest.spyOn(adapter.agents.llmClient, 'generateStructured').mockImplementation(() => {
    throw new Error('Unexpected model call');
  });
  const Pouch = memoryPouch();
  store = new WorkbenchStore({
    conversationsDb: new Pouch('conversations'),
    turnMemoryDb: new Pouch('turns'),
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await adapter.close();
});
// Use the service's persisted identity, never fabricate a proposal or gap association.
async function cycle() {
  adapter.gapFixture.response = response;
  adapter.gapFixture.contextRef = contextRef;
  const [agent] = (await adapter.agents.readDocument('tenant-a')).agents;
  const result = await adapter.broker.call('shared-service-agent.runCycle', {
    tenantId: 'tenant-a',
    agentId: agent.agentId,
  });
  await adapter.noticesService.settle();
  return result;
}
const gaps = async () =>
  (await adapter.agents.readDocument('tenant-a')).agents.flatMap((a) => a.gapLists || []);
const queue = async (auth = meta()) =>
  adapter.noticesService.actions.list(
    { tenantId: auth.tenantId, actorId: auth.authUser.id },
    { meta: auth }
  );
const deliver = async (turnRef = 'turn-a') =>
  adapter.broker.call(
    'notices.completeTurn',
    {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      turnRef,
    },
    { meta: meta() }
  );
const feedback = () => adapter.agentEvents.filter((e) => e.outcome);
const chat = (message, auth = meta(), conversationId = 'one') =>
  handleCorrectionTurn(
    {
      params: {},
      meta: auth,
      call: (name, input) => adapter.broker.call(name, input, { meta: auth }),
    },
    { userRequest: message, channel: 'open-webui', conversationId },
    store,
    { model }
  );

test('AC-01: missing status/entries become gap only with context; native gap fails closed', () => {
  const entry = { ...operation, functionIds: ['fn-b'], classification: 'standing' };
  for (const input of [response, { status: 'missing_input' }, { missingInputs: ['Field A'] }]) {
    expect(projectSignals(input, entry).every((s) => s.state === 'needs_context')).toBe(true);
    const contextual = projectSignals(input, entry, { context: { kind: 'case', ref: 'case-a' } });
    expect(contextual.some((s) => s.state === 'gap')).toBe(true);
    expect(contextual.some(isFinding)).toBe(false);
  }
  expect(
    projectSignals({ signals: [{ signalId: 'a', kind: 'finding', state: 'gap' }] }, entry)[0].state
  ).toBe('needs_context');
});

test('AC-02/06: one bundled list, repeat/reorder update without duplicates, no model/inbox/additional operations', async () => {
  const result = await cycle();
  expect(result).toMatchObject({ findings: 0, proposals: 0, consumedUnits: 0.35 });
  expect(backend).toHaveBeenCalledTimes(1);
  expect(await gaps()).toHaveLength(1);
  expect((await gaps())[0]).toMatchObject({ state: 'open', labels: ['Field A', 'Field B'] });
  response.missingInputs.reverse();
  await cycle();
  expect(await gaps()).toHaveLength(1);
  expect((await queue()).items.filter((i) => i.kind === 'gap')).toHaveLength(1);
  expect(generate).not.toHaveBeenCalled();
  expect(await adapter.inbox.getTenantInboxMessages('tenant-a')).toEqual([]);
});

test('AC-03: delivered gap becomes used exactly once only after actual ok observation', async () => {
  await cycle();
  const delivered = await deliver();
  expect(delivered.items.some((i) => i.kind === 'gap')).toBe(true);
  response = { status: 'ready', missingInputs: [] };
  await cycle();
  await cycle();
  expect((await gaps())[0]).toMatchObject({ state: 'completed', used: true });
  expect(feedback().filter((e) => e.outcome === 'used')).toHaveLength(1);
});

test('AC-03: undisplayed, unknown, partial, disappeared and needs_context observations do not manufacture used', async () => {
  await cycle();
  for (const input of [
    { status: 'unknown' },
    { signals: [] },
    { signals: [{ signalId: 'a', kind: 'state', state: 'needs_context' }] },
  ]) {
    response = input;
    await cycle();
    expect((await gaps())[0].state).toBe('open');
  }
  response = { status: 'ready', missingInputs: [] };
  await cycle();
  expect(feedback()).toEqual([]);
});

test('AC-03: L reference done requires a separate confirmation and remains open until verified', async () => {
  await cycle();
  const [notice] = (await deliver()).items.filter((i) => i.kind === 'gap');
  expect((await chat(`${notice.ref} erledigt`)).responseText).toContain('richtig');
  expect((await gaps())[0].completionRequested).toBe(false);
  await chat('Ja');
  expect((await gaps())[0]).toMatchObject({ state: 'open', completionRequested: true });
  await adapter.journal.writeQueue;
  expect(
    (await adapter.journal.rawEntries('tenant-a')).some((entry) => entry.kind === 'corrected')
  ).toBe(true);
  await cycle();
  expect((await gaps())[0].state).toBe('open');
  expect(feedback()).toEqual([]);
  response = { status: 'ready', missingInputs: [] };
  await cycle();
  expect(feedback().filter((e) => e.outcome === 'used')).toHaveLength(1);
});

test('AC-04: confirmed ignore refreshes without positive score, survives same content until changed', async () => {
  await cycle();
  const [notice] = (await deliver()).items.filter((i) => i.kind === 'gap');
  const before = (await adapter.service.readRows('tenant-a')).find(
    (r) => r.functionId === 'fn-b'
  ).attention;
  await chat(`${notice.ref} ignorieren`);
  await chat('Ja');
  await cycle();
  expect((await queue()).items.filter((i) => i.kind === 'gap')).toEqual([]);
  expect(feedback().map((e) => e.outcome)).toEqual(['rejected']);
  const after = (await adapter.service.readRows('tenant-a')).find(
    (r) => r.functionId === 'fn-b'
  ).attention;
  expect(after.reactivationScore).toBe(before.reactivationScore);
  expect(after.turnsSinceRefresh).toBe(0);
  response.missingInputs = [{ id: 'c', label: 'Field C' }];
  await cycle();
  expect((await queue()).items.filter((i) => i.kind === 'gap')).toHaveLength(1);
  expect((await gaps())[0].labels).toEqual(['Field C']);
});

test('AC-05: preferences, visibility, tenant isolation and exactly-once L notices', async () => {
  await cycle();
  for (const preference of ['proposals_only', 'off']) {
    await adapter.noticesService.actions.setPreference(
      { tenantId: 'tenant-a', actorId: 'person-a', preference },
      { meta: meta() }
    );
    expect((await queue()).items).toEqual([]);
  }
  await adapter.noticesService.actions.setPreference(
    { tenantId: 'tenant-a', actorId: 'person-a', preference: 'all' },
    { meta: meta() }
  );
  expect((await queue(meta('person-b'))).items).toEqual([]);
  expect((await queue(meta('person-a', 'tenant-b'))).items).toEqual([]);
  const first = await deliver();
  const [notice] = first.items.filter((i) => i.kind === 'gap');
  expect(notice.ref).toMatch(/^L-\d+$/);
  expect(notice.labels).toEqual(['Field A', 'Field B']);
  expect(first.block).toContain('Für deine aktuelle Arbeit fehlen noch Angaben.');
  expect(first.block).not.toMatch(/Field [AB]|L-\d+|R-\d+/);
  expect((await deliver('turn-b')).items).toEqual([]);
  adapter.broker.getLocalService('neutral').schema.actions.read.requiredRoles = ['ROLE_ADMIN'];
  expect(
    await adapter.noticesService.actions.resolveRef(
      { tenantId: 'tenant-a', actorId: 'person-a', ref: notice.ref },
      { meta: meta() }
    )
  ).toBeNull();
  expect(await adapter.agents.actions.gapLists({ tenantId: 'tenant-a' }, { meta: meta() })).toEqual(
    []
  );
});

test('AC-08: bounded lists and labels, separate contexts, no eviction of open work', async () => {
  adapter.agents.settings.maxGapLabels = 2;
  for (const ref of ['case-a', 'case-b', 'case-c']) {
    contextRef = ref;
    adapter.agents.observationContext = async () => ({ kind: 'case', ref });
    await cycle();
  }
  expect(await gaps()).toHaveLength(2);
  expect((await gaps()).every((g) => g.state === 'open' && g.labels.length <= 2)).toBe(true);
});

test('description reactions, cancellation and stale confirmation fail closed', async () => {
  await cycle();
  await chat('Lückenliste Field A erledigt');
  await chat('Nein');
  expect((await gaps())[0].completionRequested).toBe(false);
  await chat('Lückenliste Field A ignorieren');
  response.missingInputs = [{ id: 'c', label: 'Field C' }];
  await cycle();
  await expect(chat('Ja')).rejects.toThrow('Gap list not accessible');
  expect((await gaps())[0].ignoredHash).toBeNull();
});

test('AC-05: producer replay preserves the queued notice; returning content has a fresh reference', async () => {
  await cycle();
  const doc = await adapter.agents.readDocument('tenant-a');
  const agent = doc.agents[0],
    gap = agent.gapLists[0];
  await adapter.broker.emit('shared-agent.gaps.changed.v1', {
    tenantId: 'tenant-a',
    agentId: agent.agentId,
    functionId: agent.functionId,
    gapRef: gap.ref,
    contentHash: gap.contentHash,
    eventId: require('../src/signal-projection').signalKey(gap.ref, gap.contentHash),
  });
  await adapter.noticesService.settle();
  const [first] = (await deliver()).items.filter((i) => i.kind === 'gap');
  response.missingInputs = [{ id: 'c', label: 'Field C' }];
  await cycle();
  response.missingInputs = [
    { id: 'a', label: 'Field A' },
    { id: 'b', label: 'Field B' },
  ];
  await cycle();
  const [last] = (await queue()).items.filter((i) => i.kind === 'gap');
  expect(last.ref).not.toBe(first.ref);
  expect(
    await adapter.noticesService.actions.resolveRef(
      { tenantId: 'tenant-a', actorId: 'person-a', ref: first.ref },
      { meta: meta() }
    )
  ).toBeNull();
});

test('a journal retry never republishes used feedback', async () => {
  await cycle();
  await deliver();
  const deliverJournal = adapter.agents.deliverJournal.bind(adapter.agents);
  jest.spyOn(adapter.agents, 'deliverJournal').mockImplementation(async (agent, entry) => {
    if (entry.entryId.startsWith('feedback-')) throw new Error('Journal unavailable');
    return deliverJournal(agent, entry);
  });
  response = { status: 'ready', missingInputs: [] };
  await cycle();
  expect(feedback().filter((e) => e.outcome === 'used')).toHaveLength(1);
  adapter.agents.deliverJournal.mockRestore();
  await cycle();
  expect(feedback().filter((e) => e.outcome === 'used')).toHaveLength(1);
  expect((await gaps())[0].pendingFeedback).toBeNull();
});

test('AC-01: an unused context reference cannot turn a standing operation into gap', async () => {
  adapter.signals.signalCatalog.operations[0].classification = 'standing';
  adapter.signals.signalCatalog.operations[0].parameterNames = [];
  const result = await adapter.observeSignals(
    { tenantId: 'tenant-a', functionId: 'fn-b', context: { kind: 'case', ref: 'case-a' } },
    { meta: meta() }
  );
  expect(result.calledOperations).toBe(1);
  expect(
    result.signals.every((signal) => signal.state === 'needs_context' && !signal.context)
  ).toBe(true);
  expect(await gaps()).toEqual([]);
});

test('description uses the existing function resolver and empty same-conversation confirmation cannot repeat', async () => {
  await cycle();
  expect((await chat('Lückenliste für Function B erledigt')).responseText).toContain('richtig');
  await chat('Ja');
  expect((await gaps())[0].completionRequested).toBe(true);
  await chat('Ja');
  expect(feedback()).toEqual([]);
});

test('AC-02/03: one list groups two operations; partial observations cannot close the other portion', async () => {
  const second = {
    ...operation,
    operationId: 'neutral_read2',
    action: 'neutral-extra.read2',
    service: 'neutral-extra',
  };
  adapter.agents.operations.push(second);
  if (adapter.signals.operations !== adapter.agents.operations)
    adapter.signals.operations.push(second);
  for (const current of new Set([adapter.agents.model, adapter.signals.model]))
    jest.replaceProperty(current.functions[1], 'operations', ['neutral.read', second.action]);
  adapter.signals.signalCatalog.operations.push({
    ...second,
    classification: 'contextual',
    parameterNames: ['caseId'],
    signals: [],
  });
  let other = { status: 'missing_input', missingInputs: [{ id: 'c', label: 'Field C' }] };
  adapter.broker.createService({ name: 'neutral-extra', actions: { read2: () => other } });
  await adapter.broker.waitForServices(['neutral-extra']);
  await cycle();
  expect(await gaps()).toHaveLength(1);
  expect((await gaps())[0].labels).toEqual(['Field A', 'Field B', 'Field C']);
  response = { status: 'ready', missingInputs: [] };
  other = { status: 'unknown' };
  await cycle();
  expect((await gaps())[0]).toMatchObject({ state: 'open', labels: ['Field C'] });
  other = { status: 'ready', missingInputs: [] };
  await cycle();
  expect((await gaps())[0].state).toBe('completed');
  expect(generate).not.toHaveBeenCalled();
});

test('native gap aggregates close only on their explicit ok counterpart', async () => {
  response = {
    signals: [{ signalId: 'a', kind: 'count', label: 'Field A', state: 'gap', value: 1 }],
  };
  await cycle();
  await deliver();
  response = {
    signals: [{ signalId: 'a', kind: 'count', label: 'Field A', state: 'ok', value: 0 }],
  };
  await cycle();
  expect((await gaps())[0].state).toBe('completed');
  expect(feedback().filter((e) => e.outcome === 'used')).toHaveLength(1);
});

test('729: existing open gaps reach newly covered people without notifying existing recipients twice', async () => {
  // Observe before qualifying human coverage arrives, as in the real turn path.
  const doc = await adapter.agents.readDocument('tenant-a');
  doc.coverage = [];
  await adapter.agents.save(doc);
  await cycle();
  expect((await gaps())[0].recipients).toEqual([]);
  await adapter.broker.emit('function.coverage.changed.v1', {
    tenantId: 'tenant-a',
    actorId: 'person-a',
    functionId: 'fn-a',
    score: 1,
    origin: 'observed',
  });
  await adapter.agents.settle();
  await adapter.noticesService.settle();
  await cycle();
  expect((await gaps())[0].recipients).toEqual(['person-a']);
  const delivered = await deliver('new-coverage');
  expect(delivered.items.filter((item) => item.kind === 'gap')).toHaveLength(1);
  await cycle();
  expect((await deliver('same-content')).items.filter((item) => item.kind === 'gap')).toHaveLength(
    0
  );
});

test('729 review: low-coverage context creators receive gaps, expired and unrelated actors do not', async () => {
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'context',
      turnRef: 'context-turn',
      confidence: 1,
      context: { kind: 'case', ref: contextRef },
      at: new Date(adapter.clock.value).toISOString(),
    },
  });
  const doc = await adapter.agents.readDocument('tenant-a');
  doc.coverage = [];
  await adapter.agents.save(doc);
  await cycle();
  expect((await gaps())[0].recipients).toEqual(['person-a']);
  expect((await deliver('creator')).items.some((item) => item.kind === 'gap')).toBe(true);
  const state = await adapter.service.readDocument('tenant-a');
  for (const context of state.contexts)
    context.ageTurns = adapter.service.settings.contextRetentionTurns;
  await adapter.service.db.put(state);
  const saved = await adapter.agents.readDocument('tenant-a');
  expect(
    await adapter.agents.gapRecipients(saved, saved.agents[0], { kind: 'case', ref: contextRef })
  ).toEqual([]);
  expect(
    await adapter.broker.call(
      'shared-service-agent.gapLists',
      { tenantId: 'tenant-a' },
      { meta: meta() }
    )
  ).toEqual([]);
});
