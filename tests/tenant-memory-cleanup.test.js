'use strict';
jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const ObjectStore = require('../services/object-store.service');
const Notices = require('../services/shared-service-notices.service');
const PolicyService = require('../services/tenant-memory-policy.service');
const memory = require('../src/tenant-memory');
const store = require('../src/tenant-memory-store');
const policy = require('../src/tenant-memory-policy');
const llm = require('../src/llm-client');
const fixture =
  require('../scripts/generate-memory-cleanup-fixture').generateMemoryCleanupFixture();

describe('cross-session correction and audited tenant administration', () => {
  let app;
  const p = (actorId = 'synthetic-author', admin = false) => ({
    actorId,
    tenantId: 'tenant-a',
    roles: [admin ? 'ROLE_TENANT_ADMIN' : 'ROLE_ALPHA'],
    clearance: [],
  });
  const context = (person = p()) => ({
    broker: app.broker,
    meta: auth(person.actorId, person.roles, person.tenantId),
    params: {},
    call: (name, params, options) =>
      app.broker.call(name, params, {
        meta: { ...auth(person.actorId, person.roles, person.tenantId), ...options?.meta },
      }),
  });
  const envelope = (userRequest, conversationId = 'new-chat') => ({
    userRequest,
    conversationId,
    channel: 'api',
  });
  async function seed(person = p(), id = 'synthetic-fact', text = fixture.text) {
    const fact = {
      id,
      type: 'tenant_memory_fact',
      tenantId: person.tenantId,
      person: { actorId: person.actorId, name: person.actorId, roles: person.roles },
      text,
      basis: text,
      at: '2025-01-01T10:00:00.000Z',
      status: 'valid',
      sensitivityFlags: [],
      anchors: [{ value: fixture.anchor, aliases: [] }],
      anchorKeys: store.anchorKeys({ value: fixture.anchor }),
      audit: [],
      relationIds: [],
      checking: 'pending',
      attempts: 0,
      recoveryPrincipal: person,
      conversationId: 'old-chat',
      channel: 'api',
    };
    await store.put(context(person), person, fact);
    return fact;
  }
  beforeEach(async () => {
    jest.clearAllMocks();
    app = await createCaseBroker();
    app.broker.createService({
      ...ObjectStore,
      settings: { dbPath: path.join(app.dir, 'objects') },
    });
    app.broker.createService({
      ...Notices,
      settings: { ...Notices.settings, dbPath: path.join(app.dir, 'notices') },
    });
    app.broker.createService(PolicyService);
    await app.broker.start();
  });
  afterEach(async () => app.cleanup());

  test('named own statement is revoked from a new chat and recovery skips it', async () => {
    const fact = await seed();
    const reply = await memory.preturn(context(), p(), envelope(fixture.revoke), null);
    expect(reply.state).toBe('tenant_memory_corrected');
    const saved = (await store.get(context(), p(), fact.id)).payload;
    expect(saved.status).toBe('revoked');
    expect(saved.audit.at(-1).basis).toBe(fixture.revoke);
    await memory.recover({ broker: app.broker, logger: app.broker.logger });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
  test('foreign statement requires durable confirmation, audit and notice to author', async () => {
    const fact = await seed();
    const person = p('synthetic-colleague');
    const ctx = context(person);
    const reply = await memory.preturn(ctx, person, envelope(fixture.revoke), null);
    expect(reply.state).toBe('tenant_memory_confirmation');
    expect((await store.get(ctx, person, fact.id)).payload.status).toBe('valid');
    await memory.preturn(ctx, person, envelope('Ja, bestätigen', 'other-chat'), null);
    expect((await store.get(ctx, person, fact.id)).payload.status).toBe('valid');
    await memory.preturn(ctx, person, envelope('Ja, bestätigen'), null);
    const saved = (await store.get(ctx, person, fact.id)).payload;
    expect(saved.status).toBe('revoked');
    expect(saved.audit.at(-1).confirmed).toBe(true);
    const notices = await app.broker.call(
      'notices.list',
      { tenantId: person.tenantId, actorId: p().actorId },
      { meta: auth(p().actorId, p().roles, person.tenantId) }
    );
    expect(JSON.stringify(notices)).toContain('widerrufen');
    const audits = await store.query(ctx, person, { 'payload.type': 'tenant_memory_audit' });
    expect(audits.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['confirmation_requested', 'revoked'])
    );
  });
  test('multiple statements produce descriptions and an explicit selection', async () => {
    await seed();
    await seed(p(), 'second', fixture.other);
    const reply = await memory.preturn(context(), p(), envelope(fixture.revoke), null);
    expect(reply.responseText).toContain('1.');
    expect(reply.responseText).toContain('2.');
    const index = reply.responseText
      .split('\n')
      .find((line) => line.includes(fixture.other))
      .match(/^(\d+)\./)[1];
    await memory.preturn(context(), p(), envelope(index), null);
    expect((await store.get(context(), p(), 'second')).payload.status).toBe('revoked');
    expect((await store.get(context(), p(), 'synthetic-fact')).payload.status).toBe('valid');
  });
  test('admin list, revoke and delete are audited; raw delete and non-admin remain forbidden', async () => {
    await seed();
    const admin = p('synthetic-admin', true),
      ctx = context(admin);
    const listed = await ctx.call('tenant-memory-policy.list', {});
    expect(listed.statements).toHaveLength(1);
    await ctx.call('tenant-memory-policy.revoke', {
      id: 'synthetic-fact',
      reason: 'Synthetic cleanup',
    });
    expect((await store.get(ctx, admin, 'synthetic-fact')).payload.status).toBe('revoked');
    await ctx.call('tenant-memory-policy.delete', {
      id: 'synthetic-fact',
      reason: 'Synthetic cleanup',
    });
    const deleted = (await store.get(ctx, admin, 'synthetic-fact')).payload;
    expect(deleted.status).toBe('deleted');
    expect(deleted.text).toBe('');
    expect(JSON.stringify(deleted)).not.toContain(fixture.text);
    const audits = await store.query(ctx, admin, { 'payload.type': 'tenant_memory_audit' });
    expect(audits.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['admin_list', 'revoked', 'deleted'])
    );
    await expect(context().call('tenant-memory-policy.list', {})).rejects.toMatchObject({
      code: 403,
    });
    await expect(
      context().call('tenant-memory-policy.revoke', {
        id: 'synthetic-fact',
        reason: 'Synthetic cleanup',
      })
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      ctx.call('object-store.delete', { namespace: store.namespace(admin), key: 'synthetic-fact' })
    ).rejects.toMatchObject({ code: 403 });
  });
  test('withdrawal questions and explicit negation do not change statements', async () => {
    await seed();
    await memory.preturn(context(), p(), envelope('Wie widerrufe ich eine Aussage?'), null);
    await memory.preturn(context(), p(), envelope('Die Aussage bitte nicht streichen'), {
      tenantMemoryFactIds: ['synthetic-fact'],
    });
    expect((await store.get(context(), p(), 'synthetic-fact')).payload.status).toBe('valid');
  });
  test('a stale foreign confirmation cannot revoke a changed statement', async () => {
    await seed();
    const person = p('synthetic-colleague'),
      ctx = context(person);
    await memory.preturn(ctx, person, envelope(fixture.revoke), null);
    await store.mutate(context(), p(), 'synthetic-fact', (fact) => ({
      ...fact,
      text: fixture.other,
    }));
    const reply = await memory.preturn(ctx, person, envelope('Ja, bestätigen'), null);
    expect(reply.responseText).toContain('inzwischen geändert');
    expect((await store.get(ctx, person, 'synthetic-fact')).payload.status).toBe('valid');
  });
  test('recovery exhausts old pending work directly before scheduling model calls', async () => {
    const fact = await seed();
    await store.mutate(context(), p(), fact.id, (value) => ({
      ...value,
      attempts: policy.MAX_ATTEMPTS + 1,
    }));
    await memory.recover({ broker: app.broker, logger: app.broker.logger });
    expect((await store.get(context(), p(), fact.id)).payload.checking).toBe('failed');
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
  test('exhausted pending work fails once and never calls the model', async () => {
    const fact = await seed();
    await store.mutate(context(), p(), fact.id, (value) => ({
      ...value,
      attempts: policy.MAX_ATTEMPTS,
    }));
    const admin = p('synthetic-admin', true);
    expect(await context(admin).call('tenant-memory-policy.cleanup', {})).toEqual({ failed: 1 });
    expect(await context(admin).call('tenant-memory-policy.cleanup', {})).toEqual({ failed: 0 });
    expect((await store.get(context(), p(), fact.id)).payload.checking).toBe('failed');
    await memory.recover({ broker: app.broker, logger: app.broker.logger });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
});
