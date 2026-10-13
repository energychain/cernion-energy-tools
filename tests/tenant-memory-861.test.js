'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { generateMemoryAnchorFixture } = require('../scripts/generate-memory-cleanup-fixture');
const memory = require('../src/tenant-memory');
const store = require('../src/tenant-memory-store');
const llm = require('../src/llm-client');
const presentation = require('../src/workbench-chat-presentation');
const { answer } = require('../src/workbench-understanding');

function situation(text, assertions = [], extra = {}) {
  return {
    concern: 'Gemeinsame Planung',
    situation: text,
    participants: [],
    identifiers: [],
    deadlines: [],
    hypotheses: [],
    missingInformation: [],
    retrievalTerms: [],
    turnKind: 'work',
    requestedAction: { description: '', externalEffect: false, draftRequested: false },
    tenantMemory: {
      assertions,
      correction: { kind: 'none', basis: '', factId: '' },
      query: { requested: false, anchor: '', functionLabel: '' },
    },
    ...extra,
  };
}
function assessment(raw) {
  const input = JSON.parse(raw);
  return {
    effects: input.candidates.map((item) => ({
      candidateId: item.id,
      possibleConsequence: 'Die gemeinsame Planung muss angepasst werden.',
      affectedWork: 'Weitere Arbeiten',
      availabilityLimit: 'Die Fristen passen nicht zusammen.',
    })),
    relations: input.candidates.map((item) => ({
      candidateId: item.id,
      kind: 'gap',
      reason: 'Die Fristen 2030 und 2034 müssen gemeinsam geprüft werden.',
      uncertainty: 0.2,
      evidenceIds: [],
      question: 'Wie werden die weiteren Arbeiten bis 2034 ermöglicht?',
    })),
    plausibility: [],
  };
}
describe('861 deterministic tenant memory acceptance', () => {
  let app, f;
  const principal = (actor, roles = ['ROLE_ALPHA']) => ({
    tenantId: 'tenant-a',
    actorId: actor,
    roles,
    clearance: [],
  });
  function ctx(p) {
    const meta = auth(p.actorId, p.roles, p.tenantId, p.clearance);
    return {
      broker: app.broker,
      params: {},
      meta,
      call: (name, params, options) =>
        app.broker.call(name, params, { meta: { ...meta, ...options?.meta } }),
    };
  }
  function input(item, extra = {}) {
    return {
      situation: situation(item.text, [item]),
      envelope: {
        userRequest: item.text,
        conversationId: item.text,
        channel: 'api',
      },
      ...extra,
    };
  }
  async function capture(item, actor = f.actorA, extra = {}) {
    const p = principal(actor);
    return memory.capture(ctx(p), p, input(item, extra));
  }
  beforeEach(async () => {
    jest.clearAllMocks();
    f = generateMemoryAnchorFixture();
    llm.generateStructured.mockImplementation(async (_schema, raw) => assessment(raw));
    app = await createCaseBroker();
    const objects = require('../services/object-store.service');
    const notices = require('../services/shared-service-notices.service');
    app.broker.createService({ ...objects, settings: { dbPath: path.join(app.dir, 'objects') } });
    app.broker.createService({
      ...notices,
      settings: { ...notices.settings, dbPath: path.join(app.dir, 'notices') },
    });
    app.broker.createService(require('../services/tenant-memory-policy.service'));
    await app.broker.start();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  test('scenario 1 / A.1: different subjects share their base, assess immediately, persist relation and notify first actor', async () => {
    await capture(f.first);
    const p = principal(f.actorB),
      context = ctx(p);
    const state = memory.start(
      app.workbench,
      context,
      p,
      input(f.second, { retrieval: Promise.resolve({ evidence: [] }) })
    );
    await state.job;
    expect(state.confirmation).toContain('Hab ich festgehalten');
    expect(state.paragraphs.join(' ')).toContain('2034');
    const saved = await store.byBase(context, p, f.base);
    expect(saved).toHaveLength(2);
    expect(saved.every((fact) => fact.anchors[0].value === f.base)).toBe(true);
    expect(saved.every((fact) => fact.relationIds.length === 1)).toBe(true);
    expect(
      await store.query(context, p, { 'payload.type': 'tenant_memory_relation' })
    ).toHaveLength(1);
    const notices = app.broker.getLocalService('notices');
    const queue = await notices.read(p.tenantId, f.actorA);
    expect(queue.queue.some((notice) => notice.kind === 'memory')).toBe(true);
    const delivered = await app.broker.call(
      'notices.completeTurn',
      {
        tenantId: p.tenantId,
        actorId: f.actorA,
        turnRef: 'next-synthetic-contact',
        fullQueue: true,
      },
      { meta: auth(f.actorA) }
    );
    expect(delivered.block).toContain('2030');
    expect(delivered.block).toContain('2034');
  });

  test('scenario 2 / A.2: each actor retrieves all variants by bare base, including a new bare statement', async () => {
    await capture(f.first);
    await capture(f.second, f.actorB);
    for (const actor of [f.actorA, f.actorB]) {
      const p = principal(actor);
      const result = await memory.queryResponse(ctx(p), p, f.query, {});
      expect(result.statements).toHaveLength(2);
      expect(result.responseText).toContain(f.textA);
      expect(result.responseText).toContain(f.textB);
    }
    const bare = await capture(f.assertion(`Weitere Arbeiten betreffen ${f.base}.`, f.base));
    expect(bare.confirmation).toContain('Hab ich festgehalten');
    const p = principal(f.actorA);
    expect((await memory.related(ctx(p), p, {}, f.query)).evidence).toHaveLength(3);
  });

  test('scenario 3 / A.1: syntax variants and configurable grammar canonicalize without a subject vocabulary', () => {
    for (const value of f.variants)
      expect(store.qualifiedAnchor({ value, aliases: [] }).value).toBe(f.base);
    expect(
      store.qualifiedAnchor({ value: `Gasleitung im ${f.base}`, aliases: [`Gasleitung ${f.base}`] })
    ).toMatchObject({ value: f.base, qualifier: 'Gasleitung', aliases: [f.base] });
    const previous = process.env.TENANT_MEMORY_ANCHOR_PREPOSITIONS;
    try {
      process.env.TENANT_MEMORY_ANCHOR_PREPOSITIONS = 'neben';
      expect(
        store.qualifiedAnchor({ value: `Prüfgegenstand neben einem ${f.base}` })
      ).toMatchObject({ value: f.base, qualifier: 'Prüfgegenstand' });
    } finally {
      if (previous === undefined) delete process.env.TENANT_MEMORY_ANCHOR_PREPOSITIONS;
      else process.env.TENANT_MEMORY_ANCHOR_PREPOSITIONS = previous;
    }
  });

  test('A.1 / A.3: multi-preposition and parenthesized anchors normalize idempotently', () => {
    for (const value of f.compoundVariants) {
      const canonical = store.qualifiedAnchor({ value, aliases: [value] });
      expect(canonical.value).toBe(f.base);
      expect(store.qualifiedAnchor(canonical)).toEqual(canonical);
      expect(store.anchorKeys({ value, aliases: [value] })).toEqual(store.anchorKeys(canonical));
    }
    expect(store.qualifiedAnchor({ value: f.compoundVariants[1] }).qualifier).toBe('Prüfvariante');
  });

  test('scenario 4 / K: an explicit qualifier keeps its variant and unqualified facts, excludes others', async () => {
    await capture(f.first);
    await capture(f.second, f.actorB);
    await capture(f.assertion(`Weitere Arbeiten betreffen ${f.base}.`, f.base));
    const p = principal(f.actorA);
    for (const query of [`Was wissen wir zur Gasleitung im ${f.base}?`, `${f.base} (Gasleitung)`]) {
      const result = await memory.queryResponse(ctx(p), p, query, {});
      expect(result.statements).toHaveLength(2);
      expect(result.statements.some((fact) => fact.text === f.textA)).toBe(false);
    }
    expect(
      (await memory.queryResponse(ctx(p), p, `${f.base} (Unbekannt)`, {})).statements
    ).toHaveLength(1);
  });

  test('K: original question keeps its qualifier with a bare extraction; unknown and invented qualifiers are safe', async () => {
    await capture(f.first);
    await capture(f.second, f.actorB);
    await capture(f.assertion(`Weitere Arbeiten betreffen ${f.base}.`, f.base));
    const p = principal(f.actorA),
      context = ctx(p);
    const filtered = await memory.queryResponse(
      context,
      p,
      `Was wissen wir zur Gasleitung im ${f.base}?`,
      { anchor: f.base }
    );
    expect(filtered.statements).toHaveLength(2);
    expect(filtered.statements.some((fact) => fact.text === f.textA)).toBe(false);
    const unknown = await memory.preturn(
      context,
      p,
      { userRequest: `Was wissen wir zum Prüfgegenstand im ${f.base}?` },
      null
    );
    expect(unknown.statements).toHaveLength(1);
    expect(unknown.statements[0].anchors[0].qualifier).toBe('');
    const invented = await memory.queryResponse(context, p, f.query, {
      anchor: `${f.base} (Gasleitung)`,
    });
    expect(invented.statements).toHaveLength(3);
  });

  test('scenario 5 / A.3: authorized migration is audited, tenant scoped, idempotent and rechecks new collisions', async () => {
    const actors = [f.actorA, f.actorB],
      items = [f.first, f.second];
    for (let index = 0; index < items.length; index++) {
      const p = principal(actors[index]);
      const captured = (await capture(items[index], actors[index])).facts[0];
      await store.mutate(ctx(p), p, captured.id, (fact) => ({
        ...fact,
        anchors: items[index].anchors,
        anchorKeys: [JSON.stringify([store.normalizeAnchor(items[index].anchors[0].value), ''])],
        checking: 'complete',
        person: { ...fact.person, functionLabel: f.internalFunction },
      }));
    }
    const p = principal(f.actorA, ['ROLE_TENANT_ADMIN']),
      context = ctx(p);
    await expect(
      ctx(principal(f.actorB)).call('tenant-memory-policy.migrateAnchors', {
        reason: 'Synthetische Prüfung',
      })
    ).rejects.toThrow(/administrator/i);
    const result = await context.call('tenant-memory-policy.migrateAnchors', {
      reason: 'Synthetische Prüfung',
    });
    expect(result).toEqual({
      migration: 'anchor-canonical-v2',
      scanned: 2,
      changed: 2,
      requeued: 2,
    });
    const facts = await store.byBase(context, p, f.base);
    expect(facts).toHaveLength(2);
    expect(
      facts.every(
        (fact) =>
          fact.person.functionLabel === '' &&
          fact.checking === 'pending' &&
          fact.audit.some((entry) => entry.kind === 'anchors_migrated')
      )
    ).toBe(true);
    await memory.recover(app.workbench);
    const relations = await store.query(context, p, { 'payload.type': 'tenant_memory_relation' });
    expect(relations).toHaveLength(1);
    const before = await store.query(context, p, { 'payload.type': 'tenant_memory_fact' });
    expect(
      await context.call('tenant-memory-policy.migrateAnchors', {
        reason: 'Wiederholte synthetische Prüfung',
      })
    ).toEqual({ ...result, changed: 0, requeued: 0 });
    expect(await store.query(context, p, { 'payload.type': 'tenant_memory_fact' })).toEqual(before);
    const audits = await store.query(context, p, {
      'payload.type': 'tenant_memory_audit',
      'payload.kind': 'admin_migrate_anchors',
    });
    expect(audits).toHaveLength(2);
    await expect(
      context.call('object-store.put', {
        namespace: store.namespace(p),
        key: 'unauthorized',
        payload: {},
      })
    ).rejects.toThrow();
    const other = { ...p, tenantId: 'tenant-b' };
    expect(
      (
        await ctx(other).call('tenant-memory-policy.migrateAnchors', {
          reason: 'Anderer synthetischer Tenant',
        })
      ).scanned
    ).toBe(0);
  });

  test('scenario 6 / A.1: stubborn compound extraction is corrected on write and readable through base', async () => {
    const saved = await capture(f.second);
    expect(saved.facts[0].anchors[0]).toMatchObject({ value: f.base, qualifier: 'Gasleitung' });
    const p = principal(f.actorA);
    expect((await store.byBase(ctx(p), p, f.base)).map((fact) => fact.id)).toContain(saved.ids[0]);
    expect(saved.confirmation).toContain('Hab ich festgehalten');
  });

  test.each(['write', 'read'])(
    'scenario 7 / A.4: %s failure never confirms recording',
    async (failure) => {
      const p = principal(f.actorA),
        context = ctx(p),
        call = context.call;
      context.call = (name, params, options) => {
        if (failure === 'write' && name === 'object-store.put')
          return Promise.reject(new Error('Synthetic write failure'));
        if (
          failure === 'read' &&
          name === 'object-store.query' &&
          params.selector['payload.anchorKeys']
        )
          return Promise.resolve({ docs: [] });
        return call(name, params, options);
      };
      const state = memory.start(app.workbench, context, p, input(f.second));
      await state.job;
      expect(state.confirmation).not.toContain('Hab ich festgehalten');
      expect(state.confirmation).toMatch(/nicht bestätigen|nicht lesbar/);
      expect(state.ids).toEqual([]);
    }
  );

  test('scenario 8 / B: internal labels disappear; mapped German function and display name survive', async () => {
    const result = await capture(f.first, f.actorA, {
      situation: situation(f.textA, [f.first], { actorContext: { role: f.internalFunction } }),
    });
    expect(result.facts[0].person.functionLabel).toBe('');
    expect(store.humanFunctionLabel(f.internalFunction.split(' (')[0])).toBe('');
    expect(store.source(result.facts[0])).not.toContain('Funktion nicht angegeben');
    expect(store.source(result.facts[0])).not.toContain(f.internalFunction);
    const mapped = await capture(f.second, f.actorB, {
      mapping: { displayName: f.actorB, functionLabel: 'Koordination' },
    });
    expect(store.source(mapped.facts[0])).toContain('Koordination');
  });

  test('scenario 9 / C: duplicate source excerpts are stored and rendered once, with a bounded excerpt', async () => {
    const p = principal(f.actorA),
      context = ctx(p);
    const fact = (await capture(f.first)).facts[0];
    llm.generateStructured.mockResolvedValue({
      effects: [],
      relations: [],
      plausibility: [
        { reason: 'Die Frist muss geprüft werden.', evidenceIds: ['K1'] },
        { reason: 'Die Frist muss geprüft werden.', evidenceIds: ['K1'] },
      ],
    });
    const hit = {
      source: 'synthetic-rule',
      value: f.rule,
      metadata: { sourceId: 'synthetic-rule' },
    };
    await memory.assess(context, p, fact, {
      evidence: [
        hit,
        {
          ...hit,
          id: 'duplicate-transport-id',
          metadata: { ...hit.metadata, sourceId: 'different-transport-id' },
        },
      ],
    });
    const saved = (await store.get(context, p, fact.id)).payload;
    expect(saved.checkingEvidence).toHaveLength(1);
    expect(saved.checkingEvidence[0].value.length).toBeLessThanOrEqual(601);
    expect(saved.plausibility).toHaveLength(1);
    expect(saved.plausibility[0].split('Synthetische Regel:')).toHaveLength(2);
    expect(store.compactEvidence(saved.checkingEvidence)).toEqual(saved.checkingEvidence);
  });

  test('scenario 10 / D.1: foreign multi-line signature and combined placeholder use mapped questioner', () => {
    const name = presentation.mappedDisplayName(
      { displayName: f.actorA },
      { apiToken: { name: f.foreignName } }
    );
    for (const draft of [
      `${f.draft}\n\n${f.signature}`,
      `${f.draft}\n\nMit freundlichen Grüßen\n${f.signaturePlaceholder}`,
    ]) {
      const rendered = presentation.completeDraft(draft, name);
      expect(rendered).toMatch(new RegExp(`Mit freundlichen Grüßen\\n${name}$`));
      expect(rendered).not.toContain(f.foreignName);
      expect(rendered).not.toContain('Fremdes Testteam');
      expect(rendered).not.toContain('Ihr Name');
    }
  });

  test('scenario 11 / D.2: a completed, unambiguous measured answer needs no date or area follow-up', async () => {
    const message = f.peakQuestion;
    const value = f.peakAnswer;
    const hit = {
      source: 'dataset.query',
      retrievalSource: 'capability-read',
      value,
      metadata: { datasetId: 'synthetic-profile', tenantId: 'tenant-a' },
    };
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        interpretation: [
          {
            text: value,
            evidenceIds: ['E1'],
            origin: 'evidence',
            supported: 'evidence',
            specific: true,
            completedAction: false,
          },
        ],
        expectation: [],
        nextSteps: [],
        draft: [],
        assumptions: [],
      })
    );
    const request = {
      situation: situation(message, [], {
        turnKind: 'knowledge',
        outputKind: 'analysis',
        missingInformation: [
          {
            key: 'scope',
            reason: 'ambiguity',
            decisive: true,
            question: f.scopeQuestion,
          },
        ],
      }),
      message,
      tenantId: 'tenant-a',
      retrieval: { evidence: [hit], toolTrace: [] },
    };
    const reply = await answer(request);
    expect(reply.questions).toEqual([]);
    expect(reply.responseText).toContain('42 kW');
    expect(reply.responseText).not.toContain('Welchen Zeitraum');
    const ambiguous = await answer({
      ...request,
      retrieval: {
        evidence: [
          hit,
          { ...hit, metadata: { ...hit.metadata, datasetId: 'another-synthetic-profile' } },
        ],
        toolTrace: [],
      },
    });
    expect(ambiguous.questions).toHaveLength(1);
    const incomplete = await answer({
      ...request,
      retrieval: {
        evidence: [{ ...hit, value: 'Der höchste Wert beträgt 42 kW.' }],
        toolTrace: [],
      },
    });
    expect(incomplete.questions).toHaveLength(1);
  });
});
