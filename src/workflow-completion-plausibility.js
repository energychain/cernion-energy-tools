'use strict';

// Generic, deterministic pre-completion plausibility checker for HITL workflow
// completion (#452). Advisory only: it classifies rule violations into bounded,
// sanitized hint objects (fieldKey/ruleId/messageKey/guidanceKey/severity) and
// NEVER echoes submitted values, notes, or free-form text. Rule vocabulary is a
// small allowlist — no callbacks, executable expressions, or arbitrary traversal.

const RULE_TYPES = Object.freeze({
  REQUIRED: 'required',
  NUMBER_RANGE: 'number_range',
  LESS_THAN_OR_EQUAL: 'less_than_or_equal',
});

const ALLOWED_RULE_TYPES = new Set(Object.values(RULE_TYPES));

const STATUS = Object.freeze({
  OK: 'ok',
  HINTS_FOUND: 'hints_found',
  NOT_CONFIGURED: 'not_configured',
  CHECK_UNAVAILABLE: 'check_unavailable',
});

const CATEGORY = Object.freeze({
  MISSING_REQUIRED: 'missing_required',
  IMPLAUSIBLE_VALUE: 'implausible_value',
});

const SEVERITIES = new Set(['warning', 'info']);

// Bounded vocabulary — no free-form messages are ever emitted, only these keys.
const MESSAGE_KEYS = Object.freeze({
  FIELD_REQUIRED_MISSING: 'field_required_missing',
  VALUE_OUTSIDE_EXPECTED_RANGE: 'value_outside_expected_range',
  VALUE_EXCEEDS_RELATED_FIELD: 'value_exceeds_related_field',
});

const GUIDANCE_KEYS = Object.freeze({
  PROVIDE_REQUIRED_FIELD: 'provide_required_field',
  REVIEW_VALUE_AGAINST_EXPECTED_RANGE: 'review_value_against_expected_range',
  REVIEW_VALUE_AGAINST_RELATED_FIELD: 'review_value_against_related_field',
});

const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const RULE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_RULES = 50;

