'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConfigFromEnv,
  createBridgeServer,
  createTurnState,
} = require('./cernion-sidecar-bridge');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completeConfig(overrides = {}) {
  return {
    manifestUrl: 'https://sidecar.example/session/manifest.json',
    askUrl: 'https://sidecar.example/session/ask',
    planUrl: 'https://sidecar.example/session/plan',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    modelId: 'cernion-dev-sidecar',
    token: 'secret-token',
    ...overrides,
  };
}

test('buildConfigFromEnv reads and bounds runtime configuration without logging secrets', () => {
  const config = buildConfigFromEnv({
    CERNION_OPEN_WEBUI_BRIDGE_PORT: 'invalid',
    CERNION_SIDECAR_MANIFEST_URL: 'https://sidecar.example/manifest',
    CERNION_SIDECAR_ASK_URL: 'https://sidecar.example/ask',
    CERNION_SIDECAR_PLAN_URL: 'https://sidecar.example/plan',
    CERNION_SIDECAR_EXPIRES_AT: '2999-01-01T00:00:00.000Z',
    CERNION_OPEN_WEBUI_MODEL_ID: 'cernion-dev',
    CERNION_SIDECAR_TOKEN: 'do-not-leak',
    CERNION_OPEN_WEBUI_TURN_STATE_MAX_ENTRIES: '999999',
    CERNION_OPEN_WEBUI_TURN_STATE_TTL_MS: '500',
  });

  assert.equal(config.port, 8087);
  assert.equal(config.manifestUrl, 'https://sidecar.example/manifest');
  assert.equal(config.askUrl, 'https://sidecar.example/ask');
  assert.equal(config.planUrl, 'https://sidecar.example/plan');
  assert.equal(config.expiresAt, '2999-01-01T00:00:00.000Z');
  assert.equal(config.modelId, 'cernion-dev');
  assert.equal(config.token, 'do-not-leak');
  assert.equal(config.turnStateMaxEntries, 10_000);
  assert.equal(config.turnStateTtlMs, 1_000);
});

test('health reports missing configuration without exposing credentials', async () => {
  const server = await listen(createBridgeServer({ token: 'never-return-this' }));
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/health');
    assert.equal(response.status, 503);
    assert.equal(body.status, 'misconfigured');
    assert.deepEqual(body.missing.sort(), ['askUrl', 'expiresAt', 'manifestUrl', 'planUrl']);
    assert.equal(body.configuration.token, 'configured');
    assert.doesNotMatch(JSON.stringify(body), /never-return-this/);
  } finally {
    await server.close();
  }
});

test('expired sessions return HTTP 410 before any upstream Sidecar call', async () => {
  let calls = 0;
  const server = await listen(
    createBridgeServer({
      ...completeConfig({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ answer: 'should not be called' });
      },
    })
  );
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'cernion-dev-sidecar',
        messages: [{ role: 'user', content: 'Hallo' }],
      }),
    });
    assert.equal(response.status, 410);
    assert.equal(body.error.type, 'sidecar_session_expired');
    assert.match(body.error.message, /new Sidecar session/i);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('conversation turn state is isolated per Open WebUI conversation id', async () => {
  const calls = [];
  const server = await listen(
    createBridgeServer({
      ...completeConfig(),
      fetchImpl: async (url, options) => {
        const payload = JSON.parse(options.body);
        calls.push({ url, payload });
        return jsonResponse({ answer: `answer-${calls.length}`, turnId: `turn-${calls.length}` });
      },
    })
  );
  try {
    for (const conversationId of ['chat-a', 'chat-b', 'chat-a']) {
      const result = await jsonRequest(server.baseUrl, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'cernion-dev-sidecar',
          metadata: { chat_id: conversationId },
          messages: [{ role: 'user', content: `Question for ${conversationId}` }],
        }),
      });
      assert.equal(result.response.status, 200);
    }

    assert.equal(calls.length, 3);
    assert.equal(calls[0].payload.parentTurnId, undefined);
    assert.equal(calls[1].payload.parentTurnId, undefined);
    assert.equal(calls[2].payload.parentTurnId, 'turn-1');
  } finally {
    await server.close();
  }
});

