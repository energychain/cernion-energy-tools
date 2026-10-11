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
    call: (name, params, options) =>
      app.broker.call(name, params, { meta: { ...meta, ...options?.meta } }),
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
        effects: input.candidates.map((item) => ({
          candidateId: item.id,
          possibleConsequence: 'Synthetische Folge',
          affectedWork: 'Synthetische Planung',
          availabilityLimit: 'Synthetische Grenze',
        })),
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

  test('recovery waits for persisted backoff, respects quota and stops after the attempt ceiling', async () => {
    const previous = process.env.TENANT_MEMORY_RECOVERY_MAX_ATTEMPTS;
    process.env.TENANT_MEMORY_RECOVERY_MAX_ATTEMPTS = '2';
    const ctx = context(app),
      p = principal();
    const captured = await memory.capture(ctx, p, {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, conversationId: 'quota', channel: 'api' },
    });
    const fact = captured.facts[0];
    const warn = jest.spyOn(app.broker.logger, 'warn');
    const put = jest.spyOn(app.broker, 'call');
    const error = Object.assign(new Error('429 quota echoed private content'), {
      status: 429,
      retryAfter: 120,
    });
    // Mock the facade's shared Retry-After parser, not the persistence or recovery path.
    llm.retryDelayMs = jest.fn(() => 120000);
    llm.generateStructured.mockRejectedValue(error);
    try {
      await expect(
        memory.attemptAssessment(ctx, p, fact, {
          evidence: [{ value: 'synthetic rule', source: 'synthetic' }],
        })
      ).rejects.toThrow('429');
      const pending = (await store.get(ctx, p, fact.id)).payload;
      expect(pending).toMatchObject({
        attempts: 1,
        checking: 'pending',
        checkingFailure: { message: 'LLM provider quota exceeded', tenantId: p.tenantId },
      });
      expect(Date.parse(pending.nextAttemptAt) - Date.now()).toBeGreaterThan(115000);
      const calls = llm.generateStructured.mock.calls.length;
      put.mockClear();
      await memory.recover(app.workbench);
      await memory.recover(app.workbench);
      expect(put.mock.calls.filter(([name]) => name === 'object-store.put')).toHaveLength(0);
      expect(llm.generateStructured).toHaveBeenCalledTimes(calls);
      await store.mutate(ctx, p, fact.id, (value) => ({
        ...value,
        nextAttemptAt: new Date(0).toISOString(),
      }));
      await memory.recover(app.workbench);
      const failed = (await store.get(ctx, p, fact.id)).payload;
      expect(failed).toMatchObject({ attempts: 2, checking: 'failed' });
      expect((await memory.queryResponse(ctx, p, 'Hauptstraße')).responseText).toContain(
        'Prüfung fehlgeschlagen'
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private content');
      await memory.recover(app.workbench);
      expect(llm.generateStructured).toHaveBeenCalledTimes(calls + 1);
    } finally {
      if (previous === undefined) delete process.env.TENANT_MEMORY_RECOVERY_MAX_ATTEMPTS;
      else process.env.TENANT_MEMORY_RECOVERY_MAX_ATTEMPTS = previous;
      delete llm.retryDelayMs;
      warn.mockRestore();
      put.mockRestore();
    }
  });

  test('completed assessment survives notice failure and restart without another model call', async () => {
    const first = await memory.capture(context(app), principal(), {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, conversationId: 'notice-first', channel: 'api' },
    });
    await store.mutate(context(app), principal(), first.ids[0], (value) => ({
      ...value,
      checking: 'complete',
    }));
    const ctx = context(app, 'Doris'),
      p = principal('Doris');
    const second = await memory.capture(ctx, p, {
      situation: situation(fixture.second.text, [assertion(fixture.second.text)]),
      envelope: {
        userRequest: fixture.second.text,
        conversationId: 'notice-second',
        channel: 'api',
      },
    });
    await memory.attemptAssessment(ctx, p, second.facts[0], { evidence: [] });
    expect((await store.get(ctx, p, second.ids[0])).payload).toMatchObject({
      checking: 'complete',
      noticesPending: true,
    });
    const modelCalls = llm.generateStructured.mock.calls.length;
    const original = app.broker.call.bind(app.broker);
    let fail = true;
    const calls = jest.spyOn(app.broker, 'call').mockImplementation((name, ...args) => {
      if (name === 'notices.enqueueMemory' && fail) {
        fail = false;
        return Promise.reject(new Error('Synthetic notice outage'));
      }
      return original(name, ...args);
    });
    try {
      await memory.recover(app.workbench);
      const pending = (await store.get(ctx, p, second.ids[0])).payload;
      expect(pending).toMatchObject({
        checking: 'complete',
        noticesPending: true,
        noticeAttempts: 1,
      });
      expect(Date.parse(pending.nextNoticeAttemptAt)).toBeGreaterThan(Date.now());
      calls.mockClear();
      await memory.recover(app.workbench);
      expect(calls.mock.calls.filter(([name]) => name === 'notices.enqueueMemory')).toHaveLength(0);
      await store.mutate(ctx, p, second.ids[0], (value) => ({
        ...value,
        nextNoticeAttemptAt: new Date(0).toISOString(),
      }));
      await memory.recover(app.workbench);
      expect((await store.get(ctx, p, second.ids[0])).payload.noticesPending).toBe(false);
      for (const actorId of ['Charly', 'Doris']) {
        const notices = await app.call(
          'notices.list',
          { tenantId: p.tenantId, actorId },
          auth(actorId)
        );
        expect(notices.items.filter((item) => item.kind === 'memory')).toHaveLength(1);
      }
      await memory.recover(app.workbench);
      expect(llm.generateStructured).toHaveBeenCalledTimes(modelCalls);
    } finally {
      calls.mockRestore();
    }
  });

  test('recovery stops reading a backlog after collecting one configured batch', async () => {
    const p = principal();
    const docs = Array.from({ length: 1000 }, (_, i) => ({
      ns: store.namespace(p),
      payload: { id: `synthetic-${i}`, status: 'valid', checking: 'pending', recoveryPrincipal: p },
    }));
    const find = jest.fn().mockResolvedValue({ docs });
    const call = jest.fn().mockRejectedValue(new Error('Synthetic unavailable local store'));
    const service = {
      broker: { getLocalService: () => ({ db: { find } }), call },
      logger: { warn: jest.fn() },
    };
    await memory.recover(service);
    expect(find).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(memory.recoveryOptions().batchSize);
    expect(find.mock.calls[0][0].selector.$or).toHaveLength(2);
  });

  test.each(['missing', 'empty', 'duplicate', 'foreign'])(
    'JSON-only assessment rejects %s per-candidate effects',
    async (kind) => {
      const facts = [];
      for (const actor of ['Charly', 'Doris']) {
        const text = `Synthetische Planung Hauptstraße ${actor}`;
        facts.push(
          ...(
            await memory.capture(context(app, actor), principal(actor), {
              situation: situation(text, [assertion(text)]),
              envelope: { userRequest: text, conversationId: actor, channel: 'api' },
            })
          ).facts
        );
      }
      const base = llm.generateStructured.getMockImplementation();
      llm.generateStructured.mockImplementationOnce(async (schema, prompt) => {
        expect(schema.required).toContain('effects');
        const value = await base(schema, prompt);
        if (kind === 'missing') delete value.effects;
        if (kind === 'empty') value.effects = [];
        if (kind === 'duplicate') value.effects.push(value.effects[0]);
        if (kind === 'foreign') value.effects[0].candidateId = 'unknown-candidate';
        return value;
      });
      await expect(
        memory.attemptAssessment(context(app, 'Doris'), principal('Doris'), facts[1], {
          evidence: [],
        })
      ).rejects.toThrow('Invalid Workbench tenant memory judgment');
      expect(
        (await store.get(context(app, 'Doris'), principal('Doris'), facts[1].id)).payload.checking
      ).toBe('pending');
    }
  );

  test('unspoken object categories never split a shared anchor into invented variants', async () => {
    const facts = [];
    for (const [actor, qualifier] of [
      ['Charly', 'Leitung'],
      ['Doris', 'Netzgebiet'],
    ]) {
      const text = `Die ${qualifier} betrifft die Planung in der Hauptstraße ${actor}`;
      const captured = await memory.capture(context(app, actor), principal(actor), {
        situation: situation(text, [
          assertion(text, [{ value: 'Hauptstraße', qualifier, aliases: [] }]),
        ]),
        envelope: { userRequest: text, conversationId: actor, channel: 'api' },
      });
      expect(captured.facts[0].anchors[0].qualifier).toBe('');
      facts.push(...captured.facts);
    }
    expect(store.candidates(facts[1], facts)).toHaveLength(1);
    expect(
      (await memory.queryResponse(context(app), principal(), 'Hauptstraße')).statements
    ).toHaveLength(2);
  });

  test('a recovery assessment lasting more than a second completes with the same phase options as a turn', async () => {
    const ctx = context(app),
      p = principal();
    const captured = await memory.capture(ctx, p, {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: {
        userRequest: fixture.first.text,
        conversationId: 'slow-recovery',
        channel: 'api',
      },
    });
    await store.mutate(ctx, p, captured.ids[0], (value) => ({
      ...value,
      checkingEvidence: [{ source: 'synthetic', value: 'Synthetic rule' }],
    }));
    llm.generateStructured.mockImplementationOnce(async (_schema, _prompt, options) => {
      expect(options).toMatchObject(memory.assessmentOptions(p.tenantId));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return { effects: [], relations: [], plausibility: [] };
    });
    await memory.recover(app.workbench);
    expect((await store.get(ctx, p, captured.ids[0])).payload.checking).toBe('complete');
  });

  test('an omitted candidate judgment stays pending rather than falsely completing', async () => {
    const facts = [];
    for (const actor of ['Charly', 'Doris']) {
      const text = `Synthetische Planung Hauptstraße ${actor}`;
      facts.push(
        ...(
          await memory.capture(context(app, actor), principal(actor), {
            situation: situation(text, [assertion(text)]),
            envelope: { userRequest: text, conversationId: actor, channel: 'api' },
          })
        ).facts
      );
    }
    llm.generateStructured.mockResolvedValueOnce({ effects: [], relations: [], plausibility: [] });
    await expect(
      memory.attemptAssessment(context(app, 'Doris'), principal('Doris'), facts[1], {})
    ).rejects.toThrow('Invalid Workbench tenant memory judgment');
    expect(
      (await store.get(context(app, 'Doris'), principal('Doris'), facts[1].id)).payload
    ).toMatchObject({ checking: 'pending', attempts: 1 });
  });

  test('understanding repairs an ungrounded paraphrased basis once within the existing phase budget', async () => {
    const text = 'Synthetische Planung Hauptstraße beginnt spätestens 2030.';
    const valid = assertion(text);
    llm.generateStructured
      .mockResolvedValueOnce(
        situation(text, [{ ...valid, basis: 'Die Maßnahme wird im Zieljahr umgesetzt.' }])
      )
      .mockResolvedValueOnce(situation(text, [valid]));
    const result = await require('../src/workbench-understanding').understand({
      message: text,
      tenantId: 'tenant-a',
      logger: app.broker.logger,
    });
    expect(result.tenantMemory.assertions).toEqual([valid]);
    expect(llm.generateStructured).toHaveBeenCalledTimes(2);
    const secondPrompt = JSON.parse(llm.generateStructured.mock.calls[1][1]);
    expect(secondPrompt.repairInstruction).toContain('wörtliches Belegstück');
    expect(llm.generateStructured.mock.calls[1][2].timeoutMs).toBeLessThanOrEqual(
      llm.generateStructured.mock.calls[0][2].timeoutMs
    );
  });

  test('source rendering preserves configured functions and suppresses historical generated labels', () => {
    const fact = {
      person: {
        name: 'Synthetic person',
        functionLabel: 'Synthetische Planung',
        roles: ['ROLE_ALPHA'],
      },
      at: '2026-10-10T10:00:00.000Z',
    };
    expect(store.source(fact)).toContain('Synthetische Planung, 10.10.2026');
    const modelFunction = require('../src/function-model').getFunctionModel().functions[0];
    const historical = store.source({
      ...fact,
      person: { ...fact.person, functionLabel: modelFunction.displayLabel },
    });
    expect(historical).not.toContain(modelFunction.displayLabel);
    expect(historical).toContain('Funktion noch nicht in Klartext hinterlegt');
  });

  test('an unchanged mutation does not write or advance the object revision', async () => {
    const ctx = context(app),
      p = principal();
    const captured = await memory.capture(ctx, p, {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, conversationId: 'no-op', channel: 'api' },
    });
    const before = await store.get(ctx, p, captured.ids[0]);
    await store.mutate(ctx, p, captured.ids[0], (value) => ({ ...value }));
    expect((await store.get(ctx, p, captured.ids[0]))._rev).toBe(before._rev);
  });

  test('recovery processes at most its configured batch and disabled recovery creates no timer', async () => {
    const previousBatch = process.env.TENANT_MEMORY_RECOVERY_BATCH_SIZE;
    const previousEnabled = process.env.TENANT_MEMORY_RECOVERY;
    await memory.stopRecovery(app.workbench);
    for (let i = 0; i < 3; i++) {
      const text = `Synthetische Planung Hauptstraße Nummer ${i}`;
      await memory.capture(context(app), principal(), {
        situation: situation(text, [assertion(text)]),
        envelope: { userRequest: text, conversationId: `batch-${i}`, channel: 'api' },
      });
    }
    try {
      process.env.TENANT_MEMORY_RECOVERY_BATCH_SIZE = '1';
      app.workbench.tenantMemoryStopping = false;
      await memory.recover(app.workbench);
      const facts = await store.query(context(app), principal(), {
        'payload.type': 'tenant_memory_fact',
      });
      expect(facts.filter((fact) => fact.checking === 'complete')).toHaveLength(1);
      expect(facts.filter((fact) => fact.checking === 'pending')).toHaveLength(2);
      process.env.TENANT_MEMORY_RECOVERY = 'off';
      const service = {};
      memory.startRecovery(service);
      expect(service.tenantMemoryRecoveryTimer).toBeUndefined();
      expect(memory.recoveryOptions().intervalMs).toBe(30000);
      expect(memory.assessmentOptions('tenant-a')).toMatchObject({
        maxRetries: 1,
        transientRecovery: false,
      });
      expect(memory.assessmentOptions('tenant-a').timeoutMs).toBeGreaterThanOrEqual(15000);
    } finally {
      if (previousBatch === undefined) delete process.env.TENANT_MEMORY_RECOVERY_BATCH_SIZE;
      else process.env.TENANT_MEMORY_RECOVERY_BATCH_SIZE = previousBatch;
      if (previousEnabled === undefined) delete process.env.TENANT_MEMORY_RECOVERY;
      else process.env.TENANT_MEMORY_RECOVERY = previousEnabled;
    }
  });

  test('a pending background check cannot delay the info line at turn completion', async () => {
    const ctx = context(app),
      p = principal();
    const info = jest.spyOn(app.broker.logger, 'info');
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    memory.beforeTurn(ctx);
    const state = memory.start(app.workbench, ctx, p, {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, conversationId: 'pending-log', channel: 'api' },
      retrieval: gate,
    });
    memory.afterTurn(ctx, {});
    expect(info.mock.calls.filter(([label]) => label === 'Tenant memory')).toHaveLength(1);
    expect(info.mock.calls.find(([label]) => label === 'Tenant memory')[1]).toMatchObject({
      candidates: 1,
      tenantId: 'tenant-a',
    });
    release({ evidence: [] });
    await state.job;
    info.mockRestore();
  });

  test('normalized basis keeps inflections and shortened excerpts, but requires anchors and unchanged numbers', () => {
    const text =
      'Das Vorhaben Projekt-Q startet spätestens 2034. Alle Beteiligten werden informiert.';
    const item = assertion(text, [{ value: 'Projekt-Q', qualifier: '', aliases: [] }]);
    const inflected = assertion('Planung Projekt-Q beginnt', [
      { value: 'Projekt-Q', qualifier: '', aliases: [] },
    ]);
    expect(
      memory.acceptedAssertion(
        { ...inflected, basis: 'Planungen Projekt-Q beginnen' },
        inflected.text
      )
    ).toBe(true);
    expect(
      memory.acceptedAssertion(
        { ...item, basis: 'das vorhaben projekt q startet spätestens 2034' },
        text
      )
    ).toBe(true);
    expect(
      memory.acceptedAssertion(
        { ...item, basis: 'Das Vorhaben Projekt-Q startet spätestens 2030' },
        text
      )
    ).toBe(false);
    expect(
      memory.acceptedAssertion(
        { ...item, anchors: [{ value: 'Erfunden', qualifier: '', aliases: [] }] },
        text
      )
    ).toBe(false);
    expect(
      memory.acceptedAssertion(
        { ...item, basis: 'Projekt-Q bleibt aus anderen Gründen dauerhaft gesperrt.' },
        text
      )
    ).toBe(false);
  });

  test('long punctuation runs in anchor queries and qualified matching remain bounded', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Planung Projekt-Q Testbezirk';
    await memory.capture(ctx, p, {
      situation: situation(text, [
        assertion(text, [{ value: 'Projekt-Q', qualifier: 'Testbezirk', aliases: [] }]),
      ]),
      envelope: { userRequest: text, conversationId: 'long-anchor', channel: 'api' },
    });
    const noise = '.'.repeat(50000);
    const started = performance.now();
    expect(
      (
        await memory.preturn(ctx, p, {
          userRequest: `Was wissen wir insgesamt zur ${noise} Projekt-Q?`,
        })
      ).statements
    ).toHaveLength(1);
    expect((await memory.related(ctx, p, {}, `Plane ${noise} Projekt-Q.`)).evidence).toHaveLength(
      1
    );
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test('a sole qualified tenant anchor works bare; multiple variants require clarification in queries and work', async () => {
    const ctx = context(app),
      p = principal();
    const add = async (qualifier) => {
      const text = `Planung Hauptstraße (${qualifier}).`;
      return memory.capture(ctx, p, {
        situation: situation(text, [
          assertion(text, [{ value: 'Hauptstraße', qualifier, aliases: [] }]),
        ]),
        envelope: { userRequest: text, conversationId: qualifier, channel: 'api' },
      });
    };
    await add('A');
    expect((await memory.related(ctx, p, {}, 'Plane Hauptstraße.')).evidence).toHaveLength(1);
    expect(
      (await memory.queryResponse(ctx, p, 'Was wissen wir zur Hauptstraße?', {})).statements
    ).toHaveLength(1);
    const unqualified = await memory.capture(ctx, p, {
      situation: situation('Plan Hauptstraße', [assertion('Plan Hauptstraße')]),
      envelope: { userRequest: 'Plan Hauptstraße', conversationId: 'bare', channel: 'api' },
    });
    const facts = await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
    expect(store.candidates(unqualified.facts[0], facts)).toHaveLength(1);
    await add('B');
    const query = await memory.queryResponse(ctx, p, 'Was wissen wir zur Hauptstraße?', {});
    expect(query.statements).toHaveLength(0);
    expect(query.responseText).toContain('Welchen Bezug');
    expect((await memory.related(ctx, p, {}, 'Plane Hauptstraße.')).text).toContain(
      'Welchen Bezug'
    );
    expect(
      (await memory.queryResponse(ctx, p, '', { anchor: 'Hauptstraße (A)' })).statements.some(
        (fact) => fact.anchors.some((anchor) => anchor.qualifier === 'B')
      )
    ).toBe(false);
  });

  test('knowledge-classified statements are recorded with a sourced plausibility warning', async () => {
    const text = 'Wir sperren den Zugang an Projekt-Q.';
    const ctx = context(app),
      p = principal();
    const captured = await memory.capture(ctx, p, {
      situation: situation(
        text,
        [assertion(text, [{ value: 'Projekt-Q', qualifier: '', aliases: [] }])],
        { turnKind: 'knowledge' }
      ),
      envelope: { userRequest: text, channel: 'api', conversationId: 'plausibility' },
    });
    expect(captured.confirmation).toContain('Hab ich festgehalten:');
    llm.generateStructured.mockResolvedValue({
      effects: [],
      relations: [],
      plausibility: [{ reason: 'Das widerspricht der synthetischen Regel.', evidenceIds: ['K1'] }],
    });
    expect(
      (
        await memory.assess(ctx, p, captured.facts[0], {
          evidence: [{ source: 'Synthetische Regel', value: 'Der Zugang bleibt offen.' }],
        })
      ).join()
    ).toContain('Quelle: Synthetische Regel');
    expect((await store.get(ctx, p, captured.ids[0])).payload.status).toBe('valid');
  });

  test('one observation per turn reports decisions and assessment without contents or PII', async () => {
    const ctx = context(app),
      p = principal();
    const info = jest.spyOn(app.broker.logger, 'info');
    memory.beforeTurn(ctx);
    const text = 'Synthetische Planung Hauptstraße';
    const valid = assertion(text);
    const state = memory.start(app.workbench, ctx, p, {
      situation: situation(text, [
        valid,
        { ...valid, basis: 'Erfundener Beleg' },
        { ...valid, anchors: [] },
      ]),
      envelope: { userRequest: text, conversationId: 'logs', channel: 'api' },
      retrieval: Promise.resolve({ evidence: [] }),
    });
    await state.job;
    memory.afterTurn(ctx, {});
    await new Promise((resolve) => setImmediate(resolve));
    const logs = info.mock.calls.filter(([label]) => label === 'Tenant memory');
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({
      candidates: 3,
      accepted: 1,
      rejected: { basis_mismatch: 1, no_anchor: 1 },
      assessmentResult: 'no_candidates',
    });
    expect(JSON.stringify(logs)).not.toMatch(/Charly|Hauptstraße|Synthetische Planung/);
    memory.beforeTurn(ctx);
    await memory.capture(ctx, p, {
      situation: situation('Was gilt für Hauptstraße?', [valid], { turnKind: 'knowledge' }),
      envelope: { userRequest: 'Was gilt für Hauptstraße?' },
    });
    memory.afterTurn(ctx, {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      info.mock.calls.filter(([label]) => label === 'Tenant memory').at(-1)[1].rejected
    ).toEqual({ not_eligible: 1 });
    info.mockRestore();
  });

  test('delegated queries share the chat observation and cannot emit a second line', async () => {
    const ctx = context(app),
      info = jest.spyOn(app.broker.logger, 'info');
    memory.beforeTurn(ctx);
    const child = {
      ...ctx,
      meta: { ...ctx.meta },
      options: { parentCtx: { action: { name: 'workbench.chat' } } },
    };
    const original = ctx.meta.tenantMemoryObservation;
    memory.beforeTurn(child);
    expect(child.meta.tenantMemoryObservation).toBe(original);
    memory.afterTurn(child, {});
    memory.afterTurn(ctx, {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(info.mock.calls.filter(([label]) => label === 'Tenant memory')).toHaveLength(1);
    info.mockRestore();
  });

  test('public store writes and deletes cannot bypass source correction or erase audit', async () => {
    const text = fixture.first.text;
    const captured = await memory.capture(context(app), principal(), {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text, conversationId: 'protected', channel: 'api' },
    });
    const params = { namespace: store.namespace(principal()), key: captured.ids[0] };
    for (const actor of ['Charly', 'Doris']) {
      await expect(
        app.call(
          'object-store.put',
          { ...params, payload: { ...captured.facts[0], text: 'tampered' } },
          auth(actor)
        )
      ).rejects.toMatchObject({ code: 403 });
      await expect(app.call('object-store.delete', params, auth(actor))).rejects.toMatchObject({
        code: 403,
      });
    }
    expect(
      (await store.get(context(app), principal(), captured.ids[0])).payload.audit
    ).toHaveLength(1);
  });

  test('prefixes and other qualified locations do not supply remembered evidence', async () => {
    for (const anchor of [
      { value: 'ID-17', qualifier: '', aliases: [] },
      { value: 'Hauptstraße', qualifier: 'Nordstadt', aliases: ['Hauptstrasse'] },
    ]) {
      const text = `Plan für ${anchor.value} ${anchor.qualifier}.`;
      await memory.capture(context(app), principal(), {
        situation: situation(text, [assertion(text, [anchor])]),
        envelope: { userRequest: text, conversationId: text, channel: 'api' },
      });
    }
    for (const message of ['Bitte plane ID-1.', 'Bitte plane Hauptstraße (Südstadt).']) {
      expect((await memory.related(context(app), principal(), {}, message)).evidence).toHaveLength(
        0
      );
      expect(
        (
          await memory.queryResponse(context(app), principal(), message, {
            anchor: message.replace('Bitte plane ', ''),
          })
        ).statements
      ).toHaveLength(0);
    }
    expect(
      (await memory.related(context(app), principal(), {}, 'Plane Hauptstraße (Nordstadt).'))
        .evidence
    ).toHaveLength(1);
  });

  test.each([
    { text: '', basis: 'Plan', anchors: [{ value: 'X' }] },
    { text: 'Plan', basis: 'Plan', anchors: [] },
  ])('rejected extraction cannot suppress normal case assignment: %j', async (item) => {
    expect(memory.acceptedAssertion(item, 'Plan')).toBe(false);
    const capture = await memory.capture(context(app), principal(), {
      situation: situation('Plan', [item]),
      envelope: { userRequest: 'Plan', channel: 'api', conversationId: 'invalid' },
    });
    expect(capture.ids).toEqual([]);
    llm.generateStructured.mockResolvedValueOnce(situation('Plan', [item]));
    const reply = await app.call('workbench.chat', {
      userRequest: 'Plan',
      channel: 'api',
      conversationId: 'invalid-flow',
    });
    expect(reply.cetCaseId || reply.caseSelection || reply.state === 'case_selection').toBeTruthy();
  });

  test('stopping recovery bounds an unavailable local action and retains the pending fact', async () => {
    await memory.stopRecovery(app.workbench);
    const ctx = context(app),
      p = principal();
    const captured = await memory.capture(ctx, p, {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, conversationId: 'stopping', channel: 'api' },
    });
    const find = jest
      .fn()
      .mockResolvedValue({ docs: [{ ns: store.namespace(p), payload: captured.facts[0] }] });
    const call = jest.fn(() => new Promise(() => {}));
    const service = {
      broker: { getLocalService: () => ({ db: { find } }), call },
      logger: { warn: jest.fn() },
      tenantMemoryJobs: new Set(),
    };
    const previousTimeout = process.env.TENANT_MEMORY_TOOL_TIMEOUT_MS;
    process.env.TENANT_MEMORY_TOOL_TIMEOUT_MS = '50';
    service.tenantMemoryRecoveryJob = memory.recover(service);
    await new Promise((resolve) => setImmediate(resolve));
    const started = performance.now();
    await memory.stopRecovery(service);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(service.tenantMemoryRecovering).toBe(false);
    if (previousTimeout === undefined) delete process.env.TENANT_MEMORY_TOOL_TIMEOUT_MS;
    else process.env.TENANT_MEMORY_TOOL_TIMEOUT_MS = previousTimeout;
    expect(call).toHaveBeenCalledWith(
      'object-store.get',
      expect.any(Object),
      expect.objectContaining({ timeout: 50 })
    );
    expect((await store.get(ctx, p, captured.ids[0])).payload.checking).toBe('pending');
  });

  test('startup resumes persisted checks without another source turn and deduplicates notices', async () => {
    for (const item of [fixture.first, fixture.second])
      await memory.capture(context(app, item.actor), principal(item.actor), {
        situation: situation(item.text, [assertion(item.text)]),
        envelope: { userRequest: item.text, conversationId: item.actor, channel: 'api' },
      });
    const captured = await store.query(context(app), principal(), {
      'payload.type': 'tenant_memory_fact',
    });
    await memory.assess(context(app), principal(), captured[0], {});
    for (const fact of captured)
      await store.mutate(context(app), principal(), fact.id, (value) => ({
        ...value,
        checking: 'pending',
        relationIds: [],
      }));
    await app.broker.stop();
    const { ServiceBroker } = require('moleculer');
    const broker = new ServiceBroker({ logger: false, transporter: null });
    const workbench = broker.createService({
      ...require('../services/workbench.service'),
      settings: app.workbench.settings,
    });
    broker.createService({ ...ObjectStore, settings: { dbPath: path.join(app.dir, 'objects') } });
    broker.createService({
      ...Notices,
      settings: { ...Notices.settings, dbPath: path.join(app.dir, 'notices') },
    });
    try {
      await broker.start();
      await memory.recover(workbench);
      const restored = { ...app, broker };
      const facts = await store.query(context(restored), principal(), {
        'payload.type': 'tenant_memory_fact',
      });
      expect(
        facts.every((fact) => fact.checking === 'complete' && fact.relationIds.length === 1)
      ).toBe(true);
      await memory.recover(workbench);
      for (const actor of ['Charly', 'Doris']) {
        const notices = await broker.call(
          'notices.list',
          { tenantId: 'tenant-a', actorId: actor },
          { meta: auth(actor) }
        );
        expect(notices.items.filter((item) => item.kind === 'memory')).toHaveLength(1);
      }
    } finally {
      await broker.stop();
    }
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
      expect(b.responseText).toMatch(/\d{2}\.\d{2}\.\d{4}/);
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
      anchorKeys: [
        JSON.stringify(['common', '']),
        ...(i < 2 ? [JSON.stringify(['rare', ''])] : []),
      ],
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
    const add = (qualifier, conversationId) => {
      const message =
        qualifier && conversationId !== 'inferred-qualifier' ? `${text} (${qualifier})` : text;
      return memory.capture(ctx, p, {
        situation: situation(message, [
          assertion(message, [{ value: 'Hauptstraße', qualifier, aliases: [] }]),
        ]),
        envelope: { userRequest: message, channel: 'api', conversationId },
      });
    };
    expect((await add('', 'plain')).confirmation).toContain('Hab ich festgehalten');
    await add('A', 'a');
    await add('B', 'b');
    expect((await add('', 'ambiguous')).ambiguous).toMatch(/A oder B|B oder A/);
    expect((await add('A', 'inferred-qualifier')).ambiguous).toMatch(/A oder B|B oder A/);
  });

  test('AC-06/07: audited revocation, expiry, tenant and clearance isolation', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Planung für Bereich Q an der Hauptstraße.';
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

  test('a deferred relationship with cited knowledge is delivered once, separately from plausibility', async () => {
    const first = await memory.capture(context(app), principal(), {
      situation: situation(fixture.first.text, [assertion(fixture.first.text)]),
      envelope: { userRequest: fixture.first.text, channel: 'api', conversationId: 'cited-first' },
    });
    let release;
    let signalStarted;
    const started = new Promise((resolve) => {
      signalStarted = resolve;
    });
    llm.generateStructured.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
          signalStarted();
        })
    );
    const service = app.broker.getLocalService('workbench');
    const state = memory.start(service, context(app, 'Doris'), principal('Doris'), {
      situation: situation(fixture.second.text, [assertion(fixture.second.text)]),
      envelope: {
        userRequest: fixture.second.text,
        channel: 'api',
        conversationId: 'cited-second',
      },
      retrieval: Promise.resolve({
        evidence: [{ source: 'Synthetic guideline', value: 'Synthetic supporting information.' }],
      }),
    });
    await started;
    state.deferred = true;
    state.renderedConfirmation = true;
    release({
      effects: [
        {
          candidateId: first.ids[0],
          possibleConsequence: 'Synthetische Folge',
          affectedWork: 'Synthetische Planung',
          availabilityLimit: 'Synthetische Grenze',
        },
      ],
      relations: [
        {
          candidateId: first.ids[0],
          kind: 'gap',
          reason: fixture.reason,
          uncertainty: 0.2,
          evidenceIds: ['K1'],
          question: fixture.question,
        },
      ],
      plausibility: [],
    });
    await state.job;
    expect(
      (await store.get(context(app, 'Doris'), principal('Doris'), state.ids[0])).payload
        .plausibility
    ).toEqual([]);
    const notices = await app.call(
      'notices.list',
      { tenantId: 'tenant-a', actorId: 'Doris' },
      auth('Doris')
    );
    expect(notices.items).toHaveLength(1);
    expect(notices.items[0].text).toContain('Synthetic guideline');
    expect(notices.items[0].text).toContain(fixture.reason);
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
      const text = `Planung ${actor} Hauptstraße`;
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
      effects: [
        {
          candidateId: captured[0].id,
          possibleConsequence: 'Synthetische Folge',
          affectedWork: 'Synthetische Planung',
          availabilityLimit: 'Synthetische Grenze',
        },
      ],
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
      effects: [
        {
          candidateId: captured[0].id,
          possibleConsequence: 'Synthetische Folge',
          affectedWork: 'Synthetische Planung',
          availabilityLimit: 'Synthetische Grenze',
        },
      ],
      relations: [{ candidateId: captured[0].id, kind: 'invented', reason: 'Wrong' }],
      plausibility: [],
    });
    await expect(
      memory.assess(context(app, 'Doris'), principal('Doris'), captured[1], {})
    ).rejects.toThrow('Invalid Workbench tenant memory judgment');
    expect(
      await store.query(context(app), principal(), { 'payload.type': 'tenant_memory_relation' })
    ).toEqual([]);
  });

  test('direct object-store namespace operations enforce tenant and clearance, including Mango queries', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Synthetische Planung Hauptstraße';
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
    const text = 'Synthetische Planung Projekt-Q Hauptstraße';
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

  test('failed background judgment resumes from persisted facts without another content turn', async () => {
    const captured = [];
    for (const actor of ['Charly', 'Doris']) {
      const text = `Synthetische Planung ${actor} Hauptstraße`;
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
    await memory.recover(app.workbench);
    expect(
      (await store.get(context(app, 'Doris'), principal('Doris'), captured[1].id)).payload.checking
    ).toBe('complete');
    expect(
      (await app.call('notices.list', { tenantId: 'tenant-a', actorId: 'Charly' }, auth('Charly')))
        .block
    ).toContain('2030 bis 2034');
  });

  test('memory returned through the object-store collector is not an external plausibility rule', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Synthetische Planung Hauptstraße';
    const captured = await memory.capture(ctx, p, {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text },
    });
    llm.generateStructured.mockClear();
    expect(
      await memory.assess(ctx, p, captured.facts[0], {
        evidence: [{ source: 'tenant-memory', retrievalSource: 'object-store', value: text }],
      })
    ).toEqual([]);
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  test('AC-09: plausibility only with cited retrieved rule', async () => {
    const ctx = context(app),
      p = principal();
    const text = 'Wir sperren den gesamten Zugang in der Hauptstraße.';
    const captured = await memory.capture(ctx, p, {
      situation: situation(text, [assertion(text)]),
      envelope: { userRequest: text, channel: 'api', conversationId: 'rules' },
    });
    llm.generateStructured.mockResolvedValue({
      effects: [],
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
