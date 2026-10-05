'use strict';
const { createAdapter } = require('./helpers/shared-service/real-adapter');
const { handleCorrectionTurn, recognizeCorrection } = require('../src/workbench-corrections');
const { WorkbenchStore } = require('../src/workbench-store');
const { memoryPouch } = require('./helpers/shared-service/memory-pouch');
const { getNeighbors } = require('../src/function-model');
const { project, configuration } = require('../src/function-coverage');
const model = {
  sourceHash: 'learning-v1',
  parameters: { minWeight: 0.2 },
  functions: [
    {
      functionId: 'fn-a',
      label: 'Alpha Review',
      capabilities: ['cap-a'],
      neighbors: [{ functionId: 'fn-b', weight: 0.9, evidence: [] }],
    },
    { functionId: 'fn-b', label: 'Beta Review', capabilities: ['cap-b'], neighbors: [] },
    { functionId: 'fn-c', label: 'Gamma Review', capabilities: ['cap-c'], neighbors: [] },
  ],
};
const meta = (id = 'person', roles = ['ROLE_USER'], tenantId = 'tenant-a') => ({
  authUser: { id, tenantId, roles },
});
let adapter, store;
beforeEach(async () => {
  adapter = await createAdapter({ jest, model, withAgents: true });
  const Pouch = memoryPouch();
  store = new WorkbenchStore({
    conversationsDb: new Pouch('conversations'),
    turnMemoryDb: new Pouch('turns'),
  });
  await adapter.service.acceptTouch({
    tenantId: 'tenant-a',
    actorId: 'person',
    functionId: 'fn-a',
    conversationId: 'one',
    confidence: 1,
    at: new Date(adapter.clock.value).toISOString(),
  });
  await adapter.agents.settle();
});
afterEach(async () => adapter.close());
const apply = (target, correction, extra = {}) =>
  adapter.learning.actions.apply(
    { tenantId: 'tenant-a', target, correction, ...extra },
    { meta: meta('person', ['ROLE_ADMIN']) }
  );
const rows = () => adapter.service.readRows('tenant-a');
const beta = async () => (await rows()).find((r) => r.functionId === 'fn-b');
const chat = (message, conversationId = 'one', auth = meta()) =>
  handleCorrectionTurn(
    {
      params: {},
      meta: auth,
      call: (name, input) => adapter.broker.call(name, input, { meta: auth }),
    },
    { userRequest: message, conversationId, channel: 'open-webui' },
    store,
    { model }
  );

