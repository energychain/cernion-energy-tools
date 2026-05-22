'use strict';

const {
  assertSingleActiveLayer4Tool,
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
  resolveContextMutation,
} = require('../src/personal-agent-context');

describe('personal-agent-context', () => {
  it('enforces single active tool in layer 4', () => {
    expect(() =>
      assertSingleActiveLayer4Tool({
        activeTool: 'a',
        tools: [{ name: 'a' }, { name: 'b' }],
      })
    ).toThrow('L4_SINGLE_TOOL_VIOLATION');
  });

  it('compresses L3 history when token budget is exceeded', () => {
    const longText = 'A'.repeat(1000);
    const history = Array.from({ length: 25 }).map((_, idx) => ({
      role: idx % 2 === 0 ? 'user' : 'assistant',
      text: `${idx}-${longText}`,
      ts: new Date().toISOString(),
    }));

    const result = buildContextStack({
      systemPrompt: 'system',
      tenantFacts: [],
      userProfile: {},
      sessionHistory: history,
      maxContextTokens: 128_000,
      reservations: { l3: 500 },
    });

    expect(result.stack.l3.compressed).toBe(true);
    expect(result.stack.l3.summary).toContain('L3-Summary');
  });

  it('purges L4 raw payload after synthesis', () => {
    const result = buildContextStack({
      systemPrompt: 'system',
      tenantFacts: [],
      userProfile: {},
      sessionHistory: [{ role: 'user', text: 'Hallo', ts: new Date().toISOString() }],
      toolContext: {
        tool: 'grid-connection.validate',
        responseRaw: { decision: 'GO', reserve: 22.5 },
      },
    });

    const finalized = synthesizeAndPurgeLayer4(result.stack, 'Synthese');
    expect(finalized.layer4Purged).toBe(true);
    expect(finalized.stack.l4).toBeNull();
  });

  it('keeps fileAttachments in L3 and persisted payload', () => {
    const attachment = {
      attachmentId: 'fa_01',
      fileName: 'zaehler.csv',
      mimeType: 'text/csv',
      category: 'tabular',
      sizeBytes: 120,
      extract: { type: 'csv', rowCount: 2, headers: ['A'] },
    };

    const stack = buildContextStack({
      systemPrompt: 'system',
      tenantFacts: [],
      userProfile: {},
      sessionHistory: [{ role: 'user', text: 'Hallo', ts: new Date().toISOString() }],
      fileAttachments: [attachment],
    });

    expect(stack.stack.l3.fileAttachments).toHaveLength(1);

    const persisted = buildPersistableSessionState({
      id: 'session-1',
      tenantId: 'default',
      userId: 'u-1',
      l3: stack.stack.l3,
      l2: { userProfile: {} },
      l1: { tenantFacts: [] },
    });

    expect(persisted.l3.fileAttachments).toHaveLength(1);
    expect(persisted.l3.fileAttachments[0].attachmentId).toBe('fa_01');
  });

  it('keeps stateMachine snapshots in persisted payload', () => {
    const persisted = buildPersistableSessionState({
      id: 'session-fsm',
      tenantId: 'default',
      userId: 'u-1',
      l1: { tenantFacts: [] },
      l2: { userProfile: {} },
      l3: {
        history: [],
        stateMachine: {
          currentState: 'completed',
          status: 'completed',
          transitions: [{ state: 'init', at: new Date().toISOString(), details: {} }],
        },
      },
    });

    expect(persisted.l3.stateMachine).toBeTruthy();
    expect(persisted.l3.stateMachine.currentState).toBe('completed');
  });

  it('keeps turnGraph snapshots in persisted payload', () => {
    const persisted = buildPersistableSessionState({
      id: 'session-graph',
      tenantId: 'default',
      userId: 'u-1',
      l1: { tenantFacts: [] },
      l2: { userProfile: {} },
      l3: {
        history: [],
        turnGraph: {
          turnId: 'graph_1',
          status: 'completed',
          nodeCount: 3,
          edgeCount: 2,
          nodes: [{ id: 'msg:user' }],
          edges: [],
        },
      },
    });

    expect(persisted.l3.turnGraph).toBeTruthy();
    expect(persisted.l3.turnGraph.turnId).toBe('graph_1');
  });

  it('rejects persistable state when forbidden L4 keys leak in', () => {
    expect(() =>
      buildPersistableSessionState({
        id: 's-1',
        tenantId: 'default',
        userId: 'u-1',
        l3: { history: [], summary: null, compressed: false },
        l2: { userProfile: { toolContext: { rawJson: { foo: 'bar' } } } },
      })
    ).toThrow('L4_PERSISTENCE_VIOLATION');
  });

  it('rejects persistable state when knowledgeContext leaks in', () => {
    expect(() =>
      buildPersistableSessionState({
        id: 's-2',
        tenantId: 'default',
        userId: 'u-1',
        l3: { history: [], summary: null, compressed: false },
        l2: {
          userProfile: {
            onboardingFacts: {
              knowledgeContext: {
                domainHint: 'market-regulatory',
              },
            },
          },
        },
      })
    ).toThrow('L4_PERSISTENCE_VIOLATION');
  });
});

