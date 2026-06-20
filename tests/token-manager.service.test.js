const { ServiceBroker } = require('moleculer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TokenManagerService = require('../services/token-manager.service');

describe('token-manager.service', () => {
  let broker;
  let storageFile;

  beforeAll(async () => {
    storageFile = path.join(os.tmpdir(), `token-manager-${Date.now()}.json`);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...TokenManagerService,
      settings: {
        ...TokenManagerService.settings,
        storageFile,
        maxTokensPerInstallation: 5,
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
  });

  it('creates a token and returns plaintext only once', async () => {
    const created = await broker.call('token-manager.create', {
      name: 'Power BI',
      scope: 'read-only',
      tenantId: 'stadtwerk-a',
      userId: 'thorsten',
    });

    expect(created.success).toBe(true);
    expect(created.data.token.startsWith('ck_')).toBe(true);

    const listed = await broker.call('token-manager.list');
    expect(listed.success).toBe(true);
    expect(listed.data[0].token).toContain('****');
    expect(listed.data[0].token).not.toBe(created.data.token);
  });

  it('verifies token and enforces read-only method restrictions', async () => {
    const created = await broker.call('token-manager.create', {
      name: 'Automate',
      scope: 'read-only',
      tenantId: 'stadtwerk-a',
      userId: 'svc:automate',
    });

    const validRead = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'GET',
      path: '/api/vnb-monitor/10002954',
      trackUsage: true,
    });
    expect(validRead.valid).toBe(true);

    const deniedWrite = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'DELETE',
      path: '/api/tokens/123',
      trackUsage: false,
    });
    expect(deniedWrite.valid).toBe(false);
    expect(deniedWrite.reason).toBe('SCOPE_VIOLATION');
  });

  it('allows read-only tokens to invoke the sidecar policy-gated tool call endpoint', async () => {
    const created = await broker.call('token-manager.create', {
      name: 'OpenClaw Sidecar',
      scope: 'read-only',
      tenantId: 'stadtwerk-a',
      userId: 'svc:openclaw',
    });

    const allowedSidecarPost = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'POST',
      path: '/api/agent-sidecar/tools/cernion.list_readonly_capabilities/call',
      trackUsage: false,
    });
    expect(allowedSidecarPost.valid).toBe(true);

    const allowedMcpSidecarPost = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'POST',
      path: '/api/agent-sidecar/mcp/tools/cernion.list_readonly_capabilities/call',
      trackUsage: false,
    });
    expect(allowedMcpSidecarPost.valid).toBe(true);

    const deniedOtherPost = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'POST',
      path: '/api/hitl/items/123/approve',
      trackUsage: false,
    });
    expect(deniedOtherPost.valid).toBe(false);
    expect(deniedOtherPost.reason).toBe('SCOPE_VIOLATION');
  });

  it('revokes token and invalidates verification', async () => {
    const created = await broker.call('token-manager.create', {
      name: 'Admin',
      scope: 'full-access',
      tenantId: 'stadtwerk-a',
      userId: 'admin',
    });

    const revoke = await broker.call('token-manager.revoke', { id: created.data.id });
    expect(revoke.success).toBe(true);

    const verify = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'GET',
      path: '/api/tokens',
    });
    expect(verify.valid).toBe(false);
  });

  it('rejects create when tenantId is missing', async () => {
    await expect(
      broker.call('token-manager.create', {
        name: 'No Tenant',
        scope: 'read-only',
        userId: 'thorsten',
      })
    ).rejects.toThrow();
  });

  it('rejects create when userId is missing', async () => {
    await expect(
      broker.call('token-manager.create', {
        name: 'No User',
        scope: 'read-only',
        tenantId: 'stadtwerk-a',
      })
    ).rejects.toThrow();
  });

  it('rejects cross-tenant token creation for tenant-bound callers', async () => {
    await expect(
      broker.call(
        'token-manager.create',
        {
          name: 'Cross Tenant',
          scope: 'read-only',
          tenantId: 'stadtwerk-b',
          userId: 'svc:cross-tenant',
        },
        {
          meta: {
            apiToken: {
              id: 'caller-token',
              scope: 'full-access',
              scopes: ['full-access'],
              tenantId: 'stadtwerk-a',
              userId: 'tenant-admin',
              legacy: false,
            },
          },
        }
      )
    ).rejects.toMatchObject({ code: 403, type: 'TOKEN_TENANT_FORBIDDEN' });
  });

  it('rejects cross-tenant token creation for tenant-bound session principals', async () => {
    await expect(
      broker.call(
        'token-manager.create',
        {
          name: 'Cross Tenant Session',
          scope: 'read-only',
          tenantId: 'stadtwerk-b',
          userId: 'svc:cross-tenant-session',
        },
        {
          meta: {
            authUser: {
              authType: 'session',
              userId: 'tenant-admin',
              tenantId: 'stadtwerk-a',
              roles: ['full-access'],
            },
          },
        }
      )
    ).rejects.toMatchObject({ code: 403, type: 'TOKEN_TENANT_FORBIDDEN' });
  });

  it('exposes tenantId, userId, and legacy:false for a new bound token in list and verify', async () => {
    const created = await broker.call('token-manager.create', {
      name: 'Bound Token',
      scope: 'read-only',
      tenantId: 'stadtwerk-b',
      userId: 'svc:bound-token-test',
    });
    expect(created.data.tenantId).toBe('stadtwerk-b');
    expect(created.data.userId).toBe('svc:bound-token-test');
    expect(created.data.legacy).toBe(false);

    const listed = await broker.call('token-manager.list');
    const entry = listed.data.find((t) => t.id === created.data.id);
    expect(entry.tenantId).toBe('stadtwerk-b');
    expect(entry.userId).toBe('svc:bound-token-test');
    expect(entry.legacy).toBe(false);

    const verified = await broker.call('token-manager.verify', {
      token: created.data.token,
      method: 'GET',
    });
    expect(verified.tenantId).toBe('stadtwerk-b');
    expect(verified.userId).toBe('svc:bound-token-test');
    expect(verified.legacy).toBe(false);
  });

  it('marks a pre-existing unbound token as legacy:true in list and verify', async () => {
    // Simulates a token created before Issue #157 (no tenantId/userId on record).
    const rawToken = 'ck_preexistingunboundlegacytoken1';
    const legacyHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    const existing = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    existing.push({
      id: 'legacy-token-1',
      name: 'Legacy Integration',
      tokenHash: legacyHash,
      tokenMasked: 'ck_pre****en1',
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      usageCount: 0,
      scope: 'read-only',
      scopes: ['read-only'],
      active: true,
    });
    fs.writeFileSync(storageFile, JSON.stringify(existing, null, 2), 'utf8');

    const listed = await broker.call('token-manager.list');
    const entry = listed.data.find((t) => t.id === 'legacy-token-1');
    expect(entry.tenantId).toBeNull();
    expect(entry.userId).toBeNull();
    expect(entry.legacy).toBe(true);

    const verified = await broker.call('token-manager.verify', {
      token: rawToken,
      method: 'GET',
    });
    expect(verified.valid).toBe(true);
    expect(verified.tenantId).toBeNull();
    expect(verified.userId).toBeNull();
    expect(verified.legacy).toBe(true);
  });
});
