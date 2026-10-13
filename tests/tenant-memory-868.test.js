'use strict';
jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { generateMemoryMessageFixture } = require('../scripts/generate-memory-cleanup-fixture');
const memory = require('../src/tenant-memory');
const store = require('../src/tenant-memory-store');
const llm = require('../src/llm-client');
describe('868 literal message anchors and unseen interaction notices', () => {
  let app, f;
  const principal = (actor, roles = ['ROLE_ALPHA']) => ({
    tenantId: 'tenant-a',
    actorId: actor,
    roles,
    clearance: [],
  });
  function context(p) {
    const meta = auth(p.actorId, p.roles, p.tenantId);
    return {
      broker: app.broker,
      params: {},
      meta,
      call: (name, params, options) =>
        app.broker.call(name, params, { meta: { ...meta, ...options?.meta } }),
    };
  }
  async function capture(
    message,
    actor,
    { basis = message, anchors = [], scope = 'organization' } = {}
  ) {
    const p = principal(actor),
      ctx = context(p);
    const input = {
      situation: {
        turnKind: 'work',
        tenantMemory: { assertions: [{ ...f.assertion(basis, ''), scope, anchors }] },
      },
      envelope: { userRequest: message, conversationId: message, channel: 'api' },
      mapping: { displayName: actor, functionLabel: 'Planung' },
      retrieval: Promise.resolve({ evidence: [] }),
    };
    const state = memory.start(app.workbench, ctx, p, input);
    await state.job;
    return { state, ctx, p };
  }
  async function deliver(actor, turnRef, currentFactIds = []) {
    return app.broker.call(
      'notices.completeTurn',
      { tenantId: 'tenant-a', actorId: actor, turnRef, currentFactIds, fullQueue: true },
      { meta: auth(actor) }
    );
  }
  beforeEach(async () => {
    jest.clearAllMocks();
    f = generateMemoryMessageFixture();
    app = await createCaseBroker();
    for (const [schema, folder] of [
      [require('../services/object-store.service'), 'objects'],
      [require('../services/shared-service-notices.service'), 'notices'],
    ])
      app.broker.createService({
        ...schema,
        settings: { ...schema.settings, dbPath: path.join(app.dir, folder) },
      });
    app.broker.createService(require('../services/tenant-memory-policy.service'));
    llm.generateStructured.mockImplementation(async (_schema, raw) => {
      const data = JSON.parse(raw);
      return {
        effects: data.candidates.map((candidate) => ({
          candidateId: candidate.id,
          possibleConsequence: f.reason,
          affectedWork: 'Weitere Arbeiten',
          availabilityLimit: 'Unterschiedliche Fristen.',
        })),
        relations: data.candidates.map((candidate) => ({
          candidateId: candidate.id,
          kind: 'gap',
          reason: f.reason,
          uncertainty: 0.2,
          evidenceIds: [],
          question: '',
        })),
        plausibility: [],
      };
    });
    await app.broker.start();
  });
  afterEach(async () => app.cleanup());
  test('A.2: every punctuation boundary ends a reference before a following noun', () => {
    for (const text of f.punctuation)
      expect(store.referenceAnchors(text).map((ref) => ref.value)).toEqual([f.base]);
  });
  test('A.3: sentence-initial prepositions count while initial and abstract nouns do not', () => {
    for (const text of f.initial) expect(store.referenceAnchors(text)[0].value).toBe(f.base);
    for (const text of [f.generic, ...f.genericVariants])
      expect(store.referenceAnchors(text)).toEqual([]);
    expect(store.referenceAnchors(f.singleCase)[0].value).toBe(f.base);
  });
  test.each(Array.from({ length: 10 }, (_, index) => [Math.floor(index / 2), index % 2]))(
    'A.1–A.5 / pattern %i, reverse %i: literal bases and immediate interaction in both orders',
    async (pattern, reverse) => {
      const texts = f.patterns[pattern],
        actors = [f.actorA, f.actorB];
      const order = reverse ? [1, 0] : [0, 1];
      await capture(texts[order[0]], actors[order[0]]);
      const second = await capture(texts[order[1]], actors[order[1]]);
      const facts = await store.byBase(second.ctx, second.p, f.base);
      expect(facts).toHaveLength(2);
      expect(
        facts.every(
          (fact) =>
            fact.text.includes(f.base) &&
            fact.basis.includes(f.base) &&
            fact.message.includes(fact.basis)
        )
      ).toBe(true);
      expect(second.state.confirmation).toContain('Hab ich festgehalten');
      expect(second.state.paragraphs.join(' ')).toContain(f.reason);
      expect(facts.every((fact) => fact.relationIds.length === 1)).toBe(true);
    }
  );
  test('A.5: a truncated literal basis expands to its enclosing sentence without rewriting', async () => {
    const message = f.patterns[2][0];
    const result = await capture(message, f.actorA, {
      basis: f.fragment,
      anchors: [{ value: 'Gasversorgung', qualifier: '', aliases: [] }],
    });
    const fact = (await store.byBase(result.ctx, result.p, f.base))[0];
    expect(fact.basis).toBe(message);
    expect(fact.text).toBe(message);
    expect(result.state.confirmation).toContain(f.base);
  });
  test('A.4: rare known bases match whole messages and common terms in tenant documents connect nothing', async () => {
    const p = principal(f.actorA),
      ctx = context(p);
    const records = Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      status: 'valid',
      text: f.commonText,
      anchors: [{ value: f.otherBase + index, qualifier: '', aliases: [] }],
      anchorKeys: store.anchorKeys({ value: f.otherBase + index }),
    }));
    const rare = {
      ...records[0],
      id: f.base,
      text: f.patterns[0][0],
      anchors: [{ value: f.base, qualifier: '', aliases: [] }],
      anchorKeys: store.anchorKeys({ value: f.base }),
    };
    expect(store.weightedAnchors([f.common, f.base], [...records, rare])).toEqual([f.base]);
    expect(
      store
        .groundedAnchors([], f.patterns[1][1], [...records, rare])
        .some((anchor) => anchor.value === f.base)
    ).toBe(true);
    const common = { ...rare, anchorKeys: store.anchorKeys({ value: f.common }) };
    expect(
      store.candidates(common, [
        ...records.map((record) => ({ ...record, anchorKeys: common.anchorKeys })),
        common,
      ])
    ).toEqual([]);
    expect(store.groundedAnchors([], f.commonText, [...records, rare])).toEqual([]);
    expect(await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' })).toEqual([]);
  });
  test('A.6: policy v3 repairs legacy bases, requeues new collisions, audits and is idempotent', async () => {
    const a = await capture(f.patterns[2][0], f.actorA),
      b = await capture(f.patterns[2][1], f.actorB);
    const p = principal(f.actorA, ['ROLE_ALPHA', 'ROLE_TENANT_ADMIN']),
      ctx = context(p);
    for (const [entry, value, basis] of [
      [a, f.base + ' Außerbetriebnahme', f.fragment],
      [b, 'Ortsnetztrafo', f.patterns[2][1]],
    ])
      await store.mutate(ctx, p, entry.state.ids[0], (fact) => ({
        ...fact,
        basis,
        text: basis,
        anchors: [{ value, qualifier: '', aliases: [] }],
        anchorKeys: store.anchorKeys({ value }),
        relationIds: [],
        checking: 'complete',
      }));
    const result = await app.broker.call(
      'tenant-memory-policy.migrateAnchors',
      { reason: f.base },
      { meta: auth(f.actorA, p.roles) }
    );
    expect(result).toEqual({
      migration: 'anchor-canonical-v3',
      scanned: 2,
      changed: 2,
      requeued: 2,
    });
    const facts = await store.byBase(ctx, p, f.base);
    expect(
      facts.every(
        (fact) =>
          fact.text.includes(f.base) &&
          fact.basis.includes(f.base) &&
          fact.checking === 'pending' &&
          fact.audit.at(-1).migration === 'anchor-canonical-v3'
      )
    ).toBe(true);
    const repeat = await app.broker.call(
      'tenant-memory-policy.migrateAnchors',
      { reason: f.base },
      { meta: auth(f.actorA, p.roles) }
    );
    expect(repeat).toEqual({
      migration: 'anchor-canonical-v3',
      scanned: 2,
      changed: 0,
      requeued: 0,
    });
  });
  test('B.1–B.4: one recipient summary, no own same-turn notice and no replay after migration/recovery', async () => {
    const a = await capture(f.patterns[0][0], f.actorA),
      b = await capture(f.patterns[0][1], f.actorB);
    const facts = await store.byBase(b.ctx, b.p, f.base),
      relationId = facts[0].relationIds[0];
    const delivered = await deliver(f.actorA, f.base);
    expect(delivered.items).toHaveLength(1);
    const text = delivered.items[0].text;
    expect(text).toContain(`Zu ${f.base} gibt es etwas Neues: ${f.actorB} (Planung) hat am`);
    expect(text).toContain('Das hängt mit deiner Aussage vom');
    expect(text).toContain(f.patterns[0][1]);
    expect(text).not.toContain(f.patterns[0][0]);
    expect(text).not.toMatch(/Prüfung ausstehend|gültig/);
    expect((await deliver(f.actorA, f.otherBase)).block).toBe('');
    await app.broker.call(
      'notices.enqueueMemory',
      {
        tenantId: 'tenant-a',
        actorId: f.actorB,
        relationId,
        factIds: facts.map((fact) => fact.id),
      },
      { meta: auth(f.actorA) }
    );
    expect((await deliver(f.actorB, f.thirdBase, b.state.ids)).block).toBe('');
    const notices = app.broker.getLocalService('notices');
    for (const actor of [f.actorA, f.actorB]) {
      const doc = await notices.read('tenant-a', actor);
      doc.seen = [];
      doc.history = [];
      await notices.save(doc);
      const replay = await app.broker.call(
        'notices.enqueueMemory',
        { tenantId: 'tenant-a', actorId: actor, relationId, factIds: facts.map((fact) => fact.id) },
        { meta: auth(f.actorA) }
      );
      expect(replay.queued).toBe(false);
      expect((await deliver(actor, actor)).block).toBe('');
    }
    expect(a.state.ids).toHaveLength(1);
  });
  test('organization extraction guard still excludes individual cases', async () => {
    const result = await capture(f.singleCase, f.actorA, {
      scope: 'case',
      anchors: [{ value: f.base, qualifier: '', aliases: [] }],
    });
    expect(result.state.ids).toEqual([]);
    expect(result.state.confirmation).toBe('');
  });
  test('B.1/B.3: an interaction already rendered in the answer is seen without a duplicate notice', async () => {
    await capture(f.patterns[0][0], f.actorA);
    const b = await capture(f.patterns[0][1], f.actorB);
    const facts = await store.byBase(b.ctx, b.p, f.base);
    const relationId = facts[0].relationIds[0];
    const ctx = context(principal(f.actorA));
    const hook = require('../src/function-coverage-turn');
    const responseText =
      (await store.relationText(ctx, principal(f.actorA), relationId)) + '\n\n' + f.otherBase;
    hook.before(ctx);
    const response = await hook.after(ctx, { responseText });
    expect(response.responseText).toBe(responseText);
    expect(response.responseText).not.toContain('Hinweise für dich:');
    expect(response.metadata?.notices).toBeUndefined();
    expect((await deliver(f.actorA, f.otherBase)).block).toBe('');
  });
  test('A.4: protected tenant documents affect df without exposing their facts or anchors', async () => {
    const p = { ...principal(f.actorA), clearance: ['restricted'] },
      ctx = context(p);
    ctx.meta.apiToken.sensitivityFlags = p.clearance;
    for (let index = 0; index < 8; index++)
      await store.put(ctx, p, {
        id: f.otherBase + index,
        type: 'tenant_memory_fact',
        tenantId: p.tenantId,
        sensitivityFlags: p.clearance,
        status: 'valid',
        text: f.commonText,
        anchors: [{ value: f.otherBase + index, qualifier: '', aliases: [] }],
        anchorKeys: store.anchorKeys({ value: f.otherBase + index }),
      });
    const reader = principal(f.actorB),
      reading = context(reader);
    expect(await store.query(reading, reader, { 'payload.type': 'tenant_memory_fact' })).toEqual(
      []
    );
    const corpus = await store.frequencyCorpus(reading, reader);
    expect(corpus).toHaveLength(8);
    expect(store.weightedAnchors([f.common], corpus)).toEqual([]);
    expect(store.groundedAnchors([], f.commonText, [], corpus)).toEqual([]);
  });
  test('A.6: audited original-source restoration repairs pre-v3 fragments and rejects foreign text', async () => {
    const initial = await capture(f.patterns[2][0], f.actorA);
    const p = principal(f.actorA, ['ROLE_ALPHA', 'ROLE_TENANT_ADMIN']),
      ctx = context(p),
      id = initial.state.ids[0];
    await store.mutate(ctx, p, id, (fact) => ({
      ...fact,
      message: undefined,
      basis: f.fragment,
      text: f.fragment,
      anchors: [
        { value: 'Gasversorgung', qualifier: '', aliases: [] },
        { value: f.base, qualifier: '', aliases: [] },
      ],
      anchorKeys: [
        ...store.anchorKeys({ value: 'Gasversorgung' }),
        ...store.anchorKeys({ value: f.base }),
      ],
    }));
    const migrate = (message) =>
      app.broker.call(
        'tenant-memory-policy.migrateAnchors',
        { reason: f.base, originalMessages: [{ id, message }] },
        { meta: auth(f.actorA, p.roles) }
      );
    const missing = await app.broker.call(
      'tenant-memory-policy.migrateAnchors',
      { reason: f.base },
      { meta: auth(f.actorA, p.roles) }
    );
    expect(missing.originalMessagesRequired).toEqual([id]);
    await expect(migrate(f.commonText)).rejects.toMatchObject({ code: 403 });
    const result = await migrate(f.patterns[2][0]);
    expect(result.changed).toBe(1);
    const repaired = (await store.get(ctx, p, id)).payload;
    expect(repaired.basis).toBe(f.patterns[2][0]);
    expect(repaired.text).toBe(f.patterns[2][0]);
    expect(repaired.audit.at(-1).originalRestored).toBe(true);
    expect((await migrate(f.patterns[2][0])).changed).toBe(0);
    await app.broker.call(
      'tenant-memory-policy.delete',
      { id, reason: f.base },
      { meta: auth(f.actorA, p.roles) }
    );
    expect((await store.get(ctx, p, id)).payload.message).toBe('');
    await expect(migrate(f.patterns[2][0])).rejects.toMatchObject({ code: 403 });
  });
  test('A.2: a malformed model anchor cannot retain words beyond any punctuation boundary', () => {
    for (const message of f.punctuation) {
      const anchors = store.groundedAnchors(
        [{ value: f.base + ' Außerbetriebnahme', qualifier: '', aliases: [] }],
        message
      );
      expect(anchors).toEqual([{ value: f.base, qualifier: '', aliases: [] }]);
    }
  });
});
