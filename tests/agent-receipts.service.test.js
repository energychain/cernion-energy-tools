'use strict';

const { ServiceBroker } = require('moleculer');
const AgentReceiptsService = require('../services/agent-receipts.service');

// #289: promote / setStatus(active) require an authorized caller.
const FULL_ACCESS_CTX = { meta: { authUser: { roles: ['full-access'] } } };

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
      name: 'grid-operations',
      actions: {
        marketPartners: {
          params: { limit: { type: 'number', optional: true } },
          handler() {
            return { success: true, data: { items: [] } };
          },
        },
        vnbLookup: {
          params: {
            city: { type: 'string', optional: true },
            bdew: { type: 'string', optional: true },
            vnbName: { type: 'string', optional: true },
          },
          handler() {
            return { success: true, data: { mastrId: 'SNB_TEST_001', bdew: '9900992720003' } };
          },
        },
      },
    });

    broker.createService({
      name: 'knowledge-rag',
      actions: {
        query: {
          handler(ctx) {
            const query = String(ctx.params?.query || '');
            if (/timeout-case/i.test(query)) {
              const error = new Error('Request timeout');
              error.type = 'REQUEST_TIMEOUT';
              throw error;
            }
            if (/missing-case/i.test(query)) {
              return { success: true, data: { results: [] } };
            }
            return {
              success: true,
              data: {
                results: [
                  {
                    id: 'knowledge-hit-1',
                    source: 'BNetzA',
                    score: 0.92,
                    summary: 'Kurzbeleg zur Zuständigkeit im Netzgebiet.',
                    referenceText: 'DO_NOT_LEAK_RAW_REFERENCE',
                    metadata: {
                      docType: 'Festlegung',
                      publishedAt: '2026-01-01T00:00:00.000Z',
                    },
                  },
                ],
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

  it('accepts semantic knowledgeQueries and rejects non-semantic modes', async () => {
    const withKnowledge = await broker.call(
      'agent-receipts.create',
      validReceipt({
        receiptId: 'knowledge-query-valid-v1',
        title: 'Knowledge query valid',
        knowledgeQueries: [
          {
            id: 'kq1',
            queryType: 'semantic',
            query: '{{message}}',
            limit: 2,
            summaryMaxChars: 180,
          },
        ],
        knowledgeEvidencePolicy: {
          required: false,
        },
      })
    );

    expect(withKnowledge.success).toBe(true);
    expect(withKnowledge.data.knowledgeQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'kq1',
          queryType: 'semantic',
          query: '{{message}}',
        }),
      ])
    );

    await expect(
      broker.call(
        'agent-receipts.create',
        validReceipt({
          receiptId: 'knowledge-query-invalid-v1',
          title: 'Knowledge query invalid',
          knowledgeQueries: [
            {
              queryType: 'keyword',
              query: '{{message}}',
            },
          ],
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

    const activated = await broker.call(
      'agent-receipts.setStatus',
      {
        id: 'active-valid',
        status: 'active',
      },
      FULL_ACCESS_CTX
    );
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

  it('returns metadata-first knowledge evidence in evaluate output', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'knowledge-evidence-evaluate-v1',
        title: 'Knowledge evidence evaluate',
        matching: {
          triggerTerms: ['netzbetreiber'],
        },
        requiredInputs: [],
      }),
      knowledgeQueries: [
        {
          id: 'kq-evaluate',
          queryType: 'semantic',
          query: '{{message}}',
          limit: 1,
        },
      ],
    });

    const evaluation = await broker.call('agent-receipts.evaluateStored', {
      id: 'knowledge-evidence-evaluate-v1',
      input: {
        message: 'zuständiger Netzbetreiber Wiesloch',
      },
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.knowledgeEvidenceStatus).toBe('available');
    expect(evaluation.data.knowledgeEvidencePolicy).toEqual(
      expect.objectContaining({ required: false })
    );
    expect(evaluation.data.knowledgeEvidence[0]).toEqual(
      expect.objectContaining({
        hitId: 'knowledge-hit-1',
        source: 'BNetzA',
        summary: expect.any(String),
      })
    );
    expect(JSON.stringify(evaluation.data.knowledgeEvidence)).not.toContain(
      'DO_NOT_LEAK_RAW_REFERENCE'
    );
  });

  it('marks timeout knowledge status and warning when knowledge evidence is required', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'knowledge-timeout-required-v1',
        title: 'Knowledge timeout required',
        matching: {
          triggerTerms: ['netzbetreiber'],
        },
        requiredInputs: [],
      }),
      knowledgeQueries: [
        {
          id: 'kq-timeout',
          queryType: 'semantic',
          query: '{{message}}',
          timeoutMs: 1000,
        },
      ],
      knowledgeEvidencePolicy: {
        required: true,
        timeoutBehavior: 'degraded',
      },
    });

    const tested = await broker.call('agent-receipts.testStored', {
      id: 'knowledge-timeout-required-v1',
      input: {
        message: 'timeout-case',
      },
    });

    expect(tested.success).toBe(true);
    expect(tested.data.plan.knowledgeEvidenceStatus).toBe('timeout');
    expect(tested.data.plan.knowledgeEvidenceRequired).toBe(true);
    expect(tested.data.plan.knowledgeEvidenceSatisfied).toBe(false);
    expect(
      tested.data.warnings.some(
        (entry) => entry.code === 'RECEIPT_KNOWLEDGE_REQUIRED_NOT_AVAILABLE'
      )
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
    await broker.call(
      'agent-receipts.setStatus',
      { id: 'force-active-v1', status: 'active' },
      FULL_ACCESS_CTX
    );

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

  // v0.54.6: city-only queries select vnb-resolution-chain-v1 (2-step resolution workflow)
  // vnb-lookup-v1 now requires operatorScope (bdew/vnbName); city alone → resolution chain
  it('selects vnb-resolution-chain-v1 from top-level message + knownContext.city', async () => {
    const result = await broker.call('agent-receipts.select', {
      message: 'Wer ist der zuständige Netzbetreiber in Wiesloch?',
      knownContext: { city: 'Wiesloch' },
      explainReceiptSelection: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.selected).toBe(true);
    // city-only → resolution chain (vnb-lookup-v1 is scope-blocked for city-only)
    expect(result.data.receiptId).toBe('vnb-resolution-chain-v1');
    expect(result.data.mode).toBe('matched');
    expect(result.data.diagnostics).toEqual(
      expect.objectContaining({
        matched: true,
        selectionSignals: expect.objectContaining({ city: 'Wiesloch' }),
      })
    );
  });

  it('selects vnb-resolution-chain-v1 from context.question + context.knownContext.city', async () => {
    const result = await broker.call('agent-receipts.select', {
      context: {
        question: 'Wer ist der Netzbetreiber in Wiesloch?',
        knownContext: { city: 'Wiesloch' },
      },
      explainReceiptSelection: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.selected).toBe(true);
    // city-only → resolution chain
    expect(result.data.receiptId).toBe('vnb-resolution-chain-v1');
    expect(result.data.diagnostics.selectionSignals).toEqual(
      expect.objectContaining({ city: 'Wiesloch', inferredVnbSignal: true })
    );
  });

  it('maps knownContext.city to marketPartners query in vnb-resolution-chain-v1 plannedToolCalls', async () => {
    // v0.54.6: city-only evaluation on vnb-resolution-chain-v1 (not vnb-lookup-v1)
    // Step 1 = marketPartners(query: city), step 2 = vnbLookup(scope-blocked until step 1 resolved)
    const evaluation = await broker.call('agent-receipts.evaluateStored', {
      id: 'vnb-resolution-chain-v1',
      context: {
        knownContext: { city: 'Wiesloch' },
        question: 'Wer ist der Netzbetreiber in Wiesloch?',
      },
    });

    expect(evaluation.success).toBe(true);
    // Step 1: marketPartners — locationScope satisfied
    expect(evaluation.data.plannedToolCalls[0].selectedAction).toBe(
      'grid-operations.marketPartners'
    );
    expect(evaluation.data.plannedToolCalls[0].params).toMatchObject({ query: 'Wiesloch' });
    expect(evaluation.data.plannedToolCalls[0].status).toBe('ready');
    // Step 2: vnbLookup — scope-blocked (operatorScope not yet resolved in static eval)
    expect(evaluation.data.plannedToolCalls[1].selectedAction).toBe('grid-operations.vnbLookup');
    expect(evaluation.data.plannedToolCalls[1].status).toBe('scope-blocked');
  });

  it('returns actionable diagnostics when no receipt is selected', async () => {
    const result = await broker.call('agent-receipts.select', {
      message: 'Bitte gib mir Börsenpreise für morgen in Frankreich.',
      explainReceiptSelection: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.selected).toBe(false);
    expect(result.data.mode).toBe('none');
    expect(result.data.diagnostics).toEqual(
      expect.objectContaining({
        evaluatedCandidates: expect.any(Number),
        candidates: expect.arrayContaining([
          expect.objectContaining({
            receiptId: expect.any(String),
            rejectReason: expect.any(String),
          }),
        ]),
      })
    );
  });
});

// ─── v0.54.5 Learning Loop / Draft Receipts ──────────────────────────────────

describe('Agent Receipts Service — v0.54.5 proposeDraft + promote', () => {
  let broker;

  function draftProposal(overrides = {}) {
    return {
      receiptId: 'learning-loop-test-v1',
      title: 'Learning loop test receipt',
      description: 'Draft receipt created via proposeDraft for governed learning loop testing.',
      domain: 'grid-operations',
      tags: ['test'],
      matching: {
        domains: ['grid-operations'],
        triggerTerms: ['learning-loop'],
      },
      toolPlan: {
        steps: [
          {
            action: 'grid-operations.marketPartners',
            params: { limit: 3 },
          },
        ],
      },
      ...overrides,
    };
  }

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'grid-operations',
      actions: {
        marketPartners: {
          params: { limit: { type: 'number', optional: true } },
          handler() {
            return { success: true, data: { items: [] } };
          },
        },
        vnbLookup: {
          params: {
            city: { type: 'string', optional: true },
            bdewCode: { type: 'string', optional: true },
          },
          handler() {
            return { success: true, data: { vnb: null } };
          },
        },
      },
    });

    broker.createService({
      name: 'knowledge-rag',
      actions: {
        query: {
          handler() {
            return { success: true, data: { results: [] } };
          },
        },
      },
    });

    const AgentReceiptsService = require('../services/agent-receipts.service');
    broker.createService({
      ...AgentReceiptsService,
      settings: {
        ...AgentReceiptsService.settings,
        dbPath: `./data/agent-receipts-test-v054-${Date.now()}`,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  // T-AR-01: proposeDraft creates receipt with status: draft and full audit metadata
  it('T-AR-01: proposeDraft creates receipt with status draft and audit metadata', async () => {
    const result = await broker.call('agent-receipts.proposeDraft', {
      ...draftProposal(),
      creatorId: 'agent-chat-session-abc',
      creatorSource: 'chat',
      changeReason: 'Proposed from chat to improve VNB lookup accuracy.',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('draft');
    expect(result.pendingReview).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(result.message).toMatch(/pending review/i);

    const { data } = result;
    expect(data.status).toBe('draft');
    expect(data.creatorSource).toBe('chat');
    expect(data.creatorId).toBe('agent-chat-session-abc');
    expect(data.changeReason).toBe('Proposed from chat to improve VNB lookup accuracy.');
    expect(data.promotedAt).toBeNull();
    expect(data.promotedBy).toBeNull();
    expect(data.promotedFromDraftId).toBeNull();
    expect(data.activatedAt).toBeNull();
  });

  // T-AR-02: proposeDraft rejects any non-draft status in the payload
  it('T-AR-02: proposeDraft rejects status: active in the payload', async () => {
    await expect(
      broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'status-reject-test-v1' }),
        status: 'active',
      })
    ).rejects.toMatchObject({
      code: 422,
      type: 'AGENT_RECEIPT_PROPOSE_STATUS_REJECTED',
    });
  });

  it('T-AR-02b: proposeDraft rejects status: deprecated in the payload', async () => {
    await expect(
      broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'status-reject-deprecated-v1' }),
        status: 'deprecated',
      })
    ).rejects.toMatchObject({
      code: 422,
      type: 'AGENT_RECEIPT_PROPOSE_STATUS_REJECTED',
    });
  });

  // T-AR-03: promote transitions draft to active with full audit metadata
  it('T-AR-03: promote transitions draft to active and records promotedAt, promotedBy', async () => {
    await broker.call('agent-receipts.proposeDraft', {
      ...draftProposal({ receiptId: 'promote-test-v1' }),
      creatorSource: 'api',
    });

    const result = await broker.call(
      'agent-receipts.promote',
      {
        id: 'promote-test-v1',
        promotedBy: 'reviewer@example.com',
        changeReason: 'Validated against known test cases. Promoting to active.',
      },
      FULL_ACCESS_CTX
    );

    expect(result.success).toBe(true);
    const { data } = result;
    expect(data.status).toBe('active');
    expect(data.promotedBy).toBe('reviewer@example.com');
    expect(typeof data.promotedAt).toBe('string');
    expect(data.promotedFromDraftId).toBe('promote-test-v1');
    expect(data.changeReason).toBe('Validated against known test cases. Promoting to active.');
    expect(typeof data.activatedAt).toBe('string');
  });

  // T-AR-04: promote blocks promotion when receipt has blocking validation errors
  it('T-AR-04: promote rejects a draft with blocking validation errors', async () => {
    // Create via direct create (bypassing proposeDraft) with an invalid tool action to simulate
    // a broken draft that has a bad toolPlan injected after creation.
    // We use the internal PouchDB to inject a corrupt doc.
    const service = broker.getLocalService('agent-receipts');
    const corruptId = 'corrupt-draft-v1';
    const now = new Date().toISOString();
    await service.db.put({
      _id: `ar:${corruptId}`,
      type: 'agent-receipt',
      receiptId: corruptId,
      title: 'Corrupt draft',
      description: 'Draft with bad toolPlan for test.',
      domain: 'grid-operations',
      tags: [],
      matching: { domains: ['grid-operations'], triggerTerms: ['corrupt'] },
      requiredInputs: [],
      toolPlan: {
        steps: [
          {
            action: 'INVALID ACTION FORMAT',
            params: {},
          },
        ],
      },
      evidencePolicy: {},
      responsePolicy: {},
      knowledgeQueries: [],
      knowledgeEvidencePolicy: { required: false },
      forbiddenInferences: [],
      defaults: {},
      metadata: {},
      status: 'draft',
      version: 1,
      createdAt: now,
      updatedAt: now,
      activatedAt: null,
      deprecatedAt: null,
      archivedAt: null,
      creatorId: null,
      creatorSource: 'api',
      promotedAt: null,
      promotedBy: null,
      promotedFromDraftId: null,
    });

    await expect(
      broker.call(
        'agent-receipts.promote',
        {
          id: corruptId,
          promotedBy: 'reviewer@example.com',
        },
        FULL_ACCESS_CTX
      )
    ).rejects.toMatchObject({
      code: 409,
      type: 'AGENT_RECEIPT_BLOCKING_VALIDATION',
    });
  });

  // T-AR-05: promote rejects if receipt is already active (not a draft)
  it('T-AR-05: promote rejects when the receipt is already active', async () => {
    await broker.call('agent-receipts.proposeDraft', {
      ...draftProposal({ receiptId: 'already-active-v1' }),
      creatorSource: 'admin',
    });

    // First promote succeeds
    await broker.call(
      'agent-receipts.promote',
      {
        id: 'already-active-v1',
        promotedBy: 'admin@example.com',
      },
      FULL_ACCESS_CTX
    );

    // Second promote attempt must fail
    await expect(
      broker.call(
        'agent-receipts.promote',
        {
          id: 'already-active-v1',
          promotedBy: 'admin@example.com',
        },
        FULL_ACCESS_CTX
      )
    ).rejects.toMatchObject({
      code: 409,
      type: 'AGENT_RECEIPT_PROMOTE_NOT_DRAFT',
    });
  });

  // T-AR-06: promote CAS rev guard prevents concurrent promotion race
  it('T-AR-06: promote with stale _rev is rejected by CAS guard', async () => {
    await broker.call('agent-receipts.proposeDraft', {
      ...draftProposal({ receiptId: 'cas-guard-test-v1' }),
      creatorSource: 'api',
    });

    const doc = await broker.call('agent-receipts.get', { id: 'cas-guard-test-v1' });
    const correctRev = doc.data._rev;

    // Promote with a fabricated stale rev must be rejected
    await expect(
      broker.call(
        'agent-receipts.promote',
        {
          id: 'cas-guard-test-v1',
          promotedBy: 'reviewer@example.com',
          _rev: '1-stalerevisiontokenxxx',
        },
        FULL_ACCESS_CTX
      )
    ).rejects.toMatchObject({
      code: 409,
      type: 'AGENT_RECEIPT_CONFLICT',
    });

    // Promote with correct rev succeeds
    const result = await broker.call(
      'agent-receipts.promote',
      {
        id: 'cas-guard-test-v1',
        promotedBy: 'reviewer@example.com',
        _rev: correctRev,
      },
      FULL_ACCESS_CTX
    );
    expect(result.data.status).toBe('active');
  });

  // T-AR-07: promote auto-deprecates superseded active receipt with full audit fields
  it('T-AR-07: promote auto-deprecates superseded receipt with deprecatedBy and supersededByReceiptId', async () => {
    // Create an active receipt to be superseded
    await broker.call('agent-receipts.create', {
      ...draftProposal({
        receiptId: 'superseded-active-v1',
        title: 'Original active receipt to be superseded',
        matching: { triggerTerms: ['supersede-test'] },
      }),
      status: 'active',
    });

    // Create the successor draft
    await broker.call('agent-receipts.proposeDraft', {
      ...draftProposal({
        receiptId: 'successor-draft-v1',
        title: 'Successor receipt that supersedes the original',
        matching: { triggerTerms: ['supersede-test'] },
      }),
      supersedes: 'superseded-active-v1',
      creatorSource: 'admin',
    });

    // Promote the draft — should auto-deprecate superseded-active-v1
    const result = await broker.call(
      'agent-receipts.promote',
      {
        id: 'successor-draft-v1',
        promotedBy: 'admin@example.com',
        changeReason: 'Improved version replaces original.',
      },
      FULL_ACCESS_CTX
    );

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('active');
    expect(result.superseded).toEqual({ receiptId: 'superseded-active-v1', status: 'deprecated' });

    // Verify the superseded receipt is now deprecated with audit metadata
    const superseded = await broker.call('agent-receipts.get', { id: 'superseded-active-v1' });
    expect(superseded.data.status).toBe('deprecated');
    expect(superseded.data.metadata.deprecatedBy).toBe('admin@example.com');
    expect(superseded.data.metadata.supersededByReceiptId).toBe('successor-draft-v1');
    expect(superseded.data.metadata.changeReason).toBe('Improved version replaces original.');
  });

  // T-AR-08: chat-path guardrail — proposeDraft response clearly marks draft as pending review
  it('T-AR-08: chat-path response from proposeDraft is unambiguous: draft, pendingReview, no active language', async () => {
    const result = await broker.call('agent-receipts.proposeDraft', {
      ...draftProposal({ receiptId: 'chat-guardrail-test-v1' }),
      creatorSource: 'chat',
      creatorId: 'user-session-789',
    });

    // Response must not convey active activation
    expect(result.status).toBe('draft');
    expect(result.pendingReview).toBe(true);
    expect(result.data.status).toBe('draft');
    expect(result.data.activatedAt).toBeNull();
    expect(result.data.promotedAt).toBeNull();
    expect(result.data.promotedBy).toBeNull();

    // Message must mention pending review, not activation
    expect(result.message).not.toMatch(/activ/i);
    expect(result.message).toMatch(/draft/i);
  });

  // T-AR-09: evaluateStored maps city from nested knownContext into plannedToolCalls params
  it('T-AR-09: evaluateStored resolves city from context.knownContext into plannedToolCalls params', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'vnb-city-context-test-v1',
        title: 'VNB city context test',
        matching: { triggerTerms: ['netzbetreiber', 'city'] },
        requiredInputs: ['city'],
        toolPlan: {
          steps: [
            {
              action: 'grid-operations.vnbLookup',
              description: 'Netzbetreiber für Ort ermitteln',
              paramMapping: { city: { source: 'context', contextField: 'city' } },
            },
          ],
        },
      }),
    });

    const evaluation = await broker.call('agent-receipts.evaluateStored', {
      id: 'vnb-city-context-test-v1',
      context: {
        knownContext: {
          city: 'Wiesloch',
        },
      },
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.plannedToolCalls[0].params).toMatchObject({ city: 'Wiesloch' });
  });

  // T-AR-10: select resolves city signal from context.knownContext without forceReceipt
  it('T-AR-10: select picks vnb receipt when city passed via context.knownContext', async () => {
    await broker.call('agent-receipts.create', {
      ...validReceipt({
        receiptId: 'vnb-autoselect-city-v1',
        title: 'VNB auto-select city',
        matching: { domains: ['grid-operations'], triggerTerms: ['netzbetreiber', 'wiesloch'] },
        requiredInputs: ['city'],
        toolPlan: {
          steps: [
            {
              action: 'grid-operations.vnbLookup',
              description: 'Netzbetreiber für Ort ermitteln',
              paramMapping: { city: { source: 'context', contextField: 'city' } },
            },
          ],
        },
      }),
    });
    await broker.call(
      'agent-receipts.promote',
      {
        id: 'vnb-autoselect-city-v1',
        promotedBy: 'test-admin',
      },
      FULL_ACCESS_CTX
    );

    const result = await broker.call('agent-receipts.select', {
      message: 'Wer ist der Netzbetreiber in Wiesloch?',
      context: {
        domain: 'grid-operations',
        knownContext: { city: 'Wiesloch' },
      },
      includeEvaluation: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.selected).toBe(true);
    // city-only selection may resolve to legacy or scope-chain receipts depending on seed/catalog state
    expect(['vnb-lookup-v1', 'vnb-autoselect-city-v1', 'vnb-resolution-chain-v1']).toContain(
      result.data.receiptId
    );
  });

  // ── Receipt-promotion authorization (#289, gap identified in #275's Bestandsanalyse) ─
  describe('promotion authorization', () => {
    test('promote is rejected for a caller without full-access or ROLE_RECEIPT_PROMOTER', async () => {
      await broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'unauthorized-promote-v1' }),
        creatorSource: 'api',
      });

      await expect(
        broker.call(
          'agent-receipts.promote',
          { id: 'unauthorized-promote-v1', promotedBy: 'someone@example.com' },
          { meta: { authUser: { roles: ['ROLE_UNRELATED'] } } }
        )
      ).rejects.toMatchObject({ code: 403, type: 'AGENT_RECEIPT_PROMOTE_FORBIDDEN' });

      const unchanged = await broker.call('agent-receipts.get', { id: 'unauthorized-promote-v1' });
      expect(unchanged.data.status).toBe('draft');
    });

    test('promote is rejected for a caller with no auth meta at all', async () => {
      await broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'no-meta-promote-v1' }),
        creatorSource: 'api',
      });

      await expect(
        broker.call('agent-receipts.promote', {
          id: 'no-meta-promote-v1',
          promotedBy: 'someone@example.com',
        })
      ).rejects.toMatchObject({ code: 403, type: 'AGENT_RECEIPT_PROMOTE_FORBIDDEN' });
    });

    test('promote succeeds for a caller with ROLE_RECEIPT_PROMOTER (no full-access needed)', async () => {
      await broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'dedicated-role-promote-v1' }),
        creatorSource: 'api',
      });

      const result = await broker.call(
        'agent-receipts.promote',
        { id: 'dedicated-role-promote-v1', promotedBy: 'reviewer@example.com' },
        { meta: { authUser: { roles: ['ROLE_RECEIPT_PROMOTER'] } } }
      );
      expect(result.data.status).toBe('active');
    });

    test('setStatus to active is also rejected for an unauthorized caller (parallel bypass closed)', async () => {
      await broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'unauthorized-setstatus-v1' }),
        creatorSource: 'api',
      });

      await expect(
        broker.call(
          'agent-receipts.setStatus',
          { id: 'unauthorized-setstatus-v1', status: 'active' },
          { meta: { authUser: { roles: ['ROLE_UNRELATED'] } } }
        )
      ).rejects.toMatchObject({ code: 403, type: 'AGENT_RECEIPT_PROMOTE_FORBIDDEN' });
    });

    test('setStatus to a non-active status does not require promotion authorization', async () => {
      await broker.call('agent-receipts.proposeDraft', {
        ...draftProposal({ receiptId: 'archive-no-auth-v1' }),
        creatorSource: 'api',
      });

      const result = await broker.call(
        'agent-receipts.setStatus',
        { id: 'archive-no-auth-v1', status: 'archived' },
        { meta: { authUser: { roles: ['ROLE_UNRELATED'] } } }
      );
      expect(result.data.status).toBe('archived');
    });
  });
});
