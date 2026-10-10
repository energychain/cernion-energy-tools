'use strict';
jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer, understand, questionsFor } = require('../src/workbench-understanding');
const { persistentSituation } = require('../src/workbench-turn-scope');
const shape = require('../src/workbench-conversation-shape');
const claim = (text) => ({
  text,
  origin: 'model',
  supported: 'model',
  specific: false,
  completedAction: false,
  evidenceIds: [],
});
const situation = (conversationShape = 'orientation') => ({
  concern: 'Systemkenntnis',
  situation: '',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: { description: '', draftRequested: false, externalEffect: false },
  turnKind: 'knowledge',
  retrievalTerms: [],
  conversationShape,
});
beforeEach(() => jest.resetAllMocks());

test.each(['orientation', 'knowledge', 'filing'])(
  '%s omits internal expectations, assumptions and steps even when generated',
  async (kind) => {
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        interpretation: [claim('Ich kann dir fachlich dabei helfen.')],
        expectation: [claim('Der Nutzer erwartet Hilfe.')],
        assumptions: [claim('Es liegt ein Klärungsbedarf vor.')],
        nextSteps: [claim('Prüfe deinen Bedarf.')],
        draft: [claim('Guten Tag, hier ist der Entwurf.')],
      })
    );
    const result = await answer({
      situation: situation(kind),
      retrieval: { evidence: [] },
      tenantId: 'synthetic',
    });
    expect(result.responseText).toBe('Ich kann dir fachlich dabei helfen.');
    expect(result.draft).toBe('');
  }
);
test('task preserves concrete results, steps and drafts, never expectation', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Die Antwort steht aus.')],
      expectation: [claim('Der Anfragende erwartet eine Antwort.')],
      nextSteps: [claim('Prüfe den dokumentierten Eingang.')],
      draft: [claim('Guten Tag, wir benötigen den Bearbeitungsstand zur dokumentierten Anfrage.')],
    })
  );
  const result = await answer({
    situation: { ...situation('task'), turnKind: 'work' },
    retrieval: { evidence: [] },
    tenantId: 'synthetic',
  });
  expect(result.responseText).toContain('Prüfe den dokumentierten Eingang.');
  expect(result.draft).toContain('wir benötigen');
  expect(result.responseText).not.toMatch(/Anfragende/);
});
test('purpose question with options is natural, single and not repeated by key or wording', () => {
  const question = {
    key: 'purpose',
    reason: 'purpose',
    question: 'Geht es dir um Überblick, Prüfung oder einen Entwurf?',
    blocking: false,
  };
  const current = {
    ...situation(),
    missingInformation: [
      question,
      { ...question, key: 'other' },
      { key: 'bad', decisive: true, question: 'Nenne mir deine Rolle?', blocking: true },
    ],
  };
  expect(questionsFor(current)).toEqual([question]);
  expect(questionsFor(current, [question])).toEqual([]);
  expect(questionsFor({ missingInformation: [{ ...question, answered: true }] })).toEqual([]);
});
test('followup uses grounded context and retains it independently of turn shape', async () => {
  const first = {
    ...situation(),
    missingInformation: [
      { key: 'purpose', question: 'Überblick oder Prüfung?', blocking: false, reason: 'purpose' },
    ],
  };
  llm.generateStructured.mockResolvedValue({
    ...situation('knowledge'),
    conversationContext: {
      goal: 'Überblick',
      role: 'Netzabrechnung',
      preference: '',
      basis: 'Ich bin in der Netzabrechnung und möchte einen Überblick.',
      durable: true,
    },
    missingInformation: [{ ...first.missingInformation[0], answered: false }],
  });
  const current = await understand({
    message: 'Ich bin in der Netzabrechnung und möchte einen Überblick.',
    previous: first,
  });
  expect(current.missingInformation[0].answered).toBe(true);
  expect(current.conversationContext.role).toBe('Netzabrechnung');
  const memory = persistentSituation(current);
  expect(memory.conversationContext.goal).toBe('Überblick');
  expect(memory.conversationShape).toBeUndefined();
});
test('response boundary coordinates questions from independent contributors', () => {
  const primary = { key: 'purpose', question: 'Überblick oder Prüfung?' };
  const result = shape.singleQuestion(
    'Kurzer Überblick.\n\nÜberblick oder Prüfung?\n\nWelcher Fall?',
    [primary],
    'Welcher Fall?'
  );
  expect(result.responseText).toBe('Kurzer Überblick.\n\nWelcher Fall?');
  expect(result.questions).toEqual([]);
});

test('mail filing keeps its outer request and is never converted to a table', () => {
  const corpus = require('./fixtures/workbench-813.generated.json');
  const message = corpus.find((scenario) => scenario.id === 'filing').turns[0].message;
  const parsed = require('../src/workbench-document-input').documentInput(message);
  expect(parsed.question).toBe(message);
  expect(parsed.documents).toEqual([]);
});
test('a task never acquires an additional purpose question', () => {
  expect(
    questionsFor({
      ...situation('task'),
      missingInformation: [
        {
          key: 'purpose',
          reason: 'purpose',
          blocking: true,
          question: 'Überblick, Prüfung oder Entwurf?',
        },
      ],
    })
  ).toEqual([]);
});
