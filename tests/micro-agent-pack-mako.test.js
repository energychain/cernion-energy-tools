'use strict';

// Tests of the market-communication pack (micro-agent tier, Phase 1). Every service below is a
// STUB with synthetic TEST DATA (codes, ids, titles); no network and no real model.

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));

const { ServiceBroker, Errors } = require('moleculer');
const llm = require('../src/llm-client');

const PARTNER = '9900000000017';
const RECEIVER = '9900000000024';
const MALO = '41373559241';
const MALO_BAD_CHECK = '41373559242';
const MELO_UNKNOWN = 'DE0000000000000000000000000000001';
const MELO_SLOW = 'DE0000000000000000000000000000002';
const DEADLINE_QUOTE = 'Die Anmeldung ist spätestens zehn Werktage vor Lieferbeginn zu senden.';

const WILLI_RESULTS = {
  APERAK: [
    {
      id: 'test-aperak',
      title: 'TESTDATEN APERAK Anwendungsfehlermeldung',
      url: 'https://example.test/aperak',
      excerpt: 'APERAK meldet Anwendungsfehler einer empfangenen Nachricht.',
    },
  ],
  Z18: [
    {
      id: 'test-z18',
      title: 'TESTDATEN Fehlercode Z18',
      url: 'https://example.test/z18',
      excerpt: 'Der Code Z18 steht in diesen Testdaten für eine unbekannte Lokation.',
    },
  ],
  Z99: [
    {
      id: 'test-other',
      title: 'TESTDATEN anderer Code',
      url: 'https://example.test/other',
      excerpt: 'Ein Artikel über Z990, nicht über den gesuchten Code.',
    },
  ],
  Lieferbeginn: [
    {
      id: 'test-lieferbeginn',
      title: 'TESTDATEN Prozess Lieferbeginn',
      url: 'https://example.test/lieferbeginn',
      excerpt: 'Prozess Lieferbeginn.',
      content: `Prozess Lieferbeginn. ${DEADLINE_QUOTE} Danach folgt die Bestätigung.`,
    },
  ],
};

function stubServices(broker) {
  broker.createService({
    name: 'willi-mako',
    actions: {
      search(ctx) {
        const { query } = ctx.params;
        if (query.includes('Abschaltung'))
          return { success: false, error: { code: 'KNOWLEDGE_SOURCE_DISABLED' } };
        if (query.includes('Zeitueberschreitung'))
          throw new Errors.RequestTimeoutError({ action: 'willi-mako.search', nodeID: 'test' });
        // Codes first, so a query that also names the message type finds the code article.
        const key = ['Z18', 'Z99', 'Lieferbeginn', 'APERAK'].find((word) => query.includes(word));
        return { success: true, data: { results: key ? WILLI_RESULTS[key] : [] } };
      },
    },
  });
  broker.createService({
    name: 'grid-operations',
    actions: {
      marketPartners(ctx) {
        if (ctx.params.query !== PARTNER) return { results: [], count: 0 };
        return {
          results: [
            {
              bdew: PARTNER,
              name: 'TESTDATEN Netz GmbH',
              city: 'Teststadt',
              postalCode: '00000',
              roles: ['VNB'],
            },
          ],
          count: 1,
        };
      },
    },
  });
  broker.createService({
    name: 'edm',
    actions: {
      async getMelo(ctx) {
        if (ctx.params.meloId === MELO_SLOW)
          await new Promise((resolve) => setTimeout(resolve, 400));
        if (ctx.params.meloId !== MALO)
          throw new Errors.MoleculerClientError('MeLo not found', 404, 'MELO_NOT_FOUND');
        return {
          success: true,
          data: {
            meloId: MALO,
            type: 'physical',
            name: 'TESTDATEN Lokation',
            spannungsebene: 'NS',
            messkonzeptId: 'MK-TEST-1',
            obisRegisters: [{ obis: '1-0:1.8.0' }],
          },
        };
      },
    },
  });
}

const APERAK = [
  `UNB+UNOC:3+${PARTNER}:500+${RECEIVER}:500+261122:1200+REF1'`,
  "UNH+1+APERAK:D:07B:UN:2.1i'",
  "BGM+313+DOC1'",
  "DTM+137:202611221200:203'",
  "RFF+ACE:ORIG1'",
  `NAD+MR+${RECEIVER}::293'`,
  "ERC+Z18'",
  "UNT+7+1'",
  "UNZ+1+REF1'",
].join('');

