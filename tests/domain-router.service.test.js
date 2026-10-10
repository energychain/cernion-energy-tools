'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const Sidecar = require('../services/agent-sidecar.service');
const { classifyDomain } = require('../src/domain-router');
const { evaluateEventTriggers } = require('../src/domain-router-events');

const meta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'actor-a',
    scope: 'read-only',
    roles: ['ROLE_GRID_OPERATOR'],
  },
};
const delivery = { mode: 'poll', clientId: 'hermes' };
describe('Domain Router #595 (real Moleculer + PouchDB)', () => {
  let broker, service, dir, recommend, select, knowledge;
  const call = (action, params, auth = meta) =>
    broker.call(`domain-router.${action}`, params, { meta: auth });
  const classify = (userRequest, extra = {}) =>
    call('classify', { userRequest, asyncDelivery: delivery, ...extra });
  const events = async (caseId) =>
    (await call('events.list', { clientId: 'hermes', caseId })).events;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-dr-'));
    broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 1000 });
    service = broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(dir, 'state'),
        eventsDbPath: path.join(dir, 'events'),
        knowledgeTimeoutMs: 25,
      },
    });
    broker.createService(Sidecar);
    recommend = jest.fn(() => ({
      capability: 'mako_evidence',
      recommendedCapabilities: [{ capability: 'mako_evidence' }],
      operationCandidates: [{ operationId: 'test.read' }],
    }));
    select = jest.fn(() => ({
      data: {
        selected: true,
        receiptId: 'mako-receipt',
        diagnostics: { candidates: [{ receiptId: 'mako-receipt' }] },
      },
    }));
    knowledge = jest.fn(() => ({ results: [] }));
    broker.createService({
      name: 'capability-broker',
      actions: { recommend: (ctx) => recommend(ctx.params) },
    });
    broker.createService({
      name: 'agent-receipts',
      actions: { select: (ctx) => select(ctx.params) },
    });
    broker.createService({
      name: 'knowledge-rag',
      actions: { query: (ctx) => knowledge(ctx.params) },
    });
    broker.createService({
      name: 'object-store',
      actions: {
        get: (ctx) => ({
          payload: {
            tenantId: 'tenant-a',
            userId: 'actor-a',
            dossier: { state: { id: ctx.params.key } },
          },
        }),
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('number and foreign-domain label produce identical persisted case state', async () => {
    const { getFunctionModel } = require('../src/function-model');
    const fn = getFunctionModel().functions.find(
      (row) =>
        row.domains.some((domain) => domain === 'grid-connection') &&
        /zielnetz|redispatch|management|budget/i.test(row.displayLabel)
    );
    recommend.mockReturnValue({
      uncertain: true,
      candidates: [{ capabilityId: fn.capabilities[0], displayLabel: fn.displayLabel, score: 1 }],
    });
    select.mockReturnValue({ data: { selected: false } });
    const cases = [];
    for (const userRequest of ['Nummer 1', fn.displayLabel]) {
      const started = await classify('Netzanschluss am Umspannwerk prüfen', {
        knownContext: { stationId: 'station-nord', controlPoint: 'connection-review' },
      });
      recommend.mockClear();
      select.mockClear();
      knowledge.mockClear();
      const next = await call('continue', { cetCaseId: started.cetCaseId, userRequest });
      expect(next.primaryDomain).toBe('grid_connection');
      expect(next.uncertain).toBe(false);
      expect(recommend).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(knowledge).not.toHaveBeenCalled();
      const state = await service.loadCase(
        require('../src/domain-router-policy').principal({ meta }),
        started.cetCaseId
      );
      expect(state.knownContext.cetCaseId).toBe(started.cetCaseId);
      const { cetCaseId: _caseRef, ...knownContext } = state.knownContext;
      cases.push({
        currentDomain: state.currentDomain,
        knownContext,
        selectedCapabilities: state.selectedCapabilities,
        lastTransition: state.lastTransition,
        domainHistory: state.domainHistory,
        openClarifications: state.openClarifications,
      });
    }
    expect(cases[0]).toEqual(cases[1]);
    expect(cases[0].knownContext).toMatchObject({ stationId: 'station-nord' });
  });

  test.each([
    ['APERAK Z18 Ablehnung prüfen', 'market_communication'],
    ['Lastgang plausibilisieren, Datenqualitätslücke im EDM', 'edm'],
    ['Zielnetzplanung Produktionsreife Evidence Gate', 'target_grid_planning'],
    ['Netzanschlusszusage ohne formales Netzanschlussbegehren', 'grid_connection'],
    ['Redispatch Abrufdaten fehlen', 'redispatch'],
  ])('%s -> %s with existing signal engines', async (task, domain) => {
    const c = await classify(task);
    expect(c.primaryDomain).toBe(domain);
    expect(recommend).toHaveBeenCalledWith(expect.objectContaining({ task }));
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ question: task, includeEvaluation: true })
    );
    expect(knowledge).toHaveBeenCalled();
    expect(c.diagnostics.sources).toMatchObject({
      domainRoutes: 'consulted',
      semanticDomains: 'consulted',
      broker: 'consulted',
      receipts: 'consulted',
      knowledge: 'consulted',
    });
    expect(c.selectedCapabilities).toEqual([{ capability: 'mako_evidence' }]);
    expect(c.selectedReceipts).toEqual(['mako-receipt']);
    const state = await service.db.get(`tenant-a:${c.cetCaseId}`);
    expect(state).toMatchObject({
      _rev: expect.any(String),
      caseStateVersion: 1,
      currentDomain: domain,
    });
    expect(c.noCallGuards).toContain('buchung');
  });
  test('MSCONS and Lastgang ambiguity asks for clarification and feeds the outbox', async () => {
    const c = await classify('MSCONS fehlt, Lastgang/Zeitreihe plausibilisieren');
    expect(c.transition.type).toBe('clarify');
    expect(c.selectedCapabilities).toEqual([]);
    expect([c.primaryDomain, ...c.alternativeDomains.map((d) => d.domain)]).toEqual(
      expect.arrayContaining(['edm', 'market_communication'])
    );
    expect((await events(c.cetCaseId)).map((e) => e.eventType)).toContain('clarification.required');
  });
  test('follow-up reclassifies MaKo to EDM and records history', async () => {
    const first = await classify('APERAK Z18 Ablehnung');
    const next = await call('continue', {
      cetCaseId: first.cetCaseId,
      userRequest: 'zeige interne Zeitreihen-Plausibilisierung',
    });
    expect(next.transition).toMatchObject({
      type: 'reclassify',
      fromDomain: 'market_communication',
      toDomain: 'edm',
    });
    expect((await events(first.cetCaseId)).map((e) => e.eventType)).toContain('domain.changed');
  });
  test('ZNP asset follow-up creates discoverable child with branch events on both sides', async () => {
    const first = await classify('Zielnetzplanung Produktionsreife');
    await call('continue', {
      cetCaseId: first.cetCaseId,
      userRequest: 'welche Assets sind betroffen?',
    });
    const discovery = await call('related-sessions.discover', { caseId: first.cetCaseId });
    const child = discovery.relatedCases.find((c) => c.relationshipType === 'branch_child');
    expect(child).toBeDefined();
    expect((await events(first.cetCaseId)).map((e) => e.eventType)).toContain('branch.created');
    expect((await events(child.cetCaseId)).map((e) => e.eventType)).toContain('branch.created');
    await call('ingestUpdate', {
      cetCaseId: child.cetCaseId,
      kind: 'evidence_available',
      version: 'e1',
      evidenceRef: 'evidence:1',
    });
    expect(
      (await events(first.cetCaseId)).some(
        (e) => e.eventType === 'evidence.available' && e.sourceCaseId === child.cetCaseId
      )
    ).toBe(true);
  });
  test('poll, ack, replay and restart preserve deduplication', async () => {
    const c = await classify('MSCONS Lastgang');
    const first = await events(c.cetCaseId);
    expect(first.length).toBeGreaterThan(0);
    expect(await events(c.cetCaseId)).toEqual(first);
    for (const event of first) {
      const ack = await call('events.ack', { eventId: event.eventId, clientId: 'hermes' });
      expect(await call('events.ack', { eventId: event.eventId, clientId: 'hermes' })).toEqual(ack);
    }
    expect(await events(c.cetCaseId)).toEqual([]);
    await service.db.close();
    await service.eventsDb.close();
    const PouchDB = require('pouchdb');
    service.db = new PouchDB(path.join(dir, 'state'));
    service.eventsDb = new PouchDB(path.join(dir, 'events'));
    expect(await events(c.cetCaseId)).toEqual([]);
    await call('ingestUpdate', {
      cetCaseId: c.cetCaseId,
      kind: 'async_result',
      version: 'result-1',
    });
    const ready = (await events(c.cetCaseId)).find((e) => e.eventType === 'async.message.ready');
    await call('events.ack', { eventId: ready.eventId, clientId: 'hermes' });
    await call('ingestUpdate', {
      cetCaseId: c.cetCaseId,
      kind: 'async_result',
      version: 'result-1',
    });
    expect(await events(c.cetCaseId)).toEqual([]);
    await call('ingestUpdate', {
      cetCaseId: c.cetCaseId,
      kind: 'async_result',
      version: 'result-2',
    });
    expect((await events(c.cetCaseId)).map((e) => e.eventType)).toContain('async.message.ready');
  });
  test('outbox write interruption recovers from durable state intents', async () => {
    const put = jest
      .spyOn(service.eventsDb, 'put')
      .mockRejectedValueOnce(new Error('disk transient'));
    await expect(classify('MSCONS Lastgang')).rejects.toThrow('disk transient');
    put.mockRestore();
    expect((await events()).map((e) => e.eventType)).toContain('clarification.required');
  });
  test.each([
    'laufkarteId',
    'stationId',
    'edgeId',
    'traceId',
    'controlPoint',
    'ownerRole',
    'roleFamily',
    'evidenceRef',
    'processRef',
    'roomId',
    'threadId',
    'conversationId',
    'agentSessionId',
  ])('discovery and delayed replies use %s', async (field) => {
    const extra = { [field]: 'shared-key', knownContext: { [field]: 'shared-key' } };
    const a = await classify('APERAK Z18', extra);
    const b = await classify('Lastgang EDM', extra);
    const found = await call('related-sessions.discover', { caseId: a.cetCaseId });
    expect(found.relatedCases.some((c) => c.cetCaseId === b.cetCaseId)).toBe(true);
    await call('ingestUpdate', {
      cetCaseId: b.cetCaseId,
      kind: 'related_reply',
      version: 'reply-1',
    });
    expect(
      (await events(a.cetCaseId)).some(
        (e) => e.eventType === 'related.session.reply' && e.sourceCaseId === b.cetCaseId
      )
    ).toBe(true);
    if (field === 'agentSessionId')
      expect(found.relatedSessions[0].reason).toBe('personal_agent_and_dossier_reference');
  });
  test('policy blocks tenant spoofing, missing role and sensitive input before sources/state', async () => {
    await expect(classify('APERAK', { tenantId: 'evil' })).rejects.toMatchObject({ code: 403 });
    await expect(
      call(
        'classify',
        { userRequest: 'APERAK', actorRoles: ['ROLE_GRID_OPERATOR'] },
        { apiToken: { ...meta.apiToken, roles: [] } }
      )
    ).rejects.toMatchObject({ code: 403 });
    await expect(classify('APERAK', { sensitivityFlags: ['confidential'] })).rejects.toMatchObject({
      code: 403,
    });
    expect(recommend).not.toHaveBeenCalled();
    expect((await service.db.allDocs()).rows).toEqual([]);
  });
  test('unauthorized actor/tenant/role sees no case, discovery or event placeholders', async () => {
    const c = await classify('MSCONS Lastgang', { knownContext: { laufkarteId: 'shared' } });
    for (const changes of [{ tenantId: 'other' }]) {
      const auth = { apiToken: { ...meta.apiToken, ...changes } };
      expect(await call('events.list', { clientId: 'hermes' }, auth)).toEqual({ events: [] });
      await expect(
        call('related-sessions.discover', { caseId: c.cetCaseId }, auth)
      ).rejects.toBeDefined();
    }
    const [event] = await events(c.cetCaseId);
    await expect(
      call('events.ack', { eventId: event.eventId, clientId: 'wrong' })
    ).rejects.toMatchObject({ code: 403 });
  });
  test('knowledge timeout degrades and approved hints cannot become answer facts', async () => {
    knowledge.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 80))
    );
    const c = await classify('Zielnetzplanung Evidence');
    expect(c.primaryDomain).toBe('target_grid_planning');
    expect(c.diagnostics.sources.knowledge).toMatch(/^unavailable/);
    knowledge.mockReturnValue({
      results: [
        {
          id: 'allowed',
          metadata: {
            tenantId: 'tenant-a',
            status: 'approved',
            sensitivity: 'public',
            domain: 'target_grid_planning',
            laufkarteId: 'L1',
          },
        },
        {
          id: 'private',
          metadata: { tenantId: 'tenant-b', status: 'approved', sensitivity: 'public' },
        },
      ],
    });
    const hint = await classify('Zielnetzplanung');
    expect(hint.knowledgeRefs.map((r) => r.id)).toEqual(['allowed']);
    expect(hint.matchedLaufkarten).toContain('L1');
    expect(await events(hint.cetCaseId)).toEqual([]);
    expect(hint.responseGuidance).toMatch(/unverified/);
  });
  test('invalid forced receipt is a clear error, never persisted as fallback', async () => {
    select.mockImplementation(() => {
      throw Object.assign(new Error('Invalid forced receipt'), { code: 422 });
    });
    await expect(classify('APERAK', { forceReceipt: 'missing' })).rejects.toMatchObject({
      code: 422,
    });
    expect((await service.db.allDocs()).rows).toEqual([]);
  });
  test('missing evidence and owner block revenue claims, readiness and control point', async () => {
    const c = await classify('MaKo billing revenue leakage', {
      knownContext: { laufkarteId: 'L1', controlPoint: 'CP1' },
    });
    expect(c.readinessState).toBe('evidence_required');
    expect(c.roleProjection.ownerGap).toBe(true);
    expect(c.noCallGuards).toEqual(
      expect.arrayContaining(['approve', 'buchung', 'binding_regulatory_claim'])
    );
    expect((await events(c.cetCaseId)).map((e) => e.eventType)).toEqual(
      expect.arrayContaining([
        'evidence.required',
        'control_point.blocked',
        'case.escalation.required',
      ])
    );
  });
  test('MSB, M2C and IT remain alternatives, not generic governance', async () => {
    const c = await classify('iMSys meter interface billing Fehler');
    expect(c.transition.type).toBe('clarify');
    expect([c.primaryDomain, ...c.alternativeDomains.map((d) => d.domain)]).toEqual(
      expect.arrayContaining(['metering_msb', 'm2c_revenue_assurance', 'it_data_vendor_governance'])
    );
  });
  test('continue, handoff, fallback and optimistic version guard are real service behaviors', async () => {
    const c = await classify('Redispatch');
    expect(
      (await call('continue', { cetCaseId: c.cetCaseId, userRequest: 'Redispatch prüfen' }))
        .transition.type
    ).toBe('continue');
    expect((await classify('Redispatch', { requestedMode: 'handoff' })).transition.type).toBe(
      'handoff'
    );
    recommend.mockReturnValue({});
    select.mockReturnValue({});
    expect((await classify('hallo unbekannt')).transition.type).toBe('fallback');
    await expect(
      call('continue', { cetCaseId: c.cetCaseId, userRequest: 'Redispatch', caseStateVersion: 1 })
    ).rejects.toMatchObject({ code: 409 });
  });
  test('sidecar additions actually call the router, persist and acknowledge its events', async () => {
    const res = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.classify_task',
        input: { userRequest: 'MSCONS Lastgang', asyncDelivery: delivery },
      },
      { meta }
    );
    expect(res.structuredContent.transition.type).toBe('clarify');
    const list = await broker.call(
      'agent-sidecar.callTool',
      { name: 'cernion.list_case_events', input: { clientId: 'hermes' } },
      { meta }
    );
    expect(list.structuredContent.events.length).toBeGreaterThan(0);
    const event = list.structuredContent.events[0];
    const ack = await broker.call(
      'agent-sidecar.callTool',
      { name: 'cernion.ack_case_event', input: { eventId: event.eventId, clientId: 'hermes' } },
      { meta }
    );
    expect(ack.structuredContent.deliveryState).toBe('acknowledged');
  });
});

