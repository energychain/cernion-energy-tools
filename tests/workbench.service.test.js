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

  test('chat classifies new Open WebUI conversations and continues mapped cases', async () => {
    await call('admin.userMappings.create', {
      client: 'open-webui',
      externalOrgId: 'ow-org',
      externalUserId: 'ow-user',
      cetActorId: 'user-a',
      roles: ['ROLE_GRID_OPERATOR'],
      defaultClientId: 'openwebui-tenant-a',
    });
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
