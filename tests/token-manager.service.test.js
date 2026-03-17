const { ServiceBroker } = require('moleculer');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

  it('revokes token and invalidates verification', async () => {
    const created = await broker.call('token-manager.create', {
      name: 'Admin',
      scope: 'full-access',
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
});
