'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const cockpitRoot = path.resolve(__dirname, '..');
const bootstrapToken = 'ap14-bootstrap-token-with-entropy';
let baseUrl;
let child;
let tempRoot;

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 401) return;
    } catch (_) {
      // The child may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('session auth test server did not start');
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-cockpit-ap14-'));
  fs.mkdirSync(path.join(tempRoot, 'kanban', 'boards'), { recursive: true });
  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: cockpitRoot,
    env: {
      ...process.env,
      HITL_COCKPIT_HOST: '127.0.0.1',
      HITL_COCKPIT_PORT: String(port),
      HITL_COCKPIT_TOKEN: bootstrapToken,
      HITL_COCKPIT_SESSION_TTL_SECONDS: '300',
      HITL_COCKPIT_ALLOW_LEGACY_BEARER: 'false',
      HERMES_HOME: tempRoot,
      MANAGEMENT_COCKPIT_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
});

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('server bootstraps once, removes token from Location and accepts the session cookie', async () => {
  const bootstrap = await fetch(
    `${baseUrl}/management?section=overview&token=${encodeURIComponent(bootstrapToken)}`,
    { redirect: 'manual' }
  );
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get('location'), '/management?section=overview');
  assert.doesNotMatch(bootstrap.headers.get('location'), /token/i);
  const setCookie = bootstrap.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';', 1)[0];

  const page = await fetch(`${baseUrl}${bootstrap.headers.get('location')}`, {
    headers: { cookie },
  });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.doesNotMatch(await page.text(), new RegExp(bootstrapToken));

  const api = await fetch(`${baseUrl}/api/health`, { headers: { cookie } });
  assert.equal(api.status, 200);
  assert.equal((await api.json()).ok, true);
});

test('server rejects query-token API authentication and legacy bearer by default', async () => {
  const query = await fetch(`${baseUrl}/api/health?token=${encodeURIComponent(bootstrapToken)}`);
  assert.equal(query.status, 401);
  assert.equal(query.headers.get('referrer-policy'), 'no-referrer');

  const bearer = await fetch(`${baseUrl}/api/health`, {
    headers: { authorization: `Bearer ${bootstrapToken}` },
  });
  assert.equal(bearer.status, 401);
});

test('static assets contain no bootstrap credential and carry browser hardening headers', async () => {
  const response = await fetch(`${baseUrl}/app.js`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  const source = await response.text();
  assert.doesNotMatch(source, new RegExp(bootstrapToken));
  assert.doesNotMatch(source, /fetch\([^\n]+token=/);
});