const EMPTY_RESULT_COUNTS = Object.freeze({
  missingRequired: 0,
  implausibleValue: 0,
  total: 0,
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isValidFieldKey(key) {
  return typeof key === 'string' && FIELD_KEY_PATTERN.test(key);
}

function isValidRuleId(id) {
  return typeof id === 'string' && RULE_ID_PATTERN.test(id);
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function allowedKeys(rule, keys) {
  try {
    return Reflect.ownKeys(rule).every((key) => typeof key === 'string' && keys.includes(key));
  } catch {
    return false;
  }
}

// Fails closed (returns false, never throws) on any unexpected shape.
function isValidRule(rule) {
  if (!isPlainObject(rule)) return false;
  if (!isValidRuleId(rule.ruleId)) return false;
  if (!ALLOWED_RULE_TYPES.has(rule.type)) return false;
  if (!isValidFieldKey(rule.fieldKey)) return false;
  if (rule.severity !== undefined && !SEVERITIES.has(rule.severity)) return false;

  switch (rule.type) {
    case RULE_TYPES.REQUIRED:
      return allowedKeys(rule, ['ruleId', 'type', 'fieldKey', 'severity']);

    case RULE_TYPES.NUMBER_RANGE: {
      const hasMin = rule.min !== undefined;
      const hasMax = rule.max !== undefined;
      if (!hasMin && !hasMax) return false;
      if (hasMin && (typeof rule.min !== 'number' || !Number.isFinite(rule.min))) return false;
      if (hasMax && (typeof rule.max !== 'number' || !Number.isFinite(rule.max))) return false;
      if (hasMin && hasMax && rule.min > rule.max) return false;
      return allowedKeys(rule, ['ruleId', 'type', 'fieldKey', 'min', 'max', 'severity']);
    }

    case RULE_TYPES.LESS_THAN_OR_EQUAL:
      if (!isValidFieldKey(rule.relatedFieldKey)) return false;
      if (rule.relatedFieldKey === rule.fieldKey) return false;
      return allowedKeys(rule, ['ruleId', 'type', 'fieldKey', 'relatedFieldKey', 'severity']);

    default:
      return false;
  }
}

function evaluateRequired(rule, fields) {
  if (!isEmptyValue(fields[rule.fieldKey])) return null;
  return {
    category: CATEGORY.MISSING_REQUIRED,
    fieldKey: rule.fieldKey,
    ruleId: rule.ruleId,
    messageKey: MESSAGE_KEYS.FIELD_REQUIRED_MISSING,
    guidanceKey: GUIDANCE_KEYS.PROVIDE_REQUIRED_FIELD,
    severity: rule.severity || 'warning',
  };
}

function evaluateNumberRange(rule, fields) {
  const value = fields[rule.fieldKey];
  if (isEmptyValue(value)) return null; // presence is a separate 'required' rule's concern

  const numeric = toFiniteNumber(value);
  const withinMin = numeric !== null && (rule.min === undefined || numeric >= rule.min);
  const withinMax = numeric !== null && (rule.max === undefined || numeric <= rule.max);
  if (numeric !== null && withinMin && withinMax) return null;

  return {
    category: CATEGORY.IMPLAUSIBLE_VALUE,
    fieldKey: rule.fieldKey,
    ruleId: rule.ruleId,
    messageKey: MESSAGE_KEYS.VALUE_OUTSIDE_EXPECTED_RANGE,
    guidanceKey: GUIDANCE_KEYS.REVIEW_VALUE_AGAINST_EXPECTED_RANGE,
    severity: rule.severity || 'warning',
  };
}

function evaluateLessThanOrEqual(rule, fields) {
  const value = fields[rule.fieldKey];
  const relatedValue = fields[rule.relatedFieldKey];
  if (isEmptyValue(value) || isEmptyValue(relatedValue)) return null;

  const numeric = toFiniteNumber(value);
  const relatedNumeric = toFiniteNumber(relatedValue);
  if (numeric !== null && relatedNumeric !== null && numeric <= relatedNumeric) return null;

  return {
    category: CATEGORY.IMPLAUSIBLE_VALUE,
    fieldKey: rule.fieldKey,
    relatedFieldKey: rule.relatedFieldKey,
    ruleId: rule.ruleId,
    messageKey: MESSAGE_KEYS.VALUE_EXCEEDS_RELATED_FIELD,
    guidanceKey: GUIDANCE_KEYS.REVIEW_VALUE_AGAINST_RELATED_FIELD,
    severity: rule.severity || 'warning',
  };
}

function notConfigured() {
  return { status: STATUS.NOT_CONFIGURED, hints: [], counts: EMPTY_RESULT_COUNTS };
}

function checkUnavailable() {
  return { status: STATUS.CHECK_UNAVAILABLE, hints: [], counts: EMPTY_RESULT_COUNTS };
}

/**
 * Pure, deterministic evaluator. Never throws, never mutates input, never
 * performs I/O. `rules` is a bounded allowlisted declarative vocabulary;
 * `fields` is a flat scalar map of candidate completion values (read-only,
 * never echoed back in the result).
 */
function evaluateWorkflowCompletionPlausibility({ rules, fields } = {}) {
  if (!Array.isArray(rules) || rules.length === 0 || !isPlainObject(fields)) {
    return notConfigured();
  }
  if (rules.length > MAX_RULES) {
    return checkUnavailable();
  }
  if (!rules.every(isValidRule)) {
    return checkUnavailable();
  }

  const hints = [];
  for (const rule of rules) {
    let hint = null;
    if (rule.type === RULE_TYPES.REQUIRED) {
      hint = evaluateRequired(rule, fields);
    } else if (rule.type === RULE_TYPES.NUMBER_RANGE) {
      hint = evaluateNumberRange(rule, fields);
    } else if (rule.type === RULE_TYPES.LESS_THAN_OR_EQUAL) {
      hint = evaluateLessThanOrEqual(rule, fields);
    }
    if (hint) hints.push(hint);
  }

  const missingRequired = hints.filter(
    (hint) => hint.category === CATEGORY.MISSING_REQUIRED
  ).length;
  const implausibleValue = hints.filter(
    (hint) => hint.category === CATEGORY.IMPLAUSIBLE_VALUE
  ).length;

  return {
    status: hints.length > 0 ? STATUS.HINTS_FOUND : STATUS.OK,
    hints,
    counts: { missingRequired, implausibleValue, total: hints.length },
  };
}

module.exports = {
  evaluateWorkflowCompletionPlausibility,
  RULE_TYPES,
  STATUS,
  CATEGORY,
  MESSAGE_KEYS,
  GUIDANCE_KEYS,
};
