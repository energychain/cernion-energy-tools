'use strict';

const { ServiceBroker } = require('moleculer');
const { documentInput } = require('../src/workbench-document-input');
const { attachDocuments } = require('../src/workbench-document');

function schema(limit) {
  const previous = process.env.OPENAI_COMPAT_BODY_LIMIT;
  if (limit) process.env.OPENAI_COMPAT_BODY_LIMIT = limit;
  else delete process.env.OPENAI_COMPAT_BODY_LIMIT;
  let result;
  jest.isolateModules(() => {
    result = require('../services/api.service');
  });
  if (previous == null) delete process.env.OPENAI_COMPAT_BODY_LIMIT;
  else process.env.OPENAI_COMPAT_BODY_LIMIT = previous;
  return result;
}

async function start(limit) {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const apiSchema = schema(limit);
  const api = broker.createService({ ...apiSchema, settings: { ...apiSchema.settings, port: 0 } });
  api.logger.warn = jest.fn();
  broker.createService({
    name: 'token-manager',
    actions: {
      verify: () => ({
        valid: true,
        scope: 'full-access',
        tenantId: 'tenant-body-test',
        tokenId: 'synthetic-body-token',
      }),
    },
  });
  const receive = jest.fn((ctx) => ({ size: ctx.params.messages[0].content.length }));
  broker.createService({ name: 'openai-compatible', actions: { chatCompletions: receive } });
  await broker.start();
  return { broker, api, receive, base: `http://127.0.0.1:${api.server.address().port}` };
}

async function post(app, content, path = '/v1/chat/completions', form = false) {
  const body = form
    ? new URLSearchParams({ content }).toString()
    : JSON.stringify({ messages: [{ role: 'user', content }] });
  const response = await fetch(app.base + path, {
    method: 'POST',
    headers: {
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      Authorization: 'Bearer ck_synthetic_body_test',
    },
    body,
  });
  return { status: response.status, body: await response.json(), size: Buffer.byteLength(body) };
}

describe('OpenAI body limit through the real HTTP gateway', () => {
  let app;
  afterEach(async () => {
    if (app) await app.broker.stop();
    app = null;
  });

  test('default accepts a 5-MB JSON body intact and leaves other route limits unchanged', async () => {
    app = await start();
    const content = 'x'.repeat(5 * 1024 * 1024);
    const result = await post(app, content);
    expect(result.status).toBe(200);
    expect(result.body.size).toBe(content.length);
    const route = app.api.settings.routes.find((item) => item.path === '/api');
    expect(route.bodyParsers.json.limit).toBe('25MB');
    expect(route.bodyParsers.urlencoded.limit).toBe('25MB');
  });

  test('custom limit returns German OpenAI JSON and logs only size metadata', async () => {
    app = await start('2MB');
    const result = await post(app, 'SYNTHETIC_PRIVATE_MARKER'.repeat(140000));
    expect(result.status).toBe(413);
    expect(result.body.error).toEqual({
      message: expect.stringMatching(/zu groß.*2MB.*teile die Datei auf/),
      type: 'invalid_request_error',
      code: 'request_body_too_large',
    });
    expect(JSON.stringify(result.body)).not.toContain('SYNTHETIC_PRIVATE_MARKER');
    expect(app.receive).not.toHaveBeenCalled();
    expect(app.api.logger.warn).toHaveBeenCalledWith(expect.any(String), {
      sizeBytes: result.size,
      limitBytes: null,
      configuredLimit: '2MB',
    });
    expect(JSON.stringify(app.api.logger.warn.mock.calls)).not.toContain(
      'SYNTHETIC_PRIVATE_MARKER'
    );
  });

  test('custom limit also applies to URL-encoded bodies', async () => {
    app = await start('2MB');
    const result = await post(app, 'x'.repeat(3 * 1024 * 1024), '/v1/chat/completions', true);
    expect(result.status).toBe(413);
    expect(result.body.error.message).toMatch(/zu groß.*2MB/);
  });

  test('/api accepts a body above the configured /v1 limit, but still rejects above 25MB', async () => {
    app = await start('2MB');
    expect((await post(app, 'x'.repeat(3 * 1024 * 1024), '/api/tokens/verify')).status).toBe(200);
    const result = await post(app, 'x'.repeat(26 * 1024 * 1024), '/api/tokens/verify');
    expect(result.status).toBe(413);
    expect(result.body).not.toHaveProperty('error');
  });
});

describe('document admission budget', () => {
  let previous;
  beforeEach(() => {
    previous = process.env.WORKBENCH_DOCUMENT_MAX_CHARS;
    delete process.env.WORKBENCH_DOCUMENT_MAX_CHARS;
  });
  afterEach(() => {
    if (previous == null) delete process.env.WORKBENCH_DOCUMENT_MAX_CHARS;
    else process.env.WORKBENCH_DOCUMENT_MAX_CHARS = previous;
  });

  test('admits an annual quarter-hour CSV through parsing and attachment without truncation', async () => {
    const text = 'synthetic-time;synthetic-value;synthetic-unit\n'.repeat(35040);
    expect(text.length).toBeGreaterThan(1000000);
    const parsed = documentInput(
      `<context><source name="synthetic-load.csv">${text}</source></context><user_query>Bitte aufnehmen.</user_query>`
    );
    expect(parsed.documents[0].text).toBe(text);
    const store = { saveEvidence: jest.fn(async () => ({})) };
    await attachDocuments(
      store,
      { tenantId: 'tenant-body-test', actorId: 'person-test', caseId: 'case-test' },
      parsed.documents
    );
    expect(store.saveEvidence).toHaveBeenCalled();
  });

  test('still bounds the package and uses the configured limit in a German explanation', () => {
    expect(() =>
      documentInput(`<context><source>${'x'.repeat(4000001)}</source></context>`)
    ).toThrow(/4\.000\.000 Zeichen/);
    process.env.WORKBENCH_DOCUMENT_MAX_CHARS = '100';
    expect(() => documentInput(`<context><source>${'x'.repeat(101)}</source></context>`)).toThrow(
      /100 Zeichen/
    );
  });
});
