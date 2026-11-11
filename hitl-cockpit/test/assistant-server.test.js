'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const { ManagementStore } = require('../lib/management-store');
const { AssistantStore } = require('../lib/assistant-store');

const cockpitRoot = path.resolve(__dirname, '..');
const token = 'ap16-assistant-bootstrap-token-with-entropy';
let root;
let stubExecutable;
let enabledConfig;
let disabledConfig;
let lowRiskConfig;
let database;
let child;
let baseUrl;
let cookie;

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

function policy(enabled) {
  return {
    version: 1,
    enabled,
    mode: 'read_only',
    writesEnabled: false,
    matrixHandoffEnabled: false,
    limits: {
      maxMessageChars: 4000,
      maxContextChars: 12000,
      recentMessageCount: 12,
      sessionRotateMessages: 20,
    },
    transport: {
      type: 'cli',
      safeMode: true,
      executable: stubExecutable,
      profile: 'rhajaina',
      toolset: 'bot_room',
      timeoutMs: 5000,
      runBudgetSeconds: 5,
      maxTurns: 1,
      source: 'tool',
      extraArgs: [],
    },
  };
}

async function stopServer() {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('close', resolve));
  child = null;
}

async function startServer(configPath) {
  await stopServer();
  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: cockpitRoot,
    env: {
      ...process.env,
      HITL_COCKPIT_HOST: '127.0.0.1',
      HITL_COCKPIT_PORT: String(port),
      HITL_COCKPIT_TOKEN: token,
      HERMES_HOME: root,
      MANAGEMENT_COCKPIT_ENABLED: 'true',
      MANAGEMENT_COCKPIT_DEFAULT_VIEW: 'management',
      ASSISTANT_CONFIG: configPath,
      ASSISTANT_DATABASE: database,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`assistant server exited: ${stderr}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 401) break;
    } catch (_) {
      // Server may still be binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const bootstrap = await fetch(`${baseUrl}/management?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  });
  assert.equal(bootstrap.status, 303);
  cookie = bootstrap.headers.get('set-cookie').split(';', 1)[0];
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { cookie, ...(options.headers || {}) },
  });
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-cockpit-ap16-'));
  fs.mkdirSync(path.join(root, 'kanban', 'boards'), { recursive: true });
  const managementStore = new ManagementStore({
    database: path.join(root, 'management-cockpit', 'management.db'),
  });
  managementStore.initialize();
  stubExecutable = path.join(root, 'rhajaina-stub');
  fs.writeFileSync(
    stubExecutable,
    "#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('Stub-Antwort ohne Tool-Ausgabe\\n'); process.stderr.write('session_id: 20261109_182510_c5a695\\n'); });\n",
    { mode: 0o700 }
  );
  database = path.join(root, 'agent-os', 'assistant-channel.db');
  enabledConfig = path.join(root, 'assistant-enabled.json');
  disabledConfig = path.join(root, 'assistant-disabled.json');
  lowRiskConfig = path.join(root, 'assistant-low-risk.json');
  fs.writeFileSync(enabledConfig, JSON.stringify(policy(true)));
  const disabledPolicy = policy(false);
  disabledPolicy.transport.executable = path.join(root, 'missing-hermes');
  fs.writeFileSync(disabledConfig, JSON.stringify(disabledPolicy));
  fs.writeFileSync(
    lowRiskConfig,
    JSON.stringify({
      ...policy(true),
      mode: 'low_risk',
      writesEnabled: true,
      matrixHandoffEnabled: true,
      actionAllowlist: [
        'ask_question',
        'delegate_followup',
        'schedule_wakeup',
        'return_for_completion',
      ],
    })
  );
});

