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
let proposalModelCalls = 0;
llm.generateStructured = async () => {
  proposalModelCalls++;
  return { summary: 'Bitte prüfe die fehlenden Angaben zum aktuellen Fall.' };
};
for (const method of ['generateText', 'generateChat'])
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
const touchEvents = [];
const originalEmit = broker.emit.bind(broker);
broker.emit = (...args) => {
  if (args[0] === 'function.touched.v1') touchEvents.push(structuredClone(args[1]));
  return originalEmit(...args);
};
broker.localBus.on('$broker.error', (event) => {
  if (event.type === 'FAILED_STOPPING_SERVICES') stopFailures.push(event.error);
});
const tenantId = 'e2e-tenant';
const actor = (id) => (['alice', 'bob'].includes(id) ? `cet-${id}` : id);
const auth = (id, roles = ['ROLE_USER']) => ({
  authUser: { tenantId, id: actor(id), roles, scope: 'read-only' },
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
// Only select real contextual read operations. Preserve every committed neighbor
// edge: recipients must come from the actual case turn, never a fixture graph.
const committedNeighbors = model.functions.map((fn) => structuredClone(fn.neighbors));
for (const fn of model.functions) {
  const entry = candidates.find((item) => fn.operations.includes(item.action));
  fn.operations = entry ? [entry.action] : [];
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
        gaps: (agent.gapLists || []).map((gap) => ({
          state: gap.state,
          recipients: gap.recipients,
        })),
        proposals: (agent.proposals || []).map((proposal) => ({
          recipients: proposal.recipients,
          outcome: proposal.outcome || 'pending',
        })),
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
          catalog: { ...catalog, operations: candidates },
        });
      if (schema.name === 'shared-service-agent')
        settings.signalCatalog = { ...catalog, operations: candidates };
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
      cetActorId: actor(person),
      roles: ['ROLE_USER'],
    });
  const started = await turn(
    'alice',
    'Starte bitte einen Fall: Netzanschlussanfrage für einen 2-MW-Batteriespeicher am Umspannwerk Nord prüfen.'
  );
  const caseId = started.metadata.cetCaseId;
  assert(caseId, 'explicit case_start creates a case');
  const classification = (
    await router.loadCase(
      require(path.join(root, 'src/domain-router-policy')).principal({ meta: auth('alice') }),
      caseId
    )
  ).lastClassification;
  if (classification.uncertain) {
    assert.match(started.choices[0].message.content, /Nummer oder dem Namen/);
    assert.equal(
      (await call('function-coverage.matrix', { tenantId, limit: 100 })).items.length,
      0
    );
    await turn('alice', '1');
  }
  const selected =
    (
      await router.loadCase(
        require(path.join(root, 'src/domain-router-policy')).principal({ meta: auth('alice') }),
        caseId
      )
    ).lastClassification.selectedCapabilities || [];
  assert(selected.length, 'real router supplies selected capabilities');
  const touchedFunction = model.functions.find((fn) =>
    fn.capabilities.includes(selected[0].capability)
  );
  assert(
    touchedFunction.domains.some((domain) => domain.startsWith('grid-connection')),
    'real formulation touches a grid connection function'
  );
  await snapshot('1 case_start');
  const matrix = await call('function-coverage.matrix', { tenantId, limit: 100 });
  assert(matrix.items.some((row) => row.actorId === actor('alice')));
  assert(!matrix.items.some((row) => row.actorId === 'svc-openwebui'));
  assert.equal(sequence, 1);
  assert.deepEqual(
    model.functions.map((fn) => fn.neighbors),
    committedNeighbors
  );
  await snapshot('2 creator coverage after one case turn');
  const rows = await call('activation.list', { tenantId });
  const activated = rows.filter((item) => item.responsibility.cet);
  const neighborIds = new Set(touchedFunction.neighbors.map((edge) => edge.functionId));
  assert(
    activated.every((item) => neighborIds.has(item.functionId)),
    'CET functions are actual direct neighbors'
  );
  assert(
    !activated.some((item) =>
      /leadership-delta-cockpit|communication-break-process-risk/.test(item.functionId)
    ),
    'unrelated functions are not activated'
  );
  const row = rows.find(
    (item) =>
      item.responsibility.cet &&
      item.reason.some((reason) => reason.context?.ref === caseId) &&
      model.functions.find((fn) => fn.functionId === item.functionId).operations.length
  );
  assert(row, 'complementary CET activation retains the actual case');
  const agents = broker.getLocalService('shared-service-agent');
  assert(
    matrix.items.every((item) => item.score < agents.settings.coverageThreshold),
    'single-turn creator receives the gap below the coverage threshold'
  );
  const agent = (await agents.readDocument(tenantId)).agents.find(
    (item) => item.functionId === row.functionId
  );
  assert(agent);
  await snapshot('3 activation and agent');
  const stored = (await agents.readDocument(tenantId)).agents.find(
    (item) => item.agentId === agent.agentId
  );
  const gap = stored.gapLists.find((item) => item.context.ref === caseId && item.state === 'open');
  assert(gap, 'one real case turn creates a contextual gap list');
  assert(
    gap.recipients.includes(actor('alice')),
    'case creator receives gaps without threshold coverage'
  );
  assert.equal(sequence, 1);
  await snapshot('4 creator gap after one case turn');
  const next = await turn('alice', 'Was gibt es Neues?');
  const text = next.choices[0].message.content;
  const notice = text.match(/L-\d+/)?.[0];
  if (!notice)
    console.log(
      'notice diagnostic',
      JSON.stringify({
        text,
        gap: stored.gapLists,
        queue: await call('notices.list', { tenantId, actorId: actor('alice') }, auth('alice')),
        matrix: matrix.items,
      })
    );
  assert(notice, 'next mapped turn displays the gap notice');
  assert(!/attention_|Push source unavailable/.test(text));
  await snapshot('5 next-turn notice');
  let proposal;
  for (let attempt = 0; attempt < 3 && !proposal; attempt++) {
    await turn(
      'alice',
      'Weiter mit diesem Fall: Netzanschlussanfrage für einen 2-MW-Batteriespeicher am Umspannwerk Nord prüfen.'
    );
    proposal = (await agents.readDocument(tenantId)).agents
      .flatMap((item) => item.proposals)
      .find((item) => item.recipients.includes(actor('alice')));
  }
  assert(proposal, 'real activating turns fund an internal proposal for the mapped creator');
  const pendingInbox = await broker
    .getLocalService('persona-inbox')
    .getTenantInboxMessages(tenantId);
  assert(
    pendingInbox.some(
      (item) => item.personaId === actor('alice') && item.hitlItemId === proposal.ref
    )
  );
  assert(proposalModelCalls > 0);

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
  await turn(
    'bob',
    'Starte bitte einen Fall: Netzanschlussanfrage für einen 2-MW-Batteriespeicher am Umspannwerk Nord prüfen.'
  );
  const twoPeople = await call('function-coverage.matrix', { tenantId, limit: 100 });
  assert(twoPeople.items.some((item) => item.actorId === actor('alice')));
  assert(twoPeople.items.some((item) => item.actorId === actor('bob')));
  const takeover = await turn('bob', `Ich übernehme ${fn.displayLabel}`);
  assert.equal(takeover.metadata.intentMode, 'correction');
  await turn('bob', 'Ja');
  const handoff = (await call('activation.list', { tenantId })).find(
    (item) => item.functionId === row.functionId
  );
  assert(handoff.responsibility.humans.includes(actor('bob')));
  assert.equal(handoff.responsibility.cet, false);
  await snapshot('8 second-person handoff');
  await turn('bob', `Nimm ${fn.displayLabel} ins Inventar auf`);
  const rejectedPin = await turn('bob', 'Ja');
  assert.match(
    rejectedPin.choices[0].message.content,
    /Das kann nur eine Administratorin bzw. ein Administrator festlegen/
  );
  const audit = await call('journal.byFunction', { tenantId, functionId: row.functionId });
  assert(audit.some((entry) => /Inventarkorrektur abgelehnt/.test(entry.summary)));
  const afterPin = (await call('activation.list', { tenantId })).find(
    (item) => item.functionId === row.functionId
  );
  assert.equal(afterPin.attention.inventory, false);
  await snapshot('9 non-admin pin denied');
  // Real uncertain Workbench turns, with neither a broker fixture nor graph edits.
  for (const [person, byName] of [
    ['alice', false],
    ['bob', true],
  ]) {
    const conversation = `uncertain-${person}`;
    const coverageService = broker.getLocalService('function-coverage');
    const coverageBefore = await call('function-coverage.byActor', {
      tenantId,
      actorId: actor(person),
    });
    const touchCount = touchEvents.length;
    const initial = await turn(
      person,
      'Starte einen Fall: Prüfe die Anschlusskapazität am Umspannwerk.',
      {
        openWebuiConversationId: conversation,
      }
    );
    const pendingCase = initial.metadata.cetCaseId;
    assert(pendingCase, 'case_start creates a case despite uncertain capability selection');
    const pending = (
      await router.loadCase(
        require(path.join(root, 'src/domain-router-policy')).principal({ meta: auth(person) }),
        pendingCase
      )
    ).lastClassification;
    assert.equal(pending.uncertain, true);
    assert.deepEqual(
      (await call('function-coverage.byActor', { tenantId, actorId: actor(person) })).items.map(
        ({ functionId, signalCount }) => ({ functionId, signalCount })
      ),
      coverageBefore.items.map(({ functionId, signalCount }) => ({ functionId, signalCount })),
      'uncertain real Workbench turn produces no coverage'
    );
    assert.equal(touchEvents.length, touchCount, 'uncertain turn emits no function touch');
    const choices = require(path.join(root, 'src/capability-clarification')).choiceCandidates(
      pending
    );
    const question = initial.choices[0].message.content;
    assert(choices.length > 0 && choices.length <= 5);
    for (const choice of choices) {
      assert(question.includes(choice.label));
      assert(!question.includes(choice.candidate.capability));
    }
    assert(!/uncertain_capability_selection|attention_transient/.test(question));
    const confirmed = await turn(person, byName ? choices[0].label : '1', {
      openWebuiConversationId: conversation,
    });
    assert.equal(confirmed.metadata.cetCaseId, pendingCase);
    await coverageService.queue;
    const resolved = (
      await router.loadCase(
        require(path.join(root, 'src/domain-router-policy')).principal({ meta: auth(person) }),
        pendingCase
      )
    ).lastClassification;
    assert.equal(resolved.uncertain, false);
    assert.equal(resolved.selectedCapabilities[0].capability, choices[0].candidate.capability);
    const confirmedCoverage = await call('function-coverage.byActor', {
      tenantId,
      actorId: actor(person),
    });
    assert(
      confirmedCoverage.items.some((record) => record.actorId === actor(person)),
      'confirmed touch belongs to mapped actor'
    );
    const contexts = (await broker.getLocalService('activation').readDocument(tenantId)).contexts;
    assert(
      contexts.some(
        (context) =>
          context.ref === pendingCase &&
          context.actors.some((item) => item.actorId === actor(person))
      ),
      'confirmed choice carries the actual case and contributor into activation'
    );
    const confirmedTouch = touchEvents
      .slice(touchCount)
      .find((event) => event.context?.ref === pendingCase);
    assert(confirmedTouch, 'choice emits a real activating function.touched.v1');
    assert.equal(confirmedTouch.actorId, actor(person));
    assert.equal(confirmedTouch.context.actorId, actor(person));
    assert(
      confirmedTouch.confidence >= broker.getLocalService('activation').settings.minTouchConfidence
    );
    await snapshot(
      byName ? '11 named capability clarification' : '10 numbered capability clarification'
    );
  }
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
