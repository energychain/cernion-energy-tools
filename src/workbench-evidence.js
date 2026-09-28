'use strict';

const crypto = require('crypto');

function hashContent(value) {
  if (value == null) return null;
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function normalizeEvidenceInput(params) {
  const sourceType = params.sourceType || 'openwebui_file_ref';
  const evidenceType = params.evidenceType || 'generic_document';
  const sourceRef =
    params.sourceRef && typeof params.sourceRef === 'object' ? params.sourceRef : {};
  const fileName = sourceRef.fileName || params.fileName || evidenceType;
  return {
    evidenceId: params.evidenceId || crypto.randomUUID(),
    sourceType,
    sourceRef,
    evidenceType,
    label: params.label || fileName || evidenceType,
    description: params.description || '',
    sensitivityLevel: params.sensitivityLevel || 'tenant_internal',
    hash: params.content ? hashContent(params.content) : params.hash || 'hashPending',
    status: 'attached',
  };
}

module.exports = { normalizeEvidenceInput, hashContent };
