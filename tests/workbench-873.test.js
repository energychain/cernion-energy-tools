'use strict';
jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const llm = require('../src/llm-client');
const { answer, understand, SITUATION_SCHEMA } = require('../src/workbench-understanding');
const {
  generateAcceptanceFixture,
  fixtureSituation,
  artifactReply,
  acceptanceChecks,
} = require('../scripts/generate-workbench-873-fixtures');
const { scopedDatasets, scopedDataEvidence } = require('../src/workbench-data-scope');
const { selectDatasetCandidates } = require('../src/dataset-routing');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const path = require('node:path');
const f = generateAcceptanceFixture('unit873');
beforeEach(() => jest.clearAllMocks());

for (const scenario of f.scenarios.filter((item) => item.number <= 4)) {
  test(`873 scenario ${scenario.number}: complete ordered artifact overrides free-answer and letter rules`, async () => {
    llm.generateText.mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
    const situation = {
      ...fixtureSituation(f, scenario),
      conversationShape: 'knowledge',
      outputKind: 'analysis',
      responseMode: 'conversation',
    };
    const result = await answer({
      situation,
      message: scenario.message,
      followup: true,
      nextStepOnly: true,
      tenantId: f.tenantId,
      retrieval: { evidence: [] },
    });
    expect(Object.values(acceptanceChecks(scenario, result, f))).not.toContain(false);
    expect(result.responseText).not.toMatch(/Prüfe |Entwurf:/u);
    expect(result.draft).toBe('');
    expect(llm.generateText.mock.calls[0][0]).toContain('Keine Kürzung');
  });
}

test('A.1: output form and all parts are structurally validated and current-turn only', async () => {
  const scenario = f.scenarios[1];
  const situation = fixtureSituation(f, scenario);
  llm.generateStructured.mockResolvedValue(situation);
  const result = await understand({ message: scenario.message, tenantId: f.tenantId });
  expect(result.requestedOutput.parts).toHaveLength(2);
  expect(SITUATION_SCHEMA.properties.requestedOutput.additionalProperties).toBe(false);
  const persisted = require('../src/workbench-turn-scope').persistentSituation(result);
  expect(persisted.requestedOutput).toBeUndefined();
  expect(persisted.dataQuestion).toBeUndefined();
});

test.each(['missing part', 'wrong heading', 'letter'])(
  'A.2–A.4: repair invalid artifact: %s',
  async (variant) => {
    const scenario = variant === 'missing part' ? f.scenarios[1] : f.scenarios[2];
    const bad = artifactReply(f, scenario);
    if (variant === 'missing part') bad.artifact.pop();
    if (variant === 'wrong heading')
      bad.artifact[0].content[0].text = scenario.content.replace('Prüfpfad', 'Andere Gliederung');
    if (variant === 'letter')
      bad.artifact[0].content[0].text =
        'Guten Tag Team,\n\n' + scenario.content + '\n\nViele Grüße';
    llm.generateText
      .mockResolvedValueOnce(JSON.stringify(bad))
      .mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
    const result = await answer({
      situation: fixtureSituation(f, scenario),
      message: scenario.message,
      tenantId: f.tenantId,
      retrieval: { evidence: [] },
    });
    expect(result.answerAttempts).toBe(2);
    expect(Object.values(acceptanceChecks(scenario, result, f))).not.toContain(false);
  }
);

test('A.5: an explicitly ordered artifact retains all thirty ordered steps', async () => {
  const scenario = {
    ...f.scenarios[0],
    content: Array.from(
      { length: 30 },
      (_, i) =>
        `${i + 1}. Vergleiche Prüfobjekt ${i + 1} in ${f.system} und dokumentiere den offenen Prüfpunkt.`
    ).join('\n'),
  };
  llm.generateText.mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
  const result = await answer({
    situation: fixtureSituation(f, scenario),
    message: scenario.message,
    followup: true,
    tenantId: f.tenantId,
    retrieval: { evidence: [] },
  });
  expect(result.responseText).toContain('30. Vergleiche');
});

