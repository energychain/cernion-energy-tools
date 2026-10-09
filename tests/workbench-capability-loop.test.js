'use strict';

jest.mock('../src/llm-client', () => ({
  generateChat: jest.fn(),
  generateStructured: jest.fn(),
  generateText: jest.fn(),
}));
const llm = require('../src/llm-client');
const {
  runCapabilityLoop,
  safeRead,
  summarizeResult,
  candidatesFor,
  resolveCapabilityNeed,
  loopDiagnostics,
} = require('../src/workbench-capability-loop');
const { answer, understand } = require('../src/workbench-understanding');
const index = require('../operation-capability-index.json');
const api = require('../openapi-export.json');
const model = require('../function-model.json');
const operation = index.operations.find((op) => op.action === 'energy-market.installations');
const fn = model.functions.find((entry) => entry.operations.includes(operation.action));
const meta = {
  tenantId: 'synthetic',
  authUser: {
    tenantId: 'synthetic',
    userId: 'person',
    roles: ['ROLE_GRID_OPERATOR'],
    scope: 'read-only',
    sensitivityFlags: [],
  },
};
const situation = {
  concern: 'MaStR installations installed capacity',
  situation: 'Compare installations.',
  participants: [],
  identifiers: [],
  deadlines: [],
  hypotheses: [{ kind: 'function', id: fn.functionId, confidence: 1 }],
  missingInformation: [],
  requestedAction: { description: 'Auswerten', externalEffect: false, draftRequested: false },
  turnKind: 'knowledge',
  retrievalTerms: [],
  dataNeeds: 'MaStR installations storage solar',
  outputKind: 'analysis',
};
const call = (input, projection) => ({
  name: 'read_0',
  args: { input, ...(projection ? { projection } : {}) },
});
const claim = (text, evidenceIds = []) => ({
  text,
  origin: evidenceIds.length ? 'evidence' : 'input',
  supported: evidenceIds.length ? 'evidence' : 'model',
  completedAction: false,
  specific: false,
  evidenceIds,
});
let ctx;
const saved = { ...process.env };
beforeEach(() => {
  ctx = {
    broker: {
      getLocalService: () => ({
        schema: { actions: { installations: { requiredRoles: ['ROLE_GRID_OPERATOR'] } } },
      }),
    },
    call: jest.fn(async () => ({
      success: true,
      data: { results: [{ municipality: 'Synthetic A', capacityKW: 300 }] },
    })),
  };
  llm.generateChat.mockResolvedValue({ toolCalls: [] });
});
afterEach(() => {
  jest.resetAllMocks();
  process.env = { ...saved };
});
const run = (extra = {}) =>
  runCapabilityLoop(ctx, { situation, meta, model, index, api, ...extra });

test('AC-01 executes catalogued read with delegated identity and evidence provenance', async () => {
  llm.generateChat.mockResolvedValueOnce({
    toolCalls: [call({ installationType: 'solar', gridOperatorName: 'Synthetic Operator' })],
  });
  const result = await run();
  expect(ctx.call).toHaveBeenCalledWith(
    operation.action,
    { installationType: 'solar', gridOperatorName: 'Synthetic Operator' },
    expect.objectContaining({ meta })
  );
  expect(result.trace[0]).toMatchObject({
    name: operation.action,
    status: 'available',
    hitCount: 1,
    called: true,
  });
  expect(result.evidence[0].metadata).toMatchObject({
    parameters: { installationType: 'solar', gridOperatorName: 'Synthetic Operator' },
    at: expect.any(String),
  });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Synthetic A hat 300 kW.', ['E1'])],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  const response = await answer({
    situation,
    retrieval: { evidence: result.evidence, toolTrace: result.trace },
  });
  expect(response.responseText).toContain('Synthetic A');
  expect(response.responseText).toContain('Nachgesehen: energy-market.installations');
  expect(response.responseText).toContain('kein bestätigter Datenstand');
  expect(response.responseText).not.toContain('kein Zugriff');
});

