'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const Workbench = require('../services/workbench.service');
const { getCaseStarter, sanitizeStarterInputs } = require('../src/workbench-case-starters');

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
  let broker, dir, williServer, williUrl, williRequests;
  const cloneMeta = (auth) => JSON.parse(JSON.stringify(auth));
  const call = (action, params = {}, auth = meta) =>
    broker.call(`workbench.${action}`, params, { meta: cloneMeta(auth) });
  const router = (action, params = {}, auth = userMeta) =>
    broker.call(`domain-router.${action}`, params, { meta: cloneMeta(auth) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-workbench-'));
    williRequests = [];
    williServer = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        williRequests.push({
          method: req.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          tenant: req.headers['x-cet-service-tenant'],
          signature: req.headers['x-cet-service-signature'],
        });
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/api/cet/tenants/willi-tenant-a/sessions') {
          res.end(
            JSON.stringify({
              items: [
                {
                  williSessionId: 'willi-session-1',
                  williMandantId: 'willi-tenant-a',
                  title: 'APERAK Z18 Fallakte',
                  status: 'open',
                  messageTypes: ['APERAK'],
                  errorCodes: ['Z18'],
                  processRefs: ['proc-1'],
                },
              ],
            })
          );
          return;
        }
        if (url.pathname === '/api/cet/sessions/willi-session-1/evidence-summary') {
          res.end(
            JSON.stringify({
              williSessionId: 'willi-session-1',
              williMandantId: 'willi-tenant-a',
              title: 'APERAK Z18 nach MSCONS',
              messageType: 'APERAK',
              relatedMessageType: 'MSCONS',
              errorCode: 'Z18',
              processRef: 'proc-1',
              messageId: 'aperak-1',
              segmentRef: 'RFF+Z18',
              ahbVersion: '2024-10',
              maloId: 'DE-MALO-1',
              evidenceHints: ['Lieferbeginn Stammdaten prüfen'],
              safeSummary: 'APERAK Z18 diagnostic evidence from Willi-MaKo.',
            })
          );
          return;
        }
        if (url.pathname === '/api/cet/sessions/willi-session-1/link-cet-case') {
          res.end(JSON.stringify({ linked: true, williSessionId: 'willi-session-1' }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      });
    });
    await new Promise((resolve) => williServer.listen(0, '127.0.0.1', resolve));
    williUrl = `http://127.0.0.1:${williServer.address().port}`;
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
        mailAccountDbPath: path.join(dir, 'mail-accounts'),
        williMakoBaseUrl: williUrl,
        williMakoServiceSecret: 'test-willi-secret',
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
    if (williServer) await new Promise((resolve) => williServer.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('guided case starters expose taxonomy-derived UI-safe metadata', async () => {
    const response = await call('caseStarters.list', {}, userMeta);
    expect(response.schemaVersion).toMatch(/case-starters/);
    const starter = response.items.find(
      (item) => item.starterId === 'mako-mscons-aperak-clarification'
    );
    expect(starter).toMatchObject({
      activityId: 'market_communication_clarification',
      domainHint: 'market_communication',
    });
    expect(starter.suggestedEvidenceTypes).toEqual(expect.arrayContaining(['aperak_message']));
    expect(starter.blockedActions).toEqual(expect.arrayContaining(['external_message_send']));
    expect(starter.requiredInputs[0]).toMatchObject({
      key: expect.any(String),
      label: expect.any(String),
    });

    const activities = await call('activities.list', { caseStarterEligible: true }, userMeta);
    const eligible = new Set(activities.activities.map((activity) => activity.activityId));
    for (const item of response.items) {
      expect(eligible.has(item.activityId)).toBe(true);
    }
  });

  test('guided case starter launches through Workbench chat with mapped Open WebUI identity', async () => {
    await provisionOpenWebUiUser();
    const first = await call('caseStarters.start', {
      starterId: 'mako-mscons-aperak-clarification',
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'starter-chat',
      clientId: 'openwebui-tenant-a',
      userRequest: 'Lieferant reklamiert fehlende MSCONS-Zeitreihe.',
      inputs: {
        marketLocationId: 'DE-MALO-1',
        aperakContrlContext: 'APERAK Z18',
      },
    });
    expect(first.starter).toMatchObject({ starterId: 'mako-mscons-aperak-clarification' });
    expect(first.cetCaseId).toBeTruthy();
    expect(first.usedOperation).toBe('classify');
    expect(first.primaryDomain).toBeTruthy();

    const retry = await call('caseStarters.start', {
      starterId: 'mako-mscons-aperak-clarification',
      client: 'open-webui',
      channel: 'open-webui',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'starter-chat',
      clientId: 'openwebui-tenant-a',
      inputs: { marketLocationId: 'DE-MALO-1' },
    });
    expect(retry.cetCaseId).toBe(first.cetCaseId);
    expect(retry.usedOperation).toBe('continue');
  });

  test('guided case starter fails closed for incomplete or absent Open WebUI identity', async () => {
    await provisionOpenWebUiUser();
    const base = {
      starterId: 'mako-mscons-aperak-clarification',
      openWebuiConversationId: 'starter-denied',
      clientId: 'openwebui-tenant-a',
      inputs: { marketLocationId: 'DE-MALO-1' },
    };
    await expect(call('caseStarters.start', base)).rejects.toThrow(
      /mapped user and organization|required/iu
    );
    await expect(call('caseStarters.start', { ...base, openWebuiOrgId: 'ow-org' })).rejects.toThrow(
      /user and organization identifiers/iu
    );
    await expect(
      call('caseStarters.start', { ...base, openWebuiUserId: 'ow-user' })
    ).rejects.toThrow(/user and organization identifiers/iu);
  });

  test('guided case starter rejects nested and secret-like inputs in its contract sanitizer', () => {
    const starter = getCaseStarter('mako-mscons-aperak-clarification');
    expect(() => sanitizeStarterInputs(starter, { marketLocationId: { nested: true } })).toThrow(
      /must be scalar/iu
    );
    expect(() =>
      sanitizeStarterInputs(starter, { marketLocationId: 'Bearer secret-token' })
    ).toThrow(/must not contain secrets/iu);
  });

  test('guided case starter marks missing required inputs as evidence-required context', async () => {
    await provisionOpenWebUiUser();
    const response = await call('caseStarters.start', {
      starterId: 'grid-connection-precheck',
      openWebuiOrgId: 'ow-org',
      openWebuiUserId: 'ow-user',
      openWebuiConversationId: 'starter-missing-inputs',
      clientId: 'openwebui-tenant-a',
      inputs: { location: '69256 Mauer' },
    });
    expect(response.cetCaseId).toBeTruthy();
    expect(JSON.stringify(response)).toMatch(/evidence_required|clarification|required|Evidenz/iu);
    expect(JSON.stringify(response)).not.toMatch(/Genehmigung erteilt|Freigabe erteilt|approved/iu);
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

  test('Willi-MaKo mappings resolve tenant users with safe role defaults and email lookup', async () => {
    const created = await call('admin.williMakoMappings.create', {
      williMandantId: 'willi-tenant-a',
      williUserId: 'willi-user-a',
      externalEmailNorm: 'MAKO@EXAMPLE.COM',
      cetActorId: 'mako-user-a',
      williRoleProfile: 'normal_user',
    });
    expect(created.mapping).toMatchObject({
      provider: 'willi-mako',
      cetTenantId: 'tenant-a',
      cetActorId: 'mako-user-a',
      roles: ['ROLE_MARKET_COMMUNICATION'],
      sensitivityClearance: ['tenant_internal'],
      externalEmailNorm: 'mako@example.com',
    });

    const byUser = await call('admin.williMakoMappings.resolve', {
      williMandantId: 'willi-tenant-a',
      williUserId: 'willi-user-a',
    });
    expect(byUser.mapping.cetActorId).toBe('mako-user-a');

    const byEmail = await call('admin.williMakoMappings.resolve', {
      williMandantId: 'willi-tenant-a',
      externalEmailNorm: 'mako@example.com',
    });
    expect(byEmail.mapping.williUserId).toBe('willi-user-a');
  });

  test('Willi-MaKo mapping fails closed for foreign tenants and unmapped identities', async () => {
    await expect(
      call(
        'admin.williMakoMappings.create',
        {
          williMandantId: 'willi-tenant-b',
          williUserId: 'willi-user-b',
          cetTenantId: 'tenant-b',
          cetActorId: 'user-b',
        },
        tenantAdminMeta
      )
    ).rejects.toThrow(/foreign tenant|denied|forbidden/iu);

    await expect(
      call('admin.williMakoMappings.resolve', {
        williMandantId: 'willi-tenant-missing',
        williUserId: 'missing',
      })
    ).rejects.toThrow(/not found|missing/iu);
  });

  test('Willi-MaKo role alignments are tenant scoped and staff does not imply cross-tenant access', async () => {
    const defaults = await call('admin.williMakoRoleAlignments.list');
    expect(defaults.items.find((item) => item.williRoleProfile === 'staff')).toMatchObject({
      roles: ['ROLE_SUPPORT_READONLY'],
      sensitivityClearance: ['tenant_internal'],
    });

    const custom = await call('admin.williMakoRoleAlignments.save', {
      williRoleProfile: 'mandant_admin',
      roles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_TENANT_ADMIN'],
      sensitivityClearance: ['tenant_internal', 'restricted'],
    });
    expect(custom.alignment.roles).toEqual(
      expect.arrayContaining(['ROLE_MARKET_COMMUNICATION', 'ROLE_TENANT_ADMIN'])
    );

    const mapped = await call('admin.williMakoMappings.create', {
      williMandantId: 'willi-tenant-admin',
      williUserId: 'willi-admin',
      cetActorId: 'tenant-admin-user',
      williRoleProfile: 'mandant_admin',
    });
    expect(mapped.mapping.roles).toEqual(expect.arrayContaining(['ROLE_TENANT_ADMIN']));
    expect(mapped.mapping.sensitivityClearance).toEqual(expect.arrayContaining(['restricted']));

    await expect(
      call(
        'admin.williMakoRoleAlignments.save',
        {
          williRoleProfile: 'staff',
          roles: ['ROLE_SUPPORT_READONLY'],
          sensitivityClearance: ['tenant_internal'],
        },
        tenantAdminMeta
      )
    ).rejects.toThrow(/staff|denied|forbidden/iu);

    const staff = await call('admin.williMakoMappings.create', {
      williMandantId: 'willi-staff-tenant',
      williUserId: 'willi-staff',
      cetActorId: 'support-readonly',
      williRoleProfile: 'staff',
      isWilliStaff: true,
    });
    expect(staff.mapping.roles).toEqual(['ROLE_SUPPORT_READONLY']);
    expect(staff.mapping.roles).not.toContain('ROLE_ADMIN');
    expect(staff.mapping.roles).not.toContain('ROLE_UTILITY_HQ');
  });

  test('Willi-MaKo connector discovers sessions, attaches safe evidence, and links cases', async () => {
    await call('admin.williMakoMappings.create', {
      williMandantId: 'willi-tenant-a',
      williUserId: 'willi-user-a',
      cetActorId: 'user-a',
      williRoleProfile: 'normal_user',
    });
    const sessions = await call(
      'williMako.sessions.discover',
      { williMandantId: 'willi-tenant-a', williUserId: 'willi-user-a' },
      userMeta
    );
    expect(sessions.items[0]).toMatchObject({
      williSessionId: 'willi-session-1',
      title: 'APERAK Z18 Fallakte',
    });
    expect(williRequests.find((request) => request.path.includes('/sessions'))).toMatchObject({
      tenant: 'willi-tenant-a',
    });

    const c = await router('classify', {
      userRequest: 'APERAK Z18 nach MSCONS mit Lieferbeginn prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    const attached = await call(
      'williMako.evidence.attach',
      {
        caseId: c.cetCaseId,
        williMandantId: 'willi-tenant-a',
        williUserId: 'willi-user-a',
        williSessionId: 'willi-session-1',
      },
      userMeta
    );
    expect(attached.evidenceRef).toMatchObject({
      sourceType: 'willi_mako_ref',
      evidenceRole: 'diagnostic_signal',
      claimStrength: 'supporting',
      readinessReviewRequired: true,
    });
    expect(attached.evidenceRef.routingSignals).toEqual(
      expect.arrayContaining(['market_communication', 'aperak_z18', 'market_master_data'])
    );
    expect(JSON.stringify(attached)).not.toMatch(/authorization|secret|rawMessage|Bearer/iu);

    const duplicate = await call(
      'williMako.evidence.attach',
      {
        caseId: c.cetCaseId,
        williMandantId: 'willi-tenant-a',
        williUserId: 'willi-user-a',
        williSessionId: 'willi-session-1',
      },
      userMeta
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.duplicateOf).toBe(attached.evidenceRef.evidenceId);

    const dossier = await call('cases.dossier', { caseId: c.cetCaseId }, userMeta);
    expect(dossier.evidenceRefs[0]).toMatchObject({
      sourceType: 'willi_mako_ref',
      evidenceRole: 'diagnostic_signal',
    });
    expect(dossier.evidenceRefs[0].sourceRef.safeSummary).toBe(
      'APERAK Z18 diagnostic evidence from Willi-MaKo.'
    );
    expect(JSON.stringify(dossier)).not.toMatch(/rawMessage|authorization|Bearer|secret-token/iu);

    const linked = await call(
      'williMako.case.link',
      {
        caseId: c.cetCaseId,
        williMandantId: 'willi-tenant-a',
        williUserId: 'willi-user-a',
        williSessionId: 'willi-session-1',
      },
      userMeta
    );
    expect(linked).toMatchObject({ linked: true });
    expect(williRequests.find((request) => request.method === 'POST')).toMatchObject({
      path: '/api/cet/sessions/willi-session-1/link-cet-case',
    });
  });

  test('Willi-MaKo connector fails closed for unmapped or foreign actors', async () => {
    await call('admin.williMakoMappings.create', {
      williMandantId: 'willi-tenant-a',
      williUserId: 'willi-user-a',
      cetActorId: 'different-actor',
    });
    await expect(
      call(
        'williMako.sessions.discover',
        { williMandantId: 'willi-tenant-a', williUserId: 'willi-user-a' },
        userMeta
      )
    ).rejects.toThrow(/mapping|authenticated|actor|denied|forbidden/iu);
    await expect(
      call(
        'williMako.sessions.discover',
        { williMandantId: 'willi-tenant-a', williUserId: 'missing' },
        userMeta
      )
    ).rejects.toThrow(/not found|missing/iu);
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

    const workbench = broker.getLocalService('workbench');
    const persistedBeforeList = await workbench.store.listInboxTasks({ tenantId: 'tenant-a' });
    expect(persistedBeforeList).toHaveLength(0);

    const tasks = await call('inbox.tasks.list', {}, userMeta);
    const task = tasks.items.find((item) => item.cetCaseId === c.cetCaseId);
    expect(task).toMatchObject({
      attentionState: 'readiness_review_required',
      status: 'open',
      ownerRole: expect.any(String),
      nextSafeAction: expect.any(String),
      eventCount: 1,
      eventIdsDisplay: before.eventId,
    });
    const tasksAgain = await call('inbox.tasks.list', {}, userMeta);
    const sameTask = tasksAgain.items.find((item) => item.taskId === task.taskId);
    expect(sameTask.updatedAt).toBe(task.updatedAt);
    const persistedAfterList = await workbench.store.listInboxTasks({ tenantId: 'tenant-a' });
    expect(persistedAfterList).toHaveLength(0);
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

  test('web evidence connector fetches safe public context as EvidenceRef', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<html><head><title>Grid context</title></head><body><h1>Netzanschluss</h1><script>secret()</script><p>Public context for voltage-level precheck.</p></body></html>'
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/context`;
    try {
      const c = await router('classify', {
        userRequest: 'Netzanschluss Anschlussleistung für Rechenzentrum prüfen',
        asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
      });
      const result = await call(
        'tools.run',
        {
          caseId: c.cetCaseId,
          toolId: 'web_fetch',
          input: { url, allowPrivateNetwork: true },
        },
        userMeta
      );
      expect(result.toolRun).toMatchObject({ status: 'completed', toolId: 'web_fetch' });
      expect(result.evidenceRef).toMatchObject({
        evidenceType: 'public_web_page',
        sourceType: 'web_fetch_ref',
        claimStrength: 'supporting',
      });
      expect(result.evidenceRef.sourceRef.url).toBe(url);
      expect(result.evidenceRef.safeSummary).toContain('Public context');
      expect(result.evidenceRef.safeSummary).not.toContain('<script>');
      expect(result.evidenceRef.fileHash).toMatch(/^sha256:/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('web evidence connector blocks private targets unless explicitly enabled', async () => {
    const c = await router('classify', {
      userRequest: 'Netzanschluss Anschlussleistung prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await expect(
      call(
        'tools.run',
        {
          caseId: c.cetCaseId,
          toolId: 'web_fetch',
          input: { url: 'http://127.0.0.1/private' },
        },
        userMeta
      )
    ).rejects.toThrow(/private|local/iu);

    const runs = await call('tool-runs.list', { caseId: c.cetCaseId }, userMeta);
    expect(runs.items.find((run) => run.toolId === 'web_fetch')).toMatchObject({
      status: 'failed',
    });
  });

  test('web evidence connector records fetch failures and unsupported content as failed ToolRuns', async () => {
    const c = await router('classify', {
      userRequest: 'Netzanschluss öffentliche Webseite zur Anschlussleistung prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });
    await expect(
      call(
        'tools.run',
        {
          caseId: c.cetCaseId,
          toolId: 'web_fetch',
          input: { url: 'http://127.0.0.1:9/missing', allowPrivateNetwork: true },
        },
        userMeta
      )
    ).rejects.toThrow(/fetch failed|connect|refused|failed/iu);

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from([0, 1, 2, 3]));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await expect(
        call(
          'tools.run',
          {
            caseId: c.cetCaseId,
            toolId: 'web_fetch',
            input: {
              url: `http://127.0.0.1:${server.address().port}/bin`,
              allowPrivateNetwork: true,
            },
          },
          userMeta
        )
      ).rejects.toThrow(/Unsupported web evidence content type/iu);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('mail evidence connector stores encrypted account config without credential leakage', async () => {
    const created = await call('mail.accounts.create', {
      mailAccountRef: 'mako-inbox',
      label: 'MaKo Inbox',
      provider: 'imap',
      driver: 'himalaya',
      credentials: {
        host: 'imap.example.test',
        port: 993,
        username: 'mako@example.test',
        password: 'super-secret-password',
        tls: true,
      },
    });
    expect(created.mailAccount).toMatchObject({
      mailAccountRef: 'mako-inbox',
      label: 'MaKo Inbox',
      secretConfigured: true,
    });
    expect(JSON.stringify(created)).not.toContain('super-secret-password');

    const stored = await broker.getLocalService('workbench').store.getMailAccount({
      tenantId: 'tenant-a',
      mailAccountRef: 'mako-inbox',
    });
    expect(stored.encryptedSecret?.ciphertext).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('super-secret-password');

    const list = await call('mail.accounts.list', {}, userMeta);
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('super-secret-password');

    const deleted = await call('mail.accounts.delete', { mailAccountRef: 'mako-inbox' });
    expect(deleted.mailAccount.enabled).toBe(false);
  });

  test('mail evidence connector records search/read/attachment refs without mail send', async () => {
    await call('mail.accounts.create', {
      mailAccountRef: 'mako-inbox',
      label: 'MaKo Inbox',
      credentials: { host: 'imap.example.test', username: 'mako@example.test', password: 'secret' },
    });
    const c = await router('classify', {
      userRequest: 'MSCONS fehlt, APERAK Z18 Mail des Lieferanten prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });

    const search = await call(
      'tools.run',
      {
        caseId: c.cetCaseId,
        toolId: 'mail_search',
        input: { mailAccountRef: 'mako-inbox', query: 'APERAK Z18 MSCONS', folder: 'INBOX' },
      },
      userMeta
    );
    expect(search.evidenceRef).toMatchObject({
      evidenceType: 'mail_thread',
      sourceType: 'mail_ref',
      evidenceRole: 'tool_result',
    });

    const read = await call(
      'tools.run',
      {
        caseId: c.cetCaseId,
        toolId: 'mail_read',
        input: {
          mailAccountRef: 'mako-inbox',
          messageId: 'msg-1',
          subject: 'APERAK Z18 Reklamation',
          sender: 'lieferant@example.test',
          snippet: '<b>APERAK Z18</b> nach MSCONS Versand. <script>bad()</script>',
        },
      },
      userMeta
    );
    expect(read.evidenceRef).toMatchObject({ evidenceType: 'mail_message' });
    expect(read.evidenceRef.safeSummary).toContain('APERAK Z18');
    expect(read.evidenceRef.safeSummary).not.toContain('<script>');

    const attachment = await call(
      'tools.run',
      {
        caseId: c.cetCaseId,
        toolId: 'mail_attachment_ref',
        input: {
          mailAccountRef: 'mako-inbox',
          messageId: 'msg-1',
          attachmentId: 'att-1',
          fileName: 'APERAK.xml',
          mimeType: 'application/xml',
        },
      },
      userMeta
    );
    expect(attachment.evidenceRef).toMatchObject({ evidenceType: 'mail_attachment_metadata' });

    await expect(
      call('tools.run', { caseId: c.cetCaseId, toolId: 'mail_send' }, userMeta)
    ).rejects.toThrow(/Workbench tool blocked/iu);
  });

  test('mail evidence connector enforces role, account and secret boundaries', async () => {
    await expect(
      call(
        'mail.accounts.create',
        {
          mailAccountRef: 'bad',
          label: 'Bad',
          credentials: { host: 'imap.example.test', username: 'u', password: 'secret' },
        },
        userMeta
      )
    ).rejects.toThrow(/admin role required/iu);

    await call('mail.accounts.create', {
      mailAccountRef: 'mako-inbox',
      label: 'MaKo Inbox',
      credentials: { host: 'imap.example.test', username: 'mako@example.test', password: 'secret' },
    });
    const c = await router('classify', {
      userRequest: 'MSCONS fehlt, APERAK prüfen',
      asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
    });

    await expect(
      call(
        'tools.run',
        {
          caseId: c.cetCaseId,
          toolId: 'mail_read',
          input: { mailAccountRef: 'missing', messageId: 'm' },
        },
        userMeta
      )
    ).rejects.toThrow(/mail account/iu);
    await expect(
      call(
        'tools.run',
        {
          caseId: c.cetCaseId,
          toolId: 'mail_read',
          input: { mailAccountRef: 'mako-inbox', messageId: 'm', snippet: 'Bearer token leak' },
        },
        userMeta
      )
    ).rejects.toThrow(/secrets|token/iu);
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

  describe('Tenant skills/playbooks governed lifecycle (#640)', () => {
    const unauthorizedMeta = {
      apiToken: {
        tenantId: 'tenant-a',
        id: 'outsider-a',
        scope: 'agentos-session',
        roles: ['ROLE_EXTERNAL_ADVISOR_LIMITED'],
      },
    };

    test('skill create starts as draft; draft/proposed/deprecated skills never influence routing/chat, only active does', async () => {
      await provisionOpenWebUiUser();
      const skillId = 'gating-skill';
      const created = await call('skills.create', {
        skillId,
        title: 'Gating Skill',
        domains: ['market_communication'],
        applicableRoles: ['ROLE_GRID_OPERATOR'],
        triggerPatterns: ['aperak'],
      });
      expect(created.skill.status).toBe('draft');
      expect(created.skill.version).toBe(1);

      const chatOnce = async (conversationId) => {
        const response = await call('chat', {
          client: 'open-webui',
          channel: 'open-webui',
          openWebuiOrgId: 'ow-org',
          openWebuiUserId: 'ow-user',
          openWebuiConversationId: conversationId,
          clientId: 'openwebui-tenant-a',
          message: 'APERAK Z18 bitte prüfen',
        });
        const summary = await call('cases.get', { caseId: response.cetCaseId }, userMeta);
        return summary.appliedPlaybooks.map((p) => p.skillId);
      };

      expect(await chatOnce('gate-draft')).not.toContain(skillId);

      const proposed = await call('skills.propose', { skillId });
      expect(proposed.skill.status).toBe('proposed');
      expect(await chatOnce('gate-proposed')).not.toContain(skillId);

      const activated = await call('skills.activate', { skillId });
      expect(activated.skill.status).toBe('active');
      expect(await chatOnce('gate-active')).toContain(skillId);

      const deprecated = await call('skills.deprecate', { skillId });
      expect(deprecated.skill.status).toBe('deprecated');
      expect(await chatOnce('gate-deprecated')).not.toContain(skillId);
    });

    test('skill propose/activate produce append-only audit entries and are idempotent on retry', async () => {
      await call('skills.create', {
        skillId: 'idempotent-skill',
        title: 'Idempotent Skill',
        domains: ['edm'],
        applicableRoles: ['ROLE_EDM'],
      });
      const service = broker.getLocalService('workbench');

      const proposedOnce = await call('skills.propose', { skillId: 'idempotent-skill' });
      const proposedTwice = await call('skills.propose', { skillId: 'idempotent-skill' });
      expect(proposedOnce.skill.status).toBe('proposed');
      expect(proposedTwice.skill.status).toBe('proposed');
      const auditAfterPropose = await service.store.listSkillAudit({
        tenantId: 'tenant-a',
        skillId: 'idempotent-skill',
      });
      expect(auditAfterPropose.filter((e) => e.transition === 'proposed')).toHaveLength(1);

      const activatedOnce = await call('skills.activate', { skillId: 'idempotent-skill' });
      const activatedTwice = await call('skills.activate', { skillId: 'idempotent-skill' });
      expect(activatedOnce.skill.status).toBe('active');
      expect(activatedTwice.skill.status).toBe('active');
      const auditAfterActivate = await service.store.listSkillAudit({
        tenantId: 'tenant-a',
        skillId: 'idempotent-skill',
      });
      expect(auditAfterActivate.filter((e) => e.transition === 'activated')).toHaveLength(1);
      expect(auditAfterActivate.length).toBeGreaterThanOrEqual(3);
      expect(activatedOnce.skill.auditRefs.length).toBeGreaterThan(0);
    });

    test('skill activation and deprecation are denied without an authorized governance role', async () => {
      await call('skills.create', {
        skillId: 'gated-skill',
        title: 'Gated Skill',
        domains: ['edm'],
      });
      await call('skills.propose', { skillId: 'gated-skill' });
      await expect(call('skills.activate', { skillId: 'gated-skill' }, userMeta)).rejects.toThrow(
        /governance role/iu
      );
      const activated = await call('skills.activate', { skillId: 'gated-skill' });
      expect(activated.skill.status).toBe('active');
      await expect(call('skills.deprecate', { skillId: 'gated-skill' }, userMeta)).rejects.toThrow(
        /governance role/iu
      );
      const deprecated = await call('skills.deprecate', { skillId: 'gated-skill' });
      expect(deprecated.skill.status).toBe('deprecated');
    });

    test('propose-from-case only writes a bounded draft for a same-tenant resolved/confirmed case', async () => {
      const c = await router('classify', {
        userRequest: 'APERAK Z18 Rückfrage bitte dokumentieren, Lieferant reklamiert MSCONS',
        channel: 'open-webui',
        conversationId: 'chat-propose-from-case',
        asyncDelivery: { mode: 'poll', clientId: 'openwebui-tenant-a' },
      });

      // Unresolved case (still evidence_required): must reject and perform no write.
      await expect(
        call(
          'cases.skills.proposeFromCase',
          { caseId: c.cetCaseId, skillId: 'from-case-skill' },
          userMeta
        )
      ).rejects.toThrow(/not resolved|not confirmed/iu);

      // Missing case: must reject and perform no write.
      await expect(
        call(
          'cases.skills.proposeFromCase',
          { caseId: 'does-not-exist', skillId: 'from-case-skill' },
          userMeta
        )
      ).rejects.toThrow();

      // Cross-tenant: must reject and perform no write.
      await expect(
        call(
          'cases.skills.proposeFromCase',
          { caseId: c.cetCaseId, skillId: 'from-case-skill' },
          otherTenantMeta
        )
      ).rejects.toThrow();

      // Unauthorized (same tenant, no case-visible role): must reject and perform no write.
      await expect(
        call(
          'cases.skills.proposeFromCase',
          { caseId: c.cetCaseId, skillId: 'from-case-skill' },
          unauthorizedMeta
        )
      ).rejects.toThrow();

      const listBeforeResolve = await call('skills.list', {}, userMeta);
      expect(listBeforeResolve.items.map((i) => i.skillId)).not.toContain('from-case-skill');

      await router('ingestUpdate', {
        cetCaseId: c.cetCaseId,
        kind: 'evidence_available',
        version: 'resolve-v1',
        validated: true,
        evidenceRef: 'resolved-ref',
      });

      const proposed = await call(
        'cases.skills.proposeFromCase',
        { caseId: c.cetCaseId, skillId: 'from-case-skill' },
        userMeta
      );
      expect(proposed.skill.status).toBe('proposed');
      expect(proposed.skill.domains.length).toBeGreaterThan(0);
      expect(proposed.skill.blockedActions).toEqual(
        expect.arrayContaining(['external_message_send', 'approval_grant'])
      );
      expect(JSON.stringify(proposed)).not.toMatch(
        /APERAK Z18 Rückfrage bitte dokumentieren, Lieferant reklamiert MSCONS/u
      );

      // Idempotent retry: no duplicate write, same proposed skill returned.
      const retried = await call(
        'cases.skills.proposeFromCase',
        { caseId: c.cetCaseId, skillId: 'from-case-skill' },
        userMeta
      );
      expect(retried.skill.status).toBe('proposed');
      expect(retried.skill.version).toBe(proposed.skill.version);
    });

    test('skill creation rejects secret-like, nested and oversized content without persisting it', async () => {
      await expect(
        call('skills.create', {
          skillId: 'secret-skill',
          title: 'Secret Skill',
          domains: ['edm'],
          steps: ['Authorization: Bearer super-secret-token-12345'],
        })
      ).rejects.toThrow(/secret/iu);
      await expect(
        call('skills.create', {
          skillId: 'nested-skill',
          title: 'Nested Skill',
          domains: ['edm'],
          requiredEvidence: [{ raw: 'nested payload' }],
        })
      ).rejects.toThrow(/flat list/iu);
      await expect(
        call('skills.create', {
          skillId: 'oversized-skill',
          title: 'x'.repeat(5000),
          domains: ['edm'],
        })
      ).rejects.toThrow(/too long/iu);

      const list = await call('skills.list', {}, userMeta);
      expect(list.items.map((i) => i.skillId)).not.toEqual(
        expect.arrayContaining(['secret-skill', 'nested-skill', 'oversized-skill'])
      );
    });

    test('activated skills always inherit baseline no-call guards and blocked actions and cannot subtract them', async () => {
      const created = await call('skills.create', {
        skillId: 'guard-inherit-skill',
        title: 'Guard Inherit Skill',
        domains: ['grid_connection'],
        applicableRoles: ['ROLE_GRID_OPERATOR'],
        blockedActions: [],
        noCallGuards: [],
      });
      expect(created.skill.blockedActions).toEqual(
        expect.arrayContaining(['external_message_send', 'approval_grant'])
      );
      const governance = await call('governance-map.get', { domain: 'grid_connection' }, userMeta);
      for (const guard of governance.governance.noCallGuards) {
        expect(created.skill.noCallGuards).toContain(guard);
      }
      await call('skills.propose', { skillId: 'guard-inherit-skill' });
      const activated = await call('skills.activate', { skillId: 'guard-inherit-skill' });
      expect(activated.skill.blockedActions).toEqual(
        expect.arrayContaining(['external_message_send', 'approval_grant'])
      );
      for (const guard of governance.governance.noCallGuards) {
        expect(activated.skill.noCallGuards).toContain(guard);
      }
    });

    test('active skill application is visible in case summary/dossier as a safe appliedPlaybooks entry', async () => {
      await provisionOpenWebUiUser();
      await call('skills.create', {
        skillId: 'applied-skill',
        title: 'Applied Skill For Chat',
        domains: ['market_communication'],
        applicableRoles: ['ROLE_GRID_OPERATOR'],
        triggerPatterns: ['aperak'],
      });
      await call('skills.propose', { skillId: 'applied-skill' });
      await call('skills.activate', { skillId: 'applied-skill' });

      const response = await call('chat', {
        client: 'open-webui',
        channel: 'open-webui',
        openWebuiOrgId: 'ow-org',
        openWebuiUserId: 'ow-user',
        openWebuiConversationId: 'chat-applied-skill',
        clientId: 'openwebui-tenant-a',
        message: 'APERAK Z18 nach MSCONS bitte prüfen',
      });
      const summary = await call('cases.get', { caseId: response.cetCaseId }, userMeta);
      expect(summary.appliedPlaybooks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ skillId: 'applied-skill', title: 'Applied Skill For Chat' }),
        ])
      );
      expect(JSON.stringify(summary.appliedPlaybooks)).not.toMatch(
        /APERAK Z18 nach MSCONS bitte prüfen/u
      );

      const dossier = await call('cases.dossier', { caseId: response.cetCaseId }, userMeta);
      expect(dossier.content).toBeTruthy();
    });

    test('skill deprecation preserves prior version snapshots and audit history without deleting them', async () => {
      const v1 = await call('skills.create', {
        skillId: 'rollback-skill',
        title: 'Rollback Skill v1',
        domains: ['edm'],
      });
      expect(v1.skill.version).toBe(1);
      await call('skills.propose', { skillId: 'rollback-skill' });
      const activated = await call('skills.activate', { skillId: 'rollback-skill' });
      expect(activated.skill.version).toBe(1);
      const deprecated = await call('skills.deprecate', { skillId: 'rollback-skill' });
      expect(deprecated.skill.version).toBe(1);
      expect(deprecated.skill.status).toBe('deprecated');

      const service = broker.getLocalService('workbench');
      const audit = await service.store.listSkillAudit({
        tenantId: 'tenant-a',
        skillId: 'rollback-skill',
      });
      expect(audit.map((e) => e.transition)).toEqual(
        expect.arrayContaining(['created', 'proposed', 'activated', 'deprecated'])
      );

      const stillListed = await call('skills.list', { status: 'deprecated' }, userMeta);
      expect(stillListed.items.map((i) => i.skillId)).toContain('rollback-skill');

      const deprecatedAgainNoOp = await call('skills.deprecate', { skillId: 'rollback-skill' });
      expect(deprecatedAgainNoOp.skill.status).toBe('deprecated');
      const auditAfterRetry = await service.store.listSkillAudit({
        tenantId: 'tenant-a',
        skillId: 'rollback-skill',
      });
      expect(auditAfterRetry.filter((e) => e.transition === 'deprecated')).toHaveLength(1);
    });

    test('skill lifecycle actions never invoke external connectors or business-process actions', async () => {
      await call('skills.create', {
        skillId: 'no-side-effects-skill',
        title: 'No Side Effects',
        domains: ['edm'],
      });
      await call('skills.propose', { skillId: 'no-side-effects-skill' });
      await call('skills.activate', { skillId: 'no-side-effects-skill' });
      await call('skills.deprecate', { skillId: 'no-side-effects-skill' });
      const service = broker.getLocalService('workbench');
      const toolRuns = await service.store.toolRunDb.allDocs({ include_docs: true });
      expect(toolRuns.rows.filter((r) => r.doc.type === 'workbench_tool_run')).toHaveLength(0);
      const mailAccounts = await service.store.mailAccountDb.allDocs({ include_docs: true });
      expect(mailAccounts.rows.filter((r) => r.doc.type === 'workbench_mail_account')).toHaveLength(
        0
      );
    });
  });
});
