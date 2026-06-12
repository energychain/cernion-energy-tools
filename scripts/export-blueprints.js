#!/usr/bin/env node
'use strict';

/**
 * scripts/export-blueprints.js
 *
 * Exports active blueprints from the Blueprint Management REST API and writes
 * them as deterministic pretty-printed JSON files to the target directory.
 *
 * Usage:
 *   node scripts/export-blueprints.js [--base-url <url>] [--out <dir>]
 *   npm run blueprint:export -- --base-url http://127.0.0.1:3900 --out src/blueprints
 *
 * Exit code 0: all blueprints exported successfully (or none found).
 * Exit code 1: one or more blueprints failed to export.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Parse --key value pairs from an argv array (process.argv.slice(2) format).
 */
function parseArgs(argv) {
  const args = { baseUrl: 'http://127.0.0.1:3900', out: 'src/blueprints' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url' && argv[i + 1]) {
      args.baseUrl = argv[++i];
    } else if (argv[i] === '--out' && argv[i + 1]) {
      args.out = argv[++i];
    }
  }
  return args;
}

/**
 * Fetch the list of active blueprint IDs from the management API.
 * @param {string} baseUrl
 * @returns {Promise<string[]>}
 */
async function fetchActiveBlueprintIds(baseUrl) {
  const url = `${baseUrl}/api/blueprint-management?includeDrafts=false&includeActive=true`;
  const response = await axios.get(url, { timeout: 15000 });
  const data = response.data;

  // Accept plain array, { data: [...] } (current API), { blueprints: [...] }, { items: [...] }
  const list = Array.isArray(data) ? data : (data.data ?? data.blueprints ?? data.items ?? []);
  return list.map((b) => b.blueprintId ?? b.id).filter(Boolean);
}

/**
 * Fetch the full blueprint object for a given ID and extract the `blueprint` field.
 * @param {string} baseUrl
 * @param {string} blueprintId
 * @returns {Promise<object>}
 */
async function fetchBlueprint(baseUrl, blueprintId) {
  const url = `${baseUrl}/api/blueprint-management/${encodeURIComponent(blueprintId)}`;
  const response = await axios.get(url, { timeout: 15000 });
  const data = response.data;

  if (!data.blueprint) {
    throw new Error(`Response for '${blueprintId}' has no 'blueprint' field`);
  }
  return data.blueprint;
}

/**
 * Core export logic — separated from CLI wiring for testability.
 *
 * @param {object} options
 * @param {string} options.baseUrl  Base URL of the running Cernion server.
 * @param {string} options.out      Output directory for the JSON files.
 * @param {object} [options._fs]    fs override for testing.
 * @returns {Promise<{ written: string[], errors: { id: string, message: string }[] }>}
 */
async function exportBlueprints({ baseUrl, out, _fs: fsImpl = fs }) {
  const written = [];
  const errors = [];

  fsImpl.mkdirSync(out, { recursive: true });

  let ids;
  try {
    ids = await fetchActiveBlueprintIds(baseUrl);
  } catch (err) {
    throw new Error(`Failed to list blueprints from ${baseUrl}: ${err.message}`);
  }

  for (const id of ids) {
    try {
      const blueprint = await fetchBlueprint(baseUrl, id);
      const filePath = path.join(out, `${id}.json`);
      const content = JSON.stringify(blueprint, null, 2) + '\n';
      fsImpl.writeFileSync(filePath, content, 'utf8');
      written.push(filePath);
    } catch (err) {
      errors.push({ id, message: err.message });
    }
  }

  return { written, errors };
}

/**
 * CLI entry point.
 */
async function main() {
  const { baseUrl, out } = parseArgs(process.argv.slice(2));

  console.log(`Blueprint Export — base-url: ${baseUrl}  out: ${out}`);

  let result;
  try {
    result = await exportBlueprints({ baseUrl, out });
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const { written, errors } = result;

  console.log(`\nExported: ${written.length} blueprint(s)`);
  for (const f of written) {
    console.log(`  + ${f}`);
  }

  if (errors.length > 0) {
    console.error(`\nFailed: ${errors.length} blueprint(s)`);
    for (const e of errors) {
      console.error(`  ! ${e.id}: ${e.message}`);
    }
    process.exitCode = 1;
  }
}

// Allow require() for testing without executing main()
if (require.main === module) {
  main().catch((err) => {
    console.error(`[FATAL] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { exportBlueprints, fetchActiveBlueprintIds, fetchBlueprint, parseArgs };
