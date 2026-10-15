'use strict';

const { Errors } = require('moleculer');
const quotaStore = require('./rate-quota-store');
const { assertSensitivityAllowed } = require('./workbench-evidence');

const ingestCapability = Symbol('project-ingest');
const objectCapability = Symbol('project-object-store');
const hashParam = { type: 'string', pattern: /^[a-f0-9]{64}$/ };
const uploadParam = { type: 'string', pattern: /^[a-f0-9-]{36}$/ };
const defaults = {
  max_bytes: 2 * 1024 ** 3,
  max_files: 10000,
  max_file_bytes: 2 * 1024 ** 3,
  chunk_bytes: 8 * 1024 ** 2,
};

function ingestError(message, code = 422, type = 'PROJECT_INGEST_INVALID') {
  throw new Errors.MoleculerClientError(message, code, type);
}

function setting(name, fallback) {
  const n = Number(process.env[`CET_PROJECT_${name}`] || fallback);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid CET_PROJECT_${name}`);
  return n;
}

function limits(tenantId) {
  const quotas = quotaStore.getTenantState(tenantId).config?.quotas || {};
  const result = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      quotas[`project_${key}`] || setting(key.toUpperCase(), fallback),
    ])
  );
  // Bound metadata growth and individual requests even with a misconfigured override.
  result.chunk_bytes = Math.min(64 * 1024 ** 2, Math.max(64 * 1024, result.chunk_bytes));
  result.max_bytes = Math.min(2 * 1024 ** 3, result.max_bytes);
  result.max_file_bytes = Math.min(result.max_bytes, result.max_file_bytes);
  return result;
}

function safeName(name) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 200 ||
    /[\\/\x00-\x1f\x7f]/.test(name) ||
    name === '.' ||
    name === '..'
  )
    ingestError('Invalid object name');
  return name;
}

function assertObjectSensitivity(object, p) {
  for (const level of [object.sensitivityLevel, ...(object.requiredClearance || [])])
    assertSensitivityAllowed(level, p.clearance);
}

function publicObject(record) {
  const { _id, _rev, expiresAt, job, ...object } = record;
  return object;
}

module.exports = {
  ingestCapability,
  objectCapability,
  hashParam,
  uploadParam,
  defaults,
  ingestError,
  setting,
  limits,
  safeName,
  assertObjectSensitivity,
  publicObject,
};
