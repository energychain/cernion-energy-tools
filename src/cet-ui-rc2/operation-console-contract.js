'use strict';

const { validatePresentationContract } = require('./presentation-contract-validator');

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function allowsExact(values, candidate) {
  return Array.isArray(values) && values.includes(candidate);
}

function boundaryReasonFor(operation, { tenantId, activeRoleId }) {
  if (!operation || !isNonEmptyString(operation.id)) return 'invalid_operation';
  if ((operation.tenantIds || []).includes('*') || (operation.roleIds || []).includes('*')) {
    return 'all_access_not_allowed';
  }
  if (!allowsExact(operation.tenantIds, tenantId)) return 'tenant_not_allowed';
  if (!allowsExact(operation.roleIds, activeRoleId)) return 'role_not_allowed';
  if (!isNonEmptyString(operation.riskClass)) return 'risk_class_missing';
  if (!isNonEmptyString(operation.method)) return 'method_missing';
  if (!operation.governancePolicy || !isNonEmptyString(operation.governancePolicy.id)) {
    return 'governance_policy_missing';
  }
  if (operation.governancePolicy.allowed !== true) return 'governance_policy_denied';
  if (!allowsExact(operation.governancePolicy.allowedMethods, operation.method)) {
    return 'method_not_allowed_by_policy';
  }
  return null;
}

function publicOperation(operation) {
  return {
    id: operation.id,
    label: operation.label,
    mode: operation.mode || 'unprojected',
    riskClass: operation.riskClass,
    method: operation.method,
    governancePolicyId: operation.governancePolicy.id,
  };
}

function filterOperationCatalog(catalog = [], context = {}) {
  if (!isNonEmptyString(context.tenantId)) throw new Error('operation catalog requires tenantId');
  if (!isNonEmptyString(context.activeRoleId))
    throw new Error('operation catalog requires activeRoleId');

  const available = [];
  const denied = [];

  for (const operation of catalog) {
    const reason = boundaryReasonFor(operation, context);
    if (reason) {
      denied.push({
        id: operation && operation.id,
        label: operation && operation.label,
        boundaryReason: reason,
      });
    } else {
      available.push(publicOperation(operation));
    }
  }

  return { available, denied };
}

function classifyOperationResult({ operationId, projection, raw } = {}) {
  if (!isNonEmptyString(operationId)) throw new Error('operation result requires operationId');
  if (projection) {
    validatePresentationContract(projection);
    return {
      operationId,
      projectionStatus: 'projiziert',
      presentationContract: clone(projection),
    };
  }

  return {
    operationId,
    projectionStatus: 'nicht_projiziert',
    unprojected: {
      notice: 'nicht_projiziert',
      raw: clone(raw),
    },
  };
}

function buildOperationAuditPayload({
  tenantId,
  userId,
  activeRoleId,
  operationId,
  projectionStatus,
  at,
} = {}) {
  for (const [field, value] of Object.entries({
    tenantId,
    userId,
    activeRoleId,
    operationId,
    projectionStatus,
    at,
  })) {
    if (!isNonEmptyString(value)) throw new Error(`operation audit requires ${field}`);
  }

  return {
    schemaVersion: 'rc2.operation-console-audit.v1',
    tenantId,
    userId,
    activeRoleId,
    operationId,
    projectionStatus,
    at,
    event: 'operation_console_used',
  };
}

module.exports = {
  buildOperationAuditPayload,
  classifyOperationResult,
  filterOperationCatalog,
};
