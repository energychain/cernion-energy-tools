'use strict';

async function validateWorkbench874Live() {
  if (process.env.WORKBENCH_VALIDATION_NON_PRODUCTION !== 'true' || !process.env.WORKBENCH_ENV_FILE)
    throw new Error('Explicit test configuration and non-production acknowledgement required');
  process.env.PRACTICE_SCENARIOS = Array.from(
    { length: 9 },
    (_, i) => `communication-${i + 1}`
  ).join(',');
  if (Number(process.env.PRACTICE_REPEATS || 3) < 3)
    throw new Error('Every acceptance scenario requires at least three runs');
  const fs = require('node:fs');
  const path = require('node:path');
  const target = path.resolve(
    process.env.WORKBENCH_VALIDATION_REPORT ||
      path.join(
        fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'workbench-874-')),
        'turns.json'
      )
  );
  const turns = [];
  const flush = () =>
    fs.writeFileSync(target, JSON.stringify({ scenarios: 9, turns }, null, 2) + '\n');
  const report = await require('./validate-practice-live').validatePracticeLive({
    onTurn: ({ fixture, turn, reply, repeat }) => {
      turns.push({
        scenario: fixture.id,
        run: repeat,
        id: turn.id,
        input: turn.message,
        responseText: reply.responseText,
        situation: {
          requestedOutput: reply.situation?.requestedOutput,
          codeReferences: reply.situation?.codeReferences,
          conversationPreferences: reply.situation?.conversationPreferences,
          disclosure: reply.situation?.disclosure,
          personAssessment: reply.situation?.personAssessment,
          linkedCaseProposal: reply.situation?.linkedCaseProposal,
        },
        metadata: {
          degraded: reply.metadata?.degraded,
          degradedReason: reply.metadata?.degradedReason,
        },
        checks: require('./practice-evaluation-checks').checkTurn(turn, reply),
      });
      flush();
    },
  });
  // A focused acceptance measurement does not turn the full release gate green.
  const passed =
    !report.aborted &&
    report.completed === report.planned &&
    report.gate.metrics.length === 9 &&
    report.gate.metrics.every((item) => item.passed) &&
    report.cleanup.every((item) => item.passed) &&
    !report.fixtureErrors.length;
  process.exitCode = report.aborted ? 2 : passed ? 0 : 1;
  process.stdout.write(
    JSON.stringify({ acceptance: '874', passed, completed: report.completed }) + '\n'
  );
  return report;
}

if (require.main === module)
  validateWorkbench874Live().catch((error) => {
    process.stderr.write(`Live validation failed: ${error.type || error.name}\n`);
    process.exitCode = 2;
  });
module.exports = { validateWorkbench874Live };
