'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');
const { parseMakoEvidence } = require('./mako-evidence-parser');

const EVIDENCE_TYPES = new Set([
  'aperak_message',
  'contrl_message',
  'mscons_message_status',
  'utilmd_master_data',
  'mako_process_trace',
  'mako_error_code_diagnosis',
  'market_partner_protocol',
  'mail_message',
  'mail_thread',
  'mail_attachment_metadata',
  'metering_values_export',
  'grid_connection_document',
  'public_web_page',
  'public_pdf_document',
  'market_registry_evidence',
  'grid_connection_public_context',
  'regulatory_publication',
  'calculation_assumption',
  'generic_document',
]);

const SOURCE_TYPES = new Set([
  'openwebui_file_ref',
  'external_url_ref',
  'manual_metadata',
  'uploaded_file',
  'existing_cet_evidence_ref',
  'willi_mako_ref',
  'web_fetch_ref',
  'web_url',
  'web_pdf',
  'public_registry_page',
  'public_document_page',
  'mail_ref',
]);

const SENSITIVITY_LEVELS = new Set(['public', 'tenant_internal', 'restricted', 'highly_sensitive']);

const SECRET_KEYS = /authorization|bearer|token|secret|password|api[_-]?key|cookie|credential/i;
const MAX_LABEL = 160;
const MAX_DESCRIPTION = 2000;
const MAX_FILE_NAME = 255;
const MAX_SUMMARY = 2000;
const MAX_FIELD = 500;

const SOURCE_REF_FIELDS = {
  openwebui_file_ref: ['fileId', 'fileName', 'mimeType', 'size', 'fileHash'],
  uploaded_file: ['fileId', 'fileName', 'mimeType', 'size', 'fileHash'],
  external_url_ref: ['url', 'title', 'retrievedAt', 'fileHash'],
  manual_metadata: ['safeSummary', 'reference', 'sourceLabel', 'fileHash'],
  existing_cet_evidence_ref: ['evidenceId', 'caseId', 'sourceLabel', 'fileHash'],
  web_fetch_ref: ['url', 'title', 'retrievedAt', 'contentType', 'statusCode', 'fileHash'],
  web_url: ['url', 'title', 'retrievedAt', 'contentType', 'statusCode', 'fileHash'],
  web_pdf: ['url', 'title', 'retrievedAt', 'contentType', 'statusCode', 'fileHash'],
  public_registry_page: ['url', 'title', 'retrievedAt', 'contentType', 'statusCode', 'fileHash'],
  public_document_page: ['url', 'title', 'retrievedAt', 'contentType', 'statusCode', 'fileHash'],
  mail_ref: [
    'mailAccountRef',
    'folder',
    'messageId',
    'threadId',
    'subject',
    'sender',
    'recipients',
    'date',
    'attachmentId',
    'fileName',
    'mimeType',
    'size',
    'query',
    'resultLimit',
    'retrievedAt',
    'fileHash',
  ],
  willi_mako_ref: [
    'williTenantRef',
    'williMandantId',
    'williSessionId',
    'williCaseRef',
    'messageId',
    'processRef',
    'messageType',
    'relatedMessageType',
    'errorCode',
    'segmentRef',
    'ahbVersion',
    'maloId',
    'meloId',
    'marketPartner',
    'direction',
    'timestamp',
    'title',
    'status',
    'cardUrl',
    'safeSummary',
    'fileHash',
  ],
};

