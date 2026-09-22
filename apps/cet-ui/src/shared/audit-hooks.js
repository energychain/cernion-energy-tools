'use strict';

function requireAuditClient(apiClient) {
  if (!apiClient || typeof apiClient.recordAudit !== 'function') {
    throw new Error('RC2 audit hooks require a UI Gateway audit client');
  }
  return apiClient;
}

function buildAuditPayload(event, context = {}, details = {}) {
  const required = ['tenantId', 'userId', 'activeRoleId', 'at'];
  for (const field of required) {
    if (!context[field]) throw new Error(`RC2 audit hook requires ${field}`);
  }
  return {
    schemaVersion: 'rc2.ui-audit-event.v1',
    transport: 'ui_gateway',
    event,
    tenantId: context.tenantId,
    userId: context.userId,
    activeRoleId: context.activeRoleId,
    at: context.at,
    ...details,
  };
}

function recordViewOpened(apiClient, context) {
  return requireAuditClient(apiClient).recordAudit(
    buildAuditPayload('view_opened', context, { view: context.view })
  );
}

function recordOperationConsoleUse(apiClient, context) {
  return requireAuditClient(apiClient).recordAudit(
    buildAuditPayload('operation_console_used', context, { operationId: context.operationId })
  );
}

function recordContractRenderError(apiClient, context) {
  return requireAuditClient(apiClient).recordAudit(
    buildAuditPayload('contract_render_error', context, {
      view: context.view,
      errorCode: context.errorCode,
    })
  );
}

function recordBoundaryShown(apiClient, context) {
  return requireAuditClient(apiClient).recordAudit(
    buildAuditPayload('boundary_shown', context, { boundary: context.boundary })
  );
}

module.exports = {
  buildAuditPayload,
  recordBoundaryShown,
  recordContractRenderError,
  recordOperationConsoleUse,
  recordViewOpened,
};