for (const scenario of [
  f.scenarios[4],
  f.scenarios[5],
  { number: 6, message: `Formuliere eine Mail zu ${f.topic}.` },
])
  for (const noise of f.noisyLines)
    test(`873 scenarios 5/6 B.3: ${scenario.message.slice(0, 20)} excludes ${noise.slice(0, 40)}`, async () => {
      llm.generateText.mockResolvedValue(
        JSON.stringify({
          expectation: [],
          nextSteps: [],
          interpretation: [
            f.claim('Die Zuständigkeit bleibt als offener fachlicher Punkt zu klären.'),
          ],
        })
      );
      const evidence = [
        {
          source: 'dataset.query',
          retrievalSource: 'capability-read',
          value: noise,
          metadata: { tenantId: f.tenantId, datasetId: f.records[0].id },
        },
        {
          source: 'synthetic.query',
          retrievalSource: 'capability-read',
          value: JSON.stringify({ count: 4, data: [] }),
          metadata: { tenantId: f.tenantId, sourceId: 'source-1' },
        },
      ];
      const result = await answer({
        situation: fixtureSituation(f, scenario),
        message: scenario.message,
        tenantId: f.tenantId,
        retrieval: {
          evidence,
          dataScope: { dataRequested: false, tenantId: f.tenantId, datasetIds: [] },
          toolTrace: [
            { name: 'synthetic.query', sourceId: 'source-1', called: true, status: 'available' },
          ],
        },
      });
      expect(Object.values(acceptanceChecks(scenario, result, f))).not.toContain(false);
      expect(result.evidence).toHaveLength(0);
    });

test('B.1: unrelated catalog never reaches semantic selection; same-chat, case and exact references remain', async () => {
  expect(
    await selectDatasetCandidates(f.records, f.scenarios[4].message, { conversationId: 'new-chat' })
  ).toEqual([]);
  expect(llm.generateStructured).not.toHaveBeenCalled();
  expect(
    scopedDatasets(f.records, 'Wie viele Zeilen?', {
      conversationId: f.records[0].provenance.conversationId,
    })
  ).toHaveLength(1);
  expect(
    scopedDatasets(f.records, f.scenarios[6].message, { conversationId: 'new-chat' })
  ).toHaveLength(1);
  expect(
    scopedDatasets(
      f.records.map((record) => ({ ...record, provenance: { caseId: 'synthetic-case' } })),
      'Wie viele Zeilen?',
      { caseId: 'synthetic-case' }
    )
  ).toHaveLength(1);
});

test('873 scenario 7 / B.2: own selected dataset remains correct with exactly one origin', async () => {
  const scenario = f.scenarios[6];
  const source = `Die Abfrage umfasst 4 Zeilen.\n\nHerkunft: ${f.filename}, Version 1.`;
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      interpretation: [f.claim('Der ausgewählte Datensatz enthält 4 Zeilen.', ['E1'])],
    })
  );
  const hit = {
    source: 'dataset.query',
    retrievalSource: 'capability-read',
    value: source,
    metadata: { tenantId: f.tenantId, datasetId: f.records[0].id, sourceId: 'dataset-source' },
  };
  const result = await answer({
    situation: fixtureSituation(f, scenario),
    message: scenario.message,
    tenantId: f.tenantId,
    retrieval: {
      evidence: [hit],
      dataScope: { dataRequested: true, tenantId: f.tenantId, datasetIds: [f.records[0].id] },
      toolTrace: [
        { name: 'dataset.query', sourceId: 'dataset-source', status: 'available', called: true },
      ],
    },
  });
  expect(result.responseText).toContain('4 Zeilen');
  expect(result.responseText.match(/Herkunft:/g)).toHaveLength(1);
  expect(
    scopedDataEvidence([{ ...hit, metadata: { ...hit.metadata, tenantId: 'foreign' } }], {
      dataRequested: true,
      tenantId: f.tenantId,
      datasetIds: [f.records[0].id],
    })
  ).toEqual([]);
});

test('873 scenario 9: empty, whitespace and internal notice content never renders a heading', () => {
  const { renderNoticeBlock } = require('../src/shared-service-notices');
  for (const text of ['', ' ', undefined])
    expect(renderNoticeBlock([{ kind: 'memory', text }], 22)).toBe('');
});

