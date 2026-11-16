'use strict';

// End-to-end over HTTP (DEV-UAT-006, TECH-ASYNC-01): gateway token, /v1/chat/completions with an
// Idempotency-Key, 202 after the sync window, status poll, persisted answer and retries. The chat
// turn itself is a stand-in with a controlled duration.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-async-http-'));
const env = { ...process.env };
Object.assign(process.env, {
  JOB_STORE_DIR: path.join(dir, 'jobs'),
  CERNION_SUPPORT_TOKEN: 'synthetic-bootstrap',
  CERNION_SUPPORT_TOKEN_INPUT: 'synthetic-bootstrap',
  CERNION_TENANT_REGISTRY_FILE: path.join(dir, 'tenants.json'),
  CERNION_USER_REGISTRY_FILE: path.join(dir, 'users.json'),
  TOKEN_ROLE_AUDIT_FILE: path.join(dir, 'audit.jsonl'),
  RATE_QUOTA_DIR: path.join(dir, 'quotas'),
  WORKBENCH_ASYNC_TURNS: 'async-tenant',
  WORKBENCH_TEST_DELAY_TENANTS: 'async-tenant',
});
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const { provisionToken } = require('../scripts/provision-token');

const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('asynchronous chat turns over HTTP', () => {
  let broker, base, gateway;
  let turns = 0;
  beforeAll(async () => {
    fs.writeFileSync(
      process.env.CERNION_TENANT_REGISTRY_FILE,
      JSON.stringify([{ tenantId: 'async-tenant' }])
    );
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...TokenManager,
      settings: {
        ...TokenManager.settings,
        storageFile: path.join(dir, 'tokens.json'),
        signalQueueFile: path.join(dir, 'signals.json'),
      },
    });
    broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
    broker.createService({
      name: 'openai-compatible',
      actions: {
        async chatCompletions(ctx) {
          turns += 1;
          await later(Number(ctx.params.metadata?.durationMs || 0));
          return {
            id: `chatcmpl-${turns}`,
            object: 'chat.completion',
            choices: [
              { index: 0, message: { role: 'assistant', content: 'Synthetische Antwort' } },
            ],
          };
        },
      },
    });
    await broker.start();
    const api = broker.getLocalService('api');
    for (const route of api.routes.filter((entry) => entry.opts.autoAliases))
      api.regenerateAutoAliases(route);
    base = `http://127.0.0.1:${api.server.address().port}`;
    gateway = (
      await provisionToken(
        {
          tenant: 'async-tenant',
          user: 'svc:synthetic',
          name: 'Gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org-async',
        },
        broker
      )
    ).data.token;
  });
  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });

  const post = (key, body, headers = {}) =>
    fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'X-CET-Parent-Message-Id': 'user-msg-1',
        ...headers,
      },
      body: JSON.stringify(body),
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
  const get = (route) =>
    fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${gateway}` } }).then(
      async (response) => ({
        status: response.status,
        body: await response.json(),
      })
    );
  const body = (durationMs) => ({
    model: 'cernion-governance-assistant',
    messages: [{ role: 'user', content: 'Anlage prüfen' }],
    metadata: { durationMs },
  });

  test('202 within the window, polling, one persisted answer, idempotent retries', async () => {
    const before = turns;
    const started = Date.now();
    const first = await post('turn-http-0001', body(4500));
    expect(Date.now() - started).toBeLessThan(4200);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: 'running', idempotencyKey: 'turn-http-0001' });
    const { jobId, requestId } = first.body;
    const poll = await get(`/v1/chat/jobs/${jobId}`);
    expect(poll).toMatchObject({ status: 200, body: { status: 'running', jobId, requestId } });
    const placeholder = await get(`/v1/chat/jobs/${jobId}/message`);
    expect(placeholder.body).toEqual({
      jobId,
      parent: 'user-msg-1',
      assistantCount: 1,
      done: false,
      content: '',
    });
    const retry = await post('turn-http-0001', body(4500));
    expect(retry).toMatchObject({ status: 202, body: { jobId, requestId, status: 'running' } });
    await later(2000);
    const done = await get(`/v1/chat/jobs/${jobId}`);
    expect(done.body).toMatchObject({
      status: 'completed',
      resultReference: `/v1/chat/jobs/${jobId}/message`,
    });
    const persisted = await get(`/v1/chat/jobs/${jobId}/message`);
    expect(persisted.body).toMatchObject({
      assistantCount: 1,
      done: true,
      content: 'Synthetische Antwort',
      parent: 'user-msg-1',
    });
    const replay = await post('turn-http-0001', body(4500));
    expect(replay).toMatchObject({ status: 200, body: { jobId, requestId, status: 'completed' } });
    expect(replay.body.choices[0].message.content).toBe('Synthetische Antwort');
    expect(turns - before).toBe(1);
  }, 20000);

  test('a short turn answers 200 directly; without a key the path is unchanged', async () => {
    expect((await post('turn-http-0002', body(10))).status).toBe(200);
    const plain = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body(10)),
    });
    expect(plain.status).toBe(200);
  });

  test('unknown or malformed job ids read as not found; a bad key is rejected', async () => {
    expect((await get('/v1/chat/jobs/123e4567-e89b-12d3-a456-426614174000')).status).toBe(404);
    expect((await post('bad key!', body(10))).status).toBe(400);
  });
});
