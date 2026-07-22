'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const { generateStructured } = require('../src/llm-client');
const InMemoryJoinService = require('../services/in-memory-join.service');
const TabularService = require('../services/tabular-intelligence.service');

function fixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', `tabular-${name}.fixture.json`), 'utf8')
  );
}

describe('Tabular Intelligence Service', () => {
  let broker;
  const metering = fixture('metering');
  const assets = fixture('assets');
  const joined = fixture('join');
  const datasets = new Map([
    [metering.sourceId, metering.rows],
    [assets.sourceId, assets.rows],
    [joined.leftSourceId, joined.leftRows],
    [joined.rightSourceId, joined.rightRows],
  ]);
  const metadata = new Map([
    [metering.sourceId, metering],
    [assets.sourceId, assets],
    [
      joined.leftSourceId,
      { dictionary: { fields: [] }, classification: { domainId: 'grid-assets' } },
    ],
    [
      joined.rightSourceId,
      { dictionary: { fields: [] }, classification: { domainId: 'metering' } },
    ],
  ]);
  const observedCalls = [];

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      name: 'datasource-cache',
      actions: {
        query: {
          async handler(ctx) {
            observedCalls.push({
              action: 'datasource-cache.query',
              params: ctx.params,
              meta: ctx.meta,
            });
            const rows = datasets.get(ctx.params.sourceId) || [];
            const prepared = rows.map((row) => {
              const copy = { ...row };
              if (ctx.params.privacyContext !== 'internal' && copy.Betreiber_Name) {
                copy.Betreiber_Name = 'REDACTED';
              }
              if (ctx.params.privacyContext !== 'internal' && copy.MaLo_ID) {
                copy.MaLo_ID = 'REDACTED';
              }
              return copy;
            });
            const offset = Number(ctx.params.offset) || 0;
            const limit = Number(ctx.params.limit) || 100;
            return {
              success: true,
              totalRows: prepared.length,
              data: prepared.slice(offset, offset + limit),
            };
          },
        },
      },
    });
    broker.createService({
      name: 'datasource-registry',
      actions: {
        get: {
          handler(ctx) {
            const item = metadata.get(ctx.params.id) || {};
            return { success: true, data: { dictionary: item.dictionary || { fields: [] } } };
          },
        },
        getClassification: {
          handler(ctx) {
            return { success: true, data: metadata.get(ctx.params.id)?.classification || null };
          },
        },
      },
    });
    broker.createService(InMemoryJoinService);
    broker.createService(TabularService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    observedCalls.length = 0;
    generateStructured.mockReset();
  });

  it('profiles asset/master data without exposing sensitive or identifier examples', async () => {
    const profile = await broker.call(
      'tabular.profile',
      { sourceId: assets.sourceId },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(profile.classification.domainId).toBe('grid-assets');
    expect(profile.sampledRowCount).toBe(3);
    expect(profile.columns.find((column) => column.name === 'Asset_ID').sensitive).toBe(true);
    expect(profile.columns.find((column) => column.name === 'Asset_ID').examples).toBeUndefined();
    expect(
      profile.columns.find((column) => column.name === 'Betreiber_Name').examples
    ).toBeUndefined();
    expect(profile.hashes.input).toMatch(/^sha256:/);
    expect(observedCalls.every((call) => call.params.privacyContext === 'ai-agent')).toBe(true);
    expect(observedCalls.every((call) => call.meta.tenantId === 'tenant-a')).toBe(true);
  });

  it('builds token-bounded LLM context without raw sensitive table values', async () => {
    const result = await broker.call('tabular.llmContext', {
      sourceIds: [assets.sourceId],
      maxTokens: 128,
    });

    expect(result.estimatedTokens).toBeLessThanOrEqual(128);
    expect(result.context).not.toContain('Private Grid GmbH');
    expect(result.context).not.toContain('Private Wind GmbH');
    expect(result.context).not.toContain('connectorConfig');
    expect(result.context).toContain('grid-assets');
  });

  it('executes time bucketing, deterministic aggregation, and missing-interval detection', async () => {
    const planned = await broker.call(
      'tabular.queryPlan',
      {
        plan: {
          schemaVersion: '1.0',
          sources: [{ alias: 'metering', sourceId: metering.sourceId }],
          operations: [
            { op: 'detectMissingIntervals', field: 'timestamp', intervalMinutes: 15 },
            { op: 'timeBucket', field: 'timestamp', interval: 'hour', as: 'period' },
            {
              op: 'aggregate',
              groupBy: ['period'],
              metrics: [{ fn: 'sum', field: 'Verbrauch_kWh', as: 'totalConsumption' }],
            },
            { op: 'sort', by: [{ field: 'period', direction: 'asc' }] },
          ],
        },
      },
      { meta: { tenantId: 'tenant-a' } }
    );
    const result = await broker.call(
      'tabular.executePlan',
      { plan: planned.plan },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(result.resultTable).toEqual([
      { period: '2026-01-01T00:00:00.000Z', totalConsumption: 6 },
      { period: '2026-01-01T01:00:00.000Z', totalConsumption: 40 },
    ]);
    expect(result.evidence.operations[0].details.missingCount).toBe(1);
    expect(result.evidence.hashes.plan).toMatch(/^sha256:/);
    expect(result.evidence.evidenceRows).toEqual(result.resultTable);
    expect(result.warnings).toContain('1 missing intervals detected');
    expect(result.confidence).toBe('medium');
  });

  it('delegates joins to in-memory-join and aggregates the joined fixture', async () => {
    const plan = {
      schemaVersion: '1.0',
      sources: [
        { alias: 'assets', sourceId: joined.leftSourceId },
        { alias: 'metering', sourceId: joined.rightSourceId },
      ],
      operations: [
        {
          op: 'join',
          left: 'assets',
          right: 'metering',
          leftField: 'Asset_ID',
          rightField: 'Asset_ID',
          joinType: 'inner',
          matchMode: 'exact',
        },
        {
          op: 'aggregate',
          groupBy: ['Anlagentyp'],
          metrics: [{ fn: 'sum', field: 'Verbrauch_kWh', as: 'totalConsumption' }],
        },
        { op: 'sort', by: [{ field: 'Anlagentyp', direction: 'asc' }] },
      ],
    };

    const result = await broker.call('tabular.executePlan', { plan });

    expect(result.resultTable).toEqual(joined.expected);
    expect(result.evidence.operations[0].op).toBe('join');
    expect(result.evidence.sourceIds).toEqual([joined.leftSourceId, joined.rightSourceId]);
    expect(observedCalls.every((call) => call.params.privacyContext === 'ai-agent')).toBe(true);
  });

  it('answers with numbers only from deterministic execution output', async () => {
    const result = await broker.call('tabular.ask', {
      question: 'Wie hoch ist die Summe von Verbrauch_kWh?',
      sourceIds: [metering.sourceId],
    });

    expect(result.answer).toBe('Deterministic execution produced: sum_Verbrauch_kWh=46.');
    expect(result.resultTable).toEqual([{ sum_Verbrauch_kWh: 46 }]);
    expect(result.answer).toContain(String(result.resultTable[0].sum_Verbrauch_kWh));
    expect(result.evidence.hashes.result).toMatch(/^sha256:/);
  });

  it('uses only safe context for optional LLM planning and validates the generated plan', async () => {
    generateStructured.mockResolvedValue({
      operations: [
        {
          op: 'aggregate',
          groupBy: [],
          metrics: [{ fn: 'count', as: 'rowCount' }],
        },
      ],
      output: { maxRows: 10 },
    });

    const result = await broker.call(
      'tabular.queryPlan',
      {
        sourceIds: [assets.sourceId],
        question: 'How many assets?',
        useLlm: true,
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(result.planner).toBe('llm-client');
    expect(result.plan.tenantBinding).toMatch(/^sha256:/);
    const prompt = generateStructured.mock.calls[0][1];
    expect(prompt).not.toContain('Private Grid GmbH');
    expect(prompt).not.toContain('Private Wind GmbH');
    expect(prompt).not.toContain('A-1');
  });

  it('rejects unsafe operations, internal privacy, and cross-tenant plan replay', async () => {
    await expect(
      broker.call('tabular.executePlan', {
        plan: {
          sources: [{ alias: 'table', sourceId: assets.sourceId, privacyContext: 'internal' }],
          operations: [],
        },
      })
    ).rejects.toThrow('Only ai-agent or public privacy contexts are allowed');

    await expect(
      broker.call('tabular.executePlan', {
        plan: {
          sources: [{ alias: 'table', sourceId: assets.sourceId }],
          operations: [{ op: 'sql', query: 'DROP TABLE assets' }],
        },
      })
    ).rejects.toThrow('Unsupported operation: sql');

    const planned = await broker.call(
      'tabular.queryPlan',
      {
        plan: {
          sources: [{ alias: 'table', sourceId: assets.sourceId }],
          operations: [],
        },
      },
      { meta: { tenantId: 'tenant-a' } }
    );
    await expect(
      broker.call('tabular.executePlan', { plan: planned.plan }, { meta: { tenantId: 'tenant-b' } })
    ).rejects.toMatchObject({ code: 'TABULAR_TENANT_MISMATCH' });
  });

  it('returns evidence-backed quality checks for the metering fixture', async () => {
    const result = await broker.call('tabular.qualityReport', {
      sourceId: metering.sourceId,
      timestampField: 'timestamp',
      duplicateFields: ['timestamp'],
      outlierField: 'Verbrauch_kWh',
      outlierThreshold: 1.5,
    });

    expect(
      result.checks.find((check) => check.check === 'detectMissingIntervals').missingCount
    ).toBe(1);
    expect(
      result.checks.find((check) => check.check === 'detectDuplicates').duplicateRowCount
    ).toBe(0);
    expect(result.checks.find((check) => check.check === 'detectOutliers').count).toBe(1);
    expect(result.evidence.sourceIds).toEqual([metering.sourceId]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        '1 missing intervals detected',
        '1 outliers detected in Verbrauch_kWh',
      ])
    );
  });
});

