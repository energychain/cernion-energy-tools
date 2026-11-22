'use strict';

const { ServiceBroker } = require('moleculer');
const { packService } = require('../src/micro-agents/pack-service');

// SYNTHETIC TEST DATA ONLY: every number, identifier and name below is invented for the test
// and stands for no real market value, tenant, contract or installation.
const RUN_ID = 'a'.repeat(64);
const OPERATOR = 'SNB900000000001';
const UNIT = 'SEE900000000001';

const calls = [];
let slow = false;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const record = (action) => (ctx) => {
  calls.push({ action, params: ctx.params });
};

function stubs() {
  return [
    {
      name: 'entsoe',
      actions: {
        async dayAheadPrices(ctx) {
          record('entsoe.dayAheadPrices')(ctx);
          if (slow) await delay(1500);
          if (ctx.params.dateFrom === '2026-01-05')
            return { success: true, region: 'Germany', prices: [] };
          return {
            success: true,
            region: 'Germany',
            eicCode: '10Y1001A1001A82H',
            resolution: 'PT15M',
            currency: 'EUR',
            unit: 'MWh',
            prices: [{ timestamp: `${ctx.params.dateFrom}T00:00:00Z`, price: 81.5 }],
            statistics: { avgPrice: 91.234, minPrice: 12.5, maxPrice: 201, totalDataPoints: 96 },
            metadata: { source: 'TEST ENTSO-E', documentType: 'A44' },
          };
        },
        loadForecast(ctx) {
          record('entsoe.loadForecast')(ctx);
          return { success: true, statistics: { avgLoadMW: 55000, maxLoadMW: 68000 } };
        },
        windSolarForecast(ctx) {
          record('entsoe.windSolarForecast')(ctx);
          return { success: true, statistics: { windOnshoreAvg: 12000, solarPeak: 30000 } };
        },
      },
    },
    {
      name: 'energy-market',
      actions: {
        prices(ctx) {
          record('energy-market.prices')(ctx);
          return {
            success: true,
            data: { prices: [{ product: 'TEST-Cal-28 Base', settlementPrice: 77.7 }] },
          };
        },
      },
    },
    {
      name: 'gas-storage',
      actions: {
        countryStorage(ctx) {
          record('gas-storage.countryStorage')(ctx);
          return {
            success: true,
            data: {
              country: 'DE',
              gasDayStart: '2026-11-20',
              fillPercentage: 70.1,
              gasInStorage: 170,
            },
          };
        },
      },
    },
    {
      name: 'residual-load',
      actions: {
        netResidualLoad(ctx) {
          record('residual-load.netResidualLoad')(ctx);
          return {
            region: 'Testgebiet',
            forecast: [{ residualLoadMW: 10 }, { residualLoadMW: 30 }],
          };
        },
      },
    },
    {
      name: 'forecast-sandbox',
      actions: {
        portfolioRunStatus(ctx) {
          record('forecast-sandbox.portfolioRunStatus')(ctx);
          if (ctx.params.run_id !== RUN_ID)
            return { status: 'portfolio_invalid', error: { code: 'portfolio_invalid' } };
          return {
            run_id: RUN_ID,
            status: 'completed',
            completed_blocks: 4,
            result: { result_manifest: [{}, {}] },
          };
        },
      },
    },
    {
      name: 'fnav-commercial-hedging',
      actions: {
        listContracts(ctx) {
          record('fnav-commercial-hedging.listContracts')(ctx);
          return {
            contracts: [
              {
                _id: 'fnav-c:test-1',
                mastrNummer: UNIT,
                status: 'ACTIVE',
                installedCapacityKw: 500,
                minimumGuaranteedPowerKw: 100,
                compensationRateEurPerMwh: 40,
              },
              { _id: 'fnav-c:test-2', mastrNummer: 'SEE900000000002', status: 'DRAFT' },
            ],
          };
        },
        listScenarios(ctx) {
          record('fnav-commercial-hedging.listScenarios')(ctx);
          return {
            scenarios: [
              {
                _id: 'fnav-s:test-1',
                mastrNummer: UNIT,
                scenarioName: 'Testszenario',
                scenarioParams: { electricityMarketPriceEurPerMwh: 60 },
                commercialRisk: { compensationLiabilityEur: 12000, riskLevel: 'LOW' },
              },
            ],
          };
        },
      },
    },
  ];
}

