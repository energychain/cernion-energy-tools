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
let contentModelCalls = 0;
const contentStub = require(path.join(root, 'tests/helpers/workbench-llm-stub'));
const contentLatencies = [];
llm.generateStructured = async (schema, prompt) => {
  if (schema.properties?.turnKind) {
    contentModelCalls++;
    return contentStub.generateStructured(schema, prompt);
  }
  proposalModelCalls++;
  return { summary: 'Bitte prüfe die fehlenden Angaben zum aktuellen Fall.' };
};
for (const method of ['generateText', 'generateChat'])
  llm[method] = async (prompt) => {
    if (method === 'generateText' && typeof prompt === 'string' && prompt.includes('evidenceIds')) {
      contentModelCalls++;
      return contentStub.generateText(prompt);
    }
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
const { provisionToken } = require(path.join(root, 'scripts/provision-token'));
const { rolesFromToken } = require(path.join(root, 'src/auth/token-policy'));
let admin;
let gatewayToken;
let adminToken;
let baseUrl;
const assistanceRequests = [];
const people = new Map();
const auth = (id) => people.get(id) || admin;
async function http(route, token, body, headers = {}, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  return { status: response.status, result };
}
const model = structuredClone(require(path.join(root, 'function-model.json')));
const catalog = require(path.join(root, 'signal-catalog.json'));
const index = require(path.join(root, 'operation-capability-index.json'));
let observeExternalEffects = false;
const externalEffects = [];
const originalCall = broker.call.bind(broker);
broker.call = (...args) => {
  if (
    observeExternalEffects &&
    index.operations.some(
      (operation) => operation.action === args[0] && operation.operationKind === 'external_effect'
    )
  )
    externalEffects.push(args[0]);
  return originalCall(...args);
};
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
  const { status, result: response } = await http(
    '/v1/chat/completions',
    gatewayToken,
    {
      model: 'cernion-governance-assistant',
      messages: [{ role: 'user', content: message }],
    },
    {
      'X-OpenWebUI-User-Id': person,
      'X-OpenWebUI-Chat-Id': extra.openWebuiConversationId || `conversation-${person}`,
      'X-Request-Id': `turn-${++sequence}`,
    }
  );
  assert.equal(status, 200, JSON.stringify(response));
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
async function validateConversationMode(chat) {
  // #758: synthetic live conversation through the authenticated HTTP facade,
  // including failed understanding and persisted facts in the following turn.
  const conversationFixture = require(path.join(root, 'tests/fixtures/workbench-758.json'));
  const savedUnderstanding = llm.generateStructured;
  const savedAnswer = llm.generateText;
  let failAnswer = false;
  llm.generateStructured = async (schema, prompt) => {
    const input = JSON.parse(prompt);
    if (input.message === conversationFixture.liveTurns[1]) {
      failAnswer = true;
      throw Object.assign(new Error('Synthetic quota failure'), { status: 429 });
    }
    const value = await savedUnderstanding(schema, prompt);
    if (input.message === conversationFixture.liveTurns[2]) {
      assert(input.previous.personFacts.includes(conversationFixture.liveTurns[1]));
      value.quantities = [
        {
          key: 'quantity-1',
          value: '6',
          unit: 'kWh',
          dimension: 'energy',
          expectedDimension: 'power',
        },
      ];
    }
    if (input.message === conversationFixture.draftTurns[0]) value.followupKind = 'next_step';
    value.missingInformation = [
      {
        key: 'decisive-start',
        question: 'Wann wurde die Anlage in Betrieb genommen?',
        decisive: true,
        blocking: false,
      },
    ];
    return value;
  };
  llm.generateText = async (prompt, options) => {
    if (failAnswer) {
      failAnswer = false;
      throw new Error('Synthetic timeout');
    }
    return savedAnswer(prompt, options);
  };
  try {
    for (const [index, message] of conversationFixture.liveTurns.entries()) {
      const response = await http(
        '/v1/chat/completions',
        gatewayToken,
        {
          model: 'cernion-governance-assistant',
          messages: [{ role: 'user', content: message }],
        },
        { 'X-OpenWebUI-User-Id': 'alice', 'X-OpenWebUI-Chat-Id': 'conversation-758' }
      );
      assert.equal(response.status, 200);
      const reply = response.result.cernion.result;
      assert.equal(reply.situation.responseMode, 'conversation');
      assert(!reply.responseText.includes('Entwurf:'));
      assert(!/Als Nächstes:|\[Ergebnis/u.test(reply.responseText));
      if (index === 1) {
        assert.equal(response.result.metadata.degraded, true);
        assert(response.result.metadata.degradedReason);
        assert(reply.responseText.includes('Modell ist gerade nicht verfügbar'));
        assert(reply.situation.personFacts.includes(message));
      }
      if (index === 2) {
        assert(reply.responseText.includes('Leistung in kW'));
        assert(reply.situation.personFacts.includes(conversationFixture.liveTurns[1]));
      }
    }
    const correspondence = await chat('correspondence-758', [
      { role: 'user', content: conversationFixture.mail },
    ]);
    assert.equal(correspondence.situation.responseMode, 'correspondence');
    const step = await chat('correspondence-758', [
      { role: 'user', content: conversationFixture.draftTurns[0] },
    ]);
    assert(!step.draftId);
    const draft = await chat('correspondence-758', [
      { role: 'user', content: conversationFixture.draftTurns[1] },
    ]);
    assert(draft.draftId);
    assert(draft.responseText.includes('Entwurf:'));
  } finally {
    llm.generateStructured = savedUnderstanding;
    llm.generateText = savedAnswer;
  }
}

async function main() {
  for (const directory of ['services', 'custom-services']) {
    const dir = path.join(root, directory);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.service.js') && name !== 'mqtt-broker.service.js')) {
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
      if (schema.name === 'api') settings.port = 0;
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
      // Offline evidence response at the existing facade boundary. All routing,
      // mapping, case persistence and HTTP authentication remain real.
      const actions =
        schema.name === 'personal-agent'
          ? {
              ...schema.actions,
              collectWorkbenchEvidence: {
                ...schema.actions.collectWorkbenchEvidence,
                async handler(ctx) {
                  assistanceRequests.push(structuredClone({ params: ctx.params, meta: ctx.meta }));
                  return {
                    evidence: [
                      {
                        source: 'http-evidence-stub',
                        value: `${ctx.params.situation.concern}: Referenzen und Eingangsbestätigung prüfen.`,
                        metadata: { score: 0.92, documentTitle: 'Synthetischer Ablaufleitfaden' },
                      },
                    ],
                    trace: [],
                  };
                },
              },
              answerDossier: {
                ...schema.actions.answerDossier,
                async handler(ctx) {
                  assistanceRequests.push(structuredClone({ params: ctx.params, meta: ctx.meta }));
                  return {
                    answer:
                      'Prüfe Referenzen und Dokumentversion anhand der bereitgestellten Evidenz. Offene Angaben müssen vor einer verbindlichen Entscheidung geprüft werden.',
                  };
                },
              },
            }
          : schema.actions;
      broker.createService({ ...schema, actions, settings });
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
  const api = broker.getLocalService('api');
  for (const route of api.routes.filter((entry) => entry.opts.autoAliases))
    api.regenerateAutoAliases(route);
  baseUrl = `http://127.0.0.1:${broker.getLocalService('api').server.address().port}`;
  console.log(`Started ${broker.services.length} services including HTTP API on a free port.`);
  // Same provisioning functions and checks as npm run token:create; real stored hashes.
  process.env.CERNION_SUPPORT_TOKEN = 'isolated-e2e-bootstrap';
  process.env.CERNION_SUPPORT_TOKEN_INPUT = process.env.CERNION_SUPPORT_TOKEN;
  const create = (args) =>
    provisionToken({ tenant: tenantId, user: 'svc-openwebui', name: 'E2E', ...args }, broker);
  gatewayToken = (await create({ gateway: true, client: 'open-webui', org: 'org' })).data.token;
  adminToken = (await create({ user: 'admin', roles: 'ROLE_USER,ROLE_TENANT_ADMIN' })).data.token;
  const verified = await broker.call('token-manager.verify', { token: adminToken });
  admin = {
    authUser: {
      tenantId: verified.tenantId,
      userId: verified.userId,
      roles: rolesFromToken(verified),
    },
  };
  const router = broker.getLocalService('domain-router');
  router.knowledgeHints = async () => [];
  let saved = await http('/api/workbench/admin/tenant-mappings', adminToken, {
    client: 'open-webui',
    externalOrgId: 'org',
    cetTenantId: tenantId,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.result));
  for (const person of ['alice', 'bob']) {
    saved = await http('/api/workbench/admin/user-mappings', adminToken, {
      client: 'open-webui',
      externalOrgId: 'org',
      externalUserId: person,
      cetActorId: actor(person),
      roles: ['ROLE_USER'],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.result));
    // Diagnostic reads use the stored mapped identity. Turns themselves always use HTTP.
    people.set(
      person,
      broker
        .getLocalService('workbench')
        .metaForMapping(
          { meta: { apiToken: { type: 'gateway' } } },
          { tenantId },
          saved.result.mapping
        )
    );
  }
  const completion = {
    model: 'cernion-governance-assistant',
    messages: [{ role: 'user', content: 'Eine unklare Nachricht' }],
    metadata: { openWebuiOrgId: 'org', openWebuiUserId: 'missing', conversationId: 'negative' },
  };
  assert.equal((await http('/v1/chat/completions', gatewayToken, completion)).status, 403);
  for (const route of [
    '/api/workbench/admin/tenant-mappings',
    '/api/workbench/chat',
    '/api/domain-router/classify',
    '/api/notices/',
    '/api/chatgpt-sidecar/sessions',
    '/api/mcp',
    '/v1/models',
    '/api/tokens',
  ]) {
    assert.equal((await http(route, gatewayToken, {})).status, 403, route);
  }
  assert.equal(
    (
      await http('/v1/chat/completions', gatewayToken, {
        ...completion,
        model: 'cernion-agent-mvp',
      })
    ).status,
    403
  );
  const otherToken = (
    await create({ tenant: 'other-e2e', gateway: true, client: 'open-webui', org: 'org' })
  ).data.token;
  assert.equal(
    (
      await http('/v1/chat/completions', otherToken, {
        ...completion,
        metadata: { ...completion.metadata, openWebuiUserId: 'alice' },
      })
    ).status,
    403
  );
  const headers = { 'X-OpenWebUI-User-Id': 'alice', 'X-OpenWebUI-Chat-Id': 'header-chat' };
  const headerTurn = await http(
    '/v1/chat/completions',
    gatewayToken,
    {
      model: completion.model,
      messages: completion.messages,
    },
    headers
  );
  assert.equal(headerTurn.status, 200, JSON.stringify(headerTurn.result));
  // Admin token ignores header and metadata identities: no missing-user mapping lookup.
  const withoutGateway = await http('/v1/chat/completions', adminToken, completion, headers);
  assert.equal(withoutGateway.status, 200, JSON.stringify(withoutGateway.result));
  const models = await http('/v1/models', gatewayToken);
  assert.equal(models.status, 200);
  assert.deepEqual(
    models.result.data.map((entry) => entry.id),
    ['cernion-governance-assistant']
  );
  console.log('HTTP gateway negative cases and header-only setup PASS');
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
    assert(!/unverbindlich/i.test(started.choices[0].message.content));
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
    if (
      !initial.cernion.result.situation.hypotheses.some(
        (hypothesis) =>
          hypothesis.kind === 'domain' &&
          hypothesis.confidence >= 0.5 &&
          hypothesis.id === pending.primaryDomain
      )
    ) {
      assert(!initial.choices[0].message.content.includes('Optional passende Funktion'));
      assert(!/unverbindlich/i.test(initial.choices[0].message.content));
      await snapshot('10 unmatched uncertain candidates stay hidden');
      continue;
    }
    const choices = require(path.join(root, 'src/capability-clarification'))
      .choiceCandidates(pending)
      .slice(0, 3);
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
  assert.equal(
    (
      await http('/v1/chat/completions', gatewayToken, {
        model: 'cernion-governance-assistant',
        messages: [{ role: 'user', content: 'Eine unklare Nachricht' }],
        metadata: { conversationId: 'unmapped' },
      })
    ).status,
    403
  );
  const delegationAudits = (
    await broker.getLocalService('workbench').identityDb.allDocs({ include_docs: true })
  ).rows
    .map((entry) => entry.doc)
    .filter((doc) => doc.type === 'workbench_gateway_delegation');
  assert(delegationAudits.some((entry) => entry.cetActorId === actor('alice')));
  assert(delegationAudits.every((entry) => !entry.message && !entry.content));
  assert.equal(
    (await call('function-coverage.byActor', { tenantId, actorId: 'svc-openwebui' })).items.length,
    0
  );
  assert.equal(modelCalls, 0);
  // Conversation regression runs through the same real Open WebUI gateway.
  observeExternalEffects = true;
  const corpus = require(path.join(root, 'tests/fixtures/capability-routing-eval.json')).cases;
  const documents = [
    ...new Map(
      corpus
        .filter((row) => row.source === 'independent-regression')
        .map((row) => [row.primaryDomain, row])
    ).values(),
  ].slice(0, 4);
  const chat = async (conversationId, messages) => {
    const response = await http(
      '/v1/chat/completions',
      gatewayToken,
      {
        model: 'cernion-governance-assistant',
        messages,
      },
      { 'X-OpenWebUI-User-Id': 'alice', 'X-OpenWebUI-Chat-Id': conversationId }
    );
    assert.equal(response.status, 200, JSON.stringify(response.result));
    return response.result.cernion.result;
  };
  for (const [number, row] of documents.entries()) {
    const conversationId = `context-document-${number}`;
    const document = `Weitergeleitetes Dokument:\n${row.query}\nKannst du mir helfen?`;
    const initial = await chat(conversationId, [{ role: 'user', content: document }]);
    assert.equal(initial.nonBinding, true);
    assert(initial.cetCaseId);
    assert(!initial.responseText.includes('Starte einen Fall'));
    assert(initial.responseText.includes('Quellen:'));
    assert(initial.requiredClarifications.length <= 3);
    contentLatencies.push(initial.latencyMs);
    const started = initial;
    assert(started.cetCaseId);
    assert.notEqual(started.primaryDomain, 'unknown');
    const summary = await call('workbench.cases.get', { caseId: started.cetCaseId }, auth('alice'));
    assert.equal(
      summary.initialRequest,
      `${initial.situation.concern}\n${initial.situation.situation}`
    );
    const shipping = await chat(conversationId, [
      { role: 'user', content: 'Antwort per Mail senden' },
    ]);
    assert(shipping.responseText.includes('schick ihn bitte über euer System raus'));
    assert(shipping.draftId);
    const draft = await chat(conversationId, [{ role: 'user', content: 'Entwurf bitte' }]);
    const withDraft = await call(
      'workbench.cases.get',
      { caseId: started.cetCaseId },
      auth('alice')
    );
    assert(withDraft.internalDrafts.some((item) => item.draftId === draft.draftId));
    const question = await chat(conversationId, [
      { role: 'user', content: 'Warum ist das unklar?' },
    ]);
    assert.equal(question.nonBinding, true);
    assert(!/unverbindlich|keine externe Handlung/i.test(question.responseText));
  }
  const historyContent = documents[0].query;
  const recovered = await chat('history-only', [
    { role: 'system', content: 'Nicht als Fallinhalt verwenden' },
    { role: 'user', content: historyContent },
    { role: 'assistant', content: 'Möchtest du einen Fall starten?' },
    { role: 'user', content: 'Ja' },
  ]);
  assert(recovered.cetCaseId);
  assert.equal(
    (await call('workbench.cases.get', { caseId: recovered.cetCaseId }, auth('alice'))).situation
      .concern,
    historyContent
  );
  const anonymous =
    'Mail eines Lieferanten an einen Netzbetreiber: Überfällige Antwort auf Netzanmeldung, Marktlokation 99000000001, Frist überschritten. Kannst du mir helfen?';
  const productionCase = await chat('production-739', [{ role: 'user', content: anonymous }]);
  assert(productionCase.cetCaseId);
  assert(productionCase.responseText.includes('Fall F-'));
  assert(productionCase.situation.identifiers.some((entry) => entry.value === '99000000001'));
  contentLatencies.push(productionCase.latencyMs);
  const withdrawn = await chat('production-739', [{ role: 'user', content: 'Kein Fall' }]);
  assert.equal(withdrawn.state, 'case_discarded');
  await validateConversationMode(chat);
  const latencies = contentLatencies.slice().sort((a, b) => a - b);
  console.log(
    'Content turn latency (stub facade):',
    JSON.stringify({
      count: latencies.length,
      maxMs: Math.max(...latencies),
      medianMs: latencies[Math.floor(latencies.length / 2)],
      contentModelCalls,
    })
  );
  assert(Math.max(...latencies) < 15000);
  assert.equal(externalEffects.length, 0, externalEffects.join(', '));
  assert(assistanceRequests.length > 0);
  assert(assistanceRequests.every((entry) => entry.meta.apiToken.id !== 'svc-openwebui'));
  console.log(
    'HTTP conversation context, multi-domain assistance, history fallback and internal drafts PASS'
  );
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
