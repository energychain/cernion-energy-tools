'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const { coverageSignals } = require('../src/role-signals');

const FUNCTIONS = require('../src/function-model').getFunctionModel().functions;
const FN = FUNCTIONS[0].functionId;
const FN2 = FUNCTIONS.find(
  (fn) =>
    fn.functionId !== FN &&
    (fn.displayLabel || fn.label) !== (FUNCTIONS[0].displayLabel || FUNCTIONS[0].label)
).functionId;
const PROPOSAL_KEYS = [
  'answeredCount',
  'functionId',
  'label',
  'nextSafeGate',
  'pendingCount',
  'positiveFollowUp',
  'proposalId',
  'rowCount',
  'state',
  'statedCount',
  'vdmiLinked',
  'vdmiMatrixId',
];
const ROW_KEYS = [
  'actorDisplayLabel',
  'actorDisplayStatus',
  'actorType',
  'confidenceBand',
  'confirmationAt',
  'confirmationVerdict',
  'evidenceCount',
  'functionId',
  'label',
  'nextSafeGate',
  'originCount',
  'originLabel',
  'positiveFollowUp',
  'proposalId',
  'role',
  'roleLabel',
  'rowOrdinal',
  'state',
  'vdmiLinked',
];
const ENVELOPE = {
  contract: 'role_proposal_presenter_contract',
  safety: 'protected_read_only_role_proposal_projection',
  notice: expect.stringContaining('keine Rechtevergabe'),
};
const scalar = (record) =>
  Object.values(record).every((value) => value === null || typeof value !== 'object');

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
  let broker, dir, created, coverage, failVdmi;
  const meta = (userId, roles = ['ROLE_EDM'], tenantId = 'synthetic-a') => ({
    authUser: { tenantId, userId, roles },
  });
  const call = (action, params, userId = 'person-a', roles, tenantId) =>
    broker.call(`role-proposals.${action}`, params, { meta: meta(userId, roles, tenantId) });
  const list = (params = {}) => call('list', params, 'admin', ['ROLE_TENANT_ADMIN']);
  // Person A confirms D, person B corrects M to V: the proposal becomes confirmed.
  const confirmBoth = async () => {
    await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] });
    answers({ verdict: 'confirm', role: 'D', confidence: 0.9, basis: 'Ja, das mache ich' });
    await call('answer', { message: 'Ja, das mache ich.', functionIds: [FN] });
    await call('selectAsk', { conversationId: 'chat-b', functionIds: [FN] }, 'person-b');
    answers({ verdict: 'other_role', role: 'V', confidence: 0.85, basis: 'ich verantworte das' });
    await call('answer', { message: 'Nein, ich verantworte das.', functionIds: [FN] }, 'person-b');
  };
  const answers = (reply) => llm.generateStructured.mockResolvedValueOnce(reply);

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'role-proposals-'));
    created = [];
    failVdmi = false;
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
          if (failVdmi) throw new Error('vdmi unavailable');
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

  test('a turn without a task of its own gets no role question about other work', async () => {
    expect(await call('selectAsk', { conversationId: 'chat-a' })).toBeNull();
    expect(
      await call('selectAsk', { conversationId: 'chat-a', functionIds: ['fn-other'] })
    ).toBeNull();
    const asked = await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] });
    expect(asked.text).not.toMatch(/[a-z]_[a-z]/u);
  });

  test('each person is asked once about their own row; the answers confirm the proposal into VDMI', async () => {
    const asked = await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] });
    expect(asked.question).toMatchObject({ key: `role:${FN}`, kind: 'role' });
    expect(asked.text).toContain('durchführend');
    // Cooldown: not asked again right away.
    expect(await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] })).toBeNull();

    answers({ verdict: 'confirm', role: 'D', confidence: 0.9, basis: 'Ja, das mache ich' });
    await call('answer', { message: 'Ja, das mache ich.', functionIds: [FN] });
    let [proposal] = (await list()).proposals;
    expect(proposal).toMatchObject({ state: 'nominated' });
    expect(created).toEqual([]);

    // Person B corrects the proposed role: accountable instead of contributing.
    expect(
      (await call('selectAsk', { conversationId: 'chat-b', functionIds: [FN] }, 'person-b')).text
    ).toContain('mitwirkend');
    answers({ verdict: 'other_role', role: 'V', confidence: 0.85, basis: 'ich verantworte das' });
    await call('answer', { message: 'Nein, ich verantworte das.', functionIds: [FN] }, 'person-b');
    const presented = await list();
    expect(presented.proposals[0]).toMatchObject({
      state: 'confirmed',
      vdmiLinked: true,
      vdmiMatrixId: 'matrix-1',
    });
    expect(presented.rows.map((row) => [row.role, row.confirmationVerdict])).toEqual([
      ['V', 'corrected'],
      ['D', 'confirmed'],
    ]);
    expect((await call('mine', {}, 'person-b')).rows.map((row) => row.role)).toEqual(['V']);
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
    expect(mine.rows).toEqual([
      expect.objectContaining({ functionId: FN, role: 'D', confirmationVerdict: 'pending' }),
    ]);
  });

  test('a row nobody asked about is not answered by an unrelated message', async () => {
    await call('refresh', { functionIds: [FN] });
    await call('answer', { message: 'Ja, gern.', functionIds: [FN] });
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });

  test('own rows only for everyone, the full list for admins', async () => {
    await call('refresh', { functionIds: [FN] });
    expect((await call('mine', {}, 'person-b')).rows).toEqual([
      expect.objectContaining({ role: 'M', actorDisplayStatus: 'self', rowOrdinal: 1 }),
    ]);
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
    const { rows } = await list();
    expect(rows).toEqual([
      expect.objectContaining({
        actorDisplayLabel: 'Team A',
        actorDisplayStatus: 'stated_label',
        actorType: 'label',
        role: 'V',
        roleLabel: 'V = Verantwortlich',
        originLabel: 'Genannte Zuständigkeit',
        originCount: 1,
        confirmationVerdict: 'stated',
        evidenceCount: 1,
        nextSafeGate: 'human_review_of_stated_responsibility',
      }),
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/ans-1|person-a|statedBy/u);
  });

  describe('presenter contract (#1058)', () => {
    const service = () => broker.getLocalService('role-proposals');

    test('admin and own rows share one exact scalar vocabulary without raw identifiers', async () => {
      await confirmBoth();
      const presented = await list();
      expect(presented).toEqual({
        ...ENVELOPE,
        scope: 'tenant_admin',
        proposals: expect.any(Array),
        rows: expect.any(Array),
      });
      for (const proposal of presented.proposals) {
        expect(Object.keys(proposal).sort()).toEqual(PROPOSAL_KEYS);
        expect(scalar(proposal)).toBe(true);
      }
      const mine = await call('mine', {});
      expect(mine).toEqual({ ...ENVELOPE, scope: 'own_rows', rows: expect.any(Array) });
      for (const row of [...presented.rows, ...mine.rows]) {
        expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
        expect(scalar(row)).toBe(true);
      }
      const text = JSON.stringify([presented, mine]);
      for (const forbidden of [
        'person-a',
        'person-b',
        'chat-a',
        'chat-b',
        'das mache ich',
        'verantworte das',
        'actorRef',
        'actorId',
        'origins',
        '"evidence"',
        'basis',
        'askedIn',
        'askedAt',
        'statedBy',
        'tenantId',
        'synthetic-a',
        '_id',
        '_rev',
        'rp:',
        '[object Object]',
      ])
        expect(text).not.toContain(forbidden);
      expect(presented.rows.find((row) => row.role === 'D')).toMatchObject({
        actorDisplayStatus: 'redacted',
        confidenceBand: 'high',
        confirmationAt: expect.any(String),
        originLabel: 'Beobachtete Abdeckung',
      });
    });

    test('observed, nominated and confirmed proposals with linked and unlinked VDMI', async () => {
      coverage.push({ actorId: 'person-c', functionId: FN2, score: 0.4 });
      await call('refresh', { functionIds: [FN, FN2] });
      const before = await list();
      const byFunction = (presented, id) =>
        presented.proposals.find((proposal) => proposal.functionId === id);
      expect(byFunction(before, FN2)).toMatchObject({
        state: 'observed',
        rowCount: 1,
        pendingCount: 1,
        vdmiLinked: false,
        vdmiMatrixId: null,
        nextSafeGate: 'own_confirmation_in_chat',
      });
      expect(byFunction(before, FN)).toMatchObject({
        state: 'nominated',
        rowCount: 2,
        pendingCount: 2,
        answeredCount: 0,
        positiveFollowUp: expect.stringContaining('2 offene Rückmeldung'),
      });
      expect((await list({ state: 'observed' })).proposals.map((p) => p.functionId)).toEqual([FN2]);

      failVdmi = true;
      await confirmBoth();
      expect(byFunction(await list(), FN)).toMatchObject({
        state: 'confirmed',
        pendingCount: 0,
        answeredCount: 2,
        vdmiLinked: false,
        vdmiMatrixId: null,
        nextSafeGate: 'vdmi_record_review',
      });
    });

    test('confirmed and linked proposal points to the human template gate, never to authority', async () => {
      await confirmBoth();
      const { proposals, rows } = await list();
      expect(proposals[0]).toMatchObject({
        vdmiLinked: true,
        nextSafeGate: 'human_template_nomination',
      });
      expect(rows.every((row) => row.vdmiLinked && row.nextSafeGate === 'none_open')).toBe(true);
    });

    test('stable presentation order (label, function; V/D/M/I) and explicit role labels', async () => {
      coverage.push(
        { actorId: 'person-c', functionId: FN2, score: 0.7 },
        { actorId: 'person-d', functionId: FN2, score: 0.35 }
      );
      await call('refresh', { functionIds: [FN2] });
      await call('refresh', { functionIds: [FN] });
      const first = await list();
      const labels = first.proposals.map((proposal) => proposal.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'de')));
      for (const proposal of first.proposals) {
        const rows = first.rows.filter((row) => row.proposalId === proposal.proposalId);
        expect(rows.map((row) => row.roleLabel)).toEqual(['D = Durchführend', 'M = Mitwirkend']);
        expect(rows.map((row) => row.rowOrdinal)).toEqual([1, 2]);
      }
      expect(await list()).toEqual(first);
    });

    test('missing provenance and pending rows map to a positive follow-up and a human gate', async () => {
      await service().db.put({
        _id: `rp:synthetic-a:${FN2}`,
        type: 'role_proposal',
        proposalId: 'proposal-seed',
        tenantId: 'synthetic-a',
        functionId: FN2,
        label: 'Synthetische Funktion',
        state: 'observed',
        rows: [
          {
            actorRef: { actorType: 'user', actorId: 'person-a' },
            role: 'I',
            confidence: 0.2,
            origins: [],
            evidence: [],
            confirmation: { verdict: 'pending' },
          },
        ],
      });
      const [row] = (await call('mine', {})).rows;
      expect(row).toMatchObject({
        roleLabel: 'I = Informiert',
        confidenceBand: 'low',
        originLabel: '',
        originCount: 0,
        evidenceCount: 0,
        nextSafeGate: 'role_bearing_evidence',
        positiveFollowUp: expect.stringContaining('ermöglicht die nächste Prüfung'),
      });
      await call('refresh', { functionIds: [FN] });
      const pending = (await call('mine', {})).rows.find((item) => item.functionId === FN);
      expect(pending).toMatchObject({
        nextSafeGate: 'own_confirmation_in_chat',
        positiveFollowUp: expect.stringContaining('Ihre eigene Rückmeldung'),
      });
    });

    test('foreign tenant, non-admin, unmapped identity and missing clearance fail closed', async () => {
      const denials = async () => {
        const errors = [];
        for (const attempt of [
          () => call('list', {}, 'person-a'),
          () => call('list', { tenantId: 'synthetic-b' }, 'admin', ['ROLE_TENANT_ADMIN']),
          () => call('mine', { tenantId: 'synthetic-b' }),
          () => call('mine', {}, null),
          () => call('mine', {}, 'person-a', []),
          () => call('list', { sensitivityFlags: ['restricted'] }, 'admin', ['ROLE_TENANT_ADMIN']),
          () => call('mine', { sensitivityFlags: ['restricted'] }),
        ])
          errors.push(
            await attempt().then(
              () => null,
              (error) => [error.code, error.message]
            )
          );
        return errors;
      };
      const empty = await denials();
      expect(empty.every((error) => error && error[0] === 403)).toBe(true);
      await confirmBoth();
      // Identical denials with and without data: no proposal-existence disclosure.
      expect(await denials()).toEqual(empty);
      const foreign = await call('list', {}, 'admin', ['ROLE_TENANT_ADMIN'], 'synthetic-b');
      expect(foreign).toMatchObject({ proposals: [], rows: [] });
      expect((await call('mine', {}, 'person-a', undefined, 'synthetic-b')).rows).toEqual([]);
      expect((await call('mine', {}, 'person-z')).rows).toEqual([]);
    });

    test('repeated reads are side-effect free', async () => {
      await call('refresh', { functionIds: [FN] });
      await call('selectAsk', { conversationId: 'chat-a', functionIds: [FN] });
      const svc = service();
      const spies = ['refresh', 'mutate', 'addSignals', 'confirmRow', 'record'].map((name) =>
        jest.spyOn(svc, name)
      );
      const put = jest.spyOn(svc.db, 'put');
      const emit = jest.spyOn(broker, 'emit');
      const broadcast = jest.spyOn(broker, 'broadcast');
      const calls = jest.spyOn(broker, 'call');
      const stored = await svc.db.allDocs({ include_docs: true });
      for (let index = 0; index < 3; index++) {
        await list();
        await call('mine', {});
        await call('mine', {}, 'person-b');
      }
      for (const spy of [...spies, put, emit, broadcast]) expect(spy).not.toHaveBeenCalled();
      expect(
        calls.mock.calls.every(([action]) =>
          ['role-proposals.list', 'role-proposals.mine'].includes(action)
        )
      ).toBe(true);
      expect(llm.generateStructured).not.toHaveBeenCalled();
      expect(created).toEqual([]);
      expect(await svc.db.allDocs({ include_docs: true })).toEqual(stored);
    });
  });
});
