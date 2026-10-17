'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { documentQuestion } = require('../src/workbench-document-question');
const { chatMemoryBudget } = require('../src/workbench-document-knowledge');

const documents = [
  {
    name: 'Arbeitsstand.pdf',
    text: 'Kapitel 1 Überblick\nDer Arbeitsstand beschreibt das Vorgehen.\n\nKapitel 2 Nächste Schritte\nOffene Punkte werden geklärt.',
  },
];

beforeEach(() => llm.generateStructured.mockReset());

test('a spent tenant quota is reported instead of the generic document fallback', async () => {
  llm.generateStructured.mockRejectedValue(
    Object.assign(new Error('quota'), {
      type: 'LLM_QUOTA_EXCEEDED',
      data: { resource: 'llm_tokens_per_day', resetAt: '2026-10-17T00:00:00.000Z' },
    })
  );
  const { responseText } = await documentQuestion(documents, 'Worum geht es?', {});
  expect(responseText).toContain('Tageskontingent');
  expect(responseText).not.toContain('nicht zuverlässig beantworten');
});

test('other model errors keep the existing document fallback', async () => {
  llm.generateStructured.mockRejectedValue(new Error('provider failed'));
  const { responseText } = await documentQuestion(documents, 'Worum geht es?', {});
  expect(responseText).toContain('nicht zuverlässig beantworten');
});

test('a document answer containing only internal description sentences uses the neutral fallback', async () => {
  const internalContext = [
    'Die Anfrage betrifft einen noch offenen Punkt. Der dokumentierte Stand soll geklärt werden.',
  ];
  llm.generateStructured.mockResolvedValue({
    answer: 'Der dokumentierte Stand soll geklärt werden.',
  });
  const reply = await documentQuestion(documents, 'Was ist noch offen?', { internalContext });
  expect(reply.responseText).not.toContain('Stand soll geklärt werden');
  expect(reply.metadata.degraded).toBe(true);
});

test('chat document memory budget allows the configured number of sections only', async () => {
  const budget = chatMemoryBudget(2);
  const claims = [];
  for (let i = 0; i < 4; i += 1) claims.push(await budget.claimSection());
  expect(claims).toEqual([true, true, false, false]);
});

test('a document answer cannot concatenate unpunctuated internal fields into an answer', async () => {
  const internalContext = ['Die Frage nach dem Stand', 'Klärung der offenen Angaben'];
  llm.generateStructured.mockResolvedValue({ answer: internalContext.join(' ') });
  const reply = await documentQuestion(documents, 'Was ist noch offen?', { internalContext });
  expect(reply.responseText).not.toContain(internalContext[0]);
  expect(reply.metadata.degraded).toBe(true);
});

test('chat document memory budget defaults to 50 and 0 disables the cap', async () => {
  delete process.env.CET_DOCUMENT_MEMORY_MAX_SECTIONS;
  const capped = chatMemoryBudget();
  let allowed = 0;
  for (let i = 0; i < 60; i += 1) if (await capped.claimSection()) allowed += 1;
  expect(allowed).toBe(50);
  const unlimited = chatMemoryBudget(0);
  for (let i = 0; i < 60; i += 1) expect(await unlimited.claimSection()).toBe(true);
});
