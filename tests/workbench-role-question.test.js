'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer } = require('../src/workbench-understanding');

afterEach(() => jest.clearAllMocks());

test('a role-only reading of a message with a question still gets the answer', async () => {
  const message =
    'Ich möchte zwei Linien getrennt prüfen. Wie arbeiten beide getrennt und wo kommen sie zusammen?';
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [
        {
          text: 'Beide Linien arbeiten mit eigenen Eingangsgrößen und treffen sich an festen Punkten.',
          origin: 'model',
          supported: 'model',
          completedAction: false,
          specific: false,
          evidenceIds: [],
        },
      ],
      expectation: [],
      nextSteps: [],
    })
  );
  const result = await answer({
    situation: {
      concern: 'Zwei Prüflinien',
      situation: '',
      participants: [],
      identifiers: [],
      deadlines: [],
      hypotheses: [],
      missingInformation: [],
      requestedAction: { description: '', draftRequested: false, externalEffect: false },
      turnKind: 'knowledge',
      roleContextUpdated: true,
      roleStatement: { subject: 'self', firstPerson: true, roleOnly: true, basis: message },
      conversationContext: { statement: message, basis: message },
    },
    retrieval: { evidence: [] },
    message,
    tenantId: 't',
  });
  expect(llm.generateText).toHaveBeenCalled();
  expect(result.responseText).toContain('treffen sich an festen Punkten');
});
