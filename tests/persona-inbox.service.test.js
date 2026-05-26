'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const PersonaInboxService = require('../services/persona-inbox.service');

describe('persona-inbox service', () => {
  let broker;
  let dbPath;

  function tenantMeta(tenantId) {
    return { meta: { tenantId } };
  }

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `persona-inbox-test-${Date.now()}`);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...PersonaInboxService,
      settings: {
        ...PersonaInboxService.settings,
        dbPath,
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  test('enqueue is tenant-scoped and idempotent', async () => {
    const first = await broker.call(
      'persona-inbox.enqueue',
      {
        personaId: 'tenant-a/persona-1',
        sessionId: 'pa-1',
        type: 'hitl-approval',
        hitlItemId: 'hitl-1',
        embedRef: 'hitl_item_hitl-1',
        title: 'Freigabe erforderlich',
        summary: 'Bitte prüfen.',
        idempotencyKey: 'tenant-a:hitl-1:persona-1',
      },
      tenantMeta('tenant-a')
    );

    const second = await broker.call(
      'persona-inbox.enqueue',
      {
        personaId: 'tenant-a/persona-1',
        sessionId: 'pa-1',
        type: 'hitl-approval',
        hitlItemId: 'hitl-1',
        embedRef: 'hitl_item_hitl-1',
        idempotencyKey: 'tenant-a:hitl-1:persona-1',
      },
      tenantMeta('tenant-a')
    );

    expect(first.success).toBe(true);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.item.id).toBe(first.item.id);
  });

  test('lists only queued messages for persona and marks visible', async () => {
    const created = await broker.call(
      'persona-inbox.enqueue',
      {
        personaId: 'tenant-a/persona-2',
        sessionId: 'pa-2',
        type: 'hitl-approval',
        hitlItemId: 'hitl-2',
        embedRef: 'hitl_item_hitl-2',
        idempotencyKey: 'tenant-a:hitl-2:persona-2',
      },
      tenantMeta('tenant-a')
    );

    const list = await broker.call(
      'persona-inbox.listPendingForPersona',
      {
        personaId: 'tenant-a/persona-2',
        sessionId: 'pa-2',
      },
      tenantMeta('tenant-a')
    );

    expect(list.success).toBe(true);
    expect(list.count).toBe(1);
    expect(list.items[0].id).toBe(created.item.id);
    expect(list.items[0].status).toBe('queued');

    const visible = await broker.call(
      'persona-inbox.markVisible',
      {
        ids: [created.item.id],
      },
      tenantMeta('tenant-a')
    );

    expect(visible.success).toBe(true);
    expect(visible.items).toHaveLength(1);
    expect(visible.items[0].status).toBe('visible');
    expect(typeof visible.items[0].visibleAt).toBe('string');

    const listAfterVisible = await broker.call(
      'persona-inbox.listPendingForPersona',
      {
        personaId: 'tenant-a/persona-2',
        sessionId: 'pa-2',
      },
      tenantMeta('tenant-a')
    );
    expect(listAfterVisible.count).toBe(0);
  });

  test('acknowledge and resolve lifecycle transitions work', async () => {
    const created = await broker.call(
      'persona-inbox.enqueue',
      {
        personaId: 'tenant-a/persona-3',
        sessionId: 'pa-3',
        type: 'hitl-approval',
        hitlItemId: 'hitl-3',
        embedRef: 'hitl_item_hitl-3',
        idempotencyKey: 'tenant-a:hitl-3:persona-3',
      },
      tenantMeta('tenant-a')
    );

    await broker.call(
      'persona-inbox.markVisible',
      {
        ids: [created.item.id],
      },
      tenantMeta('tenant-a')
    );

    const acknowledged = await broker.call(
      'persona-inbox.acknowledge',
      {
        id: created.item.id,
      },
      tenantMeta('tenant-a')
    );

    expect(acknowledged.item.status).toBe('acknowledged');
    expect(typeof acknowledged.item.acknowledgedAt).toBe('string');

    const resolved = await broker.call(
      'persona-inbox.resolveByHitlItem',
      {
        hitlItemId: 'hitl-3',
        resolutionSource: 'hitl:approved',
      },
      tenantMeta('tenant-a')
    );

    expect(resolved.success).toBe(true);
    expect(resolved.count).toBe(1);
    expect(resolved.items[0].status).toBe('resolved');
    expect(resolved.items[0].resolutionSource).toBe('hitl:approved');
  });

  test('blocks cross-tenant access', async () => {
    await expect(
      broker.call(
        'persona-inbox.enqueue',
        {
          tenantId: 'tenant-x',
          personaId: 'tenant-x/persona-1',
          hitlItemId: 'hitl-x',
          idempotencyKey: 'tenant-x:hitl-x:persona-1',
        },
        tenantMeta('tenant-y')
      )
    ).rejects.toMatchObject({
      code: 403,
      type: 'PERSONA_INBOX_TENANT_FORBIDDEN',
    });
  });
});