const EXTRACT_FIELDS = {
  aperak_message: [
    'messageId',
    'processRef',
    'errorCode',
    'segmentRef',
    'ahbVersion',
    'marketPartner',
    'maloId',
    'meloId',
    'direction',
    'timestamp',
  ],
  contrl_message: ['messageId', 'relatedMessageId', 'status', 'processRef', 'marketPartner'],
  mscons_message_status: [
    'maloId',
    'obis',
    'from',
    'to',
    'status',
    'missingIntervals',
    'plausibilityStatus',
  ],
  utilmd_master_data: [
    'maloId',
    'meloId',
    'validFrom',
    'supplierId',
    'processDate',
    'changeReason',
  ],
  grid_connection_document: [
    'location',
    'requestedCapacityKw',
    'voltageLevel',
    'networkOperator',
    'documentDate',
  ],
  calculation_assumption: ['assumptionName', 'value', 'unit', 'validity', 'sourceLabel'],
  mako_error_code_diagnosis: [
    'messageId',
    'processRef',
    'messageType',
    'relatedMessageType',
    'errorCode',
    'segmentRef',
    'ahbVersion',
    'maloId',
    'meloId',
    'marketPartner',
    'direction',
    'timestamp',
    'safeSummary',
  ],
  mako_process_trace: ['processRef', 'messageId', 'messageType', 'status', 'marketPartner'],
  market_partner_protocol: ['marketPartner', 'processRef', 'status', 'timestamp', 'safeSummary'],
  mail_message: [
    'mailAccountRef',
    'folder',
    'messageId',
    'threadId',
    'subject',
    'sender',
    'recipients',
    'date',
    'safeSummary',
  ],
  mail_thread: ['mailAccountRef', 'folder', 'query', 'resultLimit', 'safeSummary'],
  mail_attachment_metadata: [
    'mailAccountRef',
    'folder',
    'messageId',
    'attachmentId',
    'fileName',
    'mimeType',
    'size',
    'safeSummary',
  ],
  metering_values_export: ['maloId', 'obis', 'from', 'to', 'status', 'plausibilityStatus'],
  public_web_page: ['url', 'title', 'retrievedAt', 'contentType', 'safeSummary'],
  public_pdf_document: ['url', 'title', 'retrievedAt', 'contentType', 'safeSummary'],
  market_registry_evidence: ['url', 'title', 'retrievedAt', 'contentType', 'safeSummary'],
  grid_connection_public_context: ['url', 'title', 'retrievedAt', 'contentType', 'safeSummary'],
  regulatory_publication: ['url', 'title', 'retrievedAt', 'contentType', 'safeSummary'],
  generic_document: ['sourceLabel', 'documentDate', 'safeSummary'],
};

function clientError(message, code = 422, type = 'WORKBENCH_EVIDENCE_INVALID') {
  return new Errors.MoleculerClientError(message, code, type);
}

function hashContent(value) {
  if (value == null) return null;
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function stableHash(value) {
  return hashContent(JSON.stringify(value));
}

function assertKnown(value, known, field) {
  if (!value || !known.has(value)) throw clientError(`Unsupported ${field}: ${value || 'missing'}`);
  return value;
}

function stringField(value, field, { max = MAX_FIELD, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw clientError(`${field} required`);
    return undefined;
  }
  if (typeof value !== 'string') throw clientError(`${field} must be a string`);
  const text = value.trim();
  if (!text) {
    if (required) throw clientError(`${field} required`);
    return undefined;
  }
  if (SECRET_KEYS.test(field) || SECRET_KEYS.test(text) || /^bearer\s+/i.test(text)) {
    throw clientError(`${field} must not contain secrets`);
  }
  if (text.length > max) throw clientError(`${field} too long`);
  return text;
}

function scalarField(value, field, { max = MAX_FIELD } = {}) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  return stringField(String(value), field, { max });
}

function sanitizeObject(input, allowedFields, prefix) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const output = {};
  for (const key of Object.keys(source)) {
    if (SECRET_KEYS.test(key)) throw clientError(`${prefix}.${key} must not contain secrets`);
    if (!allowedFields.includes(key)) continue;
    const max =
      key === 'fileName' ? MAX_FILE_NAME : key === 'safeSummary' ? MAX_SUMMARY : MAX_FIELD;
    const value = scalarField(source[key], `${prefix}.${key}`, { max });
    if (value !== undefined) output[key] = value;
  }
  return output;
}

function normalizeEvidenceType(value) {
  return assertKnown(value || 'generic_document', EVIDENCE_TYPES, 'evidenceType');
}

