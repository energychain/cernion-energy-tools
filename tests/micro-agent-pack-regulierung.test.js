'use strict';

// Pack "regulierung" (micro-agent tier, Phase 1). All data below is synthetic test data; the
// stub services stand in for the read actions the expanders call. No network, no real model.

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));

const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const packSchema = require('../services/micro-agent-regulierung.service');
const { sectionCitations } = require('../src/micro-agents/packs/regulierung.expanders');

const READ_ACTIONS = ['willi-regulatorik.search', 'regulatorische-entgeltlogik.list'];
const calls = [];

// Synthetic articles (TESTDATEN).
const ARTICLES = [
  {
    id: 'test-wr-1',
    slug: 'test-artikel-steuerbare-verbrauchseinrichtungen',
    title: 'TESTDATEN: Steuerbare Verbrauchseinrichtungen',
    score: 30,
    category: 'regulatory',
    tags: ['Testdaten'],
    excerpt: 'TESTDATEN. Der Artikel erläutert §14a EnWG und die Festlegung BK6-22-300.',
    content:
      'TESTDATEN.\nNetzbetreiber setzen § 14a Abs. 1 EnWG nach der Festlegung BK6-22-300 um.\nDie Meldung an die Testbehörde ist bis zum 31.03.2099 abzugeben.',
    url: 'https://example.invalid/test-wr-1',
  },
  {
    id: 'test-wr-2',
    title: 'TESTDATEN: Ein Artikel ohne den gesuchten Verweis',
    excerpt: 'TESTDATEN. Allgemeine Hinweise zur Anreizregulierung nach § 4 ARegV.',
    url: 'https://example.invalid/test-wr-2',
  },
];

// Synthetic rule sets of the tariff rule registry (TESTDATEN).
const RULE_SETS = [
  {
    _id: 'rel:test-1',
    gridOperatorId: 'TEST-NB-1',
    ruleType: 'DYNAMIC_FEE_14A',
    label: 'TESTDATEN Modul 2',
    legalBasis: '§ 14a EnWG i.V.m. BK8-22-010',
    effectiveFrom: '2099-01-01',
    effectiveTo: null,
  },
  {
    _id: 'rel:test-2',
    gridOperatorId: 'TEST-NB-1',
    ruleType: 'NETWORK_USAGE_FEE',
    label: 'TESTDATEN Netzentgelt',
    legalBasis: '§ 21a EnWG, § 17 StromNEV',
    effectiveFrom: '2098-01-01',
    effectiveTo: '2098-12-31',
  },
];

function stubs() {
  return [
    {
      name: 'willi-regulatorik',
      actions: {
        async search(ctx) {
          calls.push('willi-regulatorik.search');
          const query = String(ctx.params.query);
          if (query.includes('AUSFALL'))
            return { success: false, error: { code: 'MCP_ERROR', message: 'test' } };
          if (query.includes('LANGSAM'))
            await new Promise((resolve) => setTimeout(resolve, 2600).unref());
          if (query.includes('LEER')) return { success: true, data: { returned: 0, results: [] } };
          const results = ARTICLES.slice(0, ctx.params.limit).map((article) =>
            ctx.params.includeContent ? article : { ...article, content: undefined }
          );
          return { success: true, data: { returned: results.length, results } };
        },
      },
    },
    {
      name: 'regulatorische-entgeltlogik',
      actions: {
        list() {
          calls.push('regulatorische-entgeltlogik.list');
          return { ruleSets: RULE_SETS };
        },
      },
    },
  ];
}

