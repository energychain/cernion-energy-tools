'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const root = path.resolve(__dirname, '../..');
// Two legacy services hard-code absolute directories. Redirect only their filesystem
// paths in this isolated child; the service implementations and lifecycle stay real.
for (const method of [
  'existsSync',
  'mkdirSync',
  'readFileSync',
  'writeFileSync',
  'statSync',
  'readdirSync',
]) {
  const original = fs[method];
  fs[method] = function (filename, ...args) {
    if (typeof filename === 'string') {
      for (const name of ['sessions', 'reports']) {
        const source = path.join(root, 'data', name);
        if (filename === source || filename.startsWith(source + path.sep))
          filename = path.join(process.cwd(), 'data', name, path.relative(source, filename));
      }
    }
    return original.call(this, filename, ...args);
  };
}
const llm = require(path.join(root, 'src/llm-client'));
let modelCalls = 0;
llm.embeddings = async () => []; // startup catalog enrichment uses an empty offline vector fixture
for (const method of ['generateText', 'generateChat', 'generateStructured'])
  llm[method] = async () => {
    modelCalls++;
    throw new Error('Unexpected LLM call');
  };
const broker = new ServiceBroker({
  logger: false,
  transporter: null,
  requestTimeout: 5000,
  retryPolicy: { enabled: false },
});
const stopFailures = [];
broker.localBus.on('$broker.error', (event) => {
  if (event.type === 'FAILED_STOPPING_SERVICES') stopFailures.push(event.error);
});
const tenantId = 'e2e-tenant';
const auth = (id, roles = ['ROLE_USER']) => ({
  authUser: { tenantId, id, roles, scope: 'read-only' },
});
const serviceMeta = {
  apiToken: {
    tenantId,
    id: 'svc-openwebui',
    actorType: 'service',
    scope: 'agentos-session',
    scopes: ['read-only'],
    roles: ['ROLE_USER'],
  },
};
const admin = auth('admin', ['ROLE_TENANT_ADMIN']);
const model = structuredClone(require(path.join(root, 'function-model.json')));
const catalog = require(path.join(root, 'signal-catalog.json'));
const index = require(path.join(root, 'operation-capability-index.json'));
const { policyReason } = require(path.join(root, 'src/shared-service-agent-policy'));
const candidates = catalog.operations.filter(
  (entry) =>
    entry.classification === 'contextual' &&
    entry.parameterNames.includes('caseId') &&
    !policyReason(index.operations.find((op) => op.operationId === entry.operationId))
);
const targets = [];
for (const entry of candidates) {
  const fn = model.functions.find((item) => item.operations.includes(entry.action));
  if (fn && !targets.some((target) => target.fn.functionId === fn.functionId))
    targets.push({ fn, entry });
  if (targets.length === 2) break;
}
assert.equal(targets.length, 2);
// Catalog-derived fixture graph guarantees a contextual read regardless of #730
// capability selection. Routing itself and the real dashboard actions are untouched.
for (const fn of model.functions)
  fn.neighbors = targets
    .filter((target) => target.fn !== fn)
    .map(({ fn: target }) => ({
      functionId: target.functionId,
      weight: 1,
      evidence: ['e2e catalog fixture'],
    }));
for (const { fn, entry } of targets) {
  fn.operations = [entry.action];
  fn.neighbors = model.functions
    .filter((other) => other !== fn)
    .map((other) => ({
      functionId: other.functionId,
      weight: 1,
      evidence: ['e2e catalog fixture'],
    }));
}
let sequence = 0;
const turns = [];
const call = (name, params, meta = admin) =>
  broker.call(name, params, { meta: structuredClone(meta) });
