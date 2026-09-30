'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const Workbench = require('../services/workbench.service');

const meta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'admin-a',
    scope: 'agentos-session',
    roles: ['ROLE_UTILITY_HQ', 'ROLE_TENANT_ADMIN', 'ROLE_GRID_OPERATOR'],
  },
};
const tenantAdminMeta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'tenant-admin-a',
    scope: 'agentos-session',
    roles: ['ROLE_TENANT_ADMIN', 'ROLE_GRID_OPERATOR'],
  },
};
const userMeta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'user-a',
    scope: 'agentos-session',
    roles: ['ROLE_GRID_OPERATOR'],
  },
};
const otherTenantMeta = {
  apiToken: {
    tenantId: 'tenant-b',
    id: 'user-b',
    scope: 'agentos-session',
    roles: ['ROLE_GRID_OPERATOR'],
  },
};

describe('Workbench RC3 Open WebUI Tenant Gateway', () => {
  let broker, dir;
  const cloneMeta = (auth) => JSON.parse(JSON.stringify(auth));
  const call = (action, params = {}, auth = meta) =>
    broker.call(`workbench.${action}`, params, { meta: cloneMeta(auth) });
  const router = (action, params = {}, auth = userMeta) =>
    broker.call(`domain-router.${action}`, params, { meta: cloneMeta(auth) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-workbench-'));
    broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 2000 });
    broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(dir, 'state'),
        eventsDbPath: path.join(dir, 'events'),
        knowledgeTimeoutMs: 10,
      },
    });
    broker.createService({
      ...Workbench,
      settings: {
        dbPath: path.join(dir, 'conversations'),
        identityDbPath: path.join(dir, 'identity'),
        deliveryDbPath: path.join(dir, 'delivery'),
        evidenceDbPath: path.join(dir, 'evidence'),
        turnMemoryDbPath: path.join(dir, 'turn-memory'),
        contextDbPath: path.join(dir, 'context'),
        playbookDbPath: path.join(dir, 'playbooks'),
        inboxDbPath: path.join(dir, 'inbox'),
        toolRunDbPath: path.join(dir, 'tool-runs'),
      },
    });
    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: () => ({ recommendedCapabilities: [{ capability: 'mako_evidence' }] }),
      },
    });
    broker.createService({
      name: 'agent-receipts',
      actions: {
        select: () => ({ data: { selected: false, diagnostics: { candidates: [] } } }),
      },
    });
    broker.createService({
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }) },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('activity taxonomy endpoints expose utility routing metadata', async () => {
    const list = await call('activities.list', { query: 'APERAK Z18 nach MSCONS' }, userMeta);

    expect(list.schemaVersion).toMatch(/activity-taxonomy/);
    expect(list.activities[0]).toMatchObject({
      activityId: 'market_communication_clarification',
      domain: 'market_communication',
    });
    expect(list.activities[0].requiredEvidence).toEqual(expect.arrayContaining(['aperak_message']));
    expect(list.activities[0].blockedActions).toEqual(
      expect.arrayContaining(['external_message_send'])
    );

    const item = await call('activities.get', { activityId: 'grid_connection_precheck' }, userMeta);
    expect(item.activity.handoffDomains).toEqual(
      expect.arrayContaining(['asset_grid_planning', 'target_grid_planning'])
    );
  });

  test('admin mapping and delivery client endpoints are tenant governed', async () => {
    const tenant = await call('admin.tenantMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org',
      cetTenantId: 'tenant-a',
      defaultClientId: 'openwebui-tenant-a',
    });
    expect(tenant.mapping).toMatchObject({ externalOrgId: 'ow-org', cetTenantId: 'tenant-a' });
    const user = await call('admin.userMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org',
      externalUserId: 'ow-user',
      cetActorId: 'user-a',
      roles: ['ROLE_GRID_OPERATOR'],
      defaultClientId: 'openwebui-tenant-a',
    });
    expect(user.mapping.roles).toContain('ROLE_GRID_OPERATOR');
    const delivery = await broker.call(
      'workbench.deliveryClients.create',
      { clientId: 'openwebui-tenant-a' },
      { meta: cloneMeta(meta) }
    );
    expect(delivery.pollUrl).toContain('openwebui-tenant-a');
  });

  test('tenant admin cannot provision mappings for foreign tenants', async () => {
    await expect(
      call(
        'admin.tenantMappings.create',
        {
          client: 'open-webui',
          externalOrgId: 'ow-org-b',
          cetTenantId: 'tenant-b',
        },
        tenantAdminMeta
      )
    ).rejects.toThrow(/foreign tenant|denied|forbidden/iu);

    await expect(
      call(
        'admin.userMappings.create',
        {
          client: 'open-webui',
          externalOrgId: 'ow-org-b',
          externalUserId: 'ow-user-b',
          cetTenantId: 'tenant-b',
          cetActorId: 'user-b',
        },
        tenantAdminMeta
      )
    ).rejects.toThrow(/foreign tenant|denied|forbidden/iu);

    const ownTenant = await call(
      'admin.tenantMappings.create',
      {
        client: 'open-webui',
        externalOrgId: 'ow-org-a',
        cetTenantId: 'tenant-a',
      },
      tenantAdminMeta
    );
    expect(ownTenant.mapping.cetTenantId).toBe('tenant-a');

    const platformTenant = await call('admin.tenantMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org-b',
      cetTenantId: 'tenant-b',
    });
    expect(platformTenant.mapping.cetTenantId).toBe('tenant-b');
  });

  test('tenant admin cannot read foreign user mappings', async () => {
    await call('admin.tenantMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org-b',
      cetTenantId: 'tenant-b',
    });
    await call('admin.userMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org-b',
      externalUserId: 'ow-user-b',
      cetTenantId: 'tenant-b',
      cetActorId: 'user-b',
      roles: ['ROLE_GRID_OPERATOR'],
    });

    await expect(
      call(
        'admin.userMappings.get',
        {
          client: 'open-webui',
          externalOrgId: 'ow-org-b',
          externalUserId: 'ow-user-b',
        },
        tenantAdminMeta
      )
    ).rejects.toThrow(/foreign tenant|denied|forbidden/iu);

    const platformRead = await call('admin.userMappings.get', {
      client: 'open-webui',
      externalOrgId: 'ow-org-b',
      externalUserId: 'ow-user-b',
    });
    expect(platformRead.mapping).toMatchObject({ cetTenantId: 'tenant-b', cetActorId: 'user-b' });
  });

  async function provisionOpenWebUiUser() {
    await call('admin.tenantMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org',
      cetTenantId: 'tenant-a',
      defaultClientId: 'openwebui-tenant-a',
    });
    await call('admin.userMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org',
      externalUserId: 'ow-user',
      cetActorId: 'user-a',
      roles: ['ROLE_GRID_OPERATOR'],
      defaultClientId: 'openwebui-tenant-a',
    });
  }

  test('user/workspace contexts and playbooks enrich Workbench chat server-side', async () => {
    await provisionOpenWebUiUser();
    await call('admin.userContexts.save', {
      actorId: 'user-a',
      roleFamilies: ['ROLE_MARKET_COMMUNICATION'],
      domainsAllowed: ['market_communication'],
      language: 'de',
      defaultNoCallGuards: ['Keine externe Nachricht ohne Freigabe.'],
    });
    await call('admin.workspaceContexts.save', {
      client: 'open-webui',
      workspaceId: 'ow-org',
      allowedDomains: ['market_communication', 'edm'],
      workspaceNoCallGuards: ['Workspace guardrail'],
      defaultPlaybooks: ['mako-clarification-case'],
    });
    await call('playbooks.save', {
      playbookId: 'tenant-mako-special',
      title: 'Tenant MaKo special',
      scope: 'tenant',
      domain: 'market_communication',
      status: 'active',
      roleFamilies: ['ROLE_GRID_OPERATOR'],
      routingSignals: ['tenant_mako_signal'],
      requiredEvidence: ['aperak_message'],
      allowedActions: ['clarify'],
      blockedActions: ['external_message_send'],
      noCallGuards: ['Tenant playbook guard'],
    });

    const listed = await call('playbooks.list', { domain: 'market_communication' }, userMeta);
    expect(listed.items.map((p) => p.playbookId)).toEqual(
      expect.arrayContaining(['mako-clarification-case', 'tenant-mako-special'])
    );

    const response = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-context',
      clientId: 'openwebui-tenant-a',
      message: 'APERAK Z18 nach MSCONS bitte prüfen',
    });
    expect(response.cetCaseId).toBeTruthy();

    const service = broker.getLocalService('workbench');
    const memory = await service.loadTurnMemory(
      { tenantId: 'tenant-a', actorId: 'user-a' },
      response.cetCaseId
    );
    expect(JSON.stringify(memory)).not.toMatch(/rawMessage|authorization|token/iu);
    const summary = await call('cases.get', { caseId: response.cetCaseId }, userMeta);
    expect(summary.turnMemorySummary).toBeTruthy();
  });

  test('ContextRefs are governed and unsupported artifact types fail closed', async () => {
    const ref = await call(
      'contextRefs.create',
      {
        contextType: 'openwebui_note_ref',
        label: 'MaKo Notiz',
        safeSummary: 'Lieferant wartet auf APERAK-Prüfung.',
        sourceRef: { noteId: 'note-1' },
      },
      userMeta
    );
    expect(ref.contextRef).toMatchObject({
      contextType: 'openwebui_note_ref',
      purpose: 'routing_context',
      label: 'MaKo Notiz',
    });
    await expect(
      call('contextRefs.create', { contextType: 'raw_prompt_dump', label: 'bad' }, userMeta)
    ).rejects.toThrow(/Unsupported ContextRef/iu);
  });

  test('case inbox derives actionable tasks without acknowledging events', async () => {
    const c = await router('classify', {
      userRequest: 'MSCONS fehlt, bitte Rückfrage erzeugen',
      channel: 'open-webui',
      conversationId: 'chat-task',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await router('ingestUpdate', {
      cetCaseId: c.cetCaseId,
      kind: 'evidence_available',
      version: 'fixture-task-v1',
      validated: false,
      evidenceRef: 'missing-aperak',
      readinessReviewRequired: true,
    });
    const service = broker.getLocalService('domain-router');
    const before = (await service.eventsDb.allDocs({ include_docs: true })).rows.find(
      (row) => row.doc.cetCaseId === c.cetCaseId && row.doc.eventType === 'evidence.available'
    ).doc;
    expect(before.deliveryState).toBe('pending');

    const tasks = await call('inbox.tasks.list', {}, userMeta);
    const task = tasks.items.find((item) => item.cetCaseId === c.cetCaseId);
    expect(task).toMatchObject({
      attentionState: 'readiness_review_required',
      status: 'open',
      ownerRole: expect.any(String),
      nextSafeAction: expect.any(String),
    });
    const afterDisplay = await service.eventsDb.get(before._id);
    expect(afterDisplay.deliveryState).toBe('pending');

    const assigned = await call(
      'inbox.tasks.assign',
      { taskId: task.taskId, assignedTo: 'user-a' },
      userMeta
    );
    expect(assigned).toMatchObject({ status: 'in_progress', assignedTo: 'user-a' });
    const resolved = await call('inbox.tasks.resolve', { taskId: task.taskId }, userMeta);
    expect(resolved).toMatchObject({ status: 'resolved', resolvedAt: expect.any(String) });
    const eventAfterResolve = await service.eventsDb.get(before._id);
    expect(eventAfterResolve.deliveryState).toBe('pending');
  });

  test('governed tool registry filters by domain and role', async () => {
    const registry = await call('tools.list', { domain: 'grid_connection' }, userMeta);
    expect(registry.registryVersion).toMatch(/tool-registry/);
    const byId = Object.fromEntries(registry.tools.map((tool) => [tool.toolId, tool]));
    expect(byId.web_fetch.allowedByGovernance).toBe(true);
    expect(byId.api_lookup.allowedByGovernance).toBe(true);
    expect(byId.mail_read.allowedByGovernance).toBe(false);
  });

  test('governed tool run creates case-bound ToolRun and EvidenceRef', async () => {
    const c = await router('classify', {
      userRequest: 'Netzanschluss Anschlussleistung für Rechenzentrum prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const result = await call(
      'tools.run',
      {
        caseId: c.cetCaseId,
        toolId: 'api_lookup',
        input: { query: 'grid connection capacity precheck' },
      },
      userMeta
    );
    expect(result.toolRun).toMatchObject({
      caseId: c.cetCaseId,
      toolId: 'api_lookup',
      status: 'completed',
    });
    expect(result.evidenceRef).toMatchObject({
      evidenceRole: 'tool_result',
      claimStrength: 'supporting',
    });

    const runs = await call('tool-runs.list', { caseId: c.cetCaseId }, userMeta);
    expect(runs.items.map((run) => run.toolRunId)).toContain(result.toolRun.toolRunId);
    const fetched = await call(
      'tool-runs.get',
      { caseId: c.cetCaseId, toolRunId: result.toolRun.toolRunId },
      userMeta
    );
    expect(fetched.toolRun.toolId).toBe('api_lookup');
  });

  test('external business effect tools are blocked and audited', async () => {
    const c = await router('classify', {
      userRequest: 'MSCONS Klärfall mit MaKo Bezug',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await expect(
      call('tools.run', { caseId: c.cetCaseId, toolId: 'mail_send' }, userMeta)
    ).rejects.toThrow(/Workbench tool blocked/iu);

    const runs = await call('tool-runs.list', { caseId: c.cetCaseId }, userMeta);
    expect(runs.items.find((run) => run.toolId === 'mail_send')).toMatchObject({
      status: 'blocked',
      sideEffectClass: 'external_business_effect',
    });
  });

  test('governance map and skill filter expose only active applicable skills', async () => {
    await call('playbooks.save', {
      playbookId: 'draft-mako-skill',
      title: 'Draft MaKo Skill',
      domain: 'market_communication',
      status: 'draft',
      roleFamilies: ['ROLE_GRID_OPERATOR'],
      blockedActions: ['external_message_send'],
      noCallGuards: ['Draft guard'],
    });
    const governance = await call(
      'governance-map.get',
      { domain: 'market_communication' },
      userMeta
    );
    expect(governance.governance.allowedTools).toEqual(expect.arrayContaining(['mail_read']));
    expect(governance.governance.requiredRoles).toEqual(
      expect.arrayContaining(['ROLE_MARKET_COMMUNICATION'])
    );

    const filtered = await call('skills.filter', { domain: 'market_communication' }, userMeta);
    const skillIds = filtered.items.map((item) => item.skill.playbookId);
    expect(skillIds).toEqual(expect.arrayContaining(['mako-clarification-case']));
    expect(skillIds).not.toContain('draft-mako-skill');
  });

  test('chat classifies new Open WebUI conversations and continues mapped cases', async () => {
    await provisionOpenWebUiUser();
    const first = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-1',
      clientId: 'openwebui-tenant-a',
      message: 'MSCONS fehlt, APERAK Z18 ist vorhanden',
    });
    expect(first.usedOperation).toBe('classify');
    expect(first.cetCaseId).toBeTruthy();
    expect(first.primaryDomain).toBeTruthy();
    const second = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-1',
      clientId: 'openwebui-tenant-a',
      message: 'Messwerte sind plausibilisiert; bitte fortführen',
    });
    expect(second.usedOperation).toBe('continue');
    expect(second.cetCaseId).toBe(first.cetCaseId);
    expect(second.caseStateVersion).toBeGreaterThan(first.caseStateVersion);
    const resolved = await call(
      'conversations.resolve',
      {
        client: 'open-webui',
        openWebuiOrgId: 'ow-org',
        openWebuiUserId: 'ow-user',
        openWebuiConversationId: 'chat-1',
      },
      userMeta
    );
    expect(resolved.caseStateVersion).toBe(second.caseStateVersion);
  });

  test('chat stores and resumes CET-governed turn memory without raw history', async () => {
    await provisionOpenWebUiUser();
    const first = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-memory',
      clientId: 'openwebui-tenant-a',
      message: 'MSCONS fehlt, bitte als MaKo/EDM Klärfall einordnen',
      knownContext: { workingAssumptions: ['Lieferant reklamiert fehlende Zeitreihe'] },
    });
    expect(first.turnMemorySummary).toMatchObject({
      primaryDomain: expect.any(String),
      activeRole: 'ROLE_GRID_OPERATOR',
      rawChatHistoryStored: false,
    });
    expect(first.turnMemorySummary.workingAssumptions).toContain(
      'Lieferant reklamiert fehlende Zeitreihe'
    );

    const second = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-memory',
      clientId: 'openwebui-tenant-a',
      message: 'APERAK Z18 liegt vor, keine externe Nachricht senden',
    });
    expect(second.usedOperation).toBe('continue');
    expect(second.turnMemorySummary.lastSafeConclusion).toBeTruthy();
    expect(JSON.stringify(second.turnMemorySummary)).not.toMatch(
      /rawMessage|authorization|token/iu
    );

    const summary = await call(
      'cases.get',
      { caseId: second.cetCaseId, includeEvidence: true },
      userMeta
    );
    expect(summary.turnMemorySummary.rawChatHistoryStored).toBe(false);
    expect(summary.openQuestions).toEqual(expect.any(Array));
    expect(summary.activeRoleProjection).toBe('ROLE_GRID_OPERATOR');
  });

  test('parallel first-turn chat calls resolve to one canonical CET case', async () => {
    await provisionOpenWebUiUser();
    const params = {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-race',
      clientId: 'openwebui-tenant-a',
      message: 'MSCONS fehlt, APERAK Z18 ist vorhanden',
    };
    const [a, b] = await Promise.all([call('chat', params), call('chat', params)]);
    expect(a.cetCaseId).toBeTruthy();
    expect(b.cetCaseId).toBe(a.cetCaseId);
    expect([a.usedOperation, b.usedOperation].sort()).toEqual(['classify', 'continue']);
    const resolved = await call(
      'conversations.resolve',
      {
        client: 'open-webui',
        openWebuiOrgId: 'ow-org',
        openWebuiUserId: 'ow-user',
        openWebuiConversationId: 'chat-race',
      },
      userMeta
    );
    expect(resolved.cetCaseId).toBe(a.cetCaseId);
    const states = await broker.getLocalService('domain-router').visibleStates({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      roles: ['ROLE_GRID_OPERATOR'],
      clearance: [],
    });
    const matching = states.filter((state) => state.cetCaseId === a.cetCaseId);
    expect(matching).toHaveLength(1);
  });

  test('duplicate conversation link is idempotent and conflicting case link is deterministic', async () => {
    const first = await router('classify', {
      userRequest: 'First Case',
      channel: 'open-webui',
      conversationId: 'link-race-a',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const second = await router('classify', {
      userRequest: 'Second Case',
      channel: 'open-webui',
      conversationId: 'link-race-b',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const params = {
      client: 'open-webui',
      conversationId: 'manual-link',
      caseId: first.cetCaseId,
      clientId: 'openwebui-tenant-a',
    };
    const [a, b] = await Promise.all([
      call('conversations.linkCase', params, userMeta),
      call('conversations.linkCase', params, userMeta),
    ]);
    expect(a.conversationRef.cetCaseId).toBe(first.cetCaseId);
    expect(b.conversationRef.cetCaseId).toBe(first.cetCaseId);
    await expect(
      call('conversations.linkCase', { ...params, caseId: second.cetCaseId }, userMeta)
    ).rejects.toThrow(/different CET case|WORKBENCH_CONFLICT/iu);
  });

  test('chat identity mapping fails closed for partial or unmapped Open WebUI identifiers', async () => {
    await expect(
      call('chat', {
        client: 'open-webui',
        channel: 'open-webui',
        openWebuiUserId: 'ow-user-no-org',
        openWebuiConversationId: 'partial-chat',
        clientId: 'openwebui-tenant-a',
        message: 'MSCONS fehlt',
      })
    ).rejects.toThrow(/identifiers must be provided together|WORKBENCH_IDENTITY_INCOMPLETE/iu);

    const service = broker.getLocalService('workbench');
    await service.store.saveUserMapping({
      client: 'open-webui',
      externalOrgId: 'ow-org-without-tenant',
      externalUserId: 'ow-user',
      cetTenantId: 'tenant-a',
      cetActorId: 'user-a',
      roles: ['ROLE_GRID_OPERATOR'],
      sensitivityClearance: [],
      enabled: true,
    });

    await expect(
      call('chat', {
        client: 'open-webui',
        channel: 'open-webui',
        openWebuiOrgId: 'ow-org-without-tenant',
        openWebuiUserId: 'ow-user',
        openWebuiConversationId: 'unmapped-org-chat',
        clientId: 'openwebui-tenant-a',
        message: 'MSCONS fehlt',
      })
    ).rejects.toThrow(/tenant mapping required|WORKBENCH_TENANT_MAPPING_REQUIRED/iu);
  });

  test('case summary, conversation resolve and UI-safe events do not expose raw payloads', async () => {
    const c = await router('classify', {
      userRequest: 'MSCONS fehlt, Lastgang plausibilisieren',
      channel: 'open-webui',
      conversationId: 'chat-2',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await call(
      'conversations.linkCase',
      {
        client: 'open-webui',
        conversationId: 'chat-2',
        caseId: c.cetCaseId,
        clientId: 'openwebui-tenant-a',
      },
      userMeta
    );
    const resolved = await call(
      'conversations.resolve',
      {
        client: 'open-webui',
        conversationId: 'chat-2',
      },
      userMeta
    );
    expect(resolved).toMatchObject({ found: true, cetCaseId: c.cetCaseId });
    const summary = await call('cases.get', { caseId: c.cetCaseId }, userMeta);
    expect(summary).toMatchObject({ cetCaseId: c.cetCaseId, noRawEvidencePayloads: true });
    await expect(
      call('events.list', { clientId: 'unregistered-client' }, userMeta)
    ).rejects.toThrow(/delivery client registration required|WORKBENCH_DELIVERY_CLIENT_REQUIRED/iu);
    await broker.call(
      'workbench.deliveryClients.create',
      { clientId: 'openwebui-tenant-a' },
      { meta: cloneMeta(meta) }
    );
    const events = await call('events.list', { clientId: 'openwebui-tenant-a' }, userMeta);
    expect(events.items[0]).toMatchObject({
      title: expect.any(String),
      safeDisplayText: expect.stringContaining(c.cetCaseId),
    });
    expect(events.items[0].payload).toBeUndefined();
  });

  test('conversation resolve verifies case visibility before returning case metadata', async () => {
    const c = await router('classify', {
      userRequest: 'Tenant A Case',
      channel: 'open-webui',
      conversationId: 'tenant-a-chat',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const service = broker.getLocalService('workbench');
    await service.store.linkConversation({
      tenantId: 'tenant-b',
      client: 'open-webui',
      conversationId: 'leaky-chat',
      openWebuiConversationId: 'leaky-chat',
      cetCaseId: c.cetCaseId,
      caseStateVersion: 1,
    });

    await expect(
      call(
        'conversations.resolve',
        { client: 'open-webui', conversationId: 'leaky-chat' },
        otherTenantMeta
      )
    ).rejects.toThrow(/not accessible|not_found|Case not accessible|missing/iu);
  });

  test('delivery client filters limit returned Workbench events', async () => {
    const c = await router('classify', {
      userRequest: 'MSCONS fehlt, Lastgang plausibilisieren',
      channel: 'open-webui',
      conversationId: 'chat-filtered-events',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-filtered' },
    });
    await call(
      'conversations.linkCase',
      {
        client: 'open-webui',
        conversationId: 'chat-filtered-events',
        caseId: c.cetCaseId,
        clientId: 'openwebui-filtered',
      },
      userMeta
    );
    await broker.call(
      'workbench.deliveryClients.create',
      { clientId: 'openwebui-filtered', eventTypes: ['evidence.available'] },
      { meta: cloneMeta(meta) }
    );
    const filtered = await call('events.list', { clientId: 'openwebui-filtered' }, userMeta);
    expect(filtered.items).toEqual([]);

    await broker.call(
      'workbench.deliveryClients.create',
      { clientId: 'openwebui-filtered', eventTypes: ['clarification.required'] },
      { meta: cloneMeta(meta) }
    );
    const visible = await call('events.list', { clientId: 'openwebui-filtered' }, userMeta);
    expect(visible.items).toEqual([
      expect.objectContaining({ eventType: 'clarification.required', cetCaseId: c.cetCaseId }),
    ]);
  });

  test('chat responses and case inbox report actual unacknowledged event counts', async () => {
    await provisionOpenWebUiUser();
    const first = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-event-counts',
      clientId: 'openwebui-tenant-a',
      message: 'MSCONS fehlt, APERAK Z18 ist vorhanden',
    });
    await router('ingestUpdate', {
      cetCaseId: first.cetCaseId,
      kind: 'evidence_available',
      version: 'fixture-event-v1',
      validated: false,
      evidenceRef: 'fixture-evidence',
      readinessReviewRequired: true,
    });
    const second = await call('chat', {
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'chat-event-counts',
      clientId: 'openwebui-tenant-a',
      message: 'Bitte den Fall mit der neuen Evidenz fortführen',
    });
    expect(second.pendingEvents).toBeGreaterThan(0);
    expect(second.eventSummary).toMatchObject({
      unacknowledged: expect.any(Number),
      attention: expect.any(Number),
    });
    expect(second.eventSummary.unacknowledged).toBe(second.pendingEvents);

    const list = await call('cases.list', {}, userMeta);
    const item = list.items.find(
      (entry) => entry.cetCaseId === first.cetCaseId || entry.caseId === first.cetCaseId
    );
    expect(item).toMatchObject({ pendingEvents: second.pendingEvents });
  });

  test('evidence attach stores EvidenceRef and blocks cross-tenant access', async () => {
    const c = await router('classify', {
      userRequest: 'APERAK Z18 prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const attached = await call(
      'cases.attachEvidence',
      {
        caseId: c.cetCaseId,
        sourceType: 'openwebui_file_ref',
        sourceRef: { fileId: 'file-1', fileName: 'APERAK.xml', mimeType: 'application/xml' },
        evidenceType: 'aperak_message',
        label: 'APERAK Z18 Originalnachricht',
      },
      userMeta
    );
    expect(attached.evidenceRef).toMatchObject({
      type: 'aperak_message',
      status: 'attached',
      hashStatus: 'unavailable',
      readinessReviewRequired: true,
    });
    expect(attached.generatedEvents).toEqual([
      expect.objectContaining({ eventType: 'evidence.available' }),
    ]);
    await expect(
      call('cases.attachEvidence', { caseId: c.cetCaseId, label: 'x' }, otherTenantMeta)
    ).rejects.toThrow(/not accessible|not_found|missing|Case not accessible/iu);
  });

  test('evidence contract rejects unknown values and secret-like payloads', async () => {
    const c = await router('classify', {
      userRequest: 'Evidence Grenzen prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await expect(
      call(
        'cases.attachEvidence',
        { caseId: c.cetCaseId, evidenceType: 'raw_dump', label: 'bad' },
        userMeta
      )
    ).rejects.toThrow(/Unsupported evidenceType/iu);
    await expect(
      call(
        'cases.attachEvidence',
        { caseId: c.cetCaseId, sourceType: 'random_blob', label: 'bad' },
        userMeta
      )
    ).rejects.toThrow(/Unsupported sourceType/iu);
    await expect(
      call(
        'cases.attachEvidence',
        {
          caseId: c.cetCaseId,
          evidenceType: 'generic_document',
          sourceType: 'manual_metadata',
          label: 'Secret Leak',
          sourceRef: { token: 'abc', safeSummary: 'x' },
        },
        userMeta
      )
    ).rejects.toThrow(/secret|token|must not contain/iu);
    await expect(
      call(
        'cases.attachEvidence',
        {
          caseId: c.cetCaseId,
          evidenceType: 'generic_document',
          sourceType: 'manual_metadata',
          label: 'x'.repeat(200),
        },
        userMeta
      )
    ).rejects.toThrow(/label too long/iu);
  });

  test('evidence sensitivity gates and safe case summary redaction', async () => {
    const restrictedMeta = {
      apiToken: {
        ...userMeta.apiToken,
        id: 'user-a',
        sensitivityFlags: ['restricted'],
      },
    };
    const c = await router('classify', {
      userRequest: 'Restricted Evidence prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await expect(
      call(
        'cases.attachEvidence',
        {
          caseId: c.cetCaseId,
          evidenceType: 'generic_document',
          sourceType: 'manual_metadata',
          sensitivityLevel: 'restricted',
          label: 'Restricted Doc',
          sourceRef: { safeSummary: 'restricted facts' },
        },
        userMeta
      )
    ).rejects.toThrow(/sensitivity clearance required|SENSITIVITY/iu);
    const attached = await call(
      'cases.attachEvidence',
      {
        caseId: c.cetCaseId,
        evidenceType: 'generic_document',
        sourceType: 'manual_metadata',
        sensitivityLevel: 'restricted',
        label: 'Restricted Doc',
        sourceRef: { safeSummary: 'restricted facts' },
      },
      restrictedMeta
    );
    expect(attached.evidenceRef.redacted).toBeFalsy();
    const unrestrictedSummary = await call(
      'cases.get',
      { caseId: c.cetCaseId, includeEvidence: true },
      userMeta
    );
    expect(unrestrictedSummary.evidenceRefs[0]).toMatchObject({
      status: 'restricted',
      redacted: true,
    });
    const restrictedSummary = await call(
      'cases.get',
      { caseId: c.cetCaseId, includeEvidence: true },
      restrictedMeta
    );
    expect(restrictedSummary.evidenceRefs[0]).toMatchObject({
      label: 'Restricted Doc',
      sensitivityLevel: 'restricted',
    });
  });

  test('duplicate evidence fingerprint is idempotent and does not emit duplicate events', async () => {
    const c = await router('classify', {
      userRequest: 'Duplikate prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const params = {
      caseId: c.cetCaseId,
      sourceType: 'openwebui_file_ref',
      sourceRef: { fileId: 'file-dup', fileName: 'APERAK.xml', mimeType: 'application/xml' },
      evidenceType: 'aperak_message',
      label: 'APERAK duplicate',
    };
    const first = await call('cases.attachEvidence', params, userMeta);
    const second = await call('cases.attachEvidence', params, userMeta);
    expect(second.duplicate).toBe(true);
    expect(second.duplicateOf).toBe(first.evidenceRef.evidenceId);
    expect(second.generatedEvents).toEqual([]);
  });

  test('MaKo evidence updates router signals without exposing raw payloads', async () => {
    const c = await router('classify', {
      userRequest: 'MSCONS Zeitreihe fehlt, EDM Werte prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });

    const attached = await call(
      'cases.attachEvidence',
      {
        caseId: c.cetCaseId,
        evidenceType: 'aperak_message',
        sourceType: 'manual_metadata',
        label: 'APERAK Z18 nach MSCONS Versand',
        extracts: {
          messageType: 'APERAK',
          relatedMessageType: 'MSCONS',
          errorCode: 'z18',
          segmentRef: 'RFF+Z18',
          ahbVersion: '2024-10',
          maloId: 'DE01234567890',
        },
      },
      userMeta
    );

    expect(attached.evidenceRef.extracts).toMatchObject({
      messageType: 'APERAK',
      relatedMessageType: 'MSCONS',
      errorCode: 'Z18',
    });
    expect(attached.evidenceRef.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'aperak_z18', 'market_master_data'])
    );

    const summary = await call('cases.get', { caseId: c.cetCaseId }, userMeta);
    expect(summary.primaryDomain).toBe('market_communication');
    expect(summary.alternativeDomains.map((d) => d.domain)).toEqual(
      expect.arrayContaining(['market_master_data'])
    );
    expect(summary.readinessState).toBe('evidence_required');
  });

  test('Willi-MaKo APERAK Z18 references are safe diagnostic evidence', async () => {
    const c = await router('classify', {
      userRequest: 'APERAK Z18 mit Willi prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const attached = await call(
      'cases.attachEvidence',
      {
        caseId: c.cetCaseId,
        evidenceType: 'mako_error_code_diagnosis',
        sourceType: 'willi_mako_ref',
        label: 'Willi-MaKo APERAK Z18 Diagnose',
        sourceRef: {
          williTenantRef: 'tenant-a',
          williCaseRef: 'willi-case-1',
          messageId: 'APERAK-1',
          processRef: 'MSCONS-1',
          messageType: 'APERAK',
          relatedMessageType: 'MSCONS',
          errorCode: 'Z18',
          segmentRef: 'RFF',
          ahbVersion: '2024-10',
          maloId: 'DE01234567890',
          direction: 'inbound',
          marketPartner: 'partner-a',
          safeSummary:
            'APERAK weist die MSCONS im Prozesskontext zurück; AHB und Stammdatenhistorie prüfen.',
        },
      },
      userMeta
    );
    expect(attached.evidenceRef).toMatchObject({
      sourceType: 'willi_mako_ref',
      evidenceRole: 'diagnostic_signal',
      claimStrength: 'supporting',
      readinessReviewRequired: true,
    });
    expect(attached.evidenceRef.provenance.system).toBe('willi.cernion.de');
    expect(attached.evidenceRef.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'aperak_z18', 'market_master_data'])
    );
    expect(JSON.stringify(attached)).not.toMatch(/rawMessage|token|credential/iu);
  });
});
