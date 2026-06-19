'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateTenantId } = require('./tenant-context');

const DEFAULT_TENANT_REGISTRY_FILE =
  process.env.CERNION_TENANT_REGISTRY_FILE || './uploads/.api-tenants.json';
const DEFAULT_USER_REGISTRY_FILE =
  process.env.CERNION_USER_REGISTRY_FILE || './uploads/.api-users.json';
const USER_ID_PATTERN = /^[a-zA-Z0-9_.@:-]{1,120}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowIso() {
  return new Date().toISOString();
}

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function saveJsonArray(filePath, rows) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

function validateSupportToken(providedToken, env = process.env) {
  const configured = String(env.CERNION_SUPPORT_TOKEN || '');
  const provided = String(providedToken || env.CERNION_SUPPORT_TOKEN_INPUT || '');

  if (!configured) {
    throw new Error('CERNION_SUPPORT_TOKEN is required for bootstrap provisioning.');
  }
  if (!provided) {
    throw new Error(
      'A support token must be provided via --support-token or CERNION_SUPPORT_TOKEN_INPUT.'
    );
  }

  const configuredHash = crypto.createHash('sha256').update(configured, 'utf8').digest();
  const providedHash = crypto.createHash('sha256').update(provided, 'utf8').digest();
  if (!crypto.timingSafeEqual(configuredHash, providedHash)) {
    throw new Error('Invalid support token.');
  }
  return true;
}

function validateUserId(userId) {
  const value = String(userId || '').trim();
  if (!USER_ID_PATTERN.test(value)) {
    throw new Error(`Invalid userId '${userId}'.`);
  }
  return value;
}

function validateEmail(email) {
  if (email == null || email === '') return null;
  const value = String(email).trim();
  if (!EMAIL_PATTERN.test(value)) {
    throw new Error(`Invalid email '${email}'.`);
  }
  return value;
}

function normalizeTenantId(tenantId) {
  const value = String(tenantId || '')
    .trim()
    .toLowerCase();
  validateTenantId(value);
  if (!value) {
    throw new Error('tenantId is required.');
  }
  return value;
}

function upsertTenant({ tenantId, name = null, registryFile = DEFAULT_TENANT_REGISTRY_FILE }) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const rows = loadJsonArray(registryFile);
  const now = nowIso();
  const existingIndex = rows.findIndex((row) => row.tenantId === normalizedTenantId);
  const existing = existingIndex >= 0 ? rows[existingIndex] : null;
  const record = {
    tenantId: normalizedTenantId,
    name: name ? String(name).trim() : existing?.name || normalizedTenantId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    source: 'support-cli',
  };

  if (existingIndex >= 0) rows[existingIndex] = { ...existing, ...record };
  else rows.push(record);
  saveJsonArray(registryFile, rows);
  return record;
}

function upsertUser({ tenantId, userId, email = null, registryFile = DEFAULT_USER_REGISTRY_FILE }) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedUserId = validateUserId(userId);
  const normalizedEmail = validateEmail(email);
  const rows = loadJsonArray(registryFile);
  const now = nowIso();
  const existingIndex = rows.findIndex(
    (row) => row.tenantId === normalizedTenantId && row.userId === normalizedUserId
  );
  const existing = existingIndex >= 0 ? rows[existingIndex] : null;
  const record = {
    tenantId: normalizedTenantId,
    userId: normalizedUserId,
    email: normalizedEmail,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    source: 'support-cli',
  };

  if (existingIndex >= 0) rows[existingIndex] = { ...existing, ...record };
  else rows.push(record);
  saveJsonArray(registryFile, rows);
  return record;
}

function tenantExistsInRegistry(tenantId, registryFile = DEFAULT_TENANT_REGISTRY_FILE) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  return loadJsonArray(registryFile).some((row) => row.tenantId === normalizedTenantId);
}

module.exports = {
  DEFAULT_TENANT_REGISTRY_FILE,
  DEFAULT_USER_REGISTRY_FILE,
  validateSupportToken,
  validateUserId,
  normalizeTenantId,
  upsertTenant,
  upsertUser,
  tenantExistsInRegistry,
};