after(async () => {
  await stopServer();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('invalid assistant configuration fails closed before the server binds', async () => {
  const invalidConfig = path.join(root, 'assistant-invalid.json');
  fs.writeFileSync(invalidConfig, JSON.stringify({ ...policy(false), mode: 'write' }));
  const port = await allocatePort();
  const candidate = spawn(process.execPath, ['server.js'], {
    cwd: cockpitRoot,
    env: {
      ...process.env,
      HITL_COCKPIT_HOST: '127.0.0.1',
      HITL_COCKPIT_PORT: String(port),
      HITL_COCKPIT_TOKEN: token,
      HERMES_HOME: root,
      ASSISTANT_CONFIG: invalidConfig,
      ASSISTANT_DATABASE: database,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  candidate.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve) => candidate.once('close', resolve));
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /assistant_config_invalid/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
});

test('disabled server exposes sanitized config but no assistant routes', async () => {
  assert.equal(fs.existsSync(database), false);
  await startServer(disabledConfig);
  const config = await request('/api/assistant/config');
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), {
    ok: true,
    enabled: false,
    mode: 'read_only',
    writesEnabled: false,
    matrixHandoffEnabled: false,
    actionAllowlist: [],
    limits: { maxMessageChars: 4000, maxContextChars: 12000 },
  });
  assert.equal((await request('/api/assistant/conversations')).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/assistant/config?token=${token}`)).status, 401);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/')).status, 200);
  assert.equal(fs.existsSync(database), false);
});

test('health exposes an aligned secret-free production operating status', async () => {
  await startServer(lowRiskConfig);
  const health = await (await request('/api/health')).json();
  assert.equal(health.operatingStatus.contractId, 'management-cockpit-production-v2');
  assert.equal(health.operatingStatus.declaredMode, 'low_risk');
  assert.equal(health.operatingStatus.label, 'Assistenz · begrenzte Aktionen');
  assert.equal(health.operatingStatus.aligned, true);
  assert.deepEqual(health.operatingStatus.mismatches, []);
  assert.deepEqual(health.operatingStatus.runtime.assistant.actionClasses, [
    'ask_question',
    'delegate_followup',
    'schedule_wakeup',
    'return_for_completion',
  ]);
  assert.doesNotMatch(
    JSON.stringify(health.operatingStatus),
    /transport|executable|configPath|token|password|authorization/i
  );
});

test('enabled startup resumes and completes persisted accepted turns', async () => {
  const store = new AssistantStore({ database });
  store.initialize();
  const conversation = store.createConversation({
    id: 'conversation_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const interrupted = store.createRun({
    id: 'run_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    conversationId: conversation.id,
    text: 'Resume after restart',
    clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createdAt: 1,
  }).run;
  await startServer(enabledConfig);
  let recovered = await (await request(`/api/assistant/runs/${interrupted.id}`)).json();
  for (let attempt = 0; attempt < 80 && recovered.status !== 'completed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    recovered = await (await request(`/api/assistant/runs/${interrupted.id}`)).json();
  }
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.errorCode, null);
});

test('enabled server enforces HTTP guards, uses stub transport, and persists across reload', async () => {
  await startServer(enabledConfig);
  assert.equal((await fetch(`${baseUrl}/api/assistant/config`)).status, 401);

  const crossOrigin = await request('/api/assistant/conversations', {
    method: 'POST',
    headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
    body: JSON.stringify({ context: null }),
  });
  assert.equal(crossOrigin.status, 403);
  const nonJson = await request('/api/assistant/conversations', {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(nonJson.status, 415);
  const oversized = await request('/api/assistant/conversations', {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ context: null, padding: 'x'.repeat(17000) }),
  });
  assert.equal(oversized.status, 413);

  const createdResponse = await request('/api/assistant/conversations', {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ context: null }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const clientMessageId = 'a1611111-1111-4111-8111-111111111111';
  const submittedResponse = await request(
    `/api/assistant/conversations/${encodeURIComponent(created.id)}/messages`,
    {
      method: 'POST',
      headers: { origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ clientMessageId, text: 'Bitte ordne die Lage ein.' }),
    }
  );
  assert.equal(submittedResponse.status, 202);
  const submitted = await submittedResponse.json();
  let run;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await request(`/api/assistant/runs/${encodeURIComponent(submitted.id)}`);
    run = await response.json();
    if (run.status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(run.status, 'completed');
  assert.equal(run.runId, submitted.id);
  assert.equal(typeof run.hermesSessionId, 'string');

  const messagesResponse = await request(
    `/api/assistant/conversations/${encodeURIComponent(created.id)}/messages`
  );
  const messages = await messagesResponse.json();
  assert.deepEqual(
    messages.items.map(({ role, content }) => ({ role, content })),
    [
      { role: 'user', content: 'Bitte ordne die Lage ein.' },
      { role: 'assistant', content: 'Stub-Antwort ohne Tool-Ausgabe' },
    ]
  );
  assert.equal(fs.statSync(database).mode & 0o777, 0o600);

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const response = await request('/api/assistant/conversations', {
      method,
      headers: { origin: baseUrl, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 405);
  }

  await startServer(enabledConfig);
  const conversations = await (await request('/api/assistant/conversations')).json();
  assert.ok(conversations.items.some((item) => item.id === created.id));
  const persisted = await (
    await request(`/api/assistant/conversations/${encodeURIComponent(created.id)}/messages`)
  ).json();
  assert.equal(persisted.items.at(-1).content, 'Stub-Antwort ohne Tool-Ausgabe');
});
