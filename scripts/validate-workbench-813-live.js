'use strict';
// Explicit live validation: central facade, synthetic corpus and documented empty sources.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
process.env.WORKBENCH_LLM_TIMEOUT_MS ||= '20000,45000';
const quotaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-813-quota-'));
process.env.RATE_QUOTA_DIR = quotaDirectory;
const { createLiveHarness } = require('./workbench-live-harness');
const corpus = require('../tests/fixtures/workbench-813.generated.json');
const report = {
  sources:
    'Real central LLM facade; synthetic/empty source services (knowledge, object-store, datapoint); local real case and document stores.',
  runs: [],
  turnsWithQuestion: 0,
  totalTurns: 0,
};
async function validateConversation() {
  for (let run = 1; run <= 3; run++) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-813-live-'));
    const { broker, workbench } = createLiveHarness(directory, [
      {
        name: 'knowledge-rag',
        actions: { query: () => ({ results: [] }), federatedSearch: () => ({ results: [] }) },
      },
      { name: 'object-store', actions: { query: () => ({ docs: [] }) } },
      {
        name: 'datapoint',
        actions: { list: () => ({ datapoints: [] }), datasetCatalog: () => [] },
      },
      {
        name: 'capability-broker',
        actions: {
          recommend: () => ({
            uncertain: false,
            recommendedCapabilities: [],
            candidateCapabilities: [],
          }),
        },
      },
      { name: 'agent-receipts', actions: { select: () => ({ data: { selected: false } }) } },
    ]);
    workbench.logger.info = (message, detail) => {
      if (/fallback|filters/.test(message)) console.log(JSON.stringify({ message, detail }));
    };
    workbench.logger.warn = (message, detail) => console.log(JSON.stringify({ message, detail }));
    const turns = [];
    try {
      await broker.start();
      for (const scenario of corpus) {
        if (
          process.env.WORKBENCH_VALIDATION_SCENARIOS &&
          !process.env.WORKBENCH_VALIDATION_SCENARIOS.split(',').includes(scenario.id)
        )
          continue;
        const messages = [];
        const asked = new Set();
        for (const [index, turn] of scenario.turns.entries()) {
          messages.push({ role: 'user', content: turn.message });
          const result = await broker.call(
            'workbench.chat',
            {
              channel: 'open-webui',
              conversationId: `synthetic-${run}-${scenario.id}`,
              message: turn.message,
              messages,
            },
            {
              meta: {
                cernionToken: process.env.CERNION_TOKEN,
                apiToken: {
                  tenantId: `anonymous-validation-${run}`,
                  id: `synthetic-${scenario.id}`,
                  roles: ['ROLE_GRID_OPERATOR'],
                },
              },
              timeout: 120000,
            }
          );
          messages.push({ role: 'assistant', content: result.responseText });
          const questionCount = (result.responseText.match(/\?/g) || []).length;
          const questionKeys = (result.situation?.missingInformation || [])
            .filter((item) => result.responseText.includes(item.question))
            .map((item) => item.key);
          const checks = {
            notRepeated: questionKeys.every((key) => !asked.has(key)),
            singleQuestion: questionCount <= 1,
            expectedQuestion:
              turn.question === 'optional' || Boolean(questionCount) === turn.question,
            noMeta: !require('../src/workbench-conversation-shape').forbiddenMeta(
              result.responseText
            ),
            noImperativeQuestion:
              !require('../src/workbench-conversation-shape').imperativeQuestion(
                result.responseText
              ),
            noDisclaimer:
              !/unverbindliche Einschätzung|keine externe Handlung|versendet.*nichts/iu.test(
                result.responseText
              ),
            answered: result.metadata?.degraded === false,
            ...(turn.search
              ? { searchedSources: result.responseText.includes('Nachgesehen:') }
              : {}),
          };
          questionKeys.forEach((key) => asked.add(key));
          turns.push({
            questionKeys,
            scenario: scenario.id,
            turn: index + 1,
            responseText: result.responseText,
            questionCount,
            checks,
            phaseTimes: result.phaseTimes,
            sources: result.sources,
            conversationShape: result.situation?.conversationShape,
            metadata: result.metadata,
            situation: result.situation,
          });
          fs.mkdirSync(path.join(__dirname, '../docs/validation'), { recursive: true });
          fs.writeFileSync(
            path.join(__dirname, '../docs/validation/813-progress.json'),
            JSON.stringify({ run, turns }, null, 2) + '\n'
          );
          report.totalTurns++;
          if (questionCount) report.turnsWithQuestion++;
          console.log(
            JSON.stringify({ run, scenario: scenario.id, turn: index + 1, questionCount, checks })
          );
        }
      }
    } finally {
      await broker.stop();
      fs.rmSync(directory, { recursive: true, force: true });
      report.runs.push({ run, turns });
      report.questionShare = report.totalTurns ? report.turnsWithQuestion / report.totalTurns : 0;
      fs.mkdirSync(path.join(__dirname, '../docs/validation'), { recursive: true });
      fs.writeFileSync(
        path.join(__dirname, '../docs/validation/813-live.json'),
        JSON.stringify(report, null, 2) + '\n'
      );
    }
  }
  if (
    report.runs.some((run) => run.turns.some((turn) => Object.values(turn.checks).includes(false)))
  )
    process.exitCode = 1;
}
validateConversation()
  .catch((error) => {
    console.error('Live validation failed:', error.type || error.name);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(quotaDirectory, { recursive: true, force: true }));
