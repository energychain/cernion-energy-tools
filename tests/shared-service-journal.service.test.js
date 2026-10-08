'use strict';

const { createAdapter } = require('./helpers/shared-service/real-adapter');
const { computeJournalDigest } = require('../src/shared-service-journal');
const functions = ['fn-a', 'fn-b'].map((functionId) => ({ functionId, neighbors: [] }));
const meta = { authUser: { tenantId: 'tenant-a', userId: 'actor-a', roles: ['ROLE_USER'] } };
let adapter;
const call = (name, params, auth = meta) =>
  adapter.broker.call(`journal.${name}`, params, { meta: auth });
const append = (entry = {}) =>
  call('append', {
    functionId: 'fn-a',
    kind: 'observed',
    summary: 'Beobachtung liegt vor.',
    ...entry,
  });
const emit = (event, payload) => adapter.apply({ event, payload });

beforeEach(async () => {
  jest.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
  adapter = await createAdapter({
    functions,
    jest,
    withAgents: false,
    cacheObservations: false,
    journalSettings: { clock: () => Date.now() },
  });
});
afterEach(async () => {
  if (adapter) await adapter.close();
  jest.useRealTimers();
});

test('AC-01: immutable identities, detached values and concurrent duplicate rejection', async () => {
  const refs = [{ kind: 'journal', id: 'unknown' }];
  const result = await append({ entryId: 'entry-a', refs });
  refs[0].id = 'changed';
  result.summary = 'changed';
  const results = await Promise.allSettled([
    append({ entryId: 'entry-b' }),
    append({ entryId: 'entry-b' }),
  ]);
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  await expect(append({ entryId: 'entry-a', summary: 'changed' })).rejects.toMatchObject({
    code: 409,
  });
  const entries = await adapter.journal.rawEntries('tenant-a');
  expect(entries[0].summary).toBe('Beobachtung liegt vor.');
  expect(entries[0].refs[0].id).toBe('unknown');
  expect(adapter.journal.schema.actions.update).toBeUndefined();
  expect(adapter.journal.schema.actions.remove).toBeUndefined();
});

test('AC-02/03: deterministic state, open items, settlement, activation and handoff without agents', async () => {
  await emit('function.activation.changed.v1', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'active',
    responsibility: { humans: [], cet: true },
  });
  await append({ entryId: 'expect-a', kind: 'awaiting', summary: 'Antwort steht aus.' });
  await append({ entryId: 'proposal-a', kind: 'proposed', summary: 'Vorschlag liegt vor.' });
  let digest = await call('digest', { functionId: 'fn-a' });
  expect(digest.status.state).toBe('active');
  expect(digest.openExpectations).toHaveLength(1);
  expect(digest.openProposals).toHaveLength(1);
  jest.advanceTimersByTime(1);
  await append({
    kind: 'decided',
    refs: [
      { kind: 'journal', id: 'expect-a' },
      { kind: 'journal', id: 'proposal-a' },
    ],
  });
  await emit('function.activation.changed.v1', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'active',
    responsibility: { humans: ['actor-b'], cet: false },
  });
  digest = await call('digest', { functionId: 'fn-a' });
  expect(digest.status.responsibility).toEqual({ humans: ['actor-b'], cet: false });
  expect(digest.openExpectations).toEqual([]);
  expect(digest.openProposals).toEqual([]);
  expect(digest.lastDecisions.length).toBeGreaterThan(0);
  expect(await call('digest', { functionId: 'fn-a' })).toEqual(digest);
  const raw = await adapter.journal.readEntries('tenant-a');
  const independentlyOrdered = computeJournalDigest([...raw].reverse(), 'fn-a', 'tenant-a');
  expect(independentlyOrdered.status).toEqual(digest.status);
});

test('AC-03: all lifecycle events and four correction targets are automatically journaled', async () => {
  for (const lifecycle of ['proposed', 'active', 'sleeping', 'retired']) {
    await emit('shared-agent.lifecycle.v1', {
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      functionId: 'fn-a',
      lifecycle,
    });
    jest.advanceTimersByTime(1);
  }
  for (const target of ['coverage', 'activation', 'agent', 'neighbor']) {
    await emit('shared-service.correction.v1', {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      target,
      ref: target === 'agent' ? 'agent-a' : 'fn-a',
      correction: { score: 0.8 },
    });
  }
  const state = await adapter.snapshot();
  expect(state.journal.map((entry) => entry.kind)).toEqual(
    expect.arrayContaining(['created', 'woke', 'slept', 'retired', 'corrected'])
  );
  expect(state.journal.filter((entry) => entry.kind === 'corrected')).toHaveLength(4);
  const agentEntries = await call('byAgent', { agentId: 'agent-a' });
  expect(agentEntries).toHaveLength(5);
  expect(agentEntries.at(-1).kind).toBe('corrected');
  expect((await call('digest', { functionId: 'fn-a' })).status.agents).toEqual([
    { agentId: 'agent-a', lifecycle: 'retired' },
  ]);
});

