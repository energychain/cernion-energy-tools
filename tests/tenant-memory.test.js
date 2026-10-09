'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const ObjectStore = require('../services/object-store.service');
const Notices = require('../services/shared-service-notices.service');
const llm = require('../src/llm-client');
const memory = require('../src/tenant-memory');
const store = require('../src/tenant-memory-store');
const fixture = require('./fixtures/tenant-memory.json');

const assertion = (
  text,
  anchors = [{ value: 'Hauptstraße', qualifier: '', aliases: [] }],
  time = {}
) => ({
  text,
  basis: text,
  commitment: 'planned',
  anchors,
  time: { from: '', until: '', latest: '', earliest: '', date: '', ...time },
  expiresAt: '',
});
const situation = (text, assertions = [], extra = {}) => ({
  concern: 'Organisation planen',
  situation: text,
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: { description: '', externalEffect: false, draftRequested: false },
  turnKind: 'work',
  retrievalTerms: [],
  tenantMemory: {
    assertions,
    correction: { kind: 'none', basis: '', factId: '' },
    query: { requested: false, anchor: '', functionLabel: '' },
  },
  ...extra,
});
async function setup() {
  const app = await createCaseBroker();
  app.broker.createService({ ...ObjectStore, settings: { dbPath: path.join(app.dir, 'objects') } });
  app.broker.createService({
    ...Notices,
    settings: { ...Notices.settings, dbPath: path.join(app.dir, 'notices') },
  });
  await app.broker.start();
  return app;
}
function context(app, actor = 'Charly', tenantId = 'tenant-a', clearance = []) {
  const meta = auth(actor, ['ROLE_ALPHA'], tenantId, clearance);
  return {
    broker: app.broker,
    params: {},
    meta,
    call: (name, params) => app.call(name, params, meta),
  };
}
const principal = (actor = 'Charly', tenantId = 'tenant-a', clearance = []) => ({
  tenantId,
  actorId: actor,
  roles: ['ROLE_ALPHA'],
  clearance,
});

function assessments() {
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const input = JSON.parse(prompt);
    if (input.fact)
      return {
        relations: input.candidates.map((item) => ({
          candidateId: item.id,
          kind: 'gap',
          reason: fixture.reason,
          uncertainty: 0.2,
          evidenceIds: [],
          question: fixture.question,
        })),
        plausibility: [],
      };
    const item = input.message.includes('2034') ? fixture.second : fixture.first;
    return situation(
      input.message,
      /203[04]/.test(input.message)
        ? [
            assertion(input.message, undefined, {
              latest: item.latest || '',
              earliest: item.earliest || '',
            }),
          ]
        : []
    );
  });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [
        {
          text: 'Wir berücksichtigen die vorliegenden Angaben.',
          supported: 'model',
          completedAction: false,
          specific: false,
          evidenceIds: [],
        },
      ],
      nextSteps: [],
    })
  );
}

