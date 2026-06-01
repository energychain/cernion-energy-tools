'use strict';

const { spawnSync } = require('child_process');

const CHAT_PATH = '/api/personal-agent/chat';
const JOB_RESULT_TIMEOUT_MS = Number(process.env.REST_USECASE_JOB_TIMEOUT_MS || 300000);
const JOB_POLL_INTERVAL_MS = Number(process.env.REST_USECASE_JOB_POLL_MS || 1000);

function checkServerAvailableSync(baseUrl) {
  try {
    const normalizedBaseUrl = String(baseUrl || '').replace(/'/g, "\\'");
    const script = [
      "const http = require('http');",
      `const url = new URL('${normalizedBaseUrl}/api/openapi.json');`,
      "const req = http.request({ hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'GET' }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });",
      "req.on('error', () => process.exit(1));",
      'req.setTimeout(1500, () => { req.destroy(); process.exit(1); });',
      'req.end();',
    ].join('\n');

    const result = spawnSync(process.execPath, ['-e', script], { stdio: 'ignore' });
    return result.status === 0;
  } catch (_error) {
    return false;
  }
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
    cookieJar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

function buildCookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

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
    return /^https?:\/\//i.test(resultUrl) ? resultUrl : `${baseUrl}${resultUrl}`;
  }
  if (typeof payload?.jobId === 'string' && payload.jobId.trim()) {
    return `${baseUrl}/api/jobs/${payload.jobId.trim()}/result`;
  }
  return null;
}

function extractReply(payload) {
  if (typeof payload?.reply === 'string') return payload.reply;
  if (typeof payload?.response?.reply === 'string') return payload.response.reply;
  if (typeof payload?.text === 'string') return payload.text;
  return '';
}

function createPersonalAgentRestClient({ baseUrl, tenantId }) {
  const cookieJar = new Map();

  async function pollAcceptedJob(acceptedPayload, requestHeaders, acceptedHeaders) {
    const resultUrl = resolveJobResultUrl(baseUrl, acceptedPayload);
    if (!resultUrl) {
      throw new Error('Accepted async response is missing jobId/resultUrl.');
    }

    const startedAt = Date.now();
    let pollDelayMs = parseRetryAfterMs(acceptedHeaders, JOB_POLL_INTERVAL_MS);

    while (Date.now() - startedAt < JOB_RESULT_TIMEOUT_MS) {
      await sleep(pollDelayMs);
      const response = await fetch(resultUrl, { method: 'GET', headers: requestHeaders });
      applySetCookies(cookieJar, response.headers);
      const payload = await response.json().catch(() => null);

      if (response.status === 200) {
        return { response, payload, acceptedPayload };
      }
      if (response.status !== 202) {
        throw new Error(`Unexpected async job polling status ${response.status}.`);
      }
      if (payload?.status === 'error') {
        throw new Error(`Async chat job ${acceptedPayload?.jobId || 'unknown'} failed.`);
      }
      pollDelayMs = parseRetryAfterMs(response.headers, JOB_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for async chat job ${acceptedPayload?.jobId || 'unknown'}.`);
  }

  async function chat({ message, sessionId, knownContext = {}, options = {} }) {
    const headers = {
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'x-cernion-tenant': tenantId,
    };
    const cookieHeader = buildCookieHeader(cookieJar);
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const response = await fetch(`${baseUrl}${CHAT_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        sessionId,
        knownContext,
        chatMode: 'execution',
        executionMode: 'auto',
        disableReceiptSelection: true,
        ...options,
      }),
    });

    applySetCookies(cookieJar, response.headers);

    if (response.status === 202) {
      const acceptedPayload = await response.json();
      return pollAcceptedJob(acceptedPayload, headers, response.headers);
    }

    const payload = await response.json();
    return { response, payload };
  }

  return {
    chat,
    clear: () => cookieJar.clear(),
  };
}

module.exports = {
  CHAT_PATH,
  checkServerAvailableSync,
  createPersonalAgentRestClient,
  extractReply,
};
