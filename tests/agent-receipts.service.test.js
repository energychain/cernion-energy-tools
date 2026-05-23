'use strict';

const { ServiceBroker } = require('moleculer');
const AgentReceiptsService = require('../services/agent-receipts.service');

function validReceipt(overrides = {}) {
  return {
    receiptId: 'bess-screening-v1',
    title: 'BESS screening baseline receipt',
    description: 'Runtime receipt for conservative BESS screening workflow with evidence checks.',
    domain: 'grid-operations',
    tags: ['bess', 'screening'],
    matching: {
      domains: ['grid-operations'],
      triggerTerms: ['bess', 'storage'],
      requiredEntities: ['gridOperator'],
      workflowTypes: ['consultation'],
    },
    requiredInputs: ['gridOperator'],
    toolPlan: {
      steps: [
        {
          action: 'grid-operations.marketPartners',
          description: 'Resolve market partner identity before BESS checks.',
          params: { limit: 3 },
        },
      ],
    },
    evidencePolicy: { requireVerifiedToolObservation: true },
    responsePolicy: { onUnverified: 'ask-for-missing-evidence' },
    ...overrides,
  };
}

describe('Agent Receipts Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...AgentReceiptsService,
      settings: {
        ...AgentReceiptsService.settings,
        dbPath: `./data/agent-receipts-test-${Date.now()}`,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('creates, gets, updates, and archives a receipt', async () => {
    const created = await broker.call('agent-receipts.create', validReceipt());
    expect(created.success).toBe(true);
    expect(created.data.receiptId).toBe('bess-screening-v1');
    expect(created.data.status).toBe('draft');

    const loaded = await broker.call('agent-receipts.get', { id: 'bess-screening-v1' });
    expect(loaded.data.title).toBe('BESS screening baseline receipt');

    const updated = await broker.call('agent-receipts.update', {
      id: 'bess-screening-v1',
      patch: {
        title: 'BESS screening baseline receipt (rev 2)',
      },
    });
    expect(updated.data.title).toBe('BESS screening baseline receipt (rev 2)');
    expect(updated.data.version).toBe(2);

    const archived = await broker.call('agent-receipts.archive', {
      id: 'bess-screening-v1',
      reason: 'test archive',
    });
    expect(archived.data.status).toBe('archived');
    expect(typeof archived.data.archivedAt).toBe('string');
  });

  it('hides archived receipts by default in list', async () => {
    await broker.call('agent-receipts.create',
      validReceipt({
        receiptId: 'connection-rejection-evidence',
        title: 'Connection rejection evidence chain',
      })
    );

    await broker.call('agent-receipts.archive', { id: 'connection-rejection-evidence' });

    const defaultList = await broker.call('agent-receipts.list', {});
    expect(defaultList.data.some((entry) => entry.receiptId === 'connection-rejection-evidence')).toBe(
      false
    );

    const fullList = await broker.call('agent-receipts.list', { includeArchived: true });
    expect(fullList.data.some((entry) => entry.receiptId === 'connection-rejection-evidence')).toBe(
      true
    );
  });

  it('rejects invalid receipts with AGENT_RECEIPT_VALIDATION_FAILED', async () => {
    await expect(
      broker.call('agent-receipts.create',
        validReceipt({
          receiptId: 'invalid-missing-steps',
          toolPlan: { steps: [] },
        })
      )
    ).rejects.toMatchObject({
      code: 422,
      type: 'AGENT_RECEIPT_VALIDATION_FAILED',
    });
  });

  it('allows active status only when validation has no blocking errors', async () => {
    await expect(
      broker.call('agent-receipts.create', {
        ...validReceipt({
          receiptId: 'active-invalid',
          status: 'active',
          toolPlan: {
            steps: [
              {
                action: 'not-a-valid-action-ref',
              },
            ],
          },
        }),
      })
    ).rejects.toMatchObject({
      code: 422,
      type: 'AGENT_RECEIPT_VALIDATION_FAILED',
    });

    const created = await broker.call('agent-receipts.create', {
      ...validReceipt({ receiptId: 'active-valid', status: 'draft' }),
    });
    expect(created.data.status).toBe('draft');

    const activated = await broker.call('agent-receipts.setStatus', {
      id: 'active-valid',
      status: 'active',
    });
    expect(activated.data.status).toBe('active');
    expect(typeof activated.data.activatedAt).toBe('string');
  });

  it('checks _rev when provided and returns 409 AGENT_RECEIPT_CONFLICT on mismatch', async () => {
    await broker.call('agent-receipts.create',
      validReceipt({
        receiptId: 'cas-receipt',
        title: 'CAS receipt',
      })
    );

    const current = await broker.call('agent-receipts.get', { id: 'cas-receipt' });

    const updated = await broker.call('agent-receipts.update', {
      id: 'cas-receipt',
      patch: { title: 'CAS receipt updated' },
      _rev: current.data._rev,
    });
    expect(updated.data.title).toBe('CAS receipt updated');

    await expect(
      broker.call('agent-receipts.update', {
        id: 'cas-receipt',
        patch: { title: 'CAS stale write' },
        _rev: current.data._rev,
      })
    ).rejects.toMatchObject({
      code: 409,
      type: 'AGENT_RECEIPT_CONFLICT',
    });
  });
});