test('coverage correction wins over observations, suppresses observed coverage and is reversible', async () => {
  await adapter.coverageService.actions.recordTouch(
    {
      tenantId: 'tenant-a',
      actorId: 'person',
      sourceType: 'completed_turn',
      sourceRef: 'observed',
      conversationId: 'one',
      signalClass: 'case_start',
      capabilities: ['cap-a'],
    },
    { meta: meta() }
  );
  const before = (await adapter.coverageService.actions.byActor({}, { meta: meta() })).items[0]
    .score;
  const result = await apply('coverage', { functionId: 'fn-a', score: 0 });
  expect(
    (await adapter.coverageService.actions.byActor({}, { meta: meta() })).items[0]
  ).toMatchObject({ origin: 'corrected', score: 0 });
  await adapter.learning.actions.undo(
    { correctionId: result.correctionId },
    { meta: meta('person', ['ROLE_ADMIN']) }
  );
  expect(
    (await adapter.coverageService.actions.byActor({}, { meta: meta() })).items[0].score
  ).toBeCloseTo(before);
  const positive = await apply('coverage', { functionId: 'fn-b', score: 1 });
  expect((await rows()).find((r) => r.functionId === 'fn-b').responsibility.humans).toContain(
    'person'
  );
  await adapter.learning.actions.undo({ correctionId: positive.correctionId }, { meta: meta() });
  expect((await beta()).responsibility.humans).not.toContain('person');
});
test('corrected evidence has a fourfold half-life and stronger initial weight', () => {
  const config = configuration();
  const base = {
    _id: 'a',
    tenantId: 't',
    actorId: 'p',
    functionId: 'f',
    at: 0,
    weight: 0.4,
    signalClass: 'case_start',
    sourceRef: 'a',
  };
  const observed = project([base], config.halfLifeMs, config);
  const corrected = project(
    [{ ...base, origin: 'corrected', score: 1 }],
    config.halfLifeMs,
    config
  );
  expect(corrected.score).toBeCloseTo(Math.pow(0.5, 0.25));
  expect(corrected.score).toBeGreaterThan(observed.score);
});
test('activation preference survives turns and reverses without minting allowance', async () => {
  const before = (await beta()).attention.allowance;
  const result = await apply('activation', { functionId: 'fn-b', cet: false });
  expect((await beta()).responsibility.cet).toBe(false);
  await adapter.service.acceptTouch({
    tenantId: 'tenant-a',
    actorId: 'person',
    functionId: 'fn-a',
    conversationId: 'one',
    confidence: 1,
    at: new Date(++adapter.clock.value).toISOString(),
  });
  expect((await beta()).responsibility.cet).toBe(false);
  await adapter.learning.actions.undo(
    { correctionId: result.correctionId },
    { meta: meta('person', ['ROLE_ADMIN']) }
  );
  expect((await beta()).responsibility.cet).toBe(true);
  expect((await beta()).attention.allowance).toBeLessThanOrEqual(before);
  await apply('activation', { functionId: 'fn-b', cet: true });
  expect((await beta()).responsibility.cet).toBe(true);
});
test.each(['retain', 'unretain', 'pin', 'unpin'])(
  'agent %s is applied, journaled and reversible',
  async (kind) => {
    if (kind === 'unretain') await apply('agent', { functionId: 'fn-b', kind: 'retain' });
    if (kind === 'unpin') await apply('agent', { functionId: 'fn-b', kind: 'pin' });
    const before = (await beta()).attention;
    const result = await apply('agent', { functionId: 'fn-b', kind });
    const after = (await beta()).attention;
    expect([after.retainFactor, after.inventory]).not.toEqual([
      before.retainFactor,
      before.inventory,
    ]);
    const entries = await adapter.journal.readEntries('tenant-a');
    expect(
      entries.some((e) => e.kind === 'corrected' && e.refs.includes(result.correctionId))
    ).toBe(true);
    await adapter.learning.actions.undo(
      { correctionId: result.correctionId },
      { meta: meta('person', ['ROLE_ADMIN']) }
    );
    const restored = (await beta()).attention;
    expect([restored.retainFactor, restored.inventory]).toEqual([
      before.retainFactor,
      before.inventory,
    ]);
  }
);
test('neighbor overlay is tenant-local, affects activation, aggregates only a suggestion, and reverses', async () => {
  const original = JSON.stringify(model);
  const result = await apply('neighbor', { functionId: 'fn-a', neighborId: 'fn-b', weight: 0 });
  expect((await beta()).responsibility.cet).toBe(false);
  const doc = await adapter.service.readDocument('tenant-a');
  expect(getNeighbors('fn-a', { model, overlay: doc.neighborCorrections })).toEqual([]);
  expect(getNeighbors('fn-a', { model })).toHaveLength(1);
  const aggregate = await adapter.learning.actions.overrideProposals(
    {},
    { meta: meta('person', ['ROLE_ADMIN']) }
  );
  expect(aggregate).toMatchObject({ applied: false, proposals: [{ weight: 0, tenantCount: 1 }] });
  expect(JSON.stringify(model)).toBe(original);
  expect((await adapter.service.readRows('tenant-b')).every((r) => !r.responsibility.cet)).toBe(
    true
  );
  await adapter.learning.actions.undo(
    { correctionId: result.correctionId },
    { meta: meta('person', ['ROLE_ADMIN']) }
  );
  expect((await beta()).responsibility.cet).toBe(true);
});
test('separate confirmation required; memory is actor/conversation/tenant isolated; cancellation and unrelated turns clear it', async () => {
  expect((await chat('kümmere dich nicht mehr um Beta Review')).responseText).toContain(
    'Beta Review'
  );
  expect((await beta()).responsibility.cet).toBe(true);
  await chat('Ja', 'other');
  await chat('Ja', 'one', meta('someone'));
  expect((await beta()).responsibility.cet).toBe(true);
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(false);
  expect((await chat('Mach das rückgängig')).responseText).toContain('rückgängig');
  expect((await beta()).responsibility.cet).toBe(false);
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(true);
  await chat('kümmere dich nicht mehr um Beta Review');
  await chat('Nein');
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(true);
  await chat('kümmere dich nicht mehr um Beta Review');
  await chat('anderes Thema');
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(true);
});
test('ambiguous resolution cannot be confirmed; explicit repeated target is echoed before mutation', async () => {
  const response = await chat('kümmere dich nicht mehr um Review');
  expect(response.responseText).toContain('Welche Funktion');
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(true);
  const corrected = await chat('kümmere dich nicht mehr um Gamma Review');
  expect(corrected.responseText).toContain('Gamma Review');
  expect(corrected.responseText).not.toContain('Beta Review');
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(true);
});
test('pin/unpin need existing admin roles, while retain/unretain accept tenant users', async () => {
  for (const kind of ['retain', 'unretain']) {
    await chat(`${kind === 'retain' ? 'retain' : 'unretain'} Beta Review`);
    await expect(chat('Ja')).resolves.toBeTruthy();
  }
  for (const command of ['pin Beta Review', 'unpin Beta Review']) {
    await chat(command);
    await expect(chat('Ja')).rejects.toThrow('Admin role');
  }
});
test.each([
  'roles',
  'mandate',
  'scopes',
  'permissions',
  'sideEffects',
  'domainsAllowed',
  'budget',
  'actorId',
])('rejects authority expansion through %s fields and foreign tenants', async (field) => {
  const before = await beta();
  await expect(
    apply('activation', { functionId: 'fn-b', cet: true, [field]: ['ROLE_ADMIN'] })
  ).rejects.toThrow();
  await expect(
    adapter.learning.actions.apply(
      { tenantId: 'tenant-b', target: 'coverage', correction: { functionId: 'fn-a', score: 1 } },
      { meta: meta('person', ['ROLE_ADMIN']) }
    )
  ).rejects.toThrow('Tenant mismatch');
  expect(await beta()).toEqual(before);
});
test('admin API refuses normal tenant user and forged actor in event', async () => {
  await expect(
    adapter.learning.actions.apply(
      { target: 'coverage', correction: { functionId: 'fn-a', score: 1 } },
      { meta: meta() }
    )
  ).rejects.toThrow('Admin role');
  await expect(
    adapter.coverageService.correct(
      {
        tenantId: 'tenant-a',
        actorId: 'forged',
        target: 'coverage',
        ref: 'x',
        correction: { functionId: 'fn-a', score: 1 },
      },
      meta()
    )
  ).rejects.toThrow('Actor mismatch');
});
test.each([
  ['Ich erledige Beta Review allein', 'coverage'],
  ['Beta Review habe ich nichts zu tun', 'coverage'],
  ['I handle Beta Review myself', 'coverage'],
  ['I am not responsible for Beta Review', 'coverage'],
  ['Stop working on Beta Review', 'activation'],
  ['Please handle Beta Review', 'activation'],
  ['Behalte Beta Review bei', 'agent'],
  ['Remove from inventory Beta Review', 'agent'],
  ['Alpha Review is not related to Beta Review', 'neighbor'],
  ['Alpha Review gehört zu Beta Review', 'neighbor'],
])('DE/EN wording: %s', (message, target) =>
  expect(recognizeCorrection(message)?.target).toBe(target)
);

