'use strict';

const {
  assertSingleActiveLayer4Tool,
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
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
