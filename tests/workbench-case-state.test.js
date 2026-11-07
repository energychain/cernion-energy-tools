'use strict';

// The workbench keeps the shared case state per conversation (BK-01..04): updated from the turn,
// handed to the answer and used to check the answer before output.
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const llm = require('../src/llm-client');
const { applyCaseUpdate, createCaseState } = require('../src/case-state');
const workbenchCaseState = require('../src/workbench-case-state');
const understanding = require('../src/workbench-understanding');

const claim = (text) => ({
  text,
  origin: 'input',
  specific: false,
  supported: 'model',
  completedAction: false,
  evidenceIds: [],
});
const situation = {
  concern: 'Abweichende Referenz',
  situation: 'Datei und Bild nennen verschiedene Objekte.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: {
    description: 'Abweichung einordnen.',
    externalEffect: false,
    draftRequested: false,
  },
  turnKind: 'work',
  retrievalTerms: [],
};
const emptyDelta = {
  workIntent: {
    object: 'Objekt 7',
    task: 'Abweichung einordnen',
    requestedOutcome: 'Unterschied und nächster Schritt',
    role: '',
    consequenceOfMisframing: '',
    ambiguous: false,
    separatingQuestion: '',
  },
  routeFit: [],
  evidence: [],
  claims: [],
  hypothesisUpdates: [],
  crossEvidence: [],
  openQuestions: [],
  nextActions: [],
  closureCriteria: [],
};

beforeEach(() => jest.resetAllMocks());

test('documents and retrieved sources are observed evidence, stored statements stay reports', () => {
  expect(
    workbenchCaseState.turnEvidence(
      {
        documents: [
          { name: 'a.txt', text: 'Objekt 7' },
          { name: 'leer', text: ' ' },
        ],
      },
      {
        evidence: [
          { source: 'tenant-memory', title: 'Aussage', value: 'Objekt 7 ist aktiv' },
          { source: 'knowledge-rag', title: 'Handbuch', value: 'Regel' },
          { source: 'knowledge-rag', value: '' },
        ],
      }
    )
  ).toEqual([
    { source: 'Dokument a.txt', kind: 'source_observed', content: 'Objekt 7' },
    { source: 'Aussage', kind: 'user_reported', content: 'Objekt 7 ist aktiv' },
    { source: 'Handbuch', kind: 'source_observed', content: 'Regel' },
  ]);
});

test('the update reads the turn; a failed update keeps the previous state', async () => {
  llm.generateStructured.mockResolvedValueOnce(emptyDelta);
  const state = await workbenchCaseState.updateTurnCaseState({
    previous: null,
    envelope: { userRequest: 'Passt das?', documents: [{ name: 'a.txt', text: 'Objekt 7' }] },
    retrieval: { evidence: [] },
    tenantId: 't1',
  });
  const input = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(input.message).toBe('Passt das?');
  expect(input.newEvidence).toEqual([
    { source: 'Dokument a.txt', kind: 'source_observed', content: 'Objekt 7' },
  ]);
  expect(state.workIntent.task).toBe('Abweichung einordnen');

  const warn = jest.fn();
  llm.generateStructured.mockRejectedValueOnce(new Error('down'));
  const kept = await workbenchCaseState.updateTurnCaseState({
    previous: state,
    envelope: { userRequest: 'weiter' },
    retrieval: {},
    logger: { warn },
  });
  expect(kept).toBe(state);
  expect(warn.mock.calls[0][0]).toContain('down');
});

test('the answer receives the case-state view and its rules', async () => {
  llm.generateText.mockResolvedValueOnce(
    JSON.stringify({
      expectation: [],
      interpretation: [claim('Datei und Bild betreffen verschiedene Objekte.')],
      nextSteps: [],
      draft: [],
    })
  );
  const caseView = { workIntent: { task: 'Abweichung einordnen' }, activeHypotheses: [] };
  await understanding.answer({ situation, retrieval: { evidence: [] }, caseView });
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.caseState).toEqual(caseView);
  expect(prompt.caseStateRules.join(' ')).toContain('noLongerValid');
  llm.generateText.mockResolvedValueOnce(
    JSON.stringify({ expectation: [], interpretation: [claim('x')], nextSteps: [], draft: [] })
  );
  await understanding.answer({ situation, retrieval: { evidence: [] } });
  expect(JSON.parse(llm.generateText.mock.calls[1][0])).not.toHaveProperty('caseState');
});

test('the reply is revised where the check flags it; drafts are left as written', async () => {
  const state = applyCaseUpdate(createCaseState(), emptyDelta);
  const reply = {
    responseText: 'Ursache ist A oder B, das ist geprüft.',
    draft: '',
    questions: [],
  };
  llm.generateStructured.mockResolvedValueOnce({
    issues: [{ kind: 'overstated_evidence', excerpt: 'geprüft', fix: 'als Annahme' }],
    revisedReply: 'Ursache ist vermutlich A oder B; das ist noch nicht geprüft.',
  });
  expect((await workbenchCaseState.reviewTurnReply(reply, state)).responseText).toBe(
    'Ursache ist vermutlich A oder B; das ist noch nicht geprüft.'
  );
  const withDraft = { ...reply, draft: 'Sehr geehrte …' };
  expect(await workbenchCaseState.reviewTurnReply(withDraft, state)).toBe(withDraft);
  expect(await workbenchCaseState.reviewTurnReply(reply, null)).toBe(reply);
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
});
