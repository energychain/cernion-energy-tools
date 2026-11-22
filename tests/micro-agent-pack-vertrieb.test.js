'use strict';

/**
 * Pack "vertrieb" (micro-agent tier, Phase 1). All data below is SYNTHETIC TEST DATA: the stub
 * services stand in for slp, energy-sharing and energy-sharing-community; no network, no LLM.
 */

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));

const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const { packService, packDefinition } = require('../src/micro-agents/pack-service');

const TENANT = 'tenant-test';
const PROFILES = [
  { id: 'H0', name: 'Haushalt', type: 'standard', description: 'BDEW Haushaltsprofil (Test)' },
  { id: 'G0', name: 'Gewerbe allgemein', type: 'standard', description: 'BDEW Gewerbe (Test)' },
  { id: 'X9', name: 'Eigenes Profil', type: 'custom', owner: 'someone' },
];
const VALIDATIONS = [
  {
    id: 'val-2',
    communityId: 'ES-TEST-001',
    communityName: 'Testgemeinschaft Nord',
    decision: 'APPROVED_WITH_CONDITIONS',
    findingsCount: 3,
    createdAt: '2026-10-02T08:00:00.000Z',
  },
  {
    id: 'val-1',
    communityId: 'ES-TEST-001',
    communityName: 'Testgemeinschaft Nord',
    decision: 'REJECTED_STRUCTURAL',
    findingsCount: 5,
    createdAt: '2026-09-01T08:00:00.000Z',
  },
];
const COMMUNITY = {
  id: 'uuid-test',
  tenantId: TENANT,
  communityId: 'ES-TEST-001',
  name: 'Testgemeinschaft Nord',
  updatedAt: '2026-10-03T00:00:00.000Z',
  members: [
    {
      memberId: 'm1',
      maloId: 'DE0000000000000000000000000000001',
      name: 'Testperson Eins',
      roles: ['consumer'],
      validFrom: '2026-01-01',
      validTo: null,
    },
    {
      memberId: 'm2',
      mastrNummer: 'SEE900000000001',
      name: 'Testanlage',
      roles: ['generator'],
      validFrom: '2026-01-01',
      validTo: null,
    },
    {
      memberId: 'm3',
      maloId: 'DE0000000000000000000000000000002',
      name: 'Testperson Ausgeschieden',
      roles: ['consumer'],
      validFrom: '2025-01-01',
      validTo: '2025-12-31',
    },
  ],
};

const seen = { tenants: [] };
let slow = false;

function stubs() {
  return [
    {
      name: 'slp',
      actions: {
        async listProfiles() {
          if (slow) await new Promise((resolve) => setTimeout(resolve, 2000).unref());
          return { success: true, profiles: PROFILES };
        },
      },
    },
    {
      name: 'energy-sharing',
      actions: {
        list(ctx) {
          seen.tenants.push(ctx.meta.tenantId);
          const rows = VALIDATIONS.filter(() => (ctx.meta.tenantId || 'default') === TENANT).filter(
            (row) => !ctx.params.communityId || row.communityId === ctx.params.communityId
          );
          return { count: rows.length, validations: rows };
        },
      },
    },
    {
      name: 'energy-sharing-community',
      actions: {
        getCommunity(ctx) {
          if (ctx.params.id === 'ES-OTHER-TENANT')
            return { success: true, ...COMMUNITY, tenantId: 'another-tenant' };
          if (ctx.params.id === COMMUNITY.communityId) return { success: true, ...COMMUNITY };
          return { success: false, message: 'not found' };
        },
      },
    },
  ];
}

const expand = (broker, object, context = {}) =>
  broker.call('micro-agent.vertrieb.expand', {
    object,
    context: { tenantId: TENANT, ...context },
  });
const sources = (finding) => finding.facts.map((fact) => fact.provenance.source);
const text = (finding) => JSON.stringify(finding);

