'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  UPSTREAM_PATH,
  buildOpenApiSpec,
  createToolServer,
  validateInput,
} = require('./cernion-openapi-tool-server');

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

test('OpenAPI exposes exactly one read-only evidence operation', () => {
  const spec = buildOpenApiSpec();
  assert.match(spec.openapi, /^3\./);
  assert.deepEqual(Object.keys(spec.paths), ['/tools/cernion-evidence-lookup']);
  const operations = Object.values(spec.paths).flatMap((path) =>
    Object.entries(path).filter(([method]) =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(method)
    )
  );
  assert.equal(operations.length, 1);
  const operation = spec.paths['/tools/cernion-evidence-lookup'].post;
  assert.equal(operation.operationId, 'cernionEvidenceLookup');
  assert.equal(operation.readOnly, true);
  assert.equal(operation['x-cernion-side-effects'], 'none');
});

test('health reports only configured or missing state and never the credential', async () => {
  const secret = 'never-return-this-token';
  const server = await listen(
    createToolServer({
      baseUrl: 'https://cernion.example',
      token: secret,
      fetchImpl: async () => jsonResponse({}),
    })
  );
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/health');
    assert.equal(response.status, 200);
    assert.equal(body.configuration.baseUrl, 'configured');
    assert.equal(body.configuration.token, 'configured');
    assert.equal(body.readOnly, true);
    assert.equal(body.sideEffects, 'none');
    assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  } finally {
    await server.close();
  }
});

test('bounded input validation rejects invalid requests before any upstream call', async () => {
  let calls = 0;
  const server = await listen(
    createToolServer({
      baseUrl: 'https://cernion.example',
      token: 'test-token',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({});
      },
    })
  );
  try {
    for (const body of [
      {},
      { question: '   ' },
      { question: 'ok', unexpected: true },
      { question: 'x'.repeat(4001) },
      { question: 'ok', context: [] },
      { question: 'ok', tenantId: '' },
    ]) {
      const result = await jsonRequest(server.baseUrl, '/tools/cernion-evidence-lookup', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      assert.equal(result.response.status, 400);
      assert.equal(result.body.readOnly, true);
      assert.equal(result.body.sideEffects, 'none');
    }
    assert.equal(calls, 0);
    assert.equal(validateInput({ question: ' valid ' }).value.question, 'valid');
  } finally {
    await server.close();
  }
});

test('missing configuration fails safely without leaking request or token material', async () => {
  const server = await listen(createToolServer({ baseUrl: '', token: '' }));
  try {
    const marker = 'private-question-marker';
    const { response, body } = await jsonRequest(server.baseUrl, '/tools/cernion-evidence-lookup', {
      method: 'POST',
      body: JSON.stringify({ question: marker }),
    });
    assert.equal(response.status, 503);
    assert.equal(body.error, 'sidecar_base_url_missing');
    assert.doesNotMatch(JSON.stringify(body), new RegExp(marker));
  } finally {
    await server.close();
  }
});

test('success calls only the fixed Answer Dossier URL and preserves dossier metadata', async () => {
  const calls = [];
  const secret = 'readonly-secret-value';
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      success: true,
      safetyClass: 'advisory_reasoning',
      sideEffects: 'none',
      structuredContent: {
        answer: 'Grid evidence is incomplete.',
        evidence: [{ value: 'scalar fact', sourceRef: 'source:1' }],
        routingConfidence: 0.82,
        traceId: 'trace-426',
        turnId: 'turn-1',
        dossierId: 'dossier-1',
        positiveFollowUps: [
          {
            missingDataPoint: 'connection_capacity',
            enablesDossierAddition: 'adds operator-confirmed capacity evidence',
          },
        ],
        guardrails: ['advisory only'],
        sourceActions: { notCalled: ['process-intake.prepare', 'database.query'] },
        advisoryPlan: { method: 'GET', path: '/api/example' },
        bearerToken: secret,
      },
    });
  };
  const server = await listen(
    createToolServer({ baseUrl: 'https://cernion.example/root/', token: secret, fetchImpl })
  );
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/tools/cernion-evidence-lookup', {
      method: 'POST',
      body: JSON.stringify({
        question: 'What evidence is available?',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        domain: 'grid',
        context: { location: 'Sinsheim' },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://cernion.example/root${UPSTREAM_PATH}`);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      input: {
        question: 'What evidence is available?',
        tenantId: 'tenant-1',
        sessionId: 'session-1',
        domain: 'grid',
        context: { location: 'Sinsheim' },
      },
    });
    assert.equal(calls[0].options.headers.authorization, `Bearer ${secret}`);
    assert.equal(body.answer, 'Grid evidence is incomplete.');
    assert.deepEqual(body.evidence, [{ value: 'scalar fact', sourceRef: 'source:1' }]);
    assert.equal(body.confidence, 0.82);
    assert.deepEqual(body.trace, {
      turnId: 'turn-1',
      traceId: 'trace-426',
      dossierId: 'dossier-1',
    });
    assert.deepEqual(body.followups[0], {
      missingDataPoint: 'connection_capacity',
      enablesDossierAddition: 'adds operator-confirmed capacity evidence',
    });
    assert.deepEqual(body.guardrails, ['advisory only']);
    assert.deepEqual(body.notCalled, ['process-intake.prepare', 'database.query']);
    assert.deepEqual(body.structuredContent.advisoryPlan, { method: 'GET', path: '/api/example' });
    assert.equal(body.readOnly, true);
    assert.equal(body.sideEffects, 'none');
    assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  } finally {
    await server.close();
  }
});

for (const status of [401, 403]) {
  test(`upstream ${status} returns bounded credential guidance without broader-scope retry`, async () => {
    let calls = 0;
    const secret = `secret-${status}`;
    const server = await listen(
      createToolServer({
        baseUrl: 'https://cernion.example',
        token: secret,
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ error: 'rejected', detail: secret }, status);
        },
      })
    );
    try {
      const { response, body } = await jsonRequest(
        server.baseUrl,
        '/tools/cernion-evidence-lookup',
        {
          method: 'POST',
          body: JSON.stringify({ question: 'read only question' }),
        }
      );
      assert.equal(response.status, 502);
      assert.equal(body.error, 'upstream_authorization_failed');
      assert.match(body.recovery, /read-only credential/);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
      assert.equal(calls, 1);
    } finally {
      await server.close();
    }
  });
}

test('upstream timeout fails closed with no alternate call', async () => {
  let calls = 0;
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  const server = await listen(
    createToolServer({
      baseUrl: 'https://cernion.example',
      token: 'test-token',
      fetchImpl,
      timeoutMs: 10,
    })
  );
  try {
    const { response, body } = await jsonRequest(server.baseUrl, '/tools/cernion-evidence-lookup', {
      method: 'POST',
      body: JSON.stringify({ question: 'read only question' }),
    });
    assert.equal(response.status, 504);
    assert.equal(body.error, 'upstream_timeout');
    assert.equal(body.readOnly, true);
    assert.equal(body.sideEffects, 'none');
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});