describe('resolveContextMutation', () => {
  it('PA-CM-001: append when no decisive params change', () => {
    const result = resolveContextMutation(
      { municipality: 'Troisdorf', powerMW: 10 },
      { capacityMWh: 40 }
    );
    expect(result.mode).toBe('append');
    expect(result.replacedKeys).toHaveLength(0);
    expect(result.mergedParams.municipality).toBe('Troisdorf');
    expect(result.mergedParams.powerMW).toBe(10);
    expect(result.mergedParams.capacityMWh).toBe(40);
  });

  it('PA-CM-002: replace when location changes', () => {
    const result = resolveContextMutation(
      { municipality: 'Frankfurt', powerMW: 10 },
      { municipality: 'München' }
    );
    expect(result.mode).toBe('replace');
    expect(result.replacedKeys).toContain('municipality');
    // decisive prev params (municipality) are replaced; non-decisive (powerMW) are kept
    expect(result.mergedParams.municipality).toBe('München');
    expect(result.mergedParams.powerMW).toBe(10);
  });

  it('PA-CM-003: append when decisive param is same value (refinement)', () => {
    const result = resolveContextMutation(
      { municipality: 'Troisdorf' },
      { municipality: 'Troisdorf', powerMW: 15 }
    );
    expect(result.mode).toBe('append');
    expect(result.replacedKeys).toHaveLength(0);
    expect(result.mergedParams.powerMW).toBe(15);
  });

  it('PA-CM-004: replace when gridOperatorName changes', () => {
    const result = resolveContextMutation(
      { municipality: 'Troisdorf', gridOperatorName: 'TWL Netze' },
      { gridOperatorName: 'Stadtwerke Düsseldorf' }
    );
    expect(result.mode).toBe('replace');
    expect(result.replacedKeys).toContain('gridOperatorName');
    // municipality is decisive so it is also dropped
    expect(result.mergedParams.municipality).toBeUndefined();
  });

  it('PA-CM-005: empty incoming produces append with unchanged params', () => {
    const result = resolveContextMutation({ municipality: 'Köln', powerMW: 5 }, {});
    expect(result.mode).toBe('append');
    expect(result.mergedParams.municipality).toBe('Köln');
    expect(result.mergedParams.powerMW).toBe(5);
  });

  it('PA-CM-006: gracefully handles null/undefined inputs', () => {
    expect(() => resolveContextMutation(null, null)).not.toThrow();
    const result = resolveContextMutation(undefined, { municipality: 'Bonn' });
    expect(result.mode).toBe('append');
    expect(result.mergedParams.municipality).toBe('Bonn');
  });

  it('PA-CM-007: append does not drop non-decisive prev params', () => {
    const result = resolveContextMutation(
      { municipality: 'Troisdorf', powerMW: 10, customerId: 'cx-1' },
      { powerMW: 20 }
    );
    expect(result.mode).toBe('append');
    expect(result.mergedParams.customerId).toBe('cx-1');
    expect(result.mergedParams.powerMW).toBe(20);
  });
});