test.each([
  'draft_write',
  'controlled_write',
  'process_execute',
  'admin',
  'secret',
  'advisory_plan',
])('AC-02 rejects %s operation class even with GET', (kind) => {
  expect(safeRead({ ...operation, method: 'GET', operationKind: kind })).toBe(false);
});
test.each(['/api/tokens', '/api/auth/verify', '/api/backup', '/api/system/admin/list'])(
  'AC-02 rejects secret/admin surface %s',
  (path) => {
    expect(safeRead({ ...operation, method: 'GET', path })).toBe(false);
  }
);
test.each([
  { installationType: 'invalid' },
  { installationType: 'solar', postleitzahl: '123' },
  { installationType: 'solar', tenantId: 'other' },
  { installationType: 'solar', context: { tenantId: 'other' } },
  { installationType: 'solar', token: 'synthetic-secret' },
])('AC-02/03 invalid schema or identity parameters never reach backend: %j', async (input) => {
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call(input)] });
  const result = await run();
  expect(ctx.call).not.toHaveBeenCalled();
  expect(result.trace[0].status).toBe('blocked');
});
test('AC-02 a role claim never grants backend roles; tenant policy filters candidates', async () => {
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  const result = await run({
    meta: { ...meta, authUser: { ...meta.authUser, roles: ['ROLE_EDM'] } },
    situation: {
      ...situation,
      actorContext: {
        role: 'ROLE_GRID_OPERATOR',
        organization: 'Synthetic',
        basis: 'I am operator',
      },
    },
  });
  expect(ctx.call).not.toHaveBeenCalled();
  expect(result.trace[0].status).toBe('blocked');
  const denied = await run({ mapping: { domainsAllowed: ['unrelated-synthetic-domain'] } });
  expect(denied.trace[0].status).toBe('missing');
});
test('AC-02 undeclared function names, unknown side effects, writes and foreign-tenant results fail closed', async () => {
  expect(safeRead({ ...operation, sideEffects: ['external_business_effect'] })).toBe(false);
  expect(safeRead({ ...operation, writesTo: ['synthetic-state'] })).toBe(false);
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [{ name: 'write', args: {} }] });
  expect((await run()).trace[0].status).toBe('blocked');
  expect(ctx.call).not.toHaveBeenCalled();
  ctx.call.mockResolvedValue({ tenantId: 'other', data: { results: [] } });
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  expect((await run()).evidence).toEqual([]);
});
test('AC-03 maximum calls and total elapsed budget apply even to nonsettling reads', async () => {
  process.env.WORKBENCH_MAX_TOOL_CALLS = '2';
  llm.generateChat.mockResolvedValue({
    toolCalls: Array(5).fill(call({ installationType: 'solar' })),
  });
  const result = await run();
  expect(ctx.call).toHaveBeenCalledTimes(2);
  expect(result.trace.at(-1).status).toBe('limited');
  ctx.call.mockClear().mockImplementation(() => new Promise(() => {}));
  const start = performance.now();
  const timeout = await run({ deadline: start + 30 });
  expect(performance.now() - start).toBeLessThan(200);
  expect(timeout.trace.some((entry) => entry.status === 'timeout')).toBe(true);
});
test('AC-03 tool failure is concrete and does not skip the independent answer', async () => {
  ctx.call.mockRejectedValue(new Error('Synthetic backend unavailable'));
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  const result = await run();
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Die Auswertung bleibt offen; prüfe den Datenabruf später.')],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  const response = await answer({
    situation,
    retrieval: { evidence: [], toolTrace: result.trace },
  });
  expect(llm.generateText).toHaveBeenCalled();
  expect(response.answerStatus).not.toBe('fallback');
  expect(response.responseText).toContain(
    'energy-market.installations: Synthetic backend unavailable'
  );
  expect(response.draft).toBe('');
});
test('no data need means no planner or backend call, including follow-up', async () => {
  expect(
    await run({ situation: { ...situation, dataNeeds: '', followupKind: 'next_step' } })
  ).toMatchObject({ trace: [{ status: 'skipped', reason: 'no_data_need' }], evidence: [], ms: 0 });
  expect(llm.generateChat).not.toHaveBeenCalled();
  expect(ctx.call).not.toHaveBeenCalled();
});
test('AC-03 secrets are removed and large results aggregate locally before bounded evidence', async () => {
  ctx.call.mockResolvedValue({
    success: true,
    data: {
      results: Array.from({ length: 1000 }, () => ({
        group: 'Synthetic',
        capacityKW: 2,
        password: 'synthetic-secret',
      })),
    },
  });
  llm.generateChat.mockResolvedValueOnce({
    toolCalls: [
      call(
        { installationType: 'solar' },
        {
          operations: [
            {
              op: 'aggregate',
              groupBy: ['group'],
              metrics: [{ fn: 'sum', field: 'capacityKW', as: 'totalKW' }],
            },
          ],
        }
      ),
    ],
  });
  const result = await run();
  expect(result.evidence[0].value).toContain('2000');
  expect(result.evidence[0].value).not.toContain('synthetic-secret');
  expect(result.evidence[0].value.length).toBeLessThan(6000);
});
test('AC-04 synthetic site ranking excludes every municipality with storage >100kW and retains available voltage evidence', async () => {
  const storage = [
    { municipality: 'Synthetic A', capacityKW: 101 },
    { municipality: 'Synthetic B', capacityKW: 100 },
  ];
  const generation = [
    { municipality: 'Synthetic A', capacityKW: 1000, voltage: 'LV' },
    { municipality: 'Synthetic B', capacityKW: 300, voltage: 'LV' },
    { municipality: 'Synthetic C', capacityKW: 600, voltage: 'unknown' },
  ];
  ctx.call
    .mockResolvedValueOnce({ success: true, data: { results: storage } })
    .mockResolvedValueOnce({ success: true, data: { results: generation } });
  llm.generateChat
    .mockResolvedValueOnce({
      toolCalls: [
        call(
          { installationType: 'storage', minCapacityKW: 100 },
          { operations: [{ op: 'filter', field: 'capacityKW', operator: 'gt', value: 100 }] }
        ),
      ],
    })
    .mockResolvedValueOnce({
      toolCalls: [
        call(
          { installationType: 'solar' },
          {
            excludeObservation: 0,
            excludeField: 'municipality',
            operations: [
              {
                op: 'aggregate',
                groupBy: ['municipality', 'voltage'],
                metrics: [{ fn: 'sum', field: 'capacityKW', as: 'totalKW' }],
              },
              { op: 'sort', by: [{ field: 'totalKW', direction: 'desc' }] },
            ],
          }
        ),
      ],
    });
  const result = await run();
  const ranking = JSON.parse(result.evidence[1].value);
  expect(ranking.map((row) => row.municipality)).toEqual(['Synthetic C', 'Synthetic B']);
  expect(ranking[1]).toMatchObject({ totalKW: 300, voltage: 'LV' });
  expect(result.trace.filter((entry) => entry.called)).toHaveLength(2);
});
test('AC-05 role update is grounded, removes analysis draft, and reaches answer prompt', async () => {
  const message = 'Ich bin beim Netzbetreiber Synthetic Utility und möchte nur eine Analyse.';
  llm.generateStructured.mockResolvedValue({
    ...situation,
    actorContext: { role: 'Netzbetreiber', organization: 'Synthetic Utility', basis: message },
    requestedAction: { ...situation.requestedAction, draftRequested: true },
  });
  const updated = await understand({ message, tenantId: 'synthetic', model });
  expect(updated.requestedAction.draftRequested).toBe(false);
  expect(updated.actorContext.organization).toBe('Synthetic Utility');
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Nutze die Daten intern.')],
      expectation: [],
      nextSteps: [],
      draft: [claim('Guten Tag, bitte prüfen Sie das Anliegen.')],
    })
  );
  const response = await answer({
    situation: updated,
    retrieval: { evidence: [] },
    previousDraft: 'Old draft',
  });
  expect(response.draft).toBe('');
  expect(response.responseText).not.toContain('Entwurf:');
  expect(JSON.parse(llm.generateText.mock.calls[0][0]).situation.actorContext.organization).toBe(
    'Synthetic Utility'
  );
});
test('exclusions are not limited to displayed rows', () => {
  const previous = summarizeResult(
    { rows: Array.from({ length: 40 }, (_, i) => ({ group: `Synthetic ${i}` })) },
    {},
    'synthetic',
    []
  );
  const result = summarizeResult(
    { rows: [{ group: 'Synthetic 39' }, { group: 'Allowed' }] },
    { excludeObservation: 0, excludeField: 'group' },
    'synthetic',
    [previous]
  );
  expect(result.data).toEqual([{ group: 'Allowed' }]);
});
test('existing domain hypothesis routes to read operations without a case', () => {
  expect(
    candidatesFor(
      { ...situation, hypotheses: [{ kind: 'domain', id: 'market-data', confidence: 1 }] },
      { model, index, api }
    ).map((entry) => entry.operation.action)
  ).toContain(operation.action);
});

