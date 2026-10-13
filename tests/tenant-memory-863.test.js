'use strict';
jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { generateMemoryAnchorFixture } = require('../scripts/generate-memory-cleanup-fixture');
const memory = require('../src/tenant-memory');
const store = require('../src/tenant-memory-store');
const llm = require('../src/llm-client');
const tools = require('../src/workbench-tool-answer');
const loop = require('../src/workbench-capability-loop');
const presentation = require('../src/workbench-chat-presentation');
describe('863 grounded anchor and correspondence acceptance', () => {
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
  function input(item) {
    return {
      situation: { turnKind: 'work', requestedAction: {}, tenantMemory: { assertions: [item] } },
      envelope: { userRequest: item.text, conversationId: item.text, channel: 'api' },
    };
  }
  async function capture(item, actor = f.actorA) {
    const p = principal(actor);
    return memory.capture(context(p), p, input(item));
  }
  beforeEach(async () => {
    jest.clearAllMocks();
    f = generateMemoryAnchorFixture();
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
          possibleConsequence: 'Gemeinsame Planung prüfen.',
          affectedWork: 'Weitere Arbeiten',
          availabilityLimit: 'Unterschiedliche Fristen.',
        })),
        relations: data.candidates.map((candidate) => ({
          candidateId: candidate.id,
          kind: 'gap',
          reason: 'Die Fristen 2030 und 2034 müssen abgestimmt werden.',
          uncertainty: 0.2,
          evidenceIds: [],
          question: 'Wie werden die weiteren Arbeiten ermöglicht?',
        })),
        plausibility: [],
      };
    });
    await app.broker.start();
  });
  afterEach(async () => app.cleanup());
  test('scenario 1 / A.1: subject-only extraction is completed from literal basis', async () => {
    const saved = await capture(f.incomplete);
    expect(saved.facts[0].anchors).toEqual([
      { value: f.base, qualifier: 'Gasleitung', aliases: [] },
    ]);
    expect(saved.confirmation).toContain('Hab ich festgehalten');
    expect(store.groundedAnchors(saved.facts[0].anchors, f.textB)).toEqual(saved.facts[0].anchors);
  });
  test('scenario 2 / A.2: omitted anchors are recovered independently of extraction', async () => {
    const saved = await capture(f.omitted);
    expect(saved.facts[0].anchors).toEqual([{ value: f.base, qualifier: '', aliases: [] }]);
    expect(saved.confirmation).toContain('Hab ich festgehalten');
    const malformed = {
      ...f.first,
      anchors: [{ value: f.base.replace(/[a-f]+$/u, ''), qualifier: 'Stromnetz', aliases: [] }],
    };
    const repaired = await capture(malformed, f.actorB);
    expect(repaired.facts[0].anchors).toEqual([{ value: f.base, qualifier: '', aliases: [] }]);
  });
  test('A.1: reversed qualifiers and shortened aliases are completed from the literal basis', async () => {
    const reversed = {
      ...f.incomplete,
      anchors: [{ value: 'Gasleitung', qualifier: f.base, aliases: [] }],
    };
    expect((await capture(reversed)).facts[0].anchors).toEqual([
      { value: f.base, qualifier: 'Gasleitung', aliases: [] },
    ]);
    const shortened = {
      ...f.first,
      anchors: [
        { value: f.base.replace(/[a-f]+$/u, ''), qualifier: 'Stromnetz', aliases: [f.base] },
      ],
    };
    expect((await capture(shortened, f.actorB)).facts[0].anchors[0]).toMatchObject({
      value: f.base,
      qualifier: 'Stromnetz',
    });
  });
  test('scenario 3: incomplete extraction still relates, notifies and lists both actors', async () => {
    await capture(f.first);
    const p = principal(f.actorB),
      ctx = context(p);
    const state = memory.start(app.workbench, ctx, p, {
      ...input(f.incomplete),
      retrieval: Promise.resolve({ evidence: [] }),
    });
    await state.job;
    expect(state.paragraphs.join(' ')).toContain('2034');
    expect((await store.byBase(ctx, p, f.base)).every((fact) => fact.relationIds.length)).toBe(
      true
    );
    const notices = app.broker.getLocalService('notices');
    expect(
      (await notices.read(p.tenantId, f.actorA)).queue.some((item) => item.kind === 'memory')
    ).toBe(true);
    const delivered = await app.broker.call(
      'notices.completeTurn',
      { tenantId: p.tenantId, actorId: f.actorA, turnRef: f.base, fullQueue: true },
      { meta: auth(f.actorA) }
    );
    expect(delivered.block).toContain('2030');
    for (const actor of [f.actorA, f.actorB])
      expect(
        (await memory.queryResponse(context(principal(actor)), principal(actor), f.query, {}))
          .statements
      ).toHaveLength(2);
  });
  test('scenario 4: sentence starts, common abstractions and repeated subject are not reference anchors', () => {
    expect(store.referenceAnchors(f.generic)).toEqual([]);
    for (const text of f.genericVariants) expect(store.referenceAnchors(text)).toEqual([]);
  });
  test('scenario 5: digit and alphanumeric identifiers are basis anchors', async () => {
    const text = `Weitere Arbeiten an der Marktlokation ${f.identifier} sind begrenzt.`;
    const item = { ...f.assertion(text, 'Marktlokation'), anchors: [] };
    const result = await capture(item);
    expect(result.facts[0].anchors[0].value).toBe(f.identifier);
    expect(store.referenceAnchors(`Weitere Arbeiten an ${f.base}-42 sind begrenzt.`)[0].value).toBe(
      `${f.base}-42`
    );
  });
  test('scenario 6 / A.4: v2 migrates only through audited policy, requeues new collision and is idempotent', async () => {
    const first = await capture(f.first),
      second = await capture(f.incomplete, f.actorB);
    const p = principal(f.actorA, ['ROLE_ALPHA', 'ROLE_TENANT_ADMIN']),
      ctx = context(p);
    // Synthetic legacy state via the same protected store capability used by policy.
    await store.mutate(ctx, p, second.ids[0], (fact) => ({
      ...fact,
      anchors: [{ value: 'Gasleitung', qualifier: '', aliases: [] }],
      anchorKeys: store.anchorKeys({ value: 'Gasleitung' }),
      checking: 'complete',
    }));
    const result = await ctx.call('tenant-memory-policy.migrateAnchors', {
      reason: 'Synthetische v2-Abnahme',
    });
    expect(result).toEqual({
      migration: 'anchor-canonical-v3',
      scanned: 2,
      changed: 1,
      requeued: 2,
    });
    expect((await store.get(ctx, p, second.ids[0])).payload.audit.at(-1)).toMatchObject({
      kind: 'anchors_migrated',
      migration: 'anchor-canonical-v3',
    });
    expect((await store.get(ctx, p, first.ids[0])).payload.checking).toBe('pending');
    await memory.recover(app.workbench);
    expect((await store.get(ctx, p, second.ids[0])).payload.relationIds).toHaveLength(1);
    const before = await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
    expect(
      await ctx.call('tenant-memory-policy.migrateAnchors', { reason: 'Synthetische Wiederholung' })
    ).toEqual({ ...result, changed: 0, requeued: 0 });
    expect(await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' })).toEqual(before);
    await expect(
      ctx.call('object-store.put', { namespace: store.namespace(p), key: f.base, payload: {} })
    ).rejects.toThrow();
    await expect(
      context(principal(f.actorB)).call('tenant-memory-policy.migrateAnchors', {
        reason: 'Keine Admin-Rolle',
      })
    ).rejects.toThrow();
  });
  test('scenario 7 / A.3: every reference must be readable even if another anchor is readable', async () => {
    const p = principal(f.actorA),
      ctx = context(p),
      call = ctx.call;
    const item = f.assertion(
      `Weitere Arbeiten im ${f.base} und am ${f.otherBase} sind begrenzt.`,
      f.base
    );
    ctx.call = (name, params, options) =>
      name === 'object-store.query' &&
      params.selector['payload.anchorKeys']?.$elemMatch?.$gte.includes(
        store.normalizeAnchor(f.otherBase)
      )
        ? Promise.resolve({ docs: [] })
        : call(name, params, options);
    const state = memory.start(app.workbench, ctx, p, input(item));
    await state.job;
    expect(state.confirmation).not.toContain('Hab ich festgehalten');
    expect(state.confirmation).toContain('nicht bestätigen');
  });
  test('scenario 8 / B: mail and subsequent next-step never infer reads, even with invented data need or cached table', () => {
    const situation = {
      dataNeeds: 'Kennung nachsehen',
      hypotheses: [],
      timeline: [{ summary: f.mail }],
      outputKind: 'analysis',
    };
    for (const message of [f.mail, f.nextQuestion]) {
      const need = loop.resolveCapabilityNeed(situation, message, {
        previous: situation,
        datasetCandidates: [{ id: f.base }],
      });
      expect(need).toMatchObject({
        reason: 'no_data_need',
        candidates: [],
        situation: { dataNeeds: '' },
      });
      expect(loop.allowsDataRead(situation, message, situation)).toBe(false);
    }
    expect(llm.generateChat).not.toHaveBeenCalled();
  });
  test('scenario 8 / B.1: identifiers never supply extrema, but measures still do', () => {
    const hit = (field, extra = {}) => ({
      retrievalSource: 'capability-read',
      source: 'synthetic',
      value: JSON.stringify({ count: 1 }),
      metadata: {
        statistics: [
          {
            field,
            max: Number(f.identifier),
            min: Number(f.identifier),
            maxRow: {},
            minRow: {},
            ...extra,
          },
        ],
      },
    });
    for (const field of f.identifierFields)
      expect(tools.availableToolAnswer([hit(field)], 'Größter Wert')).not.toContain(
        'erfasste Wert'
      );
    expect(
      tools.availableToolAnswer([hit('record', { semanticRole: 'identifier' })])
    ).not.toContain('erfasste Wert');
    expect(tools.availableToolAnswer([hit('capacityKW', { max: 42 })])).toContain('42 kW');
  });
  test('scenario 8 / B.2: full mail and follow-up turns never call the dataset catalog or executor', async () => {
    const queried = jest.fn(() => {
      throw new Error('Unexpected synthetic dataset query');
    });
    const catalog = jest.fn(() => []);
    app.broker.createService({
      name: 'dataset',
      actions: { query: queried, turn: () => ({ handled: false }) },
    });
    app.broker.createService({ name: 'datapoint', actions: { datasetCatalog: catalog } });
    await app.broker.start();
    llm.generateStructured.mockResolvedValue({
      concern: 'Weitere Arbeiten',
      situation: 'Der Verlauf benötigt Abstimmung.',
      participants: [],
      identifiers: [],
      deadlines: [],
      hypotheses: [],
      missingInformation: [],
      retrievalTerms: [],
      turnKind: 'work',
      outputKind: 'analysis',
      conversationShape: 'task',
      followupKind: 'next_step',
      dataNeeds: 'Kennung nachsehen',
      requestedAction: { description: '', draftRequested: false, externalEffect: false },
      tenantMemory: {
        assertions: [],
        correction: { kind: 'none', basis: '', factId: '' },
        query: { requested: false, anchor: '', functionLabel: '' },
      },
    });
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        interpretation: [
          {
            text: 'Die nächsten Arbeiten müssen abgestimmt werden.',
            origin: 'input',
            supported: 'model',
            evidenceIds: [],
            specific: false,
            completedAction: false,
          },
        ],
        expectation: [],
        nextSteps: [],
        assumptions: [],
        draft: [],
      })
    );
    const meta = auth(f.actorB);
    for (const userRequest of [f.mail, f.nextQuestion]) {
      const reply = await app.broker.call(
        'workbench.chat',
        { userRequest, channel: 'api', conversationId: f.base },
        { meta, timeout: 30000 }
      );
      expect(reply.responseText).not.toMatch(
        /Abgefragte Datenquelle|größte erfasste Wert|vorhandene Abfrage/u
      );
    }
    expect(catalog).not.toHaveBeenCalled();
    expect(queried).not.toHaveBeenCalled();
    expect(llm.generateChat).not.toHaveBeenCalled();
  });
  test('scenario 9: explicit measured data questions remain eligible, including within correspondence', () => {
    expect(loop.allowsDataRead({ outputKind: 'correspondence' }, f.peakQuestion)).toBe(true);
    expect(loop.allowsDataRead({}, f.measureQuestion)).toBe(true);
    expect(
      tools.availableToolAnswer(
        [{ source: 'dataset.query', retrievalSource: 'capability-read', value: f.peakAnswer }],
        f.peakQuestion
      )
    ).toBe(f.peakAnswer);
  });
  test('scenario 10 / C: mapped questioner signs empty, foreign and placeholder greetings', () => {
    const name = presentation.mappedDisplayName({ actorId: f.actorB, displayName: f.actorB });
    for (const ending of [
      f.greeting,
      `${f.greeting}\n`,
      `${f.shortGreeting},`,
      f.signature,
      `${f.greeting}\n${f.signaturePlaceholder}`,
    ]) {
      const draft = presentation.completeDraft(`${f.draft}\n\n${ending}`, name);
      expect(draft.trim()).toMatch(new RegExp(`${f.actorB}$`));
      expect(draft).not.toContain(f.foreignName);
    }
    expect(presentation.mappedDisplayName({ actorId: f.actorB })).toBe(f.actorB);
  });
});
