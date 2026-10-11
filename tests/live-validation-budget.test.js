'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(stoppedByQuota) {
  const script = `
    const file = require.resolve('./src/llm-client');
    let backendCalls = 0;
    let optionsSeen;
    require.cache[file] = { id: file, filename: file, loaded: true, exports: {
      generateText: async (_prompt, options) => {
        backendCalls++; optionsSeen = options;
        if (${JSON.stringify(stoppedByQuota)}) throw Object.assign(new Error('rate limit'), { status: 429 });
        require('./src/rate-quota-store').recordLlmUsage({tenantId: options.tenantId, prompt: 'synthetic', completion: 'OK'});
        return 'OK';
      }
    }};
    const guard = require('./scripts/live-validation-budget').installLiveBudget({limit: 1});
    (async () => {
      const llm = require('./src/llm-client');
      for (let index=0; index<2; index++) try { await llm.generateText('synthetic', {tenantId: 'production-tenant', maxRetries: 8, transientRecovery: true}); } catch (_) {}
      console.log(JSON.stringify({backendCalls, optionsSeen, report: guard.report()}));
    })();
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, LIVE_MAX_TOKENS: '1000' },
  });
  expect(result.status).toBe(1);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

test('call ceiling blocks the second backend attempt and isolates tokens from production', () => {
  const result = run(false);
  expect(result.backendCalls).toBe(1);
  expect(result.optionsSeen).toMatchObject({
    maxRetries: 1,
    transientRecovery: false,
    structuredFallback: false,
  });
  expect(result.optionsSeen.tenantId).toMatch(/^synthetic-validation-/);
  expect(result.report).toMatchObject({ calls: 1, completed: 1, stopped: 'call_limit' });
  expect(result.report.tokens.used).toBeGreaterThan(0);
});

test('provider 429 stops all subsequent calls', () => {
  const result = run(true);
  expect(result.backendCalls).toBe(1);
  expect(result.report).toMatchObject({ calls: 1, completed: 0, stopped: 'provider_quota' });
});
