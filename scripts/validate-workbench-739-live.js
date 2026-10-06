'use strict';

// Explicit opt-in: real central LLM facade, anonymous input, stubbed source services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const envFile = process.argv[2];
if (envFile) {
  const values = require('dotenv').parse(fs.readFileSync(envFile));
  for (const name of [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'LLM_API_KEY',
    'LLM_PROVIDER',
    'LLM_MODEL',
    'LLM_BASE_URL',
  ])
    if (values[name] && !process.env[name]) process.env[name] = values[name];
}
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Router = require('../services/domain-router.service');
const PersonalAgent = require('../services/personal-agent.service');
const llm = require('../src/llm-client');
const validateAnswer = new (require('ajv'))({ allErrors: true }).compile(
  require('../src/workbench-understanding').ANSWER_SCHEMA
);
const diagnostics = [];
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
      query: () => ({
        results: [
          {
            id: 'local-process-note',
            score: 0.92,
            summary:
              'Netzanmeldung: Anfrage dokumentieren. Referenz, Eingangsdatum und zuständige Bearbeitung prüfen. Die behauptete Fristüberschreitung anhand der ursprünglichen Anfrage und Eingangsbestätigung verifizieren.',
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
  const messages = [
    'Mail eines Lieferanten an einen Netzbetreiber: Überfällige Antwort auf Netzanmeldung, Marktlokation 99000000001, Frist überschritten. Kannst du mir helfen?',
    'Antwort per Mail senden',
    'Entwurf bitte',
    'Kein Fall',
  ];
  const report = {
    mode: 'live central LLM / stubbed sources; no test-instance retrieval',
    provider: process.env.LLM_PROVIDER || 'gemini',
    model: process.env.LLM_MODEL || process.env.GEMINI_MODEL || 'adapter-default',
    turns: [],
    answerDiagnostics: diagnostics,
  };
  try {
    await broker.start();
    for (const message of messages) {
      const start = performance.now();
      const result = await broker.call(
        'workbench.chat',
        { channel: 'open-webui', conversationId: 'anonymous-live-review', message },
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
      path.join(__dirname, '../docs/validation/739-live-model.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    console.log(
      JSON.stringify({
        report: 'docs/validation/739-live-model.json',
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
