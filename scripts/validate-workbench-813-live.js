'use strict';
// Explicit live validation: central facade, synthetic corpus and documented empty sources.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
process.env.WORKBENCH_LLM_TIMEOUT_MS ||= '20000,45000';
const corpus = require('../tests/fixtures/workbench-813.generated.json');
const { compoundQuestion } = require('../src/workbench-conversation-shape');
function singlePoint(responseText) {
  return !String(responseText)
    .split('\n\n')
    .filter((paragraph) => paragraph.includes('?'))
    .some(compoundQuestion);
}
function temporalGrounded(responseText, facts, situation) {
  // An explicit question offers alternatives; it does not assert either one.
  const statements = (situation?.missingInformation || []).reduce(
    (text, item) => (item.question ? text.replaceAll(item.question, '') : text),
    String(responseText)
  );
  return !require('../src/workbench-answer-filter').unsupportedEarlierDate(statements, facts);
}
const reportPath = path.join(__dirname, '../docs/validation/813-live.json');
let quotaDirectory;
function summaryPresent(responseText) {
  const overview = String(responseText)
    .split('Entwurf:')[0]
    .split('\n\n')
    .filter(
      (paragraph) =>
        !/^Ich gehe davon aus|^Den\b/iu.test(paragraph) &&
        !/\b(?:prüfen|übermitteln|einholen|versenden|ermitteln|bitten|überwachen|einleiten|vorbereiten|nachhalten)\.?$/iu.test(
          paragraph.trim()
        )
    )
    .slice(0, 2)
    .join('\n');
  return /Eingangsbestätigung|(?:fachlich|inhaltlich).{0,180}(?:aussteh|steht.{0,40}aus|kein|nicht)|(?:aussteh|kein|nicht).{0,180}(?:fachlich|inhaltlich)/isu.test(
    overview
  );
}
function recheckReport() {
  const existing = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const expected = corpus.flatMap((scenario) =>
    scenario.turns.map((_turn, index) => `${scenario.id}:${index + 1}`)
  );
  if (
    existing.runs?.map((run) => run.run).join(',') !== '1,2,3' ||
    existing.totalTurns !== expected.length * 3 ||
    existing.runs.some(
      (run) =>
        JSON.stringify(run.turns.map((turn) => `${turn.scenario}:${turn.turn}`)) !==
        JSON.stringify(expected)
    )
  )
    throw new Error('Rechecking requires three complete unchanged corpus runs');
  for (const run of existing.runs)
    for (const turn of run.turns) {
      const scenario = corpus.find((item) => item.id === turn.scenario);
      turn.checks.temporalGrounded = temporalGrounded(
        turn.responseText,
        scenario.turns.slice(0, turn.turn).map((item) => item.message),
        turn.situation
      );
      if (turn.scenario === 'counter') turn.checks.singlePoint = singlePoint(turn.responseText);
      if (corpus.find((scenario) => scenario.id === turn.scenario).turns[turn.turn - 1].summary)
        turn.checks.requestedSummary = summaryPresent(turn.responseText);
    }
  existing.guardValidation =
    'Summary, question grammar and temporal assertions rechecked on all complete unchanged responses; explicit question alternatives are not assertions; remaining checks retained; no model calls.';
  fs.writeFileSync(reportPath, JSON.stringify(existing, null, 2) + '\n');
  if (
    existing.runs.some((run) =>
      run.turns.some((turn) => Object.values(turn.checks).includes(false))
    )
  )
    process.exitCode = 1;
}
const report = {
  sources:
    'Real central LLM facade; synthetic/empty source services (knowledge, object-store, datapoint); local real case and document stores.',
  phaseBudgetsMs: process.env.WORKBENCH_LLM_TIMEOUT_MS.split(',').map(Number),
  requestTimeoutMs: 300000,
  isolation:
    'Independent synthetic tenant and actor per scenario, shared across its turns; separate stores per run.',
  runs: [],
  turnsWithQuestion: 0,
  totalTurns: 0,
};
async function validateConversation() {
  quotaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-813-quota-'));
  process.env.RATE_QUOTA_DIR = quotaDirectory;
  const { createLiveHarness } = require('./workbench-live-harness');
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
                  tenantId: `anonymous-validation-${run}-${scenario.id}`,
                  id: `synthetic-${scenario.id}`,
                  roles: ['ROLE_GRID_OPERATOR'],
                },
              },
              timeout: report.requestTimeoutMs,
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
            temporalGrounded: temporalGrounded(
              result.responseText,
              messages.filter((item) => item.role === 'user').map((item) => item.content),
              result.situation
            ),
            ...(turn.draft ? { requestedDraft: /Entwurf:\s*\S/u.test(result.responseText) } : {}),
            ...(turn.draft
              ? {
                  completeDraft:
                    (
                      result.responseText
                        .split('Entwurf:')[1]
                        ?.match(
                          /(?:Mit freundlichen Grüßen|Freundliche Grüße|Viele Grüße|Beste Grüße)/giu
                        ) || []
                    ).length >=
                    Math.max(
                      1,
                      (result.responseText.split('Entwurf:')[1]?.match(/Variante\s+[A-Z]/giu) || [])
                        .length
                    ),
                }
              : {}),
            ...(turn.summary
              ? {
                  requestedSummary: summaryPresent(result.responseText),
                }
              : {}),
            ...(scenario.id === 'counter'
              ? {
                  singlePoint: singlePoint(result.responseText),
                }
              : {}),
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
if (require.main === module)
  (process.argv.includes('--recheck-report')
    ? Promise.resolve().then(recheckReport)
    : validateConversation()
  )
    .catch((error) => {
      console.error('Live validation failed:', error.type || error.name);
      process.exitCode = 1;
    })
    .finally(() => {
      if (quotaDirectory) fs.rmSync(quotaDirectory, { recursive: true, force: true });
    });
module.exports = { summaryPresent, temporalGrounded };
