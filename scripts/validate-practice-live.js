'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  generatePracticeCatalog,
  instantiatePracticeScenario,
} = require('./generate-practice-evaluation-fixtures');
const { checkTurn, auditPracticeFixtures } = require('./practice-evaluation-checks');
const { evaluateRubric } = require('./practice-evaluation-rubric');
const { excerpt, writePracticeReport } = require('./practice-evaluation-report');
const {
  evaluationConfig,
  createLocalTransport,
  createHttpTransport,
} = require('./practice-evaluation-transport');

function readProductRef(root = path.join(__dirname, '..')) {
  const marker = path.join(root, '.git');
  const directory = fs.statSync(marker).isDirectory()
    ? marker
    : path.resolve(
        root,
        fs
          .readFileSync(marker, 'utf8')
          .trim()
          .replace(/^gitdir: /u, '')
      );
  const head = fs.readFileSync(path.join(directory, 'HEAD'), 'utf8').trim();
  if (/^[a-f0-9]{40,64}$/u.test(head)) return head;
  const ref = head.replace(/^ref: /u, '');
  if (!/^refs\/[\w./-]+$/u.test(ref) || ref.includes('..'))
    throw new Error('Invalid git reference');
  const commonFile = path.join(directory, 'commondir');
  const common = fs.existsSync(commonFile)
    ? path.resolve(directory, fs.readFileSync(commonFile, 'utf8').trim())
    : directory;
  for (const base of [directory, common]) {
    const file = path.join(base, ref);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  }
  const packed = fs
    .readFileSync(path.join(common, 'packed-refs'), 'utf8')
    .split('\n')
    .find((line) => line.endsWith(` ${ref}`));
  if (!packed) throw new Error('Git reference not found');
  return packed.split(' ')[0];
}

function readProductTree(root = path.join(__dirname, '..')) {
  const hash = require('node:crypto').createHash('sha256');
  const visit = (relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else {
      hash.update(relative);
      hash.update(fs.readFileSync(absolute));
    }
  };
  for (const relative of [
    'src',
    'services',
    'function-model.json',
    'signal-catalog.json',
    'capability-catalog.json',
  ])
    visit(relative);
  return hash.digest('hex');
}

