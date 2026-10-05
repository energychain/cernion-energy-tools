'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

test('all local services start and broker.stop() completes without service stop failures', async () => {
  const { stdout } = await run(
    process.execPath,
    [path.join(__dirname, '../scripts/test-lifecycle.js')],
    {
      timeout: 25000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  expect(stdout).toMatch(/Lifecycle PASS: \d+ services started and stopped in [\d.]+ s/);
});
