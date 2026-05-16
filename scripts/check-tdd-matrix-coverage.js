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

function main() {
  if (!fs.existsSync(MATRIX_FILE)) {
    fail(`Matrix file not found: ${MATRIX_FILE}`);
    return;
  }

  const markdown = readUtf8(MATRIX_FILE);
  const requiredIds = extractRequiredIds(markdown);

  if (requiredIds.length === 0) {
    fail('No TDD IDs found in matrix markdown (expected > 0).');
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
  const missing = requiredIds.filter((id) => !passedSet.has(id));
  const unknown = Array.from(passedSet).filter((id) => !requiredIds.includes(id));

  const coverage = Number(((passedSet.size / requiredIds.length) * 100).toFixed(2));

  console.log('=== v0.52.5 TDD Matrix Coverage ===');
  console.log(`required: ${requiredIds.length}`);
  console.log(`passed:   ${passedSet.size}`);
  console.log(`coverage: ${coverage}%`);

  if (unknown.length > 0) {
    fail(`Artifact contains unknown IDs (${unknown.length}): ${unknown.join(', ')}`);
  }

  if (missing.length > 0) {
    fail(`Missing/failed/skipped IDs (${missing.length}): ${missing.join(', ')}`);
  }

  if (coverage < 100) {
    fail(`Coverage below hard gate: ${coverage}% < 100%`);
  }

  if (process.exitCode === 1) {
    return;
  }

  console.log('✅ Hard gate passed: 100% of required T-* and MT-* matrix IDs are PASSED.');
}

main();
