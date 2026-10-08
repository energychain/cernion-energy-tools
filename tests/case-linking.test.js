'use strict';

const { auth, createCaseBroker } = require('./helpers/case-linking-broker');
const { normalizeIdentifiers } = require('../src/case-linking');
const { principal } = require('../src/domain-router-policy');

const ids = [{ kind: 'reference-a', value: 'ANON-0001' }];
const colleague = auth('actor-b');
const foreignTeam = auth('actor-c', ['ROLE_ALPHA', 'ROLE_BETA']);
const foreignTenant = auth('actor-d', ['ROLE_ALPHA'], 'tenant-b');

describe('Case linking #753 (real broker and existing PouchDB lifecycle)', () => {
  let app;
  beforeEach(async () => {
    app = await createCaseBroker();
    await app.broker.start();
  });
  afterEach(async () => {
    await app.cleanup();
  });
  const discover = (caseId, meta) =>
    app.call('domain-router.related-sessions.discover', { caseId }, meta);
  const search = (meta, query = 'Wie ist der Stand bei ANON-0001?') =>
    app.call('domain-router.cases.searchIdentifiers', { query }, meta);

  test('generic configured normalization is typed, bounded, deduplicated and preserves leading zeros', () => {
    expect(
      normalizeIdentifiers(
        [
          { type: ' REF-A ', value: ' 00 AB ' },
          { kind: 'ref-a', value: '00ab' },
        ],
        {
          'ref-a': { caseFold: true, stripWhitespace: true },
        }
      )
    ).toEqual([{ kind: 'ref-a', value: '00ab' }]);
    expect(() => normalizeIdentifiers([{ kind: 'x', value: '' }])).toThrow();
    expect(() => normalizeIdentifiers(Array.from({ length: 21 }, () => ids[0]))).toThrow();
  });

  test('same type/value links independent own cases; different types do not produce same_subject', async () => {
    const first = await app.create(ids);
    const second = await app.create(ids);
    const otherType = await app.create([{ kind: 'reference-b', value: 'ANON-0001' }]);
    expect(second.cetCaseId).not.toBe(first.cetCaseId);
    expect(second.relatedCases).toEqual([
      expect.objectContaining({
        cetCaseId: first.cetCaseId,
        relationshipType: 'same_subject',
        confidence: 0.8,
        reason: 'matching_typed_identifier',
        matchedIdentifiers: ids,
      }),
    ]);
    expect(otherType.relatedCases).toEqual([]);
    expect((await discover(first.cetCaseId)).relatedCases).toEqual([
      expect.objectContaining({ cetCaseId: second.cetCaseId }),
    ]);
  });

  test('own is the default and client input cannot broaden visibility', async () => {
    await app.create(ids, auth(), {
      caseVisibility: 'tenant',
      knownContext: { identifiers: ids, caseVisibility: 'tenant' },
    });
    expect((await search(colleague)).items).toEqual([]);
    expect((await search(foreignTenant)).items).toEqual([]);
  });

  test('legacy cases stay private after tenant explicitly enables team', async () => {
    const first = await app.create(ids);
    const doc = await app.router.loadCase(principal({ meta: auth() }), first.cetCaseId);
    delete doc.caseVisibility;
    await app.router.db.put(doc);
    app.policy('team');
    expect((await search(colleague)).items).toEqual([]);
    const fresh = await app.create(ids);
    expect((await search(colleague)).items.map((item) => item.cetCaseId)).toEqual([
      fresh.cetCaseId,
    ]);
  });

  test('team links colleagues with matching assigned role sets, not foreign teams or tenants', async () => {
    app.policy('team');
    const first = await app.create(ids);
    const second = await app.create(ids, colleague);
    expect(second.relatedCases).toEqual([
      expect.objectContaining({ cetCaseId: first.cetCaseId, relationshipType: 'same_subject' }),
    ]);
    expect((await search(foreignTeam)).items).toEqual([]);
    expect((await search(foreignTenant)).items).toEqual([]);
    await expect(
      app.call('workbench.cases.get', { caseId: first.cetCaseId }, foreignTeam)
    ).rejects.toMatchObject({ code: 403 });
  });

  test('tenant permits a different team only within existing role ACL and clearance', async () => {
    app.policy('tenant');
    await app
      .create(ids, auth(), { sensitivityFlags: ['restricted'] })
      .catch((error) => expect(error.code).toBe(403));
    const first = await app.create(
      ids,
      auth('actor-a', ['ROLE_ALPHA'], 'tenant-a', ['restricted']),
      { sensitivityFlags: ['restricted'] }
    );
    expect((await search(foreignTeam)).items).toEqual([]);
    expect(
      (await search(auth('actor-c', ['ROLE_ALPHA', 'ROLE_BETA'], 'tenant-a', ['restricted']))).items
    ).toEqual([expect.objectContaining({ cetCaseId: first.cetCaseId })]);
    expect(
      (await search(auth('actor-x', ['ROLE_OTHER'], 'tenant-a', ['restricted']))).items
    ).toEqual([]);
    expect((await search(foreignTenant)).items).toEqual([]);
    app.policy('own');
    expect(
      (await search(auth('actor-b', ['ROLE_ALPHA'], 'tenant-a', ['restricted']))).items
    ).toEqual([]);
  });

  test('overlapping coverage establishes team membership without broadening role ACL', async () => {
    app.policy('team');
    const { getFunctionModel } = require('../src/function-model');
    const { configuration } = require('../src/function-coverage');
    const model = getFunctionModel();
    const functionId = model.functions[0].functionId;
    const now = Date.now();
    app.broker.createService({
      name: 'function-coverage',
      settings: { model, clock: () => now },
      created() {
        this.config = configuration();
      },
      methods: {
        documents: async (tenantId) =>
          ['actor-a', 'actor-c', 'actor-x'].map((actorId) => ({
            _id: actorId,
            tenantId,
            actorId,
            functionId,
            at: now,
            expiresAt: now + 1000,
            origin: 'corrected',
            score: 1,
            signalClass: 'completed_turn',
            modelSourceHash: model.sourceHash,
          })),
      },
    });
    await app.create(ids);
    expect((await search(foreignTeam)).items).toHaveLength(1);
    expect((await search(auth('actor-x', ['ROLE_OTHER']))).items).toEqual([]);
    expect((await search(foreignTenant)).items).toEqual([]);
  });

  test('foreign projections contain only summary/status/responsible/identifiers and audit every read', async () => {
    app.policy('team');
    const first = await app.create(ids);
    const projected = await app.call(
      'workbench.cases.get',
      { caseId: first.cetCaseId, includeEvidence: true },
      colleague
    );
    expect(Object.keys(projected).sort()).toEqual(
      ['caseId', 'cetCaseId', 'identifiers', 'responsible', 'status', 'summary'].sort()
    );
    expect(projected.summary).toContain('Lagebild');
    const list = await app.call('workbench.cases.list', {}, colleague);
    expect(list.items).toEqual([projected]);
    expect(JSON.stringify(list)).not.toMatch(
      /RAW-CONTENT|initialRequest|turnMemory|internalDrafts/
    );
    const audit = (await app.router.eventsDb.allDocs({ include_docs: true })).rows
      .map((row) => row.doc)
      .filter((row) => row.kind === 'observed');
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.actorId === 'actor-b' && row.tenantId === 'tenant-a')).toBe(
      true
    );
    expect(JSON.stringify(audit)).not.toMatch(/RAW-CONTENT|ANON-0001|Lagebild/);
    await expect(
      app.call('domain-router.explain', { cetCaseId: first.cetCaseId }, colleague)
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      app.call(
        'domain-router.continue',
        { cetCaseId: first.cetCaseId, userRequest: 'Change case' },
        colleague
      )
    ).rejects.toMatchObject({ code: 403 });
  });

  test('audit failure prevents foreign summary disclosure', async () => {
    app.policy('team');
    const first = await app.create(ids);
    jest.spyOn(app.router.eventsDb, 'put').mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(
      app.call('workbench.cases.get', { caseId: first.cetCaseId }, colleague)
    ).rejects.toThrow('audit unavailable');
  });

  test('explicit role sharing retains raw access while team visibility alone never delivers events', async () => {
    app.policy('team');
    const first = await app.create(ids, auth(), {
      asyncDelivery: { mode: 'poll', clientId: 'client-a' },
    });
    expect(
      (
        await app.call(
          'domain-router.events.list',
          { clientId: 'client-a', caseId: first.cetCaseId },
          colleague
        )
      ).events
    ).toEqual([]);
    const shared = await app.create(ids, auth(), { sharedWithRoles: ['ROLE_ALPHA'] });
    expect(
      (await app.call('workbench.cases.get', { caseId: shared.cetCaseId }, colleague))
        .initialRequest
    ).toContain('RAW-CONTENT');
  });

  test('status lookup uses complete normalized references; explicit types disambiguate', async () => {
    app.policy('team', { 'reference-a': { caseFold: true } });
    const first = await app.create(ids);
    expect((await search(colleague, 'Stand bei anon-0001?')).items).toHaveLength(1);
    expect((await search(colleague, 'Stand bei ANON-000?')).items).toEqual([]);
    expect((await search(colleague, 'reference-b:ANON-0001')).items).toEqual([]);
    expect(
      (
        await app.call(
          'workbench.query',
          {
            message: 'Wie ist der Stand bei ANON-0001?',
            conversationId: 'status',
            channel: 'test',
            intentMode: 'status_query',
          },
          colleague
        )
      ).responseText
    ).toContain(first.cetCaseId);
  });

  test('confirmed/rejected links are journalized, symmetric in discovery, durable and undoable with version guards', async () => {
    app.policy('team');
    const first = await app.create(ids);
    const second = await app.create(ids, colleague);
    const correction = (decision, version) =>
      app.call(
        'domain-router.cases.correctLink',
        {
          cetCaseId: second.cetCaseId,
          targetCaseId: first.cetCaseId,
          decision,
          caseStateVersion: version,
        },
        colleague
      );
    const confirmed = await correction('confirmed', second.caseStateVersion);
    expect((await discover(second.cetCaseId, colleague)).relatedCases[0].confidence).toBe(1);
    await expect(correction('rejected', second.caseStateVersion)).rejects.toMatchObject({
      code: 409,
    });
    const rejected = await correction('rejected', confirmed.caseStateVersion);
    expect((await discover(second.cetCaseId, colleague)).relatedCases).toEqual([]);
    expect((await discover(first.cetCaseId)).relatedCases).toEqual([]);
    await correction('undo', rejected.caseStateVersion);
    expect((await discover(second.cetCaseId, colleague)).relatedCases[0].confidence).toBe(1);
    const entries = (await app.router.eventsDb.allDocs({ include_docs: true })).rows
      .map((row) => row.doc)
      .filter((row) => row.kind === 'corrected');
    expect(entries.map((row) => row.correction.decision).sort()).toEqual([
      'confirmed',
      'rejected',
      'undo',
    ]);
    const state = await app.router.loadCase(principal({ meta: colleague }), second.cetCaseId);
    expect(state.caseLinkCorrections).toHaveLength(3);
    expect(state.caseLinkCorrections.at(-1).undoOf).toBe(rejected.correctionId);
  });

  test('corrected identifiers remove obsolete automatic relationships', async () => {
    const first = await app.create(ids);
    const second = await app.create(ids);
    const next = await app.call('domain-router.continue', {
      cetCaseId: second.cetCaseId,
      userRequest: 'Correct reference',
      knownContext: { identifiers: [{ kind: 'reference-a', value: 'ANON-0002' }] },
    });
    expect(next.relatedCases).toEqual([]);
    expect((await discover(first.cetCaseId)).relatedCases).toEqual([]);
  });

  test('related summaries retain sensitivity when incorporated into a colleague case', async () => {
    app.policy('team');
    const clearedA = auth('actor-a', ['ROLE_ALPHA'], 'tenant-a', ['restricted']);
    const clearedB = auth('actor-b', ['ROLE_ALPHA'], 'tenant-a', ['restricted']);
    await app.create(ids, clearedA, { sensitivityFlags: ['restricted'] });
    const second = await app.create(ids, clearedB);
    expect(second.relatedCases).toHaveLength(1);
    await expect(
      app.call('workbench.cases.get', { caseId: second.cetCaseId }, colleague)
    ).rejects.toMatchObject({ code: 403 });
    expect((await search(colleague)).items).toEqual([]);
  });

  test('inbox task materialization, persisted task listing and assignment require content access', async () => {
    app.policy('team');
    const first = await app.create(ids, auth(), {
      asyncDelivery: { mode: 'poll', clientId: 'client-a' },
    });
    await app.call('domain-router.ingestUpdate', {
      cetCaseId: first.cetCaseId,
      kind: 'receipt_failed',
      version: 'anonymous-update',
      payloadRef: 'RAW-CONTENT-PAYLOAD',
    });
    const own = await app.call('workbench.inbox.tasks.list', {});
    expect(own.items.length).toBeGreaterThan(0);
    await app.workbench.store.saveInboxTask({ ...own.items[0], tenantId: 'tenant-a' });
    expect((await app.call('workbench.inbox.tasks.list', {}, colleague)).items).toEqual([]);
    expect(
      (await app.call('workbench.inbox.tasks.list', { caseId: first.cetCaseId }, colleague)).items
    ).toEqual([]);
    await expect(
      app.call('workbench.inbox.tasks.assign', { taskId: own.items[0].taskId }, colleague)
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      app.workbench.materializeInboxTask(principal({ meta: colleague }), own.items[0].taskId)
    ).rejects.toMatchObject({ code: 404 });
  });

  test('cases, rejected links, sensitivity and immutable correction entries survive broker restart', async () => {
    app.policy('team');
    const first = await app.create(ids);
    const second = await app.create(ids, colleague);
    const corrected = await app.call(
      'domain-router.cases.correctLink',
      {
        cetCaseId: second.cetCaseId,
        targetCaseId: first.cetCaseId,
        decision: 'rejected',
        caseStateVersion: second.caseStateVersion,
      },
      colleague
    );
    const { ServiceBroker } = require('moleculer');
    const Router = require('../services/domain-router.service');
    const settings = { ...app.router.settings };
    await app.broker.stop();
    const restarted = new ServiceBroker({ logger: false, transporter: null });
    restarted.createService({ ...Router, settings });
    try {
      await restarted.start();
      const discovered = await restarted.call(
        'domain-router.related-sessions.discover',
        { caseId: second.cetCaseId },
        { meta: colleague }
      );
      expect(discovered.relatedCases).toEqual([]);
      const audit = await restarted
        .getLocalService('domain-router')
        .eventsDb.get(`case-audit:${corrected.correctionId}`);
      expect(audit.correction.decision).toBe('rejected');
      await restarted.call(
        'domain-router.cases.correctLink',
        {
          cetCaseId: second.cetCaseId,
          decision: 'undo',
          caseStateVersion: corrected.caseStateVersion,
        },
        { meta: colleague }
      );
      expect(
        (
          await restarted.call(
            'domain-router.related-sessions.discover',
            { caseId: second.cetCaseId },
            { meta: colleague }
          )
        ).relatedCases
      ).toHaveLength(1);
    } finally {
      await restarted.stop();
    }
  });

  test('case-link undo yields to a subsequent function correction instead of undoing the older case link', async () => {
    const first = await app.create(ids);
    const second = await app.create(ids);
    await app.call('domain-router.cases.correctLink', {
      cetCaseId: second.cetCaseId,
      targetCaseId: first.cetCaseId,
      decision: 'rejected',
      caseStateVersion: second.caseStateVersion,
    });
    const envelope = {
      userRequest: 'rückgängig',
      channel: 'test',
      conversationId: 'mixed-corrections',
    };
    await app.workbench.store.linkConversation({
      tenantId: 'tenant-a',
      client: 'test',
      conversationId: envelope.conversationId,
      cetCaseId: second.cetCaseId,
    });
    const p = principal({ meta: auth() });
    const conversation = require('../src/workbench-conversation');
    await conversation.saveTurn(app.workbench.conversationsDb, p, envelope, {
      correctionFamily: 'function',
    });
    const result = await require('../src/workbench-case-linking').handleCaseLinkTurn(
      app.workbench,
      { broker: app.broker },
      p,
      envelope,
      auth()
    );
    expect(result).toBeNull();
    expect((await discover(second.cetCaseId)).relatedCases).toEqual([]);
    const state = await app.router.loadCase(p, second.cetCaseId);
    expect(state.caseLinkCorrections).toHaveLength(1);
  });

  test('identifier queries are generic for spaced/punctuated values and case-normalized type prefixes', async () => {
    app.policy('team');
    const first = await app.create([{ kind: 'reference-a', value: 'ANON REF.001' }]);
    expect((await search(colleague, 'Stand bei ANON REF.001?')).items[0].cetCaseId).toBe(
      first.cetCaseId
    );
    expect((await search(colleague, 'REFERENCE-A:ANON REF.001')).items).toHaveLength(1);
    expect((await search(colleague, 'reference-b:ANON REF.001')).items).toEqual([]);
    expect((await search(colleague, 'Stand bei ANON REF.001-extra')).items).toEqual([]);
    expect((await search(colleague, 'Stand bei ANON REF.001.')).items).toHaveLength(1);
    app.policy('team', { 'reference-a': { stripWhitespace: true } });
    await app.create([{ kind: 'reference-a', value: 'ANON-0002' }]);
    expect((await search(colleague, 'reference-a:ANON - 0002')).items).toHaveLength(1);
  });
});