describe('micro-agent pack mako', () => {
  let broker;
  const expand = (object, context, budget) =>
    broker.call('micro-agent.mako.expand', { object, context, budget });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    stubServices(broker);
    broker.createService(require('../services/micro-agent-mako.service'));
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    llm.generateStructured.mockReset();
    llm.generateStructured.mockResolvedValue({ picks: [] });
  });

  test('detect finds market partner codes and location ids by format only', async () => {
    const found = await broker.call('micro-agent.mako.detect', {
      text: `Partner ${PARTNER}, MaLo ${MALO}, falsch ${MALO_BAD_CHECK}, ZP ${MELO_UNKNOWN}.`,
    });
    expect(found.map((row) => [row.kind, row.value])).toEqual([
      ['market.partner_code', PARTNER],
      ['mako.location_id', MALO],
      ['mako.location_id', MELO_UNKNOWN],
    ]);
  });

  test('a message header is parsed deterministically and explained from Willi-Mako', async () => {
    const finding = await expand({
      kind: 'edifact.message',
      value: 'APERAK',
      provenance: { quote: 'UNH+1+APERAK:D:07B:UN:2.1i' },
    });
    const parsed = finding.facts.filter((fact) => fact.basis === 'parsed');
    expect(parsed.map((fact) => fact.value)).toEqual(['APERAK', '1', 'D:07B:UN:2.1i']);
    expect(parsed.every((fact) => fact.provenance.source === 'edifact-base.tokenizeSegments')).toBe(
      true
    );
    const sourced = finding.facts.filter((fact) => fact.basis === 'source');
    expect(sourced[0].provenance).toMatchObject({
      source: 'willi-mako.search',
      ref: 'https://example.test/aperak',
    });
    expect(finding.openQuestions).toHaveLength(1);
  });

  test('a full interchange yields codes, parties and follow-up objects', async () => {
    const object = { objectId: 'O2', kind: 'edifact.message', value: APERAK };
    const finding = await expand(object);
    const values = finding.facts.map((fact) => fact.value);
    expect(values).toEqual(expect.arrayContaining(['Z18', PARTNER, RECEIVER, 'APERAK']));
    expect(finding.facts.find((fact) => fact.value === 'Z18').provenance).toMatchObject({
      source: 'edifact-message-adapter.parse',
      quote: 'ERC+Z18',
    });
    const next = await broker.call('micro-agent.mako.plan', { finding, object });
    expect(next.map((row) => [row.kind, row.value])).toEqual([
      ['mako.response_code', 'Z18'],
      ['market.partner_code', PARTNER],
      ['market.partner_code', RECEIVER],
    ]);
    expect(next[0].label).toBe('APERAK ERC');
  });

  test('a market partner code is resolved with provenance, an unknown one with scope', async () => {
    const known = await expand({ kind: 'market.partner_code', value: PARTNER });
    const fromSource = known.facts.filter((fact) => fact.basis === 'source');
    expect(fromSource.map((fact) => fact.value)).toEqual([
      'TESTDATEN Netz GmbH',
      'VNB',
      '00000 Teststadt',
    ]);
    expect(fromSource[0].provenance).toMatchObject({
      source: 'grid-operations.marketPartners',
      ref: `bdew:${PARTNER}`,
    });
    const unknown = await expand({ kind: 'market.partner_code', value: RECEIVER });
    expect(unknown.negatives).toEqual([
      expect.objectContaining({ searched: RECEIVER, result: 'no_hit' }),
    ]);
    expect(unknown.negatives[0].scope).toMatch(/grid-operations\.marketPartners/u);
  });

  test('location ids: check digit as a rule, register data as source, unknown with scope', async () => {
    const known = await expand({ kind: 'mako.location_id', value: MALO });
    expect(known.facts.find((fact) => fact.role === 'status')).toMatchObject({
      value: 'gültig',
      basis: 'rule',
    });
    expect(
      known.facts.filter((fact) => fact.provenance.source === 'edm.getMelo').map((f) => f.value)
    ).toEqual(expect.arrayContaining(['physical', 'MK-TEST-1', '1-0:1.8.0']));

    const badCheck = await expand({ kind: 'mako.location_id', value: MALO_BAD_CHECK });
    expect(badCheck.facts.find((fact) => fact.role === 'status').value).toBe('ungültig');
    expect(badCheck.negatives[0]).toMatchObject({ searched: MALO_BAD_CHECK, result: 'no_hit' });
    expect(badCheck.negatives[0].scope).toMatch(/edm\.getMelo/u);

    const unknown = await expand({ kind: 'mako.location_id', value: 'ABC' });
    expect(unknown.facts).toEqual([]);
    expect(unknown.negatives[0].result).toBe('format_mismatch');
  });

  test('a process deadline is accepted only as a verbatim quote of the source', async () => {
    llm.generateStructured.mockResolvedValue({
      picks: [
        { source: 'S1', quote: DEADLINE_QUOTE, role: 'deadline' },
        { source: 'S1', quote: 'Die Frist beträgt zwei Wochen nach Eingang.', role: 'deadline' },
      ],
    });
    const finding = await expand({ kind: 'mako.process', value: 'Lieferbeginn' });
    const deadlines = finding.facts.filter((fact) => fact.role === 'deadline');
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({
      basis: 'source',
      provenance: { source: 'willi-mako.search', quote: DEADLINE_QUOTE },
    });
    expect(llm.generateStructured.mock.calls[0][2]).toMatchObject({ phase: 'micro_agent_mako' });
    expect(finding.openQuestions).toEqual([]);
  });

  test('a response code needs the exact code in the source, else a negative with scope', async () => {
    const known = await expand({ kind: 'mako.response_code', value: 'Z18', label: 'APERAK ERC' });
    expect(known.facts[0].provenance.ref).toBe('https://example.test/z18');
    const other = await expand({ kind: 'mako.response_code', value: 'Z99' });
    expect(other.facts).toEqual([]);
    expect(other.negatives[0]).toMatchObject({ searched: 'Z99 Code', result: 'no_hit' });
    expect(other.negatives[0].scope).toMatch(/willi-mako\.search/u);
  });

  test('an unsupported kind is refused', async () => {
    const finding = await expand({ kind: 'netz.asset', value: 'X' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
  });

  test('timeouts and disabled sources never throw', async () => {
    const slow = await expand(
      { kind: 'mako.location_id', value: MELO_SLOW },
      {},
      { timeoutMs: 100 }
    );
    expect(slow.failed).toBe('timeout');
    expect(slow.facts).toEqual([]);

    const timedOut = await expand({ kind: 'concern', value: 'Zeitueberschreitung beim Abruf' });
    expect(timedOut.negatives[0].result).toBe('source_timeout');

    const disabled = await expand({ kind: 'concern', value: 'Abschaltung der Quelle' });
    expect(disabled.negatives[0]).toMatchObject({ result: 'source_disabled' });
    expect(disabled.negatives[0].scope).toMatch(/Willi-Mako/u);

    llm.generateStructured.mockImplementation(() => new Promise(() => {}));
    const hangingModel = await expand({ kind: 'mako.process', value: 'Lieferbeginn' });
    expect(hangingModel.failed).toBeUndefined();
    expect(hangingModel.facts.map((fact) => fact.role)).toEqual(['reference']);
  });

  test('the concern is expanded with and without a consequence of another area', async () => {
    const plain = await expand({ kind: 'concern', value: 'Wie läuft der Lieferbeginn?' });
    expect(plain.facts[0].provenance.source).toBe('willi-mako.search');
    expect(plain.relations).toEqual([]);

    llm.generateStructured.mockResolvedValue({
      picks: [{ source: 'S1', quote: DEADLINE_QUOTE, role: 'deadline' }],
    });
    const touched = await expand(
      { kind: 'concern', value: 'Wechsel zum 1.1.' },
      { consequenceOf: 'Vertrieb plant einen Lieferbeginn für Testkunden' }
    );
    expect(touched.facts[0].statement).toMatch(/^Bezug zur Marktkommunikation: /u);
    expect(touched.relations).toEqual([
      { from: 'concern', rel: 'affects', to: 'Vertrieb plant einen Lieferbeginn für Testkunden' },
    ]);

    llm.generateStructured.mockResolvedValue({ picks: [] });
    const untouched = await expand(
      { kind: 'concern', value: 'Wechsel zum 1.1.' },
      { consequenceOf: 'Vertrieb plant einen Lieferbeginn für Testkunden' }
    );
    expect(untouched.facts).toEqual([]);
    expect(untouched.negatives[0]).toMatchObject({ result: 'no_relevant_quote' });
  });
});
