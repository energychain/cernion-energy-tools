'use strict';

// Explicit local/test validation: no application HTTP endpoint, remote persistence or deployment.
if (process.env.WORKBENCH_VALIDATION_NON_PRODUCTION !== 'true' || !process.env.WORKBENCH_ENV_FILE)
  throw new Error(
    'Set WORKBENCH_VALIDATION_NON_PRODUCTION=true and a dedicated WORKBENCH_ENV_FILE.'
  );
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE, quiet: true });
process.env.WORKBENCH_LLM_TIMEOUT_MS ||= '45000,90000';
process.env.WORKBENCH_TURN_TIMEOUT_MS ||= '180000';
const budget = require('./live-validation-budget').installLiveBudget();
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createLiveHarness, isolatedSettings } = require('./workbench-live-harness');
const {
  generateAcceptanceFixture,
  acceptanceChecks,
} = require('./generate-workbench-873-fixtures');

async function validateRc3ArtifactsLive() {
  const report = {
    synthetic: true,
    issue: 873,
    mode: 'Real central LLM facade; local broker and isolated case, memory and notice stores; generated source services.',
    runsPerScenario: 3,
    setupTurns: [],
    turns: [],
    cleanupCalls: [],
    failures: [],
  };
  const reportPath = path.resolve(
    process.env.WORKBENCH_VALIDATION_REPORT ||
      path.join(__dirname, '../docs/validation/workbench-873-live.json')
  );
  const runs = Number(process.env.WORKBENCH_VALIDATION_RUNS || 3);
  if (!Number.isSafeInteger(runs) || runs < 3)
    throw new Error('At least three complete runs are required');
  try {
    for (let run = 1; run <= runs; run++) {
      const fixture = generateAcceptanceFixture(`live${run}${require('node:crypto').randomUUID()}`);
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-873-live-'));
      const backendCalls = [];
      const schemas = [
        {
          name: 'knowledge-rag',
          actions: {
            query: () => ({ results: [] }),
            federatedSearch: () => ({ results: [] }),
            documentSearch: () => [],
            documentList: () => [],
          },
        },
        {
          name: 'datapoint',
          actions: { list: () => ({ datapoints: [] }), datasetCatalog: () => fixture.records },
        },
        {
          name: 'dataset',
          actions: {
            turn: () => ({ handled: false, datasetIds: [], documents: [] }),
            query: () => {
              backendCalls.push('dataset.query');
              return {
                responseText: fixture.noisyLines.join('\n\n'),
                datasetId: fixture.records[0].id,
              };
            },
          },
        },
        {
          name: 'capability-broker',
          actions: {
            recommend: () => ({
              uncertain: true,
              recommendedCapabilities: [],
              candidateCapabilities: [],
            }),
          },
        },
        { name: 'agent-receipts', actions: { select: () => ({ data: { selected: false } }) } },
      ];
      for (const schema of [
        require('../services/object-store.service'),
        require('../services/shared-service-notices.service'),
      ]) {
        schemas.push({ ...schema, settings: isolatedSettings(schema, directory) });
      }
      schemas.push(require('../services/tenant-memory-policy.service'));
      const { broker, workbench } = createLiveHarness(directory, schemas);
      workbench.logger.info = (message, detail) => {
        if (/fallback|filters|schema rejection/.test(message))
          console.log(JSON.stringify({ message, detail }));
      };
      workbench.logger.warn = (message, detail) => console.log(JSON.stringify({ message, detail }));
      const identity = {
        authUser: {
          tenantId: fixture.tenantId,
          userId: fixture.actorId,
          name: `Prüfperson${run}`,
          roles: ['ROLE_GRID_OPERATOR', 'ROLE_EDM'],
          scope: 'full-access',
        },
      };
      const send = (message, conversationId) =>
        broker.call(
          'workbench.chat',
          { channel: 'api', conversationId, message },
          { meta: identity, timeout: 240000 }
        );
      const record = (scenario, result, extra = {}) => {
        const checks = { ...acceptanceChecks(scenario, result, fixture), ...extra };
        report.turns.push({
          run,
          scenario: scenario.number,
          input: scenario.message,
          responseText: result.responseText,
          checks,
          answerStatus: result.answerStatus,
          metadata: result.metadata,
          situation: result.situation,
          caseDisplayRef: result.caseDisplayRef,
        });
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ run, scenario: scenario.number, checks }));
        if (Object.values(checks).includes(false))
          report.failures.push({ run, scenario: scenario.number });
      };
      try {
        await broker.start();
        for (const message of fixture.workTurns) {
          const result = await send(message, `work-${run}`);
          report.setupTurns.push({
            run,
            scenario: 1,
            input: message,
            responseText: result.responseText,
            situation: result.situation,
            metadata: result.metadata,
            caseDisplayRef: result.caseDisplayRef,
          });
        }
        record(fixture.scenarios[0], await send(fixture.scenarios[0].message, `work-${run}`));
        record(fixture.scenarios[1], await send(fixture.scenarios[1].message, `work-${run}`));
        const queryCount = backendCalls.length;
        record(
          fixture.scenarios[4],
          await send(fixture.scenarios[4].message, `governance-${run}`),
          { noDatasetCall: backendCalls.length === queryCount }
        );
        const memoryStore = require('../src/tenant-memory-store');
        const p = {
          tenantId: fixture.tenantId,
          actorId: fixture.actorId,
          roles: identity.authUser.roles,
          clearance: [],
        };
        const ctx = {
          broker,
          meta: identity,
          call: (name, params, options) =>
            broker.call(name, params, { ...options, meta: { ...identity, ...options?.meta } }),
        };
        for (let i = 0; i < 20; i++) await memoryStore.put(ctx, p, fixture.fact(i));
        const notices = broker.getLocalService('notices');
        const legacy = await notices.read(p.tenantId, p.actorId);
        for (let i = 0; i < 20; i++)
          legacy.queue.push({
            kind: 'memory',
            change: true,
            relationId: fixture.fact(i).id,
            factIds: [fixture.fact(i).id],
            ref: `G-${i}`,
            sequence: i,
            turn: legacy.turn,
            eventKey: `synthetic-legacy-${i}`,
          });
        await notices.save(legacy);
        const adminMeta = {
          authUser: {
            ...identity.authUser,
            userId: 'synthetic-admin',
            roles: ['ROLE_TENANT_ADMIN'],
          },
        };
        for (let i = 0; i < 20; i++)
          await broker.call(
            'tenant-memory-policy.delete',
            { id: fixture.fact(i).id, reason: 'Synthetic acceptance 873 cleanup' },
            { meta: adminMeta }
          );
        const cleanup = await broker.call(
          'tenant-memory-policy.discardDeletionNotices',
          { reason: 'Synthetic acceptance 873 legacy cleanup' },
          { meta: adminMeta }
        );
        report.cleanupCalls.push({
          run,
          route: 'POST /api/tenant-memory-policy/discard-deletion-notices',
          role: 'ROLE_TENANT_ADMIN',
          response: cleanup,
        });
        record(
          fixture.scenarios[7],
          await send(fixture.scenarios[7].message, `after-cleanup-${run}`),
          { auditedCleanup: cleanup.discarded === 20 }
        );
        for (const message of fixture.caseTurns) {
          const result = await send(message, `case-${run}`);
          report.setupTurns.push({
            run,
            scenario: 10,
            input: message,
            responseText: result.responseText,
            situation: result.situation,
            metadata: result.metadata,
            caseDisplayRef: result.caseDisplayRef,
          });
        }
        record(
          fixture.scenarios[9],
          await send(fixture.scenarios[9].message, `new-case-chat-${run}`)
        );
      } finally {
        await broker.stop();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  } catch (error) {
    report.failures.push({ errorClass: error.type || error.name, message: error.message });
    process.exitCode = 1;
  } finally {
    report.budget = budget.report();
    delete report.budget.tokens.lastMeta;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    if (report.failures.length) process.exitCode = 1;
  }
}
if (require.main === module) void validateRc3ArtifactsLive();
module.exports = { validateRc3ArtifactsLive };
