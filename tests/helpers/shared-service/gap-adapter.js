'use strict';
const { createAdapter } = require('./real-adapter');
const operation = {
  operationId: 'neutral_read',
  action: 'neutral.read',
  service: 'neutral',
  agentable: true,
  operationKind: 'data_read',
  consequenceLevel: 'none',
  sideEffects: [],
  parameters: { required: [] },
};
const model = {
  sourceHash: 'neutral-gaps',
  parameters: { minWeight: 0.2 },
  functions: [
    {
      functionId: 'fn-a',
      label: 'Function A',
      operations: [],
      capabilities: [],
      neighbors: [{ functionId: 'fn-b', weight: 0.8 }],
    },
    {
      functionId: 'fn-b',
      label: 'Function B',
      operations: ['neutral.read'],
      capabilities: [],
      neighbors: [{ functionId: 'fn-a', weight: 0.8 }],
    },
  ],
};
const meta = (id = 'person-a', tenantId = 'tenant-a', roles = ['ROLE_USER']) => ({
  authUser: { tenantId, id, roles, scope: 'read-only' },
  tenantId,
});

async function createGapAdapter(jest) {
  let contextRef = 'case-a';
  let adapter, backend;
  let response = {
    status: 'needs_input',
    missingInputs: [
      { id: 'a', label: 'Field A' },
      { id: 'b', label: 'Field B' },
    ],
  };
  adapter = await createAdapter({
    jest,
    model,
    withAgents: true,
    agentSettings: { operationIndex: { operations: [operation] }, maxGapLists: 2 },
    signalSettings: {
      catalog: {
        version: 2,
        operations: [
          { ...operation, classification: 'contextual', parameterNames: ['caseId'], signals: [] },
        ],
      },
    },
  });
  backend = jest.fn(() => structuredClone(response));
  adapter.broker.createService({ name: 'neutral', actions: { read: { handler: backend } } });
  adapter.broker.createService({
    name: 'domain-router',
    methods: {
      async loadCase(p, ref) {
        if (
          p.tenantId !== 'tenant-a' ||
          !(p.actorId === 'person-a' || p.actorId.startsWith('agent-')) ||
          ref !== contextRef
        )
          throw new Error('Not visible');
        return { knownContext: {} };
      },
    },
  });
  await adapter.broker.waitForServices(['neutral', 'domain-router']);
  await adapter.apply({
    event: 'function.coverage.changed.v1',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      score: 1,
      origin: 'observed',
    },
  });
  await adapter.apply({
    type: 'touch',
    payload: {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'one',
      confidence: 1,
    },
  });
  await adapter.journal.actions.append(
    {
      tenantId: 'tenant-a',
      functionId: 'fn-b',
      kind: 'observed',
      summary: 'Existing context.',
      refs: [{ kind: 'case', id: contextRef }],
    },
    { meta: meta() }
  );
  adapter.gapFixture = {
    async deliver(turnRef) {
      const options = { meta: meta() };
      const result = await adapter.broker.call(
        'notices.completeTurn',
        {
          tenantId: 'tenant-a',
          actorId: 'person-a',
          turnRef,
        },
        options
      );
      for (const item of result.items.filter((row) => row.kind === 'gap')) {
        const sourceEvent = adapter.noticeSources.find(
          (source) =>
            source.name === item.source &&
            source.payload.gapRef === item.objectRef &&
            source.payload.contentHash === item.contentHash
        )?.payload;
        const doc = await adapter.agents.readDocument('tenant-a');
        const gap = doc.agents
          .flatMap((agent) => agent.gapLists || [])
          .find((row) => row.ref === item.objectRef);
        const p = require('../../../src/domain-router-policy').principal(options);
        const visible =
          gap.recipients.includes(p.actorId) &&
          (await adapter.journal.referenceVisible(options, p, {
            kind: 'case',
            id: item.context.ref,
          }));
        adapter.noticeObservations.push({
          tenantId: p.tenantId,
          actorId: p.actorId,
          ...item,
          visible,
          sourceEvent,
        });
      }
      return result;
    },
    backend,
    model,
    meta,
    get response() {
      return response;
    },
    set response(value) {
      response = value;
    },
    get contextRef() {
      return contextRef;
    },
    set contextRef(value) {
      contextRef = value;
    },
  };
  return adapter;
}
module.exports = { createGapAdapter, model, operation, meta };
