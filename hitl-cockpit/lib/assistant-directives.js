'use strict';

const crypto = require('node:crypto');

const ALLOWED_INTENTS = Object.freeze([
  'answer_only',
  'request_clarification',
  'record_feedback',
  'delegate',
  'create_followup',
  'schedule_wakeup',
  'prepare_decision',
  'mark_no_action',
  'change_priority',
]);
const PROPOSAL_INTENTS = new Set(ALLOWED_INTENTS.slice(2));
const TARGET_TYPES = new Set(['topic', 'decision', 'department', 'outcome', 'risk', 'wakeup']);
const FORBIDDEN_KEYS =
  /(?:^|_)(?:scope|price|tariff|contract|payment|publish|send|deploy|secret|credential|token|matrix_room|board)(?:$|_)/i;
const SUCCESS_CLAIM =
  /\b(?:executed|completed|finished|sent|published|deployed|created|delegated|scheduled|recorded|erledigt|ausgeführt|beauftragt|delegiert|versandt|gesendet|veröffentlicht|deployt|angelegt|erstellt|eingetragen|terminiert)\b/i;
const PROPOSAL_WORDING =
  /\b(?:propos(?:e|ed|al)|suggest(?:ion|ed)?|would|draft|shadow|vorschlag|schlage\s+vor|würde|entwurf)\b/i;
const NEGATED_SUCCESS =
  /\b(?:not|no|nicht|kein(?:e[nsrm]?)?|weder)\b.{0,32}\b(?:executed|completed|sent|published|deployed|created|delegated|scheduled|recorded|erledigt|ausgeführt|beauftragt|delegiert|versandt|gesendet|veröffentlicht|deployt|angelegt|erstellt|eingetragen|terminiert)\b/i;

const PAYLOAD_SCHEMAS = Object.freeze({
  answer_only: {},
  request_clarification: { optional: { question: 'string' } },
  record_feedback: { required: { feedback: 'string' } },
  delegate: { required: { assignee: 'string' }, optional: { reason: 'string' } },
  create_followup: {
    required: { title: 'string' },
    optional: { description: 'string', assignee: 'string' },
  },
  schedule_wakeup: { required: { reason: 'string', wakeAt: 'date' } },
  prepare_decision: {
    required: { question: 'string', options: 'string_array' },
  },
  mark_no_action: { required: { reason: 'string' } },
  change_priority: { required: { priority: 'priority' } },
});

class AssistantDirectiveError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new AssistantDirectiveError(code);
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, code = 'assistant_directive_invalid') {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail(code);
}

function boundedString(value, max = 2000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validatePayload(intent, payload) {
  exactKeys(payload, [
    ...Object.keys(PAYLOAD_SCHEMAS[intent].required || {}),
    ...Object.keys(PAYLOAD_SCHEMAS[intent].optional || {}),
  ]);
  const schema = PAYLOAD_SCHEMAS[intent];
  for (const key of Object.keys(schema.required || {})) {
    if (!(key in payload)) fail('assistant_directive_invalid');
  }
  for (const [key, type] of Object.entries({ ...schema.required, ...schema.optional })) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (type === 'string' && !boundedString(value)) fail('assistant_directive_invalid');
    if (
      type === 'date' &&
      (!boundedString(value, 100) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ||
        Number.isNaN(Date.parse(value)))
    ) {
      fail('assistant_directive_invalid');
    }
    if (
      type === 'string_array' &&
      (!Array.isArray(value) ||
        value.length < 2 ||
        value.length > 10 ||
        value.some((item) => !boundedString(item, 500)))
    ) {
      fail('assistant_directive_invalid');
    }
    if (
      type === 'priority' &&
      !Number.isInteger(value) &&
      !(typeof value === 'string' && value.trim().length > 0 && value.length <= 64)
    ) {
      fail('assistant_directive_invalid');
    }
  }
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!plainObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => FORBIDDEN_KEYS.test(key) || containsForbiddenKey(nested)
  );
}

