'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const { dedupKey, classify, merge } = require('../src/failure-cases');
// Level proposals only; level C cases also pass the anonymization gate (own tests).
const levelCalls = () =>
  llm.generateStructured.mock.calls.filter(
    (call) => JSON.parse(call[1]).task === 'failure_case_level'
  );

describe('failure cases (#1010 step 2)', () => {
  test('the key bundles by kind, functions, sources and reason, in any order', () => {
    const a = {
      kind: 'source_timeout',
      functionIds: ['fn-b', 'fn-a'],
      sources: [{ source: 'capability-read', name: 'Werkzeug A' }],
    };
    const b = { ...a, functionIds: ['fn-a', 'fn-b'] };
    expect(dedupKey(a)).toBe(dedupKey(b));
    expect(dedupKey(a)).not.toBe(dedupKey({ ...a, sources: [{ source: 'other' }] }));
    expect(dedupKey(a)).not.toBe(dedupKey({ ...a, kind: 'unanswered' }));
  });

  test('the classifier sees only structured case data and falls back to the prior level', async () => {
    const doc = merge(
      { kind: 'user_correction', createdAt: '2026-10-29T00:00:00.000Z' },
      {
        signalId: 's1',
        kind: 'user_correction',
        functionIds: ['fn-a'],
        sources: [{ source: 'coverage' }],
        reason: 'reject',
        conversationId: 'chat-1',
        turnRef: 't1',
        at: '2026-10-29T00:00:00.000Z',
      }
    );
    llm.generateStructured.mockResolvedValueOnce({
      level: 'B',
      levelReason: 'Teamgedächtnis ergänzen',
      summary: 'Funktion falsch zugeordnet',
      hypothesis: 'Begriff des Hauses unbekannt',
      expected: 'richtige Zuordnung',
    });
    expect(
      await classify(doc, { tenantId: 'synthetic-a', functionLabels: { 'fn-a': 'A' } })
    ).toEqual({
      level: 'B',
      levelReason: 'Teamgedächtnis ergänzen',
      summary: 'Funktion falsch zugeordnet',
      hypothesis: 'Begriff des Hauses unbekannt',
      expected: 'richtige Zuordnung',
      classifiedBy: 'model',
    });
    const prompt = JSON.parse(llm.generateStructured.mock.calls.at(-1)[1]);
    expect(prompt.failureCase).toEqual({
      kind: 'user_correction',
      count: 1,
      reasons: ['reject'],
      functions: [{ id: 'fn-a', label: 'A' }],
      sources: [{ source: 'coverage' }],
      firstAt: '2026-10-29T00:00:00.000Z',
      lastAt: '2026-10-29T00:00:00.000Z',
    });
    // No conversation reference reaches the prompt.
    expect(JSON.stringify(prompt)).not.toContain('chat-1');
    llm.generateStructured.mockResolvedValueOnce({ level: 'X' });
    expect(await classify(doc, { tenantId: 'synthetic-a' })).toMatchObject({
      level: 'B',
      classifiedBy: 'prior',
      // Readable for chat; reason codes stay out of the summary.
      summary: 'Korrektur durch eine Person (1×)',
    });
  });
});

