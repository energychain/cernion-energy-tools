'use strict';

// Opt-in live model validation. No model overrides, customer records or remote writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
const { createLiveHarness } = require('./workbench-live-harness');
const {
  generateDatasetFixture,
  generateDatasetRoutingFixture,
  fixtureManifest,
} = require('./generate-dataset-fixtures');
const llm = require('../src/llm-client');

async function validateDatasetRoutingLive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-dataset-routing-live-'));
  const fixture = generateDatasetRoutingFixture();
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'rows');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  const Datapoint = require('../services/datapoint.service');
  const backendCalls = [];
  const modelCalls = [];
  for (const name of ['generateStructured', 'generateText', 'generateChat']) {
    const original = llm[name];
    llm[name] = async (...args) => {
      modelCalls.push({ method: name });
      return original(...args);
    };
  }
  const { broker, workbench } = createLiveHarness(dir, [
    { ...Datapoint, settings: { ...Datapoint.settings, dbPath: path.join(dir, 'catalog') } },
    require('../services/dataset.service'),
    {
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }), federatedSearch: () => ({ results: [] }) },
    },
    { name: 'object-store', actions: { query: () => ({ docs: [{ payload: fixture.fact }] }) } },
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
    {
      name: 'energy-market',
      actions: {
        installations: {
          requiredRoles: ['ROLE_GRID_OPERATOR'],
          handler(ctx) {
            backendCalls.push({ operation: 'energy-market.installations', parameters: ctx.params });
            return {
              success: true,
              data: {
                results: Array.from({ length: 2 }, (_, i) => ({
                  name: `Synthetic installation ${i + 1}`,
                  municipality: 'Uslar',
                  capacityKW: 150 + i,
                  operatingStatus: 'In Betrieb',
                })),
              },
            };
          },
        },
      },
    },
  ]);
  const meta = {
    authUser: {
      tenantId: fixture.fact.tenantId,
      userId: 'synthetic-colleague',
      name: 'Synthetische Person',
      roles: ['ROLE_EDM', 'ROLE_GRID_OPERATOR'],
      scope: 'full-access',
    },
  };
  const report = {
    synthetic: true,
    mode: 'Configured live model via llm-client; real Workbench, dataset executor and catalog; controlled synthetic MaStR, memory and empty knowledge source backends.',
    reference: fixtureManifest(),
    runsPerQuestion: 3,
    turns: [],
  };
  const reportPath = path.resolve(
    process.env.WORKBENCH_VALIDATION_REPORT ||
      path.join(__dirname, '../docs/validation/dataset-routing-live.json')
  );
  try {
    await broker.start();
    await broker.call(
      'dataset.turn',
      {
        question: 'Bitte den Lastgang Hauptstraße 2025 ablegen.',
        documents: [{ name: fixture.title, text: generateDatasetFixture() }],
        conversationId: 'synthetic-data-conversation',
      },
      { meta }
    );
    const [record] = await broker.call('datapoint.datasetCatalog', { operation: 'list' }, { meta });
    if (!record) throw new Error('Synthetic dataset not persisted');
    // Each run has an independent history; use the ingestion conversation only for the intentionally elliptical dataset questions.
    for (const scenario of fixture.questions) {
      for (let run = 1; run <= 3; run++) {
        if (!['memory', 'external'].includes(scenario.kind)) {
          const p = require('../src/domain-router-policy').principal({ meta });
          const envelope = require('../src/workbench-contract').normalizeTaskEnvelope({
            channel: 'open-webui',
            conversationId: `synthetic-live-${scenario.kind}-${run}`,
            message: `Datensatz ${fixture.title}`,
          });
          const prior = await broker.call(
            'dataset.query',
            { id: record.id, question: 'Zusammenfassung' },
            { meta }
          );
          await require('../src/workbench-conversation').saveTurn(
            workbench.conversationsDb,
            p,
            envelope,
            {
              situation: {
                concern: `Datensatz ${fixture.title}`,
                situation: `Datensatz ${fixture.title}`,
                hypotheses: [],
                identifiers: [],
                deadlines: [],
                participants: [],
                missingInformation: [],
                requestedAction: {
                  description: 'Auswerten',
                  externalEffect: false,
                  draftRequested: false,
                },
                turnKind: 'knowledge',
                retrievalTerms: [],
                outputKind: 'analysis',
              },
              retrieval: {
                evidence: [
                  {
                    source: 'dataset.query',
                    retrievalSource: 'capability-read',
                    value: prior.responseText,
                    metadata: {
                      tenantId: p.tenantId,
                      datasetId: record.id,
                      version: record.version,
                      parameters: { id: record.id },
                    },
                  },
                ],
                trace: [],
                toolTrace: [],
              },
              evidenceRetrievedAt: 0,
            }
          );
        }
        const callStart = backendCalls.length;
        const llmStart = modelCalls.length;
        const started = performance.now();
        const result = await broker.call(
          'workbench.chat',
          {
            channel: 'open-webui',
            conversationId: `synthetic-live-${scenario.kind}-${run}`,
            message: scenario.question,
            messages:
              scenario.kind === 'memory' || scenario.kind === 'external'
                ? []
                : [
                    { role: 'user', content: `Wir werten den Datensatz ${fixture.title} aus.` },
                    {
                      role: 'assistant',
                      content: `Der Datensatz ${fixture.title} ist die Quelle.`,
                    },
                    { role: 'user', content: scenario.question },
                  ],
          },
          { meta }
        );
        const text = result.responseText || '';
        const sources = result.sources || [];
        const queried = sources.some(
          (source) =>
            (source.source === 'dataset.query' || source.name === 'dataset.query') &&
            source.status === 'available'
        );
        const reads = backendCalls.slice(callStart);
        const checks =
          scenario.kind === 'overview'
            ? {
                rows: /35[.]?040/.test(text),
                missing: /4 leere/.test(text),
                peak: text.includes('1.243,7'),
                energy: text.includes('3.478,874 MWh') || text.includes('3.478.874 kWh'),
              }
            : scenario.kind === 'peak'
              ? {
                  peak: text.includes('1.243,7'),
                  timestamp: text.includes('14.01.2025') && text.includes('18:15'),
                }
              : scenario.kind === 'energy'
                ? {
                    energy: text.includes('3.478,874 MWh') || text.includes('3.478.874 kWh'),
                  }
                : scenario.kind === 'external'
                  ? {
                      noDataset:
                        !queried && !/35[.]?0(?:36|40)|Lastgang|1[.]243,7|3[.]478,874/.test(text),
                      marketRead: reads.some(
                        (entry) => entry.operation === 'energy-market.installations'
                      ),
                    }
                  : {
                      noDataset:
                        !queried && !/35[.]?0(?:36|40)|Lastgang|1[.]243,7|3[.]478,874/.test(text),
                      memory: text.includes(fixture.fact.text),
                    };
        const turn = {
          kind: scenario.kind,
          run,
          question: scenario.question,
          passed: Object.values(checks).every(Boolean),
          checks,
          elapsedMs: Math.round(performance.now() - started),
          state: result.state,
          phaseTimes: result.phaseTimes,
          sources,
          backendCalls: reads,
          modelCalls: modelCalls.slice(llmStart),
          responseText: text,
        };
        report.turns.push(turn);
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ kind: turn.kind, run, passed: turn.passed, checks }));
      }
    }
    report.passed =
      report.turns.length === 15 &&
      report.turns.every((turn) => turn.passed) &&
      modelCalls.length > 0;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({ report: reportPath, passed: report.passed, turns: report.turns.length })
    );
    if (!report.passed) process.exitCode = 1;
  } finally {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

validateDatasetRoutingLive().catch((error) => {
  console.error('Live validation failed:', error.type || error.name);
  process.exitCode = 1;
});
