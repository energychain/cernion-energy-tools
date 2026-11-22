'use strict';

// Balancing pack (micro-agent tier, Phase 1). All services below are STUBS with synthetic test
// data (TEST DATA: no real balance group, market location or rule set).

const { ServiceBroker } = require('moleculer');
const {
  eicCheckCharacter,
  playbooks,
} = require('../src/micro-agents/packs/bilanzierung.expanders');

const TEST_EIC = '11YTEST-BK-0001'; // 15 characters; the check character is appended below
const BK_EIC = `${TEST_EIC}${eicCheckCharacter(`${TEST_EIC}0`)}`;

const REGISTER = [
  {
    key: 'bk_test_nord',
    payload: {
      id: 'bk_test_nord',
      name: 'Testkreis Nord',
      type: 'real',
      status: 'active',
      gridOperatorMastrId: 'SNB000000000001',
      validFrom: '2026-01-01',
      metadata: { eic: BK_EIC },
      participants: [
        { meloId: 'DE000TESTMELO0001', role: 'consumer', share: 1 },
        { meloId: 'DE000TESTMELO0002', role: 'producer', share: 0.5 },
      ],
    },
  },
  {
    key: 'bk_test_sued',
    payload: { id: 'bk_test_sued', name: 'Testkreis Süd', type: 'virtual_vpp', participants: [] },
  },
];

const PROFILES = [
  { id: 'H0', name: 'Haushalt', type: 'standard', description: 'Testprofil Haushalt' },
  { id: 'G0', name: 'Gewerbe allgemein', type: 'standard', description: 'Testprofil Gewerbe' },
];

function stubs(state) {
  return [
    {
      name: 'bilanzkreis',
      actions: {
        list: () => {
          if (state.registerFails) throw new Error('store down');
          return { success: true, count: state.register.length, data: state.register };
        },
      },
    },
    {
      name: 'eic-codes',
      actions: {
        search: async (ctx) => {
          if (state.eicDelayMs)
            await new Promise((resolve) => setTimeout(resolve, state.eicDelayMs));
          return {
            success: true,
            results:
              ctx.params.code === BK_EIC
                ? [{ code: BK_EIC, name: 'Test-Bilanzkreis Nord', country: 'DE', type: 'Area' }]
                : [],
          };
        },
      },
    },
    {
      name: 'slp',
      actions: {
        listProfiles: () => ({ success: true, profiles: PROFILES }),
        getProfile: (ctx) => {
          const values = Array.from({ length: 96 }, (_, index) => (index === 72 ? 0.05 : 0.01));
          return {
            success: true,
            profileId: ctx.params.profileId,
            season: 'winter',
            dayType: 'weekday',
            values,
          };
        },
      },
    },
    {
      name: 'regulatorische-entgeltlogik',
      actions: {
        list: (ctx) => ({
          ruleSets:
            ctx.params.ruleType === 'BALANCING_ENERGY' && state.ruleSets ? state.ruleSets : [],
        }),
      },
    },
  ];
}

