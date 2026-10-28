'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
jest.mock('../src/tenant-memory-store', () => ({
  get: jest.fn(),
  query: jest.fn(async () => []),
  active: jest.fn((fact) => fact.status === 'valid'),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const store = require('../src/tenant-memory-store');

const need = (key, extra = {}) => ({
  needId: `need:${key}`,
  key,
  label: `Bezeichnung ${key}`,
  kind: 'identifier',
  derivedFrom: [{ source: 'capability', ref: 'synthetic' }],
  functionIds: ['fn-a'],
  unlocks: [],
  basePriority: 0.5,
  ...extra,
});

describe('routing, confirmation and reconciliation (#997 step 4)', () => {
  let broker, dir, notices, coverageRows, objects;
  const meta = (userId) => ({
    authUser: { tenantId: 'synthetic-a', userId, roles: ['ROLE_EDM'], scope: 'full-access' },
  });
  const call = (action, params, userId = 'person-a') =>
    broker.call(`knowledge-needs.${action}`, params, { meta: meta(userId) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-routing-'));
    const artifactPath = path.join(dir, 'knowledge-needs.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        derivation: { version: 1, parameters: 1 },
        sourceHash: 'v1',
        needs: [
          need('wide', {
            unlocks: Array.from({ length: 12 }, (_, i) => ({ operation: `op-${i}` })),
          }),
          need('other', { functionIds: ['fn-z'] }),
        ],
      })
    );
    notices = [];
    objects = new Map();
    coverageRows = jest.fn(async (_tenant, { actorId, functionIds } = {}) =>
      [
        { actorId: 'person-a', functionId: 'fn-a', score: 0.8 },
        { actorId: 'person-b', functionId: 'fn-a', score: 0.6 },
        { actorId: 'person-c', functionId: 'fn-z', score: 0.1 },
      ].filter(
        (row) =>
          (!actorId || row.actorId === actorId) &&
          (!functionIds || functionIds.includes(row.functionId))
      )
    );
    store.get.mockImplementation(async (_ctx, _p, id) => {
      if (!objects.has(id)) throw Object.assign(new Error('missing'), { code: 404 });
      return { payload: objects.get(id) };
    });
    llm.generateStructured.mockReset();
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/knowledge-needs.service');
    broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(dir, 'db'), artifactPath },
    });
    broker.createService({ name: 'function-coverage', methods: { coverageRows } });
    broker.createService({
      name: 'shared-service-notices',
      actions: {
        enqueueMemory(ctx) {
          notices.push(ctx.params);
          return { queued: true };
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an open need reaches a person who covers its function, not someone without coverage', async () => {
    const asked = await call('selectAsk', { conversationId: 'chat-a' }, 'person-a');
    expect(asked).toMatchObject({ needId: 'need:wide', reason: 'neighbor_function' });
    // person-c covers fn-z too weakly; nothing fits the turn either.
    expect(await call('selectAsk', { conversationId: 'chat-c' }, 'person-c')).toBeNull();
  });

  test('a high-impact answer asks a second person to confirm; the source fact decides the state', async () => {
    objects.set('fact-a', {
      id: 'fact-a',
      text: 'Die Kennung lautet SYN-1.',
      status: 'valid',
      person: { actorId: 'person-a' },
      relationIds: [],
    });
    llm.generateStructured.mockResolvedValue({
      matches: [{ needId: 'need:wide', factId: 'fact-a', value: 'SYN-1', confidence: 0.9 }],
    });
    await call('recognizeFacts', { factIds: ['fact-a'] });
    expect(notices).toEqual([
      {
        tenantId: 'synthetic-a',
        actorId: 'person-b',
        relationId: 'fact-a',
        factIds: ['fact-a'],
        confirmation: true,
      },
    ]);
    // A confirming statement of person-b makes it confirmed.
    objects.set('fact-b', {
      id: 'fact-b',
      text: 'Ja, SYN-1 stimmt.',
      status: 'valid',
      person: { actorId: 'person-b' },
      relationIds: ['rel-1'],
    });
    objects.set('rel-1', {
      type: 'tenant_memory_relation',
      kind: 'confirmation',
      factIds: ['fact-a', 'fact-b'],
    });
    objects.get('fact-a').relationIds = ['rel-1'];
    expect((await call('list', { state: 'confirmed' })).map((n) => n.key)).toEqual(['wide']);
    // A conflicting statement disputes it; the correction loop then decides.
    objects.set('rel-2', {
      type: 'tenant_memory_relation',
      kind: 'conflict',
      factIds: ['fact-a', 'fact-c'],
    });
    objects.set('fact-c', { id: 'fact-c', status: 'valid', person: { actorId: 'person-b' } });
    objects.get('fact-a').relationIds = ['rel-1', 'rel-2'];
    expect((await call('get', { needId: 'need:wide' })).state).toBe('confirmed');
    await call('list', {});
    expect((await call('get', { needId: 'need:wide' })).state).toBe('disputed');
  });

  test('an answer whose source fact was withdrawn is disputed', async () => {
    objects.set('fact-a', { id: 'fact-a', text: 'Kennung SYN-2.', status: 'valid', person: {} });
    llm.generateStructured.mockResolvedValue({
      matches: [{ needId: 'need:other', factId: 'fact-a', value: 'SYN-2', confidence: 0.9 }],
    });
    await call('recognizeFacts', { factIds: ['fact-a'] });
    objects.get('fact-a').status = 'revoked';
    await call('list', {});
    expect((await call('get', { needId: 'need:other' })).state).toBe('disputed');
  });
});
