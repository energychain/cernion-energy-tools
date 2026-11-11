#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const testDirectory = path.join(root, 'test');
const testFiles = fs
  .readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => path.join('test', entry.name))
  .sort();
const environment = { ...process.env };

for (const name of Object.keys(environment)) {
  if (name.startsWith('MANAGEMENT_COCKPIT_') || name.startsWith('ASSISTANT_')) {
    delete environment[name];
  }
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`test runner terminated by signal ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status === null ? 1 : result.status;
}