describe('Tabular Intelligence core hashing and plan validation (src/tabular-intelligence)', () => {
  const { hashValue, validateAndBindPlan } = require('../src/tabular-intelligence');

  function basePlan(operations) {
    return {
      schemaVersion: '1.0',
      sources: [{ alias: 'table', sourceId: 'source-1' }],
      operations,
    };
  }

  function planWithFilter(overrides) {
    return basePlan([{ op: 'filter', field: 'status', ...overrides }]);
  }

  describe('canonical Date hashing', () => {
    it('produces stable hashes for equivalent Date instants', () => {
      const a = new Date('2026-01-01T00:00:00.000Z');
      const b = new Date('2026-01-01T00:00:00.000Z');
      expect(hashValue({ when: a })).toBe(hashValue({ when: b }));
    });

    it('produces non-colliding hashes for different Date instants', () => {
      const a = new Date('2026-01-01T00:00:00.000Z');
      const b = new Date('2026-01-02T00:00:00.000Z');
      expect(hashValue({ when: a })).not.toBe(hashValue({ when: b }));
    });

    it('distinguishes a Date from an identical ISO string representation', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      expect(hashValue({ when: date })).not.toBe(hashValue({ when: date.toISOString() }));
    });

    it('fails closed for an invalid Date instead of collapsing to an empty object', () => {
      const invalid = new Date('not-a-date');
      expect(() => hashValue({ when: invalid })).toThrow(/Invalid Date/);
    });

    it('produces different input hashes for rows differing only by date', () => {
      const rowA = { timestamp: new Date('2026-01-01T00:00:00.000Z'), value: 1 };
      const rowB = { timestamp: new Date('2026-01-02T00:00:00.000Z'), value: 1 };
      expect(hashValue([rowA])).not.toBe(hashValue([rowB]));
    });

    it('produces the same input hash when rows carry equal Date instants', () => {
      const rowA = { timestamp: new Date('2026-01-01T00:00:00.000Z'), value: 1 };
      const rowB = { timestamp: new Date('2026-01-01T00:00:00.000Z'), value: 1 };
      expect(hashValue([rowA])).toBe(hashValue([rowB]));
    });
  });

  describe('detectMissingIntervals.intervalMinutes bounds', () => {
    function planWithInterval(intervalMinutes) {
      return basePlan([
        {
          op: 'detectMissingIntervals',
          field: 'timestamp',
          ...(intervalMinutes === undefined ? {} : { intervalMinutes }),
        },
      ]);
    }

    it('accepts the minimum boundary of 1', () => {
      const plan = validateAndBindPlan(planWithInterval(1), 'tenant-a');
      expect(plan.operations[0].intervalMinutes).toBe(1);
    });

    it('accepts the maximum boundary of 10080', () => {
      const plan = validateAndBindPlan(planWithInterval(10080), 'tenant-a');
      expect(plan.operations[0].intervalMinutes).toBe(10080);
    });

    it.each([
      ['missing', undefined],
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['string-coerced', '15'],
      ['non-finite (Infinity)', Infinity],
      ['NaN', NaN],
      ['excessive (10081)', 10081],
    ])('rejects %s intervalMinutes before any interval loop runs', (_label, value) => {
      expect(() => validateAndBindPlan(planWithInterval(value), 'tenant-a')).toThrow(
        /intervalMinutes must be an integer between 1 and 10080/
      );
    });
  });

  describe('filter operator value/type validation', () => {
    it.each(['isNull', 'notNull'])('rejects a supplied value for %s', (operator) => {
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator, value: 'x' }), 'tenant-a')
      ).toThrow(/value must not be supplied/);
    });

    it.each(['isNull', 'notNull'])('accepts %s without a value', (operator) => {
      expect(() => validateAndBindPlan(planWithFilter({ operator }), 'tenant-a')).not.toThrow();
    });

    it.each(['eq', 'neq'])(
      'requires a scalar value for %s and rejects missing/null/array/object',
      (operator) => {
        expect(() => validateAndBindPlan(planWithFilter({ operator }), 'tenant-a')).toThrow(
          /value is required/
        );
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: null }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: [1] }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: { a: 1 } }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: 'active' }), 'tenant-a')
        ).not.toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: 42 }), 'tenant-a')
        ).not.toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: true }), 'tenant-a')
        ).not.toThrow();
      }
    );

    it.each(['gt', 'gte', 'lt', 'lte'])(
      'requires a finite number or non-empty string for %s and rejects boolean/null/empty-string/array',
      (operator) => {
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: true }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: null }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: '' }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: [1] }), 'tenant-a')
        ).toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: 5 }), 'tenant-a')
        ).not.toThrow();
        expect(() =>
          validateAndBindPlan(planWithFilter({ operator, value: '2026-01-01' }), 'tenant-a')
        ).not.toThrow();
      }
    );

    it('requires a non-empty string for contains and rejects empty string/number', () => {
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'contains', value: '' }), 'tenant-a')
      ).toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'contains', value: 5 }), 'tenant-a')
      ).toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'contains', value: 'abc' }), 'tenant-a')
      ).not.toThrow();
    });

    it('requires an array of 1-100 scalar values for in and rejects 0/101/nested/null items', () => {
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'in', value: [] }), 'tenant-a')
      ).toThrow();
      expect(() =>
        validateAndBindPlan(
          planWithFilter({ operator: 'in', value: Array.from({ length: 101 }, (_, i) => i) }),
          'tenant-a'
        )
      ).toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'in', value: [[1]] }), 'tenant-a')
      ).toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'in', value: [{ a: 1 }] }), 'tenant-a')
      ).toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'in', value: [null] }), 'tenant-a')
      ).toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'in', value: [1] }), 'tenant-a')
      ).not.toThrow();
      expect(() =>
        validateAndBindPlan(
          planWithFilter({ operator: 'in', value: Array.from({ length: 100 }, (_, i) => i) }),
          'tenant-a'
        )
      ).not.toThrow();
    });

    it('accepts a 500-character string and rejects a 501-character string', () => {
      const ok = 'a'.repeat(500);
      const tooLong = 'a'.repeat(501);
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'eq', value: ok }), 'tenant-a')
      ).not.toThrow();
      expect(() =>
        validateAndBindPlan(planWithFilter({ operator: 'eq', value: tooLong }), 'tenant-a')
      ).toThrow();
    });
  });
});
