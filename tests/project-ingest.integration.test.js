'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-ingest-large-ci-'));
const oldJobDir = process.env.JOB_STORE_DIR;
process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
const { runLarge } = require('./helpers/project-ingest-large');

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (oldJobDir === undefined) delete process.env.JOB_STORE_DIR;
  else process.env.JOB_STORE_DIR = oldJobDir;
});

test('AC-01 mixed generated bundle uses fixed memory; CET_PROJECT_LARGE_BYTES scales local runs to 1 GiB', async () => {
  const result = await runLarge(dir);
  expect(result.objects).toBe(4);
  expect(result.deltaRss).toBeLessThanOrEqual(256 * 1024 ** 2);
  expect(result.deltaHeapUsed).toBeLessThanOrEqual(128 * 1024 ** 2);
  process.stdout.write(`PROJECT_INGEST_MEMORY ${JSON.stringify(result)}\n`);
}, 180000);
