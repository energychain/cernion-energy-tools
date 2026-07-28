'use strict';

/**
 * HTTP request classifiers shared between the API gateway (services/api.service.js)
 * and token-manager (services/token-manager.service.js) — both need to identify the
 * same read-only exceptions when deciding whether a request counts as a "write" for
 * scope/rate-limit enforcement.
 */

function isReadMethod(method) {
  const m = String(method || '').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function isReadOnlySidecarInvocation(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  return (
    m === 'POST' &&
    (/^\/api\/agent-sidecar\/tools\/[^/]+\/call$/.test(pathOnly) ||
      /^\/api\/agent-sidecar\/mcp\/tools\/[^/]+\/call$/.test(pathOnly))
  );
}

function isOperationsRunbookInvocation(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  if (!pathOnly.startsWith('/api/operations-runbook/')) return false;
  return ['GET', 'POST'].includes(m);
}

module.exports = {
  isReadMethod,
  isReadOnlySidecarInvocation,
  isOperationsRunbookInvocation,
};