test.each(['identifier', 'description', 'english'])(
  'proposal reaction by %s calls original resolution once, after confirmation',
  async (mode) => {
    const doc = await adapter.agents.readDocument('tenant-a');
    const agent = doc.agents.find((item) => item.functionId === 'fn-b');
    agent.proposals.push({
      ref: 'proposal-one',
      functionId: 'fn-b',
      summary: 'Beta Review follow-up',
      recipients: ['person'],
      outcome: null,
    });
    await adapter.agents.save(doc);
    await adapter.broker.emit('function.coverage.changed.v1', {
      tenantId: 'tenant-a',
      actorId: 'person',
      functionId: 'fn-b',
      score: 1,
    });
    await adapter.noticesService.settle();
    await adapter.broker.emit('shared-agent.proposal.created.v1', {
      tenantId: 'tenant-a',
      agentId: agent.agentId,
      functionId: 'fn-b',
      proposalRef: 'proposal-one',
      summary: 'Internal review requested.',
    });
    await adapter.noticesService.settle();
    const notices = await adapter.broker.call(
      'notices.list',
      { tenantId: 'tenant-a', actorId: 'person' },
      { meta: meta() }
    );
    const notice = notices.items.find((item) => item.objectRef === 'proposal-one');
    expect(notice).toMatchObject({ kind: 'proposal', agentId: agent.agentId });
    const original = adapter.broker.call.getMockImplementation();
    const calls = [];
    jest.spyOn(adapter.broker, 'call').mockImplementation((name, ...args) => {
      calls.push(name);
      if (name === 'persona-inbox.resolveByHitlItem') return Promise.resolve({ count: 1 });
      return original(name, ...args);
    });
    const response = await chat(
      mode === 'identifier'
        ? `Nimm ${notice.ref} an`
        : mode === 'english'
          ? 'Accept the proposal about Beta Review follow-up'
          : 'Den Vorschlag zum Beta Review follow-up nehme ich an'
    );
    expect(response.responseText).toContain('Beta Review follow-up');
    expect(calls).not.toContain('shared-service-agent.resolveProposal');
    await chat('Ja');
    expect(calls.filter((name) => name === 'shared-service-agent.resolveProposal')).toHaveLength(1);
    const feedbacks = adapter.agentEvents.filter(
      (item) => item.outcome === 'accepted' && item.ref === 'proposal-one'
    );
    expect(feedbacks).toHaveLength(1);
    expect(
      await adapter.broker.call(
        'notices.resolveRef',
        { tenantId: 'tenant-a', actorId: 'person', ref: notice.ref },
        { meta: meta() }
      )
    ).toBeNull();
    await chat('Ja');
    expect(
      adapter.agentEvents.filter(
        (item) => item.outcome === 'accepted' && item.ref === 'proposal-one'
      )
    ).toHaveLength(1);
  }
);
test('wrong proposal updates rejection statistics and decreases generation frequency', async () => {
  const doc = await adapter.agents.readDocument('tenant-a');
  const agent = doc.agents.find((item) => item.functionId === 'fn-b');
  agent.proposals.push({
    ref: 'proposal-one',
    summary: 'Beta Review follow-up',
    recipients: ['person'],
    outcome: null,
  });
  await adapter.agents.save(doc);
  const original = adapter.broker.call.getMockImplementation();
  jest
    .spyOn(adapter.broker, 'call')
    .mockImplementation((name, ...args) =>
      name === 'persona-inbox.resolveByHitlItem'
        ? Promise.resolve({ count: 1 })
        : original(name, ...args)
    );
  await chat('Den Vorschlag zum Beta Review follow-up ist falsch');
  await chat('Ja');
  const updated = await adapter.agents.readDocument('tenant-a');
  const saved = updated.agents.find((item) => item.functionId === 'fn-b');
  expect(saved.stats.rejected).toBe(1);
  saved.stats.cycles = 1;
  updated.coverage = [{ functionId: 'fn-a', actorId: 'person', score: 1 }];
  adapter.broker.call.mockImplementation((name, ...args) =>
    name === 'activation.neighbors'
      ? Promise.resolve([{ functionId: 'fn-a' }])
      : original(name, ...args)
  );
  const charge = jest
    .spyOn(adapter.agents, 'charge')
    .mockRejectedValue(new Error('attempted generation'));
  expect(await adapter.agents.propose(updated, saved, [{ summary: 'observation' }], () => {})).toBe(
    0
  );
  expect(charge).not.toHaveBeenCalled();
  saved.stats.rejected = 0;
  await expect(
    adapter.agents.propose(updated, saved, [{ summary: 'observation' }], () => {})
  ).rejects.toThrow('attempted generation');
  expect(charge).toHaveBeenCalledTimes(1);
});
test('unknown notice identifiers and invisible/ambiguous proposals cannot be accepted', async () => {
  expect((await chat('Nimm V-999 an')).responseText).toContain('Welchen sichtbaren Vorschlag');
  await chat('Ja');
  expect(adapter.agentEvents.some((event) => event.outcome)).toBe(false);
});
test.each(['off', 'proposals_only', 'all'])(
  'notice preference %s is persisted by the real notices service only after confirmation',
  async (preference) => {
    const prior = preference === 'all' ? 'off' : 'all';
    await adapter.broker.call(
      'notices.setPreference',
      { tenantId: 'tenant-a', actorId: 'person', preference: prior },
      { meta: meta() }
    );
    const command = {
      off: 'Keine Hinweise mehr',
      proposals_only: 'Nur Vorschläge',
      all: 'Alle Hinweise',
    }[preference];
    await chat(command);
    expect((await adapter.noticesService.read('tenant-a', 'person')).preference).toBe(prior);
    await chat('Ja');
    expect((await adapter.noticesService.read('tenant-a', 'person')).preference).toBe(preference);
  }
);
test('idempotent correction retries and undo retries have one effect and one journal record', async () => {
  const input = {
    target: 'coverage',
    correction: { functionId: 'fn-b', score: 1 },
    correctionId: 'stable-id',
  };
  await adapter.learning.actions.apply(input, { meta: meta('person', ['ROLE_ADMIN']) });
  await adapter.learning.actions.apply(input, { meta: meta('person', ['ROLE_ADMIN']) });
  expect(
    (await adapter.journal.readEntries('tenant-a')).filter(
      (e) => e.kind === 'corrected' && e.refs.includes('stable-id')
    )
  ).toHaveLength(1);
  await adapter.learning.actions.undo({ correctionId: 'stable-id' }, { meta: meta() });
  await adapter.learning.actions.undo({ correctionId: 'stable-id' }, { meta: meta() });
  expect(
    (await adapter.journal.readEntries('tenant-a')).filter(
      (e) => e.kind === 'corrected' && e.refs.includes('undo-stable-id')
    )
  ).toHaveLength(1);
});

