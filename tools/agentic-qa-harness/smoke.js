#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEFAULT_FIXTURE = path.join(ROOT, 'fixtures', 'scenarios.json');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_JSON = path.join(REPORT_DIR, 'agentic-qa-smoke.json');
const REPORT_MD = path.join(REPORT_DIR, 'agentic-qa-smoke.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function getPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, obj);
}

function includesAny(text, terms) {
  const haystack = String(text || '').toLowerCase();
  return (terms || []).filter((term) => haystack.includes(String(term).toLowerCase()));
}

function assertCase(testCase) {
  const failures = [];
  const expected = testCase.expected || {};
  const observed = testCase.observed || {};

  if (expected.capability && observed.capability !== expected.capability) {
    failures.push(`expected capability ${expected.capability}, got ${observed.capability || 'missing'}`);
  }

  for (const key of expected.parametersPresent || []) {
    if (!hasOwn(observed.parameters, key)) {
      failures.push(`missing expected parameter ${key}`);
    }
  }

  for (const key of expected.mustNotGuessParameters || []) {
    if (hasOwn(observed.parameters, key)) {
      failures.push(`parameter ${key} was guessed instead of requested`);
    }
  }

  if (
    expected.requiresClarifyingQuestion === true &&
    observed.askedClarifyingQuestion !== true
  ) {
    failures.push('expected a clarifying question before tool execution');
  }

  if (
    hasOwn(expected, 'toolAllowed') &&
    observed.toolAllowed !== expected.toolAllowed
  ) {
    failures.push(`expected toolAllowed=${expected.toolAllowed}, got ${observed.toolAllowed}`);
  }

  if (expected.blockedReason && observed.blockedReason !== expected.blockedReason) {
    failures.push(`expected blockedReason ${expected.blockedReason}, got ${observed.blockedReason || 'missing'}`);
  }

  for (const [key, value] of Object.entries(expected.contextMustContain || {})) {
    const actual = getPath(testCase.contextBefore || observed.contextAfter || {}, key);
    if (actual !== value) {
      failures.push(`expected context ${key}=${value}, got ${actual || 'missing'}`);
    }
  }

  for (const key of expected.contextMustNotContainKeys || []) {
    if (hasOwn(observed.contextAfter || {}, key)) {
      failures.push(`context key ${key} should have been purged`);
    }
  }

  const forbiddenReplyTerms = includesAny(observed.reply, expected.forbiddenReplyTerms || []);
  if (forbiddenReplyTerms.length > 0) {
    failures.push(`reply contained forbidden terms: ${forbiddenReplyTerms.join(', ')}`);
  }

  const forbiddenMarkers = includesAny(observed.reply, expected.forbiddenMarkers || []);
  if (forbiddenMarkers.length > 0) {
    failures.push(`reply leaked internal markers: ${forbiddenMarkers.join(', ')}`);
  }

  if (expected.receiptRequiredKeys) {
    for (const key of expected.receiptRequiredKeys) {
      if (!hasOwn(observed.receipt, key)) {
        failures.push(`receipt missing required key ${key}`);
      }
    }
  }

  return {
    id: testCase.id,
    category: testCase.category,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    evidence: {
      userMessage: testCase.userMessage,
      capability: observed.capability || null,
      requestedTool: observed.requestedTool || null,
      blockedReason: observed.blockedReason || null,
      reply: observed.reply || null,
    },
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Agentic QA Harness Smoke Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push(`Verdict: **${report.verdict}** (${report.passed}/${report.total} passed)`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Status | Check | Category | Evidence |');
  lines.push('| --- | --- | --- | --- |');
  for (const result of report.results) {
    const status = result.status === 'PASS' ? 'PASS' : 'FAIL';
    const evidence = result.failures.length
      ? result.failures.join('; ')
      : result.evidence.reply || result.evidence.blockedReason || 'passed';
    lines.push(`| ${status} | \`${result.id}\` | ${result.category} | ${String(evidence).replace(/\|/g, '\\|')} |`);
  }
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push('- Synthetic fixtures only.');
  lines.push('- No live credentials required.');
  lines.push('- No consequential writes performed.');
  lines.push('- This is a hackathon smoke harness, not a compliance certification.');
  lines.push('');
  return lines.join('\n');
}

function runHarness(options = {}) {
  const fixturePath = options.fixturePath || DEFAULT_FIXTURE;
  const fixture = readJson(fixturePath);
  const results = fixture.cases.map(assertCase);
  const passed = results.filter((result) => result.status === 'PASS').length;
  const report = {
    suite: fixture.suite,
    version: fixture.version,
    generatedAt: new Date().toISOString(),
    verdict: passed === results.length ? 'PASS' : 'FAIL',
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };

  if (options.writeReports !== false) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(REPORT_MD, buildMarkdown(report));
  }

  return report;
}

function main() {
  const report = runHarness();
  for (const result of report.results) {
    console.log(`${result.status} ${result.id}`);
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
  }
  console.log('');
  console.log(`Verdict: ${report.verdict} (${report.passed}/${report.total} passed)`);
  console.log('Report written:');
  console.log(`- ${path.relative(process.cwd(), REPORT_MD)}`);
  console.log(`- ${path.relative(process.cwd(), REPORT_JSON)}`);

  if (report.verdict !== 'PASS') {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  assertCase,
  buildMarkdown,
  runHarness,
};
