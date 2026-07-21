'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FORBIDDEN_ACTIONS,
  NOT_CALLED,
  UPSTREAM_PATH,
  buildOpenApiSpec,
  createToolServer,
  validateInput,
} = require('./cernion-process-intake-tool-server');

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

const VALID_REQUEST = {
  operationFamily: 'customer_master_data_correction',
  proposedAction: 'correct_metering_point_address',
  targetType: 'meteringPoint',
  targetId: 'MP-12345',
  inputSummary: 'Straßenname im Stammdatensatz korrigieren',
  payload: { field: 'street', newValue: 'Musterstraße 1' },
  risk: 'low',
  reason: 'Kundenanfrage: Tippfehler in der Adresse',
  correlationId: 'req-2026-427',
};

test('OpenAPI is explicit about draft-only, HITL-required, non-consequential semantics', () => {
  const spec = buildOpenApiSpec();
  assert.match(spec.openapi, /^3\./);
  assert.deepEqual(Object.keys(spec.paths), ['/tools/cernion-process-intake-draft']);
  const operations = Object.values(spec.paths).flatMap((path) =>
    Object.entries(path).filter(([method]) =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(method)
    )
  );
  assert.equal(operations.length, 1);
  const operation = spec.paths['/tools/cernion-process-intake-draft'].post;
  assert.equal(operation.operationId, 'cernionProcessIntakeDraft');
  assert.equal(operation['x-openai-isConsequential'], false);
  assert.equal(operation['x-cernion-draft-only'], true);
  assert.equal(operation['x-cernion-hitl-required'], true);
  assert.match(operation.description, /never executes/i);
  const successSchema = operation.responses[200].content['application/json'].schema;
  assert.deepEqual(successSchema.properties.draftOnly.enum, [true]);
  assert.deepEqual(successSchema.properties.hitlRequired.enum, [true]);
  assert.deepEqual(successSchema.properties.policyStatus.enum, ['pending_human_confirmation']);
});

test('health reports only configured or missing state and never the credential', async () => {
  const secret = 'never-return-this-process-token';
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
    assert.equal(body.draftOnly, true);
    assert.equal(body.hitlRequired, true);
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
    const invalidBodies = [
      {},
      { operationFamily: '  ' },
      { operationFamily: 'x', proposedAction: '  ' },
      { operationFamily: 'x', proposedAction: 'y', unexpected: true },
      {
        operationFamily: 'x'.repeat(65),
        proposedAction: 'y',
      },
      { operationFamily: 'x', proposedAction: 'y'.repeat(201) },
      { operationFamily: 'x', proposedAction: 'y', payload: [] },
      { operationFamily: 'x', proposedAction: 'y', payload: { a: 'b'.repeat(13 * 1024) } },
      { operationFamily: 'x', proposedAction: 'y', risk: 'critical' },
      { operationFamily: 'x', proposedAction: 'y', targetType: '' },
      // credential-like content is rejected as invalid input, not forwarded upstream
      {
        operationFamily: 'x',
        proposedAction: 'y',
        payload: { apiToken: 'sk-should-not-be-here' },
      },
      {
        operationFamily: 'x',
        proposedAction: 'y',
        payload: { nested: { credentials: { password: 'hunter2' } } },
      },
    ];
    for (const body of invalidBodies) {
      const result = await jsonRequest(server.baseUrl, '/tools/cernion-process-intake-draft', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      assert.equal(result.response.status, 400, JSON.stringify(body));
      assert.equal(result.body.draftOnly, true);
      assert.equal(result.body.hitlRequired, true);
    }
    assert.equal(calls, 0);
    assert.equal(
      validateInput({ operationFamily: 'a', proposedAction: 'b' }).value.operationFamily,
      'a'
    );
  } finally {
    await server.close();
  }
});

