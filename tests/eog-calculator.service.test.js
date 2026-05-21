'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { ServiceBroker } = require('moleculer');

function buildDatapointMock() {
  const created = [];
  const store = new Map();

  return {
    created,
    service: {
      name: 'datapoint',
      actions: {
        create: {
          handler(ctx) {
            const payload = ctx.params;
            if (store.has(payload.name)) {
              const error = new Error('duplicate');
              error.type = 'DUPLICATE_NAME';
              throw error;
            }
            store.set(payload.name, payload);
            created.push(payload);
            return { success: true, name: payload.name, _rev: '1-mock' };
          },
        },
        remove: {
          handler(ctx) {
            store.delete(ctx.params.name);
            return { success: true };
          },
        },
      },
    },
  };
}

function buildHitlMock() {
  const items = [];
  return {
    items,
    service: {
      name: 'hitl',
      actions: {
        create: {
          handler(ctx) {
            const item = {
              id: `hitl-${items.length + 1}`,
              kind: ctx.params.kind,
              payload: ctx.params.payload,
              createdAt: new Date().toISOString(),
            };
            items.push(item);
            return { success: true, item };
          },
        },
      },
    },
  };
}

describe('eog-calculator service', () => {
  let broker;
  let datapointMock;
  let hitlMock;
  let dbPath;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `cernion-eog-test-${Date.now()}-${Math.random()}`);
    process.env.EOG_CALCULATOR_DB_PATH = dbPath;

    datapointMock = buildDatapointMock();
    hitlMock = buildHitlMock();

    broker = new ServiceBroker({ logger: false });
    broker.createService(datapointMock.service);
    broker.createService(hitlMock.service);

    delete require.cache[require.resolve('../services/eog-calculator.service')];
    const EOGService = require('../services/eog-calculator.service');
    broker.createService(EOGService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    delete process.env.EOG_CALCULATOR_DB_PATH;
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  function validDatapoints(withQualityElement = 0) {
    return [
      {
        key: 'eog.efficiency_value',
        value: 95,
        periodYear: 2026,
        sector: 'strom',
        source: 'tenant_uploaded',
        confidence: 'confirmed',
      },
      {
        key: 'eog.base_cost_level',
        value: 1000,
        periodYear: 2026,
        sector: 'strom',
        source: 'tenant_uploaded',
        confidence: 'confirmed',
      },
      {
        key: 'eog.controllable_costs',
        value: 200,
        periodYear: 2026,
        sector: 'strom',
        source: 'tenant_uploaded',
        confidence: 'confirmed',
      },
      {
        key: 'eog.permanently_non_controllable_costs',
        value: 300,
        periodYear: 2026,
        sector: 'strom',
        source: 'tenant_uploaded',
        confidence: 'confirmed',
      },
      ...(withQualityElement !== 0
        ? [
            {
              key: 'eog.quality_element',
              value: withQualityElement,
              periodYear: 2026,
              sector: 'strom',
              source: 'tenant_uploaded',
              confidence: 'confirmed',
            },
          ]
        : []),
      {
        key: 'eog.temporarily_non_controllable_costs',
        value: 100,
        periodYear: 2026,
        sector: 'strom',
        source: 'tenant_uploaded',
        confidence: 'confirmed',
      },
      {
        key: 'eog.approved_revenue_cap',
        value: 1390,
        periodYear: 2026,
        sector: 'strom',
        source: 'public',
        confidence: 'confirmed',
      },
    ];
  }

  it('validates without persisting datapoints', async () => {
    const validation = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-a',
      vnbId: 'SNB100',
      datapoints: [
        {
          key: 'eog.efficiency_value',
          value: 93.4,
          periodYear: 2026,
          sector: 'strom',
          source: 'tenant_uploaded',
          confidence: 'confirmed',
        },
      ],
    });

    expect(validation.success).toBe(true);
    expect(validation.validationId).toBeDefined();

    const model = await broker.call('eog-calculator.getModel', {
      tenantId: 'tenant-a',
      vnbId: 'SNB100',
    });

    expect(model.datapoints).toHaveLength(0);
  });

  it('commits only after validation and stores datapoints', async () => {
    const validation = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-a',
      vnbId: 'SNB100',
      datapoints: validDatapoints(),
    });

    const committed = await broker.call('eog-calculator.commitDatapoints', {
      validationId: validation.validationId,
    });

    expect(committed.success).toBe(true);
    expect(committed.committed).toBe(true);
    expect(committed.persistedCount).toBe(validDatapoints().length);

    const model = await broker.call('eog-calculator.getModel', {
      tenantId: 'tenant-a',
      vnbId: 'SNB100',
    });

    expect(model.datapoints.length).toBe(validDatapoints().length);
    expect(datapointMock.created.length).toBe(validDatapoints().length);
  });

  it('returns blocker explanation when required values are missing', async () => {
    const validation = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-blocked',
      vnbId: 'SNB200',
      datapoints: [
        {
          key: 'eog.base_cost_level',
          value: 1000,
          periodYear: 2026,
          sector: 'strom',
          source: 'tenant_uploaded',
          confidence: 'confirmed',
        },
      ],
    });

    await broker.call('eog-calculator.commitDatapoints', {
      validationId: validation.validationId,
      hitlConfirmation: {
        approved: true,
        decision: 'manual_confirm',
        actor: 'tester',
      },
    });

    const calc = await broker.call('eog-calculator.calculate', {
      tenantId: 'tenant-blocked',
      vnbId: 'SNB200',
      periodYear: 2026,
      sector: 'strom',
    });

    expect(calc.dataStatus).toBe('partial');
    expect(calc.blockers.length).toBeGreaterThan(0);
    expect(calc.blockers.some((item) => item.explanation.includes('Effizienzwert'))).toBe(true);
  });

  it('compares computed value with approved calibration anchor', async () => {
    const validation = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-calibration',
      vnbId: 'SNB300',
      datapoints: validDatapoints(),
    });

    await broker.call('eog-calculator.commitDatapoints', {
      validationId: validation.validationId,
    });

    const calc = await broker.call('eog-calculator.calculate', {
      tenantId: 'tenant-calibration',
      vnbId: 'SNB300',
      periodYear: 2026,
      sector: 'strom',
    });

    expect(calc.calibration.approvedRevenueCap.status).toBe('match');
  });

  it('keeps scenario results transient and separated from actual datapoints', async () => {
    const validation = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-scenario',
      vnbId: 'SNB400',
      datapoints: validDatapoints(),
    });

    await broker.call('eog-calculator.commitDatapoints', {
      validationId: validation.validationId,
    });

    const scenario = await broker.call('eog-calculator.scenario', {
      tenantId: 'tenant-scenario',
      vnbId: 'SNB400',
      periodYear: 2026,
      sector: 'strom',
      overrides: [
        {
          key: 'eog.efficiency_value',
          value: 93.4,
        },
      ],
    });

    expect(scenario.calculationMode).toBe('scenario');
    expect(scenario.persisted).toBe(false);

    const model = await broker.call('eog-calculator.getModel', {
      tenantId: 'tenant-scenario',
      vnbId: 'SNB400',
    });

    expect(model.datapoints.length).toBe(validDatapoints().length);
  });

  it('applies quality_element correctly: positive adds to EOG, negative subtracts', async () => {
    // Test 1: Positive quality element (+50 EUR)
    const dpPositive = validDatapoints(50);
    const valRes1 = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-1',
      vnbId: 'vnb-x',
      datapoints: dpPositive,
    });
    await broker.call('eog-calculator.commitDatapoints', {
      validationId: valRes1.validationId,
    });
    const calcRes1 = await broker.call('eog-calculator.calculate', {
      tenantId: 'tenant-1',
      vnbId: 'vnb-x',
    });
    // Base: 1000 - 10 (efficiency) + 300 (perm) + 100 (temp) + 50 (quality) = 1440
    expect(calcRes1.results.calculatedApprovedRevenueCap).toBe(1440);

    // Test 2: Negative quality element (-30 EUR)
    const dpNegative = validDatapoints(-30);
    const valRes2 = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-2',
      vnbId: 'vnb-y',
      datapoints: dpNegative,
    });
    await broker.call('eog-calculator.commitDatapoints', {
      validationId: valRes2.validationId,
    });
    const calcRes2 = await broker.call('eog-calculator.calculate', {
      tenantId: 'tenant-2',
      vnbId: 'vnb-y',
    });
    // Base: 1000 - 10 + 300 + 100 - 30 (quality) = 1360
    expect(calcRes2.results.calculatedApprovedRevenueCap).toBe(1360);

    // Test 3: Zero quality element (default, no Q-element in datapoints)
    const dpZero = validDatapoints();
    const valRes3 = await broker.call('eog-calculator.validateDatapoints', {
      tenantId: 'tenant-3',
      vnbId: 'vnb-z',
      datapoints: dpZero,
    });
    await broker.call('eog-calculator.commitDatapoints', {
      validationId: valRes3.validationId,
    });
    const calcRes3 = await broker.call('eog-calculator.calculate', {
      tenantId: 'tenant-3',
      vnbId: 'vnb-z',
    });
    // Base: 1000 - 10 + 300 + 100 + 0 (no quality element) = 1390
    expect(calcRes3.results.calculatedApprovedRevenueCap).toBe(1390);
  });

  it('creates HITL items with user choices for each missing key', async () => {
    const result = await broker.call('eog-calculator.requestInput', {
      tenantId: 'tenant-hitl',
      vnbId: 'SNB500',
      periodYear: 2026,
      sector: 'strom',
      missingKeys: ['eog.efficiency_value'],
    });

    expect(result.created).toBe(1);
    expect(hitlMock.items).toHaveLength(1);
    expect(hitlMock.items[0].payload.userChoices).toEqual(
      expect.arrayContaining(['manual_confirm', 'document_upload', 'scenario_assumption', 'abort'])
    );
  });
});
