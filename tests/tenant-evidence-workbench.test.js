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
const { complete, validate } = require('./helpers/workbench-schema-stub');
const llm = require('../src/llm-client');
const { SITUATION_SCHEMA } = require('../src/workbench-understanding');
let app, env, mode, phases, invalidNumber, proseMode;
const subject = 'Objekt Nord';
const docName = 'Objekt Nord.txt';
const tableName = 'Objekt Nord.csv';
const document = {
  name: docName,
  text: '# Objekt Nord\n## Bestand\nDer dokumentierte Bestand beträgt 80 Stück.\n## Prüfung\nDie Vollständigkeit ist offen.',
};
const table = {
  name: tableName,
  text: 'Datum;Bestand (Stück)\n2025-01-01;95\n2025-01-02;90\n2025-01-03;80',
};
const queries = [
  'Was ergibt sich daraus für die bereits vorliegenden Unterlagen?',
  'Welche Angaben zum Bestand für Objekt Nord ergeben sich aus den vorhandenen Quellen?',
  'Ordne den Bestand von Objekt Nord anhand der gespeicherten Unterlagen ein.',
  'Wie ist der dokumentierte Bestand am Objekt Nord gegenüber den erfassten Werten einzuordnen?',
];
const meta = (tenantId = 'tenant-a', clearance = [], actorId = 'actor-a') =>
  auth(actorId, ['ROLE_ALPHA'], tenantId, clearance);
const chat = (message, conversationId, documents = [], options = meta()) =>
  app.call(
    'workbench.chat',
    {
      channel: 'api',
      conversationId,
      userRequest: documents.length
        ? documents
            .map((doc) => `<context><source name="${doc.name}">${doc.text}</source></context>`)
            .join('') + `<user_query>${message}</user_query>`
        : message,
    },
    options
  );

