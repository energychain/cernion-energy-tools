#!/usr/bin/env node

const http = require('node:http');

const DEFAULT_MODEL = 'cernion-agent-mvp';

class SmokeFailure extends Error {
  constructor(layer, message, details) {
    super(`[${layer}] ${message}`);
    this.name = 'SmokeFailure';
    this.layer = layer;
    this.details = details;
  }
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function fetchJson(layer, url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (err) {
    throw new SmokeFailure(layer, `Backend reachability failed for ${url}: ${err.message}`);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new SmokeFailure(
      layer,
      `Expected JSON from ${url}, got ${response.status}: ${text.slice(0, 160)}`
    );
  }

  if (!response.ok) {
    throw new SmokeFailure(layer, `Expected 2xx from ${url}, got ${response.status}`, body);
  }

  return body;
}

function assertObject(layer, value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SmokeFailure(layer, `${label} must be a JSON object`, value);
  }
}

function validateHealth(layer, body) {
  assertObject(layer, body, 'health response');
  const status = body.status || body.ok || body.healthy;
  if (status === false || status === 'error' || status === 'failed' || status === 'unhealthy') {
    throw new SmokeFailure(layer, 'health response reported an unhealthy status', body);
  }
}

function validateModels(body) {
  assertObject('bridge-models-shape', body, 'models response');
  if (body.object !== 'list') {
    throw new SmokeFailure(
      'bridge-models-shape',
      'models response must use OpenAI list shape',
      body
    );
  }
  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new SmokeFailure(
      'bridge-models-shape',
      'models response must include a non-empty data array',
      body
    );
  }
  for (const model of body.data) {
    if (!model || typeof model.id !== 'string' || !model.id.trim()) {
      throw new SmokeFailure('bridge-models-shape', 'each model must include a string id', model);
    }
  }
}

function validateChatCompletion(body) {
  assertObject('bridge-chat-shape', body, 'chat completion response');
  if (body.object !== 'chat.completion') {
    throw new SmokeFailure(
      'bridge-chat-shape',
      'chat completion must use object=chat.completion',
      body
    );
  }
  if (typeof body.id !== 'string' || !body.id.trim()) {
    throw new SmokeFailure('bridge-chat-shape', 'chat completion must include a string id', body);
  }
  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    throw new SmokeFailure('bridge-chat-shape', 'chat completion must include choices', body);
  }
  const message = body.choices[0]?.message;
  if (!message || message.role !== 'assistant' || typeof message.content !== 'string') {
    throw new SmokeFailure(
      'bridge-chat-shape',
      'first choice must include assistant message content',
      body
    );
  }
  assertObject('bridge-chat-shape', body.usage, 'chat completion usage');
}

function validateOpenApi(body) {
  assertObject('toolserver-openapi', body, 'OpenAPI response');
  if (typeof body.openapi !== 'string' || !body.openapi.startsWith('3.')) {
    throw new SmokeFailure(
      'toolserver-openapi',
      'OpenAPI response must declare an OpenAPI 3.x version',
      body
    );
  }
  assertObject('toolserver-openapi', body.paths, 'OpenAPI paths');
  const operation = body.paths['/tools/cernion-evidence-lookup']?.post;
  if (
    !operation ||
    operation.operationId !== 'cernionEvidenceLookup' ||
    operation.readOnly !== true
  ) {
    throw new SmokeFailure(
      'toolserver-openapi',
      'OpenAPI must expose the cernionEvidenceLookup operation with readOnly=true',
      body
    );
  }
}

function validateReadOnlyToolResponse(body) {
  assertObject('toolserver-read-only-tool-shape', body, 'read-only tool response');
  const declaredReadOnly =
    body.readOnly === true ||
    body.safety === 'read_only' ||
    body.mode === 'read_only' ||
    body.consequenceLevel === 'none';
  if (!declaredReadOnly) {
    throw new SmokeFailure(
      'toolserver-read-only-tool-shape',
      'read-only tool response must declare readOnly=true, safety=read_only, mode=read_only, or consequenceLevel=none',
      body
    );
  }
}

async function checkBridge(baseUrl, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const chatBody = options.chatBody || {
    model,
    messages: [
      {
        role: 'user',
        content: 'Open WebUI smoke test: return a short safe readiness response.',
      },
    ],
    stream: false,
  };

  const health = await fetchJson('bridge-health', joinUrl(baseUrl, '/health'));
  validateHealth('bridge-health', health);

  const models = await fetchJson('bridge-models-shape', joinUrl(baseUrl, '/v1/models'));
  validateModels(models);

  const chat = await fetchJson('bridge-chat-shape', joinUrl(baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    body: JSON.stringify(chatBody),
  });
  validateChatCompletion(chat);
}

async function checkToolserver(baseUrl, options = {}) {
  const method = (options.toolMethod || 'POST').toUpperCase();
  const toolPath = options.toolPath || '/tools/cernion-evidence-lookup';
  const toolBody = options.toolBody || {
    question: 'Open WebUI smoke test: return a safe read-only evidence readiness answer.',
    tenantId: 'smoke-local',
  };

  const health = await fetchJson('toolserver-health', joinUrl(baseUrl, '/health'));
  validateHealth('toolserver-health', health);

  const spec = await fetchJson('toolserver-openapi', joinUrl(baseUrl, '/openapi.json'));
  validateOpenApi(spec);

  const toolResponse = await fetchJson(
    'toolserver-read-only-tool-shape',
    joinUrl(baseUrl, toolPath),
    {
      method,
      body: method === 'GET' ? undefined : JSON.stringify(toolBody),
    }
  );
  validateReadOnlyToolResponse(toolResponse);
}

