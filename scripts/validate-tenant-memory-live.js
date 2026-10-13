'use strict';
const budget = require('./live-validation-budget').installLiveBudget();

// Real configured LLM facade; synthetic actors/anchors and isolated local persistence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
const { createLiveHarness } = require('./workbench-live-harness');
const llm = require('../src/llm-client');
const memory = require('../src/tenant-memory');
const store = require('../src/tenant-memory-store');
const {
  generateMemoryAnchorFixture,
  generateMemoryMessageFixture,
} = require('./generate-memory-cleanup-fixture');

async function validateTenantMemoryLive() {
  const scenario868 = process.env.TENANT_MEMORY_LIVE_SCENARIO === '868';
  const scenario863 = scenario868 || process.env.TENANT_MEMORY_LIVE_SCENARIO === '863';
  const repeats = scenario863
    ? Number(process.env.TENANT_MEMORY_LIVE_RUNS || (scenario868 ? 10 : 5))
    : 2;
  if (scenario868 && (repeats < 10 || repeats % 10 !== 0))
    throw new Error('Run complete ten-case live batches');
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 20)
    throw new Error('Invalid live run count');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-memory-live-'));
  const ObjectStore = require('../services/object-store.service');
  const Notices = require('../services/shared-service-notices.service');
  const { broker, workbench } = createLiveHarness(dir, [
    { ...ObjectStore, settings: { dbPath: path.join(dir, 'objects') } },
    { ...Notices, settings: { ...Notices.settings, dbPath: path.join(dir, 'notices') } },
    {
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }), federatedSearch: () => ({ results: [] }) },
    },
    { name: 'datapoint', actions: { list: () => ({ datapoints: [] }) } },
    {
      name: 'capability-broker',
      actions: { recommend: () => ({ recommendedCapabilities: [], uncertain: true }) },
    },
    { name: 'agent-receipts', actions: { select: () => ({ data: { selected: false } }) } },
    // A foreign dataset must never intercept a remembered anchor query.
    {
      name: 'dataset',
      actions: {
        turn: (ctx) =>
          /^Was wissen wir/.test(ctx.params.question)
            ? { handled: true, responseText: 'Foreign synthetic load profile' }
            : { handled: false },
      },
    },
  ]);
  const report = {
    synthetic: true,
    mode: 'Real configured LLM via llm-client, real local Object-Store and notices; empty knowledge sources and adversarial dataset routing stub.',
    recovery: memory.recoveryOptions(),
    budgets: {
      workbench: process.env.WORKBENCH_LLM_TIMEOUT_MS || 'default',
      assessmentMs: memory.assessmentOptions('synthetic-validation').timeoutMs,
    },
    runs: [],
    observations: [],
    assessments: [],
  };
  for (const logger of new Set([broker.logger, workbench.logger])) {
    for (const level of ['info', 'warn']) {
      const original = logger[level].bind(logger);
      logger[level] = (label, details) => {
        if (String(label).startsWith('Tenant memory'))
          report.observations.push({ level, label, ...details });
        original(label, details);
      };
    }
  }
  const original = llm.generateStructured;
  llm.generateStructured = async (...args) => {
    const result = await original(...args);
    const input = JSON.parse(args[1]);
    if (input.memoryInstruction)
      report.assessments.push({
        phase: 'understanding',
        candidates: result.tenantMemory?.assertions?.length || 0,
        turnKind: result.turnKind,
        assertions: result.tenantMemory?.assertions || [],
      });
    if (input.fact)
      report.assessments.push({
        phase: 'assessment',
        relations: result.relations?.length || 0,
        result,
      });
    return result;
  };
  let recoveryReplay;
  try {
    await broker.start();
    for (const defaultOrder of scenario863
      ? [['first', 'second']]
      : [
          ['ben', 'anna'],
          ['anna', 'ben'],
        ]) {
      for (let run = 1; run <= repeats; run++) {
        budget.assertReady();
        const fixture = scenario868
          ? generateMemoryMessageFixture()
          : generateMemoryAnchorFixture();
        const pattern = Math.floor(((run - 1) % 10) / 2);
        const order = scenario863
          ? run % 2
            ? [fixture.actorA, fixture.actorB]
            : [fixture.actorB, fixture.actorA]
          : defaultOrder;
        const actors = scenario863 ? [fixture.actorA, fixture.actorB] : ['ben', 'anna'];
        const anchor = fixture.base;
        const tenantId = `synthetic-memory-${report.runs.length + 1}`;
        for (const [actorId, functionLabel] of [
          [actors[0], 'Gasnetzplanung'],
          [actors[1], 'Stromnetz'],
        ])
          await workbench.store.saveUserContext({
            tenantId,
            actorId,
            roleFamilies: [functionLabel],
          });
        const texts = {
          [actors[0]]: scenario868 ? fixture.patterns[pattern][0] : fixture.textB,
          [actors[1]]: scenario868 ? fixture.patterns[pattern][1] : fixture.textA,
        };
        const send = async (actor, message, freshConversation = false) => {
          budget.assertReady();
          const result = await broker.call(
            'workbench.chat',
            {
              userRequest: message,
              channel: 'api',
              conversationId: `${tenantId}-${actor}${freshConversation ? '-query' : ''}`,
            },
            {
              timeout: 120000,
              meta: {
                apiToken: {
                  id: actor,
                  name: actor,
                  tenantId,
                  roles: ['ROLE_GRID_OPERATOR'],
                  sensitivityFlags: [],
                  scope: 'agentos-session',
                },
              },
            }
          );
          await Promise.allSettled([...(workbench.tenantMemoryJobs || [])]);
          budget.assertReady();
          return result;
        };
        const turns = [];
        for (const actor of order) turns.push({ actor, ...(await send(actor, texts[actor])) });
        const notice = await send(
          order[0],
          scenario868 ? fixture.unrelated : 'Was ist der nächste Schritt?'
        );
        const repeated = scenario868 ? await send(order[0], fixture.news) : null;
        const unrelated = scenario868 ? await send(order[0], fixture.unrelated) : null;
        const queries = await Promise.all(order.map((actor) => send(actor, fixture.query, true)));
        const query = queries[0];
        const p = { tenantId, actorId: order[0], roles: ['ROLE_GRID_OPERATOR'], clearance: [] };
        const facts = await store.query(
          {
            call: (name, params) =>
              broker.call(name, params, {
                meta: {
                  apiToken: {
                    id: p.actorId,
                    tenantId,
                    roles: p.roles,
                    sensitivityFlags: [],
                    scope: 'agentos-session',
                  },
                },
              }),
          },
          p,
          { 'payload.type': 'tenant_memory_fact' }
        );
        const checks = {
          bothCaptured: actors.every((actor) =>
            facts.some((fact) => fact.person.actorId === actor)
          ),
          confirmations: turns.every((turn) => /Hab ich festgehalten/.test(turn.responseText)),
          connected: facts.some((fact) => fact.relationIds.length),
          connectionMentioned: [
            turns[1].responseText,
            notice.noticeBlock || notice.responseText,
          ].some((text) => text.includes(order[0]) && /2030/.test(text) && /2034/.test(text)),
          clearFunctions: ['Gasnetzplanung', 'Stromnetz'].every((label) =>
            query.responseText.includes(label)
          ),
          noticeDelivered:
            /2030/.test(notice.noticeBlock || notice.responseText) &&
            /2034/.test(notice.noticeBlock || notice.responseText),
          scenario1CanonicalBases: facts.every((fact) =>
            fact.anchors.some((item) =>
              store
                .anchorKeys(item)
                .some((key) => JSON.parse(key)[0] === store.normalizeAnchor(anchor))
            )
          ),
          scenario2EachActorListsBoth: queries.every(
            (reply) =>
              reply.state === 'tenant_memory_query' &&
              actors.every((actor) =>
                reply.statements?.some((fact) => fact.person.actorId === actor)
              )
          ),
          readableDate: /\d{2}\.\d{2}\.\d{4}/.test(query.responseText),
        };
        if (scenario868)
          Object.assign(checks, {
            literalWordsContainBase: facts.every(
              (fact) =>
                fact.text.includes(anchor) &&
                fact.basis.includes(anchor) &&
                texts[fact.person.actorId]?.includes(fact.basis)
            ),
            immediateInteraction:
              turns[1].responseText.includes(order[0]) &&
              /2030/.test(turns[1].responseText) &&
              /2034/.test(turns[1].responseText),
            noOwnSameTurnNotice: turns.every(
              (turn) =>
                !turn.noticeBlock &&
                !(turn.metadata?.notices || []).some((item) => item.kind === 'memory')
            ),
            exactlyOneNotice:
              (notice.metadata?.notices || []).filter((item) => item.kind === 'memory').length ===
              1,
            noticeForm:
              (notice.noticeBlock || notice.responseText).includes(
                `Zu ${anchor} gibt es etwas Neues: ${order[1]}`
              ) &&
              /hat am \d{2}\.\d{2}\.\d{4} festgehalten/.test(
                notice.noticeBlock || notice.responseText
              ) &&
              (notice.noticeBlock || notice.responseText).includes(
                'Das hängt mit deiner Aussage vom'
              ) &&
              !/Prüfung ausstehend/.test(notice.noticeBlock || notice.responseText),
            noRepeatedNotice:
              !repeated.noticeBlock &&
              !(repeated.metadata?.notices || []).some((item) => item.kind === 'memory'),
            noUnrelatedNotice:
              !unrelated.noticeBlock &&
              !(unrelated.metadata?.notices || []).some((item) => item.kind === 'memory'),
          });
        recoveryReplay = { p, factId: facts.find((fact) => fact.relationIds.length)?.id };
        report.runs.push({
          order,
          run,
          ...(scenario868
            ? {
                pattern: pattern + 1,
                repeated: repeated.responseText,
                unrelated: unrelated.responseText,
              }
            : {}),
          anchor,
          checks,
          turns: turns.map(({ actor, responseText, situation, state }) => ({
            actor,
            responseText,
            state,
            candidates: situation?.tenantMemory?.assertions?.length,
          })),
          connectionChannel:
            turns[1].responseText.includes(order[0]) &&
            /2030/.test(turns[1].responseText) &&
            /2034/.test(turns[1].responseText)
              ? 'turn'
              : 'notice',
          notice: notice.noticeBlock || notice.responseText,
          queries: queries.map((reply) => reply.responseText),
          facts: facts.map(
            ({ person, checking, attempts, relationIds, anchors, checkingFailure }) => ({
              person,
              anchors,
              checkingFailure,
              checking,
              attempts,
              relationIds,
            })
          ),
        });
        fs.mkdirSync(path.join(__dirname, '../docs/validation'), { recursive: true });
        fs.writeFileSync(
          path.join(__dirname, '../docs/validation/tenant-memory-live-progress.json'),
          JSON.stringify(report, null, 2) + '\n'
        );
        console.log(JSON.stringify({ order, run, checks }));
      }
    }
    if (scenario863) {
      report.scenario = scenario868 ? '868/all-patterns-both-orders' : '863/3';
      report.budget = budget.report();
      delete report.budget.tokens.lastMeta;
      report.passed =
        report.runs.length >= (scenario868 ? 10 : 5) &&
        report.runs.every(
          (run) => Object.values(run.checks).every(Boolean) && run.connectionChannel === 'turn'
        );
      if (!report.passed) process.exitCode = 1;
      return;
    }
    // Scenario 7 uses the same local persistence, with deterministic boundary failures.
    // Never connects to a remote object store; the real facade remains configured above.
    report.scenario7 = [];
    for (const failure of ['write', 'read']) {
      const fixture = generateMemoryAnchorFixture();
      const p = {
        tenantId: 'synthetic-memory-failure',
        actorId: fixture.actorA,
        roles: ['ROLE_GRID_OPERATOR'],
        clearance: [],
      };
      const meta = {
        apiToken: {
          id: p.actorId,
          tenantId: p.tenantId,
          roles: p.roles,
          sensitivityFlags: [],
          scope: 'agentos-session',
        },
      };
      const ctx = {
        broker,
        meta,
        params: {},
        call: (name, params, options) => {
          if (failure === 'write' && name === 'object-store.put')
            return Promise.reject(new Error('Synthetic local write failure'));
          if (
            failure === 'read' &&
            name === 'object-store.query' &&
            params.selector['payload.anchorKeys']
          )
            return Promise.resolve({ docs: [] });
          return broker.call(name, params, { ...options, meta: { ...meta, ...options?.meta } });
        },
      };
      const state = memory.start(workbench, ctx, p, {
        situation: {
          turnKind: 'work',
          requestedAction: {},
          tenantMemory: { assertions: [fixture.second] },
        },
        envelope: { userRequest: fixture.textB, channel: 'api', conversationId: fixture.base },
      });
      await state.job;
      report.scenario7.push({
        failure,
        confirmation: state.confirmation,
        passed: Boolean(state.confirmation) && !/Hab ich festgehalten/u.test(state.confirmation),
      });
    }
    // Replay one completed synthetic fact through the durable queue with the real facade.
    // No provider failure is injected: this verifies the actual recovery timeout and logs.
    if (recoveryReplay?.factId) {
      const { p, factId } = recoveryReplay;
      const meta = {
        tenantId: p.tenantId,
        apiToken: {
          id: p.actorId,
          tenantId: p.tenantId,
          roles: p.roles,
          sensitivityFlags: p.clearance,
          scope: 'agentos-session',
        },
      };
      const ctx = {
        broker,
        meta,
        call: (name, params, options) =>
          broker.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
      };
      await store.mutate(ctx, p, factId, (fact) => ({
        ...fact,
        checking: 'pending',
        attempts: 0,
        nextAttemptAt: '',
      }));
      const started = Date.now();
      await memory.recover(workbench);
      const recovered = (await store.get(ctx, p, factId)).payload;
      report.recovery.realModelReplay = {
        elapsedMs: Date.now() - started,
        checking: recovered.checking,
        attempts: recovered.attempts,
        passed: recovered.checking === 'complete' && recovered.attempts === 1,
      };
    }
    // Observe one entire default recovery period, without a one-second tick.
    const before = report.observations.length;
    await new Promise((resolve) => setTimeout(resolve, 31000));
    report.recovery.idleObservations = report.observations.length - before;
    report.passed =
      report.runs.length === 4 &&
      report.scenario7.every((item) => item.passed) &&
      report.recovery.realModelReplay?.passed &&
      report.observations.some(
        (item) => item.label === 'Tenant memory recovery completed' && item.tenantId
      ) &&
      report.recovery.idleObservations === 0 &&
      report.runs.every((run) => Object.values(run.checks).every(Boolean));
    if (!report.passed) process.exitCode = 1;
  } finally {
    fs.mkdirSync(path.join(__dirname, '../docs/validation'), { recursive: true });
    fs.writeFileSync(
      process.env.WORKBENCH_VALIDATION_REPORT ||
        path.join(__dirname, '../docs/validation/tenant-memory-live.json'),
      JSON.stringify(report, null, 2) + '\n'
    );
    llm.generateStructured = original;
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
validateTenantMemoryLive().catch((error) => {
  console.error(require('../src/workbench-llm-errors').llmErrorDetails(error));
  process.exitCode = 1;
});
