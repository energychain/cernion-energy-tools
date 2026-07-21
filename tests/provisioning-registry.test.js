const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateSupportToken, upsertTenant, upsertUser } = require('../src/provisioning-registry');

describe('provisioning registry and CLI', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cernion-provisioning-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('requires an explicit matching support token without exposing the configured value', () => {
    expect(() =>
      validateSupportToken('wrong-token', { CERNION_SUPPORT_TOKEN: 'support-secret' })
    ).toThrow('Invalid support token');

    expect(
      validateSupportToken('support-secret', { CERNION_SUPPORT_TOKEN: 'support-secret' })
    ).toBe(true);
  });

  it('upserts tenant and user audit records deterministically', () => {
    const tenantsFile = path.join(tempDir, 'tenants.json');
    const usersFile = path.join(tempDir, 'users.json');

    const tenant = upsertTenant({
      tenantId: 'Public',
      name: 'Public Tenant',
      registryFile: tenantsFile,
    });
    const user = upsertUser({
      tenantId: 'public',
      userId: 'svc:bootstrap',
      email: 'bootstrap@example.org',
      registryFile: usersFile,
    });

    expect(tenant).toMatchObject({ tenantId: 'public', name: 'Public Tenant' });
    expect(user).toMatchObject({
      tenantId: 'public',
      userId: 'svc:bootstrap',
      email: 'bootstrap@example.org',
    });
    expect(JSON.parse(fs.readFileSync(tenantsFile, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(usersFile, 'utf8'))).toHaveLength(1);
  });

  it('creates a bound token through the support-only CLI without persisting the support secret', () => {
    const tokenFile = path.join(tempDir, 'tokens.json');
    const tenantsFile = path.join(tempDir, 'tenants.json');
    const usersFile = path.join(tempDir, 'users.json');
    const supportSecret = 'support-secret-for-test';

    const result = spawnSync(
      process.execPath,
      [
        'scripts/provision-token.js',
        '--support-token',
        supportSecret,
        '--tenant',
        'public',
        '--user',
        'svc:chat-ui',
        '--scope',
        'full-access',
        '--scopes',
        'chatgpt-sidecar-creator',
        '--name',
        'Chat UI',
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          CERNION_SUPPORT_TOKEN: supportSecret,
          TOKEN_STORAGE_FILE: tokenFile,
          CERNION_TENANT_REGISTRY_FILE: tenantsFile,
          CERNION_USER_REGISTRY_FILE: usersFile,
        },
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(supportSecret);

    const payload = JSON.parse(result.stdout);
    expect(payload.success).toBe(true);
    expect(payload.data.token).toMatch(/^ck_/);
    expect(payload.data.tenantId).toBe('public');
    expect(payload.data.userId).toBe('svc:chat-ui');
    expect(payload.data.scope).toBe('full-access');
    expect(payload.data.scopes).toContain('chatgpt-sidecar-creator');

    const storedTokens = fs.readFileSync(tokenFile, 'utf8');
    expect(storedTokens).not.toContain(payload.data.token);
    expect(storedTokens).not.toContain(supportSecret);
    expect(JSON.parse(storedTokens)[0]).toMatchObject({
      name: 'Chat UI',
      tenantId: 'public',
      userId: 'svc:chat-ui',
      scope: 'full-access',
      active: true,
    });
    expect(JSON.parse(fs.readFileSync(tenantsFile, 'utf8'))[0].tenantId).toBe('public');
    expect(JSON.parse(fs.readFileSync(usersFile, 'utf8'))[0].userId).toBe('svc:chat-ui');
  });

  it('accepts support token input from the environment so runbooks avoid process args', () => {
    const tenantsFile = path.join(tempDir, 'tenants-env.json');
    const supportSecret = 'support-secret-from-env';

    const result = spawnSync(
      process.execPath,
      ['scripts/provision-tenant.js', '--tenant', 'public', '--name', 'Public Tenant'],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          CERNION_SUPPORT_TOKEN: supportSecret,
          CERNION_SUPPORT_TOKEN_INPUT: supportSecret,
          CERNION_TENANT_REGISTRY_FILE: tenantsFile,
        },
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain(supportSecret);
    expect(JSON.parse(fs.readFileSync(tenantsFile, 'utf8'))[0]).toMatchObject({
      tenantId: 'public',
      name: 'Public Tenant',
    });
  });
});
