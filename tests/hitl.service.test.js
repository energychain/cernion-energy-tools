'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

describe('hitl service', () => {
  const originalDbPath = process.env.HITL_DB_PATH;
  const originalInterval = process.env.HITL_EXPIRY_CHECK_INTERVAL_MS;
  let broker;
  let emitted;

  function tenantMeta(tenantId) {
    return { meta: { tenantId } };
  }

  async function createItem(tenantId, params = {}) {
    return broker.call(
      'hitl.create',
      {
        kind: 'cya-consensus-failed',
        payload: { sessionId: `${tenantId}-session` },
        originService: 'cya',
        originAction: 'refine',
        severity: 'warning',
        ...params,
      },
      tenantMeta(tenantId)
    );
  }

  beforeAll(async () => {
    process.env.HITL_DB_PATH = path.join(os.tmpdir(), `cernion-hitl-test-${Date.now()}`);
    process.env.HITL_EXPIRY_CHECK_INTERVAL_MS = '1000000';

    emitted = [];
    broker = new ServiceBroker({ logger: false });
    const originalEmit = broker.emit.bind(broker);
    broker.emit = (eventName, payload, groups) => {
      emitted.push({ eventName, payload });
      return originalEmit(eventName, payload, groups);
    };

    broker.createService(require('../services/hitl.service'));
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    process.env.HITL_DB_PATH = originalDbPath;
    process.env.HITL_EXPIRY_CHECK_INTERVAL_MS = originalInterval;
  });

  beforeEach(() => {
    emitted.length = 0;
  });

  test('creates and resolves hitl item with events', async () => {
    const created = await broker.call(
      'hitl.create',
      {
        kind: 'cya-consensus-failed',
        payload: { sessionId: 'S-1' },
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.item.status).toBe('pending');

    const approved = await broker.call(
      'hitl.approve',
      { id: created.item.id, comment: 'approved' },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(approved.item.status).toBe('approved');

    const createdEvent = emitted.find((evt) => evt.eventName === 'hitl.item.created');
    const resolvedEvent = emitted.find((evt) => evt.eventName === 'hitl.item.resolved');

    expect(createdEvent).toBeTruthy();
    expect(resolvedEvent).toBeTruthy();
    expect(resolvedEvent.payload.itemId).toBe(created.item.id);
  });

  test('isolates items by tenant', async () => {
    const item = await broker.call(
      'hitl.create',
      { kind: 'finance-hypothetical-review' },
      { meta: { tenantId: 'tenant-b' } }
    );

    await expect(
      broker.call('hitl.get', { id: item.item.id }, { meta: { tenantId: 'tenant-c' } })
    ).rejects.toMatchObject({ code: 404 });
  });

  test('lists items with origin, severity and overdue filters', async () => {
    const tenantId = 'tenant-list';
    await createItem(tenantId, {
      kind: 'finance-hypothetical-review',
      originService: 'finance-agent',
      originAction: 'analyze',
      severity: 'warning',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await createItem(tenantId, {
      kind: 'asset-override-approval',
      originService: 'assets',
      originAction: 'override',
      severity: 'critical',
    });

    const filtered = await broker.call(
      'hitl.list',
      {
        originService: 'finance-agent',
        severity: 'warning',
        overdueOnly: true,
      },
      tenantMeta(tenantId)
    );

    expect(filtered.count).toBe(1);
    expect(filtered.items[0].kind).toBe('finance-hypothetical-review');
  });

  test('reject stores feedbackToAgent in intervention trail', async () => {
    const created = await createItem('tenant-reject');

    const rejected = await broker.call(
      'hitl.reject',
      {
        id: created.item.id,
        feedbackToAgent: 'Please cite the regulatory basis.',
      },
      tenantMeta('tenant-reject')
    );

    expect(rejected.item.status).toBe('rejected');
    const lastIntervention = rejected.item.agent_interventions.at(-1);
    expect(lastIntervention.feedbackToAgent).toBe('Please cite the regulatory basis.');
  });

  test('escalate increments escalation level', async () => {
    const created = await createItem('tenant-escalate');

    const escalated = await broker.call(
      'hitl.escalate',
      { id: created.item.id, comment: 'Legal review required' },
      tenantMeta('tenant-escalate')
    );

    expect(escalated.item.escalationLevel).toBe(1);
    expect(escalated.item.agent_interventions.at(-1).action).toBe('escalated');
  });

  test('bulk approve reports partial failures', async () => {
    const first = await createItem('tenant-bulk-approve');
    const second = await createItem('tenant-bulk-approve', { kind: 'asset-override-approval' });

    const result = await broker.call(
      'hitl.bulkApprove',
      { ids: [first.item.id, second.item.id, 'missing-id'], comment: 'bulk ok' },
      tenantMeta('tenant-bulk-approve')
    );

    expect(result.success).toBe(false);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toHaveLength(1);
    expect(result.items.every((item) => item.status === 'approved')).toBe(true);
  });

  test('bulk reject resolves multiple items', async () => {
    const first = await createItem('tenant-bulk-reject');
    const second = await createItem('tenant-bulk-reject', { kind: 'finance-hypothetical-review' });

    const result = await broker.call(
      'hitl.bulkReject',
      {
        ids: [first.item.id, second.item.id],
        comment: 'Need more evidence',
        feedbackToAgent: 'Please provide better support.',
      },
      tenantMeta('tenant-bulk-reject')
    );

    expect(result.success).toBe(true);
    expect(result.succeeded).toBe(2);
    expect(result.items.every((item) => item.status === 'rejected')).toBe(true);
  });

  test('bulk escalate updates multiple pending items', async () => {
    const first = await createItem('tenant-bulk-escalate');
    const second = await createItem('tenant-bulk-escalate', { kind: 'asset-override-approval' });

    const result = await broker.call(
      'hitl.bulkEscalate',
      {
        ids: [first.item.id, second.item.id],
        comment: 'Escalate batch',
      },
      tenantMeta('tenant-bulk-escalate')
    );

    expect(result.success).toBe(true);
    expect(result.items.every((item) => item.escalationLevel === 1)).toBe(true);
  });

  test('returns queue summary aggregates', async () => {
    const tenantId = 'tenant-summary';
    await createItem(tenantId, {
      kind: 'asset-override-approval',
      originService: 'assets',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const approved = await createItem(tenantId, {
      kind: 'finance-hypothetical-review',
      originService: 'finance-agent',
    });
    await broker.call('hitl.approve', { id: approved.item.id }, tenantMeta(tenantId));

    const summary = await broker.call('hitl.summary', { sinceDays: 7 }, tenantMeta(tenantId));

    expect(summary.success).toBe(true);
    expect(summary.currentQueue.total).toBeGreaterThanOrEqual(2);
    expect(summary.currentQueue.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.some((entry) => entry.value === 'asset-override-approval')).toBe(true);
  });

  test('returns SLA heatmap buckets', async () => {
    const tenantId = 'tenant-heatmap';
    const created = await createItem(tenantId, {
      dueAt: new Date(Date.now() + 60_000).toISOString(),
    });
    await broker.call('hitl.approve', { id: created.item.id }, tenantMeta(tenantId));

    const heatmap = await broker.call('hitl.slaHeatmap', { sinceDays: 3 }, tenantMeta(tenantId));

    expect(heatmap.success).toBe(true);
    expect(heatmap.buckets).toHaveLength(3);
    expect(heatmap.buckets.some((bucket) => bucket.created > 0 || bucket.approved > 0)).toBe(true);
  });

  test('expires due items and emits expired event', async () => {
    const created = await createItem('tenant-expire', {
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await broker.getLocalService('hitl').expireDueItems();
    const loaded = await broker.call(
      'hitl.get',
      { id: created.item.id },
      tenantMeta('tenant-expire')
    );

    expect(loaded.item.status).toBe('expired');
    expect(emitted.some((event) => event.eventName === 'hitl.item.expired')).toBe(true);
  });
});
