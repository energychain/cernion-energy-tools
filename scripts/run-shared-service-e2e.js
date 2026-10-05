#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-shared-e2e-'));
const started = performance.now();
try {
  // A clean child environment and working directory isolate every relative data
  // path and prevent production credentials/.env from entering the test.
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, '../tests/e2e/shared-service.cjs')],
    {
      cwd: dir,
      stdio: 'inherit',
      timeout: 120000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        JOB_STORE_DIR: path.join(dir, 'jobs'),
        RATE_QUOTA_DIR: path.join(dir, 'rate-quotas'),
        FORECAST_PORTFOLIO_RUNTIME_PATH: path.join(dir, 'forecast-runtime.json'),
        FORECAST_PORTFOLIO_DATA_PATH: path.join(dir, 'forecast-data.json'),
        CERNION_TENANT_REGISTRY_FILE: path.join(dir, 'tenants.json'),
        LLM_PROVIDER: 'ollama',
        LLM_MODEL: 'offline-e2e',
        NODE_OPTIONS: '--experimental-vm-modules',
      },
    }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(
    `Shared service e2e completed in ${((performance.now() - started) / 1000).toFixed(2)} s.`
  );
}