function installStub() {
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    let result;
    if (input.task === 'evidence_request_kind') {
      result = {
        contentRequested:
          !['Bitte speichern.', 'Bitte ablegen.'].includes(input.question) &&
          !input.question.startsWith('Entferne'),
      };
    } else if (input.task === 'evidence_reference_resolution') {
      result = {
        sources: (input.question.includes('Depot West') ||
        input.question.includes('Temperatur') ||
        input.question === 'Bitte speichern.'
          ? []
          : input.currentSources.map((source) => source.id)
        ).map((id) => ({ id, relevance: 1 })),
      };
    } else if (input.nodes) {
      const sources = input.nodes
        .filter((node) => ['dataset', 'section'].includes(node.kind))
        .map((node) => node.nodeId);
      result = {
        summary: { text: 'Archivierte Grundlage einer lokalen Bestandsprüfung.', sources },
        entities: [{ name: 'Nördlicher Prüfgegenstand', kind: 'subject', sources }],
        timeRanges: [],
        questionTypes: [
          {
            id: 'stored-quantity',
            description:
              'Belegte Quantitäten der archivierten Ausgangslage und offenen Prüfung einordnen',
            inputs: [],
            skillRefs: [],
            sources,
          },
        ],
        externalLinks: [],
      };
    } else if (schema.properties?.timezone) {
      result = {
        title: 'Zeitlich geordnete Erfassung',
        description: 'Erfasster Bestand eines Objekts',
        anchors: input.filename?.includes('Export')
          ? []
          : [input.filename?.includes('Depot West') ? 'Depot West' : subject],
        timezone: 'Europe/Berlin',
        timeField: 'Datum',
        intervalConvention: 'begin',
        units: { Datum: '', 'Bestand (Stück)': 'Stück' },
        assumptions: [],
      };
    } else if (input.sourceId && input.profile) {
      result = {
        sources: [{ alias: 'source', sourceId: input.sourceId }],
        operations: [
          {
            op: 'aggregate',
            groupBy: [],
            metrics: [{ fn: 'max', field: 'Bestand (Stück)', as: 'maximum' }],
          },
          { op: 'limit', count: 10 },
        ],
      };
    } else if (input.untrustedEvidence) {
      if (proseMode === 'internal')
        return validate(schema, {
          answer:
            'Die Frage bezieht sich auf die Auswirkungen auf die bereits vorliegenden Unterlagen.',
        });
      if (proseMode === 'separate')
        return validate(schema, {
          answer: input.untrustedEvidence
            .map((entry) =>
              entry.metadata.sourceType === 'document'
                ? `Bestand: 80 Stück (${entry.metadata.sourceLabel}, Bestand).`
                : `Maximum: 95 Stück (${entry.metadata.sourceLabel}, Tabelle).`
            )
            .join(' '),
        });
      result = {
        answer:
          input.untrustedEvidence
            .map((entry) =>
              entry.metadata.sourceType === 'document'
                ? `Der dokumentierte Bestand beträgt ${invalidNumber ? 95 : 80} Stück (${entry.metadata.sourceLabel}, Bestand).`
                : `Die erfassten Werte reichen bis 95 Stück (${entry.metadata.sourceLabel}, Tabelle).`
            )
            .join(' ') +
          ' Die Angaben weichen ab; eine vollständige Zuordnung der Bezugsgrößen bleibt offen.',
      };
    } else if (input.sections) {
      result = {
        answer: `Der dokumentierte Bestand beträgt 80 Stück (${docName}, Bestand).`,
      };
    } else if (schema.properties?.concern) {
      result = {
        concern: 'Unterlagen aufnehmen',
        situation: 'Interner Situationstext, niemals Antwort.',
        turnKind: mode,
        conversationShape: input.message === 'Zur Kenntnis' ? 'filing' : 'knowledge',
        requestedAction: { description: '', externalEffect: false, draftRequested: false },
        missingInformation: [],
        documentKnowledge: input.message.startsWith('Entferne')
          ? { action: 'delete', basis: input.message, query: docName, id: '', version: 0 }
          : { action: 'none', basis: '', query: '', id: '', version: 0 },
        retrievalTerms: [],
        caseSearch: { requested: mode === 'knowledge', query: input.message },
        caseMemory: {
          applicable: input.message === 'Zur Kenntnis',
          topic: subject,
          status: 'Unterlage aufgenommen',
          openPoints: [],
          assumptions: [],
          risks: [],
          nextSteps: [],
        },
      };
    } else if (input.task === 'turn_controls') {
      result = {
        turnKind: mode === 'work' ? 'work_on_concrete_case' : 'knowledge_or_orientation',
        conversationShape: 'knowledge',
        missingInformation: [],
      };
    } else if (input.task === 'output_contract') {
      result = {
        requestedOutput: {
          requested: 'ordinary_answer',
          basis: '',
          kind: 'other',
          parts: [],
          constraints: [],
          forbiddenTerms: [],
          subjects: [],
        },
      };
    } else if (input.task === 'token_roles') {
      result = {
        tokens: input.candidates.map(({ index }) => ({
          index,
          category: 'other',
          family: '',
          meaningRequested: false,
        })),
      };
    } else if (input.currentUserMessage) {
      result = {
        basis: '',
        register: 'unchanged',
        concise: 'unchanged',
        questions: 'unchanged',
        wording: [],
        forbiddenTerms: [],
        preferenceOnly: false,
      };
    } else if (schema.properties?.caseIds) result = { caseIds: [] };
    else if (schema.properties?.assertions)
      result = {
        assertions: [],
        correction: { kind: 'none', basis: '', factId: '' },
        query: { requested: false, anchor: '', functionLabel: '' },
      };
    else result = {};
    result = complete(schema, result);
    if (schema.properties?.concern) {
      const local = structuredClone(result);
      local.requestedOutput.requested = false;
      validate(SITUATION_SCHEMA, local);
    }
    return validate(schema, result);
  });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [],
      expectation: [],
      nextSteps: [],
      assumptions: [],
      draft: [],
    })
  );
}

beforeEach(async () => {
  env = { ...process.env };
  mode = 'work';
  phases = [];
  invalidNumber = false;
  proseMode = 'complete';
  app = await createCaseBroker();
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(app.dir, 'tables');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  app.broker.middlewares.add({
    localAction(next, action) {
      return async (ctx) => {
        phases.push(action.name);
        return next(ctx);
      };
    },
  });
  for (const name of [
    'object-store',
    'knowledge-rag',
    'datapoint',
    'dataset',
    'shared-service-learning',
  ]) {
    const schema = require(`../services/${name}.service`);
    app.broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(app.dir, name) },
    });
  }
  llm.generateStructured.mockReset();
  llm.generateText.mockReset();
  installStub();
  await app.broker.start();
});
afterEach(async () => {
  await app?.cleanup();
  process.env = env;
});

