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
      name: 'mastr',
      actions: {
        installationsByLocation: {
          params: {
            location: { type: 'string' },
            type: { type: 'string', optional: true },
            limit: { type: 'number', optional: true },
          },
          handler() {
            return {
              success: true,
              result: {
                count: 2,
                items: [{ capacityKw: 10 }, { capacityKw: 12 }],
                source: 'test-fixture',
                timestamp: new Date().toISOString(),
              },
            };
          },
        },
      },
    });

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
    await broker.call(
      'agent-receipts.create',
      validReceipt({
        receiptId: 'connection-rejection-evidence',
        title: 'Connection rejection evidence chain',
      })
    );

    await broker.call('agent-receipts.archive', { id: 'connection-rejection-evidence' });

    const defaultList = await broker.call('agent-receipts.list', {});
    expect(
      defaultList.data.some((entry) => entry.receiptId === 'connection-rejection-evidence')
    ).toBe(false);

    const fullList = await broker.call('agent-receipts.list', { includeArchived: true });
    expect(fullList.data.some((entry) => entry.receiptId === 'connection-rejection-evidence')).toBe(
      true
    );
  });

  it('rejects invalid receipts with AGENT_RECEIPT_VALIDATION_FAILED', async () => {
    await expect(
      broker.call(
        'agent-receipts.create',
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
    await broker.call(
      'agent-receipts.create',
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

  it('flags missing service action references during validate', async () => {
    const response = await broker.call('agent-receipts.validate', {
      receipt: validReceipt({
        receiptId: 'missing-action-receipt',
        toolPlan: {
          steps: [{ action: 'unknown.serviceAction' }],
        },
      }),
    });

    expect(response.success).toBe(true);
    expect(response.data.valid).toBe(false);
    expect(response.data.errors.some((entry) => /not found/i.test(entry.message))).toBe(true);
  });

  it('reports missing required input in test harness output', async () => {
    await broker.call('agent-receipts.create', {
      receiptId: 'inventory-missing-input',
      title: 'Inventory by location - missing input test',
      description: 'Test harness should report missing required inputs for deterministic mapping.',
      domain: 'mastr',
      matching: {
        triggerTerms: ['pv', 'anlagen'],
      },
      requiredInputs: ['location'],
      toolPlan: {
        defaults: {
          limit: 20,
        },
        steps: [
          {
            action: 'mastr.installationsByLocation',
            paramMapping: {
              location: { source: 'context', contextField: 'location' },
              type: { source: 'context', contextField: 'assetType' },
              limit: { source: 'default', defaultKey: 'limit' },
            },
            evidence: {
              requiredOutputFields: [
                'result.count',
                'result.items[].capacityKw',
                'result.source',
                'result.timestamp',
              ],
            },
          },
        ],
      },
    });

    const tested = await broker.call('agent-receipts.testStored', {
      id: 'inventory-missing-input',
      context: {
        question: 'Wie viele PV Anlagen gibt es?',
        assetType: 'solar',
      },
    });

    expect(tested.success).toBe(true);
    expect(tested.data.executable).toBe(false);
    expect(tested.data.missingRequiredInputs).toContain('location');
    expect(tested.data.plan.steps[0].missingRequiredParams).toContain('location');
  });

  it('builds an executable Wiesloch receipt plan with deterministic mapping', async () => {
    await broker.call('agent-receipts.create', {
      receiptId: 'mastr-asset-inventory-by-location',
      title: 'MaStR asset inventory by location',
      description:
        'Deterministic local inventory lookup by city and asset type with structured evidence.',
      domain: 'mastr',
      tags: ['mastr', 'inventory', 'location'],
      matching: {
        triggerTerms: ['wie', 'viele', 'anlagen', 'wiesloch'],
        requiredEntities: ['location'],
      },
      requiredInputs: ['location'],
      toolPlan: {
        defaults: {
          limit: 50,
        },
        steps: [
          {
            action: 'mastr.installationsByLocation',
            description: 'Load MaStR installations for requested location and type.',
            paramMapping: {
              location: { source: 'context', contextField: 'location' },
              type: { source: 'context', contextField: 'assetType' },
              limit: { source: 'default', defaultKey: 'limit' },
            },
            evidence: {
              requiredOutputFields: [
                'result.count',
                'result.items[].capacityKw',
                'result.source',
                'result.timestamp',
              ],
            },
          },
        ],
      },
      metadata: {
        registryAudit: {
          actions: {
            'mastr.installationsByLocation': {
              signature: 'outdated-signature-for-warning',
            },
          },
        },
      },
    });

    const evaluation = await broker.call('agent-receipts.evaluateStored', {
      id: 'mastr-asset-inventory-by-location',
      context: {
        question: 'Wie viele PV Anlagen gibt es in Wiesloch?',
        location: 'Wiesloch',
        assetType: 'solar',
      },
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.executable).toBe(true);
    expect(evaluation.data.matchScore).toBeGreaterThanOrEqual(30);
    expect(evaluation.data.plannedToolCalls[0].selectedAction).toBe(
      'mastr.installationsByLocation'
    );
    expect(evaluation.data.plannedToolCalls[0].params).toMatchObject({
      location: 'Wiesloch',
      type: 'solar',
      limit: 50,
    });
    expect(
      evaluation.data.warnings.some((entry) => entry.code === 'RECEIPT_ACTION_SIGNATURE_CHANGED')
    ).toBe(true);
  });

  it('selects an active forced receipt and reports mode forced', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'force-active-v1',
        title: 'Force active receipt',
        matching: {
          triggerTerms: ['troisdorf'],
        },
        requiredInputs: [],
      }),
    });
    await broker.call('agent-receipts.setStatus', { id: 'force-active-v1', status: 'active' });

    const selected = await broker.call('agent-receipts.select', {
      message: 'Bitte prüfe Troisdorf.',
      forceReceipt: 'force-active-v1',
    });

    expect(selected.success).toBe(true);
    expect(selected.data.selected).toBe(true);
    expect(selected.data.receiptId).toBe('force-active-v1');
    expect(selected.data.mode).toBe('forced');
  });

  it('returns 422 for invalid forceReceipt', async () => {
    await expect(
      broker.call('agent-receipts.select', {
        message: 'Bitte prüfe Troisdorf.',
        forceReceipt: 'does-not-exist-v1',
      })
    ).rejects.toMatchObject({
      code: 422,
      type: 'RECEIPT_NOT_FOUND_OR_INVALID',
    });
  });

  it('blocks forced draft receipt unless allowDraftReceipts=true', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'force-draft-v1',
        title: 'Force draft receipt',
        matching: {
          triggerTerms: ['troisdorf'],
        },
        requiredInputs: [],
        status: 'draft',
      }),
    });

    await expect(
      broker.call('agent-receipts.select', {
        message: 'Bitte prüfe Troisdorf.',
        forceReceipt: 'force-draft-v1',
      })
    ).rejects.toMatchObject({
      code: 422,
      type: 'RECEIPT_DRAFT_NOT_ALLOWED',
    });

    const selected = await broker.call('agent-receipts.select', {
      message: 'Bitte prüfe Troisdorf.',
      forceReceipt: 'force-draft-v1',
      allowDraftReceipts: true,
    });

    expect(selected.success).toBe(true);
    expect(selected.data.selected).toBe(true);
    expect(selected.data.receiptId).toBe('force-draft-v1');
    expect(selected.data.mode).toBe('forced');
  });

  it('ignores preferred draft receipts unless allowDraftReceipts is true', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'preferred-draft-v1',
        title: 'Preferred draft receipt',
        matching: {
          triggerTerms: ['wie', 'viele', 'anlagen', 'wiesloch'],
        },
        requiredInputs: [],
        status: 'draft',
      }),
    });

    const withoutDrafts = await broker.call('agent-receipts.select', {
      message: 'Wie viele Anlagen gibt es in Wiesloch?',
      preferredReceipts: ['preferred-draft-v1'],
      explainReceiptSelection: true,
    });

    expect(withoutDrafts.success).toBe(true);
    expect(withoutDrafts.data.selected).toBe(false);
    expect(withoutDrafts.data.mode).toBe('none');
    expect(withoutDrafts.data.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PREFERRED_RECEIPT_NOT_FOUND_OR_NOT_ALLOWED',
          receiptId: 'preferred-draft-v1',
        }),
      ])
    );

    const withDrafts = await broker.call('agent-receipts.select', {
      message: 'Wie viele Anlagen gibt es in Wiesloch?',
      preferredReceipts: ['preferred-draft-v1'],
      allowDraftReceipts: true,
    });

    expect(withDrafts.success).toBe(true);
    expect(withDrafts.data.selected).toBe(true);
    expect(withDrafts.data.mode).toBe('preferred');
    expect(withDrafts.data.receiptId).toBe('preferred-draft-v1');
  });
});