test('AC-04: tenant case and evidence references are shared; foreign-tenant and unknown refs remain hidden', async () => {
  const { authorize } = require('../src/domain-router-policy');
  const states = {
    'case-a': {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      accessRoles: ['ROLE_USER'],
      sensitivityFlags: [],
    },
    'case-b': {
      tenantId: 'tenant-a',
      actorId: 'actor-b',
      accessRoles: ['ROLE_USER'],
      sensitivityFlags: [],
    },
  };
  adapter.broker.getLocalService = jest.fn((name) =>
    name === 'domain-router'
      ? {
          async loadCase(p, id) {
            authorize(p, states[id]);
            return states[id];
          },
          eventsDb: {
            async get() {
              return { tenantId: 'tenant-b', cetCaseId: 'case-a' };
            },
          },
        }
      : {
          store: {
            async listEvidence() {
              return [{ tenantId: 'tenant-a', evidenceId: 'ev-a', sensitivityLevel: 'restricted' }];
            },
          },
        }
  );
  const refs = [
    { kind: 'case', id: 'case-a' },
    { kind: 'case', id: 'case-b' },
    { kind: 'evidence', caseId: 'case-a', id: 'ev-a' },
    { kind: 'event', caseId: 'case-a', id: 'ev-b' },
    'opaque-secret',
  ];
  const entry = await append({ refs, kind: 'awaiting' });
  expect(entry.refs).toEqual(refs.slice(0, 3));
  expect(entry.hiddenRefCount).toBe(2);
  const cleared = { authUser: { ...meta.authUser, sensitivityFlags: ['restricted'] } };
  const entries = await call('byFunction', { functionId: 'fn-a' }, cleared);
  expect(entries[0].refs).toEqual(refs.slice(0, 3));
  const digest = await call('digest', { functionId: 'fn-a' });
  expect(digest.openExpectations[0].hiddenRefCount).toBe(2);
  expect(JSON.stringify(digest)).not.toContain('opaque-secret');
});

test('AC-05: authenticated tenant isolation and filters', async () => {
  await append({ kind: 'awaiting', at: '2025-12-30T00:00:00Z' });
  await append({ kind: 'decided' });
  const other = { authUser: { ...meta.authUser, tenantId: 'tenant-b' } };
  expect(await call('byFunction', { functionId: 'fn-a' }, other)).toEqual([]);
  await expect(
    call('byFunction', { functionId: 'fn-a', tenantId: 'tenant-b' })
  ).rejects.toMatchObject({ code: 403 });
  await expect(call('digest', { functionId: 'fn-a' }, {})).rejects.toMatchObject({ code: 403 });
  expect(
    await call('byFunction', {
      functionId: 'fn-a',
      since: '2025-12-31T00:00:00Z',
      kinds: ['decided'],
    })
  ).toHaveLength(1);
  await expect(call('byFunction', { functionId: 'fn-a', since: 'invalid' })).rejects.toMatchObject({
    code: 422,
  });
});

test('AC-05: bounded lossless retention preserves digest, reads and immutable IDs', async () => {
  adapter.journal.settings.retentionMs = 1000;
  adapter.journal.settings.archiveBatchSize = 2;
  for (let i = 0; i < 5; i++) await append({ entryId: `entry-${i}`, kind: 'awaiting' });
  const before = await call('digest', { functionId: 'fn-a' });
  jest.advanceTimersByTime(2000);
  expect(await adapter.journal.serializeWrite(() => adapter.journal.compactEntries())).toEqual({
    compacted: 5,
  });
  const docs = (await adapter.journal.db.allDocs({ include_docs: true })).rows.map(
    (row) => row.doc
  );
  expect(docs).toHaveLength(3);
  expect(docs.every((doc) => doc.type === 'journal-archive' && doc.count <= 2)).toBe(true);
  expect(await call('digest', { functionId: 'fn-a' })).toEqual(before);
  expect(await call('byFunction', { functionId: 'fn-a' })).toHaveLength(5);
  await expect(append({ entryId: 'entry-0' })).rejects.toMatchObject({ code: 409 });
  expect(await adapter.journal.serializeWrite(() => adapter.journal.compactEntries())).toEqual({
    compacted: 0,
  });
});

