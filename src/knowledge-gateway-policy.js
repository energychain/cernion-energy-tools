'use strict';

// Knowledge Gateway contract (#CernionWebUI B): opaque IDs, ACL, projections. Tenant and actor
// always come from the authenticated principal; foreign or unknown resources are 404, never 403.

const { createHash, randomBytes } = require('node:crypto');
const { Errors } = require('moleculer');
const { assertSensitivityAllowed } = require('./workbench-evidence');

const ID_PATTERNS = Object.freeze({
  kb: /^kb_[a-f0-9]{24}$/,
  doc: /^doc_[a-f0-9]{24}$/,
  cit: /^cit_[a-f0-9]{32}$/,
});
const VISIBILITIES = ['private', 'tenant', 'restricted'];
const DOCUMENT_STATUSES = [
  'queued',
  'extracting',
  'embedding',
  'ready',
  'failed',
  'deleting',
  'deleted',
];
const ACL_LIMIT = 200;

function newId(kind) {
  return `${kind}_${randomBytes(12).toString('hex')}`;
}

function notFound() {
  throw new Errors.MoleculerClientError('Nicht gefunden.', 404, 'KNOWLEDGE_NOT_FOUND');
}

function invalid(message, status = 422, type = 'KNOWLEDGE_INVALID') {
  throw new Errors.MoleculerClientError(message, status, type);
}

// Malformed IDs are indistinguishable from foreign ones.
function opaqueId(kind, value) {
  if (typeof value !== 'string' || !ID_PATTERNS[kind].test(value)) notFound();
  return value;
}

function cleanText(value, { max, required = false, field }) {
  if (value == null || value === '') {
    if (required) invalid(`${field} fehlt.`);
    return '';
  }
  if (typeof value !== 'string') invalid(`${field} muss Text sein.`);
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (required && !text) invalid(`${field} fehlt.`);
  if (text.length > max) invalid(`${field} ist zu lang (höchstens ${max} Zeichen).`);
  return text;
}

function stringList(value, field, normalize = (item) => item) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > ACL_LIMIT)
    invalid(`${field} muss eine Liste mit höchstens ${ACL_LIMIT} Einträgen sein.`);
  return [
    ...new Set(
      value.map((item) => {
        if (typeof item !== 'string' || !item.trim() || item.length > 200)
          invalid(`${field} enthält einen ungültigen Eintrag.`);
        return normalize(item.trim());
      })
    ),
  ];
}

function normalizeAcl(acl = {}) {
  if (acl == null || typeof acl !== 'object' || Array.isArray(acl)) invalid('acl ist ungültig.');
  return {
    actorIds: stringList(acl.actorIds, 'acl.actorIds'),
    roles: stringList(acl.roles, 'acl.roles', (role) => {
      const upper = role.toUpperCase();
      if (!/^ROLE_[A-Z_]+$/.test(upper)) invalid('acl.roles enthält eine ungültige Rolle.');
      return upper;
    }),
    groups: stringList(acl.groups, 'acl.groups'),
  };
}

function normalizeVisibility(value, fallback = 'private') {
  const visibility = value ?? fallback;
  if (!VISIBILITIES.includes(visibility))
    invalid(`visibility muss ${VISIBILITIES.join(', ')} sein.`);
  return visibility;
}

function sameTenant(p, record) {
  return Boolean(record && p?.tenantId && record.tenantId === p.tenantId);
}

function canRead(p, kb) {
  if (!sameTenant(p, kb) || kb.status !== 'active') return false;
  if (kb.ownerActorId === p.actorId) return true;
  if (kb.visibility === 'tenant') return true;
  if (kb.visibility !== 'restricted') return false;
  const acl = kb.acl || {};
  return (
    (acl.actorIds || []).includes(p.actorId) ||
    (acl.roles || []).some((role) => (p.roles || []).includes(role)) ||
    (acl.groups || []).some((group) => (p.groups || []).includes(group))
  );
}

// Changing a knowledge base and its documents stays with its owner in the MVP.
function canManage(p, kb) {
  return sameTenant(p, kb) && kb.status === 'active' && kb.ownerActorId === p.actorId;
}

function clearanceAllows(p, doc) {
  try {
    assertSensitivityAllowed(doc.sensitivityLevel || 'tenant_internal', p.clearance);
    for (const level of doc.requiredClearance || []) assertSensitivityAllowed(level, p.clearance);
    return true;
  } catch (_error) {
    return false;
  }
}

// Searchable: an active generation exists and no deletion has started (tombstones act at once).
function searchable(p, doc) {
  return (
    sameTenant(p, doc) &&
    Boolean(doc.active) &&
    !['deleting', 'deleted'].includes(doc.status) &&
    clearanceAllows(p, doc)
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function citationId(tenantId, chunkKey) {
  return `cit_${sha256(`${tenantId}|${chunkKey}`).slice(0, 32)}`;
}

function kbView(kb) {
  return {
    knowledgeBaseId: kb.knowledgeBaseId,
    name: kb.name,
    description: kb.description,
    ownerActorId: kb.ownerActorId,
    visibility: kb.visibility,
    acl: kb.acl,
    defaultForChat: kb.defaultForChat,
    status: kb.status,
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  };
}

function docView(doc) {
  return {
    documentId: doc.documentId,
    knowledgeBaseId: doc.knowledgeBaseId,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    source: {
      type: doc.source.type,
      externalId: doc.source.externalId,
      version: doc.source.version,
    },
    sha256: `sha256:${doc.sha256}`,
    status: doc.status,
    chunkCount: doc.active?.chunkCount ?? 0,
    ingestedBy: doc.ingestedBy,
    ingestedAt: doc.ingestedAt,
    ...(doc.error ? { error: doc.error } : {}),
  };
}

// Only allowlisted fields leave the gateway: no vectors, tenants, namespaces or raw metadata.
function resultView({ citation, kb, doc, chunk, score }) {
  return {
    citationId: citation,
    knowledgeBaseId: kb.knowledgeBaseId,
    documentId: doc.documentId,
    chunkId: chunk.chunkId,
    content: chunk.content,
    title: doc.title || doc.fileName,
    score: Math.round(score * 1000) / 1000,
    location: {
      chunkIndex: chunk.chunkIndex,
      ...(chunk.section ? { section: chunk.section } : {}),
    },
    source: {
      type: doc.source.type,
      name: doc.fileName,
      version: doc.active.version,
      sha256: `sha256:${doc.active.sha256}`,
      ingestedAt: doc.active.ingestedAt,
    },
  };
}

module.exports = {
  ID_PATTERNS,
  VISIBILITIES,
  DOCUMENT_STATUSES,
  newId,
  notFound,
  invalid,
  opaqueId,
  cleanText,
  normalizeAcl,
  normalizeVisibility,
  canRead,
  canManage,
  searchable,
  sha256,
  citationId,
  kbView,
  docView,
  resultView,
};