describe('micro-agent pack regulierung', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(packSchema);
    for (const stub of stubs()) broker.createService(stub);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    calls.length = 0;
    llm.generateStructured.mockReset();
  });

  const expand = (object, context) =>
    broker.call('micro-agent.regulierung.expand', { object, context });

  test('detects section references and ruling numbers by format', async () => {
    const found = await broker.call('micro-agent.regulierung.detect', {
      text: 'Gilt § 14a EnWG auch nach BK6-22-300?',
    });
    expect(found.map((row) => [row.kind, row.value])).toEqual([
      ['reg.section', '§ 14a EnWG'],
      ['reg.ruling', 'BK6-22-300'],
    ]);
    expect(sectionCitations('§ 14a Abs. 1 EnWG und §17 StromNEV')).toEqual([
      { number: '14a', act: 'EnWG' },
      { number: '17', act: 'StromNEV' },
    ]);
  });

  test('a section yields source and rule facts with provenance, read actions only', async () => {
    const finding = await expand({ objectId: 'O2', kind: 'reg.section', value: '§ 14a EnWG' });
    const article = finding.facts.find((fact) => fact.basis === 'source');
    expect(article).toMatchObject({
      role: 'reference',
      provenance: { source: 'willi-regulatorik.search', ref: 'https://example.invalid/test-wr-1' },
    });
    expect(ARTICLES[0].excerpt).toContain(article.provenance.quote);
    // The article without the reference is no fact.
    expect(finding.facts.some((fact) => fact.value.includes('ohne den gesuchten'))).toBe(false);
    const rule = finding.facts.find((fact) => fact.basis === 'rule' && fact.role !== 'reference');
    expect(rule).toMatchObject({
      value: 'rel:test-1',
      validFrom: '2099-01-01',
      provenance: {
        source: 'regulatorische-entgeltlogik.list',
        ref: 'rel:test-1',
        quote: '§ 14a EnWG i.V.m. BK8-22-010',
      },
    });
    expect(finding.facts.map((fact) => fact.value)).toContain('BK8-22-010');
    expect(finding.facts.every((fact) => fact.provenance.source)).toBe(true);
    expect(new Set(calls)).toEqual(new Set(READ_ACTIONS));
    expect(finding.dropped).toBe(0);
  });

  test('the playbook follows references of the same legal basis', async () => {
    const object = { objectId: 'O2', kind: 'reg.section', value: '§ 21a EnWG' };
    const finding = await expand(object);
    const next = await broker.call('micro-agent.regulierung.plan', { finding, object });
    expect(next.map((row) => [row.kind, row.value])).toEqual([['reg.section', '§ 17 StromNEV']]);
    const ruling = { objectId: 'O3', kind: 'reg.ruling', value: 'BK8-22-010' };
    const fromRuling = await broker.call('micro-agent.regulierung.plan', {
      finding: await expand(ruling),
      object: ruling,
    });
    expect(fromRuling.map((row) => [row.kind, row.value])).toEqual([['reg.section', '§ 14a EnWG']]);
  });

  test('a ruling without a hit yields negatives with their scope', async () => {
    const finding = await expand({ objectId: 'O3', kind: 'reg.ruling', value: 'BK7-99-001' });
    expect(finding.facts).toEqual([]);
    expect(finding.negatives).toHaveLength(2);
    for (const negative of finding.negatives) {
      expect(negative.searched).toContain('BK7-99-001');
      expect(negative.scope.length).toBeGreaterThan(10);
    }
    expect(finding.negatives.map((row) => row.result)).toEqual(['no_literal_mention', 'no_hit']);
  });

  test('unsupported kinds are refused', async () => {
    const finding = await expand({ kind: 'mako.message', value: 'UTILMD' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('an obligation keeps only deadlines whose quote occurs verbatim in the source', async () => {
    llm.generateStructured.mockResolvedValue({
      deadlines: [
        {
          articleId: 'test-wr-1',
          value: '31.03.2099',
          quote: 'Die Meldung an die Testbehörde ist bis zum 31.03.2099 abzugeben.',
        },
        // Not in the source text.
        { articleId: 'test-wr-1', value: '30.06.2099', quote: 'Frist bis 30.06.2099.' },
        // Value not in the quote.
        { articleId: 'test-wr-1', value: '01.01.2099', quote: 'TESTDATEN.' },
      ],
    });
    const finding = await expand(
      { objectId: 'O4', kind: 'reg.obligation', value: 'Meldung an die Testbehörde' },
      { tenantId: 't-test' }
    );
    const deadlines = finding.facts.filter((fact) => fact.role === 'deadline');
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({
      value: '31.03.2099',
      basis: 'source',
      provenance: {
        source: 'willi-regulatorik.search',
        quote: 'Die Meldung an die Testbehörde ist bis zum 31.03.2099 abzugeben.',
      },
    });
    expect(finding.expectations).toEqual([
      expect.objectContaining({ dueFactId: deadlines[0].factId, basis: 'source' }),
    ]);
    const [, , options] = llm.generateStructured.mock.calls[0];
    expect(options).toMatchObject({
      phase: 'micro_agent_regulierung',
      tenantId: 't-test',
      structuredFallback: false,
    });
    expect(options.timeoutMs).toBeLessThanOrEqual(2500);
  });

  test('an obligation without a deadline in the source says where it looked', async () => {
    llm.generateStructured.mockResolvedValue({ deadlines: [] });
    const finding = await expand({ objectId: 'O4', kind: 'reg.obligation', value: 'Meldepflicht' });
    expect(finding.facts.some((fact) => fact.role === 'deadline')).toBe(false);
    expect(finding.negatives).toEqual([
      expect.objectContaining({
        result: 'no_deadline_in_source',
        searched: 'Frist zu Meldepflicht',
      }),
    ]);
    llm.generateStructured.mockRejectedValue(new Error('model down'));
    const failed = await expand({ objectId: 'O4', kind: 'reg.obligation', value: 'Meldepflicht' });
    expect(failed.failed).toBeUndefined();
    expect(failed.facts.length).toBeGreaterThan(0);
    expect(failed.openQuestions.length).toBe(1);
  });

  test('a slow or failing source does not throw and leaves an open question', async () => {
    const slow = await expand({ objectId: 'O5', kind: 'reg.obligation', value: 'LANGSAM' });
    expect(slow.failed).toBeUndefined();
    expect(slow.facts).toEqual([]);
    expect(slow.openQuestions[0].question).toMatch(/nicht erreichbar/u);
    const down = await expand({ objectId: 'O5', kind: 'reg.section', value: '§ 1 AUSFALL EnWG' });
    expect(down.failed).toBeUndefined();
    expect(down.openQuestions.length).toBeGreaterThan(0);
  }, 10000);

  test('concern with and without consequenceOf', async () => {
    const plain = await expand({ objectId: 'O1', kind: 'concern', value: 'Was gilt für uns?' });
    expect(plain.facts).toHaveLength(2);
    expect(plain.facts[0].statement).toMatch(/^Zum Anliegen/u);
    expect(plain.relations.every((row) => row.rel === 'refers_to')).toBe(true);
    const consequence = await expand(
      { objectId: 'O1', kind: 'concern', value: 'Was gilt für uns?' },
      { consequenceOf: 'Neue steuerbare Verbrauchseinrichtung angemeldet' }
    );
    expect(consequence.facts[0].statement).toMatch(/^Zur Folge „Neue steuerbare/u);
    expect(consequence.relations.every((row) => row.rel === 'affects')).toBe(true);
    const none = await expand(
      { objectId: 'O1', kind: 'concern', value: 'x' },
      { consequenceOf: 'LEER' }
    );
    expect(none.facts).toEqual([]);
    expect(none.negatives[0]).toMatchObject({ searched: 'LEER', result: 'no_hit' });
    expect(none.negatives[0].scope).toMatch(/Folgeprüfung/u);
    expect(llm.generateStructured).not.toHaveBeenCalled();
  });
});