test('transport routing is explicit and plan uses the Sidecar {task} contract', async () => {
  const calls = [];
  const server = await listen(
    createBridgeServer({
      ...completeConfig(),
      fetchImpl: async (url, options) => {
        calls.push({ url, payload: JSON.parse(options.body) });
        return jsonResponse({ answer: 'ok', turnId: `turn-${calls.length}` });
      },
    })
  );
  try {
    const question = 'Bitte erstelle einen Plan für die Zielnetzplanung';
    await jsonRequest(server.baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'cernion-dev-sidecar',
        messages: [{ role: 'user', content: question }],
      }),
    });
    await jsonRequest(server.baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'cernion-dev-sidecar',
        metadata: { sidecarMode: 'plan' },
        messages: [{ role: 'user', content: question }],
      }),
    });

    assert.deepEqual(calls[0], {
      url: 'https://sidecar.example/session/ask',
      payload: { question },
    });
    assert.deepEqual(calls[1], {
      url: 'https://sidecar.example/session/plan',
      payload: { task: question },
    });
  } finally {
    await server.close();
  }
});

test('requests without a conversation id never share implicit turn state', async () => {
  const payloads = [];
  const server = await listen(
    createBridgeServer({
      ...completeConfig(),
      fetchImpl: async (_url, options) => {
        payloads.push(JSON.parse(options.body));
        return jsonResponse({ answer: 'ok', turnId: `turn-${payloads.length}` });
      },
    })
  );
  try {
    for (const question of ['First anonymous chat', 'Different anonymous chat']) {
      const result = await jsonRequest(server.baseUrl, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: question }],
        }),
      });
      assert.equal(result.response.status, 200);
    }

    assert.deepEqual(payloads, [
      { question: 'First anonymous chat' },
      { question: 'Different anonymous chat' },
    ]);
  } finally {
    await server.close();
  }
});

test('turn state expires by TTL and evicts the least-recently-used conversation', () => {
  let now = 1_000;
  const state = createTurnState({ maxEntries: 2, ttlMs: 100, now: () => now });

  state.set('chat-a', 'turn-a');
  state.set('chat-b', 'turn-b');
  assert.equal(state.get('chat-a'), 'turn-a');
  state.set('chat-c', 'turn-c');

  assert.equal(state.get('chat-b'), undefined);
  assert.equal(state.get('chat-a'), 'turn-a');
  assert.equal(state.get('chat-c'), 'turn-c');
  assert.equal(state.size, 2);

  now += 101;
  assert.equal(state.get('chat-a'), undefined);
  assert.equal(state.get('chat-c'), undefined);
  assert.equal(state.size, 0);
});

test('invalid explicit transport mode fails before any upstream call', async () => {
  let calls = 0;
  const server = await listen(
    createBridgeServer({
      ...completeConfig(),
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ answer: 'unexpected' });
      },
    })
  );
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        metadata: { sidecarMode: 'automatic' },
        messages: [{ role: 'user', content: 'Question' }],
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(body.error.type, 'invalid_request_error');
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('upstream session and authorization failures preserve safe status semantics', async () => {
  for (const [status, type] of [
    [410, 'sidecar_session_expired'],
    [401, 'sidecar_authentication_error'],
    [403, 'sidecar_authorization_error'],
  ]) {
    const server = await listen(
      createBridgeServer({
        ...completeConfig(),
        fetchImpl: async () => jsonResponse({ detail: `private-upstream-${status}` }, status),
      })
    );
    try {
      const { response, body } = await jsonRequest(server.baseUrl, '/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Question' }] }),
      });
      assert.equal(response.status, status);
      assert.equal(body.error.type, type);
      assert.doesNotMatch(JSON.stringify(body), /private-upstream/);
    } finally {
      await server.close();
    }
  }
});
