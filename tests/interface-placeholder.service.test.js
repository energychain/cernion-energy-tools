'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const InterfacePlaceholderService = require('../services/interface-placeholder.service');

describe('interface-placeholder.service', () => {
  let broker;
  let objectStorePath;
  let hitlItems;

  beforeEach(async () => {
    objectStorePath = path.join(
      os.tmpdir(),
      `interface-placeholder-store-${Date.now()}-${Math.random()}`
    );
    hitlItems = [];
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: objectStorePath,
      },
    });
    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler(ctx) {
            const item = {
              id: `hitl-${hitlItems.length + 1}`,
              status: 'pending',
              kind: ctx.params.kind,
              payload: ctx.params.payload,
            };
            hitlItems.push(item);
            return { success: true, item };
          },
        },
      },
    });
    broker.createService(InterfacePlaceholderService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(objectStorePath, { recursive: true, force: true });
  });

  it('persists a placeholder in a tenant-scoped namespace', async () => {
    const result = await broker.call(
      'interface-placeholder.markGap',
      {
        role: 'grid_connection_validator',
        reason: 'NEEDS_INTERFACE',
        replacementCriteria: { kind: 'process', capabilityHint: 'znp.assessPortfolio' },
      },
      { meta: { tenantId: 'stromdao' } }
    );

    expect(result.placeholder.status).toBe('placeholder_gap');
    expect(result.placeholder.confidence).toBe('low');
    expect(result.placeholder.graphNode.nodeType).toBe('interface_placeholder');

    const stored = await broker.call('object-store.get', {
      namespace: 'tenant:stromdao:interface_placeholders',
      key: result.placeholder.placeholderId,
    });
    expect(stored.payload.placeholderId).toBe(result.placeholder.placeholderId);
  });

  it('creates a HITL item for hard blockers', async () => {
    const result = await broker.call(
      'interface-placeholder.markGap',
      {
        role: 'grid_planning',
        reason: 'NEEDS_DECISION',
        blockingLevel: 'hard',
        placeholderGapKey: 'kaufmaennische_freigabe_fnav',
      },
      { meta: { tenantId: 'stromdao' } }
    );

    expect(result.hitlItem).toBeTruthy();
    expect(hitlItems).toHaveLength(1);
    expect(hitlItems[0].payload.requiredResolverRoles).toEqual([
      'ROLE_KAUFMAENNISCHE_LEITUNG',
      'ROLE_NETZPLANUNG',
    ]);
  });

  it('lists only tenant-local gaps', async () => {
    await broker.call(
      'interface-placeholder.markGap',
      {
        role: 'grid_connection_validator',
        reason: 'NEEDS_EVIDENCE',
      },
      { meta: { tenantId: 'tenant-a' } }
    );
    await broker.call(
      'interface-placeholder.markGap',
      {
        role: 'grid_connection_validator',
        reason: 'NEEDS_OWNER',
      },
      { meta: { tenantId: 'tenant-b' } }
    );

    const result = await broker.call(
      'interface-placeholder.listGaps',
      {},
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(result.total).toBe(1);
    expect(result.placeholders[0].tenantId).toBe('tenant-a');
  });

  it('returns evidence signals and minimal status', async () => {
    const created = await broker.call('interface-placeholder.markGap', {
      role: 'grid_connection_validator',
      reason: 'NEEDS_OWNER',
    });

    const evidence = await broker.call('interface-placeholder.requestEvidence', {
      placeholderId: created.placeholder.placeholderId,
    });
    const status = await broker.call('interface-placeholder.returnMinimalStatus', {
      placeholderId: created.placeholder.placeholderId,
    });

    expect(evidence.evidenceSignals).toContain('REQUEST_OWNER_ASSIGNMENT');
    expect(status.confidence).toBe('low');
    expect(status.status).toBe('placeholder_gap');
  });

  it('requires both mandated roles to resolve hard blockers', async () => {
    const created = await broker.call('interface-placeholder.markGap', {
      role: 'netzplanung',
      reason: 'NEEDS_DECISION',
      blockingLevel: 'hard',
    });

    await expect(
      broker.call('interface-placeholder.resolveGap', {
        placeholderId: created.placeholder.placeholderId,
        resolution: { summary: 'approved' },
        approvedRoles: ['ROLE_NETZPLANUNG'],
      })
    ).rejects.toMatchObject({ type: 'PLACEHOLDER_RESOLUTION_ROLE_REQUIRED' });

    const resolved = await broker.call('interface-placeholder.resolveGap', {
      placeholderId: created.placeholder.placeholderId,
      resolution: { summary: 'approved' },
      approvedRoles: ['ROLE_NETZPLANUNG', 'ROLE_KAUFMAENNISCHE_LEITUNG'],
    });

    expect(resolved.placeholder.status).toBe('resolved');
    expect(resolved.placeholder.resolvedAt).toBeTruthy();
  });

  it('returns blocked decision status when unresolved hard placeholders exist', async () => {
    await broker.call('interface-placeholder.markGap', {
      role: 'netzplanung',
      reason: 'NEEDS_DECISION',
      blockingLevel: 'hard',
    });

    const result = await broker.call('interface-placeholder.canExecuteAction', {
      action: 'decision_commit',
    });

    expect(result.allowed).toBe(false);
    expect(result.decisionStatus).toBe('blocked');
  });
});
