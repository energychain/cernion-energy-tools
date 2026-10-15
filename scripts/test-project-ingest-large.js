#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-ingest-large-'));
// Isolated test stores; no tenant configuration or credentials are needed.
process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
process.env.RATE_QUOTA_DIR = path.join(dir, 'quotas');
process.env.RATE_QUOTA_DRIVER = 'file';
const { runLarge } = require('../tests/helpers/project-ingest-large');

runLarge(dir)
  .then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error) => {
      process.stderr.write(`${error.stack}\n`);
      process.exitCode = 1;
    }
  )
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
