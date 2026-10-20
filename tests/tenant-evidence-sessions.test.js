'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { installSessionStub } = require('./helpers/session-evidence-stub');
const { sessionCandidates, readSessionEvidence } = require('../src/tenant-evidence-sessions');
const descriptor = require('../src/tenant-evidence-descriptor');
const facts = require('../src/tenant-memory-store');
const llm = require('../src/llm-client');
let app, controls, env;
const p = (tenantId = 'tenant-a', actorId = 'actor-a', clearance = []) => ({
  tenantId,
  actorId,
  roles: ['ROLE_ALPHA'],
  clearance,
});
const meta = (person = p()) =>
  auth(person.actorId, person.roles, person.tenantId, person.clearance);
const ctx = (person = p(), conversationId = 'new-chat') => ({
  broker: app.broker,
  meta: meta(person),
  params: { conversationId },
  call: (name, params, options) =>
    app.broker.call(name, params, { ...options, meta: { ...meta(person), ...options?.meta } }),
});
const chat = (message, conversationId = 'new-chat', person = p()) =>
  app.call(
    'workbench.chat',
    { channel: 'api', conversationId, userRequest: message },
    meta(person)
  );
const intake = () =>
  chat(
    'Zum Standort Nord: Der Bestand beträgt 80 kg. Die Zuordnung ist offen. Ordne diese Angaben ein.',
    'old-chat'
  );
const question = 'Welche Einordnung zum Bestand am Standort Nord liegt vor?';

beforeEach(async () => {
  env = { ...process.env };
  process.env.TENANT_MEMORY_RECOVERY = 'off';
  jest.clearAllMocks();
  controls = installSessionStub();
  app = await createCaseBroker();
  app.workbench.settings.tenantEvidenceEnrichment = { delayMs: 2 ** 31 - 1 };
  for (const name of ['object-store', 'shared-service-learning']) {
    const schema = require(`../services/${name}.service`);
    app.broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(app.dir, name) },
    });
  }
  await app.broker.start();
});
afterEach(async () => {
  await app.cleanup();
  process.env = env;
});

async function saveFact(extra = {}) {
  const fact = {
    id: 'statement-example',
    type: 'tenant_memory_fact',
    tenantId: 'tenant-a',
    person: { actorId: 'actor-a', name: 'Sachbearbeitung A', functionLabel: 'Koordination' },
    at: '2026-01-01T10:00:00.000Z',
    text: 'Am Standort Nord beträgt der Bestand 80 kg.',
    basis: 'Am Standort Nord beträgt der Bestand 80 kg.',
    anchors: [{ value: 'Standort Nord', aliases: [] }],
    anchorKeys: [],
    status: 'valid',
    conversationId: 'statement-chat',
    channel: 'api',
    checking: 'complete',
    ...extra,
  };
  const author = p('tenant-a', 'actor-a', fact.sensitivityFlags || []);
  await facts.put(ctx(author), author, fact);
  return fact;
}

test('full turns use fresh authorized case memory, exclude their current session and preserve person corrections', async () => {
  const first = await intake();
  const saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  expect(saved.evidenceDescriptor.manifest.questionTypes.length).toBeGreaterThan(0);
  expect(saved.memory.lastSafeConclusion).not.toContain('Kein Fall');
  expect(await sessionCandidates(ctx(p(), 'old-chat'), question, 'case')).toEqual([]);
  expect((await chat(question, 'old-chat')).tenantEvidenceSelection).toBeUndefined();
  const answer = await chat(question);
  expect(answer.tenantEvidenceSelection).toEqual([
    { sourceType: 'case', sourceId: first.cetCaseId },
  ]);
  expect(answer.responseText).toContain(`aus Fall ${first.caseDisplayRef}`);
  const rejected = await chat('passt nicht');
  expect(rejected.responseText).toContain('Korrektur ist gespeichert');
  expect((await chat(question)).tenantEvidenceSelection).toBeUndefined();
  const colleague = await chat(question, 'colleague', p('tenant-a', 'actor-b'));
  expect(colleague.tenantEvidenceSelection).toContainEqual({
    sourceType: 'case',
    sourceId: first.cetCaseId,
  });
  expect(controls.errors).toEqual([]);
});

