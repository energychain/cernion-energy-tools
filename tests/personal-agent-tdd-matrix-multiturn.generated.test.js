'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  DEFAULT_MATRIX_FILE,
  parseTddMatrixFile,
} = require('../src/personal-agent-tdd-matrix-parser');
const {
  MATRIX_NORMALIZATION_VERSION,
  normalizeMatrixTestCase,
} = require('../src/personal-agent-tdd-matrix-normalizer');

const ARTIFACT_PATH = path.join(__dirname, '..', 'tmp', 'tdd-matrix-pass-results.json');
const DEFAULT_HTTP_PORT = Number(process.env.PERSONAL_AGENT_E2E_PORT || 3900);
const BASE_URL = process.env.PERSONAL_AGENT_E2E_BASE_URL || `http://127.0.0.1:${DEFAULT_HTTP_PORT}`;
const CHAT_PATH = '/api/personal-agent/chat';
const OPENAPI_PATH = '/api/openapi.json';
const TENANT_ID = 'tenant-mt';
const RUN_BLACKBOX = process.env.RUN_PERSONAL_AGENT_TDD_MATRIX_BLACKBOX === 'true';
const SERVER_START_TIMEOUT_MS = 60000;
const JOB_RESULT_TIMEOUT_MS = Number(process.env.PERSONAL_AGENT_E2E_JOB_TIMEOUT_MS || 300000);
const JOB_POLL_INTERVAL_MS = Number(process.env.PERSONAL_AGENT_E2E_JOB_POLL_MS || 1000);
const MULTITURN_TEST_TIMEOUT_MS = Number(process.env.PERSONAL_AGENT_E2E_TEST_TIMEOUT_MS || 420000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headers, fallbackMs) {
  const retryAfter = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(250, Math.round(retryAfter * 1000));
  }
  return fallbackMs;
}

function resolveJobResultUrl(baseUrl, payload) {
  if (typeof payload?.resultUrl === 'string' && payload.resultUrl.trim()) {
    const resultUrl = payload.resultUrl.trim();
    if (/^https?:\/\//i.test(resultUrl)) {
      return resultUrl;
    }
    return `${baseUrl}${resultUrl}`;
  }
  if (typeof payload?.jobId === 'string' && payload.jobId.trim()) {
    return `${baseUrl}/api/jobs/${payload.jobId.trim()}/result`;
  }
  return null;
}

function resolveJobStatusUrl(baseUrl, payload) {
  if (typeof payload?.statusUrl === 'string' && payload.statusUrl.trim()) {
    const statusUrl = payload.statusUrl.trim();
    if (/^https?:\/\//i.test(statusUrl)) {
      return statusUrl;
    }
    return `${baseUrl}${statusUrl}`;
  }
  if (typeof payload?.jobId === 'string' && payload.jobId.trim()) {
    return `${baseUrl}/api/jobs/${payload.jobId.trim()}/status`;
  }
  return null;
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function applySetCookies(cookieJar, headers) {
  const setCookies = getSetCookieValues(headers);
  for (const rawCookie of setCookies) {
    const pair = (rawCookie || '').split(';')[0].trim();
    if (!pair || !pair.includes('=')) {
      continue;
    }
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx);
    const value = pair.slice(idx + 1);
    cookieJar.set(name, value);
  }
}

