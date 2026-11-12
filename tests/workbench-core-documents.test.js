'use strict';

jest.mock('../src/workbench-document', () => ({
  ...jest.requireActual('../src/workbench-document'),
  attachDocuments: jest.fn(async () => []),
  loadDocuments: jest.fn(async () => [
    {
      id: 'doc-1',
      name: 'archiv.png',
      text: `# Treffer\n${'Zeile mit Referenz REQ-1. '.repeat(90)}`,
    },
    { id: 'doc-2', name: 'leer.pdf', text: '   ' },
  ]),
}));
jest.mock('../src/workbench-document-question', () => ({
  ...jest.requireActual('../src/workbench-document-question'),
  documentQuestion: jest.fn(async () => ({ responseText: 'Dokumentantwort' })),
}));
const { documentReply, caseDocumentEvidence } = require('../src/workbench-document-flow');
const { documentQuestion } = require('../src/workbench-document-question');

const run = (question) =>
  documentReply(
    { store: {}, broker: { getLocalService: () => null }, logger: {} },
    { meta: {} },
    {
      p: { tenantId: 'tenant-core', roles: [] },
      envelope: { userRequest: question, conversationId: 'c' },
      caseId: 'case-1',
      situation: {},
      retrieval: { evidence: [] },
    }
  );

afterEach(() => {
  delete process.env.WORKBENCH_CONVERSATION_CORE;
  jest.clearAllMocks();
});

test('conversation core: case documents become evidence of the regular answer', async () => {
  process.env.WORKBENCH_CONVERSATION_CORE = 'tenant-core';
  const result = await run('Was ändert die negative Suche an der Einordnung?');
  expect(documentQuestion).not.toHaveBeenCalled();
  expect(result.caseDocuments.length).toBeGreaterThan(1);
  expect(result.caseDocuments[0]).toMatchObject({
    source: 'archiv.png',
    retrievalSource: 'documents',
    metadata: { ownConversation: true, sourceId: 'doc-1', sectionId: '0' },
  });
  expect(result.caseDocuments.every((hit) => hit.value.length <= 1500)).toBe(true);
  expect(result.caseDocuments.some((hit) => hit.source === 'leer.pdf')).toBe(false);
});

test('without the core the document question path answers as before', async () => {
  const result = await run('Was ändert die negative Suche an der Einordnung?');
  expect(documentQuestion).toHaveBeenCalled();
  expect(result.responseText).toBe('Dokumentantwort');
});

test('the number of document sections is bounded', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `d${index}`,
    name: `d${index}`,
    text: 'Inhalt',
  }));
  expect(caseDocumentEvidence(many)).toHaveLength(24);
});
