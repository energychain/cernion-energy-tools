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
const longEvidence = Array.from({ length: 5 }, (_, index) => ({
  id: `synthetic-ebd-${index}`,
  title:
    index % 2
      ? 'BDEW-Umsetzungsfragen zum Lieferbeginn (Testtext)'
      : 'EBD E_0608 (synthetischer Testtext)',
  score: 32 - index,
  excerpt: (
    'Allgemeine Dokumentstruktur mit Prüfpfaden und Verweisen. '.repeat(10) +
    'Lieferbeginn und Netzanmeldung: Die Anmeldung benötigt eine fachliche Prozessantwort über den Marktkommunikations-Kanal. Eine technische Eingangsbestätigung ersetzt diese fachliche Antwort nicht. Bei unbekanntem Status muss die zuständige Bearbeitung den tatsächlichen Ausgang prüfen. Keine Frist aus der Mail ableiten. ' +
    'Weitere Prüfpfade und Dokumentverweise stehen im vollständigen Dokument. '.repeat(20)
  ).slice(0, 1600),
  url: `https://example.invalid/synthetic-ebd-${index}`,
}));
const reportFile = path.basename(
  process.env.WORKBENCH_VALIDATION_REPORT || '746-answer-recovery-live.json'
);
const originalText = llm.generateText;
llm.generateText = async (...args) => {
  let raw;
  try {
    raw = await originalText(...args);
  } catch (error) {
    diagnostics.push({
      providerError: require('../src/workbench-llm-errors').llmErrorDetails(error),
      schemaDetails:
        String(error.message).match(/Unknown name "[a-zA-Z]+" at '[\w.\[\]0-9]+'/g) || [],
      schemaMessage: String(error.message)
        .replace(/https?:\/\/\S+/g, '[provider-url]')
        .slice(0, 700),
    });
    throw error;
  }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-746-live-'));
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
  broker.createService({
    name: 'willi-mako',
    actions: {
      resolveStructure: () => ({
        success: true,
        data: {
          sources: longEvidence,
          noCallBoundaries: [],
        },
      }),
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
    'Anonymisierte Mail eines Lieferanten an einen Netzbetreiber: Zu unserer Netzanmeldung zum Lieferbeginn vom 05.10.2026, DAR DE000000000001, Marktlokation 99000000001, Anschlussadresse Beispielstraße 1, fehlt laut unserem Bearbeitungsstand die Rückmeldung. Die Frist ist laut Mail überschritten. Bitte teilen Sie uns den Bearbeitungsstand mit. Kannst du mir helfen?',
    'Die Eingangsbestätigung liegt vor. Was bedeutet das für den nächsten Schritt?',
    'Mach mir die Antwort fertig',
  ];
  const report = {
    mode: 'live central LLM / synthetic long EBD source stubs; no actor mapping; reconstructed anonymous mail',
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
    const history = [];
    for (const message of messages) {
      const start = performance.now();
      history.push({ role: 'user', content: message });
      const result = await broker.call(
        'workbench.chat',
        {
          channel: 'open-webui',
          conversationId: 'anonymous-746-three-turns',
          message,
          messages: history,
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
      history.push({ role: 'assistant', content: result.responseText });
      report.turns.push({
        message,
        elapsedMs: Math.round(performance.now() - start),
        state: result.state,
        phaseTimes: result.phaseTimes,
        sources: result.sources,
        caseId: result.cetCaseId,
        answerStatus: result.answerStatus,
        answerAttempts: result.answerAttempts,
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
validateLiveWorkbench()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Live validation unavailable:', error.type || error.name);
    process.exit(1);
  });