test('offering a colleague case reads metadata only; reading it as evidence is audited once', async () => {
  const first = await intake();
  const colleague = p('tenant-a', 'actor-b');
  const audits = async () =>
    (await app.router.eventsDb.allDocs({ include_docs: true })).rows.filter(
      ({ doc }) => doc.kind === 'observed' && doc.cetCaseId === first.cetCaseId
    ).length;
  const before = await audits();
  const [selected] = await sessionCandidates(ctx(colleague, 'colleague-chat'), question, 'case');
  await sessionCandidates(ctx(colleague, 'colleague-chat'), question, 'case');
  expect(selected?.sourceId).toBe(first.cetCaseId);
  expect(await audits()).toBe(before);
  const read = await readSessionEvidence(ctx(colleague, 'colleague-chat'), selected);
  expect(read.evidence).toHaveLength(1);
  expect(await audits()).toBe(before + 1);
});

test('only the most recently updated sessions offer themselves', async () => {
  await intake();
  app.workbench.settings.tenantEvidenceSessions = { maxCandidates: 0 };
  expect(await sessionCandidates(ctx(), question, 'case')).toEqual([]);
  delete app.workbench.settings.tenantEvidenceSessions;
  expect(await sessionCandidates(ctx(), question, 'case')).toHaveLength(1);
});

test('full turns deny foreign tenants and clearance, including a source changed after selection', async () => {
  const first = await intake();
  const selected = (await sessionCandidates(ctx(), question, 'case'))[0];
  expect(selected).toBeTruthy();
  expect(
    (await chat(question, 'foreign-chat', p('tenant-b'))).tenantEvidenceSelection
  ).toBeUndefined();
  const state = await app.router.loadCase(p(), first.cetCaseId);
  state.sensitivityFlags = ['restricted'];
  await app.router.saveState(p('tenant-a', 'actor-a', ['restricted']), state);
  expect((await chat(question, 'denied-chat')).tenantEvidenceSelection).toBeUndefined();
  expect((await readSessionEvidence(ctx(), selected)).evidence).toEqual([]);
  expect(
    (await chat(question, 'cleared-chat', p('tenant-a', 'actor-a', ['restricted'])))
      .tenantEvidenceSelection
  ).toContainEqual({ sourceType: 'case', sourceId: first.cetCaseId });
});

test('case adapters honor the existing source access gate before offering and reading', async () => {
  await intake();
  const selected = (await sessionCandidates(ctx(), question, 'case'))[0];
  // Offering (summary) and reading (content) both pass the router's case authorization.
  const original = app.router.loadCase.bind(app.router);
  const gate = jest.spyOn(app.router, 'loadCase').mockImplementation((person, id, options) => {
    if (id === selected.sourceId)
      throw Object.assign(new Error('Source membership revoked'), { code: 403 });
    return original(person, id, options);
  });
  try {
    expect((await chat(question)).tenantEvidenceSelection).toBeUndefined();
    expect((await readSessionEvidence(ctx(), selected)).evidence).toEqual([]);
  } finally {
    gate.mockRestore();
  }
});

test('case original read rejects changed content and correction after candidate selection', async () => {
  const first = await intake();
  const selected = (await sessionCandidates(ctx(), question, 'case'))[0];
  const saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  await app.workbench.store.turnMemoryDb.put({
    ...saved,
    memory: { ...saved.memory, lastSafeConclusion: 'Der Bestand beträgt 95 kg.' },
  });
  expect((await readSessionEvidence(ctx(), selected)).evidence).toEqual([]);
  const fresh = (await sessionCandidates(ctx(), question, 'case'))[0];
  const result = await readSessionEvidence(ctx(), fresh);
  expect(result.evidence[0].value).toContain('95 kg');
  expect(result.evidence[0].value).not.toContain('80 kg');
  await app.call('shared-service-learning.apply', {
    target: 'tenantEvidence',
    correction: { sourceType: 'case', sourceId: first.cetCaseId, kind: 'reject' },
  });
  expect((await readSessionEvidence(ctx(), fresh)).evidence).toEqual([]);
});