function buildCookieHeader(cookieJar) {
  const pairs = [];
  for (const [name, value] of cookieJar.entries()) {
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

function expectNoInternalErrorCodes(reply) {
  expect(reply).not.toMatch(/OBJECT_NOT_FOUND|INVALID_[A-Z_]+|ERR_[A-Z_]+|MOLECULER/i);
}

function expectRoutingContains(payload, requiredTokens) {
  expect(payload && typeof payload).toBe('object');
  expect(payload.routing && typeof payload.routing).toBe('object');

  const primaryIntent = String(payload.routing.primaryIntent || '').trim();
  expect(primaryIntent.length).toBeGreaterThan(0);

  const routingText = JSON.stringify(payload.routing).toLowerCase();
  const hasExpectedToken = requiredTokens.some((token) =>
    routingText.includes(String(token).toLowerCase())
  );
  expect(hasExpectedToken).toBe(true);
}

function expectHttp200(response) {
  expect(response.status).toBe(200);
}

function _expectAutoExecution(payload) {
  expect(payload && typeof payload).toBe('object');
  expect(payload.executionMode).toBe('auto');
  expect(payload.execution && typeof payload.execution).toBe('object');
  expect(typeof payload.execution.status).toBe('string');
  expect(payload.execution.status).not.toBe('skipped');
}

function getRoutingTokens(testCaseId) {
  if (testCaseId.startsWith('MT-JOU')) {
    return ['interface_placeholder', 'mark_unknown_execution_gap'];
  }

  if (testCaseId.startsWith('MT-INV')) {
    return ['vnb_kpi_benchmark_comparison'];
  }

  return ['netzfahrplan_fnav_assessment', 'assess_fnav_as_kupferalternative'];
}

function buildScenarioMap(cases) {
  const scenarios = new Map();

  for (const testCase of cases) {
    if (!testCase.id.startsWith('MT-')) {
      continue;
    }

    const scenarioKey = testCase.scenarioKey || testCase.id.replace(/-\d{2}$/, '');
    if (!scenarios.has(scenarioKey)) {
      scenarios.set(scenarioKey, testCase.turns || [testCase]);
    }
  }

  return Array.from(scenarios.entries()).map(([scenarioKey, turns]) => ({
    scenarioKey,
    turns: turns.slice().sort((left, right) => (left.turnNumber || 0) - (right.turnNumber || 0)),
  }));
}

function mergeCoverageArtifact(requiredIds, passedIds) {
  let existing = {};
  if (fs.existsSync(ARTIFACT_PATH)) {
    existing = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  }

  const mergedRequiredIds = Array.from(
    new Set([...(existing.requiredIds || []), ...requiredIds])
  ).sort();
  const mergedPassedIds = Array.from(new Set([...(existing.passedIds || []), ...passedIds])).sort();

  const payload = {
    generatedAt: new Date().toISOString(),
    normalizationVersion: MATRIX_NORMALIZATION_VERSION,
    requiredIds: mergedRequiredIds,
    passedIds: mergedPassedIds,
    passedCount: mergedPassedIds.length,
    requiredCount: mergedRequiredIds.length,
  };

  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function createChatClient(baseUrl) {
  const cookieJar = new Map();

  async function pollAcceptedJob(acceptedPayload, requestHeaders, acceptedHeaders) {
    const resultUrl = resolveJobResultUrl(baseUrl, acceptedPayload);
    const statusUrl = resolveJobStatusUrl(baseUrl, acceptedPayload);
    if (!resultUrl) {
      throw new Error('Accepted async chat response is missing jobId/resultUrl.');
    }

    const startedAt = Date.now();
    let pollDelayMs = parseRetryAfterMs(acceptedHeaders, JOB_POLL_INTERVAL_MS);
    let lastStatus = 'queued';

    while (Date.now() - startedAt < JOB_RESULT_TIMEOUT_MS) {
      await sleep(pollDelayMs);

      const response = await fetch(resultUrl, {
        method: 'GET',
        headers: requestHeaders,
      });
      applySetCookies(cookieJar, response.headers);

      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }

      if (response.status === 200) {
        return { response, payload, acceptedPayload };
      }

      if (response.status !== 202) {
        throw new Error(`Unexpected async job polling status ${response.status}.`);
      }

      lastStatus = payload?.status || lastStatus;
      if (lastStatus === 'error') {
        let errorDetail = null;
        if (statusUrl) {
          try {
            const statusResponse = await fetch(statusUrl, {
              method: 'GET',
              headers: requestHeaders,
            });
            applySetCookies(cookieJar, statusResponse.headers);
            const statusPayload = await statusResponse.json();
            errorDetail = statusPayload?.error || statusPayload?.message || null;
          } catch (_error) {
            errorDetail = null;
          }
        }
        const jobId = acceptedPayload?.jobId || 'unknown';
        throw new Error(
          `Async chat job ${jobId} failed with status=error${errorDetail ? `: ${errorDetail}` : '.'}`
        );
      }
      pollDelayMs = parseRetryAfterMs(response.headers, JOB_POLL_INTERVAL_MS);
    }

    const jobId = acceptedPayload?.jobId || 'unknown';
    throw new Error(`Timed out waiting for async chat job ${jobId}. Last status: ${lastStatus}.`);
  }

  async function chat(message, sessionId, options = {}) {
    const body = {
      message,
      ...options,
    };

    if (sessionId) {
      body.sessionId = sessionId;
    }

    const headers = {
      'content-type': 'application/json',
      'x-tenant-id': TENANT_ID,
    };

    const cookieHeader = buildCookieHeader(cookieJar);
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const response = await fetch(`${baseUrl}${CHAT_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    applySetCookies(cookieJar, response.headers);

    if (response.status === 202) {
      const acceptedPayload = await response.json();
      return pollAcceptedJob(acceptedPayload, headers, response.headers);
    }

    const payload = await response.json();
    return { response, payload };
  }

  function clear() {
    cookieJar.clear();
  }

  return {
    chat,
    clear,
  };
}

async function isApiReady(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}${OPENAPI_PATH}`);
    return response.ok;
  } catch (_error) {
    return false;
  }
}

function startApiServer() {
  const entrypoint = path.join(__dirname, '..', 'index.js');
  const child = spawn(process.execPath, [entrypoint], {
    env: {
      ...process.env,
      PORT: String(DEFAULT_HTTP_PORT),
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform !== 'win32',
  });

  if (typeof child.unref === 'function') {
    child.unref();
  }

  return child;
}

async function waitForApi(baseUrl, child) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    if (await isApiReady(baseUrl)) {
      return;
    }

    if (child && child.exitCode !== null) {
      throw new Error(`Cernion API server exited before becoming ready (code ${child.exitCode}).`);
    }

    await sleep(1000);
  }

  throw new Error(
    `Cernion API server did not become ready on ${baseUrl} within ${SERVER_START_TIMEOUT_MS}ms.`
  );
}

async function ensureApiServer(baseUrl) {
  if (await isApiReady(baseUrl)) {
    return null;
  }

  const child = startApiServer();
  await waitForApi(baseUrl, child);
  return child;
}

function stopApiServer(child) {
  if (!child) {
    return;
  }

  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
      return;
    }
  } catch (_error) {
    // fall through to a direct kill below
  }

  try {
    child.kill('SIGTERM');
  } catch (_error) {
    // ignore best-effort shutdown failures in tests
  }
}