function normalizeSourceType(value) {
  return assertKnown(value || 'openwebui_file_ref', SOURCE_TYPES, 'sourceType');
}

function normalizeSensitivity(value) {
  return assertKnown(value || 'tenant_internal', SENSITIVITY_LEVELS, 'sensitivityLevel');
}

function assertSensitivityAllowed(sensitivityLevel, clearance = []) {
  if (sensitivityLevel === 'public' || sensitivityLevel === 'tenant_internal') return;
  if (!Array.isArray(clearance) || !clearance.includes(sensitivityLevel)) {
    throw new Errors.MoleculerClientError(
      'Workbench evidence sensitivity clearance required',
      403,
      'WORKBENCH_EVIDENCE_SENSITIVITY_DENIED'
    );
  }
}

function canViewEvidence(evidence, clearance = [], tenantId) {
  if (tenantId && evidence.tenantId !== tenantId) return false;
  return (
    evidence.sensitivityLevel === 'public' ||
    evidence.sensitivityLevel === 'tenant_internal' ||
    (Array.isArray(clearance) && clearance.includes(evidence.sensitivityLevel))
  );
}

function normalizeEvidenceInput(params, { tenantId, caseId, actorId, clearance = [] } = {}) {
  const evidenceType = normalizeEvidenceType(params.evidenceType);
  const sourceType = normalizeSourceType(params.sourceType);
  const sensitivityLevel = normalizeSensitivity(params.sensitivityLevel);
  assertSensitivityAllowed(sensitivityLevel, clearance);

  const sourceRef = sanitizeObject(
    params.sourceRef,
    SOURCE_REF_FIELDS[sourceType] || [],
    'sourceRef'
  );
  const inputExtracts = sanitizeObject(
    params.extracts || params.metadata,
    EXTRACT_FIELDS[evidenceType] || [],
    'extracts'
  );
  const parsedMako = parseMakoEvidence({
    evidenceType,
    sourceType,
    sourceRef,
    extracts: inputExtracts,
    metadata: { ...(params.metadata || {}), ...(params.extracts || {}) },
  });
  const extracts = { ...inputExtracts, ...parsedMako.extracts };
  const fileName = sourceRef.fileName || params.fileName || evidenceType;
  const label = stringField(params.label || fileName || evidenceType, 'label', {
    required: true,
    max: MAX_LABEL,
  });
  const description = stringField(params.description || '', 'description', {
    max: MAX_DESCRIPTION,
  });
  const safeSummary = stringField(
    params.safeSummary || sourceRef.safeSummary || extracts.safeSummary || '',
    'safeSummary',
    { max: MAX_SUMMARY }
  );
  const fileHash = stringField(
    params.fileHash || params.hash || sourceRef.fileHash || '',
    'fileHash',
    {
      max: 200,
    }
  );
  const hashStatus = fileHash ? 'provided' : 'unavailable';
  const provenance = {
    system: sourceType === 'willi_mako_ref' ? 'willi.cernion.de' : 'workbench',
    retrievalMode: sourceType === 'willi_mako_ref' ? 'reference' : sourceType,
    retrievedAt: new Date().toISOString(),
    retrievedBy: 'cet-workbench',
  };
  const evidenceRole =
    sourceType === 'willi_mako_ref' ? 'diagnostic_signal' : 'supporting_evidence';
  const claimStrength = sourceType === 'willi_mako_ref' ? 'supporting' : 'reference';
  const readinessReviewRequired =
    parsedMako.readinessReviewRequired ||
    isReviewRelevant({
      evidenceType,
      sourceType,
      sourceRef,
      extracts,
    });
  const sourceFingerprint = stableHash({
    tenantId,
    caseId,
    sourceType,
    evidenceType,
    fileHash,
    sourceRef,
    extracts,
  });

  return {
    evidenceId: params.evidenceId || crypto.randomUUID(),
    sourceType,
    sourceRef,
    extracts,
    evidenceType,
    label,
    description: description || '',
    safeSummary: safeSummary || undefined,
    sensitivityLevel,
    fileHash: fileHash || undefined,
    hash: fileHash || undefined,
    hashStatus,
    sourceFingerprint,
    provenance,
    evidenceRole,
    claimStrength,
    readinessReviewRequired,
    routingSignals: [
      ...new Set([
        ...routingSignalsFor({ evidenceType, sourceType, sourceRef, extracts }),
        ...parsedMako.routingSignals,
      ]),
    ],
    status: 'attached',
    actorId,
  };
}