function createMockServer(kind) {
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) {
      void chunk;
    }
    const send = (statusCode, body) => {
      res.writeHead(statusCode, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && req.url === '/health') {
      send(200, { status: 'ok', service: kind });
      return;
    }

    if (kind === 'bridge' && req.method === 'GET' && req.url === '/v1/models') {
      send(200, {
        object: 'list',
        data: [{ id: DEFAULT_MODEL, object: 'model', owned_by: 'cernion-local-smoke' }],
      });
      return;
    }

    if (kind === 'bridge' && req.method === 'POST' && req.url === '/v1/chat/completions') {
      send(200, {
        id: 'chatcmpl_local_smoke',
        object: 'chat.completion',
        created: 1,
        model: DEFAULT_MODEL,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'local smoke ready' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      });
      return;
    }

    if (kind === 'toolserver' && req.method === 'GET' && req.url === '/openapi.json') {
      send(200, {
        openapi: '3.0.3',
        info: { title: 'Cernion Open WebUI Local Toolserver', version: '0.0.0-smoke' },
        paths: {
          '/tools/cernion-evidence-lookup': {
            post: {
              operationId: 'cernionEvidenceLookup',
              summary: 'Look up Cernion evidence',
              readOnly: true,
              'x-cernion-side-effects': 'none',
              responses: { 200: { description: 'read-only evidence answer' } },
            },
          },
        },
      });
      return;
    }

    if (
      kind === 'toolserver' &&
      req.method === 'POST' &&
      req.url === '/tools/cernion-evidence-lookup'
    ) {
      send(200, {
        success: true,
        answer: 'local read-only evidence smoke ready',
        readOnly: true,
        sideEffects: 'none',
      });
      return;
    }

    send(404, { status: 'not_found', method: req.method, path: req.url });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new SmokeFailure('smoke-config', `${name} must be valid JSON: ${err.message}`);
  }
}

async function runSmoke(config = {}) {
  const started = [];
  let bridgeBaseUrl = config.bridgeBaseUrl || process.env.OPEN_WEBUI_BRIDGE_BASE_URL;
  let toolserverBaseUrl = config.toolserverBaseUrl || process.env.OPEN_WEBUI_TOOLSERVER_BASE_URL;
  const useMocks = config.useMocks ?? (!bridgeBaseUrl || !toolserverBaseUrl);

  try {
    if (!bridgeBaseUrl && useMocks) {
      const mockBridge = await createMockServer('bridge');
      started.push(mockBridge);
      bridgeBaseUrl = mockBridge.baseUrl;
    }

    if (!toolserverBaseUrl && useMocks) {
      const mockToolserver = await createMockServer('toolserver');
      started.push(mockToolserver);
      toolserverBaseUrl = mockToolserver.baseUrl;
    }

    if (!bridgeBaseUrl) {
      throw new SmokeFailure(
        'smoke-config',
        'OPEN_WEBUI_BRIDGE_BASE_URL is required when mock bridge is disabled'
      );
    }
    if (!toolserverBaseUrl) {
      throw new SmokeFailure(
        'smoke-config',
        'OPEN_WEBUI_TOOLSERVER_BASE_URL is required when mock toolserver is disabled'
      );
    }

    console.log(`[open-webui-smoke] bridge: ${bridgeBaseUrl}`);
    await checkBridge(bridgeBaseUrl, {
      model: config.model || process.env.OPEN_WEBUI_SMOKE_MODEL || DEFAULT_MODEL,
      chatBody: config.chatBody || parseJsonEnv('OPEN_WEBUI_SMOKE_CHAT_BODY'),
    });
    console.log('[open-webui-smoke] bridge health, models, and chat completion shape passed');

    console.log(`[open-webui-smoke] toolserver: ${toolserverBaseUrl}`);
    await checkToolserver(toolserverBaseUrl, {
      toolPath: config.toolPath || process.env.OPEN_WEBUI_TOOL_REQUEST_PATH,
      toolMethod: config.toolMethod || process.env.OPEN_WEBUI_TOOL_REQUEST_METHOD,
      toolBody: config.toolBody || parseJsonEnv('OPEN_WEBUI_TOOL_REQUEST_BODY'),
    });
    console.log('[open-webui-smoke] toolserver health, OpenAPI, and read-only tool shape passed');

    return { bridgeBaseUrl, toolserverBaseUrl };
  } finally {
    await Promise.all(started.map((server) => server.close()));
  }
}

if (require.main === module) {
  const useMocks = process.env.OPEN_WEBUI_SMOKE_USE_MOCKS !== '0';
  runSmoke({ useMocks }).catch((err) => {
    if (err instanceof SmokeFailure) {
      console.error(`[open-webui-smoke] FAILED ${err.message}`);
      if (err.details) console.error(JSON.stringify(err.details, null, 2));
    } else {
      console.error('[open-webui-smoke] FAILED unexpected error');
      console.error(err.stack || err.message);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  SmokeFailure,
  checkBridge,
  checkToolserver,
  createMockServer,
  runSmoke,
  validateChatCompletion,
  validateHealth,
  validateModels,
  validateOpenApi,
  validateReadOnlyToolResponse,
};
