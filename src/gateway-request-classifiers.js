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

function isDomainRouterAdvisoryInvocation(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  if (!pathOnly.startsWith('/api/domain-router/')) return false;
  return ['GET', 'POST'].includes(m);
}

// Open WebUI gateway tokens may use the read side of the Knowledge Gateway only
// (services/knowledge-gateway.service.js): search, citations, the list and the tool document.
function isKnowledgeGatewayRequest(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  return (
    (m === 'POST' && pathOnly === '/api/workbench/knowledge/search') ||
    (m === 'GET' &&
      (pathOnly === '/api/workbench/knowledge/openapi.json' ||
        pathOnly === '/api/workbench/knowledge-bases' ||
        /^\/api\/workbench\/knowledge\/citations\/cit_[a-f0-9]{32}$/.test(pathOnly)))
  );
}

// Reading the status or the persisted answer of an own asynchronous chat turn (DEV-UAT-006);
// the job lookup itself is tenant-scoped (src/async-chat-turns.js).
function isChatJobRequest(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  return m === 'GET' && /^\/v1\/chat\/jobs\/[0-9a-f-]{36}(?:\/message)?$/.test(pathOnly);
}

module.exports = {
  isChatJobRequest,
  isKnowledgeGatewayRequest,
  isReadMethod,
  isReadOnlySidecarInvocation,
  isOperationsRunbookInvocation,
  isDomainRouterAdvisoryInvocation,
};
