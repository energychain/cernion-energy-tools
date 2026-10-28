'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
jest.mock('../src/tenant-memory-store', () => ({
  get: jest.fn(),
  query: jest.fn(),
  active: jest.fn((fact) => fact.status === 'valid'),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const store = require('../src/tenant-memory-store');
const { matchFacts } = require('../src/knowledge-need-recognition');

const need = (key, kind = 'identifier') => ({
  needId: `need:${key}`,
  key,
  label: `Bezeichnung ${key}`,
  kind,
  derivedFrom: [{ source: 'capability', ref: 'synthetic' }],
  functionIds: [],
  unlocks: [],
  basePriority: 0.5,
});
const fact = (id, text, extra = {}) => ({
  id,
  text,
  status: 'valid',
  at: '2026-10-27T10:00:00.000Z',
  conversationId: 'chat-1',
  person: { actorId: 'synthetic-person-a' },
  ...extra,
});

beforeEach(() => {
  llm.generateStructured.mockReset();
  store.get.mockReset();
  store.query.mockReset();
});

describe('semantic matching', () => {
  test('only literal, confident matches on open needs count', async () => {
    llm.generateStructured.mockResolvedValue({
      matches: [
        { needId: 'need:a', factId: 'f1', value: 'SYN-123', confidence: 0.9 },
        { needId: 'need:a', factId: 'f1', value: 'erfunden', confidence: 0.9 },
        { needId: 'need:a', factId: 'f1', value: 'SYN-123', confidence: 0.3 },
        { needId: 'need:unknown', factId: 'f1', value: 'SYN-123', confidence: 0.9 },
        { needId: 'need:a', factId: 'other', value: 'SYN-123', confidence: 0.9 },
      ],
    });
    const matches = await matchFacts(
      [fact('f1', 'Unsere Kennung lautet SYN-123.')],
      [need('a'), need('d', 'dataset')],
      { tenantId: 'synthetic-a' }
    );
    expect(matches).toEqual([
      { needId: 'need:a', factId: 'f1', value: 'SYN-123', confidence: 0.9 },
    ]);
    // Data kinds are answered by uploads, not by statements.
    expect(JSON.parse(llm.generateStructured.mock.calls[0][1]).needs.map((n) => n.needId)).toEqual([
      'need:a',
    ]);
  });

  test('no open need or no fact means no model call', async () => {
    expect(await matchFacts([], [need('a')], { tenantId: 't' })).toEqual([]);
    expect(await matchFacts([fact('f1', 'x')], [], { tenantId: 't' })).toEqual([]);
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
});

describe('register recognition', () => {
  let broker, dir, events;
  const meta = (tenantId) => ({
    authUser: { tenantId, userId: 'synthetic-person-a', roles: ['ROLE_EDM'], scope: 'full-access' },
  });
  const call = (action, params, tenantId = 'synthetic-a') =>
    broker.call(`knowledge-needs.${action}`, params, { meta: meta(tenantId) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-recognition-'));
    const artifactPath = path.join(dir, 'knowledge-needs.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        derivation: { version: 1, parameters: 1 },
        sourceHash: 'v1',
        needs: [need('a'), need('b')],
      })
    );
    events = [];
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/knowledge-needs.service');
    broker.createService({
      ...schema,
      settings: { ...schema.settings, dbPath: path.join(dir, 'db'), artifactPath },
    });
    broker.createService({
      name: 'listener',
      events: {
        'knowledge.answered.v1'(ctx) {
          events.push(ctx.params);
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a recognized fact answers the need with provenance; earlier facts are backfilled once', async () => {
    const current = fact('f-new', 'Die Kennung der Organisation ist SYN-123.');
    const earlier = fact('f-old', 'Zuständig für B ist die Rolle Synthetik.', {
      at: '2026-10-01T10:00:00.000Z',
      conversationId: 'chat-0',
    });
    store.get.mockResolvedValue({ payload: current });
    store.query.mockResolvedValue([current, earlier]);
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const input = JSON.parse(prompt);
      const ids = input.facts.map((item) => item.factId);
      return {
        matches: [
          ...(ids.includes('f-new')
            ? [{ needId: 'need:a', factId: 'f-new', value: 'SYN-123', confidence: 0.95 }]
            : []),
          ...(ids.includes('f-old')
            ? [{ needId: 'need:b', factId: 'f-old', value: 'Rolle Synthetik', confidence: 0.8 }]
            : []),
        ],
      };
    });
    const recorded = await call('recognizeFacts', { factIds: ['f-new'] });
    expect(recorded).toEqual([{ needId: 'need:a', answerId: 'answer:f-new', value: 'SYN-123' }]);
    const a = await call('get', { needId: 'need:a' });
    expect(a.state).toBe('answered');
    expect(a.answers[0]).toMatchObject({
      value: 'SYN-123',
      storedAs: 'memory',
      storeRef: 'f-new',
      actorId: 'synthetic-person-a',
      conversationId: 'chat-1',
      evidence: { quote: 'SYN-123', factId: 'f-new' },
    });
    expect((await call('get', { needId: 'need:b' })).state).toBe('answered');
    expect(events).toEqual(
      expect.arrayContaining([
        { tenantId: 'synthetic-a', needId: 'need:a', answerId: 'answer:f-new', storedAs: 'memory' },
      ])
    );
    // The backfill runs once per tenant and derivation, not on every recognition.
    const calls = llm.generateStructured.mock.calls.length;
    await call('recognizeFacts', { factIds: ['f-new'] });
    expect(store.query).toHaveBeenCalledTimes(1);
    expect(llm.generateStructured.mock.calls.length).toBe(calls);
  });

  test('another tenant keeps its own unanswered register', async () => {
    store.get.mockResolvedValue({ payload: fact('f1', 'Kennung SYN-9.') });
    store.query.mockResolvedValue([]);
    llm.generateStructured.mockResolvedValue({
      matches: [{ needId: 'need:a', factId: 'f1', value: 'SYN-9', confidence: 0.9 }],
    });
    await call('recognizeFacts', { factIds: ['f1'] });
    expect((await call('get', { needId: 'need:a' }, 'synthetic-b')).state).toBe('unknown');
  });
});