test.each([
  'Aus den Dokumenten kann ich das nicht zuverlässig beantworten.',
  'Der Benutzer möchte den Bestand einordnen.',
  'Der Nutzer möchte Angaben einordnen.',
  'Standort Nord',
])('legacy non-content %s is neither a candidate nor a last conclusion', async (conclusion) => {
  const first = await intake();
  const saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  const state = await app.router.loadCase(p(), first.cetCaseId);
  state.lastClassification.responseText = conclusion;
  await app.router.saveState(p(), state);
  await app.workbench.store.turnMemoryDb.put({
    ...saved,
    memory: { topic: 'Standort Nord', lastSafeConclusion: conclusion },
  });
  expect(await sessionCandidates(ctx(), question, 'case')).toEqual([]);
  expect((await chat(question)).tenantEvidenceSelection).toBeUndefined();
  const rendered = require('../src/workbench-case-search').renderCaseMemory(
    { memory: { topic: 'Standort Nord', lastSafeConclusion: conclusion } },
    'F-1'
  );
  if (conclusion !== 'Standort Nord') expect(rendered).not.toContain('Letzte Einordnung');
});

test('full turns use active team statements with provenance and personal reject/confirm through the shared learning loop', async () => {
  const fact = await saveFact();
  const answer = await chat(question);
  expect(answer.tenantEvidenceSelection).toEqual([{ sourceType: 'memory', sourceId: fact.id }]);
  expect(answer.evidence[0].metadata).toMatchObject({
    sourceType: 'memory',
    conversationId: 'statement-chat',
    at: fact.at,
  });
  expect(answer.responseText).toContain('Sachbearbeitung A');
  expect(answer.responseText).toContain('Fundstelle');
  expect((await chat('passt nicht')).responseText).toContain('Korrektur ist gespeichert');
  expect((await chat(question)).tenantEvidenceSelection).toBeUndefined();
  expect(
    (await chat(question, 'team-member', p('tenant-a', 'actor-b'))).tenantEvidenceSelection
  ).toContainEqual({ sourceType: 'memory', sourceId: fact.id });
  await app.call('shared-service-learning.apply', {
    target: 'tenantEvidence',
    correction: { sourceType: 'memory', sourceId: fact.id, kind: 'confirm' },
  });
  expect((await chat(question)).tenantEvidenceSelection).toContainEqual({
    sourceType: 'memory',
    sourceId: fact.id,
  });
});

test('statements respect tenant, clearance, current conversation, expiry, revocation and source changes', async () => {
  await saveFact({ sensitivityFlags: ['restricted'] });
  expect((await chat(question)).tenantEvidenceSelection).toBeUndefined();
  expect((await chat(question, 'foreign', p('tenant-b'))).tenantEvidenceSelection).toBeUndefined();
  const allowed = p('tenant-a', 'actor-a', ['restricted']);
  expect(await sessionCandidates(ctx(allowed, 'statement-chat'), question, 'memory')).toEqual([]);
  const selected = (await sessionCandidates(ctx(allowed), question, 'memory'))[0];
  expect(selected).toBeTruthy();
  await facts.mutate(ctx(allowed), allowed, selected.sourceId, (fact) => ({
    ...fact,
    status: 'revoked',
  }));
  expect((await readSessionEvidence(ctx(allowed), selected)).evidence).toEqual([]);
  expect(await sessionCandidates(ctx(allowed), question, 'memory')).toEqual([]);
  await saveFact({ expiresAt: '2020-01-01T00:00:00.000Z', id: 'expired' });
  await saveFact({ documentSource: { id: 'already-a-document' }, id: 'document-fact' });
  expect(await sessionCandidates(ctx(allowed), question, 'memory')).toEqual([]);
});

