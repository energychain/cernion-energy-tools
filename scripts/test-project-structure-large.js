#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-885-large-'));
process.env.JOB_STORE_DIR = path.join(directory, 'jobs');
process.env.RATE_QUOTA_DIR = path.join(directory, 'quotas');
// An offline performance fixture: block all LLM calls at the shared facade.
const llm = require('../src/llm-client');
llm.generateStructured = async () => undefined;
llm.generateText = async () => {
  throw new Error('LLM forbidden in performance test');
};
require('../tests/helpers/project-structure-large')
  .runLargeStructure(directory)
  .then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
  .catch((error) => {
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