test('full Workbench answer path executes reads and follow-up without new data executes none', async () => {
  const { createCaseBroker } = require('./helpers/case-linking-broker');
  const environment = await createCaseBroker();
  const brokerCalls = jest.spyOn(environment.broker, 'call');
  const reads = jest.fn(async () => ({
    success: true,
    data: { results: [{ municipality: 'Synthetic A', capacityKW: 300 }] },
  }));
  environment.broker.createService({
    name: 'energy-market',
    actions: { installations: { requiredRoles: ['ROLE_GRID_OPERATOR'], handler: reads } },
  });
  llm.generateStructured
    .mockResolvedValueOnce(situation)
    .mockResolvedValueOnce({ ...situation, dataNeeds: '', followupKind: 'question' });
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Die Auswertung zeigt Synthetic A.', ['E1'])],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  await environment.broker.start();
  try {
    const input = {
      channel: 'open-webui',
      conversationId: 'synthetic-tools',
      message: 'Compare MaStR installations.',
    };
    const first = await environment.call('workbench.chat', input, meta);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(first.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available', hitCount: 1 }),
      ])
    );
    expect(first.phaseTimes.toolsMs).toBeGreaterThanOrEqual(0);
    const plannerCalls = llm.generateChat.mock.calls.length;
    const retrievalCalls = brokerCalls.mock.calls.filter(
      ([name]) => name === 'personal-agent.collectWorkbenchEvidence'
    ).length;
    const followup = await environment.call(
      'workbench.chat',
      { ...input, message: 'Wie interpretiere ich das?' },
      meta
    );
    expect(followup.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available', ms: 0 }),
      ])
    );
    expect(followup.phaseTimes.toolsMs).toBe(0);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(llm.generateChat).toHaveBeenCalledTimes(plannerCalls);
    expect(
      brokerCalls.mock.calls.filter(([name]) => name === 'personal-agent.collectWorkbenchEvidence')
        .length
    ).toBeGreaterThan(retrievalCalls);
  } finally {
    await environment.cleanup();
  }
});

