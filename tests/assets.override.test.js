'use strict';

const { ServiceBroker } = require('moleculer');
const AssetsService = require('../services/assets.service');

function getByPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function matchesSelector(doc, selector) {
  if (!selector || Object.keys(selector).length === 0) return true;

  if (Array.isArray(selector.$or)) {
    return selector.$or.some((rule) => matchesSelector(doc, rule));
  }

  return Object.entries(selector).every(([path, expected]) => {
    const value = getByPath(doc, path);
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if (Array.isArray(expected.$in)) {
        return expected.$in.includes(value);
      }
      return false;
    }
    return value === expected;
  });
}

describe('Assets Service - override persistence', () => {
  let broker;
  const objectDocs = new Map();
  const hitlItems = new Map();

  function docKey(namespace, key) {
    return `${namespace}:${key}`;
  }

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, nodeID: `assets-override-${Date.now()}` });

    // Satisfy assets service dependencies.
    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler() {
            return {
              data: {
                installations: [
                  {
                    mastrNumber: 'SEE900123456789',
                    acLeistung: 1000,
                    spannungsebene: 'NS',
                    inbetriebnahmedatum: '2020-01-01',
                    fernsteuerbarkeitDv: '0',
                  },
                ],
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'object-store',
      actions: {
        put: {
          handler(ctx) {
            const { namespace, key, payload } = ctx.params;
            objectDocs.set(docKey(namespace, key), {
              namespace,
              key,
              payload,
              createdAt: payload.createdAt || new Date().toISOString(),
              updatedAt: payload.updatedAt || new Date().toISOString(),
            });
            return objectDocs.get(docKey(namespace, key));
          },
        },
        get: {
          handler(ctx) {
            const { namespace, key } = ctx.params;
            return objectDocs.get(docKey(namespace, key));
          },
        },
        query: {
          handler(ctx) {
            const { namespace, selector = {}, limit = 50, skip = 0 } = ctx.params;
            const all = [...objectDocs.values()].filter((doc) => doc.namespace === namespace);
            const filtered = all.filter((doc) => matchesSelector({ payload: doc.payload }, selector));
            return { docs: filtered.slice(skip, skip + limit), totalDocs: filtered.length };
          },
        },
      },
    });

    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler(ctx) {
            const id = `hitl-${Math.random().toString(36).slice(2, 10)}`;
            const item = {
              id,
              status: 'pending',
              payload: ctx.params.payload || {},
            };
            hitlItems.set(id, item);
            return { success: true, item };
          },
        },
        get: {
          handler(ctx) {
            return { success: true, item: hitlItems.get(ctx.params.id) };
          },
        },
        approve: {
          handler(ctx) {
            const item = hitlItems.get(ctx.params.id);
            item.status = 'approved';
            hitlItems.set(ctx.params.id, item);
            return { success: true, item };
          },
        },
      },
    });

    broker.createService(AssetsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('returns success true', async () => {
    const result = await broker.call('assets.override', {
      assetId: 'SEE900123456789',
      field: 'capacityKW',
      value: 1250,
      reason: 'Manual correction from operator',
    });

    expect(result.success).toBe(true);
    expect(result.pendingApproval).toBe(false);
    expect(result.override.assetId).toBe('SEE900123456789');
    expect(result.override.approvalStatus).toBe('approved');
    expect(result.override.provenanceHash).toBeDefined();
  });

  it('stores critical field override as pendingApproval', async () => {
    const result = await broker.call('assets.override', {
      assetId: 'SEE900123456789',
      field: 'voltageLevel',
      value: 'MS',
      reason: 'Critical correction',
    });

    expect(result.success).toBe(true);
    expect(result.pendingApproval).toBe(true);
    expect(result.override.approvalStatus).toBe('pendingApproval');
    expect(result.override.hitlItemId).toBeTruthy();
  });

  it('applies pending override after HITL approval', async () => {
    const created = await broker.call('assets.override', {
      assetId: 'SEE900123456789',
      field: 'direktvermarktungActive',
      value: true,
      reason: 'Enable DV',
    });

    await broker.call('hitl.approve', { id: created.override.hitlItemId });

    const applied = await broker.call('assets.applyOverride', {
      assetId: 'SEE900123456789',
      id: created.override.id,
    });

    expect(applied.success).toBe(true);
    expect(applied.pendingApproval).toBe(false);
    expect(applied.override.approvalStatus).toBe('approved');
  });

  it('returns effective asset with source trail', async () => {
    await broker.call('assets.override', {
      assetId: 'SEE900123456789',
      field: 'capacityKW',
      value: 1400,
      reason: 'Updated nominal capacity',
    });

    const effective = await broker.call('assets.effective', {
      assetId: 'SEE900123456789',
      gridOperatorId: 'SNB935578300972',
      assetType: 'solar',
    });

    expect(effective.success).toBe(true);
    expect(effective.asset['Asset-ID']).toBe('SEE900123456789');
    expect(effective.asset['Leistung kW']).toBe(1400);
    expect(Array.isArray(effective.sourceTrail.appliedOverrides)).toBe(true);
  });

  it('soft-reverts an override', async () => {
    const created = await broker.call('assets.override', {
      assetId: 'SEE900123456789',
      field: 'capacityKW',
      value: 1600,
      reason: 'Temporary correction',
    });

    const removeResult = await broker.call('assets.removeOverride', {
      assetId: 'SEE900123456789',
      id: created.override.id,
    });

    expect(removeResult.success).toBe(true);
    expect(removeResult.supersedesReverted).toBe(true);

    const effective = await broker.call('assets.effective', {
      assetId: 'SEE900123456789',
      gridOperatorId: 'SNB935578300972',
      assetType: 'solar',
    });
    expect(effective.asset['Leistung kW']).not.toBe(1600);
  });

  it('enforces tenant isolation for overrides', async () => {
    await broker.call(
      'assets.override',
      {
        assetId: 'SEE900TENANTA',
        field: 'capacityKW',
        value: 999,
        reason: 'Tenant A only',
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    const tenantA = await broker.call(
      'assets.overrides',
      { assetId: 'SEE900TENANTA' },
      { meta: { tenantId: 'tenant-a' } }
    );
    const tenantB = await broker.call(
      'assets.overrides',
      { assetId: 'SEE900TENANTA' },
      { meta: { tenantId: 'tenant-b' } }
    );

    expect(tenantA.count).toBeGreaterThan(0);
    expect(tenantB.count).toBe(0);
  });
});