async function runPracticeEvaluation({
  config,
  budget,
  transport,
  transportFactory,
  judge = evaluateRubric,
  reportPath,
  previous,
  instantiate = instantiatePracticeScenario,
  injectResponse,
  onTurn,
} = {}) {
  const catalog = generatePracticeCatalog();
  const scenarios = catalog.scenarios.filter(
    (item) => !config.selected.length || config.selected.includes(item.id)
  );
  if (
    !scenarios.length ||
    config.selected.some((id) => !catalog.scenarios.some((item) => item.id === id))
  )
    throw new Error('Unknown scenario selection');
  const started = Date.now();
  const report = {
    schemaVersion: '1.0',
    startedAt: new Date(started).toISOString(),
    productRef: readProductRef(),
    productTree: readProductTree(),
    mode: transport?.mode || config.mode,
    catalogVersion: catalog.schemaVersion,
    catalogCount: scenarios.length,
    planned: scenarios.reduce(
      (sum, item) => sum + (item.memory ? config.memoryRepeats : config.repeats),
      0
    ),
    completed: 0,
    runs: [],
    cleanup: [],
    fixtureErrors: auditPracticeFixtures(catalog),
    aborted: null,
    elapsedMs: 0,
    budget: null,
    reducedScope: Boolean(
      config.selected.length || config.repeats < 3 || config.memoryRepeats < 10
    ),
    cost: null,
    currency: config.currency,
  };
  if (report.fixtureErrors.length) throw new Error('Fixture privacy check failed');
  const flush = () => {
    report.elapsedMs = Date.now() - started;
    report.budget = budget.report();
    report.cost =
      config.costPerMillion == null
        ? null
        : (report.budget.tokens.used / 1000000) * config.costPerMillion;
    return writePracticeReport(report, reportPath, previous);
  };
  flush();
  try {
    transport ||= await transportFactory();
    for (const definition of scenarios) {
      const repeats = definition.memory ? config.memoryRepeats : config.repeats;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        budget.assertReady();
        const fixture = instantiate(definition.id, { repeat });
        const errors = auditPracticeFixtures({
          schemaVersion: catalog.schemaVersion,
          scenarios: [fixture],
        });
        if (errors.length) {
          report.fixtureErrors.push(...errors);
          throw new Error('Fixture privacy check failed');
        }
        const state = await transport.startRun(fixture);
        state.anchor = fixture.anchor;
        const run = {
          scenario: fixture.id,
          title: fixture.title,
          repeat,
          expectedRuns: repeats,
          anchor: fixture.anchor,
          memory: Boolean(fixture.memory),
          variant: fixture.variant || null,
          variantCount: fixture.variants?.length || 0,
          dependencies: [
            ...new Set(fixture.turns.flatMap((turn) => turn.expect.dependencies || [])),
          ],
          turns: [],
          rubric: null,
          interaction: false,
        };
        report.runs.push(run);
        const transcript = [];
        const context = {};
        const replies = [];
        try {
          for (const turn of fixture.turns) {
            budget.assertReady();
            const start = Date.now();
            let reply;
            try {
              reply = await transport.send(state, turn);
              budget.assertReady();
            } catch (error) {
              budget.stopForQuota(error);
              budget.assertReady();
              if (
                [
                  'LLM_NOT_CONFIGURED',
                  'LLM_QUOTA_EXCEEDED',
                  'call_limit',
                  'token_limit',
                  'provider_quota',
                  'tenant_quota_exceeded',
                ].includes(error.type)
              )
                throw error;
              reply = { responseText: '', evaluationError: error.type || error.name };
            }
            if (injectResponse) reply = injectResponse(turn, reply);
            if (onTurn) await onTurn({ fixture, turn, reply, repeat });
            const checks = checkTurn(turn, reply, context);
            run.turns.push({
              id: turn.id,
              expectation: turn.expect.description,
              checks,
              responseExcerpt: excerpt(reply.responseText),
              ...(fixture.projectFixtures?.length
                ? {
                    projectRouting: reply.metadata?.projectRouting || {
                      bestProjectId: null,
                      score: 0,
                      margin: 0,
                      reason: 'not_evaluated',
                    },
                  }
                : {}),
              evaluationError: reply.evaluationError || null,
              elapsedMs: Date.now() - start,
            });
            transcript.push({
              expectation: turn.expect.description,
              answer: String(reply.responseText || ''),
            });
            replies.push(reply);
            if (!context.caseId && reply.cetCaseId) context.caseId = reply.cetCaseId;
            context.caseDisplayRef ||= String(reply.responseText || '').match(/\bF-\d+\b/u)?.[0];
            flush();
          }
          if (fixture.memory)
            run.interaction =
              replies.some((reply) => reply.statements?.some((fact) => fact.relationIds?.length)) &&
              /2030/.test(replies[1].responseText) &&
              /2034/.test(replies[1].responseText);
          budget.assertReady();
          try {
            run.rubric = await judge(transcript, { tenantId: state.tenantId });
            budget.assertReady();
          } catch (error) {
            budget.stopForQuota(error);
            budget.assertReady();
            if (['LLM_NOT_CONFIGURED', 'LLM_QUOTA_EXCEEDED'].includes(error.type)) throw error;
            run.rubricError = error.type || error.name;
          }
          report.completed++;
        } finally {
          try {
            report.cleanup.push(...(await transport.cleanup(state)));
          } catch (error) {
            report.cleanup.push({
              action: 'cleanup',
              passed: false,
              reason: error.type || error.name,
            });
          }
          flush();
        }
      }
    }
  } catch (error) {
    report.aborted = budget.state.stopped || error.type || error.name;
  } finally {
    try {
      if (transport) await transport.close();
    } catch (error) {
      report.cleanup.push({ action: 'close', passed: false, reason: error.type || error.name });
    }
    flush();
  }
  return report;
}

async function validatePracticeLive({ onTurn } = {}) {
  require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
  const config = evaluationConfig();
  process.env.LIVE_MAX_TOKENS = String(config.tokenLimit);
  const budget = require('./live-validation-budget').installLiveBudget({ limit: config.callLimit });
  const reportPath = path.resolve(
    process.env.PRACTICE_REPORT ||
      path.join(
        __dirname,
        `../docs/validation/practice-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
      )
  );
  if (!reportPath.endsWith('.md')) throw new Error('Practice report must be Markdown');
  const previousPath =
    process.env.PRACTICE_PREVIOUS_REPORT ||
    path.join(path.dirname(reportPath), 'practice-evaluation-latest.json');
  const previous = fs.existsSync(previousPath)
    ? JSON.parse(fs.readFileSync(previousPath, 'utf8'))
    : null;
  const transportFactory = () =>
    config.mode === 'http'
      ? createHttpTransport({ config, budget })
      : createLocalTransport({ config, budget });
  const report = await runPracticeEvaluation({
    config,
    budget,
    transportFactory,
    reportPath,
    previous,
    onTurn,
  });
  process.stdout.write(
    JSON.stringify({
      report: path.basename(reportPath),
      completed: report.completed,
      planned: report.planned,
      passed: report.gate.passed,
      aborted: report.aborted,
    }) + '\n'
  );
  process.exitCode = report.aborted ? 2 : report.gate.passed ? 0 : 1;
  return report;
}
if (require.main === module)
  validatePracticeLive().catch((error) => {
    process.stderr.write(`Evaluation failed: ${error.type || error.name}\n`);
    process.exitCode = 2;
  });
module.exports = { runPracticeEvaluation, validatePracticeLive, readProductRef, readProductTree };
