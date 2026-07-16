'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConfigFromEnv,
  createBridgeServer,
  isPlanningRequest,
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

test('buildConfigFromEnv reads runtime session URLs, model id and expiry without logging secrets', () => {
  const config = buildConfigFromEnv({
    CERNION_SIDECAR_MANIFEST_URL: 'https://sidecar.example/manifest',
    CERNION_SIDECAR_ASK_URL: 'https://sidecar.example/ask',
    CERNION_SIDECAR_PLAN_URL: 'https://sidecar.example/plan',
    CERNION_SIDECAR_EXPIRES_AT: '2999-01-01T00:00:00.000Z',
    CERNION_OPEN_WEBUI_MODEL_ID: 'cernion-dev',
    CERNION_SIDECAR_TOKEN: 'do-not-leak',
  });

  assert.equal(config.manifestUrl, 'https://sidecar.example/manifest');
  assert.equal(config.askUrl, 'https://sidecar.example/ask');
  assert.equal(config.planUrl, 'https://sidecar.example/plan');
  assert.equal(config.expiresAt, '2999-01-01T00:00:00.000Z');
  assert.equal(config.modelId, 'cernion-dev');
  assert.equal(config.token, 'do-not-leak');
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

test('ask/plan routing uses explicit planning terms and does not misroute Zielnetzplanung', async () => {
  assert.equal(isPlanningRequest('Bitte erstelle einen Plan für die Prüfung'), true);
  assert.equal(isPlanningRequest('Was ist bei Zielnetzplanung fachlich zu beachten?'), false);

  const calls = [];
  const server = await listen(
    createBridgeServer({
      ...completeConfig(),
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse({ answer: 'ok', turnId: `turn-${calls.length}` });
      },
    })
  );
  try {
    await jsonRequest(server.baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'cernion-dev-sidecar',
        messages: [{ role: 'user', content: 'Was ist bei Zielnetzplanung fachlich zu beachten?' }],
      }),
    });
    await jsonRequest(server.baseUrl, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'cernion-dev-sidecar',
        metadata: { sidecarMode: 'plan' },
        messages: [{ role: 'user', content: 'Was ist bei Zielnetzplanung fachlich zu beachten?' }],
      }),
    });

    assert.equal(calls[0], 'https://sidecar.example/session/ask');
    assert.equal(calls[1], 'https://sidecar.example/session/plan');
  } finally {
    await server.close();
  }
});