test('ambiguous candidate selection is followed by a separate confirmation', async () => {
  await chat('kümmere dich nicht mehr um Review');
  const selection = await chat('Beta Review');
  expect(selection.responseText).toContain('Beta Review');
  expect((await beta()).responsibility.cet).toBe(true);
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(false);
});
test('Workbench chat intercepts corrections before case classification and preserves the inbox proposal view', async () => {
  const auth = meta();
  const input = {
    channel: 'api',
    conversationId: 'workbench-corrections',
    message: 'kümmere dich nicht mehr um Beta Review',
  };
  const first = await adapter.broker.call('workbench.chat', input, { meta: auth });
  expect(first.responseText).toContain('Beta Review');
  expect((await beta()).responsibility.cet).toBe(true);
  await adapter.broker.call('workbench.chat', { ...input, message: 'Ja' }, { meta: auth });
  expect((await beta()).responsibility.cet).toBe(false);
  const doc = await adapter.agents.readDocument('tenant-a');
  const agent = doc.agents.find((a) => a.functionId === 'fn-b');
  agent.proposals.push({
    ref: 'inbox-proposal',
    summary: 'Beta Review pending',
    recipients: ['person'],
  });
  await adapter.agents.save(doc);
  const inbox = await adapter.broker.call('workbench.inbox.tasks.list', {}, { meta: auth });
  expect(inbox.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ proposalRef: 'inbox-proposal', title: 'Beta Review pending' }),
    ])
  );
  const hidden = await adapter.broker.call(
    'workbench.inbox.tasks.list',
    {},
    { meta: meta('outsider') }
  );
  expect(hidden.items).toEqual([]);
});
test.each([
  ['Für Beta Review bin ich selbst zuständig', 'coverage'],
  ['Beta Review erledige ich selbst', 'coverage'],
  ['I am responsible for Beta Review', 'coverage'],
  ['Du brauchst dich nicht mehr um Beta Review zu kümmern', 'activation'],
  ["Don't take care of Beta Review", 'activation'],
  ['CET soll Beta Review übernehmen', 'activation'],
  ['Bitte kümmere dich um Beta Review', 'activation'],
  ['Can you take care of Beta Review?', 'activation'],
  ['Das macht bei uns niemand, übernimm das', 'activation'],
  ['Das hängt nicht zusammen', 'neighbor'],
])('additional independent wording: %s', (message, target) =>
  expect(recognizeCorrection(message)?.target).toBe(target)
);

