'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Api = require('../services/api.service');
const TokenManager = require('../services/token-manager.service');
const { provisionToken } = require('../scripts/provision-token');
const { socketPath } = require('../src/local-provisioning-channel');

const cliFile = path.resolve(__dirname, '../scripts/provision-workbench-mapping.js');
function runCli(dir, env, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { cwd: dir, env });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI timed out'));
    }, 15000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}
function requestSocket(filename, body, secret, route = '/workbench/map') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: filename,
        path: route,
        method: 'POST',
        headers: secret ? { 'X-CET-Support-Token': secret } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('Workbench provisioning while CET holds the LevelDB lock', () => {
  let broker, dir, env, previousEnv, filename, base, admin;
  const args = [
    '--tenant=live',
    '--org=org',
    '--email= Alice@Example.org ',
    '--actor=cet-alice',
    '--roles=ROLE_USER',
    '--clearance=tenant_internal',
  ];
  beforeAll(async () => {
    previousEnv = { ...process.env };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-live-cli-'));
    env = {
      ...process.env,
      CERNION_SUPPORT_TOKEN: 'local-support-secret',
      CERNION_SUPPORT_TOKEN_INPUT: 'local-support-secret',
      CERNION_TENANT_REGISTRY_FILE: path.join(dir, 'tenants.json'),
      CERNION_USER_REGISTRY_FILE: path.join(dir, 'users.json'),
      CET_WORKBENCH_IDENTITY_DB_PATH: path.join(dir, 'identity'),
      CET_PROVISIONING_SOCKET: path.join(dir, 'admin.sock'),
      TOKEN_ROLE_AUDIT_FILE: path.join(dir, 'role-audit.jsonl'),
      RATE_QUOTA_DIR: path.join(dir, 'quotas'),
    };
    fs.writeFileSync(env.CERNION_TENANT_REGISTRY_FILE, JSON.stringify([{ tenantId: 'live' }]));
    Object.assign(process.env, env);
    broker = new ServiceBroker({ logger: false, transporter: null });
    const settings = {};
    for (const key of [
      'dbPath',
      'identityDbPath',
      'deliveryDbPath',
      'evidenceDbPath',
      'turnMemoryDbPath',
      'contextDbPath',
      'playbookDbPath',
      'inboxDbPath',
      'toolRunDbPath',
      'mailAccountDbPath',
    ])
      settings[key] = path.join(dir, key);
    settings.identityDbPath = env.CET_WORKBENCH_IDENTITY_DB_PATH;
    broker.createService({ ...Workbench, settings });
    broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
    broker.createService({
      ...TokenManager,
      settings: {
        ...TokenManager.settings,
        storageFile: path.join(dir, 'tokens.json'),
        signalQueueFile: path.join(dir, 'signals.json'),
      },
    });
    await broker.start();
    filename = socketPath(settings.identityDbPath);
    const api = broker.getLocalService('api');
    for (const route of api.routes.filter((entry) => entry.opts.autoAliases))
      api.regenerateAutoAliases(route);
    base = `http://127.0.0.1:${api.server.address().port}`;
    admin = (
      await provisionToken(
        { tenant: 'live', user: 'admin', name: 'Admin', roles: 'ROLE_USER,ROLE_TENANT_ADMIN' },
        broker
      )
    ).data.token;
  });
  afterAll(async () => {
    await broker?.stop();
    expect(fs.existsSync(filename)).toBe(false);
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('parallel CLI writes and lists using the running broker, without opening a second DB', async () => {
    const result = await runCli(dir, env, args);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const mapping = JSON.parse(result.stdout).mapping;
    expect(mapping).toMatchObject({
      cetTenantId: 'live',
      externalUserEmail: 'alice@example.org',
      cetActorId: 'cet-alice',
      roles: ['ROLE_USER'],
      sensitivityClearance: ['tenant_internal'],
    });
    const listed = await runCli(dir, env, ['--tenant=live', '--list']);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).mappings).toHaveLength(2);
    expect(broker.started).toBe(true);
  });
  test('socket has no TCP listener and refuses missing/wrong support credentials', async () => {
    expect(broker.getLocalService('workbench').provisioningServer.address()).toBe(filename);
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filename)).mode & 0o777).toBe(0o700);
    for (const secret of [undefined, 'wrong']) {
      expect((await requestSocket(filename, { tenant: 'live', list: true }, secret)).status).toBe(
        403
      );
    }
    const response = await fetch(`${base}/workbench/map`, {
      method: 'POST',
      headers: { 'X-CET-Support-Token': 'local-support-secret' },
      body: '{}',
    });
    expect(response.status).toBe(404);
    expect(
      (
        await requestSocket(
          filename,
          { action: 'token-manager.createCli' },
          'local-support-secret',
          '/execute'
        )
      ).status
    ).toBe(404);
    expect(
      (
        await requestSocket(
          filename,
          { tenant: 'live', list: true, meta: { roles: ['ROLE_ADMIN'] } },
          'wrong'
        )
      ).status
    ).toBe(403);
  });
  test('local and HTTP paths use identical validation and persisted mapping metadata', async () => {
    const invalid = await runCli(
      dir,
      env,
      args.map((value) => (value === '--roles=ROLE_USER' ? '--roles=ROLE_ADMIN' : value))
    );
    expect(invalid.status).toBe(1);
    const response = await fetch(`${base}/api/workbench/admin/user-mappings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: 'open-webui',
        externalOrgId: 'org',
        externalUserEmail: 'alice@example.org',
        cetActorId: 'cet-alice',
        roles: ['ROLE_USER'],
        sensitivityClearance: ['tenant_internal'],
      }),
    });
    expect(response.status).toBe(200);
    const remote = (await response.json()).mapping;
    const saved = await broker.getLocalService('workbench').store.getUserMappingByEmail({
      client: 'open-webui',
      externalOrgId: 'org',
      externalUserEmail: 'alice@example.org',
    });
    expect(remote).toEqual(saved);
    expect(remote.createdAt).toEqual(expect.any(String));
    expect(remote.updatedAt).toEqual(expect.any(String));
    expect(remote._rev).toEqual(expect.any(String));
    const invalidHttp = await fetch(`${base}/api/workbench/admin/user-mappings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        externalOrgId: 'org',
        externalUserEmail: 'alice@example.org',
        roles: ['ROLE_ADMIN'],
      }),
    });
    expect(invalidHttp.status).toBe(422);
  });
  test('explicit API fallback works for creation/list; gateway token cannot administer', async () => {
    const apiEnv = { ...env, CERNION_SUPPORT_TOKEN: '', CERNION_SUPPORT_TOKEN_INPUT: '' };
    const result = await runCli(dir, apiEnv, [
      ...args,
      '--via-api',
      `--url=${base}`,
      `--token=${admin}`,
    ]);
    expect(result.status).toBe(0);
    const listed = await runCli(dir, apiEnv, [
      '--tenant=live',
      '--list',
      '--via-api',
      `--url=${base}`,
      `--token=${admin}`,
    ]);
    expect(listed.status).toBe(0);
    expect(JSON.parse(listed.stdout).mappings).toHaveLength(2);
    const user = (
      await provisionToken(
        { tenant: 'live', user: 'ordinary', name: 'User', roles: 'ROLE_USER' },
        broker
      )
    ).data.token;
    expect(
      (
        await runCli(dir, apiEnv, [
          '--tenant=live',
          '--list',
          '--via-api',
          `--url=${base}`,
          `--token=${user}`,
        ])
      ).status
    ).toBe(1);
    expect(
      (
        await runCli(dir, apiEnv, [
          '--tenant=foreign',
          '--list',
          '--via-api',
          `--url=${base}`,
          `--token=${admin}`,
        ])
      ).status
    ).toBe(1);
    const gateway = (
      await provisionToken(
        {
          tenant: 'live',
          user: 'svc:owui',
          name: 'Gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org',
        },
        broker
      )
    ).data.token;
    expect(
      (await runCli(dir, apiEnv, [...args, '--via-api', `--url=${base}`, `--token=${gateway}`]))
        .status
    ).toBe(1);
  });
  test('unavailable local channel with held DB lock gives an actionable fallback', async () => {
    const result = await runCli(
      dir,
      { ...env, CET_PROVISIONING_SOCKET: path.join(dir, 'absent.sock') },
      args
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Dienst läuft.*--via-api.*--token/);
    expect(result.stderr).not.toMatch(/Resource temporarily unavailable|IO error/);
  });
  test('failed online authentication does not fall back to direct DB writes', async () => {
    const result = await runCli(
      dir,
      { ...env, CERNION_SUPPORT_TOKEN: 'other', CERNION_SUPPORT_TOKEN_INPUT: 'other' },
      args
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/authentication required/);
    expect(result.stderr).not.toMatch(/Dienst läuft|LOCK/);
  });
});

