'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const NotificationService = require('../services/notification.service');

describe('notification service', () => {
  let broker;
  let dbPath;
  const personasByTenant = new Map();
  const inboxEntries = [];

  function tenantMeta(tenantId) {
    return { meta: { tenantId } };
  }

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `notification-test-${Date.now()}`);
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'agent-persona',
      actions: {
        get: {
          handler(ctx) {
            const tenantPersonas = personasByTenant.get(ctx.params.tenantId) || new Map();
            const persona = tenantPersonas.get(ctx.params.id);
            if (!persona) {
              const error = new Error('persona not found');
              error.code = 404;
              error.type = 'PERSONA_NOT_FOUND';
              throw error;
            }
            return { success: true, item: persona };
          },
        },
        resolveByRole: {
          handler(ctx) {
            const tenantPersonas = personasByTenant.get(ctx.params.tenantId) || new Map();
            const items = [...tenantPersonas.values()]
              .filter(
                (persona) =>
                  Array.isArray(persona.assignedRoles) && persona.assignedRoles.includes(ctx.params.role)
              )
              .sort((left, right) =>
                String(left.personaName || '').localeCompare(String(right.personaName || ''))
              );
            return { success: true, items, count: items.length };
          },
        },
      },
    });

    broker.createService({
      name: 'persona-inbox',
      actions: {
        enqueue: {
          handler(ctx) {
            const item = {
              id: `inbox-${inboxEntries.length + 1}`,
              tenantId: ctx.params.tenantId,
              personaId: ctx.params.personaId,
              sessionId: ctx.params.sessionId || null,
              type: ctx.params.type,
              hitlItemId: ctx.params.hitlItemId,
              embedRef: ctx.params.embedRef,
              title: ctx.params.title,
              summary: ctx.params.summary,
              status: 'queued',
              createdAt: new Date().toISOString(),
            };
            inboxEntries.push(item);
            return { success: true, item };
          },
        },
      },
    });

    broker.createService({
      ...NotificationService,
      settings: {
        ...NotificationService.settings,
        dbPath,
      },
    });

    await broker.start();

    personasByTenant.set(
      'tenant-a',
      new Map([
        [
          'tenant-a/persona-active',
          {
            id: 'tenant-a/persona-active',
            tenantId: 'tenant-a',
            personaName: 'Thorsten Zoerner',
            personaType: 'human',
            assignedRoles: ['ROLE_NETZPLANUNG'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-tenant-a' }],
            status: 'active',
          },
        ],
        [
          'tenant-a/persona-inactive',
          {
            id: 'tenant-a/persona-inactive',
            tenantId: 'tenant-a',
            personaName: 'Inactive User',
            personaType: 'human',
            assignedRoles: ['ROLE_OFFLINE'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-inactive' }],
            status: 'inactive',
          },
        ],
        [
          'tenant-a/persona-leave',
          {
            id: 'tenant-a/persona-leave',
            tenantId: 'tenant-a',
            personaName: 'On Leave User',
            personaType: 'human',
            assignedRoles: ['ROLE_OFFLINE'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-leave' }],
            status: 'on-leave',
          },
        ],
      ])
    );

    personasByTenant.set(
      'tenant-b',
      new Map([
        [
          'tenant-b/persona-active',
          {
            id: 'tenant-b/persona-active',
            tenantId: 'tenant-b',
            personaName: 'Tenant B User',
            personaType: 'human',
            assignedRoles: ['ROLE_NETZPLANUNG'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-tenant-b' }],
            status: 'active',
          },
        ],
      ])
    );
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  test('dispatch creates tenant-scoped record for resolved persona', async () => {
    inboxEntries.length = 0;

    const result = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-1',
        personaId: 'tenant-a/persona-active',
        sourceService: 'hitl',
        sourceAction: 'create',
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    expect(result.dispatch.tenantId).toBe('tenant-a');
    expect(result.dispatch.payload).toMatchObject({
      tenantId: 'tenant-a',
      hitlItemId: 'hitl-1',
      personaId: 'tenant-a/persona-active',
      embedRef: 'hitl_item_hitl-1',
      sourceService: 'hitl',
      sourceAction: 'create',
    });
    expect(result.dispatch.status).toBe('queued');
    expect(result.dispatch.inboxHandoff).toMatchObject({
      status: 'queued',
      messageId: 'inbox-1',
    });
    expect(inboxEntries).toHaveLength(1);
    expect(inboxEntries[0]).toMatchObject({
      tenantId: 'tenant-a',
      personaId: 'tenant-a/persona-active',
      hitlItemId: 'hitl-1',
      embedRef: 'hitl_item_hitl-1',
      type: 'hitl-approval',
    });

    const listA = await broker.call('notification.listDispatches', {}, tenantMeta('tenant-a'));
    const listB = await broker.call('notification.listDispatches', {}, tenantMeta('tenant-b'));
    expect(listA.total).toBeGreaterThanOrEqual(1);
    expect(listB.total).toBe(0);
  });

  test('role-based dispatch resolves active same-tenant persona', async () => {
    const result = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-2',
        responsibleRole: 'ROLE_NETZPLANUNG',
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    expect(result.dispatch.status).toBe('queued');
    expect(result.dispatch.recipient.personaId).toBe('tenant-a/persona-active');
    expect(result.dispatch.payload.embedRef).toBe('hitl_item_hitl-2');
  });

  test('inactive/on-leave persona is excluded', async () => {
    const result = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-3',
        responsibleRole: 'ROLE_OFFLINE',
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    expect(result.dispatch.status).toBe('unresolved_recipient');
    expect(result.dispatch.recipient.personaId).toBeNull();
    expect(result.dispatch.channels).toHaveLength(0);
  });

  test('unresolved role creates unresolved_recipient', async () => {
    const result = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-4',
        responsibleRole: 'ROLE_UNKNOWN',
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    expect(result.dispatch.status).toBe('unresolved_recipient');
    expect(result.dispatch.channels).toHaveLength(0);
  });

  test('cross-tenant persona id is unresolved', async () => {
    const result = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-5',
        personaId: 'tenant-b/persona-active',
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    expect(result.dispatch.status).toBe('unresolved_recipient');
    expect(result.dispatch.recipient.personaId).toBeNull();
  });

  test('duplicate dispatch is prevented by idempotency key', async () => {
    inboxEntries.length = 0;

    const first = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-6',
        responsibleRole: 'ROLE_NETZPLANUNG',
      },
      tenantMeta('tenant-a')
    );

    const second = await broker.call(
      'notification.dispatchHitlApproval',
      {
        hitlItemId: 'hitl-6',
        responsibleRole: 'ROLE_NETZPLANUNG',
      },
      tenantMeta('tenant-a')
    );

    expect(first.dispatch.id).toBe(second.dispatch.id);
    expect(second.deduplicated).toBe(true);

    const list = await broker.call(
      'notification.listDispatches',
      { hitlItemId: 'hitl-6' },
      tenantMeta('tenant-a')
    );
    expect(list.total).toBe(1);
    expect(inboxEntries).toHaveLength(1);
  });
});