test('newest-first attention undo prevents overwriting later corrections', async () => {
  const first = await apply('agent', { functionId: 'fn-b', kind: 'retain' });
  const second = await apply('agent', { functionId: 'fn-b', kind: 'pin' });
  await expect(
    adapter.learning.actions.undo(
      { correctionId: first.correctionId },
      { meta: meta('person', ['ROLE_ADMIN']) }
    )
  ).rejects.toThrow('Undo newer');
  expect((await beta()).attention.inventory).toBe(true);
  await adapter.learning.actions.undo(
    { correctionId: second.correctionId },
    { meta: meta('person', ['ROLE_ADMIN']) }
  );
  await adapter.learning.actions.undo({ correctionId: first.correctionId }, { meta: meta() });
  expect((await beta()).attention.tier).toBe('transient');
});
test('bounded correction audit refuses additional records rather than losing undo history', async () => {
  adapter.learning.settings.maxRecordsPerTenant = 1;
  await apply('coverage', { functionId: 'fn-a', score: 1 });
  await expect(apply('coverage', { functionId: 'fn-b', score: 1 })).rejects.toThrow('record limit');
});
test('latest same-clock coverage correction wins and removing it restores earlier corrected evidence', async () => {
  await apply('coverage', { functionId: 'fn-a', score: 1 });
  const second = await apply('coverage', { functionId: 'fn-a', score: 0 });
  expect((await adapter.coverageService.actions.byActor({}, { meta: meta() })).items[0].score).toBe(
    0
  );
  await adapter.learning.actions.undo({ correctionId: second.correctionId }, { meta: meta() });
  expect((await adapter.coverageService.actions.byActor({}, { meta: meta() })).items[0].score).toBe(
    1
  );
});

