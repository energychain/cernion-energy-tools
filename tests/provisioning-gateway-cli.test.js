'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('CLI gateway token, API roles and mapping bootstrap/list work without a running API', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-gateway-cli-'));
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    CERNION_SUPPORT_TOKEN: 'test-bootstrap-secret',
    CERNION_SUPPORT_TOKEN_INPUT: 'test-bootstrap-secret',
    CERNION_TENANT_REGISTRY_FILE: path.join(dir, 'tenants.json'),
    CERNION_USER_REGISTRY_FILE: path.join(dir, 'users.json'),
    TOKEN_STORAGE_FILE: path.join(dir, 'tokens.json'),
    TOKEN_SIGNAL_QUEUE_FILE: path.join(dir, 'signals.json'),
    TOKEN_ROLE_AUDIT_FILE: path.join(dir, 'role-audit.jsonl'),
  };
  const run = (script, args) =>
    spawnSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', script), ...args], {
      cwd: dir,
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
  try {
    const gateway = run('provision-token.js', [
      '--tenant=cli-736',
      '--user=svc:owui',
      '--name=Gateway',
      '--gateway',
      '--client=open-webui',
      '--org=org',
    ]);
    expect(gateway.status).toBe(0);
    expect(JSON.parse(gateway.stdout).data).toMatchObject({
      type: 'gateway',
      externalOrgId: 'org',
      client: 'open-webui',
      tenantId: 'cli-736',
      scopes: [],
    });
    const noOrg = run('provision-token.js', [
      '--tenant=cli-736',
      '--user=svc:owui',
      '--name=MissingOrg',
      '--gateway',
      '--client=open-webui',
    ]);
    expect(noOrg.status).toBe(1);
    expect(noOrg.stderr).toMatch(/--org required/);
    const admin = run('provision-token.js', [
      '--tenant=cli-736',
      '--user=admin',
      '--name=Admin',
      '--roles=ROLE_USER,ROLE_TENANT_ADMIN',
    ]);
    expect(admin.status).toBe(0);
    expect(JSON.parse(admin.stdout).data.roles).toEqual(['ROLE_USER', 'ROLE_TENANT_ADMIN']);
    const mapping = run('provision-workbench-mapping.js', [
      '--tenant=cli-736',
      '--client=open-webui',
      '--org=org',
      '--user=alice',
      '--actor=cet-alice',
      '--roles=ROLE_USER',
      '--clearance=tenant_internal',
    ]);
    expect(mapping.status).toBe(0);
    expect(JSON.parse(mapping.stdout).mapping).toMatchObject({
      cetActorId: 'cet-alice',
      sensitivityClearance: ['tenant_internal'],
    });
    const emailMapping = run('provision-workbench-mapping.js', [
      '--tenant=cli-736',
      '--org=org',
      '--email= Alice@Example.org ',
      '--actor=cet-email',
      '--roles=ROLE_USER',
    ]);
    expect(emailMapping.status).toBe(0);
    expect(JSON.parse(emailMapping.stdout).mapping).toMatchObject({
      externalUserEmail: 'alice@example.org',
      cetActorId: 'cet-email',
    });
    for (const identity of [
      [],
      ['--email=invalid'],
      ['--email=alice@example.org', '--user=alice'],
    ]) {
      const badMapping = run('provision-workbench-mapping.js', [
        '--tenant=cli-736',
        '--org=org',
        '--actor=invalid',
        '--roles=ROLE_USER',
        ...identity,
      ]);
      expect(badMapping.status).toBe(1);
    }
    const list = run('provision-workbench-mapping.js', [
      '--tenant=cli-736',
      '--client=open-webui',
      '--list',
    ]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout).mappings).toHaveLength(3);
    const rejected = run('provision-token.js', [
      '--tenant=cli-736',
      '--user=admin',
      '--name=Rejected',
      '--roles=ROLE_ADMIN',
    ]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toMatch(/requires audited --support/);
    const supported = run('provision-token.js', [
      '--tenant=cli-736',
      '--user=support',
      '--name=Support',
      '--roles=ROLE_ADMIN',
      '--support',
    ]);
    expect(supported.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(env.TOKEN_ROLE_AUDIT_FILE, 'utf8').trim()).roles).toEqual([
      'ROLE_ADMIN',
    ]);
    const invalid = run('provision-token.js', [
      '--tenant=cli-736',
      '--user=admin',
      '--name=Invalid',
      '--roles=ROLE_UNKNOWN',
    ]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toMatch(/Unsupported token role/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
