'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer } = require('../src/workbench-understanding');
const { freeAnswerEnabled, paragraphs } = require('../src/workbench-free-answer');

const situation = {
  concern: 'Fehlende fachliche Rückmeldung zu einem Vorgang',
  situation: 'Transportquittung liegt vor, fachliche Rückmeldung nicht gefunden.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  retrievalTerms: ['Rückmeldung'],
  missingInformation: [],
  requestedAction: { description: '', draftRequested: false, externalEffect: false },
  turnKind: 'work',
  conversationShape: 'task',
};
const evidence = [
  {
    evidenceId: 'E1',
    source: 'Prozessbeschreibung',
    retrievalSource: 'knowledge-gateway',
    value: 'Transportquittung und fachliche Rückmeldung sind getrennte Belegarten.',
    metadata: { sourceId: 'doc_1', sectionId: 'Belegarten' },
  },
];
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  jest.clearAllMocks();
});

test('the switch enables all tenants or listed ones only', () => {
  expect(freeAnswerEnabled('t', {})).toBe(false);
  expect(freeAnswerEnabled('t', { WORKBENCH_FREE_ANSWER: 'all' })).toBe(true);
  expect(freeAnswerEnabled('t', { WORKBENCH_FREE_ANSWER: 'a, t' })).toBe(true);
  expect(freeAnswerEnabled('t', { WORKBENCH_FREE_ANSWER: 'a' })).toBe(false);
});

test('headings stay with the block that follows them', () => {
  expect(paragraphs('## Lage\n\nText eins.\n\nText zwei.')).toEqual([
    '## Lage\n\nText eins.',
    'Text zwei.',
  ]);
});

test('a free answer is annotated and then runs through the same checks', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    [
      'Belegt ist nur der technische Eingang; eine fachliche Rückmeldung fehlt bisher.',
      'Die Transportquittung ersetzt die fachliche Rückmeldung nicht, beide sind getrennte Belegarten.',
      'Ich habe die Rückmeldung bereits beim Gegenüber nachgefordert.',
      'Prüfe als Nächstes die Suche mit der exakten Referenz, weil ein Treffer dort die Lücke schließt.',
      'Liegt dir die Originalnachricht als Datei vor?',
    ].join('\n\n')
  );
  llm.generateStructured.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    expect(input.instruction).toMatch(/Kennzeichne jeden Absatz/u);
    return {
      paragraphs: [
        {
          index: 0,
          kind: 'statement',
          origin: 'input',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: false,
          specific: false,
        },
        {
          index: 1,
          kind: 'statement',
          origin: 'evidence',
          evidenceIds: ['E1'],
          ruleClaim: true,
          completedAction: false,
          specific: false,
        },
        {
          index: 2,
          kind: 'statement',
          origin: 'model',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: true,
          specific: false,
        },
        {
          index: 3,
          kind: 'step',
          origin: 'model',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: false,
          specific: false,
        },
        {
          index: 4,
          kind: 'question',
          origin: 'model',
          evidenceIds: [],
          ruleClaim: false,
          completedAction: false,
          specific: false,
        },
      ],
    };
  });
  const result = await answer({
    situation,
    retrieval: { evidence },
    message: 'Was ist belegt und was fehlt?',
    tenantId: 't',
    conversation: [{ role: 'user', content: 'Die Rückmeldung fehlt.' }],
  });
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.instruction).toMatch(/direkten Antwort/u);
  expect(prompt.conversation).toEqual([{ role: 'user', text: 'Die Rückmeldung fehlt.' }]);
  expect(llm.generateText.mock.calls[0][1].responseMimeType).toBe('text/plain');
  expect(result.responseText).toContain('Belegt ist nur der technische Eingang');
  expect(result.responseText).toContain('getrennte Belegarten');
  expect(result.responseText).toContain('Prüfe als Nächstes');
  // The check removes the invented completed action; the follow-up question is kept.
  expect(result.responseText).not.toContain('bereits beim Gegenüber nachgefordert');
  expect(result.responseText).toContain('Liegt dir die Originalnachricht als Datei vor?');
  expect(result.answerStatus).not.toBe('fallback');
});

test('a requested draft keeps the structured path', async () => {
  process.env.WORKBENCH_FREE_ANSWER = 'all';
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      expectation: [],
      nextSteps: [],
      interpretation: [],
      assumptions: [],
      draft: [],
    })
  );
  await answer({
    situation: {
      ...situation,
      requestedAction: {
        description: 'Antwort schreiben',
        draftRequested: true,
        externalEffect: false,
      },
    },
    retrieval: { evidence },
    message: 'Schreib mir bitte den Entwurf.',
    tenantId: 't',
  });
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.instruction).not.toMatch(/Kennzeichne jeden Absatz/u);
  expect(llm.generateText.mock.calls[0][1].responseMimeType).toBe('application/json');
});
