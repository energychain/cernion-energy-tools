'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
let installed;

function installLiveBudget({ limit = Number(process.env.LIVE_MAX_MODEL_CALLS || 40) } = {}) {
  if (installed) return installed;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid live model call limit');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-live-quota-'));
  // Separate storage and identity: even a caller omitting tenantId cannot charge production.
  process.env.RATE_QUOTA_DIR = directory;
  process.env.RATE_QUOTA_DRIVER = 'file';
  process.env.RESET_LLM_TOKENS_PER_DAY_ON_RESTART = 'false';
  const llm = require('../src/llm-client');
  const quota = require('../src/rate-quota-store');
  quota.resetForTests();
  const tenantId = `synthetic-validation-${randomUUID()}`;
  const testQuota = quota.getTenantState(tenantId);
  const tokenLimit = Number(process.env.LIVE_MAX_TOKENS || 1000000);
  if (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1)
    throw new Error('Invalid live token limit');
  testQuota.config.quotas.llm_tokens_per_day = tokenLimit;
  testQuota.config.quotas.llm_tokens_per_month = tokenLimit;
  quota.saveTenantState(tenantId, testQuota);
  const state = {
    tenantId,
    limit,
    calls: 0,
    completed: 0,
    stopped: null,
    externalRequests: 0,
    externalTokens: 0,
  };
  const assertReady = () => {
    if (
      !state.stopped &&
      quota.buildQuotaSnapshot(tenantId).usage.llm_tokens_per_day.used + state.externalTokens >=
        tokenLimit
    )
      state.stopped = 'token_limit';
    if (state.stopped)
      throw Object.assign(new Error('Live validation stopped'), { type: state.stopped });
  };
  // A remote gateway does not expose its internal model-call count. Account for
  // client requests separately and reserve conservative input/output token estimates.
  const reserveExternal = (input, maxOutputChars = 16000, { retainReservation = false } = {}) => {
    assertReady();
    if (state.calls >= limit) state.stopped = 'call_limit';
    const reserved = Math.ceil((String(input).length + maxOutputChars) / 4);
    if (
      quota.buildQuotaSnapshot(tenantId).usage.llm_tokens_per_day.used +
        state.externalTokens +
        reserved >
      tokenLimit
    )
      state.stopped = 'token_limit';
    assertReady();
    state.calls++;
    state.externalRequests++;
    state.externalTokens += reserved;
    let settled = false;
    return (output) => {
      if (settled) return;
      settled = true;
      if (!retainReservation)
        state.externalTokens +=
          Math.ceil((String(input).length + String(output).length) / 4) - reserved;
      state.completed++;
      assertReady();
    };
  };
  const stopForQuota = (error) => {
    if (
      error.type === 'LLM_QUOTA_EXCEEDED' ||
      Number(error.status || error.response?.status || error.code) === 429
    ) {
      state.stopped =
        error.type === 'LLM_QUOTA_EXCEEDED' ? 'tenant_quota_exceeded' : 'provider_quota';
      process.exitCode = 1;
    }
  };
  const originals = {};
  for (const name of [
    'generateText',
    'generateStructured',
    'generateChat',
    'embeddings',
    'generateImage',
  ]) {
    originals[name] = llm[name];
    if (!originals[name]) continue;
    llm[name] = async (...args) => {
      assertReady();
      if (state.calls >= limit) {
        state.stopped = 'call_limit';
        process.exitCode = 1;
        assertReady();
      }
      const optionsAt = name === 'generateStructured' ? 2 : 1;
      const options = args[optionsAt] || {};
      args[optionsAt] = {
        ...options,
        tenantId,
        maxRetries: 1,
        transientRecovery: false,
        structuredFallback: false,
      };
      state.calls++;
      try {
        const result = await originals[name](...args);
        state.completed++;
        return result;
      } catch (error) {
        stopForQuota(error);
        throw error;
      }
    };
  }
  const report = () => {
    const tokens = { ...quota.buildQuotaSnapshot(tenantId).usage.llm_tokens_per_day };
    delete tokens.lastMeta;
    tokens.used += state.externalTokens;
    tokens.estimatedUsed += state.externalTokens;
    tokens.remaining = Math.max(0, tokenLimit - tokens.used);
    return { ...state, tokens };
  };
  process.once('exit', () => {
    const result = report();
    // Do not put provider/model identifiers from lastMeta into validation artifacts.
    delete result.tokens.lastMeta;
    process.stderr.write(JSON.stringify({ liveValidationBudget: result }) + '\n');
    if (process.env.LIVE_BUDGET_REPORT)
      fs.writeFileSync(process.env.LIVE_BUDGET_REPORT, JSON.stringify(result, null, 2) + '\n');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  installed = { state, assertReady, report, reserveExternal, stopForQuota };
  return installed;
}
module.exports = { installLiveBudget };
