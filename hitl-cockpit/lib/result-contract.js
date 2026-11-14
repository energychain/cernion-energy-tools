'use strict';

const { containsPrivateMarker } = require('./assistant-action-executor');

const RESULT_STATUSES = Object.freeze(['completed', 'blocked', 'needs_decision', 'continuing']);
const RESULT_BLOCK_START = '---BEGIN AGENT RESULT---';
const RESULT_BLOCK_END = '---END AGENT RESULT---';
const HANDOFF_MARKER_PREFIX = 'ASSISTANT_MATRIX_HANDOFF';
const IDENTIFIER = /^[a-z0-9][a-z0-9_.:-]{2,255}$/i;
const RESERVED_MARKER =
  /(?:OUTCOME_|AGENT_RESULT_|ASSISTANT_MATRIX_HANDOFF|PARENT_RESULT_ID|SOURCE_TASK_ID|RESULT_OPERATION_ID|---(?:BEGIN|END) AGENT RESULT)/i;

function assertMarkerSafe(value, field = 'marker_value') {
  if (
    typeof value !== 'string' ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) ||
    RESERVED_MARKER.test(value.normalize('NFKC'))
  ) {
    throw new ResultContractError(`${field}_unsafe`);
  }
  return value;
}

class ResultContractError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ResultContractError';
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, field, options = {}) {
  if (typeof value === 'string') assertMarkerSafe(value, field);
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text && options.required !== false) throw new ResultContractError(`${field}_required`);
  if (text.length > (options.max || 4000)) throw new ResultContractError(`${field}_too_long`);
  return text || null;
}

function identifier(value, field, required = true) {
  if ((value === null || value === undefined || value === '') && !required) return null;
  const text = cleanText(value, field, { max: 256 });
  if (!IDENTIFIER.test(text)) throw new ResultContractError(`${field}_invalid`);
  return text;
}

function evidenceReferences(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new ResultContractError('evidence_refs_invalid');
  }
  return Array.from(new Set(value.map((item) => cleanText(item, 'evidence_ref', { max: 2000 }))));
}

function isMaterialEvidence(value) {
  const evidence = String(value || '').trim();
  if (/^https?:\/\/\S+$/i.test(evidence)) return true;
  if (/^(?:kanban|task):/i.test(evidence)) return false;
  return /^[a-z][a-z0-9_-]*-?(?:id)?\s*[:=]\s*.{3,}$/i.test(evidence);
}

function normalizeOccurredAt(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) throw new ResultContractError('occurred_at_invalid');
  return Math.floor(parsed / 1000);
}

function validateResultContract(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ResultContractError('result_contract_invalid');
  }
  const allowed = new Set([
    'proposalId',
    'handoffId',
    'sourceBoard',
    'sourceTaskId',
    'status',
    'statement',
    'evidenceRefs',
    'nextStep',
    'responsibleAgent',
    'occurredAt',
    'outcomeCandidate',
    'managementDecision',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new ResultContractError('result_contract_unknown_field');
  }
  const proposalId = identifier(input.proposalId, 'proposal_id', false);
  const handoffId = identifier(input.handoffId, 'handoff_id', false);
  if (!proposalId && !handoffId) throw new ResultContractError('result_correlation_id_required');
  if (proposalId && handoffId && proposalId !== handoffId) {
    throw new ResultContractError('result_correlation_id_mismatch');
  }
  const status = String(input.status || '').trim();
  if (!RESULT_STATUSES.includes(status)) throw new ResultContractError('result_status_invalid');
  const contract = {
    proposalId: proposalId || handoffId,
    handoffId: handoffId || proposalId,
    sourceBoard: identifier(input.sourceBoard, 'source_board'),
    sourceTaskId: identifier(input.sourceTaskId, 'source_task_id'),
    status,
    statement: cleanText(input.statement, 'statement'),
    evidenceRefs: evidenceReferences(input.evidenceRefs || []),
    nextStep: cleanText(input.nextStep, 'next_step', { required: false }),
    responsibleAgent: identifier(input.responsibleAgent, 'responsible_agent'),
    occurredAt: normalizeOccurredAt(input.occurredAt),
    outcomeCandidate: input.outcomeCandidate || null,
    managementDecision: input.managementDecision || null,
  };
  if (status === 'completed' && !contract.evidenceRefs.some(isMaterialEvidence)) {
    throw new ResultContractError('material_evidence_missing', 422);
  }
  if (status !== 'completed' && !contract.nextStep) {
    throw new ResultContractError('next_step_required', 422);
  }
  if (status === 'blocked' && !/[?？]\s*$/.test(contract.nextStep)) {
    throw new ResultContractError('concrete_question_required', 422);
  }
  if (contract.outcomeCandidate !== null) {
    if (
      !contract.outcomeCandidate ||
      typeof contract.outcomeCandidate !== 'object' ||
      Array.isArray(contract.outcomeCandidate)
    ) {
      throw new ResultContractError('outcome_candidate_invalid');
    }
    const type = identifier(contract.outcomeCandidate.type, 'outcome_type');
    const statement = cleanText(contract.outcomeCandidate.statement, 'outcome_statement');
    contract.outcomeCandidate = { type, statement };
  }
  if (containsPrivateMarker(contract))
    throw new ResultContractError('private_result_rejected', 403);
  return Object.freeze(contract);
}

function parseResultBlock(text) {
  const body = String(text || '');
  const start = body.indexOf(RESULT_BLOCK_START);
  const end = body.indexOf(RESULT_BLOCK_END);
  if (start < 0 || end < 0) return null;
  if (
    body.indexOf(RESULT_BLOCK_START, start + RESULT_BLOCK_START.length) >= 0 ||
    body.indexOf(RESULT_BLOCK_END, end + RESULT_BLOCK_END.length) >= 0 ||
    end <= start
  ) {
    throw new ResultContractError('result_block_ambiguous');
  }
  const raw = body.slice(start + RESULT_BLOCK_START.length, end).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new ResultContractError('result_json_invalid');
  }
  return validateResultContract(parsed);
}

function handoffMarker(handoffId) {
  return `${HANDOFF_MARKER_PREFIX}:${identifier(handoffId, 'handoff_id')}`;
}

function hasExactHandoffMarker(text, handoffId) {
  const expected = handoffMarker(handoffId);
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === expected);
}

function formatResultBlock(contract) {
  return [
    RESULT_BLOCK_START,
    JSON.stringify(validateResultContract(contract)),
    RESULT_BLOCK_END,
  ].join('\n');
}

module.exports = {
  assertMarkerSafe,
  HANDOFF_MARKER_PREFIX,
  RESULT_BLOCK_END,
  RESULT_BLOCK_START,
  RESULT_STATUSES,
  ResultContractError,
  formatResultBlock,
  handoffMarker,
  hasExactHandoffMarker,
  isMaterialEvidence,
  parseResultBlock,
  validateResultContract,
};
