'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// #855 review: run-level #850 checks must not break the --recheck-report corpus sequence.
const env = { ...process.env };
const { recheckReport, failedChecks } = require('../scripts/validate-workbench-813-live');
const committed = require('../docs/validation/813-live.json');
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-813-recheck-'));
  process.exitCode = undefined;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});
afterAll(() => {
  process.env = env;
});
const write = (report) => {
  const file = path.join(dir, '813-live.json');
  fs.writeFileSync(file, JSON.stringify(report));
  return file;
};

test('run-level polish checks keep the recheck corpus sequence intact', () => {
  const report = structuredClone(committed);
  for (const run of report.runs) run.checks = { summaryWithoutInternalText: true };
  const file = write(report);
  expect(() => recheckReport(file)).not.toThrow();
  const rechecked = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(rechecked.runs.map((run) => run.checks)).toEqual(
    report.runs.map(() => ({ summaryWithoutInternalText: true }))
  );
  expect(rechecked.runs[0].turns.map((turn) => turn.scenario)).not.toContain('polish850');
});

test('a polish pseudo-turn inside the corpus sequence is still rejected', () => {
  const report = structuredClone(committed);
  report.runs[0].turns.unshift({ scenario: 'polish850', checks: {} });
  expect(() => recheckReport(write(report))).toThrow('three complete unchanged corpus runs');
});

test('a failed run-level check fails the pass predicate', () => {
  expect(failedChecks({ checks: { draftSigned: false }, turns: [] })).toBe(true);
  expect(failedChecks({ checks: { draftSigned: true }, turns: [{ checks: { a: true } }] })).toBe(
    false
  );
  expect(failedChecks({ turns: [{ checks: { a: false } }] })).toBe(true);
});
