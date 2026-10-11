'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: process.env.WORKBENCH_ENV_FILE || '.env', quiet: true });
const budget = require('./live-validation-budget').installLiveBudget();
const llm = require('../src/llm-client');
const { createLiveHarness } = require('./workbench-live-harness');
const store = require('../src/tenant-memory-store');
const extractions = [];
const originalStructured = llm.generateStructured;
llm.generateStructured = async (...args) => {
  const result = await originalStructured(...args);
  const input = JSON.parse(args[1]);
  if (input.memoryInstruction)
    extractions.push({
      message: input.message,
      previous: input.previous,
      tenantMemory: result.tenantMemory,
      turnKind: result.turnKind,
    });
  return result;
};

async function validate() {
  if (process.argv.includes('--probe')) {
    await llm.generateText('Antworte ausschließlich mit OK.', { timeoutMs: 15000 });
    budget.assertReady();
    process.stdout.write('Probeanfrage erfolgreich; Live-Abnahme darf separat gestartet werden.\n');
    return;
  }
  process.env.TENANT_MEMORY_RECOVERY = 'off';
  process.env.WORKBENCH_LLM_TIMEOUT_MS ||= '15000,45000';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-rc3-live-'));
  const { broker, workbench } = createLiveHarness(directory, [
    {
      ...require('../services/object-store.service'),
      settings: { dbPath: path.join(directory, 'objects') },
    },
    {
      ...require('../services/shared-service-notices.service'),
      settings: {
        ...require('../services/shared-service-notices.service').settings,
        dbPath: path.join(directory, 'notices'),
      },
    },
    {
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }), federatedSearch: () => ({ results: [] }) },
    },
    { name: 'datapoint', actions: { list: () => ({ datapoints: [] }), datasetCatalog: () => [] } },
    {
      name: 'capability-broker',
      actions: { recommend: () => ({ recommendedCapabilities: [], uncertain: true }) },
    },
    { name: 'agent-receipts', actions: { select: () => ({ data: { selected: false } }) } },
  ]);
  const report = {
    synthetic: true,
    passed: false,
    turns: [],
    checks: {},
    extractions,
    observations: [],
    budget: null,
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
  const meta = (actor) => ({
    apiToken: {
      id: actor,
      tenantId: budget.state.tenantId,
      roles: ['ROLE_GRID_OPERATOR'],
      scope: 'agentos-session',
      sensitivityFlags: [],
    },
  });
  const send = async (actor, message, chat = randomUUID()) => {
    const before = budget.report().tokens.used;
    const result = await broker.call(
      'workbench.chat',
      { userRequest: message, channel: 'api', conversationId: chat },
      { meta: meta(actor), timeout: 120000 }
    );
    budget.assertReady();
    report.turns.push({
      actor,
      tokenDelta: budget.report().tokens.used - before,
      responseText: result.responseText,
      sources: result.metadata?.sources,
      statementIds: result.statements?.map((item) => item.id),
    });
    return result;
  };
  const p = (actor) => ({
    tenantId: budget.state.tenantId,
    actorId: actor,
    roles: ['ROLE_GRID_OPERATOR'],
    clearance: [],
  });
  const ctx = (actor) => ({
    broker,
    meta: meta(actor),
    params: {},
    call: (name, params, options) =>
      broker.call(name, params, { ...options, meta: { ...meta(actor), ...options?.meta } }),
  });
  try {
    await broker.start();
    for (const [actorId, functionLabel] of [
      ['Charly', 'Gasnetzplanung'],
      ['Doris', 'Stromnetz'],
    ])
      await workbench.store.saveUserContext({
        tenantId: budget.state.tenantId,
        actorId,
        roleFamilies: [functionLabel],
      });
    const thread =
      'Analysiere diesen eskalierten Lieferanten-Thread: Stand, Risiken und nächster Schritt.\n' +
      Array.from(
        { length: 9 },
        (_, i) =>
          `Von: ${i % 2 ? 'Netzbetreiber' : 'Lieferant'}\nGesendet: ${i + 1}. Oktober 2026\nBetreff: Abmeldung Referenz SYN-900\n${i === 8 ? 'Die APERAK liegt vor, aber die fachliche Abmeldung wurde weiterhin nicht beantwortet. Bitte klärt den Prozessstatus.' : 'Wir warten auf die fachliche Antwort zur Abmeldung; der Empfang allein bestätigt diese nicht.'}`
      ).join('\n\n');
    const analyzed = await send('Charly', thread);
    report.checks.threadAnalysis =
      analyzed.responseText.length > 250 &&
      /Abmeldung|fachlich/.test(analyzed.responseText) &&
      !/größte erfasste Wert|Die vorhandene Abfrage/.test(analyzed.responseText);
    const customer = await send(
      'Charly',
      'Ich führe gerade ein §14a-Kundengespräch. Der Speicher hat 6 kWh, die Wallbox 11 kW. Was muss ich klären?'
    );
    report.checks.customerNotCaptured = !customer.responseText.includes('Hab ich festgehalten');
    for (const order of [
      ['Charly', 'Doris'],
      ['Doris', 'Charly'],
    ]) {
      const anchor = `Test${randomUUID().replaceAll('-', '').replace(/[0-9]/g, 'x')}allee`;
      const texts = {
        Charly: `Die Gasleitung in der ${anchor} müssen wir spätestens 2030 außer Betrieb nehmen. Die Kunden sollen zeitnah informiert werden.`,
        Doris: `Das Stromnetz in der ${anchor} ist am Limit. Frühestens 2034 können wir neue Anträge für Wallboxen oder Wärmepumpen akzeptieren.`,
      };
      const first = await send(order[0], texts[order[0]]);
      const second = await send(order[1], texts[order[1]]);
      report.checks[`${order[0]}_capture`] =
        first.responseText.includes('Hab ich festgehalten') &&
        second.responseText.includes('Hab ich festgehalten');
      report.checks[`${order[0]}_immediateConnection`] =
        second.responseText.includes(order[0]) &&
        second.responseText.includes('2030') &&
        second.responseText.includes('2034');
      const news = await send(order[0], 'Gibt es Neuigkeiten für mich?');
      report.checks[`${order[0]}_news`] =
        news.responseText.includes(order[1]) &&
        news.responseText.includes('2030') &&
        news.responseText.includes('2034');
      const query = await send(order[0], `Was wissen wir zum ${anchor}?`);
      report.checks[`${order[0]}_queryBoth`] =
        query.statements?.length === 2 &&
        query.statements.every((fact) => query.responseText.split(fact.text).length === 2);
    }
    // Persist the pre-820 shape through the real object store: date in basis/time, no retry counters.
    const legacy = {
      id: store.key(['legacy', randomUUID()]),
      type: 'tenant_memory_fact',
      tenantId: budget.state.tenantId,
      sensitivityFlags: [],
      person: {
        actorId: 'Charly',
        name: 'Charly',
        functionLabel: 'Gasnetzplanung',
        roles: ['ROLE_GRID_OPERATOR'],
      },
      at: new Date().toISOString(),
      text: 'Die Gasleitung in der Ulmenstraße soll außer Betrieb gehen.',
      basis: 'Die Gasleitung in der Ulmenstraße nehmen wir spätestens 2030 außer Betrieb.',
      commitment: 'planned',
      anchors: [{ value: 'Ulmenstraße', qualifier: '', aliases: [] }],
      time: { latest: '2030' },
      expiresAt: '',
      status: 'valid',
      relationIds: [],
      checking: 'complete',
      audit: [],
      channel: 'api',
      conversationId: 'old-chat',
    };
    legacy.anchorKeys = legacy.anchors.flatMap(store.anchorKeys);
    await store.put(ctx('Charly'), p('Charly'), legacy);
    const revoked = await send(
      'Charly',
      'Die Aussage zur Gasleitung in der Ulmenstraße (Außerbetriebnahme bis 2030) gilt nicht mehr – bitte streichen'
    );
    report.checks.legacyRevoked =
      revoked.state === 'tenant_memory_corrected' &&
      (await store.get(ctx('Charly'), p('Charly'), legacy.id)).payload.status === 'revoked';
    report.checks.noInternalCodes = report.turns.every(
      (turn) => !/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/.test(turn.responseText)
    );
    report.passed = Object.values(report.checks).every(Boolean);
    if (!report.passed) process.exitCode = 1;
  } finally {
    report.budget = budget.report();
    delete report.budget.tokens.lastMeta;
    const target =
      process.env.WORKBENCH_VALIDATION_REPORT ||
      path.join(__dirname, '../docs/validation/rc3-closeout-live.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    await broker.stop();
    llm.generateStructured = originalStructured;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
validate().catch((error) => {
  process.stderr.write(
    JSON.stringify(require('../src/workbench-llm-errors').llmErrorDetails(error)) + '\n'
  );
  process.exitCode = 1;
});