test('combined case continuation, delegated read, document upload and passage followup keep one case and one hint', async () => {
  const { createCaseBroker } = require('./helpers/case-linking-broker');
  const { loadDocuments } = require('../src/workbench-document');
  const environment = await createCaseBroker();
  const identifiers = [{ kind: 'processReference', value: 'ANON-COMBINED-764-755' }];
  const reads = jest.fn(async () => ({
    success: true,
    data: { results: [{ municipality: 'Synthetic A', capacityKW: 300 }] },
  }));
  environment.broker.createService({
    name: 'energy-market',
    actions: { installations: { requiredRoles: ['ROLE_GRID_OPERATOR'], handler: reads } },
  });
  llm.generateStructured.mockResolvedValue({ ...situation, turnKind: 'work', identifiers });
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Die Auswertung zeigt Synthetic A.', ['E1'])],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  await environment.broker.start();
  try {
    const existing = await environment.create(identifiers, {
      apiToken: { id: 'synthetic-author', tenantId: 'synthetic', roles: ['ROLE_GRID_OPERATOR'] },
    });
    const input = { channel: 'open-webui', conversationId: 'combined-tools-document' };
    const first = await environment.call(
      'workbench.chat',
      {
        ...input,
        message: 'Compare installations for ANON-COMBINED-764-755.',
      },
      meta
    );
    expect(first.cetCaseId).toBe(existing.cetCaseId);
    expect(first.responseText).toContain('angelegt von synthetic-author');
    expect(reads).toHaveBeenCalledTimes(1);
    expect(first.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available' }),
      ])
    );
    const document = 'Seite 12\nSynthetischer Prüfstand: Ausgangszahl 42.\n';
    const callsBeforeDocument = llm.generateChat.mock.calls.length;
    const uploaded = await environment.call(
      'workbench.chat',
      {
        ...input,
        message: `<context><source name="Synthetic.txt">${document}</source></context><user_query>Dokument aufnehmen.</user_query>`,
      },
      meta
    );
    expect(uploaded.cetCaseId).toBe(existing.cetCaseId);
    expect(uploaded.responseText).not.toContain('angelegt von');
    const documents = await loadDocuments(environment.workbench.store, {
      tenantId: 'synthetic',
      caseId: existing.cetCaseId,
    });
    expect(documents[0].text).toBe(document);
    const callsBeforePassage = llm.generateStructured.mock.calls.length;
    const answersBeforePassage = llm.generateText.mock.calls.length;
    const page = await environment.call('workbench.chat', { ...input, message: 'Seite 12?' }, meta);
    expect(page.cetCaseId).toBe(existing.cetCaseId);
    expect(page.responseText).toContain('Ausgangszahl 42');
    expect(page.responseText).not.toContain('angelegt von');
    expect(llm.generateStructured).toHaveBeenCalledTimes(callsBeforePassage);
    expect(llm.generateText).toHaveBeenCalledTimes(answersBeforePassage);
    expect(llm.generateChat).toHaveBeenCalledTimes(callsBeforeDocument);
    expect(reads).toHaveBeenCalledTimes(1);
  } finally {
    await environment.cleanup();
  }
});

test('HTTP-e2e: gateway transport delegates tool calls to mapped person and refuses unmapped user', async () => {
  const { createCaseBroker } = require('./helpers/case-linking-broker');
  const Api = require('../services/api.service');
  const OpenAICompatible = require('../services/openai-compatible.service');
  const environment = await createCaseBroker();
  const observed = [];
  environment.broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
  environment.broker.createService(OpenAICompatible);
  environment.broker.createService({
    name: 'token-manager',
    actions: {
      verify: () => ({
        valid: true,
        type: 'gateway',
        tokenId: 'synthetic-transport',
        client: 'open-webui',
        externalOrgId: 'synthetic-org',
        tenantId: 'synthetic',
        scope: 'full-access',
        roles: ['ROLE_ADMIN', 'full-access'],
      }),
    },
  });
  environment.broker.createService({
    name: 'energy-market',
    actions: {
      installations: {
        requiredRoles: ['ROLE_GRID_OPERATOR'],
        handler: (context) => {
          observed.push(context.meta);
          return {
            success: true,
            data: { results: [{ municipality: 'Synthetic A', capacityKW: 300 }] },
          };
        },
      },
    },
  });
  await environment.workbench.store.saveTenantMapping({
    client: 'open-webui',
    externalOrgId: 'synthetic-org',
    cetTenantId: 'synthetic',
  });
  await environment.workbench.store.saveUserMapping({
    client: 'open-webui',
    externalOrgId: 'synthetic-org',
    externalUserId: 'external-person',
    cetTenantId: 'synthetic',
    cetActorId: 'person',
    roles: ['ROLE_GRID_OPERATOR'],
  });
  llm.generateStructured.mockResolvedValue(situation);
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Synthetic A ist im Ergebnis enthalten.', ['E1'])],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  await environment.broker.start();
  try {
    const base = `http://127.0.0.1:${environment.broker.getLocalService('api').server.address().port}`;
    const request = (user) =>
      fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ck_synthetic',
          'Content-Type': 'application/json',
          'X-OpenWebUI-User-Id': user,
          'X-OpenWebUI-Chat-Id': 'synthetic-http-tools',
        },
        body: JSON.stringify({
          model: 'cernion-governance-assistant',
          messages: [{ role: 'user', content: 'Compare MaStR installations.' }],
        }),
      });
    const response = await request('external-person');
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.metadata.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available' }),
      ])
    );
    expect(observed).toHaveLength(1);
    expect(observed[0].authUser).toMatchObject({
      userId: 'person',
      roles: ['ROLE_GRID_OPERATOR'],
      scope: 'read-only',
      tenantId: 'synthetic',
    });
    expect(observed[0].apiToken.type).toBe('delegated-person');
    expect(JSON.stringify(observed)).not.toContain('ROLE_ADMIN');
    expect((await request('unmapped-person')).status).toBe(403);
    expect(observed).toHaveLength(1);
  } finally {
    await environment.cleanup();
  }
});

