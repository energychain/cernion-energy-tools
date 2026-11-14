'use strict';

const { ScopedApprovalReader, effectiveStatus } = require('./scoped-approval-reader');
const { DecisionActionError, createDecisionActions } = require('./decision-actions');

function queryOptions(url, id = null) {
  return {
    id,
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
    decisionClass: url.searchParams.get('decisionClass'),
    status: url.searchParams.get('status'),
    owner: url.searchParams.get('owner'),
    state: url.searchParams.get('state'),
    query: url.searchParams.get('q'),
  };
}

function decodeId(value) {
  try {
    const decoded = decodeURIComponent(value || '');
    return decoded && decoded.length <= 128 ? decoded : null;
  } catch (_) {
    return null;
  }
}

function readScopes() {
  const reader = new ScopedApprovalReader().load();
  const now = Math.floor(Date.now() / 1000);
  return {
    available: reader.diagnostics.available,
    schemaVersion: reader.diagnostics.schemaVersion ?? null,
    validScopes: reader.diagnostics.validScopes,
    invalidScopes: reader.diagnostics.invalidScopes,
    statuses: reader.diagnostics.statuses,
    items: reader.scopes
      .filter((scope) => scope.sourceBoard !== 'twl-netze-private')
      .map((scope) => ({
        id: scope.id,
        type: scope.type,
        status: effectiveStatus(scope, now),
        sourceBoard: scope.sourceBoard,
        sourceTaskId: scope.sourceTaskId,
        expiresAt: scope.expiresAt,
      })),
  };
}

function createManagementApi(options) {
  const reader = options.reader;
  const config = Object.freeze({
    enabled: Boolean(options.enabled),
    writeEnabled: Boolean(options.writeEnabled),
    shadowOnly: options.shadowOnly !== false,
    defaultView: options.defaultView === 'management' ? 'management' : 'legacy',
    legacyPath: '/',
    managementPath: '/management',
  });
  const scopeLoader = options.scopeLoader || readScopes;
  const decisionActions = createDecisionActions({
    reader,
    writeEnabled: config.writeEnabled,
    shadowOnly: config.shadowOnly,
    now: options.now,
  });

  function handleDecisionAction(decisionId, action, body) {
    if (!config.enabled)
      return { status: 404, body: { ok: false, error: 'management_cockpit_disabled' } };
    try {
      const preview = decisionActions.preview(decisionId, action, body);
      return { status: 202, body: preview };
    } catch (error) {
      if (error instanceof DecisionActionError) {
        return { status: error.status, body: { ok: false, error: error.code } };
      }
      return { status: 500, body: { ok: false, error: 'decision_action_preview_failed' } };
    }
  }

  function handle(req, url) {
    if (req.method !== 'GET') return { status: 405, body: { ok: false, error: 'read_only_api' } };
    if (url.pathname === '/api/management/config')
      return { status: 200, body: { ok: true, ...config } };
    if (!config.enabled)
      return { status: 404, body: { ok: false, error: 'management_cockpit_disabled' } };

    const collectionOperations = {
      '/api/management/summary': 'summary',
      '/api/management/overview': 'overview',
      '/api/management/metadata': 'metadata',
      '/api/management/health': 'health',
      '/api/management/decisions': 'decisions',
      '/api/management/departments': 'departments',
      '/api/management/topics': 'topics',
      '/api/management/outcomes': 'outcomes',
      '/api/management/risks': 'risks',
      '/api/management/wakeups': 'wakeups',
      '/api/management/digest': 'digest',
      '/api/management/telemetry': 'telemetry',
    };

    try {
      if (url.pathname === '/api/management/scopes') {
        return { status: 200, body: { ok: true, ...scopeLoader() } };
      }
      const collectionOperation = collectionOperations[url.pathname];
      if (collectionOperation) {
        return {
          status: 200,
          body: { ok: true, ...reader.read(collectionOperation, queryOptions(url)) },
        };
      }

      const detailRoutes = [
        [/^\/api\/management\/decisions\/([^/]+)$/, 'decision'],
        [/^\/api\/management\/departments\/([^/]+)$/, 'departments'],
        [/^\/api\/management\/topics\/([^/]+)$/, 'topic'],
      ];
      for (const [pattern, operation] of detailRoutes) {
        const match = url.pathname.match(pattern);
        if (!match) continue;
        const id = decodeId(match[1]);
        if (!id) return { status: 400, body: { ok: false, error: 'invalid_management_id' } };
        const result = reader.read(operation, queryOptions(url, id));
        if (!result.item) return { status: 404, body: { ok: false, error: 'not_found' } };
        return { status: 200, body: { ok: true, item: result.item } };
      }
      return { status: 404, body: { ok: false, error: 'not_found' } };
    } catch (error) {
      const unavailable = ['PROJECTION_UNAVAILABLE', 'PROJECTION_READ_FAILED'].includes(error.code);
      return {
        status: unavailable ? 503 : 500,
        body: {
          ok: false,
          error: unavailable ? 'management_projection_unavailable' : 'management_read_failed',
        },
      };
    }
  }

  return { config, handle, handleDecisionAction };
}

module.exports = { createManagementApi, decodeId, queryOptions, readScopes };