async function twoChats(options = meta()) {
  const first = await chat('Zur Kenntnis', 'chat-document', [document], options);
  const result = await chat('Bitte speichern.', 'chat-table', [table], options);
  expect(result.responseText).toBeTruthy();
  expect(result.caseProposal?.cetCaseId).toBe(first.cetCaseId);
  expect(result.responseText).toContain('Der neue Upload passt zu Fall');
  for (const name of ['knowledge-rag', 'datapoint']) {
    const service = app.broker.getLocalService(name);
    while (service.evidenceWorker?.pending.size)
      await require('../src/tenant-evidence-background').runDescriptorJob(service);
  }
  const rows = await app.call('knowledge-rag.documentList', {}, options);
  const datasets = await app.call('datapoint.datasetCatalog', { operation: 'list' }, options);
  expect(rows[0].evidenceDescriptor.manifest.summary.text).toContain('Archivierte');
  expect(datasets[0].evidenceDescriptor.manifest.summary.text).toContain('Archivierte');
  return { first, rows, datasets };
}

test.each(['work', 'knowledge'])(
  'full turn combines sources under %s classification and paraphrased descriptors',
  async (kind) => {
    const { first } = await twoChats();
    expect(first.cetCaseId).toBeTruthy();
    mode = kind;
    for (const query of queries) {
      phases.length = 0;
      const reply = await chat(query, 'chat-table');
      expect(reply.tenantEvidenceSelection).toHaveLength(2);
      expect(reply.evidence).toHaveLength(2);
      expect(reply.responseText).toContain('Ich habe dafür');
      expect(reply.responseText).toContain(docName);
      expect(reply.responseText).toContain(tableName);
      expect(reply.responseText).toContain('80 Stück');
      expect(reply.responseText).toContain('95 Stück');
      expect(reply.responseText).toContain('Die Angaben weichen ab');
      expect(reply.responseText).toContain('Zuordnung');
      expect(reply.responseText).toContain(first.caseDisplayRef);
      expect(reply.caseProposal.cetCaseId).toBe(first.cetCaseId);
      expect(reply.responseText).not.toMatch(
        /nicht hinterlegt|Letzte Einordnung|Interner Situationstext/u
      );
      expect(phases).not.toContain('workbench.query');
      expect(
        reply.evidence.every(
          (entry) => entry.metadata.hash && entry.metadata.filename && entry.metadata.location
        )
      ).toBe(true);
    }
  }
);

test('a question attached to the second upload combines both sources immediately', async () => {
  const first = await chat('Zur Kenntnis', 'chat-document', [document]);
  const reply = await chat(queries[0], 'chat-table', [table]);
  expect(reply.tenantEvidenceSelection).toHaveLength(2);
  expect(reply.caseProposal.cetCaseId).toBe(first.cetCaseId);
});

// Cross-chat selection is covered by the two-chat tests above and below.
test('uploads of the current conversation alone stay in the regular turn', async () => {
  await chat('Zur Kenntnis', 'chat-document', [document]);
  const same = await chat(queries[0], 'chat-document');
  expect(same.tenantEvidenceSelection).toBeUndefined();
  expect(same.responseText).not.toContain('Ich habe dafür');
});

test('unrelated question offers nothing and does not read either source', async () => {
  await twoChats();
  phases.length = 0;
  const reply = await chat('Welche Temperatur wurde im Depot West beobachtet?', 'unrelated');
  expect(reply.tenantEvidenceSelection).toBeUndefined();
  expect(phases).not.toContain('dataset.query');
  expect(reply.caseProposal).toBeUndefined();
  expect(reply.responseText).not.toContain(docName);
});