test('role update suppresses a stale proactive draft even when work item remains correspondence', async () => {
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Nutze den internen Datenstand.')],
      expectation: [],
      nextSteps: [],
      draft: [claim('Guten Tag, bitte prüfen Sie das Anliegen.')],
    })
  );
  const result = await answer({
    situation: {
      ...situation,
      outputKind: 'correspondence',
      actorContext: {
        role: 'Interne Rolle',
        organization: 'Synthetic Utility',
        basis: 'Ich arbeite dort.',
      },
    },
    retrieval: { evidence: [] },
    suppressDraft: true,
    previousDraft: 'Old draft',
  });
  expect(result.draft).toBe('');
  expect(result.responseText).not.toContain('Entwurf:');
});

test('object tool schema retains complete local OpenAPI validation and accepts JSON input', async () => {
  llm.generateChat.mockResolvedValueOnce({
    toolCalls: [
      call(JSON.stringify({ installationType: 'solar' }), JSON.stringify({ operations: [] })),
    ],
  });
  const result = await run();
  expect(result.trace[0].status).toBe('available');
  expect(llm.generateChat.mock.calls[0][1].tools[0].function.parameters.properties.input.type).toBe(
    'object'
  );
  expect(ctx.call.mock.calls[0][1]).toEqual({ installationType: 'solar' });
});

test('cached tool evidence is reauthorized after a role or tenant change', async () => {
  const { validateCachedReads } = require('../src/workbench-capability-loop');
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  const { evidence } = await run();
  expect(validateCachedReads(ctx, evidence, { meta, model, index }).hits).toHaveLength(1);
  const revoked = { ...meta, authUser: { ...meta.authUser, roles: [] } };
  expect(validateCachedReads(ctx, evidence, { meta: revoked, model, index }).hits).toEqual([]);
  const other = { tenantId: 'other', authUser: { ...meta.authUser, tenantId: 'other' } };
  expect(validateCachedReads(ctx, evidence, { meta: other, model, index }).hits).toEqual([]);
  expect(
    validateCachedReads(ctx, evidence, { meta, model, index, domainsAllowed: ['unrelated'] }).hits
  ).toEqual([]);
  expect(ctx.call).toHaveBeenCalledTimes(1);
});

test('local plans validate derived fields and refuse absent sort or exclusion fields', () => {
  const rows = [
    { group: 'Synthetic A', value: 5 },
    { group: 'Synthetic A', value: 7 },
  ];
  const summary = summarizeResult(
    rows,
    {
      operations: [
        {
          op: 'aggregate',
          groupBy: ['group'],
          metrics: [{ fn: 'sum', field: 'value', as: 'total' }],
        },
        { op: 'filter', field: 'total', operator: 'gt', value: 10 },
        { op: 'sort', by: [{ field: 'total', direction: 'desc' }] },
      ],
    },
    'synthetic',
    []
  );
  expect(summary.data).toEqual([{ group: 'Synthetic A', total: 12 }]);
  expect(() =>
    summarizeResult(
      rows,
      { operations: [{ op: 'sort', by: [{ field: 'unknown' }] }] },
      'synthetic',
      []
    )
  ).toThrow('Auswertungsfeld');
  expect(() =>
    summarizeResult(rows, { excludeObservation: 0, excludeField: 'unknown' }, 'synthetic', [
      { allRows: rows },
    ])
  ).toThrow('Ausschlussfeld');
});

test('catalog ranking retains an explicit read when the situation hypothesis is imprecise', async () => {
  const explicit = {
    ...situation,
    dataNeeds: operation.action,
    hypotheses: [{ kind: 'domain', id: 'grid-operations', confidence: 0.9 }],
  };
  const candidates = candidatesFor(explicit, { model, index, api });
  expect(candidates.map((entry) => entry.operation.action)).toContain(operation.action);
  expect(candidatesFor(explicit, { model, index, api, domainsAllowed: ['unrelated'] })).toEqual([]);
});

test('canonical tool results are rendered even when the model only describes the task', async () => {
  ctx.call.mockResolvedValue({
    success: true,
    data: { results: [{ reference: 'synthetic-01001', value: 7 }] },
  });
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  const result = await run();
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Die Auswertung wurde angefragt.')],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  const response = await answer({
    situation,
    retrieval: { evidence: result.evidence, toolTrace: result.trace },
  });
  expect(response.responseText).toContain('Ergebnis:');
  expect(response.responseText).toContain('synthetic-01001');
  expect(response.responseText).toContain('"value":7');
  expect(response.responseText).toContain('Parameter {"installationType":"solar"}');
  expect(response.responseText).not.toContain('MASKED');
});

test.each([
  ['Bytebudget', () => ({ results: [{ value: 'x'.repeat(2000001) }] })],
  ['Zeilenbudget', () => ({ results: Array.from({ length: 50001 }, () => ({ value: 1 })) })],
])('oversized backend result fails honestly at the %s boundary', async (reason, fixture) => {
  ctx.call.mockResolvedValue({ success: true, data: fixture() });
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  const result = await run();
  expect(result.evidence).toEqual([]);
  expect(result.trace[0]).toMatchObject({ called: true, status: 'unavailable', hitCount: 0 });
  expect(result.trace[0].error).toContain(reason);
});

