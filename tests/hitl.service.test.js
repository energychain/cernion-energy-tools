'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

describe('hitl service', () => {
  const originalDbPath = process.env.HITL_DB_PATH;
  const originalInterval = process.env.HITL_EXPIRY_CHECK_INTERVAL_MS;
  let broker;
  let emitted;
  const personasByTenant = new Map();
  const notificationDispatches = [];
  const inboxResolutions = [];
  let notificationShouldFail = false;

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

    broker.createService({
      name: 'agent-persona',
      actions: {
        get: {
          handler(ctx) {
            const { tenantId, id } = ctx.params;
            const tenantPersonas = personasByTenant.get(tenantId) || new Map();
            const persona = tenantPersonas.get(id);
            if (!persona) {
              const error = new Error('Persona not found');
              error.code = 404;
              error.type = 'PERSONA_NOT_FOUND';
              throw error;
            }
            return { success: true, item: persona };
          },
        },
        resolveByRole: {
          handler(ctx) {
            const { tenantId, role } = ctx.params;
            const tenantPersonas = personasByTenant.get(tenantId) || new Map();
            const items = [...tenantPersonas.values()]
              .filter((persona) => persona.status === 'active')
              .filter(
                (persona) =>
                  Array.isArray(persona.assignedRoles) && persona.assignedRoles.includes(role)
              )
              .sort(
                (left, right) =>
                  String(left.personaName || '').localeCompare(String(right.personaName || '')) ||
                  String(left.id || '').localeCompare(String(right.id || ''))
              );
            return { success: true, tenantId, role, count: items.length, items };
          },
        },
      },
    });

    broker.createService({
      name: 'notification',
      actions: {
        dispatchHitlApproval: {
          handler(ctx) {
            notificationDispatches.push({
              ...ctx.params,
              metaTenantId: ctx.meta?.tenantId || null,
            });
            if (notificationShouldFail) {
              const error = new Error('notification backend unavailable');
              error.type = 'NOTIFICATION_BACKEND_UNAVAILABLE';
              throw error;
            }

            return {
              success: true,
              dispatch: {
                id: `dispatch-${notificationDispatches.length}`,
                status: 'queued',
                warnings: [],
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'persona-inbox',
      actions: {
        resolveByHitlItem: {
          handler(ctx) {
            inboxResolutions.push({ ...ctx.params, metaTenantId: ctx.meta?.tenantId || null });
            return { success: true, count: 1, items: [] };
          },
        },
      },
    });

    broker.createService(require('../services/hitl.service'));
    await broker.start();

    personasByTenant.set(
      'tenant-a',
      new Map([
        [
          'tenant-a/persona-1',
          {
            id: 'tenant-a/persona-1',
            tenantId: 'tenant-a',
            personaName: 'Thorsten Zoerner',
            personaType: 'human',
            assignedRoles: ['ROLE_NETZPLANUNG'],
            communicationChannels: [],
            status: 'active',
          },
        ],
        [
          'tenant-a/persona-2',
          {
            id: 'tenant-a/persona-2',
            tenantId: 'tenant-a',
            personaName: 'Cernion Finance Agent',
            personaType: 'specialized-agent',
            assignedRoles: ['ROLE_KAUFMAENNISCHE_LEITUNG'],
            communicationChannels: [],
            status: 'active',
          },
        ],
      ])
    );
    personasByTenant.set(
      'tenant-b',
      new Map([
        [
          'tenant-b/persona-1',
          {
            id: 'tenant-b/persona-1',
            tenantId: 'tenant-b',
            personaName: 'Tenant B Persona',
            personaType: 'human',
            assignedRoles: ['ROLE_NETZPLANUNG'],
            communicationChannels: [],
            status: 'active',
          },
        ],
      ])
    );
  });

  afterAll(async () => {
    await broker.stop();
    process.env.HITL_DB_PATH = originalDbPath;
    process.env.HITL_EXPIRY_CHECK_INTERVAL_MS = originalInterval;
  });

  beforeEach(() => {
    emitted.length = 0;
    notificationDispatches.length = 0;
    inboxResolutions.length = 0;
    notificationShouldFail = false;
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
    expect(inboxResolutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: 'tenant-a',
          hitlItemId: created.item.id,
          resolutionSource: 'hitl:approved',
          metaTenantId: 'tenant-a',
        }),
      ])
    );
  });

  // ── Resolver-role enforcement (#288, gap identified in #275's Bestandsanalyse) ─
  describe('resolver-role enforcement', () => {
    test('approve is rejected when caller has none of the requiredResolverRoles', async () => {
      const created = await broker.call(
        'hitl.create',
        {
          kind: 'cya-consensus-failed',
          payload: { sessionId: 'role-1' },
          requiredResolverRoles: ['ROLE_NETZPLANUNG'],
        },
        { meta: { tenantId: 'tenant-a' } }
      );

      await expect(
        broker.call(
          'hitl.approve',
          { id: created.item.id },
          { meta: { tenantId: 'tenant-a', authUser: { roles: ['ROLE_UNRELATED'] } } }
        )
      ).rejects.toMatchObject({ code: 403, type: 'HITL_RESOLVER_ROLE_REQUIRED' });

      const unchanged = await broker.call(
        'hitl.get',
        { id: created.item.id },
        { meta: { tenantId: 'tenant-a' } }
      );
      expect(unchanged.item.status).toBe('pending');
    });

    test('approve succeeds when caller has a matching role', async () => {
      const created = await broker.call(
        'hitl.create',
        {
          kind: 'cya-consensus-failed',
          payload: { sessionId: 'role-2' },
          requiredResolverRoles: ['ROLE_NETZPLANUNG'],
        },
        { meta: { tenantId: 'tenant-a' } }
      );

      const approved = await broker.call(
        'hitl.approve',
        { id: created.item.id },
        { meta: { tenantId: 'tenant-a', authUser: { roles: ['ROLE_NETZPLANUNG'] } } }
      );
      expect(approved.item.status).toBe('approved');
    });

    test('full-access scope bypasses the role requirement', async () => {
      const created = await broker.call(
        'hitl.create',
        {
          kind: 'cya-consensus-failed',
          payload: { sessionId: 'role-3' },
          requiredResolverRoles: ['ROLE_NETZPLANUNG'],
        },
        { meta: { tenantId: 'tenant-a' } }
      );

      const approved = await broker.call(
        'hitl.approve',
        { id: created.item.id },
        { meta: { tenantId: 'tenant-a', apiToken: { scope: 'full-access' } } }
      );
      expect(approved.item.status).toBe('approved');
    });

    test('responsibleRole alone (no requiredResolverRoles array) is also enforced', async () => {
      const created = await broker.call(
        'hitl.create',
        {
          kind: 'cya-consensus-failed',
          payload: { sessionId: 'role-4' },
          responsibleRole: 'ROLE_KAUFMAENNISCHE_LEITUNG',
        },
        { meta: { tenantId: 'tenant-a' } }
      );

      await expect(
        broker.call(
          'hitl.reject',
          { id: created.item.id },
          { meta: { tenantId: 'tenant-a', authUser: { roles: ['ROLE_NETZPLANUNG'] } } }
        )
      ).rejects.toMatchObject({ code: 403, type: 'HITL_RESOLVER_ROLE_REQUIRED' });

      const matching = await broker.call(
        'hitl.reject',
        { id: created.item.id },
        { meta: { tenantId: 'tenant-a', authUser: { roles: ['ROLE_KAUFMAENNISCHE_LEITUNG'] } } }
      );
      expect(matching.item.status).toBe('rejected');
    });

    test('an item without any role requirement is unaffected (no breaking change)', async () => {
      const created = await broker.call(
        'hitl.create',
        { kind: 'cya-consensus-failed', payload: { sessionId: 'role-5' } },
        { meta: { tenantId: 'tenant-a' } }
      );

      const approved = await broker.call(
        'hitl.approve',
        { id: created.item.id },
        { meta: { tenantId: 'tenant-a' } } // no authUser/apiToken at all
      );
      expect(approved.item.status).toBe('approved');
    });

    test('bulkApprove rejects only the items the caller lacks the role for, others still resolve', async () => {
      const allowed = await broker.call(
        'hitl.create',
        { kind: 'cya-consensus-failed', payload: { sessionId: 'role-bulk-1' } },
        { meta: { tenantId: 'tenant-a' } }
      );
      const blocked = await broker.call(
        'hitl.create',
        {
          kind: 'cya-consensus-failed',
          payload: { sessionId: 'role-bulk-2' },
          requiredResolverRoles: ['ROLE_NETZPLANUNG'],
        },
        { meta: { tenantId: 'tenant-a' } }
      );

      const result = await broker.call(
        'hitl.bulkApprove',
        { ids: [allowed.item.id, blocked.item.id] },
        { meta: { tenantId: 'tenant-a', authUser: { roles: ['ROLE_UNRELATED'] } } }
      );

      expect(result.items.map((i) => i.id)).toEqual([allowed.item.id]);
      expect(result.failed.find((f) => f.id === blocked.item.id)?.code).toBe(
        'HITL_RESOLVER_ROLE_REQUIRED'
      );
    });
  });

  test('resolves persona routing metadata on create for same-tenant persona lookups', async () => {
    const created = await broker.call(
      'hitl.create',
      {
        kind: 'persona-routed-approval',
        payload: { sessionId: 'S-2' },
        responsibleRole: 'ROLE_NETZPLANUNG',
        requiredResolverRoles: ['ROLE_NETZPLANUNG', 'ROLE_KAUFMAENNISCHE_LEITUNG'],
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.item.personaId).toBe('tenant-a/persona-1');
    expect(created.item.personaName).toBe('Thorsten Zoerner');
    expect(created.item.personaType).toBe('human');
    expect(created.item.personaResolution).toMatchObject({
      source: 'responsibleRole',
      personaId: 'tenant-a/persona-1',
      responsibleRole: 'ROLE_NETZPLANUNG',
    });

    const createdEvent = emitted.find((evt) => evt.eventName === 'hitl.item.created');
    expect(createdEvent.payload.personaId).toBe('tenant-a/persona-1');
    expect(createdEvent.payload.responsibleRole).toBe('ROLE_NETZPLANUNG');
  });

  test('fails open when persona routing resolves to another tenant', async () => {
    const created = await broker.call(
      'hitl.create',
      {
        kind: 'persona-routed-approval',
        payload: { sessionId: 'S-3' },
        personaId: 'tenant-b/persona-1',
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.item.personaId).toBeNull();
    expect(created.item.personaResolution).toBeNull();
  });

  test('stores notification dispatch summary and preserves embedRef', async () => {
    const created = await broker.call(
      'hitl.create',
      {
        kind: 'persona-routed-approval',
        payload: { sessionId: 'S-4' },
        responsibleRole: 'ROLE_NETZPLANUNG',
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.item.notification).toMatchObject({
      dispatchId: 'dispatch-1',
      status: 'queued',
      embedRef: `hitl_item_${created.item.id}`,
    });

    expect(notificationDispatches).toHaveLength(1);
    expect(notificationDispatches[0]).toMatchObject({
      tenantId: 'tenant-a',
      hitlItemId: created.item.id,
      personaId: 'tenant-a/persona-1',
      responsibleRole: 'ROLE_NETZPLANUNG',
      embedRef: `hitl_item_${created.item.id}`,
      sourceService: 'hitl',
      sourceAction: 'create',
      metaTenantId: 'tenant-a',
    });
  });

  test('notification dispatch failure does not block HITL creation', async () => {
    notificationShouldFail = true;

    const created = await broker.call(
      'hitl.create',
      {
        kind: 'persona-routed-approval',
        payload: { sessionId: 'S-5' },
        responsibleRole: 'ROLE_NETZPLANUNG',
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.item.status).toBe('pending');
    expect(created.item.notification).toMatchObject({
      dispatchId: null,
      status: 'failed',
      embedRef: `hitl_item_${created.item.id}`,
    });
    expect(Array.isArray(created.item.notification.warnings)).toBe(true);
    expect(created.item.notification.warnings.length).toBeGreaterThan(0);
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

  test('gets workflow completion state for HITL item', async () => {
    const created = await createItem('tenant-workflow', {
      kind: 'workflow-test',
    });

    const state = await broker.call(
      'hitl.getWorkflowState',
      { id: created.item.id },
      tenantMeta('tenant-workflow')
    );

    expect(state.success).toBe(true);
    expect(state.itemId).toBe(created.item.id);
    expect(state.status).toBe('pending');
    expect(state.workflowCompletionState).toBe('pending');
    expect(state.workflowCompletedAt).toBeNull();
    expect(Array.isArray(state.workflowAuditTrail)).toBe(true);
    expect(state.interventionCount).toBe(1);
  });

  test('populates workflowAuditTrail when resolving HITL item', async () => {
    const created = await createItem('tenant-audit', {
      kind: 'audit-test',
    });

    const approved = await broker.call(
      'hitl.approve',
      { id: created.item.id, comment: 'Looks good' },
      tenantMeta('tenant-audit')
    );

    expect(approved.item.workflowAuditTrail).toBeDefined();
    expect(Array.isArray(approved.item.workflowAuditTrail)).toBe(true);
    expect(approved.item.workflowAuditTrail.length).toBeGreaterThan(0);

    const entry = approved.item.workflowAuditTrail[0];
    expect(entry.action).toBe('resolution_approved');
    expect(entry.stepNumber).toBeDefined();
    expect(entry.duration_seconds).toBeDefined();
  });

  test('marks workflow as completed after approval', async () => {
    const created = await createItem('tenant-complete', {
      kind: 'complete-test',
    });

    const approved = await broker.call(
      'hitl.approve',
      { id: created.item.id, comment: 'Approved' },
      tenantMeta('tenant-complete')
    );

    const completed = await broker.call(
      'hitl.markWorkflowCompleted',
      { id: created.item.id, completionNotes: 'Workflow finished successfully' },
      tenantMeta('tenant-complete')
    );

    expect(completed.item.workflowCompletionState).toBe('completed');
    expect(completed.item.workflowCompletedAt).toBeDefined();
    expect(completed.item.workflowAuditTrail).toHaveLength(2);

    const completionEntry = completed.item.workflowAuditTrail[1];
    expect(completionEntry.action).toBe('workflow_completed');
    expect(completionEntry.notes).toBe('Workflow finished successfully');
  });

  test('prevents marking pending items as completed', async () => {
    const created = await createItem('tenant-prevent', {
      kind: 'prevent-test',
    });

    try {
      await broker.call(
        'hitl.markWorkflowCompleted',
        { id: created.item.id, completionNotes: 'Should fail' },
        tenantMeta('tenant-prevent')
      );
      expect(false).toBe(true);
    } catch (err) {
      expect(err.message).toMatch(/Cannot mark pending item/);
      expect(err.status || err.code).toBe(400);
    }
  });

  // ── Pre-completion plausibility hints (#452) ────────────────────────────
  describe('completion plausibility', () => {
    test('preview action is read-only and returns missing_required/implausible_value hints', async () => {
      const created = await createItem('tenant-plausibility-preview', {
        kind: 'plausibility-preview-test',
      });
      await broker.call(
        'hitl.approve',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-preview')
      );

      const preview = await broker.call(
        'hitl.completionPlausibility',
        {
          id: created.item.id,
          rules: [
            { ruleId: 'summary_required', type: 'required', fieldKey: 'summary' },
            { ruleId: 'qty_range', type: 'number_range', fieldKey: 'quantity', min: 0, max: 10 },
          ],
          fields: { quantity: 999 },
        },
        tenantMeta('tenant-plausibility-preview')
      );

      expect(preview.success).toBe(true);
      expect(preview.status).toBe('hints_found');
      expect(preview.counts).toEqual({ missingRequired: 1, implausibleValue: 1, total: 2 });
      expect(preview.hints.map((h) => h.category).sort()).toEqual(
        ['implausible_value', 'missing_required'].sort()
      );

      // Preview must be strictly read-only: no state change, no extra event, workflow untouched.
      const reloaded = await broker.call(
        'hitl.get',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-preview')
      );
      expect(reloaded.item.workflowCompletionState).toBe('pending');
      expect(reloaded.item.workflowCompletedAt).toBeNull();
      expect(reloaded.item.workflowAuditTrail).toHaveLength(1); // resolution entry only
      expect(emitted.some((e) => e.eventName === 'hitl.workflow.completed')).toBe(false);
    });

    test('preview returns explicit not_configured when no rules/fields are supplied', async () => {
      const created = await createItem('tenant-plausibility-unconfigured');

      const preview = await broker.call(
        'hitl.completionPlausibility',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-unconfigured')
      );

      expect(preview.status).toBe('not_configured');
      expect(preview.hints).toEqual([]);
    });

    test('preview returns check_unavailable for malformed rules and never throws', async () => {
      const created = await createItem('tenant-plausibility-malformed');

      const preview = await broker.call(
        'hitl.completionPlausibility',
        {
          id: created.item.id,
          rules: [{ ruleId: 'bad', type: 'unsupported_type', fieldKey: 'x' }],
          fields: { x: 1 },
        },
        tenantMeta('tenant-plausibility-malformed')
      );

      expect(preview.status).toBe('check_unavailable');
      expect(preview.hints).toEqual([]);
    });

    test('markWorkflowCompleted runs the evaluator before its write and includes an advisory result, without blocking completion', async () => {
      const created = await createItem('tenant-plausibility-complete', {
        kind: 'plausibility-complete-test',
      });
      await broker.call(
        'hitl.approve',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-complete')
      );

      const completed = await broker.call(
        'hitl.markWorkflowCompleted',
        {
          id: created.item.id,
          plausibilityRules: [
            { ruleId: 'summary_required', type: 'required', fieldKey: 'summary' },
          ],
          completionFields: {},
        },
        tenantMeta('tenant-plausibility-complete')
      );

      // Advisory in v1: completion still succeeds even though the hint fired.
      expect(completed.item.workflowCompletionState).toBe('completed');
      expect(completed.plausibility.status).toBe('hints_found');
      expect(completed.plausibility.counts).toEqual({
        missingRequired: 1,
        implausibleValue: 0,
        total: 1,
      });
      expect(completed.plausibility.hints[0]).toMatchObject({
        category: 'missing_required',
        fieldKey: 'summary',
      });

      // Only aggregate bounded status/counts are persisted to the audit trail — no raw hints.
      const auditEntry = completed.item.workflowAuditTrail.at(-1);
      expect(auditEntry.plausibility).toEqual({
        status: 'hints_found',
        counts: { missingRequired: 1, implausibleValue: 0, total: 1 },
      });
      expect(auditEntry.plausibility.hints).toBeUndefined();
    });

    test('markWorkflowCompleted returns not_configured advisory and still completes when no rules are supplied (existing behavior preserved)', async () => {
      const created = await createItem('tenant-plausibility-default');
      await broker.call(
        'hitl.approve',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-default')
      );

      const completed = await broker.call(
        'hitl.markWorkflowCompleted',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-default')
      );

      expect(completed.item.workflowCompletionState).toBe('completed');
      expect(completed.plausibility.status).toBe('not_configured');
    });

    test('markWorkflowCompleted still preserves the pending-item guard', async () => {
      const created = await createItem('tenant-plausibility-guard');

      await expect(
        broker.call(
          'hitl.markWorkflowCompleted',
          { id: created.item.id, plausibilityRules: [], completionFields: {} },
          tenantMeta('tenant-plausibility-guard')
        )
      ).rejects.toMatchObject({ code: 400, type: 'HITL_WORKFLOW_INVALID_STATE' });
    });

    test('markWorkflowCompleted still emits hitl.workflow.completed exactly once when plausibility hints fire', async () => {
      const created = await createItem('tenant-plausibility-event');
      await broker.call(
        'hitl.approve',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-event')
      );

      const before = emitted.filter((e) => e.eventName === 'hitl.workflow.completed').length;

      await broker.call(
        'hitl.markWorkflowCompleted',
        {
          id: created.item.id,
          plausibilityRules: [
            { ruleId: 'summary_required', type: 'required', fieldKey: 'summary' },
          ],
          completionFields: {},
        },
        tenantMeta('tenant-plausibility-event')
      );

      const after = emitted.filter((e) => e.eventName === 'hitl.workflow.completed').length;
      expect(after).toBe(before + 1);
    });

    test('no sensitive completionFields content leaks into the response, audit trail, or emitted event', async () => {
      const created = await createItem('tenant-plausibility-sensitive');
      await broker.call(
        'hitl.approve',
        { id: created.item.id },
        tenantMeta('tenant-plausibility-sensitive')
      );

      const secret = 'Kunde Max Mustermann IBAN-DE00-SECRET-9999';
      const completed = await broker.call(
        'hitl.markWorkflowCompleted',
        {
          id: created.item.id,
          completionNotes: 'ok',
          plausibilityRules: [
            { ruleId: 'summary_required', type: 'required', fieldKey: 'summary' },
          ],
          completionFields: { summary: secret },
        },
        tenantMeta('tenant-plausibility-sensitive')
      );

      expect(JSON.stringify(completed)).not.toContain(secret);
      expect(JSON.stringify(completed.item)).not.toContain(secret);

      const event = emitted.find(
        (e) => e.eventName === 'hitl.workflow.completed' && e.payload.itemId === created.item.id
      );
      expect(JSON.stringify(event)).not.toContain(secret);
    });

    test('tenant isolation: plausibility preview on another tenant item is not found', async () => {
      const created = await createItem('tenant-plausibility-iso-a');

      await expect(
        broker.call(
          'hitl.completionPlausibility',
          { id: created.item.id, rules: [], fields: {} },
          tenantMeta('tenant-plausibility-iso-b')
        )
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  test('emits hitl.workflow.completed event', async () => {
    const created = await createItem('tenant-event', {
      kind: 'event-test',
    });

    await broker.call('hitl.approve', { id: created.item.id }, tenantMeta('tenant-event'));

    const completedCount = emitted.filter((e) => e.eventName === 'hitl.workflow.completed').length;

    await broker.call(
      'hitl.markWorkflowCompleted',
      { id: created.item.id },
      tenantMeta('tenant-event')
    );

    const newCount = emitted.filter((e) => e.eventName === 'hitl.workflow.completed').length;
    expect(newCount).toBe(completedCount + 1);

    const event = emitted.find(
      (e) => e.eventName === 'hitl.workflow.completed' && e.payload.itemId === created.item.id
    );
    expect(event).toBeDefined();
    expect(event.payload.workflowCompletionState).toBe('completed');
  });
});