describe('micro-agent pack vertrieb', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(packService('vertrieb'));
    for (const stub of stubs()) broker.createService(stub);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    llm.generateStructured.mockReset();
    slow = false;
  });

  test('the definition declares one expander per object kind plus concern', () => {
    const definition = packDefinition('vertrieb');
    const kinds = definition.objectKinds.map((row) => row.kind);
    expect(Object.keys(definition.expanders).sort()).toEqual([...kinds, 'concern'].sort());
  });

  test('a profile code as segment yields a source fact with provenance', async () => {
    const finding = await expand(broker, { kind: 'customer.segment', value: 'H0' });
    const fact = finding.facts.find((row) => row.value === 'H0');
    expect(fact).toMatchObject({ basis: 'source', role: 'classification' });
    expect(fact.provenance.source).toBe('slp.listProfiles');
    expect(fact.provenance.quote).toContain('Haushalt');
    expect(llm.generateStructured).not.toHaveBeenCalled();
    // The missing customer source is stated with its scope.
    expect(finding.negatives.some((row) => row.result === 'no_read_source' && row.scope)).toBe(
      true
    );
  });

  test('a descriptive segment is picked from the catalog only with a verbatim quote', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      matches: [
        { profileId: 'G0', quote: 'Gewerbe allgemein' },
        { profileId: 'H0', quote: 'nicht im Katalog' },
        { profileId: 'X9', quote: 'Eigenes Profil' },
      ],
    });
    const finding = await expand(broker, { kind: 'customer.segment', value: 'Gewerbekunden' });
    expect(llm.generateStructured).toHaveBeenCalledTimes(1);
    expect(llm.generateStructured.mock.calls[0][2]).toMatchObject({
      phase: 'micro_agent_vertrieb',
    });
    expect(finding.facts.map((row) => row.value)).toEqual(['G0']);
    expect(finding.facts[0].provenance).toMatchObject({
      source: 'slp.listProfiles',
      quote: 'Gewerbe allgemein',
    });
  });

  test('an unknown segment is an honest negative with scope', async () => {
    llm.generateStructured.mockResolvedValueOnce({ matches: [] });
    const finding = await expand(broker, { kind: 'customer.segment', value: 'Studierende' });
    expect(finding.facts).toEqual([]);
    const negative = finding.negatives.find(
      (row) => row.searched === 'Studierende' && row.scope.includes('slp.listProfiles')
    );
    expect(negative.scope).toContain('slp.listProfiles');
    expect(negative.result).toBe('no_hit');
  });

  test('a community as segment yields counts only, never member data', async () => {
    const finding = await expand(broker, { kind: 'customer.segment', value: 'ES-TEST-001' });
    expect(sources(finding)).toContain('energy-sharing-community.getCommunity');
    const counts = finding.facts.find((row) => row.role === 'quantity');
    expect(counts.value).toBe('2');
    expect(text(finding)).not.toContain('DE0000000000000000000000000000001');
    expect(text(finding)).not.toContain('Testperson');
    expect(text(finding)).not.toContain('SEE900000000001');
    expect(finding.openQuestions.some((row) => row.question.includes('Teilnehmerdaten'))).toBe(
      true
    );
  });

  test('a community of another tenant is not a hit', async () => {
    llm.generateStructured.mockResolvedValueOnce({ matches: [] });
    const finding = await expand(broker, { kind: 'customer.segment', value: 'ES-OTHER-TENANT' });
    expect(sources(finding)).not.toContain('energy-sharing-community.getCommunity');
    expect(
      finding.negatives.some(
        (row) => row.searched === 'ES-OTHER-TENANT' && row.scope.includes(TENANT)
      )
    ).toBe(true);
  });

  test('a product with a community ID yields the application status and a follow-up', async () => {
    const finding = await expand(broker, { kind: 'customer.product', value: 'ES-TEST-001' });
    const status = finding.facts.find((row) => row.role === 'status');
    expect(status).toMatchObject({ value: 'APPROVED_WITH_CONDITIONS', basis: 'source' });
    expect(status.provenance).toMatchObject({ source: 'energy-sharing.list' });
    expect(status.provenance.ref).toContain('val-2');
    expect(finding.facts.some((row) => row.role === 'quantity' && row.value === '2')).toBe(true);
    expect(seen.tenants).toContain(TENANT);
    const next = await broker.call('micro-agent.vertrieb.plan', {
      finding,
      object: { kind: 'customer.product', value: 'ES-TEST-001' },
    });
    expect(next).toEqual([
      expect.objectContaining({ kind: 'customer.segment', value: 'ES-TEST-001' }),
    ]);
  });

  test('a tariff without a read source is a negative with scope and an open question', async () => {
    const finding = await expand(broker, { kind: 'customer.product', value: 'Ökostrom Plus' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives[0]).toMatchObject({ result: 'no_read_source' });
    expect(finding.negatives[0].scope).toBeTruthy();
    expect(finding.openQuestions.length).toBeGreaterThan(0);
  });

  test('unsupported kinds are refused', async () => {
    const finding = await expand(broker, { kind: 'grid.meter', value: 'X' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('the concern matches identifiers against source keys', async () => {
    const finding = await expand(broker, {
      kind: 'concern',
      value: 'Wie steht es um ES-TEST-001 und das Profil H0?',
    });
    expect(sources(finding)).toEqual(
      expect.arrayContaining(['energy-sharing.list', 'slp.listProfiles'])
    );
    expect(finding.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ to: 'energy-sharing-community:ES-TEST-001' }),
      ])
    );
  });

  test('the concern without hits and with consequenceOf returns scoped negatives', async () => {
    const plain = await expand(broker, { kind: 'concern', value: 'Wie läuft die Kampagne?' });
    expect(plain.facts).toEqual([]);
    expect(plain.negatives.some((row) => row.result === 'no_hit' && row.scope)).toBe(true);

    const consequence = await expand(
      broker,
      { kind: 'concern', value: 'Preisanpassung zum Jahreswechsel' },
      { consequenceOf: 'Abrechnung meldet geänderte Netzentgelte' }
    );
    expect(consequence.facts).toEqual([]);
    expect(
      consequence.negatives.some((row) => row.searched.includes('Befund des anderen Bereichs'))
    ).toBe(true);
    expect(consequence.openQuestions.length).toBeGreaterThan(0);
  });

  test('a slow source does not throw', async () => {
    slow = true;
    const finding = await broker.call('micro-agent.vertrieb.expand', {
      object: { kind: 'customer.segment', value: 'H0' },
      context: { tenantId: TENANT },
      budget: { timeoutMs: 1500 },
    });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives.some((row) => row.result === 'source_unavailable')).toBe(true);
  });
});
