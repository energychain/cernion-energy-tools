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

test('a recalled user statement keeps its full wording and origin', async () => {
  const stored =
    'Abteilungsleitung A (Netzwirtschaft, 01.11.2026); Herkunft: Nutzerangabe: „Für Aufgabe X bin ich verantwortlich (V); Team Y führt durch (D).“ (gültig).';
  llm.generateStructured.mockResolvedValueOnce({ answer: 'Abteilungsleitung A, V, Nutzerangabe.' });
  const shortened = await documentQuestion(documents, 'Welche Rollenzeile habe ich genannt?', {
    userStatements: [stored],
    conversationStatements: [stored],
  });
  expect(shortened.responseText).toContain(
    '„Für Aufgabe X bin ich verantwortlich (V); Team Y führt durch (D).“'
  );
  expect(llm.generateStructured.mock.calls[0][1]).toContain('userStatementInstruction');
  llm.generateStructured.mockResolvedValueOnce({
    answer:
      'Du hast „Für Aufgabe X bin ich verantwortlich (V); Team Y führt durch (D)“ genannt (Nutzerangabe).',
  });
  const complete = await documentQuestion(documents, 'Welche Rollenzeile habe ich genannt?', {
    userStatements: [stored],
    conversationStatements: [stored],
  });
  expect(complete.responseText).not.toContain('Gespeicherte Angabe');
});

test('a statement from another conversation is never appended as the recalled wording', async () => {
  const elsewhere =
    'Abteilungsleitung A (Netzwirtschaft, 01.11.2026); Herkunft: Nutzerangabe: „Kennung Y lautet 42.“ (gültig).';
  llm.generateStructured.mockResolvedValueOnce({
    answer: 'Zu Kennung X liegen weder Dokumentbelege noch Nutzerangaben vor.',
  });
  const reply = await documentQuestion(documents, 'Welche Kennung X gilt?', {
    userStatements: [elsewhere],
    conversationStatements: [],
  });
  expect(reply.responseText).not.toContain('Kennung Y');
});

test('a correction of this conversation is added when the answer only cites the documents', async () => {
  const stored =
    'Abteilungsleitung A (Netzwirtschaft, 03.11.2026); Herkunft: Nutzerangabe: „Die Kundennummer beim Messstellenbetreiber lautet MSB-SYN-0001.“ (gültig).';
  llm.generateStructured.mockResolvedValueOnce({
    answer: 'Zur Kundennummer beim Messstellenbetreiber enthalten die Dokumente keine Angabe.',
  });
  const reply = await documentQuestion(
    documents,
    'Welche Kundennummer beim Messstellenbetreiber gilt jetzt, und worauf beruht sie?',
    { userStatements: [stored], conversationStatements: [stored] }
  );
  expect(reply.responseText).toContain(
    '„Die Kundennummer beim Messstellenbetreiber lautet MSB-SYN-0001.“'
  );
  expect(reply.responseText).toContain('Herkunft: Nutzerangabe');
  expect(llm.generateStructured.mock.calls[0][1]).toContain('gespeicherten Angaben der Person');
});

test('a discarded document answer names the rule and keeps this conversation’s statements', async () => {
  const warn = jest.fn();
  const statement =
    'Person (Netzwirtschaft, 04.11.2026); Herkunft: Nutzerangabe: „Für die Priorisierung der Aufgabe A bin ich verantwortlich (V).“ (gültig).';
  llm.generateStructured.mockResolvedValue({ answer: 'Siehe {"a": 1}' });
  const { responseText, metadata } = await documentQuestion(documents, 'Was habe ich genannt?', {
    logger: { warn },
    userStatements: [statement],
    conversationStatements: [statement],
  });
  expect(warn).toHaveBeenCalledWith('Document answer discarded', { reason: 'json', chars: 14 });
  expect(responseText).toContain('nicht zustande gekommen');
  expect(responseText).toContain(
    '„Für die Priorisierung der Aufgabe A bin ich verantwortlich (V).“ (Herkunft: Nutzerangabe)'
  );
  expect(metadata.degradedReason).toBe('document_answer_stored_statements');
});

test('without statements of this conversation the generic fallback stays', async () => {
  llm.generateStructured.mockResolvedValue({ answer: '```json```' });
  const { responseText } = await documentQuestion(documents, 'Worum geht es?', {
    userStatements: ['Andere (03.11.2026); Herkunft: Nutzerangabe: „Fremde Angabe.“ (gültig).'],
  });
  expect(responseText).toContain('nicht zuverlässig beantworten');
  expect(responseText).not.toContain('Fremde Angabe');
});

describe('stored wording in the internal-description check', () => {
  const row =
    'Für die Priorisierung der Aufgabe B bin ich verantwortlich (V); das Team C führt sie durch (D).';
  const statement = `Person (Netzwirtschaft, 04.11.2026); Herkunft: Nutzerangabe: „${row}“ (gültig).`;
  const internalContext = [`Die Person nennt ihre Rolle. ${row}`, 'Der Stand wird intern geklärt.'];

  test('quoting the stored statement that the situation repeats is no leak', async () => {
    llm.generateStructured.mockResolvedValue({
      answer: `Deine Rollenzeile:\n„${row}“\nHerkunft: Nutzerangabe.`,
    });
    const { responseText } = await documentQuestion(documents, 'Welche Rollenzeile?', {
      internalContext,
      userStatements: [statement],
      conversationStatements: [statement],
    });
    expect(responseText).toContain(row);
    expect(responseText).not.toContain('nicht zustande gekommen');
  });

  test('a sentence of the internal situation is removed, the rest of the answer stays', async () => {
    const warn = jest.fn();
    llm.generateStructured.mockResolvedValue({
      answer: `„${row}“\nDer Stand wird intern geklärt.`,
    });
    const { responseText } = await documentQuestion(documents, 'Welche Rollenzeile?', {
      logger: { warn },
      internalContext,
      userStatements: [statement],
      conversationStatements: [statement],
    });
    expect(responseText).toContain(row);
    expect(responseText).not.toContain('intern geklärt');
    expect(warn).toHaveBeenCalledWith(
      'Document answer pruned',
      expect.objectContaining({ reason: 'internal_description', removedSentences: 1 })
    );
  });

  test('too little left after removing leaked sentences keeps the fallback', async () => {
    const warn = jest.fn();
    llm.generateStructured.mockResolvedValue({
      answer: 'Kurz gesagt: ja.\nDer Stand wird intern geklärt.',
    });
    const { responseText } = await documentQuestion(documents, 'Welche Rollenzeile?', {
      logger: { warn },
      internalContext,
      userStatements: [statement],
      conversationStatements: [statement],
    });
    expect(responseText).not.toContain('intern geklärt');
    expect(responseText).toContain('nicht zustande gekommen');
    expect(warn).toHaveBeenCalledWith(
      'Document answer discarded',
      expect.objectContaining({ reason: 'internal_description' })
    );
  });
});