const expand = (broker, object, context, budget) =>
  broker.call('micro-agent.beschaffung.expand', { object, context, budget });
const sources = (finding) => finding.facts.map((fact) => fact.provenance.source);

describe('micro-agent pack beschaffung', () => {
  let broker;
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(packService('beschaffung'));
    for (const schema of stubs()) broker.createService(schema);
    await broker.start();
  });
  afterAll(() => broker.stop());
  beforeEach(() => {
    calls.length = 0;
    slow = false;
  });

  test('describe lists the object kinds and the concern', async () => {
    const manifest = await broker.call('micro-agent.beschaffung.describe');
    expect(manifest.expands).toEqual(
      expect.arrayContaining(['market.price', 'portfolio.position', 'forecast.series', 'concern'])
    );
    expect(manifest.concern).toBe(true);
  });

  test('a market price with a delivery day yields day-ahead facts with provenance', async () => {
    const finding = await expand(broker, {
      kind: 'market.price',
      value: 'Day-Ahead 20.11.2026',
      provenance: { quote: 'Day-Ahead 20.11.2026' },
    });
    expect(calls).toEqual([
      expect.objectContaining({
        action: 'entsoe.dayAheadPrices',
        params: expect.objectContaining({ dateFrom: '2026-11-20', dateTo: '2026-11-20' }),
      }),
    ]);
    const period = finding.facts.find((fact) => fact.role === 'period');
    expect(period).toMatchObject({ basis: 'parsed', value: '2026-11-20 – 2026-11-20' });
    expect(period.provenance.quote).toBe('20.11.2026');
    const prices = finding.facts.filter((fact) => fact.role === 'monetary');
    expect(prices.map((fact) => fact.value)).toEqual(['91.23', '12.5', '201']);
    for (const fact of prices) {
      expect(fact.basis).toBe('source');
      expect(fact.provenance.source).toBe('entsoe.dayAheadPrices');
      expect(fact.provenance.ref).toContain('10Y1001A1001A82H');
      expect(fact.unit).toBe('EUR/MWh');
    }
    expect(finding.openQuestions).toEqual([]);
  });

  test('a forward product is priced through the futures read, not the day-ahead auction', async () => {
    const finding = await expand(broker, { kind: 'market.price', value: 'Cal-28 Base' });
    expect(calls.map((row) => row.action)).toEqual(['energy-market.prices']);
    expect(calls[0].params).toMatchObject({
      market: 'futures',
      startDate: '2028-01-01',
      endDate: '2028-12-31',
    });
    expect(finding.facts.map((fact) => fact.statement)).toContain(
      'Terminmarktpreis TEST-Cal-28 Base: 77.7 EUR/MWh'
    );
  });

  test('an empty source answer is a negative with its scope, never a value', async () => {
    const finding = await expand(broker, { kind: 'market.price', value: '2026-01-05' });
    expect(finding.facts.filter((fact) => fact.basis === 'source')).toEqual([]);
    expect(finding.negatives).toEqual([
      {
        searched: 'Day-Ahead-Preise',
        scope: 'entsoe.dayAheadPrices, Gebotszone DE-LU, 2026-01-05',
        result: 'no_values_in_answer',
      },
    ]);
  });

  test('unsupported kinds are refused', async () => {
    const finding = await expand(broker, { kind: 'grid.connection', value: 'X' });
    expect(finding.skipped).toBe('kind_not_handled');
    expect(finding.facts).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('a position states the missing position data and follows up with the period price', async () => {
    const object = { kind: 'portfolio.position', value: `offene Menge Q1 2099 ${UNIT}` };
    const finding = await expand(broker, object);
    expect(sources(finding)).toEqual(
      expect.arrayContaining([
        'message',
        'fnav-commercial-hedging.listContracts',
        'fnav-commercial-hedging.listScenarios',
      ])
    );
    const contract = finding.facts.find(
      (fact) => fact.provenance.source === 'fnav-commercial-hedging.listContracts'
    );
    expect(contract.provenance.ref).toBe('fnav-c:test-1');
    expect(contract.value).toBe('500');
    expect(finding.negatives).toEqual([
      expect.objectContaining({ result: 'no_read_service', scope: expect.any(String) }),
    ]);
    expect(finding.openQuestions).toHaveLength(1);

    const next = await broker.call('micro-agent.beschaffung.plan', { finding, object });
    expect(next).toEqual([
      expect.objectContaining({ kind: 'market.price', value: '2099-01-01 – 2099-03-31' }),
    ]);
    calls.length = 0;
    const price = await expand(broker, next[0]);
    // The follow-up re-reads the period from the object, so the quarter goes to the futures read.
    expect(calls[0].params).toMatchObject({ startDate: '2099-01-01', endDate: '2099-03-31' });
    expect(price.facts.some((fact) => fact.provenance.source === 'energy-market.prices')).toBe(
      true
    );
  });

  test('a forecast reads load, wind/solar, residual load and the tenant run', async () => {
    const finding = await expand(broker, {
      kind: 'forecast.series',
      value: `Prognose 2026-11-23 Netz ${OPERATOR} Lauf ${RUN_ID}`,
    });
    expect(new Set(sources(finding))).toEqual(
      new Set([
        'message',
        'entsoe.loadForecast',
        'entsoe.windSolarForecast',
        'residual-load.netResidualLoad',
        'forecast-sandbox.portfolioRunStatus',
      ])
    );
    const residual = finding.facts.filter(
      (fact) => fact.provenance.source === 'residual-load.netResidualLoad'
    );
    expect(residual.map((fact) => fact.value)).toEqual(['20', '10', '30']);
    expect(residual[0].statement).toContain('ermittelt aus 2 Werten');
    const windSolar = finding.facts.filter(
      (fact) => fact.provenance.source === 'entsoe.windSolarForecast'
    );
    expect(windSolar.map((fact) => fact.statement).join(' ')).toContain('windOnshoreAvg');
    expect(
      finding.facts.find((fact) => fact.role === 'status' && fact.value === 'completed')
    ).toBeDefined();
  });

  test('an unknown forecast run is a negative with scope', async () => {
    const finding = await expand(broker, {
      kind: 'forecast.series',
      value: `Lauf ${'b'.repeat(64)}`,
    });
    expect(finding.negatives).toEqual(
      expect.arrayContaining([
        {
          searched: `Prognoselauf ${'b'.repeat(64)}`,
          scope: 'forecast-sandbox.portfolioRunStatus, Prognoseläufe des Mandanten',
          result: 'no_hit',
        },
      ])
    );
  });

  test('a slow source does not throw; it becomes an unavailable negative', async () => {
    slow = true;
    const finding = await expand(
      broker,
      { kind: 'market.price', value: '2026-11-20' },
      {},
      { timeoutMs: 1500 }
    );
    expect(finding.failed).toBeUndefined();
    expect(finding.negatives).toEqual([
      expect.objectContaining({ searched: 'Day-Ahead-Preise', result: 'source_unavailable' }),
    ]);
  });

  test('the concern reads the market situation without a consequence', async () => {
    const finding = await expand(broker, {
      kind: 'concern',
      value: 'Wie stehen die Preise am 2026-11-20?',
    });
    expect(new Set(sources(finding))).toEqual(
      new Set(['entsoe.dayAheadPrices', 'gas-storage.countryStorage'])
    );
    const gas = finding.facts.find((fact) => fact.unit === '%');
    expect(gas).toMatchObject({ value: '70.1', validFrom: '2026-11-20' });
    expect(finding.openQuestions).toEqual([]);
    expect(finding.negatives).toEqual([]);
  });

  test('the concern with a consequence uses its period and asks for the affected position', async () => {
    const finding = await expand(
      broker,
      { kind: 'concern', value: 'Was bedeutet das?' },
      { consequenceOf: 'Abregelung im Netzgebiet am 2026-11-18' }
    );
    expect(calls.find((row) => row.action === 'entsoe.dayAheadPrices').params.dateFrom).toBe(
      '2026-11-18'
    );
    expect(finding.openQuestions[0].question).toContain('Abregelung im Netzgebiet am 2026-11-18');
    expect(finding.negatives).toEqual([
      expect.objectContaining({ result: 'no_read_service', scope: expect.any(String) }),
    ]);
  });
});
