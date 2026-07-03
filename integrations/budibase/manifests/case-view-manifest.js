'use strict';

const SAFE_ACTION_CLASSES = new Set(['read_only', 'verify_only', 'sandbox_annotation']);
const DATA_CLASSES = new Set([
  'public_context_layer',
  'synthetic_tenant_seed',
  'sandbox_runtime_artifact',
]);

const REQUIRED_MANIFEST_FIELDS = [
  'manifestId',
  'schemaVersion',
  'controlCase',
  'tenantId',
  'caseId',
  'personaRole',
  'routeTarget',
  'rendererTargets',
  'transferParameters',
  'sections',
  'forbiddenActions',
  'positiveFollowUps',
];

const REQUIRED_SECTION_FIELDS = [
  'id',
  'title',
  'roleTarget',
  'routeTarget',
  'sourceDashboardEndpoint',
  'queryParameters',
  'rowBinding',
  'columns',
  'semantics',
  'dataClass',
  'safeActionClass',
  'forbiddenActions',
  'sampleRows',
];

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function validateScalarRows(section, errors) {
  if (!Array.isArray(section.sampleRows) || section.sampleRows.length === 0) {
    errors.push(`${section.id}: sampleRows must be a non-empty array`);
    return;
  }
  const columnKeys = new Set((section.columns || []).map((column) => column.key));
  for (const [rowIndex, row] of section.sampleRows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${section.id}: sampleRows[${rowIndex}] must be an object`);
      continue;
    }
    for (const [key, value] of Object.entries(row)) {
      if (!columnKeys.has(key)) {
        errors.push(`${section.id}: sampleRows[${rowIndex}] has undeclared column ${key}`);
      }
      if (!isScalar(value)) {
        errors.push(`${section.id}: sampleRows[${rowIndex}].${key} is not scalar`);
      }
      if (String(value).includes('[object Object]')) {
        errors.push(`${section.id}: sampleRows[${rowIndex}].${key} leaks [object Object]`);
      }
    }
  }
}

function validateCaseViewManifest(manifest) {
  const errors = [];
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (manifest[field] === undefined) errors.push(`manifest missing ${field}`);
  }
  if (!Array.isArray(manifest.rendererTargets) || !manifest.rendererTargets.includes('budibase')) {
    errors.push('rendererTargets must include budibase');
  }
  if (!Array.isArray(manifest.sections) || manifest.sections.length === 0) {
    errors.push('sections must be a non-empty array');
  }
  if (!Array.isArray(manifest.forbiddenActions) || manifest.forbiddenActions.length === 0) {
    errors.push('forbiddenActions must be a non-empty array');
  }
  if (!Array.isArray(manifest.positiveFollowUps) || manifest.positiveFollowUps.length === 0) {
    errors.push('positiveFollowUps must be a non-empty array');
  }

  const transferKeys = new Set((manifest.transferParameters || []).map((item) => item.key));
  for (const requiredKey of [
    'tenantId',
    'roleMapping',
    'caseId',
    'seedId',
    'municipalityAgs',
    'allowedCommandScope',
  ]) {
    if (!transferKeys.has(requiredKey)) errors.push(`transferParameters missing ${requiredKey}`);
  }

  for (const section of manifest.sections || []) {
    for (const field of REQUIRED_SECTION_FIELDS) {
      if (section[field] === undefined) errors.push(`${section.id || 'section'} missing ${field}`);
    }
    if (!SAFE_ACTION_CLASSES.has(section.safeActionClass)) {
      errors.push(`${section.id}: unsupported safeActionClass ${section.safeActionClass}`);
    }
    if (!DATA_CLASSES.has(section.dataClass)) {
      errors.push(`${section.id}: unsupported dataClass ${section.dataClass}`);
    }
    if (!Array.isArray(section.columns) || section.columns.length === 0) {
      errors.push(`${section.id}: columns must be a non-empty array`);
    }
    for (const column of section.columns || []) {
      if (!column.key || !column.label || !column.type) {
        errors.push(`${section.id}: columns must declare key, label and type`);
      }
      if (column.type === 'object' || column.type === 'array') {
        errors.push(`${section.id}: column ${column.key} must not be ${column.type}`);
      }
    }
    if (!Array.isArray(section.forbiddenActions) || section.forbiddenActions.length === 0) {
      errors.push(`${section.id}: forbiddenActions must be a non-empty array`);
    }
    validateScalarRows(section, errors);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  DATA_CLASSES,
  SAFE_ACTION_CLASSES,
  validateCaseViewManifest,
};