describe('micro-agent pack bilanzierung', () => {
  let broker;
  const state = { register: REGISTER, ruleSets: null };
  const expand = (object, context, budget) =>
    broker.call('micro-agent.bilanzierung.expand', { object, context, budget });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(require('../services/micro-agent-bilanzierung.service'));
    for (const schema of stubs(state)) broker.createService(schema);
    await broker.start();
  });
  afterAll(() => broker.stop());
  afterEach(() => {
    state.register = REGISTER;
    state.ruleSets = null;
    state.registerFails = false;
    state.eicDelayMs = 0;
  });

  test('the check character follows the ENTSO-E algorithm on published codes', () => {
    for (const code of [
      '10YDE-RWENET---I',
      '10YDE-VE-------2',
      '10YDE-ENBW-----N',
      '10Y1001A1001A83F',
    ])
      expect(eicCheckCharacter(code)).toBe(code[15]);
  });

  test('the detector recognizes a balance group EIC code', async () => {
    const found = await broker.call('micro-agent.bilanzierung.detect', {
      text: `Bitte prüfe ${BK_EIC} für März.`,
    });
    expect(found.map((row) => [row.kind, row.value])).toEqual([['balancing.group', BK_EIC]]);
  });

  test('a balance group by EIC: parsed format, register entry and directory, with provenance', async () => {
    const finding = await expand({ kind: 'balancing.group', value: BK_EIC });
    const bySource = (source) => finding.facts.filter((fact) => fact.provenance.source === source);
    expect(finding.facts.every((fact) => fact.provenance.source)).toBe(true);
    expect(bySource('eic-format')[0]).toMatchObject({ basis: 'parsed', role: 'status' });
    expect(bySource('eic-format')[0].statement).toContain('gültig');
    expect(bySource('ENTSO-E EIC Reference Manual').map((fact) => fact.value)).toEqual(['Y', '11']);
    expect(bySource('eic-codes.search')[0].statement).toContain('Test-Bilanzkreis Nord');
    const register = bySource('bilanzkreis.list');
    expect(register[0]).toMatchObject({
      value: 'bk_test_nord',
      basis: 'source',
      validFrom: '2026-01-01',
    });
    expect(register.map((fact) => fact.value)).toEqual(
      expect.arrayContaining(['DE000TESTMELO0001', 'DE000TESTMELO0002', '2'])
    );
    expect(finding.negatives).toEqual([]);
    expect(finding.openQuestions[0].resolves).toContain('bilanzkreis.checkReadiness');

    const next = await broker.call('micro-agent.bilanzierung.plan', {
      finding,
      object: { kind: 'balancing.group', value: BK_EIC },
    });
    expect(next.map((row) => [row.kind, row.value])).toEqual([
      ['mako.location_id', 'DE000TESTMELO0001'],
      ['mako.location_id', 'DE000TESTMELO0002'],
    ]);
  });

  test('an invalid check character and an unknown group give a parsed status and negatives with scope', async () => {
    const wrong = `${BK_EIC.slice(0, 15)}${BK_EIC[15] === 'A' ? 'B' : 'A'}`;
    const finding = await expand({ kind: 'balancing.group', value: wrong });
    expect(finding.facts[0].statement).toContain('ungültig');
    expect(finding.negatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          searched: wrong,
          result: 'no_hit',
          scope: expect.stringContaining('eic-codes.search'),
        }),
        expect.objectContaining({
          searched: wrong,
          result: 'no_hit',
          scope: expect.stringContaining('bilanzkreis.list'),
        }),
      ])
    );
    expect(finding.facts.some((fact) => fact.provenance.source === 'bilanzkreis.list')).toBe(false);
  });

  test('a failing service yields a negative, a slow one a timeout, neither throws', async () => {
    state.registerFails = true;
    const failed = await expand({ kind: 'balancing.group', value: 'Testkreis Nord' });
    expect(failed.negatives).toEqual([
      expect.objectContaining({ searched: 'Testkreis Nord', result: 'service_unavailable' }),
    ]);
    state.registerFails = false;
    state.eicDelayMs = 800;
    const slow = await expand({ kind: 'balancing.group', value: BK_EIC }, {}, { timeoutMs: 150 });
    expect(slow.failed).toBe('timeout');
    expect(slow.facts).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 900));
  });

  test('a load profile by its ID returns catalog entry and profile values', async () => {
    const finding = await expand({ kind: 'balancing.profile', value: 'SLP H0' });
    expect(finding.facts.map((fact) => fact.provenance.source)).toEqual([
      'slp.listProfiles',
      'slp.getProfile',
    ]);
    expect(finding.facts[1]).toMatchObject({ value: '18:00', role: 'quantity', basis: 'source' });
  });

  test('an unknown profile is a negative with scope and lists what exists', async () => {
    const finding = await expand({ kind: 'balancing.profile', value: 'RLM' });
    expect(finding.negatives).toEqual([
      expect.objectContaining({
        searched: 'RLM',
        result: 'no_hit',
        scope: expect.stringContaining('slp.listProfiles'),
      }),
    ]);
    expect(finding.facts[0].value).toBe('H0, G0');
  });

  test('a deviation reads balancing energy rule sets and links a named group', async () => {
    state.ruleSets = [
      {
        _id: 'rel:test-1',
        label: 'Testregel AE',
        gridOperatorId: 'TEST-VNB',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        legalBasis: 'Testgrundlage',
      },
    ];
    const finding = await expand({
      kind: 'balancing.deviation',
      value: 'Mindermenge im Testkreis Nord im Februar',
    });
    expect(finding.facts[0]).toMatchObject({
      value: 'rel:test-1',
      validFrom: '2026-01-01',
      provenance: { source: 'regulatorische-entgeltlogik.list', ref: 'rel:test-1' },
    });
    expect(finding.relations).toEqual([
      expect.objectContaining({ rel: 'refers_to', to: 'bilanzkreis:bk_test_nord' }),
    ]);
    const next = await broker.call('micro-agent.bilanzierung.plan', {
      finding,
      object: { kind: 'balancing.deviation' },
    });
    expect(next.map((row) => [row.kind, row.value])).toEqual([['balancing.group', 'bk_test_nord']]);
  });

  test('a deviation without rule sets or group gives a negative and an open question', async () => {
    const finding = await expand({ kind: 'balancing.deviation', value: 'Mehrmenge Januar' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives[0]).toMatchObject({
      result: 'no_hit',
      scope: expect.stringContaining('BALANCING_ENERGY'),
    });
    expect(finding.openQuestions).toHaveLength(1);
  });

  test('concern without consequenceOf: register summary and literally named groups', async () => {
    const finding = await expand({
      kind: 'concern',
      value: 'Wie steht der Testkreis Süd gerade da?',
    });
    expect(finding.facts.map((fact) => fact.value)).toEqual(['bk_test_sued', '2']);
    expect(finding.facts.every((fact) => fact.provenance.source === 'bilanzkreis.list')).toBe(true);
    expect(finding.negatives).toEqual([]);
    expect(finding.openQuestions).toEqual([]);
  });

  test('concern with consequenceOf: matches by EIC in the reason or names the gap', async () => {
    const hit = await expand(
      { kind: 'concern', value: 'Messwerte fehlen.' },
      { consequenceOf: `Ausfall betrifft ${BK_EIC}` }
    );
    expect(hit.relations).toEqual([
      expect.objectContaining({ rel: 'refers_to', to: 'bilanzkreis:bk_test_nord' }),
    ]);
    const miss = await expand(
      { kind: 'concern', value: 'Messwerte fehlen.' },
      { consequenceOf: 'Lieferantenwechsel zum 1. des Monats' }
    );
    expect(miss.relations).toEqual([]);
    expect(miss.negatives[0]).toMatchObject({
      result: 'no_hit',
      scope: expect.stringContaining('bilanzkreis.list'),
    });
    expect(miss.openQuestions[0].resolves).toBe('Lieferantenwechsel zum 1. des Monats');
    state.register = [];
    const empty = await expand({ kind: 'concern', value: 'Bilanzkreise?' });
    expect(empty.negatives[0]).toMatchObject({ result: 'empty' });
  });

  test('unsupported kinds are refused, playbooks only cover declared kinds', async () => {
    const finding = await expand({ kind: 'billing.invoice', value: 'R-1' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
    expect(playbooks.map((row) => row.from)).toEqual([
      'balancing.group',
      'balancing.deviation',
      'concern',
    ]);
  });
});
