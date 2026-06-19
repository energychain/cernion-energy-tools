'use strict';

require('dotenv').config({ quiet: true });

const { validateSupportToken } = require('../src/provisioning-registry');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 2) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function requireSupport(args) {
  validateSupportToken(args['support-token']);
}

function required(args, key) {
  const value = args[key];
  if (value == null || value === true || String(value).trim() === '') {
    throw new Error(`Missing required --${key}.`);
  }
  return String(value).trim();
}

function optional(args, key, fallback = null) {
  const value = args[key];
  if (value == null || value === true || String(value).trim() === '') return fallback;
  return String(value).trim();
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(err) {
  process.stderr.write(`${err.message || err}\n`);
  process.exitCode = 1;
}

module.exports = {
  parseArgs,
  requireSupport,
  required,
  optional,
  printJson,
  fail,
};