test('consequential-action language is rejected before any upstream call', async () => {
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
    const consequentialBodies = [
      { operationFamily: 'x', proposedAction: 'execute_the_change' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'please approve this immediately' },
      { operationFamily: 'x', proposedAction: 'y', inputSummary: 'auto-confirm and proceed' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'get the contract signed' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'delete the old record' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'send the customer a notice' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'publish the update' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'dispatch the field technician' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'settle the outstanding balance' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'bill the customer now' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'mutate the tariff for this account' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'control the device remotely' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'emit a webhook on completion' },
      { operationFamily: 'x', proposedAction: 'y', reason: 'invoke the external connector' },
      { operationFamily: 'x', proposedAction: 'y', payload: { note: 'please execute now' } },
    ];
    for (const body of consequentialBodies) {
      const result = await jsonRequest(server.baseUrl, '/tools/cernion-process-intake-draft', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      assert.equal(result.response.status, 403, JSON.stringify(body));
      assert.equal(result.body.error, 'consequential_action_rejected');
      assert.equal(result.body.draftOnly, true);
      assert.equal(result.body.hitlRequired, true);
    }
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('missing configuration fails safely without leaking request or token material', async () => {
  const server = await listen(createToolServer({ baseUrl: '', token: '' }));
  try {
    const { response, body } = await jsonRequest(
      server.baseUrl,
      '/tools/cernion-process-intake-draft',
      {
        method: 'POST',
        body: JSON.stringify(VALID_REQUEST),
      }
    );
    assert.equal(response.status, 503);
    assert.equal(body.error, 'process_intake_base_url_missing');
    assert.doesNotMatch(JSON.stringify(body), new RegExp(VALID_REQUEST.correlationId));
  } finally {
    await server.close();
  }
});

test('missing token fails safely with no upstream call', async () => {
  let calls = 0;
  const server = await listen(
    createToolServer({
      baseUrl: 'https://cernion.example',
      token: '',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({});
      },
    })
  );
  try {
    const { response, body } = await jsonRequest(
      server.baseUrl,
      '/tools/cernion-process-intake-draft',
      {
        method: 'POST',
        body: JSON.stringify(VALID_REQUEST),
      }
    );
    assert.equal(response.status, 503);
    assert.equal(body.error, 'process_token_missing');
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test('success calls exactly the fixed Process Intake URL with a bounded payload and normalizes the receipt', async () => {
  const calls = [];
  const secret = 'process-secret-value';
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      success: true,
      resolved: { kind: 'process_intake', source: 'process_intent_store' },
      receipt: {
        intentId: 'intent-abc-123',
        operationFamily: VALID_REQUEST.operationFamily,
        proposedAction: VALID_REQUEST.proposedAction,
        status: 'pending_confirmation',
        requiresHumanConfirmation: true,
        expiresAt: '2026-07-17T00:00:00.000Z',
      },
      policy: {
        readOnly: false,
        sideEffects: 'pending_human_confirmation',
        tenantScoped: true,
        externalSideEffects: false,
        hitlRequired: true,
      },
      executeVia: {
        operationId: 'executeProcessIntent',
        note: 'Not available via Copilot/Sidecar. A human must execute or reject this intent via the direct API.',
        bearerToken: secret,
      },
      auditTrail: {
        requestedAt: '2026-07-16T12:00:00.000Z',
        requestedBy: 'copilot-agent',
        correlationId: VALID_REQUEST.correlationId,
      },
    });
  };
  const server = await listen(
    createToolServer({ baseUrl: 'https://cernion.example/root/', token: secret, fetchImpl })
  );
  try {
    const { response, body } = await jsonRequest(
      server.baseUrl,
      '/tools/cernion-process-intake-draft',
      {
        method: 'POST',
        body: JSON.stringify(VALID_REQUEST),
      }
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://cernion.example/root${UPSTREAM_PATH}`);
    assert.equal(calls[0].options.headers.authorization, `Bearer ${secret}`);
    const sentBody = JSON.parse(calls[0].options.body);
    assert.equal(sentBody.operationFamily, VALID_REQUEST.operationFamily);
    assert.equal(sentBody.proposedAction, VALID_REQUEST.proposedAction);
    assert.deepEqual(sentBody.payload, VALID_REQUEST.payload);

    assert.equal(body.draftOnly, true);
    assert.equal(body.hitlRequired, true);
    assert.equal(body.policyStatus, 'pending_human_confirmation');
    assert.deepEqual(body.acceptedIntent.payload, VALID_REQUEST.payload);
    assert.equal(body.receipt.intentId, 'intent-abc-123');
    assert.equal(body.receipt.status, 'pending_confirmation');
    assert.equal(body.receipt.expiresAt, '2026-07-17T00:00:00.000Z');
    assert.deepEqual(body.forbiddenActions, FORBIDDEN_ACTIONS);
    assert.deepEqual(body.notCalled, NOT_CALLED);
    assert.ok(Array.isArray(body.allowedNextActions) && body.allowedNextActions.length > 0);
    assert.equal(body.executeVia.operationId, 'executeProcessIntent');
    assert.match(body.executeVia.note, /informational only/i);
    assert.equal(body.auditContext.correlationId, VALID_REQUEST.correlationId);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  } finally {
    await server.close();
  }
});

test('upstream policy rejection (409) normalizes without leaking credentials', async () => {
  let calls = 0;
  const secret = 'rejected-secret-value';
  const server = await listen(
    createToolServer({
      baseUrl: 'https://cernion.example',
      token: secret,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(
          {
            name: 'MoleculerClientError',
            message:
              'operationFamily "vdmi" is reserved for a dedicated, validated prepare* action.',
            code: 409,
            type: 'PROCESS_INTAKE_RESERVED_OPERATION_FAMILY',
            data: { operationFamily: 'vdmi', token: secret },
          },
          409
        );
      },
    })
  );
  try {
    const { response, body } = await jsonRequest(
      server.baseUrl,
      '/tools/cernion-process-intake-draft',
      {
        method: 'POST',
        body: JSON.stringify({ ...VALID_REQUEST, operationFamily: 'vdmi' }),
      }
    );
    assert.equal(response.status, 409);
    assert.equal(body.error, 'upstream_policy_rejected');
    assert.equal(body.policyStatus, 'rejected_by_policy');
    assert.deepEqual(body.notCalled, NOT_CALLED);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
    assert.equal(calls, 1);
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
        '/tools/cernion-process-intake-draft',
        {
          method: 'POST',
          body: JSON.stringify(VALID_REQUEST),
        }
      );
      assert.equal(response.status, 502);
      assert.equal(body.error, 'upstream_authorization_failed');
      assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
      assert.equal(calls, 1);
    } finally {
      await server.close();
    }
  });
}

test('upstream timeout fails closed with exactly one attempt and no fallback', async () => {
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
    const { response, body } = await jsonRequest(
      server.baseUrl,
      '/tools/cernion-process-intake-draft',
      {
        method: 'POST',
        body: JSON.stringify(VALID_REQUEST),
      }
    );
    assert.equal(response.status, 504);
    assert.equal(body.error, 'upstream_timeout');
    assert.equal(body.draftOnly, true);
    assert.equal(body.hitlRequired, true);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});