test('stored identities resolve on read, including splits, while digest requires one current identity', async () => {
  await append({ entryId: 'entry-a' });
  adapter.journal.settings.functionModel = {
    sourceHash: 'split-epoch',
    functions: ['fn-b', 'fn-c'].map((functionId) => ({
      functionId,
      derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
    })),
  };
  expect((await call('byFunction', { functionId: 'fn-b' }))[0].functionId).toBe('fn-b');
  expect(await call('byFunction', { functionId: 'fn-a' })).toHaveLength(2);
  await expect(call('digest', { functionId: 'fn-a' })).rejects.toMatchObject({ code: 422 });
  expect((await call('digest', { functionId: 'fn-c' })).entryCount).toBe(1);
  await append({ functionId: 'fn-a', entryId: 'late-historical-entry' });
  expect(await call('byFunction', { functionId: 'fn-b' })).toHaveLength(2);
});

test('same-time activation and settlement preserve append order rather than random IDs', async () => {
  await emit('function.activation.changed.v1', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'active',
    responsibility: { humans: [], cet: true },
  });
  await emit('function.activation.changed.v1', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'dormant',
    responsibility: { humans: ['actor-a'], cet: false },
  });
  await append({ entryId: 'z-expectation', kind: 'awaiting' });
  await append({
    entryId: 'a-decision',
    kind: 'decided',
    refs: [{ kind: 'journal', id: 'z-expectation' }],
  });
  const digest = await call('digest', { functionId: 'fn-a' });
  expect(digest.status.state).toBe('dormant');
  expect(digest.openExpectations).toEqual([]);
});

test('retention crash between archive and removal preserves reads and allows recovery', async () => {
  await append({ entryId: 'entry-a', kind: 'proposed' });
  adapter.journal.settings.retentionMs = 0;
  jest.advanceTimersByTime(1);
  const originalRemove = adapter.journal.db.remove;
  adapter.journal.db.remove = jest.fn().mockRejectedValueOnce(new Error('interrupted'));
  await expect(
    adapter.journal.serializeWrite(() => adapter.journal.compactEntries())
  ).rejects.toThrow('interrupted');
  expect(await call('byFunction', { functionId: 'fn-a' })).toHaveLength(1);
  adapter.journal.db.remove = originalRemove;
  await adapter.journal.serializeWrite(() => adapter.journal.compactEntries());
  expect(await call('byFunction', { functionId: 'fn-a' })).toHaveLength(1);
});

test('invalid entries, events and unresolved corrections cannot corrupt journal state', async () => {
  await expect(append({ functionId: 'missing' })).rejects.toMatchObject({ code: 422 });
  await expect(append({ at: 'invalid' })).rejects.toMatchObject({ code: 422 });
  await expect(append({ summary: ' ' })).rejects.toMatchObject({ code: 422 });
  await expect(adapter.journal.recordActivation({ state: 'unknown' })).rejects.toMatchObject({
    code: 422,
  });
  await expect(adapter.journal.recordLifecycle({ lifecycle: 'unknown' })).rejects.toMatchObject({
    code: 422,
  });
  await expect(
    adapter.journal.recordCorrection({
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      target: 'agent',
      ref: 'unknown',
      correction: {},
    })
  ).rejects.toMatchObject({ code: 422 });
  await adapter.journal.recordCorrection({
    tenantId: 'tenant-a',
    actorId: 'actor-a',
    target: 'neighbor',
    ref: 'opaque',
    correction: { functionId: 'fn-a' },
  });
  expect(await call('byFunction', { functionId: 'fn-a' })).toHaveLength(1);
});

test('real activation producer journals touch, complementary responsibility, handoff and dormancy', async () => {
  await adapter.close();
  adapter = await createAdapter({
    jest,
    functions: [
      { functionId: 'fn-a', neighbors: [{ functionId: 'fn-b', weight: 0.8, evidence: [] }] },
      { functionId: 'fn-b', neighbors: [] },
    ],
  });
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      functionId: 'fn-a',
      conversationId: 'conversation-a',
      confidence: 1,
    },
  });
  let digest = await call('digest', { functionId: 'fn-b' });
  expect(digest.status).toMatchObject({
    state: 'active',
    responsibility: { humans: [], cet: true },
  });
  expect((await adapter.snapshot()).journal.length).toBeGreaterThan(0);
  await adapter.apply({
    event: 'function.coverage.changed.v1',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'actor-b',
      functionId: 'fn-b',
      score: 1,
      origin: 'observed',
    },
  });
  digest = await call('digest', { functionId: 'fn-b' });
  expect(digest.status.responsibility).toEqual({ humans: ['actor-b'], cet: false });
  expect(digest.lastDecisions.at(-1).summary).toBe('Verantwortung liegt bei Menschen.');
  await adapter.apply({ type: 'advance', milliseconds: adapter.service.settings.restWindowMs + 1 });
  const state = await adapter.snapshot();
  const activation = state.activations.find((item) => item.functionId === 'fn-a');
  expect(activation.state).toBe('dormant');
  expect((await call('digest', { functionId: 'fn-a' })).status.state).toBe(activation.state);
});

