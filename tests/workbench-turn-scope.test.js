'use strict';

jest.mock('../src/llm-client', () => ({ generateText: jest.fn(), generateStructured: jest.fn() }));
const llm = require('../src/llm-client');
const { answer } = require('../src/workbench-understanding');
const { persistentSituation, TURN_SCOPED_FIELDS } = require('../src/workbench-turn-scope');
const { createCaseBroker } = require('./helpers/case-linking-broker');

const situation = {
  concern: 'Stand der Anfrage klären.',
  situation: 'Die anfragende Rolle benötigt den dokumentierten Stand.',
  participants: ['Anfragende Rolle'],
  identifiers: [],
  deadlines: [],
  hypotheses: [],
  missingInformation: [],
  requestedAction: { description: 'Stand klären.', draftRequested: true, externalEffect: false },
  turnKind: 'work',
  retrievalTerms: [],
};
const claim = (text, condition = '') => ({
  text,
  condition,
  supported: 'model',
  evidenceIds: [],
  specific: false,
  completedAction: false,
});
const drafts = [
  claim(
    'Guten Tag, bitte teilen Sie uns den dokumentierten Stand Ihrer Anfrage mit. Mit freundlichen Grüßen',
    'der Stand noch offen ist'
  ),
  claim(
    'Guten Tag, bitte teilen Sie uns das dokumentierte Ergebnis Ihrer Anfrage mit. Mit freundlichen Grüßen',
    'das Ergebnis vorliegt'
  ),
];
const output = (draft = [], nextSteps = []) =>
  JSON.stringify({ expectation: [], nextSteps, draft });
afterEach(() => jest.resetAllMocks());

test('explicit draft intent excludes contradictory next-step instructions even with stale caller metadata', async () => {
  llm.generateText.mockResolvedValue(output(drafts));
  const result = await answer({
    situation,
    retrieval: { evidence: [] },
    message: 'Mach mir die Antwort fertig',
    followup: true,
    nextStepOnly: true,
  });
  expect(result.draft).toMatch(/Variante A/);
  expect(result.draft).toMatch(/Variante B/);
  const prompt = JSON.parse(llm.generateText.mock.calls[0][0]);
  expect(prompt.nextStepInstruction).toBe('');
  expect(prompt.turnInstruction).toContain('vollständigen Entwurf');
});

test('central turn-field list strips transient metadata without mutating or losing stable work facts', () => {
  const original = {
    ...situation,
    followupKind: 'next_step',
    requestedAction: { ...situation.requestedAction, externalEffect: true },
  };
  const saved = persistentSituation(original);
  for (const path of TURN_SCOPED_FIELDS) {
    const [field, nested] = path.split('.');
    expect(nested ? saved[field][nested] : saved[field]).toBeUndefined();
  }
  expect(original.followupKind).toBe('next_step');
  expect(original.requestedAction.externalEffect).toBe(true);
  expect(saved.turnKind).toBe('work');
  expect(saved.requestedAction.draftRequested).toBe(true);
});

test.each([
  ['next-step then draft', ['Was soll ich jetzt tun?', 'Mach mir die Antwort fertig']],
  ['draft then next-step', ['Mach mir die Antwort fertig', 'Was nun?']],
])(
  '%s respects current intent and persists no turn metadata in either store',
  async (_name, messages) => {
    const app = await createCaseBroker();
    llm.generateStructured.mockImplementation(async (_schema, prompt) => ({
      ...structuredClone(situation),
      followupKind: /Was/.test(JSON.parse(prompt).message) ? 'next_step' : 'none',
    }));
    llm.generateText.mockImplementation(async (prompt) => {
      const turn = JSON.parse(prompt);
      // Deliberately offer a draft on next-step turns, too: rendering must suppress it.
      return output(
        drafts,
        turn.nextStepInstruction ? [claim('Prüfe den dokumentierten Stand.')] : []
      );
    });
    try {
      await app.broker.start();
      const turn = (message) =>
        app.call('workbench.chat', { message, channel: 'open-webui', conversationId: 'sequence' });
      const initial = await turn('Bitte unterstütze die Bearbeitung der Anfrage.');
      for (const message of messages) {
        const result = await turn(message);
        expect(result.cetCaseId).toBe(initial.cetCaseId);
        if (message.includes('fertig')) {
          expect(result.responseText).toMatch(/Variante A/);
          expect(result.responseText).toMatch(/Variante B/);
        } else {
          expect(result.responseText).toContain('Prüfe den dokumentierten Stand.');
          expect(result.draftId).toBeUndefined();
          expect(result.responseText).not.toMatch(/Variante|Guten Tag/);
        }
      }
      const state = await app.router.loadCase(
        require('../src/domain-router-policy').principal({
          meta: require('./helpers/case-linking-broker').auth(),
        }),
        initial.cetCaseId
      );
      const pending = (
        await app.workbench.conversationsDb.allDocs({ include_docs: true })
      ).rows.find((row) => row.doc.type === 'workbench_conversation_assistance').doc;
      for (const saved of [state.knownContext.situation, pending.situation]) {
        expect(saved.followupKind).toBeUndefined();
        expect(saved.requestedAction.externalEffect).toBeUndefined();
        expect(saved.concern).toBe(situation.concern);
      }
      expect(llm.generateStructured).toHaveBeenCalledTimes(2);
    } finally {
      await app.cleanup();
    }
  }
);
