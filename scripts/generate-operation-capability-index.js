#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-operation-capability-index.js
 *
 * Generator for the Operation Capability Index (issue #416): reads the
 * committed openapi-export.json, classifies every operation via
 * src/operation-capability-classifier.js, and writes a versioned,
 * machine-readable artifact at operation-capability-index.json.
 *
 * Goal: every OpenAPI operation is represented in the index - either
 * agentable (with full routing/consequence/ranking metadata) or explicitly
 * marked `agentable: false` with a `nonAgentableReason`. Nothing is silently
 * dropped. Write- and process-capable operations are NOT hidden - see
 * docs/OPERATION_CAPABILITY_INDEX.md for the product principle behind this.
 *
 * Usage:
 *   node scripts/generate-operation-capability-index.js
 *   npm run generate:operation-capability-index
 *   node scripts/generate-operation-capability-index.js --check   (CI drift check, no write)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { version: packageVersion } = require('../package.json');
const { classifyOperation, OPERATION_KINDS } = require('../src/operation-capability-classifier');
const {
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
} = require('../src/capability-catalog');

const ROOT = path.join(__dirname, '..');
const OPENAPI_PATH = path.join(ROOT, 'openapi-export.json');
const OUTPUT_PATH = path.join(ROOT, 'operation-capability-index.json');

const ALL_CAPABILITIES = [...CURATED_CAPABILITIES, INTERFACE_PLACEHOLDER_CAPABILITY];

function hashText(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Extracts every raw (path, method) operation from the OpenAPI spec, carrying
// the fields src/operation-capability-classifier.js needs. Nothing is
// filtered out here - coverage accounting below relies on this being the
// complete raw surface.
function loadRawOperations(spec) {
  const operations = [];
  for (const apiPath of Object.keys(spec.paths || {})) {
    const pathItem = spec.paths[apiPath] || {};
    for (const method of Object.keys(pathItem)) {
      const op = pathItem[method] || {};
      operations.push({
        path: apiPath,
        method: method.toUpperCase(),
        operationId: op.operationId || `${method.toUpperCase()}_${apiPath}`,
        summary: op.summary || '',
        description: op.description || '',
        tags: Array.isArray(op.tags) ? op.tags : [],
        parameters: Array.isArray(op.parameters) ? op.parameters : [],
        requestBody: op.requestBody || null,
        'x-ui-page': op['x-ui-page'] || null,
        'x-oeo-class': op['x-oeo-class'] || null,
      });
    }
  }
  return operations;
}

// Groups operations sharing an operationId into one canonical entry (the
// shortest, alphabetically-first path) plus an `aliases` list for the rest -
// mirrors services/agent-manifest.service.js#dedupeOperations so operation
// counts line up with GET /api/_agent/operations. Aliases are NOT dropped:
// they are carried on the canonical entry so no route becomes invisible.
function dedupeOperations(operations) {
  const byOperationId = new Map();
  for (const op of operations) {
    const key = op.operationId || `${op.method} ${op.path}`;
    if (!byOperationId.has(key)) byOperationId.set(key, []);
    byOperationId.get(key).push(op);
  }

  const result = [];
  for (const group of byOperationId.values()) {
    const sorted = group
      .slice()
      .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
    const canonical = sorted[0];
    const aliases = sorted.slice(1).map((op) => `${op.method} ${op.path}`);
    result.push({ ...canonical, aliases });
  }

  return result.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function buildIndex() {
  const spec = JSON.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));
  const rawOperations = loadRawOperations(spec);
  const dedupedOperations = dedupeOperations(rawOperations);

  const entries = dedupedOperations.map((op) => {
    const { aliases, ...rest } = op;
    const classified = classifyOperation(rest, {
      curatedCapabilities: ALL_CAPABILITIES,
      allOperations: dedupedOperations,
    });
    return { ...classified, aliases };
  });

  return {
    rawOperationCount: rawOperations.length,
    deduplicatedOperationCount: dedupedOperations.length,
    entries,
  };
}

// Fails loudly (rather than silently under-covering) if any dedup'd
// operation was not produced, or an agentable:false entry has no reason.
function checkCoverage(entries, expectedCount) {
  const problems = [];

  if (entries.length !== expectedCount) {
    problems.push(`Expected ${expectedCount} deduplicated operations, got ${entries.length}.`);
  }

  for (const entry of entries) {
    if (!OPERATION_KINDS.includes(entry.operationKind)) {
      problems.push(
        `${entry.method} ${entry.path}: invalid operationKind "${entry.operationKind}".`
      );
    }
    if (entry.agentable === false && !entry.nonAgentableReason) {
      problems.push(
        `${entry.method} ${entry.path}: agentable=false requires a nonAgentableReason.`
      );
    }
  }

  return problems;
}

function main() {
  const checkOnly = process.argv.includes('--check');

  const { rawOperationCount, deduplicatedOperationCount, entries } = buildIndex();
  const problems = checkCoverage(entries, deduplicatedOperationCount);
  if (problems.length) {
    console.error('[generate-operation-capability-index] [FAIL] Coverage check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const agentableCount = entries.filter((e) => e.agentable).length;
  const kindCounts = {};
  for (const entry of entries) {
    kindCounts[entry.operationKind] = (kindCounts[entry.operationKind] || 0) + 1;
  }

  const artifact = {
    schemaVersion: 'cernion.operationCapabilityIndex.v1',
    generator: 'scripts/generate-operation-capability-index.js',
    packageVersion,
    sourceOpenApiHash: hashText(fs.readFileSync(OPENAPI_PATH, 'utf8')),
    coverage: {
      rawOperationCount,
      operationCount: entries.length,
      agentableCount,
      nonAgentableCount: entries.length - agentableCount,
      byOperationKind: kindCounts,
    },
    operations: entries,
  };

  const output = `${JSON.stringify(artifact, null, 2)}\n`;

  if (checkOnly) {
    const existing = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : null;
    if (existing !== output) {
      console.error(
        `[generate-operation-capability-index] [FAIL] ${path.relative(ROOT, OUTPUT_PATH)} is stale. Run: npm run generate:operation-capability-index`
      );
      process.exit(1);
    }
    console.log('[generate-operation-capability-index] [OK] Up to date.');
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(
    `[generate-operation-capability-index] [OK] Wrote ${entries.length} operation(s) (${agentableCount} agentable, ${
      entries.length - agentableCount
    } non-agentable) to ${path.relative(ROOT, OUTPUT_PATH)}`
  );
  console.log(`[generate-operation-capability-index]    By kind:`, kindCounts);
}

if (require.main === module) {
  main();
}

module.exports = { buildIndex, dedupeOperations, loadRawOperations, checkCoverage };
