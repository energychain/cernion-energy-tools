'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const ObjectStoreService = require('../services/object-store.service');
const PersonalAgentService = require('../services/personal-agent.service');

describe('personal-agent proactive message actions', () => {
  let broker;
  let objectStorePath;
  let inboxItems;

  beforeEach(async () => {
    objectStorePath = path.join(os.tmpdir(), `pa-proactive-${Date.now()}-${Math.random()}`);
    inboxItems = [
      {
        id: 'inbox-1',
        type: 'hitl-approval',
        hitlItemId: 'hitl-1',
        embedRef: 'hitl_item_hitl-1',
        title: 'Freigabe erforderlich',
        summary: 'Bitte prüfen Sie den blockierten Schritt.',
        status: 'queued',
        createdAt: new Date().toISOString(),
      },
    ];

    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: objectStorePath,
      },
    });

    broker.createService({
      name: 'agent-persona',
      actions: {
        get: {
          handler(ctx) {
            return {
              success: true,
              item: {
                id: ctx.params.id,
                tenantId: ctx.params.tenantId,
                personaName: 'Thorsten Zoerner',
                personaType: 'human',
                defaultPersonalAgentSessionId: 'pa-proactive-1',
                status: 'active',
              },
            };
          },
        },
        list: {
          handler(ctx) {
            return {
              success: true,
              items: [
                {
                  id: 'tenant-a/persona-1',
                  tenantId: ctx.params.tenantId,
                  personaName: 'Thorsten Zoerner',
                  personaType: 'human',
                  defaultPersonalAgentSessionId: 'pa-proactive-1',
                  status: 'active',
                },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'persona-inbox',
      actions: {
        listPendingForPersona: {
          handler() {
            return {
              success: true,
              count: inboxItems.length,
              items: inboxItems,
            };
          },
        },
        markVisible: {
          handler(ctx) {
            inboxItems = inboxItems.map((item) =>
              ctx.params.ids.includes(item.id)
                ? {
                    ...item,
                    status: 'visible',
                    visibleAt: new Date().toISOString(),
                  }
                : item
            );
            return {
              success: true,
              count: inboxItems.length,
              items: inboxItems,
            };
          },
        },
        acknowledge: {
          handler(ctx) {
            const found = inboxItems.find((item) => item.id === ctx.params.id);
            return {
              success: true,
              item: {
                ...found,
                status: 'acknowledged',
                acknowledgedAt: new Date().toISOString(),
              },
            };
          },
        },
      },
    });

    broker.createService(PersonalAgentService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(objectStorePath, { recursive: true, force: true });
  });

  test('pullProactiveMessages returns minimal user-facing payload and marks messages visible', async () => {
    const response = await broker.call(
      'personal-agent.pullProactiveMessages',
      {
        sessionId: 'pa-proactive-1',
        personaId: 'tenant-a/persona-1',
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-a' } } }
    );

    expect(response.success).toBe(true);
    expect(response.personaId).toBe('tenant-a/persona-1');
    expect(response.count).toBe(1);
    expect(response.proactiveMessages).toHaveLength(1);

    const payload = response.proactiveMessages[0];
    expect(Object.keys(payload).sort()).toEqual(
      ['id', 'type', 'hitlItemId', 'embedRef', 'title', 'summary', 'status', 'createdAt'].sort()
    );
    expect(payload.status).toBe('visible');
    expect(payload.id).toBe('inbox-1');
    expect(payload).not.toHaveProperty('dispatchId');
    expect(payload).not.toHaveProperty('warnings');
  });

  test('acknowledgeProactiveMessage maps to acknowledged lifecycle state', async () => {
    const response = await broker.call(
      'personal-agent.acknowledgeProactiveMessage',
      {
        sessionId: 'pa-proactive-1',
        personaId: 'tenant-a/persona-1',
        id: 'inbox-1',
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-a' } } }
    );

    expect(response.success).toBe(true);
    expect(response.item.id).toBe('inbox-1');
    expect(response.item.status).toBe('acknowledged');
    expect(Object.keys(response.item).sort()).toEqual(
      ['id', 'type', 'hitlItemId', 'embedRef', 'title', 'summary', 'status', 'createdAt'].sort()
    );
  });
});
