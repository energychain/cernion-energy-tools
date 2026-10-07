'use strict';

// Explicit opt-in: real central LLM facade, anonymous input, stubbed source services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// LLM configuration is supplied through the process environment, like the application.
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Router = require('../services/domain-router.service');
const PersonalAgent = require('../services/personal-agent.service');
const llm = require('../src/llm-client');
const validateAnswer = new (require('ajv'))({ allErrors: true }).compile(
  require('../src/workbench-understanding').ANSWER_SCHEMA
);
const diagnostics = [];
const reportFile = path.basename(process.env.WORKBENCH_VALIDATION_REPORT || '742-live-model.json');
const originalText = llm.generateText;
llm.generateText = async (...args) => {
  const raw = await originalText(...args);
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    diagnostics.push({
      valid: !!validateAnswer(parsed),
      errors: validateAnswer.errors,
      draftType: typeof parsed.draft,
    });
  } catch (_error) {
    diagnostics.push({ valid: false, parseError: true });
  }
  return raw;
};

async function validateLiveWorkbench() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-739-live-'));
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const settings = Object.assign(
    {},
    ...Workbench.mixins.map((mixin) => mixin.settings || {}),
    Workbench.settings
  );
  for (const name of Object.keys(settings))
    if (name.endsWith('DbPath') || name === 'dbPath') settings[name] = path.join(dir, name);
  broker.createService({ ...Workbench, settings });
  broker.createService({
    ...Router,
    settings: {
      ...Router.settings,
      dbPath: path.join(dir, 'router'),
      eventsDbPath: path.join(dir, 'events'),
      knowledgeTimeoutMs: 50,
    },
  });
  broker.createService({
    name: 'personal-agent',
    methods: PersonalAgent.methods,
    actions: { collectWorkbenchEvidence: PersonalAgent.actions.collectWorkbenchEvidence },
  });
  broker.createService({
    name: 'knowledge-rag',
    actions: {
      query: (ctx) => ({
        results: [
          {
            id: 'local-process-note',
            score: 0.92,
            summary:
              ctx.params.query +
              '\n' +
              'Anfrage dokumentieren. Referenz, Eingangsdatum und zuständige Bearbeitung prüfen. Behauptungen anhand der ursprünglichen Anfrage und Eingangsbestätigung verifizieren.',
            url: 'https://example.invalid/anonymous-process-note',
          },
          {
            id: 'irrelevant-note',
            score: 0.58,
            summary: 'Rotorblattwartung und Schmierstoffkontrolle.',
          },
        ],
      }),
      federatedSearch: () => ({ results: [] }),
    },
  });
  broker.createService({ name: 'datapoint', actions: { list: () => ({ datapoints: [] }) } });
  broker.createService({ name: 'object-store', actions: { query: () => ({ docs: [] }) } });
  broker.createService({
    name: 'capability-broker',
    actions: {
      recommend: () => ({
        uncertain: true,
        candidateCapabilities: [],
        recommendedCapabilities: [],
      }),
    },
  });
  broker.createService({
    name: 'agent-receipts',
    actions: { select: () => ({ data: { selected: false } }) },
  });
  const fixtures = require('../tests/fixtures/capability-routing-eval.json');
  const domains = [
    'market_communication',
    'redispatch',
    'grid_connection',
    'asset_grid_planning',
    'm2c_revenue_assurance',
  ];
  const examples = domains.map(
    (domain) =>
      fixtures.cases
        .filter((row) => row.source === 'independent-regression' && row.primaryDomain === domain)
        .sort((a, b) => b.query.length - a.query.length)[0]
  );
  const messages = [
    'Mail eines Lieferanten an einen Netzbetreiber: Überfällige Antwort auf Netzanmeldung, Marktlokation 99000000001, Frist überschritten. Kannst du mir helfen?',
    ...examples.map((row) => `Weitergeleitetes Dokument:\n${row.query}\nKannst du mir helfen?`),
  ];
  const report = {
    mode: 'live central LLM / stubbed sources; no test-instance retrieval',
    provider: process.env.LLM_PROVIDER || 'gemini',
    models: require('../src/workbench-understanding').llmOptions('anonymous-validation').model,
    answerModel: require('../src/workbench-understanding').llmOptions(
      'anonymous-validation',
      'answer'
    ).model,
    budgets: process.env.WORKBENCH_LLM_TIMEOUT_MS || '4500',
    examples: examples.map(({ id, primaryDomain }) => ({ id, primaryDomain })),
    turns: [],
    answerDiagnostics: diagnostics,
  };
  try {
    await broker.start();
    for (const message of messages) {
      const start = performance.now();
      const result = await broker.call(
        'workbench.chat',
        {
          channel: 'open-webui',
          conversationId: `anonymous-live-review-${report.turns.length}`,
          message,
        },
        {
          meta: {
            apiToken: {
              tenantId: 'anonymous-validation',
              id: 'anonymous-person',
              roles: ['ROLE_GRID_OPERATOR'],
            },
          },
        }
      );
      report.turns.push({
        message,
        elapsedMs: Math.round(performance.now() - start),
        state: result.state,
        answerStatus: result.answerStatus,
        responseText: result.responseText,
        situation: result.situation,
        evidence: result.evidence,
        retrievalTrace: result.retrievalTrace,
        caseCreated: !!result.cetCaseId,
        draftCreated: !!result.draftId,
      });
    }
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
validateLiveWorkbench().catch((error) => {
  console.error('Live validation unavailable:', error.type || error.name);
  process.exitCode = 1;
});
