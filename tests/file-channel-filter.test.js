'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('Open WebUI filter transfers original bytes, enforces file ACL/limits, emits refs and session proxy links', () => {
  const result = spawnSync(
    'python3',
    [path.join(__dirname, 'helpers/file-channel-filter-check.py')],
    { encoding: 'utf8' }
  );
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
});