describe('tenant memory acceptance and lifecycle', () => {
  let app;
  beforeEach(async () => {
    jest.clearAllMocks();
    assessments();
    app = await setup();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  test.each([
    [fixture.first, fixture.second],
    [fixture.second, fixture.first],
  ])(
    'AC-01/02: both actor orders, once-only capture and next-turn notice',
    async (first, second) => {
      const send = (item, text = item.text) =>
        app.call(
          'workbench.chat',
          {
            userRequest: text,
            channel: 'api',
            conversationId: `memory-${item.actor}`,
            asyncDelivery: {},
          },
          auth(item.actor)
        );
      const a = await send(first);
      expect(a.responseText).toContain('Hab ich festgehalten:');
      expect(a.cetCaseId).toBeFalsy();
      const b = await send(second);
      expect(b.responseText).toContain(first.actor);
      expect(b.responseText).toContain('2030 bis 2034');
      expect(b.responseText).toMatch(/\d{4}-\d{2}-\d{2}/);
      const next = await send(first, 'Was ist der nächste Schritt?');
      expect(next.noticeBlock || next.responseText).toContain('2030 bis 2034');
      const later = await app.call(
        'notices.list',
        { tenantId: 'tenant-a', actorId: first.actor },
        auth(first.actor)
      );
      expect(later.items.filter((item) => item.kind === 'memory')).toHaveLength(0);
      const docs = await store.query(context(app), principal());
      expect(docs.filter((item) => item.type === 'tenant_memory_fact')).toHaveLength(2);
    }
  );

  test.each(['ID-synthetic-17', '2031-06-01'])(
    'AC-03: same algorithm for arbitrary identifiers and dates: %s',
    async (value) => {
      const facts = [];
      for (const actor of ['Charly', 'Doris']) {
        const text = `${actor}: Planung mit ${value}.`;
        const result = await memory.capture(context(app, actor), principal(actor), {
          situation: situation(text, [assertion(text, [{ value, qualifier: '', aliases: [] }])]),
          envelope: { userRequest: text, conversationId: actor, channel: 'api' },
        });
        facts.push(...result.facts);
      }
      expect(store.candidates(facts[1], facts)).toHaveLength(1);
      await memory.assess(context(app, 'Doris'), principal('Doris'), facts[1], {});
      expect(
        await store.relationText(
          context(app),
          principal(),
          store.key(['relationship', ...facts.map((item) => item.id).sort()])
        )
      ).toContain(fixture.reason);
    }
  );

  test('AC-04: ubiquitous anchors do not trigger; rare anchors do, normalized aliases match', () => {
    const facts = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      status: 'valid',
      anchorKeys: ['common', ...(i < 2 ? ['rare'] : [])],
    }));
    expect(store.candidates(facts[19], facts)).toEqual([]);
    expect(store.candidates(facts[1], facts).map((item) => item.id)).toEqual(['0']);
    expect(
      store.anchorKeys({ value: 'Hauptstraße', aliases: ['HAUPTSTRASSE'], qualifier: '' })
    ).toHaveLength(1);
  });

  test('AC-05: only tenant-local ambiguity asks a question', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Synthetische Aussage Hauptstraße';
    const add = (qualifier, conversationId) =>
      memory.capture(ctx, p, {
        situation: situation(text, [
          assertion(text, [{ value: 'Hauptstraße', qualifier, aliases: [] }]),
        ]),
        envelope: { userRequest: text, channel: 'api', conversationId },
      });
    expect((await add('', 'plain')).confirmation).toContain('Hab ich festgehalten');
    await add('A', 'a');
    await add('B', 'b');
    expect((await add('', 'ambiguous')).ambiguous).toMatch(/A oder B|B oder A/);
  });

  test('AC-06/07: audited revocation, expiry, tenant and clearance isolation', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Planung für Bereich Q.';
    const captured = await memory.capture(ctx, p, {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text, channel: 'api', conversationId: 'life' },
    });
    const fact = captured.facts[0];
    await memory.preturn(
      ctx,
      p,
      { userRequest: 'streich das' },
      { tenantMemoryFactIds: [fact.id] }
    );
    const revoked = (await store.get(ctx, p, fact.id)).payload;
    expect(revoked.status).toBe('revoked');
    expect(revoked.audit.at(-1).basis).toBe('streich das');
    expect(store.candidates(fact, [revoked])).toEqual([]);
    const query = await memory.queryResponse(ctx, p, '', { anchor: 'Hauptstraße' });
    expect(query.responseText).toContain('widerrufen');
    expect(
      (
        await memory.queryResponse(
          context(app, 'Charly', 'tenant-b'),
          principal('Charly', 'tenant-b'),
          '',
          {}
        )
      ).statements
    ).toEqual([]);
    await store.put(ctx, p, { ...fact, status: 'valid', expiresAt: '2000-01-01' });
    expect(store.active((await store.get(ctx, p, fact.id)).payload)).toBe(false);
    expect((await memory.queryResponse(ctx, p, '', {})).responseText).toContain('abgelaufen');
    await store.put(
      context(app, 'Charly', 'tenant-a', ['private']),
      principal('Charly', 'tenant-a', ['private']),
      { ...fact, status: 'valid', sensitivityFlags: ['private'] }
    );
    expect((await store.query(ctx, p)).filter((item) => item.id === fact.id)).toEqual([]);
    await expect(store.get(ctx, p, fact.id)).rejects.toMatchObject({ code: 403 });
  });

  test('AC-08: later work mentions relationship before the draft and includes it in answer evidence', async () => {
    const p = principal(),
      ctx = context(app);
    const facts = [];
    for (const item of [fixture.first, fixture.second]) {
      const captured = await memory.capture(context(app, item.actor), principal(item.actor), {
        situation: situation(item.text, [assertion(item.text)]),
        envelope: { userRequest: item.text, channel: 'api', conversationId: item.actor },
        mapping: { functionLabel: item.functionLabel },
      });
      facts.push(...captured.facts);
    }
    await memory.assess(context(app, 'Doris'), principal('Doris'), facts[1], {});
    llm.generateStructured.mockImplementation(async () =>
      situation('Kundeninformation Hauptstraße', [], { turnKind: 'knowledge' })
    );
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        expectation: [],
        nextSteps: [],
        draft: [
          {
            text: 'Wir informieren über die geplanten Schritte und die noch zu klärende Übergangslösung.',
            supported: 'model',
            completedAction: false,
            specific: false,
            evidenceIds: [],
          },
        ],
      })
    );
    const reply = await app.call(
      'workbench.chat',
      {
        userRequest: 'Entwirf eine Kundeninformation zur Hauptstraße.',
        channel: 'api',
        conversationId: 'later-work',
        asyncDelivery: {},
      },
      auth()
    );
    expect(reply.responseText.indexOf('2030 bis 2034')).toBeGreaterThanOrEqual(0);
    expect(reply.responseText.indexOf('2030 bis 2034')).toBeLessThan(
      reply.responseText.indexOf('Entwurf:')
    );
    const prompt = llm.generateText.mock.calls.at(-1)[0];
    expect(prompt).toContain('tenant-memory');
    expect(prompt).toContain('2034');
    expect(await memory.related(ctx, p, {}, 'Hauptstraße')).toMatchObject({
      text: expect.stringContaining('2030 bis 2034'),
    });
  });

  test('AC-11: slow assessment cannot extend retrieval budget; both recipients receive one deferred notice', async () => {
    const previousBudget = process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS;
    process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS = '35';
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const first = await memory.capture(context(app), principal(), {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, channel: 'api', conversationId: 'slow-first' },
    });
    const base = llm.generateStructured.getMockImplementation();
    llm.generateStructured.mockImplementation(async (schema, prompt) => {
      if (JSON.parse(prompt).fact) await held;
      return base(schema, prompt);
    });
    let reply;
    const started = performance.now();
    try {
      reply = await app.call(
        'workbench.chat',
        {
          userRequest: fixture.second.text,
          channel: 'api',
          conversationId: 'slow-second',
          asyncDelivery: {},
        },
        auth('Doris')
      );
      expect(performance.now() - started).toBeLessThan(1000);
      expect(reply.responseText).toContain('Hab ich festgehalten:');
      expect(reply.responseText).not.toContain('2030 bis 2034');
    } finally {
      release();
      if (previousBudget === undefined) delete process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS;
      else process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS = previousBudget;
      await Promise.allSettled([...(app.workbench.tenantMemoryJobs || [])]);
    }
    for (const actor of ['Charly', 'Doris']) {
      const notice = await app.call(
        'notices.completeTurn',
        { tenantId: 'tenant-a', actorId: actor, turnRef: 'deferred-next' },
        auth(actor)
      );
      expect(notice.block).toContain('2030 bis 2034');
      const once = await app.call(
        'notices.completeTurn',
        { tenantId: 'tenant-a', actorId: actor, turnRef: 'deferred-after' },
        auth(actor)
      );
      expect(once.block).toBe('');
    }
    expect(
      (await store.get(context(app), principal(), first.ids[0])).payload.relationIds
    ).toHaveLength(1);
  });

  test('notice delivery rechecks clearance and revoked facts; no cross-tenant notices', async () => {
    const first = await memory.capture(
      context(app, 'Charly', 'tenant-a', ['private']),
      principal('Charly', 'tenant-a', ['private']),
      {
        situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
        envelope: { userRequest: fixture.first.text, channel: 'api', conversationId: 'secret-a' },
      }
    );
    await store.put(
      context(app, 'Charly', 'tenant-a', ['private']),
      principal('Charly', 'tenant-a', ['private']),
      { ...first.facts[0], sensitivityFlags: ['private'] }
    );
    const second = await memory.capture(
      context(app, 'Doris', 'tenant-a', ['private']),
      principal('Doris', 'tenant-a', ['private']),
      {
        situation: situation(fixture.second.text, [assertion(fixture.second.text)]),
        envelope: { userRequest: fixture.second.text, channel: 'api', conversationId: 'secret-b' },
      }
    );
    await memory.assess(
      context(app, 'Doris', 'tenant-a', ['private']),
      principal('Doris', 'tenant-a', ['private']),
      second.facts[0],
      {}
    );
    expect(
      (await app.call('notices.list', { tenantId: 'tenant-a', actorId: 'Charly' }, auth('Charly')))
        .items
    ).toEqual([]);
    expect(
      (
        await app.call(
          'notices.list',
          { tenantId: 'tenant-b', actorId: 'Charly' },
          auth('Charly', ['ROLE_ALPHA'], 'tenant-b')
        )
      ).items
    ).toEqual([]);
    await memory.correctFacts(
      context(app, 'Charly', 'tenant-a', ['private']),
      principal('Charly', 'tenant-a', ['private']),
      { userRequest: 'streich das' },
      { tenantMemoryFactIds: first.ids },
      { kind: 'revoked', basis: 'streich das', factId: '' }
    );
    expect(
      (
        await app.call(
          'notices.list',
          { tenantId: 'tenant-a', actorId: 'Charly' },
          auth('Charly', ['ROLE_ALPHA'], 'tenant-a', ['private'])
        )
      ).items
    ).toEqual([]);
  });

  test('an interrupted turn leaves retryable memory without a hanging background job', async () => {
    const previousTimeout = process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS;
    process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS = '25';
    try {
      const service = app.broker.getLocalService('workbench');
      const state = memory.start(service, context(app), principal(), {
        situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
        envelope: {
          userRequest: fixture.first.text,
          channel: 'api',
          conversationId: 'interrupted',
        },
        retrieval: new Promise(() => {}),
      });
      await state.job;
      expect(state.settled).toBe(true);
      expect(service.tenantMemoryJobs.size).toBe(0);
      expect((await store.get(context(app), principal(), state.ids[0])).payload.checking).toBe(
        'pending'
      );
    } finally {
      if (previousTimeout === undefined) delete process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS;
      else process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS = previousTimeout;
    }
  });

  test('expired facts suppress existing relationships and pending notices', async () => {
    const send = (actor, text) =>
      memory.capture(context(app, actor), principal(actor), {
        situation: situation(text, [assertion(text)]),
        envelope: { userRequest: text, channel: 'api', conversationId: `expiry-${actor}` },
      });
    const first = await send('Charly', fixture.first.text);
    const second = await send('Doris', fixture.second.text);
    await memory.assess(context(app, 'Doris'), principal('Doris'), second.facts[0], {});
    const fact = (await store.get(context(app), principal(), first.ids[0])).payload;
    expect(await store.relationText(context(app), principal(), fact.relationIds[0])).toContain(
      fixture.reason
    );
    await store.put(context(app), principal(), { ...fact, expiresAt: '2000-01-01' });
    expect(await store.relationText(context(app), principal(), fact.relationIds[0])).toBe('');
    expect(
      (await app.call('notices.list', { tenantId: 'tenant-a', actorId: 'Charly' }, auth('Charly')))
        .items
    ).toEqual([]);
    const answer = await memory.related(
      context(app, 'Doris'),
      principal('Doris'),
      { identifiers: [] },
      'Hauptstraße'
    );
    expect(answer.text).not.toContain(fixture.reason);
  });

  test('independent and malformed model evaluations are never published', async () => {
    const captured = [];
    for (const actor of ['Charly', 'Doris']) {
      const text = `Planung ${actor}`;
      captured.push(
        ...(
          await memory.capture(context(app, actor), principal(actor), {
            situation: situation(text, [assertion(text)]),
            envelope: { userRequest: text, channel: 'api', conversationId: actor },
          })
        ).facts
      );
    }
    llm.generateStructured.mockResolvedValue({
      relations: [
        {
          candidateId: captured[0].id,
          kind: 'independent',
          reason: 'Unabhängig.',
          uncertainty: 0,
          evidenceIds: [],
          question: '',
        },
      ],
      plausibility: [],
    });
    expect(await memory.assess(context(app, 'Doris'), principal('Doris'), captured[1], {})).toEqual(
      []
    );
    llm.generateStructured.mockResolvedValue({
      relations: [{ candidateId: captured[0].id, kind: 'invented', reason: 'Wrong' }],
      plausibility: [],
    });
    await expect(
      memory.assess(context(app, 'Doris'), principal('Doris'), captured[1], {})
    ).rejects.toThrow('Invalid tenant memory judgment');
    expect(
      await store.query(context(app), principal(), { 'payload.type': 'tenant_memory_relation' })
    ).toEqual([]);
  });

  test('direct object-store namespace operations enforce tenant and clearance, including Mango queries', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Synthetische Planung';
    const captured = await memory.capture(ctx, p, {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text, channel: 'api', conversationId: 'access' },
    });
    const params = { namespace: store.namespace(p), key: captured.ids[0] };
    const foreign = auth('foreign', ['ROLE_ALPHA'], 'tenant-b');
    for (const action of ['get', 'delete', 'put']) {
      await expect(
        app.call(
          `object-store.${action}`,
          { ...params, ...(action === 'put' ? { payload: captured.facts[0] } : {}) },
          foreign
        )
      ).rejects.toMatchObject({ code: 403 });
    }
    await expect(
      app.call('object-store.query', { namespace: params.namespace, selector: {} }, foreign)
    ).rejects.toMatchObject({ code: 403 });
    await store.put(
      context(app, 'Charly', 'tenant-a', ['private']),
      principal('Charly', 'tenant-a', ['private']),
      { ...captured.facts[0], sensitivityFlags: ['private'] }
    );
    expect(
      (await app.call('object-store.query', { namespace: params.namespace, selector: {} }, auth()))
        .docs
    ).toEqual([]);
    await expect(app.call('object-store.get', params, auth())).rejects.toMatchObject({ code: 403 });
    await expect(app.call('object-store.delete', params, auth())).rejects.toMatchObject({
      code: 403,
    });
    await expect(
      app.call('object-store.put', { ...params, payload: captured.facts[0] }, auth())
    ).rejects.toMatchObject({ code: 403 });
  });

  test('correction remains audited and old facts cannot link; parenthesised qualifiers stay tenant-local', async () => {
    const text = 'Synthetische Planung Projekt-Q';
    const ctx = context(app),
      p = principal();
    const captured = await memory.capture(ctx, p, {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text, channel: 'api', conversationId: 'correction' },
    });
    await memory.correctFacts(
      ctx,
      p,
      { userRequest: 'Das stimmt so nicht.' },
      { tenantMemoryFactIds: captured.ids },
      { kind: 'corrected', basis: 'Das stimmt so nicht.', factId: '' }
    );
    const updated = (await store.get(ctx, p, captured.ids[0])).payload;
    expect(updated.status).toBe('corrected');
    expect(updated.audit.at(-1).previousText).toBe(text);
    expect(store.candidates({ ...updated, id: 'new' }, [updated])).toEqual([]);
    expect(
      store.ambiguous(
        [{ value: 'Hauptstraße', qualifier: '' }],
        [
          {
            anchors: [
              { value: 'Hauptstraße (A)', qualifier: '' },
              { value: 'Hauptstraße (B)', qualifier: '' },
            ],
          },
        ]
      )
    ).toMatchObject({ value: 'Hauptstraße', variants: expect.arrayContaining(['A', 'B']) });
    expect(store.anchorKeys({ value: 'Hauptstraße (A)', qualifier: '', aliases: [] })).toEqual(
      store.anchorKeys({ value: 'Hauptstraße', qualifier: 'A', aliases: [] })
    );
  });

  test('failed background judgment resumes from persisted facts and evidence on the next content turn', async () => {
    const captured = [];
    for (const actor of ['Charly', 'Doris']) {
      const text = `Synthetische Planung ${actor}`;
      captured.push(
        ...(
          await memory.capture(context(app, actor), principal(actor), {
            situation: situation(text, [assertion(text)]),
            envelope: { userRequest: text, channel: 'api', conversationId: actor },
          })
        ).facts
      );
    }
    llm.generateStructured.mockRejectedValueOnce(new Error('Temporary failure'));
    await expect(
      memory.assess(context(app, 'Doris'), principal('Doris'), captured[1], {})
    ).rejects.toThrow('Temporary failure');
    expect(
      (await store.get(context(app, 'Doris'), principal('Doris'), captured[1].id)).payload.checking
    ).toBe('pending');
    assessments();
    const state = memory.start(app.workbench, context(app, 'Doris'), principal('Doris'), {
      situation: situation('Weitere Frage', [], { turnKind: 'knowledge' }),
      envelope: { userRequest: 'Weitere Frage', channel: 'api', conversationId: 'Doris' },
      retrieval: Promise.resolve({ evidence: [] }),
    });
    await state.job;
    expect(
      (await store.get(context(app, 'Doris'), principal('Doris'), captured[1].id)).payload.checking
    ).toBe('complete');
    expect(
      (await app.call('notices.list', { tenantId: 'tenant-a', actorId: 'Charly' }, auth('Charly')))
        .block
    ).toContain('2030 bis 2034');
  });

  test('AC-09: plausibility only with cited retrieved rule', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Wir sperren den gesamten Zugang.';
    const captured = await memory.capture(ctx, p, {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text, channel: 'api', conversationId: 'rules' },
    });
    llm.generateStructured.mockResolvedValue({
      relations: [],
      plausibility: [
        { reason: 'Das widerspricht Regel R-17.', evidenceIds: ['K1'] },
        { reason: 'Unbelegte Behauptung', evidenceIds: ['invented'] },
      ],
    });
    const result = await memory.assess(ctx, p, captured.facts[0], {
      evidence: [{ source: 'Synthetische Regel R-17', value: 'Ein Zugang bleibt offen.' }],
    });
    expect(result.join()).toContain('Quelle: Synthetische Regel R-17');
    expect(result.join()).not.toContain('Unbelegte Behauptung');
  });

  test.each(['knowledge', 'smalltalk', 'review'])(
    'AC-10: no facts for %s even with erroneous extraction',
    async (turnKind) => {
      const text = 'Was gilt für die Planung?';
      expect(
        (
          await memory.capture(context(app), principal(), {
            situation: situation(text, [assertion(text)], { turnKind }),
            envelope: { userRequest: text },
          })
        ).facts
      ).toEqual([]);
    }
  );
  test('AC-10: documents, background tasks and ungrounded extraction never persist', async () => {
    for (const envelope of [
      { userRequest: 'Text', documents: [{}] },
      { userRequest: '### Task:\nGenerate a title for the chat' },
      { userRequest: 'Andere Nachricht' },
    ]) {
      expect(
        (
          await memory.capture(context(app), principal(), {
            situation: situation('Text', [assertion('Text')]),
            envelope,
          })
        ).facts
      ).toEqual([]);
    }
  });
});
module.exports = { setup, context, principal, assertion, situation, assessments };