test('stale Unix socket is replaced and broker shutdown cleans up the channel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-stale-socket-'));
  const filename = path.join(dir, 'admin.sock');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(filename, resolve));
  // A killed process leaves a socket inode. Copy this state by closing the fd then recreating with a child killed while bound.
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [
    '-e',
    'require("net").createServer().listen(process.argv[1],()=>process.stdout.write("ready"))',
    filename,
  ]);
  await new Promise((resolve) => child.stdout.once('data', resolve));
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('close', resolve));
  const {
    startLocalProvisioning,
    stopLocalProvisioning,
  } = require('../src/local-provisioning-channel');
  const oldSocket = process.env.CET_PROVISIONING_SOCKET,
    oldSecret = process.env.CERNION_SUPPORT_TOKEN;
  process.env.CET_PROVISIONING_SOCKET = filename;
  process.env.CERNION_SUPPORT_TOKEN = 'test';
  const service = { settings: {}, broker: {} };
  try {
    await startLocalProvisioning(service);
    expect(fs.statSync(filename).isSocket()).toBe(true);
    await stopLocalProvisioning(service);
    expect(fs.existsSync(filename)).toBe(false);
  } finally {
    if (oldSocket === undefined) delete process.env.CET_PROVISIONING_SOCKET;
    else process.env.CET_PROVISIONING_SOCKET = oldSocket;
    if (oldSecret === undefined) delete process.env.CERNION_SUPPORT_TOKEN;
    else process.env.CERNION_SUPPORT_TOKEN = oldSecret;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
