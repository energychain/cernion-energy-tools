'use strict';

// Pack "wissen" (Unternehmenswissen), Phase 1 expanders. All records below are SYNTHETIC TEST
// DATA: invented tenants, roles, matrices, governance items and documents.

const { ServiceBroker } = require('moleculer');

const TENANT = 'tenant-test-wissen';
const FOREIGN = 'tenant-test-foreign';
const meta = { tenantId: TENANT };
const calls = [];
const state = { slowKnowledge: false, knowledgeStatus: 'available', timers: [] };

const matrices = [
  {
    id: 'mx-test-1',
    tenantId: TENANT,
    name: 'Testmatrix Netzanschluss',
    status: 'active',
    tasks: [
      {
        taskId: 'task-a',
        taskName: 'Formale Antragsprüfung (Test)',
        verantwortlich: [{ actorType: 'role', actorId: 'TEST_GATEKEEPER' }],
        durchfuehrend: [{ actorType: 'role', actorId: 'TEST_SACHBEARBEITUNG' }],
        evidenceRequirements: [
          { id: 'ev-1', label: 'Testrichtlinie Anschlussprüfung', type: 'document' },
          { id: 'ev-2', label: 'Testdatenblatt', type: 'datasheet' },
        ],
      },
    ],
  },
  // A foreign tenant's record must never surface, even if a source returned it.
  {
    id: 'mx-foreign',
    tenantId: FOREIGN,
    name: 'Fremde Matrix',
    tasks: [
      {
        taskId: 'task-x',
        taskName: 'Fremde Aufgabe',
        verantwortlich: [{ actorType: 'role', actorId: 'TEST_GATEKEEPER' }],
        evidenceRequirements: [{ label: 'Testrichtlinie Anschlussprüfung', type: 'document' }],
      },
    ],
  },
];

const cards = [
  {
    cardId: 'card-test-1',
    tenantId: TENANT,
    title: 'Testvorgang Prüfprozess',
    ownerRole: 'TEST_GATEKEEPER',
    status: 'open',
    deadline: '2026-12-15',
    evidenceRefs: [{ evidenceId: 'ev-1', label: 'Testrichtlinie Anschlussprüfung' }],
  },
  {
    cardId: 'card-test-2',
    tenantId: TENANT,
    title: 'Abgeschlossener Testbeschluss',
    ownerRole: 'TEST_GATEKEEPER',
    status: 'closed',
    closureRationale: 'Testbeschluss gefasst',
    evidenceRefs: [],
  },
  { cardId: 'card-foreign', tenantId: FOREIGN, title: 'Fremd', ownerRole: 'TEST_GATEKEEPER' },
];

const knowledgeHits = [
  {
    source: 'knowledge-rag',
    value:
      'Die Rolle TEST_GATEKEEPER prüft eingehende Anträge formal und gibt sie frei. · Dokumenttyp: policy · Score: 0.812',
    retrievalSource: 'knowledge-rag',
    metadata: { hitId: 'doc-test-1', documentTitle: 'Testrichtlinie Anschlussprüfung' },
  },
];

function stubs() {
  const record = (ctx) =>
    calls.push({ action: ctx.action.name, meta: { ...ctx.meta }, params: ctx.params });
  return [
    {
      name: 'vdmi',
      actions: {
        list(ctx) {
          record(ctx);
          return { success: true, items: matrices };
        },
        create() {
          throw new Error('write action must not be called');
        },
      },
    },
    {
      name: 'governance-cards',
      actions: {
        listCards(ctx) {
          record(ctx);
          return { items: cards };
        },
        createCard() {
          throw new Error('write action must not be called');
        },
      },
    },
    {
      name: 'knowledge-gateway',
      actions: {
        search() {
          throw new Error('knowledge-gateway.search writes citations and must not be called');
        },
      },
    },
    {
      name: 'personal-agent',
      actions: {
        async collectWorkbenchEvidence(ctx) {
          record(ctx);
          if (state.slowKnowledge)
            await new Promise((resolve) => state.timers.push(setTimeout(resolve, 2000)));
          const query = ctx.params.situation.concern;
          const hits =
            state.knowledgeStatus === 'available' &&
            /gatekeeper|anschlussprüfung|antr/iu.test(query)
              ? knowledgeHits
              : [];
          return {
            evidence: hits,
            trace: [
              {
                source: 'knowledge-rag',
                status:
                  state.knowledgeStatus === 'available' && !hits.length
                    ? 'missing'
                    : state.knowledgeStatus,
              },
            ],
          };
        },
      },
    },
  ];
}