describe('873 scenario 8 and C.3: real stores, audit and one-time legacy notice cleanup', () => {
  let app, principal, ctx;
  beforeEach(async () => {
    app = await createCaseBroker();
    for (const [schema, dir] of [
      [require('../services/object-store.service'), 'objects'],
      [require('../services/shared-service-notices.service'), 'notices'],
    ])
      app.broker.createService({
        ...schema,
        settings: { ...schema.settings, dbPath: path.join(app.dir, dir) },
      });
    app.broker.createService(require('../services/tenant-memory-policy.service'));
    await app.broker.start();
    principal = { tenantId: f.tenantId, actorId: f.actorId, roles: ['ROLE_ALPHA'], clearance: [] };
    const meta = auth(f.actorId, ['ROLE_ALPHA'], f.tenantId);
    ctx = {
      meta,
      broker: app.broker,
      call: (name, params, options) =>
        app.broker.call(name, params, { meta: { ...meta, ...options?.meta } }),
    };
  });
  afterEach(async () => app.cleanup());
  test('20 audited administrative deletions create no hints; legacy queue and history discarded exactly once', async () => {
    const store = require('../src/tenant-memory-store');
    for (let i = 0; i < 20; i++) await store.put(ctx, principal, f.fact(i));
    const notices = app.broker.getLocalService('notices');
    const doc = await notices.read(f.tenantId, f.actorId);
    const foreignDoc = await notices.read('synthetic-foreign', 'synthetic-foreign-author');
    for (let i = 0; i < 20; i++)
      doc.queue.push({
        kind: 'memory',
        change: true,
        relationId: f.fact(i).id,
        ref: `G-${i}`,
        sequence: i,
        turn: 0,
        eventKey: `synthetic-key-${i}`,
        factIds: [f.fact(i).id],
      });
    foreignDoc.queue.push({ ...doc.queue[0] });
    await notices.save(doc);
    await notices.save(foreignDoc);
    for (let i = 0; i < 20; i++)
      await app.call(
        'tenant-memory-policy.delete',
        { id: f.fact(i).id, reason: 'Synthetic cleanup 873' },
        auth('synthetic-admin', ['ROLE_TENANT_ADMIN'], f.tenantId)
      );
    const before = await notices.read(f.tenantId, f.actorId);
    expect(before.queue).toHaveLength(20);
    const turn = await app.call(
      'notices.completeTurn',
      { tenantId: f.tenantId, actorId: f.actorId, turnRef: 'synthetic-next' },
      auth(f.actorId, ['ROLE_ALPHA'], f.tenantId)
    );
    expect(turn.items).toEqual([]);
    expect(turn.block).toBe('');
    const params = { reason: 'Discard synthetic legacy notices 873' };
    const cleanup = await app.call(
      'tenant-memory-policy.discardDeletionNotices',
      params,
      auth('synthetic-admin', ['ROLE_TENANT_ADMIN'], f.tenantId)
    );
    expect(cleanup).toEqual({
      migration: 'deletion-notices-v1',
      discarded: 20,
      alreadyApplied: false,
    });
    expect(
      await app.call(
        'tenant-memory-policy.discardDeletionNotices',
        params,
        auth('synthetic-admin', ['ROLE_TENANT_ADMIN'], f.tenantId)
      )
    ).toEqual({ migration: 'deletion-notices-v1', discarded: 0, alreadyApplied: true });
    expect(
      (await notices.read('synthetic-foreign', 'synthetic-foreign-author')).queue
    ).toHaveLength(1);
    expect((await notices.read(f.tenantId, f.actorId)).queue).toEqual([]);
    const audits = await store.query(ctx, principal, { 'payload.type': 'tenant_memory_audit' });
    expect(audits.filter((item) => item.kind === 'deleted')).toHaveLength(20);
    expect(
      audits.filter((item) => item.kind === 'admin_discard_memory_notices_complete')
    ).toHaveLength(2);
    await expect(
      app.call(
        'tenant-memory-policy.discardDeletionNotices',
        params,
        auth(f.actorId, ['ROLE_ALPHA'], f.tenantId)
      )
    ).rejects.toMatchObject({ code: 403 });
  });
  test.each(['revoked', 'corrected'])(
    'administrative %s is audit-only; empty confirmation is never queued',
    async (kind) => {
      const store = require('../src/tenant-memory-store'),
        policy = require('../src/tenant-memory-policy');
      await store.put(ctx, principal, f.fact(1));
      const p = { ...principal, actorId: 'synthetic-admin', roles: ['ROLE_TENANT_ADMIN'] };
      const meta = auth(p.actorId, p.roles, p.tenantId);
      await policy.change(
        {
          ...ctx,
          meta,
          call: (name, params, options) =>
            app.broker.call(name, params, { meta: { ...meta, ...options?.meta } }),
        },
        p,
        f.fact(1).id,
        kind,
        'Synthetic correction',
        { admin: true }
      );
      expect(
        (await app.broker.getLocalService('notices').read(f.tenantId, f.actorId)).queue
      ).toEqual([]);
      await store.put(ctx, principal, { ...f.fact(2), text: '' });
      expect(
        await app.call(
          'notices.enqueueMemory',
          {
            tenantId: f.tenantId,
            actorId: f.actorId,
            relationId: f.fact(2).id,
            factIds: [f.fact(2).id],
            confirmation: true,
          },
          auth(f.actorId, ['ROLE_ALPHA'], f.tenantId)
        )
      ).toEqual({ queued: false });
    }
  );
});

