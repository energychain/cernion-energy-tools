'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const jestBin = require.resolve('jest/bin/jest');

function discover(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CET_UNIT_CI_CHUNKED: '1' },
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

test('full test runner discovers the complete existing Jest scope', () => {
  const expected = discover([jestBin, '--listTests']).split('\n').sort();
  const actual = JSON.parse(discover(['scripts/run-unit-ci.js', '--all-tests', '--list-tests']));
  expect(actual).toEqual(expected);
  expect(actual.some((file) => file.endsWith('.integration.test.js'))).toBe(true);
  expect(actual.some((file) => file.endsWith('assets.integration.test.js'))).toBe(false);
});

test('unit test runner preserves the integration and custom-service exclusions', () => {
  const expected = discover([jestBin, '--listTests'])
    .split('\n')
    .filter((file) => !file.endsWith('.integration.test.js'))
    .filter((file) => !file.includes(`${path.sep}custom-tests${path.sep}`))
    .sort();
  const actual = JSON.parse(discover(['scripts/run-unit-ci.js', '--list-tests']));
  expect(actual).toEqual(expected);
});
