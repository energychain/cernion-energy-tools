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