test('873 scenario 10 / D: semantically select substantive visible case using stored turn memory, omit shells', async () => {
  const { searchKnowledge } = require('../src/workbench-self-knowledge');
  const p = { tenantId: f.tenantId, actorId: f.actorId, roles: ['ROLE_ALPHA'], clearance: [] };
  const m = f.caseMemory;
  const states = [
    {
      tenantId: f.tenantId,
      actorId: f.actorId,
      cetCaseId: 'case-with-memory',
      sensitivityFlags: [],
    },
    { tenantId: f.tenantId, actorId: f.actorId, cetCaseId: 'empty-shell', sensitivityFlags: [] },
    {
      tenantId: 'synthetic-foreign',
      actorId: f.actorId,
      cetCaseId: 'foreign',
      sensitivityFlags: [],
    },
  ];
  const router = {
    visibleStates: async () => states,
    readCaseSummary: async () => ({ summary: 'Fallhülle' }),
  };
  const service = {
    store: { caseDisplayRef: async () => 'F-873' },
    loadTurnMemory: async (_p, id) =>
      id === 'case-with-memory' ? { ...m, lastSafeConclusion: m.situation } : null,
  };
  const ctx = {
    broker: { getLocalService: (name) => (name === 'domain-router' ? router : null) },
    call: jest.fn(),
  };
  llm.generateStructured.mockResolvedValue({
    caseIds: ['case-with-memory', 'empty-shell', 'foreign'],
  });
  const scenario = f.scenarios[9];
  const situation = {
    ...fixtureSituation(f, scenario),
    selfKnowledge: { requested: true, query: scenario.message },
    caseSearch: { requested: true, query: m.situation },
  };
  const found = await searchKnowledge(service, ctx, p, situation);
  expect(found.evidence).toHaveLength(1);
  expect(JSON.parse(llm.generateStructured.mock.calls[0][1]).cases).toHaveLength(1);
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      interpretation: [f.claim('Der passende Prüfauftrag ist noch offen.')],
    })
  );
  const result = await answer({
    situation,
    message: scenario.message,
    tenantId: f.tenantId,
    retrieval: found,
  });
  expect(Object.values(acceptanceChecks(scenario, result, f))).not.toContain(false);
  for (const value of [m.openQuestions[0], m.workingAssumptions[0], m.risks[0], m.nextSteps[0]])
    expect(result.responseText).toContain(value);
});

test('A.2/A.5: full chat preserves the ordered artifact including its checklist questions', async () => {
  const app = await createCaseBroker();
  const scenario = {
    ...f.scenarios[2],
    content: f.scenarios[2].content.replace(
      'Eingabe und gespeichertes Objekt vergleichen.',
      f.artifactQuestion
    ),
  };
  llm.generateStructured.mockResolvedValue(fixtureSituation(f, scenario));
  llm.generateText.mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
  try {
    await app.broker.start();
    const result = await app.call(
      'workbench.chat',
      { channel: 'api', conversationId: 'synthetic-artifact-chat', message: scenario.message },
      auth(f.actorId, ['ROLE_ALPHA'], f.tenantId)
    );
    expect(result.responseText).toContain(f.artifactQuestion);
    for (const heading of scenario.output.parts[0].sections)
      expect(result.responseText).toContain(`### ${heading}`);
  } finally {
    await app.cleanup();
  }
});