test('display result cap is enforced and its provenance declares truncation', async () => {
  process.env.WORKBENCH_TOOL_RESULT_CHARS = '60';
  ctx.call.mockResolvedValue({ success: true, data: { results: [{ value: 'x'.repeat(1000) }] } });
  llm.generateChat.mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] });
  const result = await run();
  expect(result.evidence[0].value.length).toBeLessThanOrEqual(60);
  expect(JSON.parse(result.evidence[0].value)).toMatchObject({ truncated: true });
  const planner = JSON.parse(llm.generateChat.mock.calls[1][0].at(-1).content);
  expect(JSON.parse(planner.result)).toMatchObject({ truncated: true });
  expect(result.evidence[0].metadata.truncated).toBe(true);
  expect(result.trace[0]).toMatchObject({ status: 'available', truncated: true });
});

test('a later read can bind a protected reference discovered in an earlier tool result', async () => {
  const discovered = 'synthetic-9900000000001';
  ctx.call.mockResolvedValue({ success: true, data: { results: [{ reference: discovered }] } });
  llm.generateChat
    .mockResolvedValueOnce({ toolCalls: [call({ installationType: 'solar' })] })
    .mockImplementationOnce(async (messages) => {
      const observation = JSON.parse(messages.at(-1).content);
      expect(observation.result).not.toContain(discovered);
      const reference = JSON.parse(observation.result)[0].reference;
      expect(reference).toMatch(/^\[TOOL-REF-/);
      return { toolCalls: [call({ installationType: 'storage', gridOperatorName: reference })] };
    });
  const result = await run({ message: 'Initial reference synthetic-00001' });
  expect(ctx.call.mock.calls[1][1].gridOperatorName).toBe(discovered);
  expect(result.evidence[0].value).toContain(discovered);
  expect(result.trace.filter((entry) => entry.status === 'available')).toHaveLength(2);
});

const registryQuestion =
  'Wie viele Solaranlagen über 100 kW sind laut Marktstammdatenregister in Uslar in Betrieb?';
const refinementQuestion = 'Und welche davon ist die größte?';

test.each([registryQuestion, refinementQuestion])(
  'empty understanding dataNeeds recovers data question: %s',
  async (message) => {
    const empty = { ...situation, concern: registryQuestion, dataNeeds: '', hypotheses: [] };
    const need = resolveCapabilityNeed(empty, message, { model, index, api, previous: empty });
    expect(need.reason).toBe('capability_match');
    expect(need.candidates.map((entry) => entry.operation.action)).toContain(operation.action);
    llm.generateChat.mockResolvedValueOnce({
      toolCalls: [call({ installationType: 'solar', minCapacityKW: 100, location: 'Uslar' })],
    });
    const result = await run({ situation: empty, message, previous: empty });
    expect(ctx.call).toHaveBeenCalledTimes(1);
    expect(result.trace[0].status).toBe('available');
    // One planner request plus the ordinary observe/stop request; trigger uses no model.
    expect(llm.generateChat).toHaveBeenCalledTimes(2);
  }
);

test.each([
  'Was ist das Marktstammdatenregister?',
  'Wie funktioniert die Registrierung von Solaranlagen?',
  'Was bedeutet der Wert einer Solaranlage?',
  'Welche Vorteile haben Solaranlagen?',
  'Welche Unterschiede gibt es zwischen Solaranlagen?',
  'Warum gibt es Solaranlagen?',
  'Hallo',
  'Wie interpretiere ich das?',
])('knowledge question never triggers from a stale matching concern: %s', (message) => {
  const need = resolveCapabilityNeed(
    { ...situation, concern: registryQuestion, dataNeeds: '' },
    message,
    { model, index, api }
  );
  expect(need.reason).toBe('no_data_need');
  expect(need.situation.dataNeeds).toBe('');
  expect(llm.generateChat).not.toHaveBeenCalled();
});

test('fallback respects configurable threshold, read policy and domain restrictions', () => {
  const empty = { ...situation, concern: registryQuestion, dataNeeds: '' };
  process.env.WORKBENCH_TOOL_TRIGGER_MIN_SCORE = '10000';
  expect(resolveCapabilityNeed(empty, registryQuestion, { model, index, api }).reason).toBe(
    'no_candidates'
  );
  process.env.WORKBENCH_TOOL_TRIGGER_MIN_SCORE = '14';
  expect(
    resolveCapabilityNeed(empty, registryQuestion, {
      model,
      index,
      api,
      domainsAllowed: ['synthetic-other'],
    }).reason
  ).toBe('no_candidates');
  expect(
    resolveCapabilityNeed(empty, registryQuestion, {
      model,
      index: { operations: [{ ...operation, operationKind: 'admin' }] },
      api,
    }).reason
  ).toBe('no_candidates');
});

test.each([
  ['available', 'capability_match'],
  ['blocked', 'blocked'],
  ['unavailable', 'error'],
  ['timeout', 'budget'],
  ['limited', 'budget'],
])('PII-free loop diagnostics for %s', (status, reason) => {
  const result = {
    trace: [
      {
        status,
        called: status === 'available',
        name: operation.action,
        parameters: { location: 'PRIVATE' },
        error: 'PRIVATE',
      },
    ],
    ms: 7,
  };
  expect(loopDiagnostics(result, 1, 'capability_match')).toEqual({
    status: 'started',
    reason,
    candidateCount: 1,
    operations: status === 'available' ? [operation.action] : [],
    ms: 7,
  });
  expect(JSON.stringify(loopDiagnostics(result, 1, 'capability_match'))).not.toContain('PRIVATE');
});

test.each(['available', 'unavailable'])(
  'manual register instructions are removed when a matching tool is %s',
  async (status) => {
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        interpretation: [claim('Die Auswertung ist noch nicht vollständig.')],
        expectation: [],
        nextSteps: [claim('Öffne das Register und filtere selbst nach der Leistung.')],
        draft: [],
      })
    );
    const response = await answer({
      situation,
      retrieval: {
        evidence: [],
        toolTrace: [
          {
            source: 'capability-read',
            name: operation.action,
            status,
            called: status === 'available',
            error: status === 'unavailable' ? 'Zeitbudget erschöpft' : undefined,
          },
        ],
      },
    });
    expect(response.responseText).not.toContain('filtere selbst');
    expect(response.responseText).toContain('Die Auswertung ist noch nicht vollständig');
    if (status === 'unavailable')
      expect(response.responseText).toContain(
        'Ich konnte die Datenabfrage gerade nicht ausführen: Zeitbudget erschöpft'
      );
  }
);