function normalizedTarget(target, context) {
  const trustedType = context && context.objectType;
  const trustedId = context && context.objectId;
  if (target !== undefined && target !== null) {
    exactKeys(target, ['objectType', 'objectId'], 'assistant_directive_target_denied');
    if (
      !TARGET_TYPES.has(target.objectType) ||
      !boundedString(target.objectId, 128) ||
      target.objectType !== trustedType ||
      target.objectId !== trustedId
    ) {
      fail('assistant_directive_target_denied');
    }
    return { objectType: target.objectType, objectId: target.objectId };
  }
  if (TARGET_TYPES.has(trustedType) && boundedString(trustedId, 128)) {
    return { objectType: trustedType, objectId: trustedId };
  }
  return null;
}

function validateAssistantDirective(value, context = {}) {
  if (!plainObject(value)) fail('assistant_directive_invalid');
  exactKeys(value, ['intent', 'target', 'payload']);
  if (typeof value.intent !== 'string') fail('assistant_directive_invalid');
  if (!ALLOWED_INTENTS.includes(value.intent)) {
    return { intent: 'answer_only', target: null, payload: {}, downgraded: true };
  }
  const payload = value.payload === undefined ? {} : value.payload;
  if (containsForbiddenKey(payload)) fail('assistant_directive_scope_denied');
  validatePayload(value.intent, payload);
  const isProposal = PROPOSAL_INTENTS.has(value.intent);
  const target = isProposal
    ? normalizedTarget(value.target, context)
    : value.target === undefined || value.target === null
      ? null
      : fail('assistant_directive_target_denied');
  if (isProposal && !target) fail('assistant_directive_target_denied');
  return { intent: value.intent, target, payload, downgraded: false };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])])
  );
}

function stableIdempotencyKey(input = {}) {
  const normalized = {
    conversationId: String(input.conversationId || ''),
    messageId: String(input.messageId || ''),
    directive: stable(input.directive || input),
  };
  return `assistant-proposal-v1:${crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex')}`;
}

function verifiedReceipt(value) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !['id', 'proposalId', 'executedAt', 'readback'].includes(key)))
    return false;
  return (
    boundedString(value.id, 200) &&
    boundedString(value.proposalId, 200) &&
    Number.isInteger(value.executedAt) &&
    plainObject(value.readback)
  );
}

function assertNoUnsupportedSuccessClaim(text, receipt) {
  const visible = String(text || '').trim();
  if (
    !verifiedReceipt(receipt) &&
    SUCCESS_CLAIM.test(visible) &&
    !PROPOSAL_WORDING.test(visible) &&
    !NEGATED_SUCCESS.test(visible)
  ) {
    fail('assistant_success_claim_without_receipt');
  }
}

function parseAssistantDirective(input = {}, context = {}) {
  const envelope = plainObject(input) ? input : { text: String(input || '') };
  exactKeys(envelope, ['text', 'assistant_directive', 'assistantDirective', 'receipt']);
  const text = typeof envelope.text === 'string' ? envelope.text.trim() : '';
  if (!text || text.length > 20000) fail('assistant_response_invalid');
  assertNoUnsupportedSuccessClaim(text, envelope.receipt);
  const raw = envelope.assistant_directive ?? envelope.assistantDirective;
  const directive = raw
    ? validateAssistantDirective(raw, context)
    : { intent: 'answer_only', target: null, payload: {}, downgraded: false };
  if (!PROPOSAL_INTENTS.has(directive.intent)) {
    return { text, directive, proposal: null };
  }
  const proposal = {
    actionType: directive.intent,
    targetType: directive.target.objectType,
    targetId: directive.target.objectId,
    payload: stable(directive.payload),
    riskClass: directive.intent === 'prepare_decision' ? 'medium' : 'low',
    scopeStatus: 'unknown',
    status: 'shadow',
  };
  proposal.idempotencyKey = stableIdempotencyKey({
    conversationId: context.conversationId,
    messageId: context.messageId,
    directive: proposal,
  });
  return { text, directive, proposal };
}

module.exports = {
  ALLOWED_INTENTS,
  AssistantDirectiveError,
  parseAssistantDirective,
  parseDirective: parseAssistantDirective,
  stableIdempotencyKey,
  validateAssistantDirective,
};
