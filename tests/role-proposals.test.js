'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const { coverageSignals } = require('../src/role-signals');

const FN = require('../src/function-model').getFunctionModel().functions[0].functionId;

test('coverage: the strongest regular coverage performs, further coverage contributes', () => {
  const signals = coverageSignals([
    { actorId: 'person-a', functionId: FN, score: 0.8 },
    { actorId: 'person-b', functionId: FN, score: 0.6 },
    { actorId: 'person-c', functionId: FN, score: 0.2 },
  ]);
  expect(signals.map((s) => [s.actorRef.actorId, s.suggestedRole, s.confidence])).toEqual([
    ['person-a', 'D', 0.8],
    ['person-b', 'M', 0.6],
  ]);
});

describe('role proposals (#1019 A1–A2)', () => {
  let broker, dir, created, coverage;
  const meta = (userId, roles = ['ROLE_EDM']) => ({
    authUser: { tenantId: 'synthetic-a', userId, roles },
  });
  const call = (action, params, userId = 'person-a', roles) =>
    broker.call(`role-proposals.${action}`, params, { meta: meta(userId, roles) });
  const answers = (reply) => llm.generateStructured.mockResolvedValueOnce(reply);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-proposals-'));
    created = [];
    coverage = [
      { actorId: 'person-a', functionId: FN, score: 0.8 },
      { actorId: 'person-b', functionId: FN, score: 0.4 },
    ];
    llm.generateStructured.mockReset();
    broker = new ServiceBroker({ logger: false });
    const schema = require('../services/role-proposals.service');
    broker.createService({ ...schema, settings: { ...schema.settings, dbPath: dir } });
    broker.createService({
      name: 'function-coverage',
      methods: {
        async coverageRows(_tenant, { actorId, functionIds } = {}) {
          return coverage.filter(
            (row) =>
              (!actorId || row.actorId === actorId) &&
              (!functionIds || functionIds.includes(row.functionId))
          );
        },
      },
    });
    broker.createService({
      name: 'vdmi',
      actions: {
        create(ctx) {
          created.push({ params: ctx.params, tenantId: ctx.meta.authUser.tenantId });
          return { success: true, matrix: { id: 'matrix-1' } };
        },
      },
    });
    await broker.start();
  });
  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('each person is asked once about their own row; the answers confirm the proposal into VDMI', async () => {
    const asked = await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] });
    expect(asked.question).toMatchObject({ key: `role:${FN}`, kind: 'role' });
    expect(asked.text).toContain('durchführend');
    // Cooldown: not asked again right away.
    expect(await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] })).toBeNull();

    answers({ verdict: 'confirm', role: 'D', confidence: 0.9, basis: 'Ja, das mache ich' });
    await call('answer', { message: 'Ja, das mache ich.', functionIds: [FN] });
    let [proposal] = await call('list', {}, 'admin', ['ROLE_TENANT_ADMIN']);
    expect(proposal).toMatchObject({ state: 'nominated' });
    expect(created).toEqual([]);

    // Person B corrects the proposed role: accountable instead of contributing.
    expect(
      (await call('selectAsk', { conversationId: 'chat-b', functionIds: [FN] }, 'person-b')).text
    ).toContain('mitwirkend');
    answers({ verdict: 'other_role', role: 'V', confidence: 0.85, basis: 'ich verantworte das' });
    await call('answer', { message: 'Nein, ich verantworte das.', functionIds: [FN] }, 'person-b');
    [proposal] = await call('list', {}, 'admin', ['ROLE_TENANT_ADMIN']);
    expect(proposal).toMatchObject({ state: 'confirmed', vdmiMatrixId: 'matrix-1' });
    expect(
      proposal.rows.map((row) => [row.actorRef.actorId, row.role, row.confirmation.verdict])
    ).toEqual(
      expect.arrayContaining([
        ['person-a', 'D', 'confirmed'],
        ['person-b', 'V', 'corrected'],
      ])
    );
    expect(created).toHaveLength(1);
    expect(created[0].params.tasks[0]).toMatchObject({
      verantwortlich: [expect.objectContaining({ actorType: 'user', actorId: 'person-b' })],
      durchfuehrend: [expect.objectContaining({ actorType: 'user', actorId: 'person-a' })],
    });
    expect(created[0].tenantId).toBe('synthetic-a');
  });

  test('an answer without literal basis or with low confidence changes nothing', async () => {
    await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] });
    answers({ verdict: 'confirm', role: 'D', confidence: 0.9, basis: 'erfundener Beleg' });
    await call('answer', { message: 'Ja.', functionIds: [FN] });
    answers({ verdict: 'confirm', role: 'D', confidence: 0.4, basis: 'Ja' });
    await call('answer', { message: 'Ja.', functionIds: [FN] });
    const mine = await call('mine', {});
    expect(mine).toEqual([
      expect.objectContaining({ functionId: FN, role: 'D', confirmation: 'pending' }),
    ]);
  });

  test('a row nobody asked about is not answered by an unrelated message', async () => {
    await call('refresh', { functionIds: [FN] });
    await call('answer', { message: 'Ja, gern.', functionIds: [FN] });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  test('own rows only for everyone, the full list for admins', async () => {
    await call('refresh', { functionIds: [FN] });
    expect((await call('mine', {}, 'person-b')).map((row) => row.role)).toEqual(['M']);
    await expect(call('list', {}, 'person-a')).rejects.toThrow();
  });

  test('a stated responsibility becomes an accountable row with provenance', async () => {
    broker.createService({
      name: 'knowledge-needs',
      methods: {
        async answeredNeeds() {
          return [
            {
              needId: 'need:contact:x',
              kind: 'contact',
              functionIds: [FN],
              answers: [{ answerId: 'ans-1', value: 'Team A', actorId: 'person-a' }],
            },
          ];
        },
      },
    });
    await broker.waitForServices(['knowledge-needs']);
    await broker.emit('knowledge.answered.v1', {
      tenantId: 'synthetic-a',
      needId: 'need:contact:x',
      answerId: 'ans-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [proposal] = await call('list', {}, 'admin', ['ROLE_TENANT_ADMIN']);
    expect(proposal.rows).toEqual([
      expect.objectContaining({
        actorRef: { actorType: 'label', actorId: 'Team A' },
        role: 'V',
        origins: ['knowledge_answer'],
        confirmation: { verdict: 'stated' },
        evidence: [{ kind: 'knowledge_answer', ref: 'ans-1', statedBy: 'person-a' }],
      }),
    ]);
  });
});
