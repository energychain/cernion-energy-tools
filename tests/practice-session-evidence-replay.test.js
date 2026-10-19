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
  controls = installSessionStub();
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
    const reply = await transport.send(run, turn);
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
