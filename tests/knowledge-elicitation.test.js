'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { inlineAsk, turnSignals } = require('../src/knowledge-elicitation');

const need = (key, extra = {}) => ({
  needId: `need:${key}`,
  key,
  label: `Bezeichnung ${key}`,
  kind: 'identifier',
  derivedFrom: [{ source: 'capability', ref: 'synthetic' }],
  functionIds: [],
  unlocks: [],
  basePriority: 0.5,
  ...extra,
});

describe('inline context question (#997 step 3)', () => {
  let broker, dir, events;
  const meta = (userId = 'synthetic-person-a') => ({
    authUser: { tenantId: 'synthetic-a', userId, roles: ['ROLE_EDM'], scope: 'full-access' },
  });
  const ctx = (userId) => ({
    broker,
    call: (name, params) => broker.call(name, params, { meta: meta(userId) }),
  });
  const turn = (extra = {}) => ({
    situation: {
      turnKind: 'work',
      conversationShape: 'task',
      hypotheses: [{ kind: 'function', id: 'fn-a', confidence: 0.8 }],
      conversationPreferences: {},
      ...extra.situation,
    },
    envelope: {
      userRequest: 'Bitte prüfe den Stand.',
      conversationId: 'chat-1',
      ...extra.envelope,
    },
    pending: extra.pending || {},
    reply: { questions: [], draft: '', ...extra.reply },
    result: { selectedCapabilities: ['cap-a'] },
    retrieval: { toolTrace: [{ called: true, name: 'op-a' }], trace: [] },
    incomingDocuments: false,
    meta: meta(),
  });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-ask-'));
    const artifactPath = path.join(dir, 'knowledge-needs.json');
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        derivation: { version: 1, parameters: 1 },
        sourceHash: 'v1',
        needs: [
          need('fit', { unlocks: [{ capabilityId: 'cap-a' }], functionIds: ['fn-a'] }),
          need('unrelated', { unlocks: [{ capabilityId: 'cap-z' }], basePriority: 1 }),
          need('data', { kind: 'dataset', unlocks: [{ capabilityId: 'cap-a' }] }),
        ],
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
        'knowledge.ask.v1'(c) {
          events.push(c.params);
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('asks once about the need that fits the current work, never about unrelated ones', async () => {
    const ask = await inlineAsk(ctx(), turn());
    expect(ask.question).toMatchObject({ key: 'need:fit', kind: 'knowledge' });
    expect(ask.text).toContain('„Bezeichnung fit“');
    const record = await broker.call(
      'knowledge-needs.get',
      { needId: 'need:fit' },
      { meta: meta() }
    );
    expect(record.state).toBe('asked');
    expect(record.asks[0]).toMatchObject({ mode: 'inline', reason: 'current_task' });
    expect(events).toEqual([
      {
        tenantId: 'synthetic-a',
        needId: 'need:fit',
        actorId: 'synthetic-person-a',
        mode: 'inline',
      },
    ]);
    // The same person is not asked again; another person is not asked within the day either.
    expect(await inlineAsk(ctx(), turn())).toBeNull();
    expect(await inlineAsk(ctx('synthetic-person-b'), turn())).toBeNull();
  });

  test.each([
    ['small talk', { situation: { turnKind: 'smalltalk' } }],
    ['filing', { situation: { conversationShape: 'filing' } }],
    ['an answer that already asks back', { reply: { questions: [{ key: 'x' }] } }],
    ['a draft', { reply: { draft: 'Entwurf' } }],
    ['a recent ask in this chat', { pending: { lastKnowledgeAskAt: Date.now() } }],
  ])('no context question on %s', async (_label, extra) => {
    expect(await inlineAsk(ctx(), turn(extra))).toBeNull();
  });

  test('turn signals come from capabilities, called operations and confident functions', () => {
    const { situation, result, retrieval } = turn();
    expect(turnSignals(result, retrieval, situation)).toEqual({
      capabilities: ['cap-a'],
      operations: ['op-a'],
      functionIds: ['fn-a'],
    });
  });
});