test('pronoun corrections request function selection, then require effect confirmation', async () => {
  const first = await chat('Das mache ich selbst');
  expect(first.responseText).toContain('Welche Funktion');
  expect((await beta()).responsibility.humans).toEqual([]);
  const preview = await chat('Beta Review');
  expect(preview.responseText).toContain('Beta Review');
  expect(preview.responseText).toContain('selbst zuständig');
  await chat('Ja');
  expect((await beta()).responsibility.humans).toContain('person');
});
test('neighbor pronoun clarification collects both function labels before confirmation', async () => {
  await chat('Das hängt nicht zusammen');
  const second = await chat('Alpha Review');
  expect(second.responseText).toContain('zweite Funktion');
  expect((await beta()).responsibility.cet).toBe(true);
  const preview = await chat('Beta Review');
  expect(preview.responseText).toContain('Alpha Review');
  expect(preview.responseText).toContain('Beta Review');
  expect((await beta()).responsibility.cet).toBe(true);
  await chat('Ja');
  expect((await beta()).responsibility.cet).toBe(false);
});
test('mixed affirmation/contradiction does not authorize a pending correction', async () => {
  await chat('kümmere dich nicht mehr um Beta Review');
  await chat('Ja, aber nicht Beta Review');
  expect((await beta()).responsibility.cet).toBe(true);
});
test('existing HITL event drives one rejection statistic without a separate learning feedback path', async () => {
  const doc = await adapter.agents.readDocument('tenant-a');
  const agent = doc.agents.find((a) => a.functionId === 'fn-b');
  agent.proposals.push({
    ref: 'hitl-rejection',
    functionId: 'fn-b',
    recipients: ['person'],
    outcome: null,
  });
  await adapter.agents.save(doc);
  const event = { tenantId: 'tenant-a', itemId: 'hitl-rejection', status: 'rejected' };
  await adapter.broker.emit('hitl.item.resolved', event);
  await adapter.broker.emit('hitl.item.resolved', event);
  await adapter.agents.settle();
  expect(
    (await adapter.agents.readDocument('tenant-a')).agents.find((a) => a.functionId === 'fn-b')
      .stats.rejected
  ).toBe(1);
  expect(
    adapter.agentEvents.filter((e) => e.ref === 'hitl-rejection' && e.outcome === 'rejected')
  ).toHaveLength(1);
});
