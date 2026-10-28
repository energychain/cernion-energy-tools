'use strict';

// Live acceptance for the cold start (#997): a fresh tenant, two synthetic people, normal work
// turns. Checks that knowledge needs fill up without a questionnaire, that person B benefits from
// what person A said, and that the self-report names known and open items with provenance.
// Synthetic data only; costs a few LLM calls (budget-capped like release:practice).
const path = require('node:path');

const TURNS = [
  [
    'a',
    'main',
    'Kurz zum Kontext für künftige Anfragen: Wir sind Netzbetreiber mit der Netzbetreiber-ID SYN-9900000000003 und betreiben die Sparten Strom und Gas.',
  ],
  [
    'a',
    'main',
    'Unser Bilanzkreis für Netzverluste ist SYN-BK-21, unser Netzgebiet heißt Netzgebiet Nord-Synth.',
  ],
  ['a', 'main', 'Die BDEW-Codenummer unseres Netzbetriebs lautet SYN-BDEW-0099.'],
  ['a', 'main', 'Unsere Gebotszone ist DE-LU, das brauchen wir für Markt- und Prognosedaten.'],
  ['a', 'main', 'Unser Netzgebiet hat die Grid-Area-ID SYN-GA-7.'],
  ['b', 'other', 'Für Steuerbarkeitsnachweise ist bei uns das Team Netzführung zuständig.'],
  ['b', 'other', 'Was weißt du schon über uns und was fehlt dir noch?'],
];

async function main() {
  require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
  const { createLocalTransport } = require('./practice-evaluation-transport');
  const { instantiatePracticeScenario } = require('./generate-practice-evaluation-fixtures');
  const budget = require('./live-validation-budget').installLiveBudget({
    limit: Number(process.env.LIVE_MAX_CALLS || 300),
  });
  const transport = await createLocalTransport({ budget });
  const run = await transport.startRun(instantiatePracticeScenario('file-question'));
  const replies = [];
  try {
    for (const [index, [actor, chat, message]] of TURNS.entries()) {
      const reply = await transport.send(run, { id: `t${index}`, actor, chat, message });
      replies.push({ actor, message, reply: String(reply.responseText || '') });
    }
    // Recognition runs off the answer path.
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.SETTLE_MS || 60000)));
    const answered = await transport.call('knowledge-needs.list', { state: 'answered' }, run);
    const summary = await transport.call('knowledge-needs.summary', {}, run);
    const facts = process.env.COLD_START_DIAGNOSE
      ? (
          await transport.call('tenant-memory-policy.list', {}, run, run.actors[0], { admin: true })
        ).statements?.map((item) => item.text)
      : undefined;
    const report = {
      answered: answered.map((need) => ({
        key: need.key,
        value: need.answers?.at(-1)?.value,
        actorId: need.answers?.at(-1)?.actorId,
        provenance: Boolean(need.answers?.at(-1)?.storeRef),
      })),
      summary,
      selfReport: replies.at(-1).reply,
      ...(facts ? { facts } : {}),
    };
    const checks = {
      atLeastFiveAnswered: report.answered.length >= 5,
      everyAnswerHasProvenance: report.answered.every((item) => item.provenance && item.actorId),
      selfReportNamesKnownFact: report.answered.some(
        (item) => item.value && report.selfReport.includes(item.value)
      ),
      noQuestionnaire: replies.every(
        (item) => (item.reply.match(/Kurze Rückfrage für künftige Anfragen/gu) || []).length <= 1
      ),
    };
    console.log(JSON.stringify({ checks, report, replies }, null, 2));
    process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
  } finally {
    await transport.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.stack);
    process.exitCode = 2;
  });

module.exports = { TURNS, main, root: path.join(__dirname, '..') };
