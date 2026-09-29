'use strict';

const MAKO_EVIDENCE_TYPES = new Set([
  'aperak_message',
  'contrl_message',
  'mscons_message_status',
  'utilmd_master_data',
  'mako_process_trace',
  'mako_error_code_diagnosis',
  'market_partner_protocol',
]);

const MESSAGE_TYPE_BY_EVIDENCE = {
  aperak_message: 'APERAK',
  contrl_message: 'CONTRL',
  mscons_message_status: 'MSCONS',
  utilmd_master_data: 'UTILMD',
};

const FIELD_ALIASES = {
  messageId: ['messageId', 'nachrichtenId', 'nachrichtId', 'msgId'],
  relatedMessageId: ['relatedMessageId', 'referencedMessageId', 'refMessageId'],
  processRef: ['processRef', 'processReference', 'vorgangsnummer', 'transactionId'],
  messageType: ['messageType', 'nachrichtentyp'],
  relatedMessageType: ['relatedMessageType', 'relatedType'],
  errorCode: ['errorCode', 'fehlerCode', 'fehlercode', 'code'],
  segmentRef: ['segmentRef', 'segmentReference', 'segment'],
  ahbVersion: ['ahbVersion', 'ahb', 'ahbStand'],
  maloId: ['maloId', 'maLoId', 'marktlokation', 'marktlokationsId'],
  meloId: ['meloId', 'meLoId', 'messlokation', 'messlokationsId'],
  marketPartner: ['marketPartner', 'marktpartner', 'partner'],
  direction: ['direction', 'richtung'],
  timestamp: ['timestamp', 'date', 'createdAt', 'receivedAt', 'sentAt'],
  status: ['status', 'messageStatus'],
  obis: ['obis'],
  from: ['from', 'start', 'validFrom'],
  to: ['to', 'end', 'validTo'],
  missingIntervals: ['missingIntervals'],
  plausibilityStatus: ['plausibilityStatus'],
  validFrom: ['validFrom', 'gueltigAb'],
  supplierId: ['supplierId', 'lieferantId'],
  processDate: ['processDate'],
  changeReason: ['changeReason'],
  safeSummary: ['safeSummary', 'summary'],
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cleanScalar(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value).trim();
  return text ? text.slice(0, 500) : undefined;
}

function pickField(field, ...sources) {
  const aliases = FIELD_ALIASES[field] || [field];
  for (const source of sources) {
    if (!isObject(source)) continue;
    for (const key of aliases) {
      const value = cleanScalar(source[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function normalizeMessageType(value) {
  const text = cleanScalar(value);
  return text ? String(text).toUpperCase() : undefined;
}

function parseMakoEvidence({
  evidenceType,
  sourceType,
  sourceRef = {},
  extracts = {},
  metadata = {},
} = {}) {
  const isMakoSource = sourceType === 'willi_mako_ref';
  const isMakoEvidence = MAKO_EVIDENCE_TYPES.has(evidenceType);
  if (!isMakoSource && !isMakoEvidence) {
    return { extracts: {}, routingSignals: [], readinessReviewRequired: false };
  }

  const parsed = {};
  const fields = new Set([
    'messageId',
    'relatedMessageId',
    'processRef',
    'errorCode',
    'segmentRef',
    'ahbVersion',
    'maloId',
    'meloId',
    'marketPartner',
    'direction',
    'timestamp',
    'status',
    'obis',
    'from',
    'to',
    'missingIntervals',
    'plausibilityStatus',
    'validFrom',
    'supplierId',
    'processDate',
    'changeReason',
    'safeSummary',
  ]);

  for (const field of fields) {
    const value = pickField(field, extracts, sourceRef, metadata);
    if (value !== undefined) parsed[field] = value;
  }

  parsed.messageType =
    normalizeMessageType(pickField('messageType', extracts, sourceRef, metadata)) ||
    MESSAGE_TYPE_BY_EVIDENCE[evidenceType] ||
    (isMakoSource ? normalizeMessageType(sourceRef.messageType) : undefined);
  const relatedType = normalizeMessageType(
    pickField('relatedMessageType', extracts, sourceRef, metadata)
  );
  if (relatedType) parsed.relatedMessageType = relatedType;
  if (parsed.errorCode) parsed.errorCode = String(parsed.errorCode).toUpperCase();

  const routingSignals = ['market_communication'];
  if (parsed.messageType === 'APERAK' || evidenceType === 'aperak_message')
    routingSignals.push('aperak');
  if (parsed.messageType === 'CONTRL' || evidenceType === 'contrl_message')
    routingSignals.push('contrl');
  if (parsed.messageType === 'MSCONS' || evidenceType === 'mscons_message_status')
    routingSignals.push('mscons');
  if (parsed.messageType === 'UTILMD' || evidenceType === 'utilmd_master_data')
    routingSignals.push('utilmd');
  if (parsed.errorCode === 'Z18') routingSignals.push('aperak_z18');
  if (parsed.maloId || parsed.meloId || parsed.validFrom || parsed.changeReason) {
    routingSignals.push('market_master_data');
  }
  if (isMakoSource) routingSignals.push('willi_mako');

  return {
    extracts: parsed,
    routingSignals: [...new Set(routingSignals)],
    readinessReviewRequired: true,
  };
}

module.exports = {
  parseMakoEvidence,
  MAKO_EVIDENCE_TYPES,
};