test('tenant and clearance filtering apply before descriptor discovery and fresh reads', async () => {
  await twoChats(meta('tenant-a', ['restricted']));
  const rows = await app.call('knowledge-rag.documentList', {}, meta('tenant-a', ['restricted']));
  // A separately classified confidential copy must not become public through its descriptor.
  await app.call(
    'knowledge-rag.documentIngest',
    { ...document, name: 'Geheim.txt', sensitivityFlags: ['restricted'] },
    meta('tenant-a', ['restricted'])
  );
  const restricted = await app.call(
    'knowledge-rag.documentEvidenceCandidates',
    { question: queries[0] },
    meta()
  );
  expect(restricted.some((candidate) => candidate.title === 'Geheim.txt')).toBe(false);
  phases.length = 0;
  const reply = await chat(queries[0], 'other-tenant', [], meta('tenant-b'));
  expect(reply.tenantEvidenceSelection).toBeUndefined();
  expect(reply.responseText).not.toContain(docName);
  expect(phases).not.toContain('dataset.query');
  await expect(
    app.call('knowledge-rag.documentGet', { id: rows[0].id }, meta('tenant-b'))
  ).rejects.toBeTruthy();
});

test('learning correction persists for later turns and remains actor scoped', async () => {
  const { rows, datasets } = await twoChats();
  const reply = await chat(queries[0], 'chat-table');
  expect(reply.tenantEvidenceSelection).toHaveLength(2);
  expect((await chat('passt nicht', 'chat-table')).responseText).toContain(
    'Korrektur ist gespeichert'
  );
  expect((await chat(queries[1], 'chat-table')).tenantEvidenceSelection).toBeUndefined();
  const candidates = await app.call('dataset.evidenceCandidates', { question: queries[0] });
  expect(
    candidates.find((candidate) => candidate.sourceId === datasets[0].id).corrections[0].kind
  ).toBe('reject');
  const row = await app.call('knowledge-rag.documentGet', { id: rows[0].id });
  expect(row.evidenceCorrections[0].kind).toBe('reject');
  const other = await chat(queries[1], 'other-actor', [], meta('tenant-a', [], 'actor-b'));
  expect(other.tenantEvidenceSelection).toHaveLength(2);
});

test('source-specific numeric guard rejects a table value attributed to the document', async () => {
  await twoChats();
  invalidNumber = true;
  const reply = await chat(queries[0], 'chat-table');
  expect(reply.responseText).not.toContain(`95 Stück (${docName}`);
  expect(reply.responseText).toContain('80 Stück');
  expect(reply.evidence).toHaveLength(2);
});

test('a different question in the bound chat does not borrow its subject from the uploaded table', async () => {
  await twoChats();
  phases.length = 0;
  const reply = await chat('Welche Temperatur wurde im Depot West beobachtet?', 'chat-table');
  expect(reply.tenantEvidenceSelection).toBeUndefined();
  expect(reply.caseProposal).toBeUndefined();
  expect(phases).not.toContain('dataset.query');
});

test('clearance denies both descriptor candidates and fresh table reads', async () => {
  const { datasets } = await twoChats();
  await app.call(
    'datapoint.datasetCatalog',
    {
      operation: 'put',
      record: { ...datasets[0], sensitivityLevel: 'restricted', requiredClearance: ['restricted'] },
    },
    meta('tenant-a', ['restricted'])
  );
  expect(await app.call('dataset.evidenceCandidates', { question: queries[1] }, meta())).toEqual(
    []
  );
  const query = await app.call(
    'dataset.query',
    { id: datasets[0].id, question: queries[1] },
    meta()
  );
  expect(query.datasetId).toBeUndefined();
  expect(
    await app.call(
      'dataset.evidenceCandidates',
      { question: queries[1] },
      meta('tenant-a', ['restricted'])
    )
  ).toHaveLength(1);
});

test('legacy descriptors are backfilled only on demand without bulk migration', async () => {
  const { datasets } = await twoChats();
  const value = {
    ...datasets[0],
    id: 'ds_012345678901234567890123456789ab',
    sourceName: 'Depot West.csv',
    title: 'Depot West',
    semantic: { ...datasets[0].semantic, anchors: ['Depot West'] },
  };
  delete value.evidenceDescriptor;
  await app.call('datapoint.datasetCatalog', { operation: 'put', record: value });
  const service = app.broker.getLocalService('datapoint');
  const { catalogPrefix } = require('../src/dataset-catalog');
  for (const record of [datasets[0], value]) {
    const stored = await service.db.get(catalogPrefix('tenant-a') + record.id);
    delete stored.data.value.evidenceDescriptor;
    await service.db.put(stored);
  }
  llm.generateStructured.mockClear();
  await app.call('dataset.evidenceCandidates', { question: queries[1] });
  const records = await app.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(records.find((row) => row.id === datasets[0].id).evidenceDescriptor).toBeTruthy();
  expect(records.find((row) => row.id === value.id).evidenceDescriptor).toBeUndefined();
  expect(
    llm.generateStructured.mock.calls.filter(([, prompt]) => JSON.parse(prompt).nodes)
  ).toHaveLength(0);
});

