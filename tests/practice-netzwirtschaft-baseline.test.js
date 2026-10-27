'use strict';

// Offline baseline for the department role scenarios (#986): every scenario runs through the real
// local harness and turn order with a schema-valid LLM stub. Semantic quality is judged live;
// this guards that attachments, multi-document turns and checks work end to end.
jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const llm = require('../src/llm-client');
const { complete, validate } = require('./helpers/workbench-schema-stub');
const {
  generatePracticeCatalog,
  instantiatePracticeScenario,
} = require('../scripts/generate-practice-evaluation-fixtures');
const { createLocalTransport } = require('../scripts/practice-evaluation-transport');
const { checkTurn } = require('../scripts/practice-evaluation-checks');
const originalEnv = { ...process.env };
let transport;

beforeAll(async () => {
  llm.generateStructured.mockImplementation(async (schema) => validate(schema, complete(schema)));
  llm.generateText.mockResolvedValue('Synthetische Antwort ohne Fachaussage.');
  llm.generateChat.mockResolvedValue({ text: 'Synthetische Antwort ohne Fachaussage.' });
  const budget = require('../scripts/live-validation-budget').installLiveBudget({ limit: 1000 });
  const harness = require('../scripts/workbench-live-harness');
  const create = harness.createLiveHarness;
  const spy = jest.spyOn(harness, 'createLiveHarness').mockImplementation((...args) => {
    const app = create(...args);
    for (const service of app.broker.services) {
      service.settings.tenantEvidenceEnrichment = { delayMs: 2 ** 31 - 1 };
      service.settings.projectSkillLearning = { delayMs: 2 ** 31 - 1 };
    }
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
  process.env = originalEnv;
});

const ids = generatePracticeCatalog()
  .scenarios.filter((scenario) => scenario.id.startsWith('nw-'))
  .map((scenario) => scenario.id);

test.each(ids)(
  '%s runs through the harness and is evaluated',
  async (id) => {
    const fixture = instantiatePracticeScenario(id);
    const run = await transport.startRun(fixture);
    for (const turn of fixture.turns) {
      const reply = await transport.send(run, turn);
      expect(typeof reply.responseText).toBe('string');
      expect(reply.responseText.trim()).not.toBe('');
      const checks = checkTurn(turn, reply, {});
      expect(checks.length).toBeGreaterThan(0);
      expect(checks.every((check) => typeof check.passed === 'boolean')).toBe(true);
    }
  },
  120000
);