test('descriptor prompts contain projected metadata and status, never conclusions, raw turns or statement bodies', async () => {
  const first = await intake();
  const saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  const state = await app.router.loadCase(p(), first.cetCaseId);
  const row = require('../src/tenant-evidence-sessions').caseRow(
    state,
    {
      ...saved,
      memory: {
        ...saved.memory,
        lastSafeConclusion: 'SECRET-CONCLUSION',
        lastUserIntent: 'SECRET-TURN',
      },
    },
    []
  );
  await require('../src/tenant-evidence-descriptor').ensureDescriptor('case', row, {
    enrich: true,
  });
  const calls = llm.generateStructured.mock.calls.filter((args) => JSON.parse(args[1]).nodes);
  expect(calls).toHaveLength(1);
  expect(calls[0][1]).toContain('Standort Nord');
  expect(calls[0][1]).toContain('status');
  expect(calls[0][1]).not.toContain('SECRET-CONCLUSION');
  expect(calls[0][1]).not.toContain('SECRET-TURN');
  const fact = await saveFact({ text: 'SECRET-STATEMENT' });
  const memoryRow = require('../src/tenant-evidence-sessions').memoryRow(fact);
  await descriptor.ensureDescriptor('memory', memoryRow, { enrich: true });
  expect(llm.generateStructured.mock.calls.at(-1)[1]).not.toContain('SECRET-STATEMENT');
});

test('old records backfill only on a matching request and keep the deterministic minimum on background failure', async () => {
  const first = await intake();
  let saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  delete saved.evidenceDescriptor;
  await app.workbench.store.turnMemoryDb.put(saved);
  await sessionCandidates(ctx(), 'Welche Temperatur ist im Depot West belegt?', 'case');
  saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  expect(saved.evidenceDescriptor).toBeUndefined();
  await sessionCandidates(ctx(), question, 'case');
  saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  expect(saved.evidenceDescriptor.manifest).toBeTruthy();
  llm.generateStructured.mockRejectedValueOnce(new Error('Offline provider unavailable'));
  await require('../src/tenant-evidence-background').runDescriptorJob(app.workbench);
  expect(
    (await readSessionEvidence(ctx(), (await sessionCandidates(ctx(), question, 'case'))[0]))
      .evidence
  ).toHaveLength(1);
});