test('D.1: thematic status questions and labelled status updates use semantic understanding', () => {
  const { classifyWorkbenchIntent } = require('../src/workbench-intent-router');
  expect(classifyWorkbenchIntent(f.statusQuestion)).toBe('decision_support');
  expect(classifyWorkbenchIntent(f.caseTurns[1])).toBe('decision_support');
  expect(classifyWorkbenchIntent('Status F-873?')).toBe('status_query');
  expect(classifyWorkbenchIntent('Status des Falls')).toBe('status_query');
  expect(classifyWorkbenchIntent('Stand des Vorgangs?')).toBe('status_query');
});

test('D.2: accumulated open points survive omission and only explicit grounded resolution removes them', async () => {
  const scenario = f.scenarios[5];
  const situation = {
    ...fixtureSituation(f, scenario),
    caseMemory: {
      applicable: true,
      topic: f.topic,
      status: f.caseMemory.situation,
      openPoints: f.caseMemory.openQuestions,
      assumptions: f.caseMemory.workingAssumptions,
      risks: f.caseMemory.risks,
      nextSteps: f.caseMemory.nextSteps,
      resolvedItems: [],
    },
  };
  llm.generateStructured.mockResolvedValue({
    ...situation,
    caseMemory: { ...situation.caseMemory, openPoints: [] },
  });
  const retained = await understand({
    previous: situation,
    message: scenario.message,
    tenantId: f.tenantId,
  });
  expect(retained.caseMemory.openPoints).toEqual(situation.caseMemory.openPoints);
  llm.generateStructured.mockResolvedValue({
    ...situation,
    caseMemory: {
      ...situation.caseMemory,
      openPoints: [],
      resolvedItems: [
        { kind: 'openPoints', value: situation.caseMemory.openPoints[0], basis: f.resolvedMessage },
      ],
    },
  });
  const resolved = await understand({
    previous: situation,
    message: f.resolvedMessage,
    tenantId: f.tenantId,
  });
  expect(resolved.caseMemory.openPoints).toEqual([]);
  expect(
    require('../src/workbench-turn-scope').persistentSituation(resolved).caseMemory.resolvedItems
  ).toBeUndefined();
});

test('B.1: document evidence is revalidated before the same data scope boundary; substantive documents remain', async () => {
  const documentKnowledge = require('../src/workbench-document-knowledge');
  const hits = [
    {
      source: 'tenant-documents',
      retrievalSource: 'tenant-documents',
      value: f.noisyLines[1],
      metadata: {
        tenantId: f.tenantId,
        datasetId: f.records[0].id,
        workbenchDocument: f.records[0].id,
      },
    },
    {
      source: 'tenant-documents',
      retrievalSource: 'tenant-documents',
      value: f.fact(1).text,
      metadata: { workbenchDocument: f.fact(1).id },
    },
  ];
  const ctx = {
    broker: { getLocalService: () => ({ schema: { actions: { documentSearch: {} } } }) },
    call: jest.fn(async (name) =>
      name === 'knowledge-rag.documentSearch' ? hits : { status: 'active' }
    ),
  };
  const selected = await documentKnowledge.evidence(ctx, f.scenarios[4].message);
  const current = await documentKnowledge.currentEvidence(ctx, selected);
  expect(scopedDataEvidence(current, { dataRequested: false })).toEqual([hits[1]]);
  expect(ctx.call).toHaveBeenCalledWith('knowledge-rag.documentGet', { id: f.records[0].id });
});

test('B.1: explicit semantic non-data intent suppresses capability recovery even with a matching table', () => {
  const { resolveCapabilityNeed } = require('../src/workbench-capability-loop');
  const scenario = f.scenarios[4];
  const result = resolveCapabilityNeed(
    { ...fixtureSituation(f, scenario), dataNeeds: scenario.message },
    scenario.message,
    { datasetCandidates: f.records }
  );
  expect(result.reason).toBe('no_data_need');
  expect(result.candidates).toEqual([]);
});

test('A.1/A.2: repair a paraphrased output basis instead of dropping the explicit artifact', async () => {
  const scenario = f.scenarios[0],
    situation = fixtureSituation(f, scenario);
  llm.generateStructured
    .mockResolvedValueOnce({
      ...situation,
      requestedOutput: { ...situation.requestedOutput, basis: f.caseTurns[1] },
    })
    .mockResolvedValueOnce(situation);
  const result = await understand({ message: scenario.message, tenantId: f.tenantId });
  expect(result.requestedOutput.requested).toBe(true);
  expect(result.requestedOutput.basis).toBe(scenario.message);
  expect(llm.generateStructured).toHaveBeenCalledTimes(2);
});

