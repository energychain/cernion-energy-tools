'use strict';
const { ServiceBroker } = require('moleculer');
const coverage = require('../services/function-coverage.service');
const workbench = require('../services/workbench.service');
const openai = require('../services/openai-compatible.service');
const { createMemoryDb } = require('./helpers/shared-service/coverage-memory-db');

// Real entrypoints, neutral structured upstream results, injected persistence.
test('Workbench and OpenAI share the completed-turn seam; persistence errors preserve replies', async () => {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const db = createMemoryDb();
  const service = broker.createService({
    ...coverage,
    mixins: [
      {
        ...coverage.mixins[0],
        created() {
          this.db = db;
        },
        async started() {},
      },
    ],
    settings: {
      ...coverage.settings,
      model: { functions: [{ functionId: 'fn-a', capabilities: ['cap-a'], operations: [] }] },
    },
  });
  broker.createService({
    name: 'personal-agent',
    actions: {
      chat: () => ({ reply: 'neutral reply', candidateCapabilities: [{ capability: 'cap-a' }] }),
    },
  });
  broker.createService({
    ...workbench,
    mixins: [],
    created() {
      this.store = {
        async resolveConversation() {
          return { cetCaseId: 'case-a' };
        },
        async linkConversation() {},
      };
    },
    methods: {
      ...workbench.methods,
      async loadWorkbenchContext() {
        return {};
      },
      async loadTurnMemory() {
        return null;
      },
      async saveTurnMemory() {
        return null;
      },
      async eventSummary() {
        return this.emptyEventSummary();
      },
      async resolveUserMapping() {
        return null;
      },
    },
  });
  broker.createService({
    name: 'domain-router',
    actions: {
      continue: () => ({
        cetCaseId: 'case-a',
        caseStateVersion: 1,
        responseText: 'neutral reply',
        candidateCapabilities: [{ capability: 'cap-a' }],
      }),
    },
  });
  broker.createService(openai);
  const meta = { apiToken: { id: 'actor-a', tenantId: 'tenant-a', roles: ['ROLE_USER'] } };
  const events = [];
  broker.createService({
    name: 'observer',
    events: {
      'function.touched.v1': (ctx) => {
        events.push(ctx.params);
      },
    },
  });
  await broker.start();
  try {
    const policyBefore = await broker.call('workbench.tools.list', {}, { meta });
    const request = {
      model: 'cernion-governance-assistant',
      messages: [{ role: 'user', content: 'What is a neutral concept?' }],
      metadata: { conversationId: 'conv-a', requestId: 'req-a' },
    };
    const response = await broker.call('openai-compatible.chatCompletions', request, { meta });
    expect(response.choices[0].message.content).toContain('neutral reply');
    await service.queue;
    await new Promise(setImmediate);
    expect(events).toHaveLength(1);
    expect(events[0].functionId).toBe('fn-a');
    await broker.call('openai-compatible.chatCompletions', request, { meta });
    await service.queue;
    expect(db.docs.size).toBe(1);
    for (let index = 0; index < 20; index++) {
      await broker.call(
        'workbench.chat',
        {
          conversationId: 'conv-a',
          message: 'neutral',
          intentMode: 'case_followup',
          requestId: `chat-${index}`,
        },
        { meta }
      );
      await service.queue;
    }
    const row = (await service.actions.byActor({}, { meta })).items[0];
    expect(row.score).toBeGreaterThan(0.99);
    expect(await broker.call('workbench.tools.list', {}, { meta })).toEqual(policyBefore);
    const facade = await broker.call(
      'openai-compatible.chatCompletions',
      {
        model: 'cernion-agent-mvp',
        messages: request.messages,
        metadata: { conversationId: 'conv-b', requestId: 'facade-a' },
      },
      { meta }
    );
    expect(facade.choices[0].message.content).toContain('neutral reply');
    await service.queue;
    expect((await service.actions.byActor({}, { meta })).items[0].signalCount).toBe(22);
    db.allDocs = async () => {
      throw new Error('unavailable');
    };
    request.metadata.requestId = 'req-b';
    const preserved = await broker.call('openai-compatible.chatCompletions', request, { meta });
    expect(preserved.choices[0].message.content).toContain('neutral reply');
    await service.queue;
  } finally {
    await broker.stop();
  }
});
