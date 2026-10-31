'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const llm = require('../src/llm-client');
const { generateCommunicationFixture } = require('../scripts/generate-workbench-874-fixtures');
const { understand, SITUATION_SCHEMA } = require('../src/workbench-understanding');
const { persistentSituation } = require('../src/workbench-turn-scope');
const { turnOutcome } = require('../src/failure-signals');

const fixture = generateCommunicationFixture();
beforeEach(() => jest.clearAllMocks());

const message = 'Nein, das stimmt so nicht, die Frist war eine andere.';
const reply = (answerFeedback) =>
  llm.generateStructured.mockResolvedValue(fixture.situation(message, { answerFeedback }));

describe('graded rejection of the previous answer (#1010)', () => {
  test('the schema offers a graded field with a literal basis, not a yes/no flag', () => {
    const field = SITUATION_SCHEMA.properties.answerFeedback;
    expect(field.properties.disagreement).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    expect(field.required).toEqual(['disagreement', 'basis']);
  });

  test('a follow-up with a literal basis keeps the estimate', async () => {
    reply({ disagreement: 0.9, basis: 'das stimmt so nicht' });
    const previous = fixture.situation('Welche Frist gilt?', {});
    const result = await understand({ message, previous, tenantId: fixture.tenantId });
    expect(result.answerFeedback).toEqual({ disagreement: 0.9, basis: 'das stimmt so nicht' });
    expect(turnOutcome({ situation: result }).disagreement).toBe(true);
    // Turn-scoped: the next turn does not inherit the rejection.
    expect(persistentSituation(result).answerFeedback).toBeUndefined();
  });

  test('without an earlier turn or with an invented basis there is no rejection', async () => {
    reply({ disagreement: 0.9, basis: 'das stimmt so nicht' });
    const first = await understand({ message, tenantId: fixture.tenantId });
    expect(first.answerFeedback).toEqual({ disagreement: 0, basis: '' });
    reply({ disagreement: 0.95, basis: 'völlig falsch' });
    const previous = fixture.situation('Welche Frist gilt?', {});
    const invented = await understand({ message, previous, tenantId: fixture.tenantId });
    expect(invented.answerFeedback).toEqual({ disagreement: 0, basis: '' });
    expect(turnOutcome({ situation: invented }).disagreement).toBe(false);
  });

  test('a weak estimate is kept but is no signal', async () => {
    reply({ disagreement: 0.3, basis: 'die Frist war eine andere' });
    const previous = fixture.situation('Welche Frist gilt?', {});
    const result = await understand({ message, previous, tenantId: fixture.tenantId });
    expect(result.answerFeedback.disagreement).toBe(0.3);
    expect(turnOutcome({ situation: result }).disagreement).toBe(false);
  });
});