test('D.1/D.3: a named reversible subject excludes a different masked subject before semantic selection', async () => {
  const { selectSemanticCases } = require('../src/workbench-case-search');
  llm.generateStructured.mockResolvedValue({ caseIds: ['synthetic-case-1', 'synthetic-case-2'] });
  const candidates = [
    { caseId: 'synthetic-case-1', topic: f.topic, memory: f.caseMemory },
    { caseId: 'synthetic-case-2', topic: f.system, memory: { ...f.caseMemory, topic: f.system } },
  ];
  const selected = await selectSemanticCases(f.scenarios[9].message, candidates, f.tenantId);
  expect(selected.map((item) => item.caseId)).toEqual(['synthetic-case-1']);
  expect(llm.generateStructured).not.toHaveBeenCalled();
});

test('A.3: standalone draft continuation reuses the last schema-bound internal artifact form', async () => {
  const app = await createCaseBroker(),
    scenario = f.scenarios[0];
  llm.generateStructured.mockResolvedValue(fixtureSituation(f, scenario));
  llm.generateText.mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
  try {
    await app.broker.start();
    const send = (message) =>
      app.call(
        'workbench.chat',
        { channel: 'api', conversationId: 'synthetic-draft-form', message },
        auth(f.actorId, ['ROLE_ALPHA'], f.tenantId)
      );
    await send(scenario.message);
    const next = await send(f.shortDraftRequest);
    expect(next.responseText).toContain('1. Öffne');
    expect(next.responseText).not.toMatch(/Guten Tag|Grüße|Entwurf:/u);
    expect(next.situation.requestedOutput.kind).toBe('internal');
  } finally {
    await app.cleanup();
  }
});

test('A.2/D.2: requested case matrix wins over the default case summary and retains a trace', async () => {
  const scenario = f.scenarios[3];
  llm.generateText.mockResolvedValue(JSON.stringify(artifactReply(f, scenario)));
  const situation = {
    ...fixtureSituation(f, scenario),
    caseSearch: { requested: true, query: f.topic },
  };
  const result = await answer({
    situation,
    message: scenario.message,
    tenantId: f.tenantId,
    retrieval: {
      evidence: [
        {
          source: 'cases',
          value: f.caseMemory.situation,
          metadata: { displayRef: 'F-873', caseMemory: f.caseMemory },
        },
      ],
    },
  });
  expect(result.responseText).toContain(scenario.content);
  expect(result.responseText).not.toContain('Stand:');
  expect(result.evidenceTrace.source).toBe('answer');
});

test('A.5 / #813: uncertain model details keep the shared marker outside matrix cells', async () => {
  const scenario = f.scenarios[3],
    parsed = artifactReply(f, scenario);
  parsed.artifact[0].content[0] = {
    ...parsed.artifact[0].content[0],
    origin: 'model',
    specific: true,
  };
  llm.generateText.mockResolvedValue(JSON.stringify(parsed));
  const result = await answer({
    situation: fixtureSituation(f, scenario),
    message: scenario.message,
    tenantId: f.tenantId,
    retrieval: { evidence: [] },
  });
  expect(result.responseText).toContain(scenario.content + '\n\n(bitte gegenprüfen)');
});

test('D.2: case presentation retains the stored subject alongside a generic memory topic', () => {
  const { renderCaseMemory } = require('../src/workbench-case-search');
  const f = generateAcceptanceFixture();
  const text = renderCaseMemory(
    { memory: { topic: 'Abgrenzung der Verantwortung' }, topic: `Sachstand zu ${f.topic}` },
    'F-2'
  );
  expect(text).toContain(f.topic);
  expect(text).toContain('Abgrenzung der Verantwortung');
});

test.each(['summary', 'internal', 'other'])(
  'D.2: compatible case sections render for schema kind %s',
  (kind) => {
    const { canRenderCaseRequest } = require('../src/workbench-case-search');
    const request = { ...generateAcceptanceFixture().caseSummaryOutput, kind };
    expect(canRenderCaseRequest(request)).toBe(true);
    expect(canRenderCaseRequest({ ...request, kind: 'correspondence' })).toBe(false);
  }
);
