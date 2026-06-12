'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const AgentPersonaService = require('../services/agent-persona.service');

describe('agent-persona service', () => {
  let broker;
  let dbPath;
  let auditDbPath;
  let personaResolvedEvents;

  function tenantMeta(tenantId) {
    return { meta: { tenantId } };
  }

  async function createPersona(tenantId, overrides = {}) {
    return broker.call(
      'agent-persona.create',
      {
        tenantId,
        id: overrides.id || `persona-${tenantId}-${Date.now()}`,
        personaName: overrides.personaName || `Persona ${tenantId}`,
        personaType: overrides.personaType || 'human',
        assignedRoles: overrides.assignedRoles || ['billing@stadtwerk'],
        communicationChannels: overrides.communicationChannels || [
          { type: 'email', address: `${tenantId}@example.com` },
        ],
        status: overrides.status || 'active',
        openclawUserId: overrides.openclawUserId,
        defaultPersonalAgentSessionId: overrides.defaultPersonalAgentSessionId,
        // v0.56.1
        roleIds: overrides.roleIds,
        contextAffinities: overrides.contextAffinities,
        handoffTargets: overrides.handoffTargets,
        resolutionPolicy: overrides.resolutionPolicy,
      },
      tenantMeta(tenantId)
    );
  }

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `agent-persona-test-${Date.now()}`);
    auditDbPath = path.join(os.tmpdir(), `agent-persona-audit-test-${Date.now()}`);
    personaResolvedEvents = [];
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...AgentPersonaService,
      settings: { ...AgentPersonaService.settings, dbPath, auditDbPath, auditRetentionDays: 90 },
    });
    broker.createService({
      name: 'agent-persona-event-capture',
      events: {
        'agent-persona.resolved': {
          handler(eventCtx) {
            personaResolvedEvents.push(eventCtx?.params || null);
          },
        },
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
    fs.rmSync(auditDbPath, { recursive: true, force: true });
  });

  test('creates, gets, lists, updates, and soft-deactivates personas', async () => {
    const created = await createPersona('tenant-a', {
      id: 'thorsten-human',
      personaName: 'Thorsten Zoerner',
      assignedRoles: ['billing@stadtwerk', 'management'],
      communicationChannels: [{ type: 'email', address: 'thorsten@example.com' }],
      openclawUserId: 'openclaw-123',
    });

    expect(created.success).toBe(true);
    expect(created.item.id).toBe('thorsten-human');
    expect(created.item.tenantId).toBe('tenant-a');
    expect(created.item.status).toBe('active');
    expect(typeof created.item.createdAt).toBe('string');
    expect(typeof created.item.updatedAt).toBe('string');

    const fetched = await broker.call(
      'agent-persona.get',
      { tenantId: 'tenant-a', id: 'thorsten-human' },
      tenantMeta('tenant-a')
    );
    expect(fetched.item.personaName).toBe('Thorsten Zoerner');

    const listed = await broker.call(
      'agent-persona.list',
      { tenantId: 'tenant-a' },
      tenantMeta('tenant-a')
    );
    expect(listed.count).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((item) => item.id === 'thorsten-human')).toBe(true);

    const updated = await broker.call(
      'agent-persona.update',
      {
        tenantId: 'tenant-a',
        id: 'thorsten-human',
        personaName: 'Thorsten Z.',
        assignedRoles: ['billing@stadtwerk'],
      },
      tenantMeta('tenant-a')
    );
    expect(updated.item.personaName).toBe('Thorsten Z.');
    expect(updated.item.assignedRoles).toEqual(['billing@stadtwerk']);

    const removed = await broker.call(
      'agent-persona.remove',
      { tenantId: 'tenant-a', id: 'thorsten-human' },
      tenantMeta('tenant-a')
    );
    expect(removed.item.status).toBe('inactive');
  });

  test('allows the same id in different tenants and isolates tenant reads', async () => {
    await createPersona('tenant-b', {
      id: 'shared-id',
      personaName: 'Tenant B Persona',
      assignedRoles: ['management'],
    });
    await createPersona('tenant-c', {
      id: 'shared-id',
      personaName: 'Tenant C Persona',
      assignedRoles: ['management'],
    });

    const tenantB = await broker.call(
      'agent-persona.get',
      { tenantId: 'tenant-b', id: 'shared-id' },
      tenantMeta('tenant-b')
    );
    const tenantC = await broker.call(
      'agent-persona.get',
      { tenantId: 'tenant-c', id: 'shared-id' },
      tenantMeta('tenant-c')
    );

    expect(tenantB.item.personaName).toBe('Tenant B Persona');
    expect(tenantC.item.personaName).toBe('Tenant C Persona');

    const listB = await broker.call(
      'agent-persona.list',
      { tenantId: 'tenant-b' },
      tenantMeta('tenant-b')
    );
    const listC = await broker.call(
      'agent-persona.list',
      { tenantId: 'tenant-c' },
      tenantMeta('tenant-c')
    );

    expect(listB.items.some((item) => item.personaName === 'Tenant C Persona')).toBe(false);
    expect(listC.items.some((item) => item.personaName === 'Tenant B Persona')).toBe(false);
  });

  test('rejects duplicate ids within the same tenant', async () => {
    await createPersona('tenant-d', {
      id: 'duplicate-id',
      personaName: 'First Persona',
    });

    await expect(
      createPersona('tenant-d', {
        id: 'duplicate-id',
        personaName: 'Second Persona',
      })
    ).rejects.toMatchObject({ code: 409, type: 'PERSONA_ALREADY_EXISTS' });
  });

  test('blocks cross-tenant update remove and tenant-mismatched list/get', async () => {
    await createPersona('tenant-e', {
      id: 'cross-tenant',
      personaName: 'Tenant E Persona',
    });

    await expect(
      broker.call(
        'agent-persona.get',
        { tenantId: 'tenant-e', id: 'cross-tenant' },
        tenantMeta('tenant-other')
      )
    ).rejects.toMatchObject({ code: 403, type: 'PERSONA_TENANT_FORBIDDEN' });

    await expect(
      broker.call(
        'agent-persona.update',
        { tenantId: 'tenant-e', id: 'cross-tenant', personaName: 'Oops' },
        tenantMeta('tenant-other')
      )
    ).rejects.toMatchObject({ code: 403, type: 'PERSONA_TENANT_FORBIDDEN' });

    await expect(
      broker.call(
        'agent-persona.remove',
        { tenantId: 'tenant-e', id: 'cross-tenant' },
        tenantMeta('tenant-other')
      )
    ).rejects.toMatchObject({ code: 403, type: 'PERSONA_TENANT_FORBIDDEN' });

    await expect(
      broker.call('agent-persona.list', { tenantId: 'tenant-e' }, tenantMeta('tenant-other'))
    ).rejects.toMatchObject({ code: 403, type: 'PERSONA_TENANT_FORBIDDEN' });
  });

  test('rejects invalid personaType, status, channels and openclawUserId semantics', async () => {
    await expect(
      broker.call(
        'agent-persona.create',
        {
          tenantId: 'tenant-f',
          id: 'bad-type',
          personaName: 'Bad Type',
          personaType: 'robot',
          communicationChannels: [{ type: 'email', address: 'x@example.com' }],
        },
        tenantMeta('tenant-f')
      )
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });

    await expect(
      broker.call(
        'agent-persona.create',
        {
          tenantId: 'tenant-f',
          id: 'bad-status',
          personaName: 'Bad Status',
          personaType: 'human',
          status: 'paused',
          communicationChannels: [{ type: 'email', address: 'x@example.com' }],
        },
        tenantMeta('tenant-f')
      )
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });

    await expect(
      broker.call(
        'agent-persona.create',
        {
          tenantId: 'tenant-f',
          id: 'bad-channel',
          personaName: 'Bad Channel',
          personaType: 'human',
          communicationChannels: [{ type: 'fax', address: '123' }],
        },
        tenantMeta('tenant-f')
      )
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });

    await expect(
      broker.call(
        'agent-persona.create',
        {
          tenantId: 'tenant-f',
          id: 'bad-openclaw',
          personaName: 'Special Agent',
          personaType: 'specialized-agent',
          openclawUserId: 'user-1',
          communicationChannels: [{ type: 'openclaw-chat', address: 'agent-room' }],
        },
        tenantMeta('tenant-f')
      )
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
  });

  test('returns only active same-tenant personas for role lookup and sorts deterministically', async () => {
    await createPersona('tenant-g', {
      id: 'z-last',
      personaName: 'Zed Last',
      assignedRoles: ['billing@stadtwerk'],
      status: 'active',
    });
    await createPersona('tenant-g', {
      id: 'a-first',
      personaName: 'Anna First',
      assignedRoles: ['billing@stadtwerk'],
      status: 'active',
    });
    await createPersona('tenant-g', {
      id: 'inactive-persona',
      personaName: 'Inactive Person',
      assignedRoles: ['billing@stadtwerk'],
      status: 'inactive',
    });
    await createPersona('tenant-g', {
      id: 'on-leave-persona',
      personaName: 'Leave Person',
      assignedRoles: ['billing@stadtwerk'],
      status: 'on-leave',
    });

    const result = await broker.call(
      'agent-persona.listByRole',
      { tenantId: 'tenant-g', role: 'billing@stadtwerk' },
      tenantMeta('tenant-g')
    );

    expect(result.count).toBe(2);
    expect(result.items.map((item) => item.personaName)).toEqual(['Anna First', 'Zed Last']);
    expect(result.items.some((item) => item.id === 'inactive-persona')).toBe(false);
    expect(result.items.some((item) => item.id === 'on-leave-persona')).toBe(false);

    const resolved = await broker.call(
      'agent-persona.resolveByRole',
      { tenantId: 'tenant-g', role: 'billing@stadtwerk' },
      tenantMeta('tenant-g')
    );
    expect(resolved.items.map((item) => item.id)).toEqual(['a-first', 'z-last']);
  });

  test('soft-deactivate keeps the record but excludes it from role lookup', async () => {
    await createPersona('tenant-h', {
      id: 'soft-delete',
      personaName: 'Soft Delete Persona',
      assignedRoles: ['management'],
    });

    const removed = await broker.call(
      'agent-persona.remove',
      { tenantId: 'tenant-h', id: 'soft-delete' },
      tenantMeta('tenant-h')
    );

    expect(removed.item.status).toBe('inactive');

    const fetched = await broker.call(
      'agent-persona.get',
      { tenantId: 'tenant-h', id: 'soft-delete' },
      tenantMeta('tenant-h')
    );
    expect(fetched.item.status).toBe('inactive');

    const roleLookup = await broker.call(
      'agent-persona.listByRole',
      { tenantId: 'tenant-h', role: 'management' },
      tenantMeta('tenant-h')
    );
    expect(roleLookup.count).toBe(0);
  });

  test('new personas include availability tracking fields', async () => {
    const persona = await createPersona('tenant-avail', {
      id: 'avail-test',
      personaName: 'Availability Test',
      assignedRoles: ['support'],
    });

    expect(persona.item.available).toBe(true);
    expect(persona.item.lastSeenAt).toBeDefined();
    expect(persona.item.availabilityWindow).toBeDefined();
    expect(persona.item.availabilityWindow.startHour).toBe(0);
    expect(persona.item.availabilityWindow.endHour).toBe(24);
    expect(persona.item.availabilityWindow.timezone).toBe('UTC');
  });

  test('updates persona availability status', async () => {
    await createPersona('tenant-update', {
      id: 'availability-persona',
      personaName: 'Update Availability',
      assignedRoles: ['support'],
    });

    const updated = await broker.call(
      'agent-persona.updateAvailability',
      {
        tenantId: 'tenant-update',
        id: 'availability-persona',
        available: false,
        availabilityWindow: {
          startHour: 9,
          endHour: 17,
          timezone: 'Europe/Berlin',
        },
      },
      tenantMeta('tenant-update')
    );

    expect(updated.item.available).toBe(false);
    expect(updated.item.availabilityWindow.startHour).toBe(9);
    expect(updated.item.availabilityWindow.endHour).toBe(17);
    expect(updated.item.availabilityWindow.timezone).toBe('Europe/Berlin');
  });

  test('records persona activity and updates lastSeenAt', async () => {
    const persona = await createPersona('tenant-activity', {
      id: 'activity-persona',
      personaName: 'Activity Test',
      assignedRoles: ['support'],
    });

    const initialLastSeen = persona.item.lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 100));

    const updated = await broker.call(
      'agent-persona.recordPersonaActivity',
      {
        tenantId: 'tenant-activity',
        id: 'activity-persona',
        activityType: 'interaction',
      },
      tenantMeta('tenant-activity')
    );

    expect(updated.item.lastSeenAt).toBeDefined();
    expect(updated.item.lastSeenAt).not.toBe(initialLastSeen);
    expect(new Date(updated.item.lastSeenAt).getTime()).toBeGreaterThan(
      new Date(initialLastSeen).getTime()
    );
  });

  // ---------------------------------------------------------------------------
  // v0.56.1 — roleIds validation
  // ---------------------------------------------------------------------------

  test('rejects invalid roleIds on create (typo like grid_planer)', async () => {
    await expect(
      createPersona('tenant-roleid-invalid', {
        id: 'bad-roleid',
        personaName: 'Bad Role',
        roleIds: ['grid_planer'], // typo — not in ROLE_IDS
      })
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
  });

  test('rejects invalid roleIds on update', async () => {
    await createPersona('tenant-roleid-update', {
      id: 'valid-roleid-persona',
      personaName: 'Valid Role',
      roleIds: ['grid_planner'],
    });

    await expect(
      broker.call(
        'agent-persona.update',
        {
          tenantId: 'tenant-roleid-update',
          id: 'valid-roleid-persona',
          roleIds: ['not_a_real_role'],
        },
        tenantMeta('tenant-roleid-update')
      )
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
  });

  // ---------------------------------------------------------------------------
  // v0.56.1 — resolvePersona
  // ---------------------------------------------------------------------------

  describe('resolvePersona', () => {
    test('grid_planning domainIntent resolves to grid_planner roleId', async () => {
      await createPersona('tenant-res-grid', {
        id: 'grid-planner-persona',
        personaName: 'Grid Planner',
        roleIds: ['grid_planner'],
        contextAffinities: {
          domainIntents: ['grid_planning'],
          workflowTypes: ['grid_connection_validation'],
        },
      });

      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-res-grid', domainIntent: 'grid_planning' },
        tenantMeta('tenant-res-grid')
      );

      expect(result.success).toBe(true);
      expect(result.resolvedPersona.personaId).toBe('grid-planner-persona');
      expect(result.resolvedPersona.roleId).toBe('grid_planner');
      expect(result.resolvedPersona.resolutionMode).toBe('context_match');
      expect(result.resolvedPersona.matchedSignals).toContain('domainIntent');
      expect(result.resolvedPersona.availability).toBe(true);
    });

    test('unknown context resolves deterministically to system_agent', async () => {
      await createPersona('tenant-res-fallback', {
        id: 'sys-agent-persona',
        personaName: 'System Agent',
        roleIds: ['system_agent'],
        contextAffinities: {},
      });

      const r1 = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-res-fallback', domainIntent: 'completely_unknown_workflow_xyz' },
        tenantMeta('tenant-res-fallback')
      );
      const r2 = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-res-fallback', domainIntent: 'completely_unknown_workflow_xyz' },
        tenantMeta('tenant-res-fallback')
      );

      expect(r1.resolvedPersona.roleId).toBe('system_agent');
      expect(r1.resolvedPersona.resolutionMode).toBe('system_fallback');
      // deterministic: same inputs → same output
      expect(r2.resolvedPersona.personaId).toBe(r1.resolvedPersona.personaId);
      expect(r2.resolvedPersona.resolutionMode).toBe(r1.resolvedPersona.resolutionMode);
    });

    test('unavailable primary persona loses against available functional fallback', async () => {
      await createPersona('tenant-res-avail', {
        id: 'primary-unavailable',
        personaName: 'Alpha Primary',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['znp_planning'] },
      });
      await broker.call(
        'agent-persona.updateAvailability',
        { tenantId: 'tenant-res-avail', id: 'primary-unavailable', available: false },
        tenantMeta('tenant-res-avail')
      );

      await createPersona('tenant-res-avail', {
        id: 'secondary-available',
        personaName: 'Beta Secondary',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['znp_planning'] },
      });

      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-res-avail', domainIntent: 'znp_planning' },
        tenantMeta('tenant-res-avail')
      );

      expect(result.resolvedPersona.personaId).toBe('secondary-available');
      expect(result.resolvedPersona.availability).toBe(true);
      expect(result.resolvedPersona.fallbackPersonaIds).toContain('primary-unavailable');
    });

    test('handoffPersonaId accepted within same tenant; cross-tenant id fails closed', async () => {
      await createPersona('tenant-res-handoff', {
        id: 'handoff-target',
        personaName: 'Governance Reviewer',
        roleIds: ['governance_reviewer'],
      });
      // persona in a different tenant with an id that happens to match
      await createPersona('tenant-res-other', {
        id: 'cross-tenant-persona',
        personaName: 'Cross Tenant',
        roleIds: ['governance_reviewer'],
      });

      // same-tenant handoff resolves via handoff mode
      const sameResult = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-res-handoff', handoffPersonaId: 'handoff-target' },
        tenantMeta('tenant-res-handoff')
      );
      expect(sameResult.resolvedPersona.personaId).toBe('handoff-target');
      expect(sameResult.resolvedPersona.resolutionMode).toBe('handoff');
      expect(sameResult.resolvedPersona.confidence).toBe(1.0);

      // cross-tenant id does not exist in tenant-res-handoff → fail-closed
      const crossResult = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-res-handoff', handoffPersonaId: 'cross-tenant-persona' },
        tenantMeta('tenant-res-handoff')
      );
      expect(crossResult.resolvedPersona.personaId).not.toBe('cross-tenant-persona');
      expect(crossResult.resolvedPersona.resolutionMode).not.toBe('handoff');
    });

    test('matchedSignals are stably sorted and reproducible across calls', async () => {
      await createPersona('tenant-res-signals', {
        id: 'multi-signal-persona',
        personaName: 'Multi Signal',
        roleIds: ['redispatch_coordinator'],
        contextAffinities: {
          workflowTypes: ['redispatch_expost'],
          domainIntents: ['redispatch_planning'],
          sourceServices: ['hitl'],
        },
      });

      const ctx = {
        tenantId: 'tenant-res-signals',
        workflowType: 'redispatch_expost',
        domainIntent: 'redispatch_planning',
        sourceService: 'hitl',
      };

      const r1 = await broker.call(
        'agent-persona.resolvePersona',
        ctx,
        tenantMeta('tenant-res-signals')
      );
      const r2 = await broker.call(
        'agent-persona.resolvePersona',
        ctx,
        tenantMeta('tenant-res-signals')
      );

      expect(r1.resolvedPersona.matchedSignals).toEqual(r2.resolvedPersona.matchedSignals);
      expect(r1.resolvedPersona.matchedSignals).toEqual(
        [...r1.resolvedPersona.matchedSignals].sort()
      );
      expect(r1.resolvedPersona.matchedSignals).toHaveLength(3);
    });

    test('response is whitelisted — no raw assetContext or L4 fields exposed', async () => {
      await createPersona('tenant-res-whitelist', {
        id: 'whitelist-persona',
        personaName: 'Whitelist Test',
        roleIds: ['asset_mdm_operator'],
        contextAffinities: { workflowTypes: ['asset_review'] },
      });

      const result = await broker.call(
        'agent-persona.resolvePersona',
        {
          tenantId: 'tenant-res-whitelist',
          workflowType: 'asset_review',
          // these must never appear in the output
          assetContext: {
            mastrId: 'SEE123456789012',
            privateKey: 'secret',
            prompt: 'raw llm prompt',
          },
        },
        tenantMeta('tenant-res-whitelist')
      );

      expect(result.success).toBe(true);
      const rp = result.resolvedPersona;
      // Only the 8 whitelisted fields are present on resolvedPersona
      expect(Object.keys(rp).sort()).toEqual([
        'availability',
        'confidence',
        'fallbackPersonaIds',
        'matchedSignals',
        'personaId',
        'policy',
        'resolutionMode',
        'roleId',
      ]);
      expect(rp).not.toHaveProperty('prompt');
      expect(rp).not.toHaveProperty('privateKey');
      expect(rp).not.toHaveProperty('assetContext');
    });

    test('existing availability fields survive create/update unaffected by v0.56.1 fields', async () => {
      const created = await createPersona('tenant-res-compat', {
        id: 'compat-persona',
        personaName: 'Compat Persona',
        roleIds: ['market_communication_operator'],
      });

      expect(created.item.available).toBe(true);
      expect(created.item.availabilityWindow).toMatchObject({ startHour: 0, endHour: 24 });
      expect(created.item.roleIds).toEqual(['market_communication_operator']);

      const updated = await broker.call(
        'agent-persona.updateAvailability',
        { tenantId: 'tenant-res-compat', id: 'compat-persona', available: false },
        tenantMeta('tenant-res-compat')
      );
      expect(updated.item.available).toBe(false);
      // v0.56.1 fields persist through availability update
      expect(updated.item.roleIds).toEqual(['market_communication_operator']);
    });

    test('v0.56.4 emits agent-persona.resolved with strict whitelist and returns auditEventId', async () => {
      personaResolvedEvents.length = 0;
      await createPersona('tenant-res-audit', {
        id: 'audit-grid-persona',
        personaName: 'Audit Grid Persona',
        roleIds: ['grid_planner'],
        contextAffinities: {
          domainIntents: ['grid_planning'],
        },
      });

      const result = await broker.call(
        'agent-persona.resolvePersona',
        {
          tenantId: 'tenant-res-audit',
          sessionId: 'session-audit-001',
          domainIntent: 'grid_planning',
          // forbidden fields must never leak into event payload
          activeLayer: 'planning',
          planningScenario: 'enwg_14a',
          znpProjectId: 'proj-1',
          assetContext: { assetType: 'storage', mastrId: 'SEE900' },
        },
        tenantMeta('tenant-res-audit')
      );

      expect(result.success).toBe(true);
      expect(typeof result.auditEventId).toBe('string');
      expect(result.auditEventId.length).toBeGreaterThan(8);

      expect(personaResolvedEvents).toHaveLength(1);
      const event = personaResolvedEvents[0];
      expect(event.eventId).toBe(result.auditEventId);
      expect(event.tenantId).toBe('tenant-res-audit');
      expect(event.sessionId).toBe('session-audit-001');
      expect(event.personaId).toBe('audit-grid-persona');
      expect(event.roleId).toBe('grid_planner');
      expect(event.resolved).toBe(true);
      expect(event.reason).toBeNull();

      expect(Object.keys(event).sort()).toEqual([
        'confidence',
        'eventId',
        'fallbackPersonaIds',
        'matchedSignals',
        'personaId',
        'reason',
        'resolutionMode',
        'resolved',
        'roleId',
        'sessionId',
        'tenantId',
        'timestamp',
      ]);
      expect(event).not.toHaveProperty('assetContext');
      expect(event).not.toHaveProperty('znpProjectId');
      expect(event).not.toHaveProperty('planningScenario');
      expect(event).not.toHaveProperty('activeLayer');
      expect(event).not.toHaveProperty('prompt');
    });

    test('v0.56.4 system fallback is emitted as resolved=true with reason=null', async () => {
      personaResolvedEvents.length = 0;
      await createPersona('tenant-res-audit-fallback', {
        id: 'audit-system-agent',
        personaName: 'Audit System Agent',
        roleIds: ['system_agent'],
        contextAffinities: {},
      });

      const result = await broker.call(
        'agent-persona.resolvePersona',
        {
          tenantId: 'tenant-res-audit-fallback',
          sessionId: 'session-audit-002',
          domainIntent: 'unknown_domain_intent_zzz',
        },
        tenantMeta('tenant-res-audit-fallback')
      );

      expect(result.success).toBe(true);
      expect(result.resolvedPersona.resolutionMode).toBe('system_fallback');
      expect(personaResolvedEvents).toHaveLength(1);
      expect(personaResolvedEvents[0].resolved).toBe(true);
      expect(personaResolvedEvents[0].reason).toBeNull();
      expect(personaResolvedEvents[0].resolutionMode).toBe('system_fallback');
    });

    test('v0.56.4 emit failure is best-effort and does not break resolver return', async () => {
      personaResolvedEvents.length = 0;
      await createPersona('tenant-res-audit-emit', {
        id: 'emit-safe-persona',
        personaName: 'Emit Safe Persona',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });

      const svc = broker.getLocalService('agent-persona');
      const originalEmit = svc.broker.emit;
      svc.broker.emit = () => {
        throw new Error('emit failed');
      };

      let result;
      try {
        result = await broker.call(
          'agent-persona.resolvePersona',
          {
            tenantId: 'tenant-res-audit-emit',
            sessionId: 'session-audit-003',
            domainIntent: 'grid_planning',
          },
          tenantMeta('tenant-res-audit-emit')
        );
      } finally {
        svc.broker.emit = originalEmit;
      }

      expect(result.success).toBe(true);
      expect(result.resolvedPersona.personaId).toBe('emit-safe-persona');
      expect(typeof result.auditEventId).toBe('string');
      expect(personaResolvedEvents).toHaveLength(0);
    });

    test('v0.56.5 audit persistence failure is best-effort and does not break resolver return', async () => {
      await createPersona('tenant-res-audit-persist-fail', {
        id: 'persist-safe-persona',
        personaName: 'Persist Safe Persona',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });

      const svc = broker.getLocalService('agent-persona');
      const originalPut = svc.auditDb.put;
      svc.auditDb.put = async () => {
        throw new Error('audit put failed');
      };

      let result;
      try {
        result = await broker.call(
          'agent-persona.resolvePersona',
          {
            tenantId: 'tenant-res-audit-persist-fail',
            sessionId: 'session-audit-persist-001',
            domainIntent: 'grid_planning',
          },
          tenantMeta('tenant-res-audit-persist-fail')
        );
      } finally {
        svc.auditDb.put = originalPut;
      }

      expect(result.success).toBe(true);
      expect(result.resolvedPersona.personaId).toBe('persist-safe-persona');
      expect(typeof result.auditEventId).toBe('string');
    });
  });

  describe('v0.56.5 — resolution audit store and tenant-scoped pruning', () => {
    test('persists resolution audits and query is tenant-isolated', async () => {
      await createPersona('tenant-audit-q-a', {
        id: 'qa-persona-a',
        personaName: 'QA Persona A',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });
      await createPersona('tenant-audit-q-b', {
        id: 'qa-persona-b',
        personaName: 'QA Persona B',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });

      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-audit-q-a', sessionId: 'qa-a', domainIntent: 'grid_planning' },
        tenantMeta('tenant-audit-q-a')
      );
      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-audit-q-b', sessionId: 'qa-b', domainIntent: 'grid_planning' },
        tenantMeta('tenant-audit-q-b')
      );

      const queryA = await broker.call(
        'agent-persona.queryResolutionAudits',
        { tenantId: 'tenant-audit-q-a' },
        tenantMeta('tenant-audit-q-a')
      );
      const queryB = await broker.call(
        'agent-persona.queryResolutionAudits',
        { tenantId: 'tenant-audit-q-b' },
        tenantMeta('tenant-audit-q-b')
      );

      expect(queryA.count).toBeGreaterThan(0);
      expect(queryB.count).toBeGreaterThan(0);
      expect(queryA.items.every((item) => item.tenantId === 'tenant-audit-q-a')).toBe(true);
      expect(queryB.items.every((item) => item.tenantId === 'tenant-audit-q-b')).toBe(true);
      expect(Object.keys(queryA.items[0]).sort()).toEqual([
        'confidence',
        'eventId',
        'fallbackPersonaIds',
        'matchedSignals',
        'personaId',
        'reason',
        'resolutionMode',
        'resolved',
        'roleId',
        'sessionId',
        'tenantId',
        'timestamp',
      ]);
    });

    test('summarizeResolutionAudits returns totals, distributions, and shares', async () => {
      await createPersona('tenant-audit-summary', {
        id: 'summary-primary',
        personaName: 'Summary Primary',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });
      await createPersona('tenant-audit-summary', {
        id: 'summary-handoff',
        personaName: 'Summary Handoff',
        roleIds: ['governance_reviewer'],
      });
      await createPersona('tenant-audit-summary', {
        id: 'summary-system',
        personaName: 'Summary System',
        roleIds: ['system_agent'],
      });

      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-audit-summary', domainIntent: 'grid_planning' },
        tenantMeta('tenant-audit-summary')
      );
      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-audit-summary', handoffPersonaId: 'summary-handoff' },
        tenantMeta('tenant-audit-summary')
      );
      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-audit-summary', domainIntent: 'no_match_case_xyz' },
        tenantMeta('tenant-audit-summary')
      );

      const summary = await broker.call(
        'agent-persona.summarizeResolutionAudits',
        { tenantId: 'tenant-audit-summary' },
        tenantMeta('tenant-audit-summary')
      );

      expect(summary.summary.total).toBeGreaterThanOrEqual(3);
      expect(summary.summary.byResolutionMode.context_match).toBeGreaterThanOrEqual(1);
      expect(summary.summary.byResolutionMode.handoff).toBeGreaterThanOrEqual(1);
      expect(summary.summary.byResolutionMode.system_fallback).toBeGreaterThanOrEqual(1);
      expect(summary.summary.handoffShare).toBeGreaterThan(0);
      expect(summary.summary.fallbackShare).toBeGreaterThan(0);
    });

    test('tenant A can prune only own audits with explicit tenantId; tenant B audits remain', async () => {
      await createPersona('tenant-prune-a-explicit', {
        id: 'prune-a-explicit',
        personaName: 'Prune A Explicit',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });
      await createPersona('tenant-prune-b-explicit', {
        id: 'prune-b-explicit',
        personaName: 'Prune B Explicit',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });

      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-prune-a-explicit', domainIntent: 'grid_planning' },
        tenantMeta('tenant-prune-a-explicit')
      );
      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-prune-b-explicit', domainIntent: 'grid_planning' },
        tenantMeta('tenant-prune-b-explicit')
      );

      const pruneResult = await broker.call(
        'agent-persona.pruneResolutionAudits',
        { tenantId: 'tenant-prune-a-explicit', olderThanDays: 0 },
        tenantMeta('tenant-prune-a-explicit')
      );
      expect(pruneResult.tenantId).toBe('tenant-prune-a-explicit');
      expect(pruneResult.deletedCount).toBeGreaterThanOrEqual(1);

      const queryA = await broker.call(
        'agent-persona.queryResolutionAudits',
        { tenantId: 'tenant-prune-a-explicit' },
        tenantMeta('tenant-prune-a-explicit')
      );
      const queryB = await broker.call(
        'agent-persona.queryResolutionAudits',
        { tenantId: 'tenant-prune-b-explicit' },
        tenantMeta('tenant-prune-b-explicit')
      );

      expect(queryA.count).toBe(0);
      expect(queryB.count).toBeGreaterThanOrEqual(1);
    });

    test('omitting tenantId uses caller tenant context and cannot trigger global prune', async () => {
      await createPersona('tenant-prune-a-implicit', {
        id: 'prune-a-implicit',
        personaName: 'Prune A Implicit',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });
      await createPersona('tenant-prune-b-implicit', {
        id: 'prune-b-implicit',
        personaName: 'Prune B Implicit',
        roleIds: ['grid_planner'],
        contextAffinities: { domainIntents: ['grid_planning'] },
      });

      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-prune-a-implicit', domainIntent: 'grid_planning' },
        tenantMeta('tenant-prune-a-implicit')
      );
      await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-prune-b-implicit', domainIntent: 'grid_planning' },
        tenantMeta('tenant-prune-b-implicit')
      );

      const pruneResult = await broker.call(
        'agent-persona.pruneResolutionAudits',
        { olderThanDays: 0 },
        tenantMeta('tenant-prune-a-implicit')
      );

      expect(pruneResult.tenantId).toBe('tenant-prune-a-implicit');

      const queryA = await broker.call(
        'agent-persona.queryResolutionAudits',
        { tenantId: 'tenant-prune-a-implicit' },
        tenantMeta('tenant-prune-a-implicit')
      );
      const queryB = await broker.call(
        'agent-persona.queryResolutionAudits',
        { tenantId: 'tenant-prune-b-implicit' },
        tenantMeta('tenant-prune-b-implicit')
      );

      expect(queryA.count).toBe(0);
      expect(queryB.count).toBeGreaterThanOrEqual(1);
    });

    test('prune/query/summary require tenant scope when neither param nor context tenant is present', async () => {
      await expect(
        broker.call('agent-persona.pruneResolutionAudits', { olderThanDays: 0 })
      ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });

      await expect(broker.call('agent-persona.queryResolutionAudits', {})).rejects.toMatchObject({
        code: 422,
        type: 'VALIDATION_ERROR',
      });

      await expect(
        broker.call('agent-persona.summarizeResolutionAudits', {})
      ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
    });
  });

  // ---------------------------------------------------------------------------
  // v0.56.3 — ZNP context signals
  // ---------------------------------------------------------------------------

  describe('v0.56.3 — ZNP context signals', () => {
    test('T-AP-ZNP-001: activeLayer matches planningScenarios in contextAffinities', async () => {
      await createPersona('tenant-znp-01', {
        id: 'znp-grid-planner',
        personaName: 'Grid Planner ZNP',
        roleIds: ['grid_planner'],
        contextAffinities: { activeLayers: ['planning'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-znp-01', activeLayer: 'planning' },
        tenantMeta('tenant-znp-01')
      );
      expect(result.resolvedPersona.personaId).toBe('znp-grid-planner');
      expect(result.resolvedPersona.matchedSignals).toContain('activeLayer');
    });

    test('T-AP-ZNP-002: planningScenario matches contextAffinities.planningScenarios', async () => {
      await createPersona('tenant-znp-02', {
        id: 'znp-enwg-specialist',
        personaName: 'EnWG Specialist',
        roleIds: ['grid_planner'],
        contextAffinities: { planningScenarios: ['enwg_14a'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-znp-02', planningScenario: 'enwg_14a' },
        tenantMeta('tenant-znp-02')
      );
      expect(result.resolvedPersona.personaId).toBe('znp-enwg-specialist');
      expect(result.resolvedPersona.matchedSignals).toContain('planningScenario');
    });

    test('T-AP-ZNP-003: assetContext.assetType matches contextAffinities.assetTypes', async () => {
      await createPersona('tenant-znp-03', {
        id: 'znp-storage-expert',
        personaName: 'Storage Expert',
        roleIds: ['asset_mdm_operator'],
        contextAffinities: { assetTypes: ['storage'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        {
          tenantId: 'tenant-znp-03',
          assetContext: { assetType: 'storage', capacityClass: 'large' },
        },
        tenantMeta('tenant-znp-03')
      );
      expect(result.resolvedPersona.personaId).toBe('znp-storage-expert');
      expect(result.resolvedPersona.matchedSignals).toContain('assetType');
    });

    test('T-AP-ZNP-004: unknown activeLayer is normalized to null — no score, no error', async () => {
      await createPersona('tenant-znp-04', {
        id: 'znp-system-agent',
        personaName: 'System Agent',
        roleIds: ['system_agent'],
        contextAffinities: { activeLayers: ['planning'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-znp-04', activeLayer: 'L4_raw_data' },
        tenantMeta('tenant-znp-04')
      );
      // No match on activeLayer since unknown value is nulled
      expect(result.resolvedPersona.matchedSignals).not.toContain('activeLayer');
    });

    test('T-AP-ZNP-005: assetContext with forbidden fields — output contains only assetType + capacityClass', async () => {
      await createPersona('tenant-znp-05', {
        id: 'znp-asset-agent',
        personaName: 'Asset Agent',
        roleIds: ['asset_mdm_operator'],
        contextAffinities: { assetTypes: ['solar'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        {
          tenantId: 'tenant-znp-05',
          assetContext: {
            assetType: 'solar',
            capacityClass: 'medium',
            mastrId: 'SEE900123',
            privateKey: 'secret',
            prompt: 'ignore me',
          },
        },
        tenantMeta('tenant-znp-05')
      );
      // resolvedPersona whitelist: no raw assetContext fields exposed
      const pr = result.resolvedPersona;
      expect(pr).not.toHaveProperty('assetContext');
      expect(pr).not.toHaveProperty('mastrId');
      expect(pr).not.toHaveProperty('privateKey');
      expect(pr).not.toHaveProperty('prompt');
      expect(pr.matchedSignals).toContain('assetType');
    });

    test('T-AP-ZNP-006: znpProjectId does not contribute to score or matchedSignals', async () => {
      await createPersona('tenant-znp-06', {
        id: 'znp-planner-06',
        personaName: 'Planner 06',
        roleIds: ['grid_planner'],
        contextAffinities: {},
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-znp-06', znpProjectId: 'znp-project-abc' },
        tenantMeta('tenant-znp-06')
      );
      expect(result.resolvedPersona.matchedSignals).not.toContain('znpProjectId');
    });

    test('T-AP-ZNP-007: planningScenario outside ALLOWED_PLANNING_SCENARIOS is normalized to null', async () => {
      await createPersona('tenant-znp-07', {
        id: 'znp-planner-07',
        personaName: 'Planner 07',
        roleIds: ['grid_planner'],
        contextAffinities: { planningScenarios: ['enwg_14a'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        { tenantId: 'tenant-znp-07', planningScenario: '\u00a714a_raw' },
        tenantMeta('tenant-znp-07')
      );
      expect(result.resolvedPersona.matchedSignals).not.toContain('planningScenario');
    });

    test('T-AP-ZNP-008: resolvedPersona output remains strictly 8-field whitelisted', async () => {
      await createPersona('tenant-znp-08', {
        id: 'znp-whitelist-check',
        personaName: 'Whitelist Check',
        roleIds: ['governance_reviewer'],
        contextAffinities: { planningScenarios: ['governance_review'], activeLayers: ['scenario'] },
      });
      const result = await broker.call(
        'agent-persona.resolvePersona',
        {
          tenantId: 'tenant-znp-08',
          planningScenario: 'governance_review',
          activeLayer: 'scenario',
          znpProjectId: 'proj-xyz',
          assetContext: { assetType: 'solar', mastrId: 'SEE9001' },
        },
        tenantMeta('tenant-znp-08')
      );
      const pr = result.resolvedPersona;
      const allowedKeys = new Set([
        'personaId',
        'roleId',
        'confidence',
        'resolutionMode',
        'availability',
        'matchedSignals',
        'fallbackPersonaIds',
        'policy',
      ]);
      for (const key of Object.keys(pr)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // seedOperationalDefaults — EVU operative persona catalog
  // ---------------------------------------------------------------------------

  describe('seedOperationalDefaults', () => {
    test('seeds customer-service, edm, billing — resolveByRole finds each active', async () => {
      const result = await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-basic', roles: ['customer-service', 'edm', 'billing'] },
        tenantMeta('tenant-seed-basic')
      );

      expect(result.success).toBe(true);
      expect(result.created).toEqual(['customer-service', 'edm', 'billing']);
      expect(result.skipped).toEqual([]);

      for (const role of ['customer-service', 'edm', 'billing']) {
        const resolved = await broker.call(
          'agent-persona.resolveByRole',
          { tenantId: 'tenant-seed-basic', role },
          tenantMeta('tenant-seed-basic')
        );
        expect(resolved.count).toBe(1);
        expect(resolved.items[0].status).toBe('active');
        expect(resolved.items[0].assignedRoles).toContain(role);
        expect(resolved.items[0].defaultPersonalAgentSessionId).toBe(`pa-default-${role}`);
      }
    });

    test('idempotent — second seed with overwrite:false skips existing, no duplicates', async () => {
      await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-idem', roles: ['customer-service'] },
        tenantMeta('tenant-seed-idem')
      );

      const second = await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-idem', roles: ['customer-service'] },
        tenantMeta('tenant-seed-idem')
      );

      expect(second.created).toEqual([]);
      expect(second.skipped).toEqual(['customer-service']);

      const resolved = await broker.call(
        'agent-persona.resolveByRole',
        { tenantId: 'tenant-seed-idem', role: 'customer-service' },
        tenantMeta('tenant-seed-idem')
      );
      expect(resolved.count).toBe(1);
    });

    test('overwrite:true restores catalog defaults for existing personas', async () => {
      await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-overwrite', roles: ['customer-service'] },
        tenantMeta('tenant-seed-overwrite')
      );

      await broker.call(
        'agent-persona.update',
        { tenantId: 'tenant-seed-overwrite', id: 'evu-customer-service', personaName: 'Modified' },
        tenantMeta('tenant-seed-overwrite')
      );

      const reseeded = await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-overwrite', roles: ['customer-service'], overwrite: true },
        tenantMeta('tenant-seed-overwrite')
      );

      expect(reseeded.created).toEqual(['customer-service']);
      expect(reseeded.skipped).toEqual([]);

      const persona = await broker.call(
        'agent-persona.get',
        { tenantId: 'tenant-seed-overwrite', id: 'evu-customer-service' },
        tenantMeta('tenant-seed-overwrite')
      );
      expect(persona.item.personaName).toBe('Kundendienst');
    });

    test('unknown role is rejected with VALIDATION_ERROR before any DB write', async () => {
      await expect(
        broker.call(
          'agent-persona.seedOperationalDefaults',
          { tenantId: 'tenant-seed-badrol', roles: ['not-a-real-role'] },
          tenantMeta('tenant-seed-badrol')
        )
      ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
    });

    test('cross-tenant seed is forbidden', async () => {
      await expect(
        broker.call(
          'agent-persona.seedOperationalDefaults',
          { tenantId: 'tenant-seed-xt', roles: ['customer-service'] },
          tenantMeta('tenant-seed-other')
        )
      ).rejects.toMatchObject({ code: 403, type: 'PERSONA_TENANT_FORBIDDEN' });
    });

    test('no roles param seeds all 16 EVU operational roles', async () => {
      const result = await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-all' },
        tenantMeta('tenant-seed-all')
      );

      expect(result.success).toBe(true);
      expect(result.created.length).toBe(16);
      expect(result.created).toContain('customer-service');
      expect(result.created).toContain('edm');
      expect(result.created).toContain('billing');
      expect(result.created).toContain('management');
      expect(result.skipped).toEqual([]);
    });

    test('seeded specialized-agent personas are excluded from resolveByRole for other roles', async () => {
      await broker.call(
        'agent-persona.seedOperationalDefaults',
        { tenantId: 'tenant-seed-iso', roles: ['customer-service', 'edm'] },
        tenantMeta('tenant-seed-iso')
      );

      const mako = await broker.call(
        'agent-persona.resolveByRole',
        { tenantId: 'tenant-seed-iso', role: 'mako' },
        tenantMeta('tenant-seed-iso')
      );
      expect(mako.count).toBe(0);
    });
  });
});
