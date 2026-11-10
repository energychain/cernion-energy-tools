'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createAssistantApi } = require('../lib/assistant-api');
const { createSessionAuth } = require('../lib/session-auth');

function req(method, pathname, body, headers = {}) {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  stream.method = method;
  stream.url = pathname;
  stream.headers = {
    host: 'cockpit.test',
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  };
  stream.socket = { remoteAddress: '127.0.0.1', encrypted: true };
  stream.authIdentity = headers.authIdentity || 'validated-session';
  return stream;
}

function serviceFixture() {
  const calls = [];
  return {
    calls,
    createConversation(input) {
      calls.push(['create', input]);
      return { id: 'conversation_11111111-1111-4111-8111-111111111111', ...input };
    },
    listConversations() {
      return [{ id: 'conversation_11111111-1111-4111-8111-111111111111' }];
    },
    listMessages() {
      return { items: [{ id: 'message_1', role: 'user', content: 'hi' }], nextCursor: null };
    },
    submitMessage(input) {
      calls.push(['message', input]);
      return {
        id: 'run_11111111-1111-4111-8111-111111111111',
        status: 'accepted',
        userMessageId: 'message_1',
      };
    },
    getRun() {
      return { id: 'run_11111111-1111-4111-8111-111111111111', status: 'completed' };
    },
  };
}

async function handle(api, request) {
  return api.handle(request, new URL(request.url, 'https://cockpit.test'));
}

test('disabled API exposes sanitized config only and all assistant routes return 404', async () => {
  const api = createAssistantApi({
    config: {
      enabled: false,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
      transport: { executable: '/secret', profile: 'rhajaina' },
    },
    service: serviceFixture(),
  });
  const config = await handle(api, req('GET', '/api/assistant/config'));
  assert.equal(config.status, 200);
  assert.equal(config.body.enabled, false);
  assert.doesNotMatch(JSON.stringify(config.body), /transport|executable|profile|secret/i);
  assert.equal((await handle(api, req('GET', '/api/assistant/conversations'))).status, 404);
});

test('supports conversation/message pagination and polling contract with strict browser payload', async () => {
  const service = serviceFixture();
  const api = createAssistantApi({
    config: {
      enabled: true,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
    },
    service,
  });
  const created = await handle(
    api,
    req(
      'POST',
      '/api/assistant/conversations',
      { context: { objectType: 'topic', objectId: 'topic_1' } },
      { origin: 'https://cockpit.test' }
    )
  );
  assert.equal(created.status, 201);
  const conversationId = created.body.id;
  const posted = await handle(
    api,
    req(
      'POST',
      `/api/assistant/conversations/${conversationId}/messages`,
      { text: 'Hallo', clientMessageId: '55555555-5555-4555-8555-555555555555' },
      { origin: 'https://cockpit.test' }
    )
  );
  assert.equal(posted.status, 202);
  assert.deepEqual(service.calls[1][1], {
    conversationId,
    text: 'Hallo',
    clientMessageId: '55555555-5555-4555-8555-555555555555',
  });
  assert.equal(
    (
      await handle(
        api,
        req('GET', `/api/assistant/conversations/${conversationId}/messages?limit=20`)
      )
    ).status,
    200
  );
  assert.equal(
    (await handle(api, req('GET', '/api/assistant/runs/run_11111111-1111-4111-8111-111111111111')))
      .status,
    200
  );
});

test('polling GET routes do not consume the mutation rate bucket', async () => {
  const service = serviceFixture();
  const api = createAssistantApi({
    config: {
      enabled: true,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
    },
    service,
    rateLimit: { windowMs: 120000, max: 1 },
  });
  for (let second = 0; second < 120; second += 1) {
    const response = await handle(
      api,
      req('GET', '/api/assistant/runs/run_11111111-1111-4111-8111-111111111111')
    );
    assert.equal(response.status, 200, `poll ${second + 1}`);
  }
  const first = await handle(
    api,
    req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test' }
    )
  );
  const second = await handle(
    api,
    req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test' }
    )
  );
  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
});

