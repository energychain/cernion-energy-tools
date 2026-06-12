#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MATRIX_FILE = path.join(
  ROOT,
  'docs',
  'v0.52-implementation-plans',
  'personal-agent-v052-architecture-tdd.md'
);
const ARTIFACT_FILE = path.join(ROOT, 'tmp', 'tdd-matrix-pass-results.json');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractRequiredIds(markdown) {
  const set = new Set();
  const regex = /\|\s*((?:T|MT)-[A-Z]+-\d{2})\s*\|/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    set.add(match[1]);
  }
  return Array.from(set).sort();
}

function splitRequiredIds(requiredIds) {
  return {
    unitRequiredIds: requiredIds.filter((id) => id.startsWith('T-')),
    blackboxRequiredIds: requiredIds.filter((id) => id.startsWith('MT-')),
  };
}

function collectPassedIds(requiredIds, passedSet) {
  return requiredIds.filter((id) => passedSet.has(id));
}

function main() {
  if (!fs.existsSync(MATRIX_FILE)) {
    fail(`Matrix file not found: ${MATRIX_FILE}`);
    return;
  }

  const markdown = readUtf8(MATRIX_FILE);
  const requiredIds = extractRequiredIds(markdown);
  const { unitRequiredIds, blackboxRequiredIds } = splitRequiredIds(requiredIds);
  const blackboxGateEnabled = process.env.RUN_PERSONAL_AGENT_TDD_MATRIX_BLACKBOX === 'true';

  if (requiredIds.length === 0) {
    fail('No TDD IDs found in matrix markdown (expected > 0).');
    return;
  }

  if (unitRequiredIds.length === 0) {
    fail('No unit T-* IDs found in matrix markdown (expected > 0).');
    return;
  }

  if (!fs.existsSync(ARTIFACT_FILE)) {
    fail(`Coverage artifact missing: ${ARTIFACT_FILE}`);
    fail('Run jest matrix tests first (npm run test:tdd-matrix).');
    return;
  }

  let artifact;
  try {
    artifact = JSON.parse(readUtf8(ARTIFACT_FILE));
  } catch (err) {
    fail(`Invalid JSON in artifact ${ARTIFACT_FILE}: ${err.message}`);
    return;
  }

  const passedIds = Array.isArray(artifact.passedIds)
    ? artifact.passedIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  const passedSet = new Set(passedIds);
  const unknown = Array.from(passedSet).filter((id) => !requiredIds.includes(id));
  const passedUnitIds = collectPassedIds(unitRequiredIds, passedSet);
  const passedBlackboxIds = collectPassedIds(blackboxRequiredIds, passedSet);
  const missingUnitIds = unitRequiredIds.filter((id) => !passedSet.has(id));
  const missingBlackboxIds = blackboxRequiredIds.filter((id) => !passedSet.has(id));
  const activeRequiredIds = blackboxGateEnabled
    ? unitRequiredIds.concat(blackboxRequiredIds)
    : unitRequiredIds;
  const activePassedCount = blackboxGateEnabled
    ? passedUnitIds.length + passedBlackboxIds.length
    : passedUnitIds.length;
  const activeCoverage = Number(((activePassedCount / activeRequiredIds.length) * 100).toFixed(2));

  console.log('=== v0.52.5 TDD Matrix Coverage ===');
  console.log(`blackbox gate enabled: ${blackboxGateEnabled}`);
  console.log(`total matrix IDs:      ${requiredIds.length}`);
  console.log(`required T-* count:    ${unitRequiredIds.length}`);
  console.log(`passed T-* count:      ${passedUnitIds.length}`);
  console.log(`optional MT-* count:   ${blackboxRequiredIds.length}`);
  console.log(`passed MT-* count:     ${passedBlackboxIds.length}`);
  console.log(`active required:       ${activeRequiredIds.length}`);
  console.log(`active passed:         ${activePassedCount}`);
  console.log(`active coverage:       ${activeCoverage}%`);

  if (unknown.length > 0) {
    fail(`Artifact contains unknown IDs (${unknown.length}): ${unknown.join(', ')}`);
  }

  if (missingUnitIds.length > 0) {
    fail(
      `Missing/failed/skipped required T-* IDs (${missingUnitIds.length}): ${missingUnitIds.join(', ')}`
    );
  }

  if (blackboxGateEnabled && missingBlackboxIds.length > 0) {
    fail(
      `Missing/failed/skipped required MT-* IDs (${missingBlackboxIds.length}): ${missingBlackboxIds.join(', ')}`
    );
  }

  if (!blackboxGateEnabled && blackboxRequiredIds.length > 0) {
    console.log(
      `optional/blackbox skipped IDs (${missingBlackboxIds.length}): ${missingBlackboxIds.join(', ')}`
    );
  }

  if (activeCoverage < 100) {
    fail(`Coverage below hard gate: ${activeCoverage}% < 100%`);
  }

  if (process.exitCode === 1) {
    return;
  }

  if (blackboxGateEnabled) {
    console.log('✅ Hard gate passed: 100% of required T-* and MT-* matrix IDs are PASSED.');
    return;
  }

  console.log(
    '✅ Hard gate passed: 100% of required T-* matrix IDs are PASSED. MT-* remains explicit blackbox coverage.'
  );
}

main();
