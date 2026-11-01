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
const { inlineAsk } = require('../src/knowledge-elicitation');

const need = (key, extra = {}) => ({
  needId: `need:${key}`,
  key,
  label: `Bezeichnung ${key}`,
  kind: 'identifier',
  derivedFrom: [{ source: 'capability', ref: 'synthetic' }],
  functionIds: ['fn-a'],
  unlocks: Array.from({ length: 12 }, (_, i) => ({ operation: `op-${i}` })),
  basePriority: 0.5,
  ...extra,
});

describe('routing by role (#1019 A3)', () => {
  let broker, dir, notices, roles;
  const meta = (userId) => ({
    authUser: { tenantId: 'synthetic-a', userId, roles: ['ROLE_EDM'], scope: 'full-access' },
  });
  const call = (action, params, userId) =>
    broker.call(`knowledge-needs.${action}`, params, { meta: meta(userId) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-routing-'));
    const artifactPath = path.join(dir, 'knowledge-needs.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        derivation: { version: 1, parameters: 1 },
        sourceHash: 'v1',
        needs: [need('wide')],
      })
    );
    notices = [];
    roles = {
      'fn-a': [
        { actorRef: { actorType: 'user', actorId: 'person-d' }, role: 'D' },
        { actorRef: { actorType: 'user', actorId: 'person-v' }, role: 'V' },
        { actorRef: { actorType: 'user', actorId: 'person-i' }, role: 'I' },
      ],
    };
    llm.generateStructured.mockReset();
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/knowledge-needs.service');
    broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(dir, 'db'), artifactPath },
    });
    broker.createService({
      name: 'function-coverage',
      methods: {
        async coverageRows() {
          return ['person-a', 'person-d', 'person-v', 'person-i'].map((actorId) => ({
            actorId,
            functionId: 'fn-a',
            score: 0.8,
          }));
        },
      },
    });
    broker.createService({
      name: 'role-proposals',
      methods: {
        async rolesFor(_tenant, functionIds) {
          return Object.fromEntries(functionIds.map((id) => [id, roles[id] || []]));
        },
      },
    });
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

  test('facts are asked of the performing person only', async () => {
    expect(await call('selectAsk', { conversationId: 'c1' }, 'person-a')).toBeNull();
    expect(await call('selectAsk', { conversationId: 'c2' }, 'person-d')).toMatchObject({
      needId: 'need:wide',
    });
  });

  test('without a known role, coverage decides as before', async () => {
    roles = {};
    expect(await call('selectAsk', { conversationId: 'c3' }, 'person-a')).toMatchObject({
      needId: 'need:wide',
    });
  });

  test('the accountable person confirms; informed people get a notice', async () => {
    store.get.mockImplementation(async () => ({
      payload: {
        id: 'fact-1',
        text: 'Die Kennung lautet SYN-1.',
        status: 'valid',
        person: { actorId: 'person-d' },
        relationIds: [],
      },
    }));
    llm.generateStructured.mockResolvedValue({
      matches: [{ needId: 'need:wide', factId: 'fact-1', value: 'SYN-1', confidence: 0.9 }],
    });
    await call('recognizeFacts', { factIds: ['fact-1'] }, 'person-d');
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: 'person-v', confirmation: true }),
        expect.objectContaining({ actorId: 'person-i' }),
      ])
    );
    expect(notices.find((item) => item.actorId === 'person-i').confirmation).toBeUndefined();
    expect(notices.some((item) => item.actorId === 'person-a')).toBe(false);
  });
});

describe('one context question per turn: an own role row before a knowledge need', () => {
  const base = {
    situation: { turnKind: 'work', conversationShape: 'task', hypotheses: [] },
    envelope: { conversationId: 'c1', userRequest: 'Ja, das mache ich.' },
    reply: { questions: [] },
    result: {},
    retrieval: {},
    meta: {},
  };
  const ctxWith = (calls) => ({
    broker: {
      getLocalService: (name) => (['knowledge-needs', 'role-proposals'].includes(name) ? {} : null),
      logger: { warn: jest.fn() },
    },
    call: jest.fn(async (name, params) => {
      calls.push([name, params]);
      if (name === 'role-proposals.selectAsk')
        return { text: 'Kurze Rückfrage zur Zuständigkeit: …', question: { kind: 'role' } };
      return null;
    }),
  });

  test('the role question wins and the knowledge register is not asked', async () => {
    const calls = [];
    const asked = await inlineAsk(ctxWith(calls), { ...base, pending: {} });
    expect(asked.question.kind).toBe('role');
    expect(calls.map((entry) => entry[0])).toEqual(['role-proposals.selectAsk']);
  });

  test('a reply is read as a role answer only right after a role question', async () => {
    const recent = {
      askedQuestions: [{ key: 'role:fn-a', kind: 'role' }],
      lastKnowledgeAskAt: Date.now() - 60000,
    };
    let calls = [];
    await inlineAsk(ctxWith(calls), { ...base, pending: recent });
    expect(calls[0]).toEqual([
      'role-proposals.answer',
      { message: 'Ja, das mache ich.', functionIds: ['fn-a'] },
    ]);
    for (const pending of [
      { ...recent, lastKnowledgeAskAt: Date.now() - 7 * 3600 * 1000 },
      { ...recent, askedQuestions: [...recent.askedQuestions, { key: 'k', kind: 'knowledge' }] },
    ]) {
      calls = [];
      await inlineAsk(ctxWith(calls), { ...base, pending });
      expect(calls.some((entry) => entry[0] === 'role-proposals.answer')).toBe(false);
    }
  });
});