test('authenticated identity cannot bypass mutation rate limiting by changing cookies', async () => {
  const api = createAssistantApi({
    config: {
      enabled: true,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
    },
    service: serviceFixture(),
    rateLimit: { windowMs: 60000, max: 1 },
  });
  const mutate = (cookie) => {
    const request = req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test', cookie }
    );
    request.authIdentity = 'authenticated-user-1';
    return handle(api, request);
  };

  assert.equal((await mutate('irrelevant=a')).status, 201);
  assert.equal((await mutate('irrelevant=b; another=value')).status, 429);
  assert.equal(api.bucketCount(), 1);
});

test('a second valid bootstrap session from the production auth realm does not reset rate limiting', async () => {
  let nonce = 0;
  const auth = createSessionAuth({
    staticToken: 'production-wiring-secret',
    randomBytes: () => Buffer.alloc(18, ++nonce),
  });
  const api = createAssistantApi({
    config: {
      enabled: true,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
    },
    service: serviceFixture(),
    rateLimit: { windowMs: 60000, max: 1 },
  });
  const mutate = async () => {
    const session = auth.createSession();
    const request = req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      {
        origin: 'https://cockpit.test',
        cookie: `${auth.cookieName}=${session}`,
      }
    );
    request.authIdentity = auth.authorize(request).identity;
    return handle(api, request);
  };
  assert.equal((await mutate()).status, 201);
  assert.equal((await mutate()).status, 429);
  assert.equal(api.bucketCount(), 1);
});

test('rate buckets expire and remain capped under distinct authenticated identities', async () => {
  let now = 1000;
  const api = createAssistantApi({
    config: {
      enabled: true,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
    },
    service: serviceFixture(),
    rateLimit: { windowMs: 100, max: 1, maxBuckets: 2, now: () => now },
  });
  const mutate = (identity) => {
    const request = req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test' }
    );
    request.authIdentity = identity;
    return handle(api, request);
  };

  assert.equal((await mutate('one')).status, 201);
  now += 1;
  assert.equal((await mutate('two')).status, 201);
  now += 1;
  assert.equal((await mutate('three')).status, 201);
  assert.equal(api.bucketCount(), 2);
  assert.equal((await mutate('one')).status, 201, 'oldest bucket was evicted at capacity');
  assert.equal(api.bucketCount(), 2);

  now += 100;
  assert.equal((await mutate('four')).status, 201);
  assert.equal(api.bucketCount(), 1, 'expired buckets were removed before insertion');
});

test('same-origin requires matching protocol and host', async () => {
  const api = createAssistantApi({
    config: {
      enabled: true,
      mode: 'read_only',
      writesEnabled: false,
      matrixHandoffEnabled: false,
      limits: { maxMessageChars: 4000, maxContextChars: 12000 },
    },
    service: serviceFixture(),
  });
  for (const origin of ['http://cockpit.test', 'https://other.test']) {
    const response = await handle(
      api,
      req('POST', '/api/assistant/conversations', { context: null }, { origin })
    );
    assert.equal(response.status, 403, origin);
  }
  const valid = await handle(
    api,
    req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test' }
    )
  );
  assert.equal(valid.status, 201);
});

test('rejects non-JSON, cross-origin, oversized, malformed IDs, rate excess, and absent write routes', async () => {
  const service = serviceFixture();
  const config = {
    enabled: true,
    mode: 'read_only',
    writesEnabled: false,
    matrixHandoffEnabled: false,
    limits: { maxMessageChars: 8, maxContextChars: 12000 },
  };
  const api = createAssistantApi({ config, service, rateLimit: { windowMs: 60000, max: 1 } });
  assert.equal(
    (
      await handle(
        api,
        req('POST', '/api/assistant/conversations', {}, { origin: 'https://evil.test' })
      )
    ).status,
    403
  );
  assert.equal(
    (
      await handle(
        api,
        req('POST', '/api/assistant/conversations', undefined, {
          origin: 'https://cockpit.test',
          'content-type': 'text/plain',
        })
      )
    ).status,
    415
  );
  assert.equal((await handle(api, req('GET', '/api/assistant/runs/not-a-valid-id'))).status, 400);
  assert.equal(
    (await handle(api, req('POST', '/api/assistant/write', {}, { origin: 'https://cockpit.test' })))
      .status,
    404
  );
  const first = await handle(
    api,
    req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test' }
    )
  );
  const second = await handle(
    api,
    req(
      'POST',
      '/api/assistant/conversations',
      { context: null },
      { origin: 'https://cockpit.test' }
    )
  );
  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
});
