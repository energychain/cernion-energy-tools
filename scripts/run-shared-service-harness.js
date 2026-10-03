#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const started = process.hrtime.bigint();
const deadlineMs = 59000;
const commands = [
  [path.join(root, 'scripts/check-domain-free-core.js')],
  [
    require.resolve('jest/bin/jest'),
    '--runInBand',
    '--coverage=false',
    'tests/domain-free-core.test.js',
    'tests/shared-service-invariants.test.js',
    'tests/shared-service-simulation.test.js',
  ],
];
for (const args of commands) {
  const remaining = deadlineMs - Number(process.hrtime.bigint() - started) / 1e6;
  if (remaining <= 0) {
    console.error('Shared service harness exceeded 59 s');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    timeout: Math.ceil(remaining),
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-vm-modules`,
    },
  });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `Harness process exited ${result.status}`);
    process.exit(result.status || 1);
  }
}
console.log(
  `Shared service harness completed in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(2)} s (< 60 s).`
);