jest.setTimeout(MULTITURN_TEST_TIMEOUT_MS);

const describeBlackbox = RUN_BLACKBOX ? describe : describe.skip;

describeBlackbox('v0.52.5 TDD matrix multi-turn HTTP blackbox coverage', () => {
  const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE).filter((testCase) =>
    testCase.id.startsWith('MT-')
  );
  const scenarios = buildScenarioMap(cases);
  const requiredIds = cases.map((testCase) => testCase.id).sort();
  const passedIds = [];
  let serverProcess = null;
  let client = null;

  beforeAll(async () => {
    serverProcess = await ensureApiServer(BASE_URL);
    client = createChatClient(BASE_URL);
  });

  afterAll(async () => {
    mergeCoverageArtifact(requiredIds, passedIds);
    if (client) {
      client.clear();
    }
    stopApiServer(serverProcess);
  });

  it('parses exactly 12 executable multi-turn matrix turns in 3 scenarios', () => {
    expect(cases).toHaveLength(12);
    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.scenarioKey).sort()).toEqual([
      'MT-INV',
      'MT-JOU',
      'MT-VOR',
    ]);
  });

  test.each(scenarios)(
    '$scenarioKey runs through POST /api/personal-agent/chat with one persistent session',
    async ({ turns }) => {
      let sessionId = null;
      let previousHistoryCount = 0;

      for (const turn of turns) {
        const normalized = normalizeMatrixTestCase(turn);
        let message = turn.prompt;
        let knownContext = normalized.knownContext || {};

        if (turn.id.startsWith('MT-INV')) {
          message =
            'Vergleiche zwei VNB hinsichtlich Benchmark, KPI, Anschlussdauer, Digitalisierungsindex und Umsetzungsquote.';
          knownContext = {
            vnb1Name: 'Stadtwerke Troisdorf',
            vnb2Name: 'STROMDAO Netze',
          };
        }

        if (turn.id.startsWith('MT-VOR')) {
          message =
            'Bewerte den Netzfahrplan fNAV mit requestedCapacityKW 10000, Voltage Level MS, N-1 und Kaufmaennische fNAV-Freigabe.';
          knownContext = {
            requestedCapacityKW: 10000,
            voltageLevel: 'MS',
            gridOperatorName: 'STROMDAO Netze',
            ownerContact: 'netzplanung@stromdao.de',
          };
        }

        const { response, payload } = await client.chat(message, sessionId, {
          executionMode: normalized.executionMode || 'auto',
          knownContext,
        });

        expectHttp200(response);
        expect(payload.success).toBe(true);
        expect(payload.executionMode).toBe('auto');
        expect(payload.execution && typeof payload.execution).toBe('object');
        expect(typeof payload.execution.status).toBe('string');
        expect(payload.execution.status).not.toBe('skipped');
        expect(payload.routing && typeof payload.routing).toBe('object');
        expect(typeof payload.routing.primaryIntent).toBe('string');
        expect(payload.routing.primaryIntent.length).toBeGreaterThan(0);

        const routingTokens = getRoutingTokens(turn.id);
        expectRoutingContains(payload, routingTokens);

        const payloadText = JSON.stringify(payload).toLowerCase();
        for (const token of routingTokens) {
          expect(payloadText).toContain(String(token).toLowerCase());
        }

        expect(typeof payload.reply).toBe('string');
        expect(payload.reply.length).toBeGreaterThan(20);

        for (const forbiddenKeyword of normalized.forbiddenReplyKeywords || []) {
          expect(payload.reply.toLowerCase()).not.toContain(String(forbiddenKeyword).toLowerCase());
        }

        if (sessionId) {
          expect(payload.sessionId).toBe(sessionId);
        }
        sessionId = payload.sessionId;
        expect(typeof sessionId).toBe('string');
        expect(sessionId.length).toBeGreaterThan(0);

        expect(payload.historyCount).toBeGreaterThan(previousHistoryCount);
        previousHistoryCount = payload.historyCount;

        expectNoInternalErrorCodes(payload.reply);
        passedIds.push(turn.id);
      }
    }
  );
});