const turn = async (person, message, extra = {}) => {
  const response = await call(
    'openai-compatible.chatCompletions',
    {
      model: 'cernion-governance-assistant',
      messages: [{ role: 'user', content: message }],
      metadata: {
        openWebuiUserId: person,
        openWebuiOrgId: 'org',
        openWebuiConversationId: `conversation-${person}`,
        requestId: `turn-${++sequence}`,
        ...extra,
      },
    },
    serviceMeta
  );
  await settle();
  turns.push({
    person,
    message,
    intent: response.metadata.intentMode,
    state: response.cernion.result.state,
    caseId: response.metadata.cetCaseId,
  });
  return response;
};
async function settle() {
  const coverage = broker.getLocalService('function-coverage');
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(setImmediate);
    await coverage.queue;
    await broker.getLocalService('activation').settle();
    await broker.getLocalService('shared-service-agent').settle();
    await broker.getLocalService('notices').settle();
    if (!coverage.pendingTurns) return;
  }
  throw new Error('Completed-turn observation did not settle');
}
async function snapshot(step) {
  const activations = await call('activation.list', { tenantId });
  const coverage = await call('function-coverage.matrix', { tenantId, limit: 100 });
  const doc = await broker.getLocalService('shared-service-agent').readDocument(tenantId);
  console.log(
    JSON.stringify({
      step,
      turns: sequence,
      coveredActors: [...new Set(coverage.items.map((row) => row.actorId))],
      cet: activations.filter((row) => row.responsibility.cet).map((row) => row.functionId),
      agents: doc.agents.map((agent) => ({
        functionId: agent.functionId,
        lifecycle: agent.lifecycle,
        gaps: (agent.gapLists || []).map((gap) => gap.state),
      })),
    })
  );
}
async function main() {
  for (const directory of ['services', 'custom-services']) {
    const dir = path.join(root, directory);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs
      .readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith('.service.js') &&
          !['api.service.js', 'mqtt-broker.service.js'].includes(name)
      )) {
      const schema = require(path.join(dir, file));
      if (typeof schema === 'function') {
        broker.loadService(path.join(dir, file));
        continue;
      }
      const settings = { ...schema.settings };
      if (
        ['function-coverage', 'activation', 'shared-service-agent', 'notices'].includes(schema.name)
      )
        settings.model = model;
      if (schema.name === 'workbench') settings.systemActivityModel = model;
      if (schema.name === 'journal') settings.functionModel = () => model;
      if (schema.name === 'activation') settings.sweepIntervalMs = 0;
      if (schema.name === 'signals')
        Object.assign(settings, {
          model,
          catalog: { ...catalog, operations: targets.map((target) => target.entry) },
        });
      if (schema.name === 'shared-service-agent')
        settings.signalCatalog = { ...catalog, operations: targets.map((target) => target.entry) };
      if (schema.name === 'shared-service-learning') settings.model = model;
      broker.createService({ ...schema, settings });
    }
  }
  for (const service of broker.services) {
    const originalStop = service._stop;
    service._stop = async function () {
      try {
        return await originalStop.call(this);
      } catch (error) {
        stopFailures.push(new Error(`${this.fullName}: ${error.message}`, { cause: error }));
        throw error;
      }
    };
  }
  await broker.start();
  console.log(`Started ${broker.services.length} services; excluded api and mqtt-broker.`);
  // External retrieval has no bearing on this contract; no credentials/network.
  const router = broker.getLocalService('domain-router');
  router.knowledgeHints = async () => [];
  await call('workbench.admin.tenantMappings.create', {
    client: 'open-webui',
    externalOrgId: 'org',
    cetTenantId: tenantId,
  });
  for (const person of ['alice', 'bob'])
    await call('workbench.admin.userMappings.create', {
      client: 'open-webui',
      externalOrgId: 'org',
      externalUserId: person,
      cetActorId: person,
      roles: ['ROLE_USER'],
    });
  const started = await turn(
    'alice',
    'Starte einen Fall: Netzanschluss Anschlussleistung Mittelspannung prüfen.'
  );
  const caseId = started.metadata.cetCaseId;
  assert(caseId, 'explicit case_start creates a case');
  const selected =
    (
      await router.loadCase(
        require(path.join(root, 'src/domain-router-policy')).principal({ meta: auth('alice') }),
        caseId
      )
    ).lastClassification.selectedCapabilities || [];
  assert(selected.length, 'real router supplies selected capabilities');
  await snapshot('1 case_start');
  await turn(
    'alice',
    'Weiter mit diesem Fall: Netzanschluss Anschlussleistung Mittelspannung prüfen.'
  );
  await turn('bob', 'Starte einen Fall: Netzanschluss Anschlussleistung Mittelspannung prüfen.');
  await turn(
    'bob',
    'Weiter mit diesem Fall: Netzanschluss Anschlussleistung Mittelspannung prüfen.'
  );
  const matrix = await call('function-coverage.matrix', { tenantId, limit: 100 });
  assert(matrix.items.some((row) => row.actorId === 'alice'));
  assert(matrix.items.some((row) => row.actorId === 'bob'));
  assert(!matrix.items.some((row) => row.actorId === 'svc-openwebui'));
  await snapshot('2 separate coverage');
  const rows = await call('activation.list', { tenantId });
  const row = rows.find(
    (item) =>
      item.responsibility.cet && item.reason.some((reason) => reason.context?.ref === caseId)
  );
  assert(row, 'complementary CET activation retains the actual case');
  const agents = broker.getLocalService('shared-service-agent');
  const agent = (await agents.readDocument(tenantId)).agents.find(
    (item) => item.functionId === row.functionId
  );
  assert(agent);
  await snapshot('3 activation and agent');
  // Prefer Alice's most recent context through the normal turn path.
  await turn(
    'alice',
    'Weiter mit diesem Fall: Netzanschluss Anschlussleistung Mittelspannung prüfen.'
  );
  const run = await call('shared-service-agent.runCycle', { tenantId, agentId: agent.agentId });
  await settle();
  console.log('cycle', JSON.stringify(run));
  const stored = (await agents.readDocument(tenantId)).agents.find(
    (item) => item.agentId === agent.agentId
  );
  const gap = stored.gapLists.find((item) => item.context.ref === caseId && item.state === 'open');
  assert(gap, 'real contextual dashboard with missing inputs creates a gap list');
  assert.equal(modelCalls, 0);
  await snapshot('4 context observation and gap list');
  const next = await turn('alice', 'Was gibt es Neues?');
  const text = next.choices[0].message.content;
  const notice = text.match(/L-\d+/)?.[0];
  if (!notice)
    console.log(
      'notice diagnostic',
      JSON.stringify({
        text,
        gap: stored.gapLists,
        queue: await call('notices.list', { tenantId, actorId: 'alice' }, auth('alice')),
        matrix: matrix.items,
      })
    );
  assert(notice, 'next mapped turn displays the gap notice');
  assert(!/attention_|Push source unavailable/.test(text));
  await snapshot('5 next-turn notice');
  const correction = await turn('alice', `${notice} erledigt`);
  assert.equal(correction.metadata.intentMode, 'correction');
  const acceptedGap = await turn('alice', 'Ja');
  assert.match(acceptedGap.choices[0].message.content, /Bestätigt und übernommen/);
  assert(
    (await agents.readDocument(tenantId)).agents
      .flatMap((item) => item.gapLists || [])
      .some((item) => item.completionRequested)
  );
  const fn = model.functions.find((item) => item.functionId === row.functionId);
  const responsibility = await turn(
    'alice',
    `Darum musst du dich nicht kümmern: ${fn.displayLabel}`
  );
  assert.equal(responsibility.metadata.intentMode, 'correction');
  const beforeConfirm = (await call('activation.list', { tenantId })).find(
    (item) => item.functionId === row.functionId
  );
  assert.equal(beforeConfirm.responsibility.cet, true);
  await turn('alice', 'Ja');
  assert.equal(
    (await call('activation.list', { tenantId })).find((item) => item.functionId === row.functionId)
      .responsibility.cet,
    false
  );
  await snapshot('6 confirmed gap and responsibility reactions');
  const undone = await turn('alice', 'Mach das rückgängig');
  assert.equal(undone.metadata.intentMode, 'correction');
  const undoConfirm = await turn('alice', 'Ja');
  assert.match(undoConfirm.choices[0].message.content, /rückgängig gemacht/);
  assert.equal(
    (await call('activation.list', { tenantId })).find((item) => item.functionId === row.functionId)
      .responsibility.cet,
    true
  );
  await snapshot('7 responsibility undo');
  await turn('bob', `Das mache ich selbst: ${fn.displayLabel}`);
  await turn('bob', 'Ja');
  const handoff = (await call('activation.list', { tenantId })).find(
    (item) => item.functionId === row.functionId
  );
  assert(handoff.responsibility.humans.includes('bob'));
  assert.equal(handoff.responsibility.cet, false);
  await snapshot('8 second-person handoff');
  await turn('bob', `Nimm ${fn.displayLabel} ins Inventar auf`);
  await assert.rejects(turn('bob', 'Ja'), /Admin|admin|role|Role/);
  const afterPin = (await call('activation.list', { tenantId })).find(
    (item) => item.functionId === row.functionId
  );
  assert.equal(afterPin.attention.inventory, false);
  await snapshot('9 non-admin pin denied');
  const countBefore = (await router.db.allDocs()).total_rows;
  for (const message of [
    'Nimm eine unklare Tätigkeit ins Inventar auf',
    'Darum musst du dich nicht kümmern: unbekannt',
    'I will handle that myself: unspecified',
    'Eine unklare Nachricht',
  ])
    await turn('alice', message, { openWebuiConversationId: `unclear-${sequence}` });
  assert.equal((await router.db.allDocs()).total_rows, countBefore);
  const beforeUnmapped = broker.getLocalService('function-coverage').unmappedServiceTurns;
  await call(
    'openai-compatible.chatCompletions',
    {
      model: 'cernion-governance-assistant',
      messages: [{ role: 'user', content: 'Eine unklare Nachricht' }],
      metadata: { conversationId: 'unmapped' },
    },
    serviceMeta
  );
  await settle();
  assert(broker.getLocalService('function-coverage').unmappedServiceTurns > beforeUnmapped);
  assert.equal(
    (await call('function-coverage.byActor', { tenantId, actorId: 'svc-openwebui' })).items.length,
    0
  );
  assert.equal(modelCalls, 0);
  console.log('Turns:', JSON.stringify(turns));
}
main()
  .then(async () => {
    await broker.stop();
    assert.equal(stopFailures.length, 0, stopFailures.map((error) => error.message).join('\n'));
    assert.equal(broker.started, false);
  })
  .catch(async (error) => {
    console.error(error);
    await broker.stop();
    process.exitCode = 1;
  });
