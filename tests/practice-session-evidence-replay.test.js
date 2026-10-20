'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const { installSessionStub } = require('./helpers/session-evidence-stub');
const { instantiatePracticeScenario } = require('../scripts/generate-practice-evaluation-fixtures');
const { createLocalTransport } = require('../scripts/practice-evaluation-transport');
const { checkTurn } = require('../scripts/practice-evaluation-checks');
const env = { ...process.env };
let transport;
let controls;

beforeAll(async () => {
  controls = installSessionStub({ realistic: true });
  const budget = require('../scripts/live-validation-budget').installLiveBudget({ limit: 300 });
  const harness = require('../scripts/workbench-live-harness');
  const create = harness.createLiveHarness;
  const spy = jest.spyOn(harness, 'createLiveHarness').mockImplementation((...args) => {
    const app = create(...args);
    for (const name of ['workbench', 'dataset', 'knowledge-rag'])
      app.broker.getLocalService(name).settings.tenantEvidenceEnrichment = { delayMs: 2 ** 31 - 1 };
    return app;
  });
  try {
    transport = await createLocalTransport({ budget });
  } finally {
    spy.mockRestore();
  }
});
afterAll(async () => {
  await transport?.close();
  process.env = env;
});

test('generated earlier-session scenario passes unchanged practice checks through full local Workbench turns', async () => {
  const fixture = instantiatePracticeScenario('earlier-session');
  const run = await transport.startRun(fixture);
  const context = {},
    failures = [],
    replies = [];
  for (const turn of fixture.turns) {
    controls.classification = turn.id === 'paraphrase' ? 'knowledge' : 'work';
    const start = controls.inputs.length;
    const reply = await transport.send(run, turn);
    const calls = controls.inputs.slice(start);
    const resolutions = calls.filter((input) => input.task === 'evidence_reference_resolution');
    if (['question', 'paraphrase'].includes(turn.id)) {
      expect(resolutions).toHaveLength(1);
      expect(calls.filter((input) => !input.nodes)).toHaveLength(2);
      expect(calls.filter((input) => input.untrustedEvidence)).toHaveLength(1);
      expect(resolutions[0].currentSources).toHaveLength(1);
      expect(JSON.stringify(resolutions[0].currentSources[0].manifest.questionTypes)).not.toMatch(
        /Einordnung|eingeordnet/iu
      );
      expect(calls.filter((input) => input.task === 'evidence_request_kind')).toHaveLength(0);
    } else expect(resolutions).toHaveLength(0);
    if (turn.id === 'question') {
      expect(resolutions[0].previousSourceIds).toEqual([]);
      expect(
        calls.some((input) => input.nodes?.some((node) => node.nodeId.startsWith('case:')))
      ).toBe(true);
    }
    replies.push({ id: turn.id, reply });
    failures.push(
      ...checkTurn(turn, reply, context)
        .filter((check) => !check.passed)
        .map((check) => ({ turn: turn.id, ...check }))
    );
    if (turn.id === 'intake') {
      context.caseId = reply.cetCaseId;
      context.caseDisplayRef = reply.caseDisplayRef;
    }
  }
  const fallback = replies.find((item) => item.id === 'fallback').reply;
  expect(fallback.answerStatus).toBe('fallback');
  expect(fallback.turnMemorySummary?.lastSafeConclusion).toBeUndefined();
  expect(controls.errors).toEqual([]);
  expect(replies.find((item) => item.id === 'fallback-question').reply.responseText).not.toContain(
    'nicht hinterlegt'
  );
  expect(failures).toEqual([]);
  for (const id of ['question', 'paraphrase']) {
    const reply = replies.find((item) => item.id === id).reply;
    expect(reply.tenantEvidenceSelection).toEqual([
      { sourceType: 'case', sourceId: context.caseId },
    ]);
    expect(reply.evidence[0].metadata).toMatchObject({
      caseId: context.caseId,
      displayRef: context.caseDisplayRef,
    });
  }
});

const standalone = {
  actors: [{ id: 'a', name: 'Sachbearbeitung A', functionLabel: 'Koordination' }],
};

test.each(['situation', 'requestedAction'])(
  'full local turns never publish an internal %s as an answer',
  async (field) => {
    const run = await transport.startRun(standalone);
    controls.internalAnswerField = field;
    try {
      const reply = await transport.send(run, {
        actor: 'a',
        message: 'Welche Einordnung zum Bestand am Standort Nord liegt vor?',
        chat: 'internal-description',
      });
      expect(reply.answerStatus).toBe('fallback');
      expect(reply.responseText).not.toContain('wird die konkrete fachliche Einordnung angefragt');
      expect(reply.responseText).not.toContain('Prüfung der Einordnung zum Gegenstand durchführen');
      expect(reply.turnMemorySummary?.lastSafeConclusion).toBeUndefined();
    } finally {
      delete controls.internalAnswerField;
    }
  }
);

test('a content question about an unfinished case receives no case overview', async () => {
  const run = await transport.startRun(standalone);
  await transport.send(run, {
    actor: 'a',
    chat: 'first',
    message: 'Ordne die Temperatur im Depot West ein.',
  });
  const reply = await transport.send(run, {
    actor: 'a',
    chat: 'second',
    message: 'Welche Einordnung zur Temperatur im Depot West liegt vor?',
  });
  expect(reply.responseText).not.toContain('nicht hinterlegt');
  expect(reply.responseText).not.toMatch(/Fall F-\d+:/u);
});