describe('failure case register', () => {
  let broker, dir, changes;
  const meta = (roles = ['ROLE_TENANT_ADMIN'], tenantId = 'synthetic-a') => ({
    authUser: { tenantId, userId: 'person-a', roles },
  });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-cases-'));
    changes = [];
    llm.generateStructured.mockReset();
    llm.generateStructured.mockResolvedValue({
      level: 'C',
      levelReason: 'Evidenzquelle im Katalog anpassen',
      summary: 'Eine Quelle antwortet regelmäßig zu spät',
      hypothesis: 'Zeitlimit der Quelle zu knapp',
      expected: 'Antwort mit Beleg ohne Zeitüberschreitung',
    });
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/failure-signals.service');
    broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
    broker.createService({
      name: 'listener',
      events: {
        'self-improvement.case.changed.v1'(ctx) {
          changes.push(ctx.params);
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const service = () => broker.getLocalService('failure-signals');
  const timeout = (tenantId = 'synthetic-a', conversationId = 'chat-1') =>
    service().record({
      tenantId,
      kind: 'source_timeout',
      conversationId,
      turnRef: 't',
      functionIds: ['fn-a'],
      sources: [{ source: 'capability-read', name: 'Werkzeug A' }],
    });
  const casesOf = (roles) => broker.call('failure-signals.cases', {}, { meta: meta(roles) });

  test('similar signals become one case at the threshold, classified with a level', async () => {
    await timeout();
    await timeout();
    expect(await casesOf()).toEqual([]);
    await timeout(undefined, 'chat-2');
    await timeout(undefined, 'chat-3');
    await service().idle();
    const [item] = await casesOf();
    expect(item).toMatchObject({
      kind: 'source_timeout',
      count: 4,
      status: 'open',
      level: 'C',
      classifiedBy: 'model',
      summary: 'Eine Quelle antwortet regelmäßig zu spät',
      // Fail closed: without a usable synthetic draft nothing may leave the tenant.
      anonymization: { state: 'failed' },
      reproduction: {
        expected: 'Antwort mit Beleg ohne Zeitüberschreitung',
        steps: expect.arrayContaining([expect.objectContaining({ conversationId: 'chat-3' })]),
      },
    });
    expect(item.signals).toHaveLength(4);
    expect(levelCalls()).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(changes.map((change) => change.classifiedBy || 'opened').slice(0, 2)).toEqual([
      'opened',
      'model',
    ]);
    // The mocked model returns no synthetic draft: the gate fails closed.
    expect(changes.at(-1).anonymization.state).toBe('failed');
  });

  test('a severe signal opens a case at once; a closed case that fails again is reopened', async () => {
    await service().record({
      tenantId: 'synthetic-a',
      kind: 'user_correction',
      functionIds: ['fn-a'],
      sources: [{ source: 'coverage' }],
      reason: 'reject',
    });
    await service().idle();
    const [opened] = await casesOf();
    expect(opened.status).toBe('open');
    await broker.call('failure-signals.setCaseStatus', {
      tenantId: 'synthetic-a',
      caseId: opened.caseId,
      status: 'resolved_runtime',
      refs: { skillId: 'skill-1', x: 'y' },
    });
    let [item] = await casesOf();
    expect(item).toMatchObject({ status: 'resolved_runtime', refs: { skillId: 'skill-1' } });
    expect(item.refs.x).toBeUndefined();
    await service().record({
      tenantId: 'synthetic-a',
      kind: 'user_correction',
      functionIds: ['fn-a'],
      sources: [{ source: 'coverage' }],
      reason: 'reject',
    });
    await service().idle();
    [item] = await casesOf();
    expect(item).toMatchObject({ caseId: opened.caseId, status: 'open', count: 2 });
    expect(item.reopenedAt).toBeTruthy();
  });

  test('cases stay in their tenant; the summary counts them for every role, the list needs admin', async () => {
    for (let i = 0; i < 3; i++) await timeout('synthetic-a');
    for (let i = 0; i < 3; i++) await timeout('synthetic-b');
    await service().idle();
    expect(await casesOf()).toHaveLength(1);
    await expect(casesOf(['ROLE_EDM'])).rejects.toThrow();
    const summary = await broker.call('failure-signals.summary', {}, { meta: meta(['ROLE_EDM']) });
    expect(summary.cases).toMatchObject({ total: 1, byLevel: { C: 1 }, byStatus: { open: 1 } });
    // The classifier call stayed per tenant.
    expect(levelCalls()).toHaveLength(2);
  });

  test('the classification budget per tenant and day falls back to the prior level', async () => {
    const register = service();
    register.classifyBudget.set(
      `synthetic-a\u0000${new Date().toISOString().slice(0, 10)}`,
      Number.MAX_SAFE_INTEGER
    );
    for (let i = 0; i < 3; i++) await timeout();
    await register.idle();
    const [item] = await casesOf();
    expect(item).toMatchObject({ level: 'C', status: 'open' });
    expect(item.classifiedBy).toBeUndefined();
    expect(levelCalls()).toHaveLength(0);
  });

  test('quiet open cases become stale', async () => {
    await service().record({
      tenantId: 'synthetic-a',
      kind: 'skill_degraded',
      sources: [{ source: 'projectSkill' }],
    });
    await service().idle();
    const docs = await service().db.allDocs({ include_docs: true });
    const bundle = docs.rows.map((row) => row.doc).find((doc) => doc.type === 'failure_case');
    await service().db.put({ ...bundle, lastSignalAt: '2000-01-01T00:00:00.000Z' });
    await service().prune();
    const [item] = await casesOf();
    expect(item.status).toBe('stale');
  });
});

describe('selected case (#1039)', () => {
  const { selectedCase } = require('../src/failure-cases');
  // Everything a selected-case view must never echo.
  const SECRETS = [
    'chat-secret',
    'turn-secret',
    'Kunde Müller GmbH',
    'project-secret',
    'Hypothese intern',
    'Zusammenfassung intern',
    'SYN-Entwurf',
    'Frage intern',
    'signal-secret',
  ];
  const fixture = (overrides = {}) => ({
    _id: 'case:synthetic-a:key',
    _rev: '1-a',
    type: 'failure_case',
    tenantId: 'synthetic-a',
    caseId: 'case-1',
    status: 'open',
    kind: 'source_timeout',
    count: 3,
    signals: ['signal-secret'],
    functionIds: ['fn-a'],
    sources: [{ source: 'capability-read', name: 'Kunde Müller GmbH', ref: 'project-secret' }],
    reasons: ['timeout'],
    steps: [{ conversationId: 'chat-secret', turnRef: 'turn-secret', at: '2026-10-30T10:00:00Z' }],
    level: 'C',
    levelReason: 'Evidenzquelle im Katalog anpassen',
    summary: 'Zusammenfassung intern',
    hypothesis: 'Hypothese intern',
    classifiedBy: 'model',
    classifiedAt: '2026-10-30T10:01:00.000Z',
    reproduction: {
      steps: [{ conversationId: 'chat-secret' }],
      observed: 'x',
      expected: 'Antwort',
    },
    anonymization: { state: 'pending', checks: [] },
    refs: {},
    openedAt: '2026-10-30T10:00:00.000Z',
    lastSignalAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  });
  const scalar = (group) =>
    Object.values(group).every((value) => ['string', 'number'].includes(typeof value));

  test('an open case: scalar groups, model provenance, no runtime evidence, nothing raw', () => {
    const view = selectedCase(fixture(), { functionLabels: { 'fn-a': 'Funktion A' } });
    expect(Object.keys(view).sort()).toEqual(
      ['effectClass', 'observation', 'readiness', 'runtime', 'safetyClass'].sort()
    );
    expect(view).toMatchObject({
      safetyClass: 'protected_read_only_failure_case_inspection',
      effectClass: 'none',
      observation: {
        caseId: 'case-1',
        status: 'open',
        kind: 'source_timeout',
        signalCount: 3,
        functionLabels: 'Funktion A',
        sourceLabels: 'capability-read',
        proposedLevel: 'C',
        levelReason: 'Evidenzquelle im Katalog anpassen',
        classificationState: 'model_proposed',
        classificationProvenance: 'structured_case_data_model_proposal',
        classifiedAt: '2026-10-30T10:01:00.000Z',
      },
      runtime: {
        evidence: 'evidence_unavailable',
        runtimeAction: 'not_run',
        runtimeAttemptCount: 0,
        replayKind: 'not_run',
        replayResult: 'evidence_unavailable',
      },
      readiness: {
        reproductionState: 'reproducible_with_expectation',
        reproductionStepCount: 1,
        missingEvidence: 'runtime_evidence, anonymization_gate',
        anonymizationState: 'pending',
        nextReviewGate: 'tenant_admin_anonymization_review',
      },
    });
    for (const group of [view.observation, view.runtime, view.readiness])
      expect(scalar(group)).toBe(true);
    expect(view.readiness.positiveFollowUp).toBeTruthy();
    expect(view.readiness.scopeCaveat).toMatch(/keine globale Produktbehebung/);
    const text = JSON.stringify(view);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    for (const field of [
      'signals',
      'steps',
      'publication',
      'tenantId',
      'conversationId',
      'turnRef',
    ])
      expect(text).not.toContain(`"${field}"`);
    expect(JSON.stringify(view.runtime)).not.toMatch(/failed/);
  });

  test('prior fallback and unavailable classification are told apart', () => {
    expect(selectedCase(fixture({ classifiedBy: 'prior' })).observation).toMatchObject({
      classificationState: 'prior_fallback',
      classificationProvenance: 'signal_kind_prior',
    });
    const pending = selectedCase(fixture({ classifiedBy: undefined, classifiedAt: undefined }));
    expect(pending.observation).toMatchObject({
      classificationState: 'classification_unavailable',
      classificationProvenance: 'signal_kind_prior_pending',
    });
    expect(pending.observation.classifiedAt).toBeUndefined();
    expect(pending.readiness.missingEvidence).toContain('model_classification');
  });

  test('stale cases and level-B runtime evidence carry their own gate and caveat', () => {
    const stale = selectedCase(fixture({ status: 'stale' }));
    expect(stale.readiness.nextReviewGate).toBe('tenant_admin_stale_review');
    const resolved = selectedCase(
      fixture({
        status: 'resolved_runtime',
        level: 'B',
        kind: 'user_correction',
        runtime: {
          level: 'B',
          action: 'tenant_data_replay',
          attempts: 2,
          replay: {
            kind: 'shadow_replay',
            passed: true,
            answered: true,
            at: '2026-10-31T09:00:00.000Z',
            question: 'Frage intern',
            answer: 'Frage intern',
          },
        },
      })
    );
    expect(resolved.runtime).toEqual({
      evidence: 'recorded_tenant_runtime_evidence',
      runtimeLevel: 'B',
      runtimeAction: 'tenant_data_replay',
      runtimeAttemptCount: 2,
      replayKind: 'shadow_replay',
      replayResult: 'passed',
      replayAt: '2026-10-31T09:00:00.000Z',
      scopeCaveat: expect.stringMatching(/keine Veröffentlichungsreife/),
    });
    expect(resolved.readiness).toMatchObject({
      anonymizationState: 'not_applicable',
      nextReviewGate: 'tenant_admin_runtime_evidence_review',
    });
    const retry = selectedCase(
      fixture({
        level: 'B',
        runtime: { level: 'B', attempts: 1, replay: { kind: 'shadow_replay', passed: false } },
      })
    );
    expect(retry.runtime).toMatchObject({ replayResult: 'not_passed', runtimeAttemptCount: 1 });
    expect(retry.runtime.scopeCaveat).toBeUndefined();
  });

  test('a passed gate shows bounded check labels only, never the draft', () => {
    const view = selectedCase(
      fixture({
        anonymization: {
          state: 'passed',
          checks: [
            { kind: 'scanner', passed: true, findings: [{ kind: 'email', value: 'chat-secret' }] },
            { kind: 'model', passed: true },
          ],
          reviewedAt: '2026-10-30T11:00:00.000Z',
        },
        publication: { title: 'SYN-Entwurf' },
      })
    );
    expect(view.readiness).toMatchObject({
      anonymizationState: 'passed',
      anonymizationChecks: 'scanner:passed, model:passed',
      anonymizationReviewedAt: '2026-10-30T11:00:00.000Z',
      anonymizationCaveat: expect.stringMatching(/keine Behebung, Freigabe, Veröffentlichung/),
      nextReviewGate: 'tenant_admin_egress_review',
    });
    expect(view.readiness.missingEvidence).not.toContain('anonymization_gate');
    const failed = selectedCase(fixture({ anonymization: { state: 'failed', checks: [] } }));
    expect(failed.readiness).toMatchObject({
      anonymizationState: 'failed',
      nextReviewGate: 'tenant_admin_anonymization_review',
    });
    const text = JSON.stringify(view);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  describe('action failure-signals.case', () => {
    let broker, dir, invoked, emitted;
    const meta = (roles = ['ROLE_TENANT_ADMIN'], tenantId = 'synthetic-a') => ({
      authUser: { tenantId, userId: 'person-a', roles },
    });
    const read = (params, m = meta()) => broker.call('failure-signals.case', params, { meta: m });
    const service = () => broker.getLocalService('failure-signals');
    const snapshot = async () =>
      (await service().db.allDocs({ include_docs: true })).rows.map((row) => row.doc);

    beforeEach(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-case-read-'));
      invoked = [];
      emitted = [];
      llm.generateStructured.mockReset();
      broker = new ServiceBroker({
        logger: false,
        middlewares: [
          {
            localAction(handler, action) {
              return (ctx) => {
                invoked.push(action.name);
                return handler(ctx);
              };
            },
            emit(next) {
              return (event, ...args) => {
                emitted.push(event);
                return next(event, ...args);
              };
            },
          },
        ],
      });
      const schema = require('../services/failure-signals.service');
      broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
      await broker.start();
      const { _rev, ...doc } = fixture();
      await service().db.put(doc);
      await service().db.put({
        ...fixture({ tenantId: 'synthetic-b', caseId: 'case-b' }),
        _id: 'case:synthetic-b:key',
        _rev: undefined,
      });
      await service().db.put({
        _id: 'replay:case:synthetic-a:key',
        type: 'failure_replay_question',
        tenantId: 'synthetic-a',
        question: 'Frage intern',
        at: '2026-10-30T10:00:00Z',
      });
      invoked.length = 0;
      emitted.length = 0;
    });
    afterEach(async () => {
      await broker.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('repeated reads are identical and write, emit, classify, replay or gate nothing', async () => {
      const register = service();
      const before = await snapshot();
      const budgets = () =>
        [register.classifyBudget, register.replayBudget, register.anonymizeBudget].map((m) => [
          ...m,
        ]);
      const budgetsBefore = budgets();
      const spies = [
        'classifyCase',
        'anonymizeCase',
        'dataArrived',
        'resolveSkillCases',
        'journalResolution',
        'caseChanged',
        'takeBudget',
        'rememberQuestion',
        'forgetQuestion',
        'record',
        'bundle',
      ].map((name) => jest.spyOn(register, name));
      const writes = ['put', 'bulkDocs', 'remove'].map((name) => jest.spyOn(register.db, name));
      const first = await read({ caseId: 'case-1' });
      const second = await read({ caseId: 'case-1' });
      expect(second).toEqual(first);
      expect(first.observation).toMatchObject({ caseId: 'case-1', status: 'open' });
      for (const spy of [...spies, ...writes]) expect(spy).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
      expect(budgets()).toEqual(budgetsBefore);
      expect(llm.generateStructured).not.toHaveBeenCalled();
      expect(invoked).toEqual(['failure-signals.case', 'failure-signals.case']);
      expect(emitted).toEqual([]);
      const text = JSON.stringify(first);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    });

    test('unknown and foreign cases are denied alike; roles and tenant come from the principal', async () => {
      const denial = async (promise) => {
        const error = await promise.catch((caught) => caught);
        expect(error).toBeInstanceOf(Error);
        return [error.code, error.message];
      };
      const unknown = await denial(read({ caseId: 'case-none' }));
      const foreign = await denial(read({ caseId: 'case-b' }));
      expect(foreign).toEqual(unknown);
      expect(unknown).toEqual([403, 'Failure case not available']);
      // The foreign tenant's own admin sees its case, never the other one.
      expect(
        (await read({ caseId: 'case-b' }, meta(undefined, 'synthetic-b'))).observation.caseId
      ).toBe('case-b');
      await expect(read({ caseId: 'case-1' }, meta(undefined, 'synthetic-b'))).rejects.toThrow(
        'Failure case not available'
      );
      await expect(read({ caseId: 'case-1' }, meta(['ROLE_EDM']))).rejects.toThrow(
        'Admin role required'
      );
      await expect(
        read({ caseId: 'case-1', roles: ['ROLE_TENANT_ADMIN'] }, meta(['ROLE_EDM']))
      ).rejects.toThrow('Admin role required');
      await expect(read({ caseId: 'case-1' }, {})).rejects.toThrow('Authenticated tenant required');
      await expect(
        read({ caseId: 'case-1', tenantId: 'synthetic-a' }, meta(undefined, 'synthetic-b'))
      ).rejects.toThrow('Tenant mismatch');
      await expect(read({})).rejects.toThrow();
      expect(emitted).toEqual([]);
    });
  });
});