test('a document answer fallback is visible to the user but never stored as a case conclusion', async () => {
  const model = llm.generateStructured.getMockImplementation();
  llm.generateStructured.mockImplementation(async (schema, prompt) => {
    if (JSON.parse(prompt).sections) throw new Error('synthetic answer unavailable');
    return model(schema, prompt);
  });
  const reply = await chat('Welche Angaben enthält die Unterlage?', 'failed-document', [document]);
  expect(reply.responseText).toContain('nicht zuverlässig beantworten');
  expect(reply.cetCaseId).toBeTruthy();
  expect(reply.turnMemorySummary?.lastSafeConclusion || '').not.toContain('nicht zuverlässig');
  const state = await app.router.loadCase(
    require('../src/domain-router-policy').principal({ meta: meta() }),
    reply.cetCaseId
  );
  expect(state.lastClassification.responseText || '').not.toContain('nicht zuverlässig');
});

test('origin-case visibility gates discovery and revalidates a previously visible selection', async () => {
  const { first } = await twoChats();
  const selected = (await app.call('dataset.evidenceCandidates', { question: queries[1] }))[0];
  const { principal } = require('../src/domain-router-policy');
  const permitted = meta('tenant-a', ['restricted']);
  const p = principal({ meta: permitted });
  const state = await app.router.loadCase(p, first.cetCaseId);
  state.sensitivityFlags = ['restricted'];
  await app.router.saveState(p, state);
  await app.call(
    'workbench.conversations.linkCase',
    { channel: 'api', conversationId: 'chat-table', cetCaseId: first.cetCaseId },
    permitted
  );
  phases.length = 0;
  expect(
    await app.call('knowledge-rag.documentEvidenceCandidates', { question: queries[1] })
  ).toEqual([]);
  expect(await app.call('dataset.evidenceCandidates', { question: queries[1] })).toEqual([]);
  const fresh = await require('../src/tenant-evidence-read').readChatEvidence(
    {
      broker: app.broker,
      meta: meta(),
      params: { conversationId: 'chat-table' },
      call: (name, input) => app.call(name, input, meta()),
    },
    selected,
    queries[1]
  );
  expect(fresh.evidence).toEqual([]);
  expect(phases).not.toContain('dataset.query');
  const reply = await chat(queries[1], 'public-chat');
  expect(reply.tenantEvidenceSelection).toBeUndefined();
  expect(
    await app.call('dataset.evidenceCandidates', { question: queries[1] }, permitted)
  ).toHaveLength(1);
});

test('a missing descriptor with no relevant source retains the empty-tenant response', async () => {
  mode = 'knowledge';
  const query = 'Welche Temperatur wurde im Depot West beobachtet?';
  const before = await chat(query, 'empty');
  await twoChats();
  const after = await chat(query, 'unrelated-after-upload');
  expect(after.responseText).toBe(before.responseText);
  expect(after.tenantEvidenceSelection).toBeUndefined();
});

test('a source-management request retains the document lifecycle workflow', async () => {
  await twoChats();
  const result = await chat(`Entferne ${docName}`, 'remove-source');
  expect(result.state).toBe('document_corrected');
  expect(result.tenantEvidenceSelection).toBeUndefined();
  expect(
    (await app.call('knowledge-rag.documentList', {})).some((row) => row.name === docName)
  ).toBe(false);
});

test('a document uploaded after the table uses the same combined-evidence turn', async () => {
  await chat('Bitte speichern.', 'table-first', [table]);
  const reply = await chat(queries[1], 'document-second', [document]);
  expect(reply.tenantEvidenceSelection).toHaveLength(2);
  expect(reply.responseText).toContain(docName);
  expect(reply.responseText).toContain(tableName);
  expect(reply.responseText).toContain('Die Angaben weichen ab');
});

