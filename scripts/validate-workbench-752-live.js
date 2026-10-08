'use strict';

// Explicit opt-in: real central LLM facade, anonymous input, stubbed source services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
process.env.WORKBENCH_LLM_MODEL = 'gemini-3.5-flash-lite,gemini-flash-latest';
process.env.WORKBENCH_LLM_TIMEOUT_MS = '15000,45000';
process.env.WORKBENCH_LLM_THINKING = 'minimal,default';
const { createLiveHarness } = require('./workbench-live-harness');
const llm = require('../src/llm-client');
const validateAnswer = new (require('ajv'))({ allErrors: true }).compile(
  require('../src/workbench-understanding').ANSWER_SCHEMA
);
const diagnostics = [];
const reportFile = path.basename(process.env.WORKBENCH_VALIDATION_REPORT || '752-live-model.json');
const originalText = llm.generateText;
llm.generateText = async (...args) => {
  const raw = await originalText(...args);
  try {
    const parsed = JSON.parse(require('../src/workbench-json').stripJsonFence(raw));
    diagnostics.push({
      valid: !!validateAnswer(parsed),
      errors: validateAnswer.errors,
      draftType: typeof parsed.draft,
    });
  } catch (_error) {
    // Invalid provider output is a validation result; retain it in the report.
    diagnostics.push({ valid: false, parseError: true });
  }
  return raw;
};

async function validateWorkbench752() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-746-live-'));
  const knowledgeNotes = [
    {
      id: 'local-process-note',
      score: 0.92,
      summary:
        'Anfrage dokumentieren. Referenz, Eingangsdatum und zuständige Bearbeitung prüfen. Behauptungen anhand der ursprünglichen Anfrage und Eingangsbestätigung verifizieren.',
      url: 'https://example.invalid/anonymous-process-note',
    },
    { id: 'irrelevant-note', score: 0.58, summary: 'Rotorblattwartung und Schmierstoffkontrolle.' },
  ];
  const sourceServices = [
    {
      name: 'knowledge-rag',
      actions: {
        query: (ctx) => ({
          results: knowledgeNotes.map((note, index) => ({
            ...note,
            summary: index ? note.summary : `${ctx.params.query}\n${note.summary}`,
          })),
        }),
        federatedSearch: () => ({ results: [] }),
      },
    },
    require('../services/willi-mako.service'),
    ...Object.entries({ datapoint: ['list', 'datapoints'], 'object-store': ['query', 'docs'] }).map(
      ([name, [action, field]]) => ({ name, actions: { [action]: () => ({ [field]: [] }) } })
    ),
    {
      name: 'capability-broker',
      actions: {
        recommend: () => ({
          uncertain: true,
          candidateCapabilities: [],
          recommendedCapabilities: [],
        }),
      },
    },
    { name: 'agent-receipts', actions: { select: () => ({ data: { selected: false } }) } },
  ];
  const { broker, workbench } = createLiveHarness(dir, sourceServices);
  const fixtures = require('../tests/fixtures/workbench-752.json');
  const messages = [
    { scenario: 'R1', message: fixtures.R1 },
    { scenario: 'R1', message: 'Was soll ich konkret tun?' },
    ...fixtures.R2.map((message) => ({ scenario: 'R2', message })),
    { scenario: 'R3', message: fixtures.R3 },
    { scenario: 'R3', message: 'Was soll ich konkret tun?' },
  ];
  const report = {
    mode: 'live central LLM and Willi-Mako; knowledge-rag/object/datapoint documented stubs',
    provider: process.env.LLM_PROVIDER || 'gemini',
    models: require('../src/workbench-understanding').llmOptions('anonymous-validation').model,
    answerModel: require('../src/workbench-understanding').llmOptions(
      'anonymous-validation',
      'answer'
    ).model,
    budgets: process.env.WORKBENCH_LLM_TIMEOUT_MS || '4500',
    thinking: process.env.WORKBENCH_LLM_THINKING || 'minimal',
    followupThinking: process.env.WORKBENCH_LLM_THINKING_FOLLOWUP || 'low',
    turns: [],
    answerDiagnostics: diagnostics,
  };
  try {
    await broker.start();
    await workbench.identityDb.put({
      _id: 'anonymous-willi-access',
      type: 'workbench_willi_mapping',
      enabled: true,
      cetTenantId: 'anonymous-validation',
      cetActorId: 'anonymous-person',
    });
    const histories = new Map();
    // Each turn requires the case and history produced by its predecessor.
    const selectedTurns = messages.filter(
      (turn) =>
        !process.env.WORKBENCH_VALIDATION_SCENARIOS ||
        process.env.WORKBENCH_VALIDATION_SCENARIOS.split(',').includes(turn.scenario)
    );
    await selectedTurns.reduce(async (previousTurn, { scenario, message }) => {
      await previousTurn;
      const history = histories.get(scenario) || [];
      histories.set(scenario, history);
      const start = performance.now();
      history.push({ role: 'user', content: message });
      const result = await broker.call(
        'workbench.chat',
        {
          channel: 'open-webui',
          conversationId: `anonymous-752-${scenario}`,
          message,
          messages: history,
        },
        {
          meta: {
            cernionToken: process.env.CERNION_TOKEN,
            apiToken: {
              tenantId: 'anonymous-validation',
              id: 'anonymous-person',
              roles: ['ROLE_GRID_OPERATOR'],
            },
          },
        }
      );
      history.push({ role: 'assistant', content: result.responseText });
      report.turns.push({
        scenario,
        message,
        elapsedMs: Math.round(performance.now() - start),
        state: result.state,
        phaseTimes: result.phaseTimes,
        sources: result.sources,
        caseId: result.cetCaseId,
        answerStatus: result.answerStatus,
        responseText: result.responseText,
        situation: result.situation,

        caseCreated: !!result.cetCaseId,
        draftCreated: !!result.draftId,
      });
    }, Promise.resolve());
    fs.mkdirSync(path.join(__dirname, '../docs/validation'), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, '../docs/validation', reportFile),
      JSON.stringify(report, null, 2) + '\n'
    );
    console.log(
      JSON.stringify({
        report: `docs/validation/${reportFile}`,
        turns: report.turns.map(
          ({ state, answerStatus, elapsedMs, caseCreated, draftCreated }) => ({
            state,
            answerStatus,
            elapsedMs,
            caseCreated,
            draftCreated,
          })
        ),
      })
    );
  } finally {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
validateWorkbench752().catch((error) => {
  console.error('Live validation unavailable:', error.type || error.name);
  process.exitCode = 1;
});
