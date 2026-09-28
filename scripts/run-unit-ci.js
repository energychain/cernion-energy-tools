#!/usr/bin/env node
/*
 * Run the unit-test coverage gate in bounded Jest chunks, then merge coverage.
 *
 * The full serial Jest+coverage process can exceed local/CI heap on this
 * codebase. This runner keeps the existing global coverage thresholds but
 * avoids holding every instrumented test suite in one Node process.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const istanbulCoverage = require('istanbul-lib-coverage');
const istanbulReport = require('istanbul-lib-report');
const istanbulReports = require('istanbul-reports');
const { createInstrumenter } = require('istanbul-lib-instrument');

const repoRoot = path.resolve(__dirname, '..');
const jestBin = require.resolve('jest/bin/jest');
const coverageRoot = path.join(repoRoot, 'coverage');
const chunkRoot = path.join(coverageRoot, '.unit-ci-chunks');
const finalCoveragePath = path.join(coverageRoot, 'coverage-final.json');
const threshold = {
  branches: 63,
  functions: 80,
  lines: 79,
  statements: 79,
};

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const chunkSize = parsePositiveInteger(process.env.CET_UNIT_CI_CHUNK_SIZE, 20);

function run(commandArgs, options = {}) {
  const nodeOptions = new Set([
    '--experimental-vm-modules',
    ...(process.env.NODE_OPTIONS || '').split(/\s+/).filter(Boolean),
  ]);
  const env = {
    ...process.env,
    CET_UNIT_CI_CHUNKED: '1',
    NODE_OPTIONS: Array.from(nodeOptions).join(' '),
  };
  return spawnSync(process.execPath, commandArgs, {
    cwd: repoRoot,
    stdio: options.stdio || 'inherit',
    encoding: options.encoding || 'utf8',
    env,
  });
}

function listTests() {
  const result = run(
    [
      jestBin,
      '--listTests',
      '--testPathIgnorePatterns=tests/.*\\.integration\\.test\\.js|custom-tests',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !file.endsWith('.integration.test.js'))
    .filter((file) => !file.includes(`${path.sep}custom-tests${path.sep}`))
    .sort();
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function cleanCoverage() {
  fs.rmSync(chunkRoot, { recursive: true, force: true });
  fs.rmSync(finalCoveragePath, { force: true });
  fs.mkdirSync(chunkRoot, { recursive: true });
}

function runChunk(testFiles, index, total) {
  const coverageDirectory = path.join(chunkRoot, `chunk-${String(index + 1).padStart(3, '0')}`);
  fs.mkdirSync(coverageDirectory, { recursive: true });
  console.log(`\n[unit-ci] Chunk ${index + 1}/${total}: ${testFiles.length} test files`);
  const result = run([
    jestBin,
    '--coverage',
    '--runInBand',
    '--forceExit',
    '--coverageReporters=json',
    `--coverageDirectory=${coverageDirectory}`,
    ...testFiles,
  ]);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  const coverageFile = path.join(coverageDirectory, 'coverage-final.json');
  if (!fs.existsSync(coverageFile)) {
    console.error(`[unit-ci] Missing coverage output for chunk ${index + 1}: ${coverageFile}`);
    process.exit(1);
  }
  return coverageFile;
}

function mergeCoverage(coverageFiles) {
  const merged = istanbulCoverage.createCoverageMap({});
  for (const coverageFile of coverageFiles) {
    merged.merge(JSON.parse(fs.readFileSync(coverageFile, 'utf8')));
  }
  addUncoveredFiles(merged);
  fs.mkdirSync(coverageRoot, { recursive: true });
  fs.writeFileSync(finalCoveragePath, JSON.stringify(merged.toJSON()));
  return merged;
}

function walkJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJavaScriptFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

function coverageTargetFiles() {
  return [path.join(repoRoot, 'src'), path.join(repoRoot, 'services')]
    .flatMap(walkJavaScriptFiles)
    .filter((file) => !file.endsWith('.test.js'))
    .filter((file) => !file.endsWith('.spec.js'))
    .filter((file) => path.relative(repoRoot, file) !== path.join('services', 'api.service.js'))
    .sort((left, right) => left.localeCompare(right));
}

function addUncoveredFiles(coverageMap) {
  const instrumenter = createInstrumenter({ coverageVariable: '__coverage__' });
  for (const file of coverageTargetFiles()) {
    if (coverageMap.data[file]) continue;
    const source = fs.readFileSync(file, 'utf8');
    instrumenter.instrumentSync(source, file);
    coverageMap.addFileCoverage(instrumenter.lastFileCoverage());
  }
}

function printReports(coverageMap) {
  const context = istanbulReport.createContext({
    dir: coverageRoot,
    coverageMap,
  });
  istanbulReports.create('text-summary').execute(context);
  istanbulReports.create('lcovonly').execute(context);
}

function pct(covered, total) {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

function coverageSummary(coverageMap) {
  const summary = coverageMap.getCoverageSummary();
  return {
    branches: pct(summary.branches.covered, summary.branches.total),
    functions: pct(summary.functions.covered, summary.functions.total),
    lines: pct(summary.lines.covered, summary.lines.total),
    statements: pct(summary.statements.covered, summary.statements.total),
  };
}

function verifyThresholds(summary) {
  const failures = Object.entries(threshold).filter(
    ([metric, minimum]) => summary[metric] < minimum
  );
  if (failures.length === 0) return;
  console.error('\n[unit-ci] Coverage threshold failed:');
  for (const [metric, minimum] of failures) {
    console.error(`  ${metric}: ${summary[metric].toFixed(2)}% < ${minimum}%`);
  }
  process.exit(1);
}

function main() {
  const tests = listTests();
  if (tests.length === 0) {
    console.error('[unit-ci] No unit tests found.');
    process.exit(1);
  }
  cleanCoverage();
  const chunks = chunk(tests, chunkSize);
  console.log(
    `[unit-ci] Running ${tests.length} unit test files in ${chunks.length} chunks of up to ${chunkSize}.`
  );
  const coverageFiles = chunks.map((testFiles, index) => runChunk(testFiles, index, chunks.length));
  const coverageMap = mergeCoverage(coverageFiles);
  printReports(coverageMap);
  const summary = coverageSummary(coverageMap);
  verifyThresholds(summary);
  console.log('[unit-ci] Coverage thresholds passed.');
}

main();
