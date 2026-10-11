'use strict';

// Explicit live validation. Only synthetic input; persistence is isolated.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
const { createCaseBroker } = require('../tests/helpers/case-linking-broker');
const { generateEdifactFixture } = require('./generate-edifact-fixtures');
const llm = require('../src/llm-client');

async function validateEdifactLive() {
  const app = await createCaseBroker();
  const previous = llm.generateText;
  const calls = [];
  llm.generateText = async (...args) => {
    assert(
      !/UNB\+|UNH\+|MOA\+|FTX\+/.test(JSON.stringify(args)),
      'Raw segments reached a model prompt'
    );
    const response = await previous(...args);
    calls.push({ successful: true });
    return response;
  };
  Object.assign(process.env, {
    WORKBENCH_DATASET_DB_PATH: path.join(app.dir, 'rows'),
    DATAPOINT_SCHEDULER_ENABLED: 'false',
  });
  for (const [file, settings] of [
    ['datapoint', { dbPath: path.join(app.dir, 'catalog') }],
    ['dataset', {}],
    ['willi-mako', {}],
  ]) {
    const schema = require(`../services/${file}.service`);
    app.broker.createService({ ...schema, settings: { ...schema.settings, ...settings } });
  }
  const input = generateEdifactFixture({ padding: 6000 });
  const report = {
    issue: 814,
    at: new Date().toISOString(),
    inputBytes: Buffer.byteLength(input),
    fixture: 'synthetic generator only',
    modelAccess: 'central LLM facade; real configured provider',
    sourceAccess: 'real Willi-Mako; unavailable qualifiers remain unresolved',
    turns: [],
    calls,
  };
  try {
    await app.broker.start();
    for (let run = 1; run <= 3; run++) {
      const questions = [
        'Was kannst Du mir zu dieser Nachricht sagen?',
        'Schlüssele Rechnung SYN-INV-002 auf',
        'Welche Rechnungen über 1.000 €?',
      ];
      for (let turn = 0; turn < questions.length; turn++) {
        const question = questions[turn];
        const message =
          turn === 0
            ? `<context><source name="Synthetic.txt">${input}</source></context><user_query>${question}</user_query>`
            : question;
        const start = performance.now();
        const result = await app.broker.call(
          'workbench.chat',
          {
            channel: 'open-webui',
            conversationId: `synthetic-live-${run}`,
            message,
            messages: [{ role: 'user', content: message }],
          },
          {
            meta: {
              cernionToken: process.env.CERNION_TOKEN,
              authUser: {
                tenantId: 'tenant-a',
                userId: 'synthetic-person',
                name: 'Synthetic Person',
                roles: ['ROLE_EDM'],
                scope: 'full-access',
              },
            },
            timeout: 120000,
          }
        );
        const answer = result.responseText;
        assert(!/Der Nutzer|Der Anfragende|^\s*(?:Prüfe|Kläre|Nenne)\s/m.test(answer));
        if (!turn) {
          assert(answer.includes('3 Nachrichten'));
          assert(answer.includes('Positionssumme'));
          assert(answer.includes('Negativer Betrag'));
        }
        if (turn === 1) {
          assert(answer.includes('1.227'));
          assert(answer.includes('MOA 203'));
        }
        if (turn === 2) {
          assert(answer.includes('SYN-INV-001'));
          assert(answer.includes('SYN-INV-002'));
          assert(!answer.includes('SYN-INV-003'));
        }
        assert((answer.match(/\?/g) || []).length <= 1);
        report.turns.push({
          run,
          question,
          elapsedMs: Math.round(performance.now() - start),
          phaseTimes: result.phaseTimes,
          passed: true,
          responseText: answer,
        });
      }
    }
    assert(calls.length > 0, 'No successful real model call; live validation failed');
    const target =
      process.env.WORKBENCH_VALIDATION_REPORT ||
      path.join(__dirname, '../docs/validation/814-edifact-live.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        passed: true,
        turns: report.turns.length,
        successfulModelCalls: calls.length,
        inputBytes: report.inputBytes,
        report: target,
      })
    );
  } finally {
    llm.generateText = previous;
    await app.cleanup();
  }
}
if (require.main === module)
  validateEdifactLive().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { validateEdifactLive };
