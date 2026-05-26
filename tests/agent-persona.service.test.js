'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const AgentPersonaService = require('../services/agent-persona.service');

describe('agent-persona service', () => {
  let broker;
  let dbPath;

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
        communicationChannels:
          overrides.communicationChannels || [{ type: 'email', address: `${tenantId}@example.com` }],
        status: overrides.status || 'active',
        openclawUserId: overrides.openclawUserId,
        defaultPersonalAgentSessionId: overrides.defaultPersonalAgentSessionId,
      },
      tenantMeta(tenantId)
    );
  }

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `agent-persona-test-${Date.now()}`);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...AgentPersonaService,
      settings: { ...AgentPersonaService.settings, dbPath },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
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

    const listB = await broker.call('agent-persona.list', { tenantId: 'tenant-b' }, tenantMeta('tenant-b'));
    const listC = await broker.call('agent-persona.list', { tenantId: 'tenant-c' }, tenantMeta('tenant-c'));

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
});