function routingSignalsFor({ evidenceType, sourceType, sourceRef, extracts }) {
  const signals = [];
  const messageType = String(
    sourceRef.messageType || extracts.messageType || evidenceType
  ).toUpperCase();
  const errorCode = String(sourceRef.errorCode || extracts.errorCode || '').toUpperCase();
  if (
    sourceType === 'willi_mako_ref' ||
    [
      'aperak_message',
      'contrl_message',
      'mscons_message_status',
      'utilmd_master_data',
      'mako_error_code_diagnosis',
      'mako_process_trace',
    ].includes(evidenceType)
  ) {
    signals.push('market_communication');
  }
  if (messageType === 'APERAK' || evidenceType === 'aperak_message') signals.push('aperak');
  if (errorCode === 'Z18') signals.push('aperak_z18');
  if (sourceRef.maloId || sourceRef.meloId || extracts.maloId || extracts.meloId) {
    signals.push('market_master_data');
  }
  return [...new Set(signals)];
}

function isReviewRelevant({ evidenceType, sourceType, sourceRef, extracts }) {
  if (sourceType === 'willi_mako_ref') return true;
  if (
    [
      'aperak_message',
      'contrl_message',
      'mscons_message_status',
      'utilmd_master_data',
      'mako_error_code_diagnosis',
      'grid_connection_document',
      'calculation_assumption',
      'mail_message',
      'mail_thread',
      'mail_attachment_metadata',
    ].includes(evidenceType)
  ) {
    return true;
  }
  return Boolean(sourceRef.errorCode || extracts.errorCode);
}

function safeEvidenceRef(evidence, { clearance = [], tenantId } = {}) {
  if (!canViewEvidence(evidence, clearance, tenantId)) {
    return {
      evidenceId: evidence.evidenceId,
      caseId: evidence.caseId,
      type: evidence.evidenceType,
      evidenceType: evidence.evidenceType,
      label: 'Restricted evidence',
      status: 'restricted',
      sensitivityLevel: evidence.sensitivityLevel,
      redacted: true,
      createdAt: evidence.createdAt,
    };
  }
  return {
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    type: evidence.evidenceType,
    evidenceType: evidence.evidenceType,
    label: evidence.label,
    description: evidence.description || undefined,
    status: evidence.status,
    sourceType: evidence.sourceType,
    sourceRef: evidence.sourceRef || {},
    sensitivityLevel: evidence.sensitivityLevel,
    sourceFingerprint: evidence.sourceFingerprint,
    fileHash: evidence.fileHash,
    hashStatus: evidence.hashStatus,
    provenance: evidence.provenance,
    evidenceRole: evidence.evidenceRole,
    claimStrength: evidence.claimStrength,
    safeSummary: evidence.safeSummary,
    extracts: evidence.extracts?.document
      ? {
          ...evidence.extracts,
          document: {
            name: evidence.extracts.document.name,
            completeness: evidence.extracts.document.completeness,
            characterCount: evidence.extracts.document.text?.length || 0,
            sectionCount: evidence.extracts.document.sections?.length || 0,
          },
        }
      : evidence.extracts || {},
    routingSignals: evidence.routingSignals || [],
    readinessReviewRequired: !!evidence.readinessReviewRequired,
    duplicateOf: evidence.duplicateOf,
    createdAt: evidence.createdAt,
  };
}

module.exports = {
  EVIDENCE_TYPES,
  SOURCE_TYPES,
  SENSITIVITY_LEVELS,
  normalizeEvidenceInput,
  hashContent,
  safeEvidenceRef,
  canViewEvidence,
  assertSensitivityAllowed,
};