test('fallback turns log exactly once and follow-up planner reuses authorized proven filters', async () => {
  const { createCaseBroker } = require('./helpers/case-linking-broker');
  const environment = await createCaseBroker();
  const logs = jest.spyOn(environment.workbench.logger, 'info');
  const reads = jest.fn(async () => ({
    success: true,
    data: {
      results: [
        { name: 'Synthetic Small', capacityKW: 150 },
        { name: 'Synthetic Large', capacityKW: 300 },
      ],
    },
  }));
  environment.broker.createService({
    name: 'energy-market',
    actions: { installations: { requiredRoles: ['ROLE_GRID_OPERATOR'], handler: reads } },
  });
  const empty = { ...situation, concern: registryQuestion, dataNeeds: '', hypotheses: [] };
  llm.generateStructured.mockResolvedValue(empty);
  llm.generateChat
    .mockResolvedValueOnce({
      toolCalls: [
        call({
          installationType: 'solar',
          minCapacityKW: 100,
          location: 'Uslar',
          operationalStatus: '35',
        }),
      ],
    })
    .mockResolvedValueOnce({ toolCalls: [] })
    .mockImplementationOnce(async (messages, options) => {
      const previousRead = JSON.parse(messages[1].content).previousReads[0];
      expect(previousRead.metadata.parameters).toMatchObject({
        installationType: 'solar',
        minCapacityKW: 100,
      });
      expect(previousRead.value).toContain('300');
      const candidate = options.tools.find((tool) =>
        tool.function.description.startsWith(operation.action)
      );
      return {
        toolCalls: [
          {
            name: candidate.function.name,
            args: {
              input: {
                installationType: 'solar',
                minCapacityKW: 100,
                location: 'Uslar',
                operationalStatus: '35',
              },
              projection: {
                operations: [
                  { op: 'sort', by: [{ field: 'capacityKW', direction: 'desc' }] },
                  { op: 'limit', count: 1 },
                ],
              },
            },
          },
        ],
      };
    });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Das Werkzeugergebnis ist unten aufgeführt.')],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  await environment.broker.start();
  try {
    const input = {
      channel: 'open-webui',
      conversationId: 'synthetic-trigger',
      message: registryQuestion,
    };
    const first = await environment.call('workbench.chat', input, meta);
    expect(first.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available' }),
      ])
    );
    const second = await environment.call(
      'workbench.chat',
      { ...input, message: refinementQuestion },
      meta
    );
    expect(reads).toHaveBeenCalledTimes(2);
    expect(second.responseText).toContain('Synthetic Large');
    expect(second.responseText).not.toContain('Synthetic Small');
    expect(reads.mock.calls[1][0].params).toEqual(reads.mock.calls[0][0].params);
    const loopLogs = logs.mock.calls.filter(([line]) => line === 'Workbench capability loop');
    expect(loopLogs).toHaveLength(2);
    expect(loopLogs.map(([, value]) => value)).toEqual([
      expect.objectContaining({
        status: 'started',
        reason: 'capability_match',
        candidateCount: 1,
        operations: [operation.action],
      }),
      expect.objectContaining({
        status: 'started',
        reason: 'capability_match',
        operations: [operation.action],
      }),
    ]);
    expect(JSON.stringify(loopLogs)).not.toContain('Uslar');
    const knowledge = await environment.call(
      'workbench.chat',
      { ...input, message: 'Was ist das Marktstammdatenregister?' },
      meta
    );
    expect(reads).toHaveBeenCalledTimes(2);
    expect(knowledge.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'capability-read', status: 'skipped' }),
      ])
    );
    expect(logs.mock.calls.filter(([line]) => line === 'Workbench capability loop')).toHaveLength(
      3
    );
  } finally {
    await environment.cleanup();
  }
});