test('an unrelated upload does not propose a case despite an overlapping generated classification', async () => {
  await chat('Zur Kenntnis', 'document-north', [document]);
  const reply = await chat('Bitte speichern.', 'table-west', [
    { ...table, name: 'Depot West.csv' },
  ]);
  expect(reply.caseProposal).toBeUndefined();
  expect(reply.responseText).not.toContain('Upload passt zu Fall');
});

test('later quality writes retain actor corrections from newer source snapshots', async () => {
  const { datasets } = await twoChats();
  await app.call('shared-service-learning.apply', {
    target: 'tenantEvidence',
    correction: {
      sourceType: 'dataset',
      sourceId: datasets[0].id,
      kind: 'reject',
    },
  });
  await app.call('datapoint.datasetCatalog', { operation: 'put', record: datasets[0] });
  const [candidate] = await app.call('dataset.evidenceCandidates', { question: queries[1] });
  expect(candidate.corrections).toMatchObject([{ actorId: 'actor-a', kind: 'reject' }]);
  await app.call('shared-service-learning.apply', {
    target: 'tenantEvidence',
    correction: {
      sourceType: 'dataset',
      sourceId: datasets[0].id,
      kind: 'confirm',
    },
  });
  const [confirmed] = await app.call('dataset.evidenceCandidates', { question: queries[1] });
  expect(confirmed.corrections).toMatchObject([{ actorId: 'actor-a', kind: 'confirm' }]);
});

test('generic file names resolve their shared observed anchor without sending cell values to descriptor/routing prompts', async () => {
  const first = await chat('Zur Kenntnis', 'generic-document', [
    {
      name: 'Unterlage.txt',
      text: '# Unterlage\n## Bestand\nBezug: REF-A123\nDie Unterlage nennt 80 Stück.',
    },
  ]);
  await chat('Bitte speichern.', 'generic-table', [
    {
      name: 'Export.csv',
      text: 'Bezug;Datum;Bestand (Stück)\nREF-A123;2025-01-01;95\nREF-A123;2025-01-02;90\nREF-A123;2025-01-03;80',
    },
  ]);
  // Exercise descriptor prompts explicitly; filing no longer spends a reference-resolution call.
  for (const name of ['knowledge-rag', 'datapoint']) {
    const service = app.broker.getLocalService(name);
    while (service.evidenceWorker?.pending.size)
      await require('../src/tenant-evidence-background').runDescriptorJob(service);
  }
  const reply = await chat(
    'Was ergibt sich daraus für die bereits vorliegenden Unterlagen?',
    'generic-table'
  );
  expect(reply.tenantEvidenceSelection).toHaveLength(2);
  expect(reply.responseText).toContain('Unterlage.txt');
  expect(reply.responseText).toContain('Export.csv');
  expect(reply.responseText).toContain('80 Stück');
  expect(reply.responseText).toContain('95 Stück');
  expect(reply.caseProposal?.cetCaseId).toBe(first.cetCaseId);
  const prompts = llm.generateStructured.mock.calls
    .map(([, prompt]) => JSON.parse(prompt))
    .filter((input) => input.nodes || input.task === 'evidence_reference_resolution');
  expect(prompts.length).toBeGreaterThan(1);
  expect(JSON.stringify(prompts)).not.toContain('REF-A123');
});