describe('sessions share the existing document/dataset path', () => {
  beforeEach(async () => {
    process.env.WORKBENCH_DATASET_DB_PATH = path.join(app.dir, 'rows');
    process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
    for (const name of ['knowledge-rag', 'datapoint', 'dataset']) {
      const schema = require(`../services/${name}.service`);
      app.broker.createService({
        ...schema,
        settings: {
          ...schema.settings,
          dbPath: path.join(app.dir, name),
          tenantEvidenceEnrichment: { delayMs: 2 ** 31 - 1 },
        },
      });
    }
    await app.broker.waitForServices(['knowledge-rag', 'datapoint', 'dataset']);
  });
  const upload = (message, name, text, conversationId) =>
    chat(
      `<context><source name="${name}">${text}</source></context><user_query>${message}</user_query>`,
      conversationId
    );

  test('storage-only turns perform exactly ingestion semantics and no evidence-reference model call', async () => {
    const structured = llm.generateStructured;
    llm.generateStructured.mockClear();
    const answer = await upload(
      'Bitte speichern.',
      'Standort Nord.csv',
      'Datum;Bestand (kg)\n2025-01-01;95\n2025-01-02;80',
      'storage-chat'
    );
    expect(answer.responseText).toContain('abgelegt');
    expect(llm.generateStructured).toBe(structured);
    expect(llm.generateStructured.mock.calls).toHaveLength(1);
    expect(JSON.parse(llm.generateStructured.mock.calls[0][1]).filename).toBe('Standort Nord.csv');
    expect(llm.generateText).not.toHaveBeenCalled();
    expect(llm.generateChat).not.toHaveBeenCalled();
    // A known structural result with a dataset ID alone is also a receipt, not a read.
    const supplement = require('../src/workbench-project-manifest').supplementDatasetAnswer;
    llm.generateStructured.mockClear();
    expect(
      await supplement(
        app.workbench,
        ctx(),
        { p: p(), envelope: { userRequest: 'Bitte speichern.' }, pending: {}, meta: meta() },
        { handled: true, datasetId: 'stored-only', responseText: 'Abgelegt.' }
      )
    ).toBeNull();
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  test('a content request attached to an upload keeps descriptor evidence before the storage shortcut', async () => {
    const first = await intake();
    const answer = await upload(
      'Ordne den Bestand am Standort Nord anhand der Angaben ein.',
      'Standort Nord.csv',
      'Datum;Bestand (kg)\n2025-01-01;95\n2025-01-02;80',
      'content-upload'
    );
    expect(answer.tenantEvidenceSelection).toContainEqual({
      sourceType: 'case',
      sourceId: first.cetCaseId,
    });
    expect(answer.tenantEvidenceSelection.some((item) => item.sourceType === 'dataset')).toBe(true);
    expect(answer.responseText).toContain('Ich habe dafür');
    expect(answer.responseText).toContain('95 kg');
  });

  test('independent prior session, document and dataset are read together without counting uploads as session evidence', async () => {
    const first = await intake();
    await upload(
      'Bitte speichern.',
      'Standort Nord.csv',
      'Datum;Bestand (kg)\n2025-01-01;95\n2025-01-02;80',
      'table-chat'
    );
    const doc = await app.call('knowledge-rag.documentIngest', {
      name: 'Standort Nord.txt',
      text: '# Standort Nord\n## Bestand\nDer Bestand beträgt 80 kg.',
      refs: [{ conversationId: 'document-chat', channel: 'api' }],
    });
    expect(doc).toBeTruthy();
    const answer = await chat(question, 'mixed-chat');
    expect(
      answer.tenantEvidenceSelection
        .map((entry) => entry.sourceType)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(['case', 'dataset', 'document']);
    expect(answer.tenantEvidenceSelection).toContainEqual({
      sourceType: 'case',
      sourceId: first.cetCaseId,
    });
    expect(answer.evidence).toHaveLength(3);
    expect(
      new Set(
        answer.evidence.map((entry) => `${entry.metadata.sourceType}:${entry.metadata.sourceId}`)
      ).size
    ).toBe(3);
    expect(answer.responseText).toContain('Standort Nord.txt');
    expect(answer.responseText).toContain('Standort Nord.csv');
    expect(answer.responseText).toContain('aus Fall F-1');
  });

  test('an upload-derived case conclusion and a document-derived statement are not offered a second time', async () => {
    const first = await intake();
    let saved = await app.workbench.store.getTurnMemory({
      tenantId: 'tenant-a',
      caseId: first.cetCaseId,
    });
    await app.workbench.store.turnMemoryDb.put({
      ...saved,
      evidenceOrigin: { ...saved.evidenceOrigin, uploadBacked: true },
    });
    await saveFact({
      documentSource: { title: 'Standort Nord.txt', version: 1, location: 'Bestand' },
    });
    expect(await sessionCandidates(ctx(), question, 'case')).toEqual([]);
    expect(await sessionCandidates(ctx(), question, 'memory')).toEqual([]);
    // Old records do not yet describe derivation. The registry suppresses overlapping uploads.
    saved = await app.workbench.store.getTurnMemory({
      tenantId: 'tenant-a',
      caseId: first.cetCaseId,
    });
    delete saved.evidenceOrigin;
    await app.workbench.store.turnMemoryDb.put(saved);
    await app.call('knowledge-rag.documentIngest', {
      name: 'Standort Nord.txt',
      text: '# Standort Nord\n## Bestand\nDer Bestand beträgt 80 kg.',
      refs: [{ conversationId: 'old-chat', channel: 'api', caseId: first.cetCaseId }],
    });
    const candidates = await require('../src/tenant-evidence-sources').evidenceCandidates(
      ctx(),
      question
    );
    expect(candidates.some((entry) => entry.sourceType === 'document')).toBe(true);
    expect(candidates.some((entry) => entry.sourceType === 'case')).toBe(false);
  });

  test('unrelated questions return the previous answer byte for byte when no session is relevant', async () => {
    await intake();
    const message = 'Welche Temperatur ist im Depot West belegt?';
    const first = await chat(message, 'unrelated-chat');
    const candidates = require('../src/evidence-endpoint-catalog');
    const spy = jest.spyOn(candidates, 'projectEvidenceCandidates').mockResolvedValue([]);
    try {
      const previous = await chat(message, 'unrelated-chat');
      expect(first.responseText).toBe(previous.responseText);
      expect(first.tenantEvidenceSelection).toBeUndefined();
      expect(first.caseProposal).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

test('the same subject without a matching content facet is not enough to select a session', async () => {
  await intake();
  const answer = await chat(
    'Welche Temperatur wurde am Standort Nord gemessen?',
    'different-content'
  );
  expect(answer.tenantEvidenceSelection).toBeUndefined();
});

test('statements with a legacy conversation reference inherit the authorized source case boundary', async () => {
  const first = await intake();
  await saveFact({ conversationId: 'old-chat', channel: undefined });
  const selected = (await sessionCandidates(ctx(), question, 'memory'))[0];
  expect(selected).toBeTruthy();
  const state = await app.router.loadCase(p(), first.cetCaseId);
  state.sensitivityFlags = ['restricted'];
  await app.router.saveState(p('tenant-a', 'actor-a', ['restricted']), state);
  expect(await sessionCandidates(ctx(), question, 'memory')).toEqual([]);
  expect((await readSessionEvidence(ctx(), selected)).evidence).toEqual([]);
  expect((await chat(question, 'denied-memory-source')).tenantEvidenceSelection).toBeUndefined();
});

test('a legacy case summary without a turn-memory record is backfilled only on demand', async () => {
  const first = await intake();
  const saved = await app.workbench.store.getTurnMemory({
    tenantId: 'tenant-a',
    caseId: first.cetCaseId,
  });
  await app.workbench.store.turnMemoryDb.remove(saved);
  await sessionCandidates(ctx(), 'Welche Temperatur ist im Depot West belegt?', 'case');
  expect(
    await app.workbench.store.getTurnMemory({ tenantId: 'tenant-a', caseId: first.cetCaseId })
  ).toBeNull();
  const selected = (await sessionCandidates(ctx(), question, 'case'))[0];
  expect(selected).toBeTruthy();
  expect((await readSessionEvidence(ctx(), selected)).evidence[0].value).toContain('80 kg');
  expect(
    (await app.workbench.store.getTurnMemory({ tenantId: 'tenant-a', caseId: first.cetCaseId }))
      .evidenceDescriptor
  ).toBeTruthy();
});

test('legacy situation text with an added greeting never becomes session evidence', () => {
  const text = 'Für den Bestand am Objekt Nord wird eine Einordnung angefragt.';
  expect(
    require('../src/tenant-evidence-sessions').caseRow(
      {
        tenantId: 'tenant-a',
        cetCaseId: 'legacy-case',
        knownContext: { situation: { concern: 'Bestand am Objekt Nord', situation: text } },
        lastClassification: { answerStatus: 'model_knowledge' },
      },
      {
        memory: { topic: 'Bestand am Objekt Nord', lastSafeConclusion: `Guten Tag, ${text}` },
      },
      []
    )
  ).toBeNull();
});