test('HTTP-e2e: empty dataNeeds triggers registry query and refinement with delegated transport', async () => {
  const { createCaseBroker } = require('./helpers/case-linking-broker');
  const Api = require('../services/api.service');
  const OpenAICompatible = require('../services/openai-compatible.service');
  const environment = await createCaseBroker();
  const observed = [];
  environment.broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
  environment.broker.createService(OpenAICompatible);
  environment.broker.createService({
    name: 'token-manager',
    actions: {
      verify: () => ({
        valid: true,
        type: 'gateway',
        tokenId: 'synthetic-transport',
        client: 'open-webui',
        externalOrgId: 'synthetic-org',
        tenantId: 'synthetic',
        scope: 'full-access',
        roles: ['ROLE_ADMIN', 'full-access'],
      }),
    },
  });
  environment.broker.createService({
    name: 'energy-market',
    actions: {
      installations: {
        requiredRoles: ['ROLE_GRID_OPERATOR'],
        handler: (context) => {
          observed.push(context.meta);
          return {
            success: true,
            data: { results: [{ municipality: 'Synthetic A', capacityKW: 300 }] },
          };
        },
      },
    },
  });
  await environment.workbench.store.saveTenantMapping({
    client: 'open-webui',
    externalOrgId: 'synthetic-org',
    cetTenantId: 'synthetic',
  });
  await environment.workbench.store.saveUserMapping({
    client: 'open-webui',
    externalOrgId: 'synthetic-org',
    externalUserId: 'external-person',
    cetTenantId: 'synthetic',
    cetActorId: 'person',
    roles: ['ROLE_GRID_OPERATOR'],
  });
  llm.generateStructured.mockResolvedValue({
    ...situation,
    concern: registryQuestion,
    dataNeeds: '',
    hypotheses: [],
  });
  llm.generateChat
    .mockResolvedValueOnce({
      toolCalls: [
        call({
          installationType: 'solar',
          location: 'Uslar',
          minCapacityKW: 100,
          operationalStatus: '35',
        }),
      ],
    })
    .mockResolvedValueOnce({ toolCalls: [] })
    .mockResolvedValueOnce({
      toolCalls: [
        call(
          {
            installationType: 'solar',
            location: 'Uslar',
            minCapacityKW: 100,
            operationalStatus: '35',
          },
          {
            operations: [
              { op: 'sort', by: [{ field: 'capacityKW', direction: 'desc' }] },
              { op: 'limit', count: 1 },
            ],
          }
        ),
      ],
    });
  llm.generateText.mockResolvedValue(
    JSON.stringify({
      interpretation: [claim('Synthetic A ist im Ergebnis enthalten.', ['E1'])],
      expectation: [],
      nextSteps: [],
      draft: [],
    })
  );
  await environment.broker.start();
  try {
    const base = `http://127.0.0.1:${environment.broker.getLocalService('api').server.address().port}`;
    const request = (user, content = registryQuestion) =>
      fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ck_synthetic',
          'Content-Type': 'application/json',
          'X-OpenWebUI-User-Id': user,
          'X-OpenWebUI-Chat-Id': 'synthetic-http-tools',
        },
        body: JSON.stringify({
          model: 'cernion-governance-assistant',
          messages: [{ role: 'user', content }],
        }),
      });
    const response = await request('external-person');
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.metadata.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available' }),
      ])
    );
    expect(observed).toHaveLength(1);
    expect(observed[0].authUser).toMatchObject({
      userId: 'person',
      roles: ['ROLE_GRID_OPERATOR'],
      scope: 'read-only',
      tenantId: 'synthetic',
    });
    expect(observed[0].apiToken.type).toBe('delegated-person');
    expect(JSON.stringify(observed)).not.toContain('ROLE_ADMIN');
    const refined = await request('external-person', refinementQuestion);
    const refinedPayload = await refined.json();
    expect(refined.status).toBe(200);
    expect(refinedPayload.metadata.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: operation.action, status: 'available' }),
      ])
    );
    expect(observed).toHaveLength(2);
    expect((await request('unmapped-person')).status).toBe(403);
    expect(observed).toHaveLength(2);
  } finally {
    await environment.cleanup();
  }
});

test('loop summary distinguishes no candidates from a planner that did not execute a matching read', () => {
  const trace = [{ source: 'capability-read', status: 'missing', called: false, hitCount: 0 }];
  expect(loopDiagnostics({ trace, candidateCount: 0, ms: 2 }, 0, 'data_need')).toEqual({
    status: 'skipped',
    reason: 'no_candidates',
    candidateCount: 0,
    operations: [],
    ms: 2,
  });
  expect(loopDiagnostics({ trace, candidateCount: 1, ms: 2 }, 1, 'data_need')).toMatchObject({
    status: 'started',
    reason: 'error',
  });
});

test('a quoted data question in a correspondence thread does not create a fallback data need', () => {
  const message = `Kannst du mir mit diesem Verlauf helfen?\n\nVon: Synthetic Team\n${registryQuestion}`;
  const need = resolveCapabilityNeed(
    { ...situation, concern: registryQuestion, dataNeeds: '' },
    message,
    { model, index, api }
  );
  expect(need.reason).toBe('no_data_need');
  expect(llm.generateChat).not.toHaveBeenCalled();
});

test.each([
  'Welche Arten von Solaranlagen gibt es?',
  'Welche Voraussetzungen gelten für Solaranlagen?',
])('generic knowledge lists do not trigger data reads: %s', (message) => {
  expect(
    resolveCapabilityNeed({ ...situation, concern: registryQuestion, dataNeeds: '' }, message, {
      model,
      index,
      api,
    }).reason
  ).toBe('no_data_need');
});
test.each([
  'Was ist der aktuelle Stand der MaStR installations?',
  'Wie hoch ist der Wert der MaStR installations installed capacity?',
])('concrete status and value questions trigger existing read routing: %s', (message) => {
  expect(
    resolveCapabilityNeed({ ...situation, concern: registryQuestion, dataNeeds: '' }, message, {
      model,
      index,
      api,
    }).reason
  ).toBe('capability_match');
});