test('at-least-once activation/lifecycle retries are idempotent and later transitions remain visible', async () => {
  const event = {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'active',
    responsibility: { humans: [], cet: true },
  };
  await emit('function.activation.changed.v1', event);
  await append({ kind: 'observed' });
  await emit('function.activation.changed.v1', event);
  expect((await call('digest', { functionId: 'fn-a' })).entryCount).toBe(2);
  const lifecycle = {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    agentId: 'agent-a',
    lifecycle: 'sleeping',
  };
  await emit('shared-agent.lifecycle.v1', lifecycle);
  await emit('shared-agent.lifecycle.v1', lifecycle);
  expect(await call('byAgent', { agentId: 'agent-a' })).toHaveLength(1);
  await emit('function.activation.changed.v1', { ...event, state: 'dormant' });
  await emit('function.activation.changed.v1', event);
  expect((await call('digest', { functionId: 'fn-a' })).status.state).toBe('active');
  expect(await call('byFunction', { functionId: 'fn-a', kinds: ['decided'] })).toHaveLength(3);
});

test('missing/denied HITL and operation responses are counted, while authorized references are returned', async () => {
  const { Errors } = require('moleculer');
  const { principal, authorize } = require('../src/domain-router-policy');
  const state = {
    tenantId: 'tenant-a',
    actorId: 'actor-a',
    accessRoles: ['ROLE_USER'],
    sensitivityFlags: [],
  };
  adapter.broker.getLocalService = jest.fn(() => ({
    async loadCase(p) {
      authorize(p, state);
      return state;
    },
  }));
  const ctx = {
    meta,
    async call(action, params) {
      const id = params.id || params.toolRunId;
      if (id === 'missing') throw new Errors.MoleculerClientError('Missing', 404);
      if (id === 'denied') throw new Errors.MoleculerClientError('Denied', 403);
      if (id === 'unavailable') throw new Errors.MoleculerServerError('Unavailable', 503);
      return action === 'hitl.get' ? { item: { tenantId: 'tenant-a' } } : { toolRun: { id } };
    },
  };
  const refs = [
    { kind: 'hitl', id: 'allowed' },
    { kind: 'hitl', id: 'denied' },
    { kind: 'hitl', id: 'missing' },
    { kind: 'operation', id: 'allowed', caseId: 'case-a' },
    { kind: 'operation', id: 'missing', caseId: 'case-a' },
    { kind: 'operation', id: 'unavailable', caseId: 'case-a' },
  ];
  const entry = await adapter.journal.appendEntry({
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    kind: 'awaiting',
    summary: 'Antwort steht aus.',
    refs,
  });
  const presented = await adapter.journal.presentEntry(ctx, principal(ctx), entry);
  expect(presented.refs).toEqual([refs[0], refs[3]]);
  expect(presented.hiddenRefCount).toBe(4);
});

test('current retained split IDs remain digestible and new entries stay in their current scope', async () => {
  adapter.journal.settings.functionModel = {
    sourceHash: 'epoch-a',
    functions: [{ functionId: 'fn-a', capabilities: ['cap-a', 'cap-b'] }],
  };
  await append({ entryId: 'historical-entry' });
  adapter.journal.settings.functionModel = {
    sourceHash: 'epoch-b',
    functions: ['fn-a', 'fn-b'].map((functionId) => ({
      functionId,
      capabilities: [functionId === 'fn-a' ? 'cap-a' : 'cap-b'],
      derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
    })),
  };
  await append({ entryId: 'current-entry', kind: 'awaiting' });
  await emit('function.activation.changed.v1', {
    tenantId: 'tenant-a',
    functionId: 'fn-a',
    state: 'active',
    responsibility: { humans: [], cet: true },
  });
  const current = await call('digest', { functionId: 'fn-a' });
  expect(current.status.state).toBe('active');
  expect(current.entryCount).toBe(3);
  adapter.journal.settings.functionModel.sourceHash = 'epoch-c';
  expect((await call('digest', { functionId: 'fn-a' })).entryCount).toBe(3);
  const sibling = await call('digest', { functionId: 'fn-b' });
  expect(sibling.entryCount).toBe(1);
  expect(sibling.openExpectations).toEqual([]);
  expect((await call('byFunction', { functionId: 'fn-b' })).map((entry) => entry.entryId)).toEqual([
    'historical-entry',
  ]);
});