test.each(['separate', 'internal'])(
  'combined evidence answers despite %s prose, and retains both sources on the next turn',
  async (kind) => {
    const { first } = await twoChats();
    proseMode = kind;
    const initial = await chat(queries[1], 'chat-table');
    expect(initial.tenantEvidenceSelection).toHaveLength(2);
    expect(initial.responseText).toMatch(/Gegenüberstellung/u);
    expect(initial.responseText).toMatch(/80 Stück/u);
    expect(initial.responseText).toMatch(/95 Stück/u);
    expect(initial.responseText).toMatch(/weichen ab/u);
    expect(initial.responseText).toMatch(/bleibt offen/u);
    expect(initial.responseText).not.toMatch(/Die Frage bezieht sich/u);
    phases.length = 0;
    const reply = await chat(queries[0], 'chat-table');
    expect(reply.tenantEvidenceSelection).toHaveLength(2);
    expect(reply.responseText).toContain(docName);
    expect(reply.responseText).toContain(tableName);
    expect(reply.caseProposal.cetCaseId).toBe(first.cetCaseId);
    expect(reply.responseText).not.toMatch(/Die Frage bezieht sich|Welche konkreten Unterlagen/u);
    expect(phases).not.toContain('workbench.classify');
    const reference = llm.generateStructured.mock.calls
      .map(([, raw]) => JSON.parse(raw))
      .filter((input) => input.task === 'evidence_reference_resolution')
      .at(-1);
    expect(reference.previousSourceIds).toHaveLength(2);
    expect(
      reference.currentSources
        .map((source) => source.id.split(':')[0])
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(['dataset', 'document']);
  }
);

test('upload and lazy discovery return minimal descriptors without response-path model enrichment', async () => {
  await chat('Zur Kenntnis', 'chat-document', [document]);
  await chat('Bitte speichern.', 'chat-table', [table]);
  expect(llm.generateStructured.mock.calls.filter(([, raw]) => JSON.parse(raw).nodes)).toHaveLength(
    0
  );
  const candidates = await app.call('dataset.evidenceCandidates', { question: queries[1] });
  expect(candidates).toHaveLength(1);
  const reply = await chat(queries[1], 'chat-table');
  expect(reply.tenantEvidenceSelection).toHaveLength(2);
  expect(reply.responseText).toContain('Gegenüberstellung');
  expect(llm.generateStructured.mock.calls.filter(([, raw]) => JSON.parse(raw).nodes)).toHaveLength(
    0
  );
});

test('generated entities containing the quantity do not hide the earlier document', async () => {
  const original = llm.generateStructured.getMockImplementation();
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const result = await original(schema, raw);
    const input = JSON.parse(raw);
    if (!input.nodes) return result;
    result.entities = [
      { name: 'Bestand Objekt Nord', kind: 'subject', sources: [input.nodes[0].nodeId] },
    ];
    return validate(schema, result);
  });
  const first = await chat('Zur Kenntnis', 'chat-document', [
    { ...document, text: document.text.replace('# Objekt Nord', '# Objekt Nord Prüfbezugabcdef') },
  ]);
  await chat('Bitte speichern.', 'chat-table', [table]);
  for (const name of ['knowledge-rag', 'datapoint']) {
    const service = app.broker.getLocalService(name);
    while (service.evidenceWorker?.pending.size)
      await require('../src/tenant-evidence-background').runDescriptorJob(service);
  }
  const reply = await chat(
    'Ordne den Bestand am Objekt Nord Prüfbezugabcdef anhand der Unterlagen und Daten ein.',
    'chat-table'
  );
  expect(reply.tenantEvidenceSelection).toHaveLength(2);
  expect(reply.responseText).toContain(docName);
  expect(reply.responseText).toContain(tableName);
  expect(reply.responseText).toContain('Gegenüberstellung');
  expect(reply.caseProposal.cetCaseId).toBe(first.cetCaseId);
});

test('background enrichment retains newer corrections and never resurrects a removed dataset', async () => {
  await chat('Bitte speichern.', 'chat-table', [table]);
  const [stored] = await app.call('datapoint.datasetCatalog', { operation: 'list' });
  const source = app.broker.getLocalService('datapoint');
  const original = llm.generateStructured.getMockImplementation();
  let start, finish;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    if (JSON.parse(raw).nodes) {
      start();
      await new Promise((resolve) => {
        finish = resolve;
      });
    }
    return original(schema, raw);
  });
  const worker = require('../src/tenant-evidence-background').runDescriptorJob(source);
  await started;
  await app.call('shared-service-learning.apply', {
    target: 'tenantEvidence',
    correction: { sourceType: 'dataset', sourceId: stored.id, kind: 'reject' },
  });
  finish();
  await worker;
  const [current] = await app.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(current.evidenceCorrections[0].kind).toBe('reject');
  expect(current.evidenceDescriptor.generation).toBeTruthy();
  // A different metadata state queues another job; deletion while it runs is final.
  await app.call('datapoint.datasetCatalog', {
    operation: 'put',
    record: { ...current, title: 'Geänderte Erfassung' },
  });
  const nextStarted = new Promise((resolve) => {
    start = resolve;
  });
  const next = require('../src/tenant-evidence-background').runDescriptorJob(source);
  await nextStarted;
  await app.call('datapoint.datasetCatalog', { operation: 'remove', id: stored.id });
  finish();
  await next;
  expect(await app.call('datapoint.datasetCatalog', { operation: 'list' })).toEqual([]);
});
