'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const llm = require('../src/llm-client');
const { auth, createCaseBroker } = require('./helpers/case-linking-broker');
const { strongIdentifiers, sameStrongSubject, statusLabel } = require('../src/case-continuation');
const { principal } = require('../src/domain-router-policy');
const ids = [
  { kind: 'reference-a', value: 'ANON-764' },
  { kind: 'reference-b', value: 'ANON-LOC-764' },
];

describe('Case continuation #764 with persisted router and workbench', () => {
  let app;
  const chat = (
    conversationId,
    userRequest = 'Bitte bearbeite ANON-764 und ANON-LOC-764.',
    meta = auth()
  ) =>
    app.call(
      'workbench.chat',
      { channel: 'api', conversationId, userRequest, asyncDelivery: { mode: 'none' } },
      meta
    );
  const candidates = (identifiers = ids, meta = auth()) =>
    app.call('domain-router.cases.continuationCandidates', { identifiers }, meta);
  beforeEach(async () => {
    app = await createCaseBroker();
    llm.generateStructured.mockResolvedValue({
      concern: 'Synthetischen Vorgang bearbeiten.',
      situation: 'Neue synthetische Angaben zum Vorgang.',
      participants: [],
      identifiers: ids,
      deadlines: [],
      hypotheses: [],
      missingInformation: [],
      requestedAction: {
        description: 'Unterlagen prüfen.',
        externalEffect: false,
        draftRequested: false,
      },
      turnKind: 'work',
      retrievalTerms: [],
    });
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        expectation: [
          {
            text: 'Prüfe die neuen Angaben.',
            supported: 'model',
            evidenceIds: [],
            completedAction: false,
            specific: false,
          },
        ],
        nextSteps: [],
        draft: [],
      })
    );
    await app.broker.start();
  });
  afterEach(async () => {
    await app.cleanup();
  });

  test('AC01/03/04: fresh chat continues own case, contributes material, binds chat and names case once over three turns', async () => {
    const first = await chat('first');
    const second = await chat('second');
    expect(second.cetCaseId).toBe(first.cetCaseId);
    expect(second.responseText).toMatch(/^Das gehört zu F-\d+ \(/u);
    expect(second.responseText.match(/F-\d+/gu)).toHaveLength(1);
    const third = await chat('second', 'Bitte prüfe auch die neuen Unterlagen.');
    const fourth = await chat('second', 'Was fehlt noch?');
    for (const turn of [second, third, fourth])
      expect(turn.responseText).not.toMatch(/evidence_required|human_review_required/u);
    for (const turn of [third, fourth])
      expect(turn.responseText).not.toMatch(/Das gehört zu|Zu diesen Kennungen|zusammenführen/u);
    const conversation = await app.workbench.store.resolveConversation({
      tenantId: 'tenant-a',
      client: 'api',
      conversationId: 'second',
    });
    expect(conversation.cetCaseId).toBe(first.cetCaseId);
    expect((await candidates()).items).toHaveLength(1);
    const events = (await app.router.eventsDb.allDocs({ include_docs: true })).rows.map(
      ({ doc }) => doc
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'contributed',
          cetCaseId: first.cetCaseId,
          conversationId: 'second',
          material: 'Bitte bearbeite ANON-764 und ANON-LOC-764.',
        }),
      ])
    );
    const state = await app.router.loadCase(principal({ meta: auth() }), first.cetCaseId);
    expect(state.knownContext.situation.identifiers).toEqual(ids);
  });

  test('AC02/06: multiple candidates ask once, selection continues; duplicate proposal once; explicit merge retains source and audit', async () => {
    const first = await app.create(ids);
    const second = await app.create(ids);
    const prompt = await chat('choose');
    expect(prompt.state).toBe('case_selection');
    expect(prompt.responseText.match(/\?/gu)).toHaveLength(1);
    expect((await candidates()).items).toHaveLength(2);
    const invalid = await chat('choose', 'unbekannt');
    expect(invalid.responseText).not.toContain('Kurzbeschreibung');
    expect(invalid.responseText).not.toContain('ANON');
    const ref = await app.workbench.store.caseDisplayRef({
      tenantId: 'tenant-a',
      caseId: first.cetCaseId,
    });
    const selected = await chat('choose', ref);
    expect(selected.cetCaseId).toBe(first.cetCaseId);
    expect(selected.responseText).toContain('Weitere offene Fälle');
    expect((await candidates()).items).toHaveLength(2);
    const follow = await chat('choose', 'Bitte weiter prüfen.');
    expect(follow.responseText).not.toContain('Weitere offene Fälle');
    const merged = await chat('choose', 'Fälle zusammenführen');
    expect(merged.merged).toEqual([second.cetCaseId]);
    const state = await app.router.loadCase(principal({ meta: auth() }), first.cetCaseId);
    expect(state.mergedCases[0].snapshot.initialRequest).toContain('RAW-CONTENT-PRIVATE');
    expect((await candidates()).items.map((item) => item.cetCaseId)).toEqual([first.cetCaseId]);
    const events = (await app.router.eventsDb.allDocs({ include_docs: true })).rows.map(
      ({ doc }) => doc
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'corrected', correction: { decision: 'merge_confirmed' } }),
      ])
    );
    await expect(
      app.call('domain-router.cases.mergeConfirmed', {
        cetCaseId: first.cetCaseId,
        sourceCaseIds: [second.cetCaseId],
        confirmed: false,
      })
    ).rejects.toMatchObject({ code: 403 });
  });

  test('AC02: explicit new creates exactly one independent case from the offered material', async () => {
    const first = await app.create(ids);
    await app.create(ids);
    await chat('new');
    const result = await chat('new', 'neu');
    expect(result.cetCaseId).not.toBe(first.cetCaseId);
    expect((await candidates()).items).toHaveLength(3);
    expect(result.responseText).not.toContain('Das gehört zu');
    expect(
      (await app.router.loadCase(principal({ meta: auth() }), result.cetCaseId)).knownContext
        .situation.identifiers
    ).toEqual(ids);
  });

  test('AC05: weak features, generic snippets and response codes never create subject links or candidates', async () => {
    const weak = [
      { kind: 'ort', value: 'Exampleville' },
      { kind: 'plz', value: '00000' },
      { kind: 'name', value: 'Person Example' },
      { kind: 'rejection_reason', value: 'X00' },
      { kind: 'reference', value: '12' },
    ];
    expect(strongIdentifiers(weak)).toEqual([]);
    await app.create(weak);
    const second = await app.create(weak);
    expect(second.relatedCases).toEqual([]);
    expect((await candidates(weak)).items).toEqual([]);
    expect(strongIdentifiers(ids, { 'reference-a': { strength: 'weak' } })).toEqual([ids[1]]);
    expect(sameStrongSubject(ids, [{ ...ids[0], value: 'OTHER' }, ids[1]])).toBe(false);
    expect(statusLabel('internal_unknown_enum')).toBe('Bearbeitungsstand noch offen');
  });

  test('AC07: foreign tenant is invisible; teams, legacy settings and clearance do not divide tenant cases', async () => {
    app.policy('team');
    await app.create(ids);
    expect((await candidates(ids, auth('actor-b'))).items).toHaveLength(1);
    expect(
      (await candidates(ids, auth('actor-b', ['ROLE_ALPHA', 'ROLE_BETA']))).items
    ).toHaveLength(1);
    expect((await candidates(ids, auth('actor-b', ['ROLE_ALPHA'], 'tenant-b'))).items).toEqual([]);
    app.policy('own');
    expect((await candidates(ids, auth('actor-b'))).items).toHaveLength(1);
    app.policy('team');
    const privateCase = await app.create(
      [{ kind: 'reference-a', value: 'SECRET-764' }],
      auth('actor-a', ['ROLE_ALPHA'], 'tenant-a', ['sensitive']),
      { sensitivityFlags: ['sensitive'] }
    );
    expect(privateCase.cetCaseId).toBeTruthy();
    expect(
      (await candidates([{ kind: 'reference-a', value: 'SECRET-764' }], auth('actor-b'))).items
    ).toHaveLength(1);
  });

  test('closed cases cannot be continued; concurrent fresh chats from different tenant actors create one case', async () => {
    const old = await app.create(ids);
    const state = await app.router.loadCase(principal({ meta: auth() }), old.cetCaseId);
    state.disposition = 'closed';
    await app.router.saveState(principal({ meta: auth() }), state);
    expect((await candidates()).items).toEqual([]);
    const [first, second] = await Promise.all([
      chat('parallel-a'),
      chat('parallel-b', undefined, auth('actor-b', ['ROLE_OTHER'])),
    ]);
    expect(first.cetCaseId).toBe(second.cetCaseId);
    expect(first.cetCaseId).not.toBe(old.cetCaseId);
  });

  test('AC02: selection shows at most three candidates newest first and does not ask again on invalid input', async () => {
    const records = [];
    for (let i = 0; i < 4; i++) records.push(await app.create(ids));
    for (const [index, record] of records.entries()) {
      const state = await app.router.loadCase(principal({ meta: auth() }), record.cetCaseId);
      state.updatedAt = `2026-01-0${index + 1}T00:00:00.000Z`;
      await app.router.saveState(principal({ meta: auth() }), state);
    }
    const prompt = await chat('limited');
    const turn = await require('../src/workbench-conversation').readTurn(
      app.workbench.conversationsDb,
      principal({ meta: auth() }),
      { channel: 'api', conversationId: 'limited' }
    );
    expect(turn.caseSelection.items.map((item) => item.cetCaseId)).toEqual(
      records
        .slice(1)
        .reverse()
        .map((item) => item.cetCaseId)
    );
    expect(prompt.responseText.match(/F-\d+/gu)).toHaveLength(3);
    const invalid = await chat('limited', '4');
    expect(invalid.responseText).not.toContain('?');
    const result = await chat('limited', '1');
    expect(result.cetCaseId).toBe(records[3].cetCaseId);
  });

  test('tenant-wide continuation preserves the creator and material author across people, roles and legacy flags', async () => {
    const first = await app.create(ids);
    const p = principal({ meta: auth() });
    const legacy = await app.router.loadCase(p, first.cetCaseId);
    delete legacy.caseVisibility;
    await app.router.db.put(legacy);
    const other = auth('actor-b', ['ROLE_OTHER']);
    const result = await chat('colleague', undefined, other);
    expect(result.cetCaseId).toBe(first.cetCaseId);
    expect(result.responseText).toContain('angelegt von actor-a');
    expect((await app.router.loadCase(principal({ meta: other }), first.cetCaseId)).actorId).toBe(
      'actor-a'
    );
    const events = (await app.router.eventsDb.allDocs({ include_docs: true })).rows.map(
      ({ doc }) => doc
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'contributed',
          actorId: 'actor-b',
          cetCaseId: first.cetCaseId,
        }),
      ])
    );
  });

  test('AC03: expiring turn memory does not repeat an assignment notice', async () => {
    await chat('ttl-first');
    const assigned = await chat('ttl-second');
    const assistance = require('../src/workbench-conversation');
    const p = principal({ meta: auth() });
    const envelope = { channel: 'api', conversationId: 'ttl-second' };
    const pending = await assistance.readTurn(app.workbench.conversationsDb, p, envelope);
    await app.workbench.conversationsDb.put({ ...pending, expiresAt: 1 });
    const follow = await chat('ttl-second');
    expect(follow.cetCaseId).toBe(assigned.cetCaseId);
    expect(follow.responseText).not.toContain('Das gehört zu');
  });

  test('failed audit prevents foreign candidate disclosure and failed merge audit prevents mutation', async () => {
    app.policy('team');
    const first = await app.create(ids);
    const second = await app.create(ids);
    const audit = jest
      .spyOn(app.router, 'auditCaseAccess')
      .mockRejectedValue(new Error('Synthetic audit unavailable'));
    await expect(candidates(ids, auth('actor-b'))).rejects.toThrow('Synthetic audit unavailable');
    await expect(
      app.call('domain-router.cases.mergeConfirmed', {
        cetCaseId: first.cetCaseId,
        sourceCaseIds: [second.cetCaseId],
        confirmed: true,
      })
    ).rejects.toThrow('Synthetic audit unavailable');
    audit.mockRestore();
    expect((await candidates()).items).toHaveLength(2);
    expect(
      (await app.router.loadCase(principal({ meta: auth() }), first.cetCaseId)).mergedCases
    ).toBeUndefined();
  });

  test('one shared strong identifier is insufficient when the process reference differs', async () => {
    await app.create(ids);
    expect((await candidates([{ ...ids[0], value: 'OTHER-PROCESS' }, ids[1]])).items).toEqual([]);
    expect((await candidates([{ kind: 'other-type', value: ids[0].value }])).items).toEqual([]);
  });

  test('continuation preserves the case delivery client across a fresh conversation', async () => {
    const first = await app.create(ids, auth(), {
      asyncDelivery: { mode: 'poll', clientId: 'original-client', supportedEventTypes: [] },
    });
    const result = await chat('delivery');
    expect(result.cetCaseId).toBe(first.cetCaseId);
    expect(
      (await app.router.loadCase(principal({ meta: auth() }), first.cetCaseId)).asyncDelivery
        .clientId
    ).toBe('original-client');
  });

  test('tenant colleagues can explicitly merge duplicates created by different people; closed cases remain excluded', async () => {
    const first = await app.create(ids);
    const second = await app.create(ids, auth('actor-b', ['ROLE_OTHER']));
    const result = await app.call(
      'domain-router.cases.mergeConfirmed',
      { cetCaseId: first.cetCaseId, sourceCaseIds: [second.cetCaseId], confirmed: true },
      auth('actor-c', ['ROLE_ANOTHER'])
    );
    expect(result.merged).toEqual([second.cetCaseId]);
    const p = principal({ meta: auth() });
    const state = await app.router.loadCase(p, first.cetCaseId);
    state.lastClassification.readinessState = 'completed';
    await app.router.saveState(p, state);
    expect((await candidates()).items).toEqual([]);
    await expect(
      app.call(
        'domain-router.cases.mergeConfirmed',
        { cetCaseId: first.cetCaseId, sourceCaseIds: [second.cetCaseId], confirmed: true },
        auth('actor-d', ['ROLE_ALPHA'], 'tenant-b')
      )
    ).rejects.toBeDefined();
  });

  test('AC04: enum text in generated answer or case descriptions uses the central readable mapping', async () => {
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        expectation: [
          {
            text: 'Der Stand ist evidence_required und human_review_required.',
            supported: 'model',
            evidenceIds: [],
            completedAction: false,
            specific: false,
          },
        ],
        nextSteps: [],
        draft: [],
      })
    );
    const first = await chat('enums-a');
    const p = principal({ meta: auth() });
    const state = await app.router.loadCase(p, first.cetCaseId);
    state.knownContext.situation.situation = 'Status evidence_required';
    await app.router.saveState(p, state);
    const second = await chat('enums-b');
    expect(second.responseText).not.toMatch(/evidence_required|human_review_required/u);
    expect(second.responseText).toContain('Belege fehlen');
  });

  test('case evidence is tenant-wide even with sensitivity labels, while cross-tenant evidence remains hidden', async () => {
    const { canViewEvidence, safeEvidenceRef } = require('../src/workbench-evidence');
    const evidence = {
      tenantId: 'tenant-a',
      evidenceId: 'synthetic-evidence',
      caseId: 'synthetic-case',
      sensitivityLevel: 'restricted',
      label: 'Synthetischer Beleg',
      status: 'attached',
    };
    expect(canViewEvidence(evidence, [], 'tenant-a')).toBe(true);
    expect(canViewEvidence(evidence, ['restricted'], 'tenant-b')).toBe(false);
    expect(safeEvidenceRef(evidence, { tenantId: 'tenant-a' }).label).toBe('Synthetischer Beleg');
    expect(
      safeEvidenceRef(evidence, { tenantId: 'tenant-b', clearance: ['restricted'] }).redacted
    ).toBe(true);
  });
});
