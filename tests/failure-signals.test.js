'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { turnOutcome, afterTurn } = require('../src/failure-signals');

describe('turn outcome (#1010 step 1)', () => {
  test('fallback answers, degraded phases and timeouts are read from status fields only', () => {
    expect(
      turnOutcome({
        answerStatus: 'fallback',
        metadata: { fallbackReason: 'understanding_unavailable' },
        retrievalTrace: [
          { source: 'capability-read', name: 'Werkzeug A', status: 'timeout' },
          { source: 'capability-read', name: 'Werkzeug A', status: 'timeout' },
          { source: 'tenant-memory', status: 'ok' },
        ],
        requiredClarifications: ['Welche Frist?', 'Was gilt für „X“?'],
        contextQuestion: true,
        situation: {
          hypotheses: [
            { kind: 'function', id: 'fn-a', confidence: 0.7 },
            { kind: 'function', id: 'fn-b', confidence: 0.2 },
            { kind: 'domain', id: 'd', confidence: 0.9 },
          ],
        },
      })
    ).toEqual({
      unanswered: true,
      reason: 'understanding_unavailable',
      timeouts: [{ source: 'capability-read', name: 'Werkzeug A' }],
      openQuestions: 1,
      functionIds: ['fn-a'],
    });
  });

  test('operational outcomes and normal answers are no failure', () => {
    expect(
      turnOutcome({
        answerStatus: 'fallback',
        metadata: { fallbackReason: 'tenant_quota_exceeded' },
      }).unanswered
    ).toBe(false);
    expect(turnOutcome({ answerStatus: 'grounded', metadata: {} })).toMatchObject({
      unanswered: false,
      timeouts: [],
      openQuestions: 0,
    });
  });

  test('the hook never changes or delays the reply and skips nested queries', () => {
    const observeTurn = jest.fn(async () => []);
    const ctx = {
      id: 'req-1',
      params: { conversationId: 'chat-1' },
      meta: { authUser: { tenantId: 'synthetic-a' } },
      options: {},
      broker: { getLocalService: () => ({ observeTurn }), logger: { warn: jest.fn() } },
    };
    const result = { answerStatus: 'fallback', metadata: {} };
    expect(afterTurn(ctx, result)).toBe(result);
    expect(observeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'synthetic-a',
        conversationId: 'chat-1',
        turnRef: 'req-1',
      })
    );
    observeTurn.mockClear();
    afterTurn({ ...ctx, options: { parentCtx: { action: { name: 'workbench.chat' } } } }, result);
    expect(observeTurn).not.toHaveBeenCalled();
  });
});

describe('failure signal register', () => {
  let broker, dir, emitted;
  const meta = (roles = ['ROLE_TENANT_ADMIN'], tenantId = 'synthetic-a') => ({
    authUser: { tenantId, userId: 'person-a', roles },
  });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-signals-'));
    emitted = [];
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/failure-signals.service');
    broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
    broker.createService({
      name: 'listener',
      events: {
        'self-improvement.signal.v1'(ctx) {
          emitted.push(ctx.params);
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const outcome = (extra = {}) => ({
    unanswered: false,
    timeouts: [],
    openQuestions: 0,
    functionIds: ['fn-a'],
    ...extra,
  });
  const observe = (conversationId, extra, tenantId = 'synthetic-a') =>
    broker
      .getLocalService('failure-signals')
      .observeTurn({ tenantId, conversationId, turnRef: 't', outcome: outcome(extra) });

  test('repeated failures and clarification loops are signals only once their trail is long enough', async () => {
    expect(await observe('chat-1', { unanswered: true, reason: 'x' })).toHaveLength(1);
    const second = await observe('chat-1', { unanswered: true });
    expect(second.map((s) => s.kind)).toEqual(['unanswered', 'repeated_question']);
    // A good answer resets the trail.
    await observe('chat-1', {});
    expect((await observe('chat-1', { unanswered: true })).map((s) => s.kind)).toEqual([
      'unanswered',
    ]);
    expect(await observe('chat-2', { openQuestions: 1 })).toEqual([]);
    expect(await observe('chat-2', { openQuestions: 2 })).toEqual([]);
    expect((await observe('chat-2', { openQuestions: 1 })).map((s) => s.kind)).toEqual([
      'clarification_loop',
    ]);
    const timeouts = await observe('chat-3', { timeouts: [{ source: 'capability-read' }] });
    expect(timeouts[0]).toMatchObject({
      kind: 'source_timeout',
      sources: [{ source: 'capability-read' }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emitted.length).toBe(6);
    expect(emitted.every((signal) => signal.tenantId === 'synthetic-a')).toBe(true);
  });

  test('corrections and degraded skills become signals; attention preferences and undo do not', async () => {
    const correction = (params) => broker.emit('shared-service.correction.v1', params);
    await correction({
      tenantId: 'synthetic-a',
      target: 'coverage',
      ref: 'fn-a',
      correctionId: 'c1',
      correction: { kind: 'reject', functionId: 'fn-a' },
    });
    await correction({ tenantId: 'synthetic-a', target: 'agent', ref: 'a', correction: {} });
    await correction({ tenantId: 'synthetic-a', target: 'coverage', ref: 'undo-c1' });
    await broker.emit('project.skill.lifecycle.v1', {
      tenantId: 'synthetic-a',
      skillId: 'skill-1',
      lifecycle: 'degraded',
      reason: 'revalidation_failed',
    });
    await broker.emit('project.skill.lifecycle.v1', {
      tenantId: 'synthetic-a',
      skillId: 'skill-2',
      lifecycle: 'active',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const listed = await broker.call('failure-signals.list', {}, { meta: meta() });
    expect(listed.map((s) => [s.kind, s.reason])).toEqual(
      expect.arrayContaining([
        ['user_correction', 'reject'],
        ['skill_degraded', 'revalidation_failed'],
      ])
    );
    expect(listed).toHaveLength(2);
    expect(listed.find((s) => s.kind === 'user_correction')).toMatchObject({
      functionIds: ['fn-a'],
      origin: 'c1',
    });
  });

  test('signals stay inside their tenant and the list needs an admin role', async () => {
    await observe('chat-1', { unanswered: true }, 'synthetic-a');
    await observe('chat-1', { unanswered: true }, 'synthetic-b');
    expect(await broker.call('failure-signals.list', {}, { meta: meta() })).toHaveLength(1);
    await expect(
      broker.call('failure-signals.list', {}, { meta: meta(['ROLE_EDM']) })
    ).rejects.toThrow();
    expect(
      await broker.call('failure-signals.summary', {}, { meta: meta(['ROLE_EDM']) })
    ).toMatchObject({ total: 1, byKind: { unanswered: 1, user_correction: 0 } });
    // Signals carry no message text.
    const [signal] = await broker.call('failure-signals.list', {}, { meta: meta() });
    expect(Object.keys(signal).sort()).toEqual(
      [
        'at',
        'conversationId',
        'functionIds',
        'kind',
        'signalId',
        'sources',
        'tenantId',
        'turnRef',
      ].sort()
    );
  });

  test('retention removes old signals and stale trails', async () => {
    const service = broker.getLocalService('failure-signals');
    await observe('chat-1', { unanswered: true });
    const docs = await service.db.allDocs({ include_docs: true });
    await service.db.bulkDocs(
      docs.rows.map((row) => ({ ...row.doc, at: '2000-01-01T00:00:00.000Z' }))
    );
    expect(await service.prune()).toBe(2);
  });
});
