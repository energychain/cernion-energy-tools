'use strict';

const KNOWN_CONTROL_CASES = Object.freeze([
  'redispatch',
  'steuerbarkeitscheck',
  'flexible_netzanschluss',
  'fahrplanmanagement',
  'asset_transformation',
  'stilllegung_weiterbetrieb',
  'eog_afa_wirkung',
  'investitionssteuerung',
]);

const CUSTOM_CONTROL_CASE_PATTERN = /^(?:custom|project):[a-z0-9][a-z0-9_.:-]*$/;

const DECISION_POLICY_KEYS = Object.freeze([
  'onMissingEvidence',
  'onHighFinancialImpact',
  'onConflictingSources',
]);

const DECISION_POLICY_VALUES = Object.freeze([
  'clarification',
  'mandatory_human_decision',
  'evidence_gap',
  'none',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateControlCase(value, path, errors) {
  if (value === undefined) return;
  if (!isNonEmptyString(value)) {
    errors.push({
      path,
      code: 'invalid_control_case',
      message: 'controlCase must be a non-empty string when present',
    });
    return;
  }

  const normalized = value.trim();
  if (KNOWN_CONTROL_CASES.includes(normalized) || CUSTOM_CONTROL_CASE_PATTERN.test(normalized)) {
    return;
  }

  errors.push({
    path,
    code: 'unsupported_control_case',
    message:
      'controlCase must use the initial taxonomy or the custom:/project: extension convention',
  });
}

function validateEvidenceRequirement(requirement, path, errors) {
  if (isNonEmptyString(requirement)) {
    return;
  }

  if (!isPlainObject(requirement)) {
    errors.push({
      path,
      code: 'invalid_evidence_requirement',
      message: 'evidenceRequirements entries must be non-empty strings or objects',
    });
    return;
  }

  if (
    !isNonEmptyString(requirement.id) &&
    !isNonEmptyString(requirement.label) &&
    !isNonEmptyString(requirement.name)
  ) {
    errors.push({
      path,
      code: 'invalid_evidence_requirement_identity',
      message: 'structured evidenceRequirements entries need a non-empty id, label, or name',
    });
  }

  if (requirement.type !== undefined && !isNonEmptyString(requirement.type)) {
    errors.push({
      path: `${path}.type`,
      code: 'invalid_evidence_requirement_type',
      message: 'evidenceRequirements type must be a non-empty string when present',
    });
  }
}

function validateEvidenceRequirements(value, path, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push({
      path,
      code: 'invalid_evidence_requirements',
      message: 'evidenceRequirements must be an array when present',
    });
    return;
  }

  value.forEach((requirement, index) => {
    validateEvidenceRequirement(requirement, `${path}[${index}]`, errors);
  });
}

function validateDecisionPolicy(value, path, errors) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    errors.push({
      path,
      code: 'invalid_decision_policy',
      message: 'decisionPolicy must be an object when present',
    });
    return;
  }

  for (const [key, policyValue] of Object.entries(value)) {
    if (!DECISION_POLICY_KEYS.includes(key)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'unsupported_decision_policy_key',
        message: `decisionPolicy key "${key}" is not supported`,
      });
      continue;
    }

    if (!DECISION_POLICY_VALUES.includes(policyValue)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'unsupported_decision_policy_value',
        message: `decisionPolicy value "${policyValue}" is not supported`,
      });
    }
  }
}

function validateVdmiMatrixRow(row, options = {}) {
  const path = options.path || 'row';
  const errors = [];

  if (!isPlainObject(row)) {
    errors.push({
      path,
      code: 'invalid_row',
      message: 'VDMI matrix row must be an object',
    });
    return { valid: false, errors };
  }

  validateControlCase(row.controlCase, `${path}.controlCase`, errors);
  validateEvidenceRequirements(row.evidenceRequirements, `${path}.evidenceRequirements`, errors);
  validateDecisionPolicy(row.decisionPolicy, `${path}.decisionPolicy`, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateVdmiMatrix(matrix, options = {}) {
  const taskPath = options.path || 'matrix.tasks';
  const tasks = Array.isArray(matrix?.tasks) ? matrix.tasks : Array.isArray(matrix) ? matrix : [];
  const errors = [];

  if (!Array.isArray(matrix?.tasks) && !Array.isArray(matrix)) {
    errors.push({
      path: taskPath,
      code: 'invalid_matrix_tasks',
      message: 'VDMI matrix must be an array of rows or an object with a tasks array',
    });
    return { valid: false, errors };
  }

  tasks.forEach((row, index) => {
    const result = validateVdmiMatrixRow(row, { path: `${taskPath}[${index}]` });
    errors.push(...result.errors);
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  KNOWN_CONTROL_CASES,
  DECISION_POLICY_KEYS,
  DECISION_POLICY_VALUES,
  validateVdmiMatrix,
  validateVdmiMatrixRow,
};