describe('micro-agent pack wissen', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    for (const schema of stubs()) broker.createService(schema);
    broker.createService(require('../services/micro-agent-wissen.service'));
    await broker.start();
  });
  afterAll(async () => {
    state.timers.forEach(clearTimeout);
    await broker.stop();
  });
  beforeEach(() => {
    calls.length = 0;
    state.slowKnowledge = false;
    state.knowledgeStatus = 'available';
  });

  const expand = (object, context = { tenantId: TENANT }, options = {}) =>
    broker.call(
      'micro-agent.wissen.expand',
      { object, context, ...(options.budget ? { budget: options.budget } : {}) },
      { meta: options.meta || meta }
    );

  test('describe lists the declared kinds and the concern', async () => {
    const manifest = await broker.call('micro-agent.wissen.describe');
    expect(manifest.expands).toEqual(
      expect.arrayContaining(['org.role', 'org.document', 'concern'])
    );
    expect(manifest.concern).toBe(true);
  });

  test('a role yields matrix tasks, owned items with their deadline and naming documents', async () => {
    const finding = await expand({ kind: 'org.role', value: 'Test Gatekeeper' });
    expect(finding.failed).toBeUndefined();
    const sources = finding.facts.map((fact) => fact.provenance.source);
    expect(sources).toEqual(
      expect.arrayContaining([
        'vdmi.list',
        'governance-cards.listCards',
        'personal-agent.collectWorkbenchEvidence:knowledge-rag',
      ])
    );
    expect(finding.facts.every((fact) => fact.provenance.source && fact.basis === 'source')).toBe(
      true
    );
    const task = finding.facts.find((fact) => fact.provenance.source === 'vdmi.list');
    expect(task.statement).toMatch(/verantwortlich/u);
    expect(task.provenance.ref).toBe('mx-test-1:task-a');
    expect(task.provenance.quote).toBe('verantwortlich: TEST_GATEKEEPER');
    const deadline = finding.facts.find((fact) => fact.role === 'deadline');
    expect(deadline).toMatchObject({ value: '2026-12-15', basis: 'source' });
    expect(deadline.provenance).toMatchObject({
      source: 'governance-cards.listCards',
      ref: 'card-test-1',
    });
    expect(finding.expectations[0].dueFactId).toBe(deadline.factId);
    // The closed item is no open item of the role.
    expect(finding.facts.some((fact) => /Abgeschlossener/u.test(fact.statement))).toBe(false);
    // Quotes from documents are literal passages of the source text.
    const document = finding.facts.find((fact) => fact.provenance.source.endsWith('knowledge-rag'));
    expect(knowledgeHits[0].value).toContain(document.provenance.quote);
    // Tenant boundary: nothing of the foreign tenant.
    expect(JSON.stringify(finding)).not.toMatch(/Fremd|mx-foreign|card-foreign/u);
    // Required documents of the role's tasks become a follow-up.
    expect(finding.relations).toEqual(
      expect.arrayContaining([
        { from: 'Test Gatekeeper', rel: 'expects', to: 'Testrichtlinie Anschlussprüfung' },
      ])
    );
    const next = await broker.call('micro-agent.wissen.plan', {
      finding,
      object: { kind: 'org.role', value: 'Test Gatekeeper' },
    });
    expect(next).toEqual([
      expect.objectContaining({ kind: 'org.document', value: 'Testrichtlinie Anschlussprüfung' }),
    ]);
  });

  test('only read actions are called, with the knowledge source restricted and no meta leak', async () => {
    const parent = {
      name: 'test-parent',
      actions: {
        async run(ctx) {
          await ctx.call('micro-agent.wissen.expand', {
            object: { kind: 'org.role', value: 'TEST_GATEKEEPER' },
            context: { tenantId: TENANT },
          });
          return { ...ctx.meta };
        },
      },
    };
    broker.createService(parent);
    await broker.waitForServices('test-parent');
    const after = await broker.call('test-parent.run', {}, { meta });
    expect([...new Set(calls.map((call) => call.action))].sort()).toEqual([
      'governance-cards.listCards',
      'personal-agent.collectWorkbenchEvidence',
      'vdmi.list',
    ]);
    const knowledge = calls.find(
      (call) => call.action === 'personal-agent.collectWorkbenchEvidence'
    );
    expect(knowledge.meta.workbenchEvidenceSources).toEqual(['knowledge-rag']);
    expect(knowledge.meta.tenantId).toBe(TENANT);
    expect(after.workbenchEvidenceSources).toBeUndefined();
  });

  test('a document yields its knowledge entry, citing items, requiring tasks and owner roles', async () => {
    const finding = await expand({
      kind: 'org.document',
      value: 'Testrichtlinie Anschlussprüfung',
    });
    const statements = finding.facts.map((fact) => fact.statement);
    expect(statements).toEqual(
      expect.arrayContaining([
        'Die Unterlage „Testrichtlinie Anschlussprüfung“ liegt in der Wissensbasis vor.',
        expect.stringMatching(/als Nachweis im Governance-Vorgang „Testvorgang Prüfprozess“/u),
        expect.stringMatching(
          /verlangt „Testrichtlinie Anschlussprüfung“ als Nachweis; verantwortlich: TEST_GATEKEEPER/u
        ),
      ])
    );
    expect(JSON.stringify(finding)).not.toMatch(/Fremd|mx-foreign|card-foreign/u);
    const next = await broker.call('micro-agent.wissen.plan', {
      finding,
      object: { kind: 'org.document', value: 'Testrichtlinie Anschlussprüfung' },
    });
    expect(next).toEqual([expect.objectContaining({ kind: 'org.role', value: 'TEST_GATEKEEPER' })]);
  });

  test('an unknown document yields negatives with scope and names the unsearched gateway', async () => {
    const finding = await expand({ kind: 'org.document', value: 'Unbekanntes Testprotokoll' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives.length).toBe(3);
    for (const row of finding.negatives) {
      expect(row.searched).toBe('Unbekanntes Testprotokoll');
      expect(row.scope).toBeTruthy();
      expect(row.result).toBe('no_hit');
    }
    expect(finding.openQuestions[0].resolves).toMatch(/nicht durchsucht/u);
  });

  test('unsupported kinds are refused', async () => {
    const finding = await expand({ kind: 'grid.meter', value: 'X-1' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('a mismatching or missing tenant reads nothing', async () => {
    const foreign = await expand(
      { kind: 'org.role', value: 'TEST_GATEKEEPER' },
      { tenantId: FOREIGN }
    );
    const missing = await expand(
      { kind: 'concern', value: 'Wer prüft Anträge?' },
      { tenantId: TENANT },
      { meta: {} }
    );
    for (const finding of [foreign, missing]) {
      expect(finding.facts).toEqual([]);
      expect(finding.openQuestions[0].question).toMatch(/Mandant/u);
    }
    expect(calls).toEqual([]);
  });

  test('a slow source does not throw: it becomes an unavailable negative', async () => {
    state.slowKnowledge = true;
    const finding = await expand(
      { kind: 'org.role', value: 'TEST_GATEKEEPER' },
      { tenantId: TENANT },
      { budget: { timeoutMs: 700 } }
    );
    expect(finding.failed).toBeUndefined();
    expect(finding.facts.some((fact) => fact.provenance.source === 'vdmi.list')).toBe(true);
    expect(finding.negatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ result: 'unavailable' })])
    );
  });

  test('a source not released for the tenant is reported as not searched', async () => {
    state.knowledgeStatus = 'skipped';
    const finding = await expand({ kind: 'concern', value: 'Wer prüft Anträge?' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives).toEqual([expect.objectContaining({ result: 'unavailable' })]);
  });

  test('the concern without and with a consequence of another area', async () => {
    const plain = await expand({ kind: 'concern', value: 'Wer prüft Anträge formal?' });
    expect(plain.facts).toHaveLength(1);
    expect(plain.facts[0].statement).toMatch(/zur Frage/u);
    expect(knowledgeHits[0].value).toContain(plain.facts[0].provenance.quote);

    const consequence = await expand(
      { kind: 'concern', value: 'Messwert fehlt' },
      { tenantId: TENANT, consequenceOf: 'Antrag wartet auf TEST_GATEKEEPER' }
    );
    expect(consequence.facts[0].statement).toMatch(/Folge aus einem anderen Bereich/u);
    const query = calls
      .filter((call) => call.action === 'personal-agent.collectWorkbenchEvidence')
      .at(-1);
    expect(query.params.situation.concern).toBe('Messwert fehlt Antrag wartet auf TEST_GATEKEEPER');

    const none = await expand(
      { kind: 'concern', value: 'Wetter morgen' },
      { tenantId: TENANT, consequenceOf: 'kein Bezug' }
    );
    expect(none.facts).toEqual([]);
    expect(none.negatives[0]).toMatchObject({
      searched: 'Wetter morgen kein Bezug',
      result: 'no_hit',
    });
    expect(none.negatives[0].scope).toMatch(/Folgenprüfung: kein Bezug/u);
  });
});