describe('Router trigger matrix', () => {
  test.each([
    ['reclassify', 'DR-TRANSITION-RECLASSIFY', 'domain.changed'],
    ['branch', 'DR-TRANSITION-BRANCH', 'branch.created'],
    ['clarify', 'DR-TRANSITION-CLARIFY', 'clarification.required'],
    ['handoff', 'DR-HANDOFF', 'handoff.completed'],
  ])('%s', async (type, trigger, eventType) => {
    const c = await classifyDomain({ userRequest: 'Redispatch' });
    c.transition.type = type;
    const state = {
      tenantId: 't',
      cetCaseId: 'c',
      caseStateVersion: 1,
      lastClassification: c,
      knownContext: {},
    };
    expect(evaluateEventTriggers(null, state)).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger, eventType })])
    );
  });
  test.each([
    ['async_result', 'PA-ASYNC-RESULT', 'async.message.ready'],
    ['receipt_complete', 'RCPT-COMPLETE', 'evidence.available'],
    ['receipt_failed', 'RCPT-FAILED-BLOCKING', 'case.escalation.required'],
    ['related_found', 'DISCOVERY-RELATED-FOUND', 'related.session.found'],
    ['related_reply', 'RELATED-REPLY', 'related.session.reply'],
  ])('%s is version-deduplicated', async (kind, trigger, eventType) => {
    const c = await classifyDomain({ userRequest: 'Redispatch' });
    const state = {
      tenantId: 't',
      cetCaseId: 'c',
      caseStateVersion: 1,
      lastClassification: c,
      knownContext: {},
    };
    const result = evaluateEventTriggers(null, state, { kind, version: '1' });
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger, eventType })])
    );
    expect(evaluateEventTriggers(null, state, { kind, version: '1' })).toEqual(result);
    expect(evaluateEventTriggers(null, state, { kind, version: '2' })[0].dedupeKey).not.toEqual(
      result[0].dedupeKey
    );
  });
  test('policy, station, readiness, owner, M2C and vendor conditions actively trigger', async () => {
    const c = await classifyDomain({
      userRequest: 'billing',
      knownContext: { policyBlocked: true, vendorBlocker: true, controlPoint: 'cp' },
    });
    const state = {
      tenantId: 't',
      cetCaseId: 'c',
      caseStateVersion: 2,
      lastClassification: c,
      knownContext: { policyBlocked: true },
      relatedCases: [{ cetCaseId: 'other' }],
    };
    const triggers = evaluateEventTriggers(null, state).map((e) => e.trigger);
    expect(triggers).toEqual(
      expect.arrayContaining([
        'POLICY-BLOCK',
        'CONTROL-POINT-BLOCKED',
        'OWNER-GAP-DETECTED',
        'M2C-IMPACT-DETECTED',
        'VENDOR-BLOCKER-DETECTED',
      ])
    );
    const ready = {
      ...state,
      knownContext: { ownerRole: 'ROLE_GRID_OPERATOR' },
      lastClassification: {
        ...c,
        currentStation: 'S1',
        missingEvidence: [],
        readinessState: 'human_review_required',
        roleProjection: { ownerGap: false },
      },
    };
    expect(evaluateEventTriggers(state, ready).map((e) => e.trigger)).toEqual(
      expect.arrayContaining(['LAUFKARTE-STATION-READY', 'READINESS-CHANGED'])
    );
    const clean = await classifyDomain({ userRequest: 'Redispatch' });
    expect(
      evaluateEventTriggers(
        null,
        { ...state, knownContext: {}, lastClassification: clean },
        { kind: 'qdrant_process_hit', version: '1' }
      )
    ).toEqual([]);
  });
});

