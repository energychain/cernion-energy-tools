'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
}));
const path = require('node:path');
const llm = require('../src/llm-client');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { loadDocuments } = require('../src/workbench-document');
const { SITUATION_SCHEMA } = require('../src/workbench-understanding');
const validateSituation = new (require('ajv'))({ strict: false }).compile(SITUATION_SCHEMA);
const internal = [
  'Die Anfrage zielt auf die Klärung noch offener Punkte ab.',
  'Zur Klärung des Bearbeitungsstands ist das Protokoll auszuwerten.',
];
const source = 'Das Freigabeprotokoll dokumentiert eine offene Freigabe. Die Bestätigung fehlt.';
const documentedAnswer = 'Im Freigabeprotokoll.txt ist die Freigabe offen; die Bestätigung fehlt.';
function situationFixture(shape, documentAction = 'none') {
  const value = {
    concern: internal[0],
    situation: internal.join(' '),
    participants: [],
    identifiers: [],
    deadlines: [],
    hypotheses: [],
    missingInformation: [],
    requestedAction: { description: '', externalEffect: false, draftRequested: false },
    turnKind: shape === 'task' ? 'work' : 'knowledge',
    conversationShape: shape,
    retrievalTerms: [],
    documentKnowledge: { action: documentAction, query: 'Freigabeprotokoll', id: '', version: 0 },
  };
  if (!validateSituation(value)) throw new Error(JSON.stringify(validateSituation.errors));
  return value;
}
const claim = (text) => ({
  text,
  origin: 'model',
  supported: 'model',
  specific: false,
  completedAction: false,
  evidenceIds: [],
});
let app, documentList;
beforeEach(async () => {
  app = await createCaseBroker();
  app.broker.createService({
    ...require('../services/object-store.service'),
    settings: { dbPath: path.join(app.dir, 'objects') },
  });
  app.broker.createService(require('../services/files.service'));
  documentList = jest.fn(() => []);
  app.broker.createService({
    name: 'knowledge-rag',
    actions: { documentList, query: () => ({ results: [] }) },
  });
  llm.generateText.mockReset().mockImplementation(async () =>
    JSON.stringify({
      interpretation: internal.map(claim),
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  llm.generateStructured.mockReset();
  await app.broker.start();
});
afterEach(async () => app.cleanup());
const chat = (message, fileRefs = []) =>
  app.call('workbench.chat', {
    channel: 'open-webui',
    conversationId: 'document-regression',
    message,
    fileRefs,
  });

test.each(['knowledge', 'assistance', 'task'])(
  'uploaded source and followup use stored document despite %s classification and a catalog read',
  async (shape) => {
    const docRequests = [];
    llm.generateStructured.mockImplementation(async (schema, raw) => {
      const input = JSON.parse(raw);
      if (schema.properties?.requestedAction) return situationFixture(shape, 'read');
      if (schema.properties?.answer) {
        docRequests.push(input);
        return { answer: documentedAnswer };
      }
      throw new Error('Unexpected model schema');
    });
    const ref = await app.call('files.upload', {
      name: 'Freigabeprotokoll.txt',
      contentBase64: Buffer.from(source).toString('base64'),
    });
    const first = await chat('Was steht im beigefügten Protokoll?', [ref]);
    expect(first.responseText).toContain(documentedAnswer);
    expect(documentList).not.toHaveBeenCalled();
    expect(first.responseText).not.toMatch(/Welche konkrete Datei|nicht vorhanden/);
    const docs = await loadDocuments(app.workbench.store, {
      tenantId: 'tenant-a',
      actorId: auth().apiToken.id,
      caseId: first.cetCaseId,
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].text).toBe(source);
    llm.generateStructured.mockImplementation(async (schema, raw) => {
      const input = JSON.parse(raw);
      if (schema.properties?.requestedAction) return situationFixture(shape, 'read');
      if (schema.properties?.answer) {
        docRequests.push(input);
        return { answer: documentedAnswer };
      }
      throw new Error('Unexpected model schema');
    });
    const next = await chat('Was ist noch offen?');
    expect(next.responseText).toContain(documentedAnswer);
    expect(next.cetCaseId).toBe(first.cetCaseId);
    for (const reply of [first, next])
      for (const text of internal) expect(reply.responseText).not.toContain(text);
    expect(docRequests).toHaveLength(2);
    expect(
      docRequests.every((request) => request.sections.some((part) => part.text === source))
    ).toBe(true);
    expect(llm.generateText).not.toHaveBeenCalled();
  }
);

test('a response composed of separate internal description sentences is repaired through a full turn', async () => {
  llm.generateStructured.mockImplementation(async (schema) => {
    if (schema.properties?.requestedAction) return situationFixture('knowledge');
    throw new Error('Unexpected model schema');
  });
  llm.generateText
    .mockResolvedValueOnce(
      JSON.stringify({
        interpretation: internal.map(claim),
        expectation: [],
        nextSteps: [],
        draft: [],
      })
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        interpretation: [
          claim('Ohne eine Unterlage lässt sich der aktuelle Stand noch nicht belegen.'),
        ],
        expectation: [],
        nextSteps: [],
        draft: [],
      })
    );
  const reply = await chat('Was ist noch offen?');
  expect(reply.responseText).toContain('Ohne eine Unterlage');
  for (const text of internal) expect(reply.responseText).not.toContain(text);
  expect(llm.generateText).toHaveBeenCalledTimes(2);
});

test('repeated internal-only model responses never become the delivered answer', async () => {
  llm.generateStructured.mockImplementation(async () => situationFixture('knowledge'));
  const reply = await chat('Was ist noch offen?');
  for (const text of internal) expect(reply.responseText).not.toContain(text);
  expect(reply.answerStatus).toBe('fallback');
  expect(reply.responseText).toContain('verlässliche neue Bewertung');
});
