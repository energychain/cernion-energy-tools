const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SmokeFailure,
  createMockServer,
  runSmoke,
  validateChatCompletion,
  validateModels,
  validateOpenApi,
  validateReadOnlyToolResponse,
} = require('./smoke-test');

test('local smoke harness passes against safe in-process mocks', async () => {
  const result = await runSmoke({ useMocks: true });

  assert.match(result.bridgeBaseUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.match(result.toolserverBaseUrl, /^http:\/\/127\.0\.0\.1:/);
});

test('bridge shape failures identify OpenAI-compatible provider layer', () => {
  assert.throws(
    () => validateModels({ object: 'list', data: [{}] }),
    (err) => err instanceof SmokeFailure && err.layer === 'bridge-models-shape'
  );

  assert.throws(
    () => validateChatCompletion({ object: 'message', choices: [] }),
    (err) => err instanceof SmokeFailure && err.layer === 'bridge-chat-shape'
  );
});

test('toolserver shape failures identify spec and read-only tool layers', () => {
  assert.throws(
    () => validateOpenApi({ openapi: '2.0', paths: {} }),
    (err) => err instanceof SmokeFailure && err.layer === 'toolserver-openapi'
  );

  assert.throws(
    () => validateReadOnlyToolResponse({ status: 'ok' }),
    (err) => err instanceof SmokeFailure && err.layer === 'toolserver-read-only-tool-shape'
  );
});

test('external URL mode can target explicit bridge and toolserver bases', async () => {
  const bridge = await createMockServer('bridge');
  const toolserver = await createMockServer('toolserver');

  try {
    const result = await runSmoke({
      useMocks: false,
      bridgeBaseUrl: bridge.baseUrl,
      toolserverBaseUrl: toolserver.baseUrl,
    });

    assert.equal(result.bridgeBaseUrl, bridge.baseUrl);
    assert.equal(result.toolserverBaseUrl, toolserver.baseUrl);
  } finally {
    await Promise.all([bridge.close(), toolserver.close()]);
  }
});