describe('Domain Router using production broker and receipt engines', () => {
  let broker, dir;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-dr-engines-'));
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(dir, 'state'),
        eventsDbPath: path.join(dir, 'events'),
      },
    });
    broker.createService(require('../services/capability-broker.service'));
    broker.createService({
      ...require('../services/agent-receipts.service'),
      settings: { dbPath: path.join(dir, 'receipts') },
    });
    await broker.start();
  });
  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test.each([
    ['APERAK Z18 Ablehnung prüfen', 'market_communication'],
    ['MSCONS fehlt, Lastgang/Zeitreihe plausibilisieren', null],
    ['Zielnetzplanung Produktionsreife Evidence Gate', 'target_grid_planning'],
  ])('production signal integration: %s', async (userRequest, domain) => {
    const c = await broker.call(
      'domain-router.classify',
      { userRequest, disableKnowledgeRouting: true },
      { meta }
    );
    expect(c.diagnostics.sources.broker).toBe('consulted');
    expect(c.diagnostics.sources.receipts).toBe('consulted');
    expect(c.candidateCapabilities.length).toBeGreaterThan(0);
    if (domain) expect(c.primaryDomain).toBe(domain);
    else expect(c.transition.type).toBe('clarify');
    if (domain === 'target_grid_planning')
      expect(c.candidateCapabilities.map((x) => x.capability).join(' ')).not.toMatch(
        /^vdmi_asset_validation$/
      );
  });
});
