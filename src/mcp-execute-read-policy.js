'use strict';

/**
 * Safety gate for `cernion_execute_read` (MCP meta-tool #4).
 *
 * `execute_read` reaches the ~1,100+ REST operations catalogued by
 * `agent-manifest.listOperations` through a loopback HTTP call rather than
 * re-deriving moleculer-web's alias→action routing table itself — the
 * gateway's own auth/RBAC/tenant-scoping/rate-limiting in
 * `services/api.service.js`'s `onBeforeCall` already implements that
 * resolution correctly and re-implementing it here would risk silently
 * diverging from it. This module is the one extra gate layered in front of
 * that loopback.
 *
 * v0.99.5: real-world testing (an MCP client asking a CO₂-intensity
 * question) found `energy-market.co2Intensity` — a genuine read, just
 * implemented as POST because it takes a body — silently refused. The
 * original hand-curated `POST_ALLOWLIST_PATH_PATTERNS` below only covered
 * ~10 specific endpoints; every other read-shaped POST across the platform
 * (energy-market, entsoe, gas-storage, german-grid, oep, osm-geo,
 * residual-load, tabular, and more) had the same gap. Rather than growing
 * that list endpoint-by-endpoint forever, this now consults
 * `operation-capability-index.json` — the same deterministic classification
 * (`src/operation-capability-classifier.js`) already computed for all ~880
 * operations and relied on elsewhere in the platform — as the primary
 * source of truth (see `isReadSafeIndexEntry` below for the exact per-kind
 * rule — `data_read`/`dashboard_read` require `recommendedExecutionMode:
 * 'direct'`, `advisory_plan` requires `'explain_only'` specifically, not
 * uniformly 'direct', because at least one operation is misclassified as
 * advisory_plan despite being a real delete). GET-by-convention and the
 * original small POST allowlist remain as a fallback for anything the
 * index doesn't (yet) cover — e.g. a freshly added operation before the
 * index is regenerated, or if the index file is missing entirely.
 *
 * The same pass also fixed a real bug in the denylist below: it targeted
 * `/token-manager/*`, but the actual mounted path is `/tokens` (see
 * `services/token-manager.service.js`) — meaning `GET /api/tokens` (token
 * metadata, masked values but still names/tenants/scopes across possibly
 * more than the caller's own tenant) was never actually blocked. Caught by
 * cross-checking this file against the operation index while investigating
 * the CO₂ report, not by the report itself.
 *
 * v0.99.7: auditing every POST operation classified `data_read` via the
 * classifier's `QUERY_VERB_PATTERN` (any summary starting with "resolve" is
 * treated as a read, e.g. "Resolve a request to a route") found 3 real
 * writes let through by that same heuristic — "resolve" also means "close
 * out a stateful entity" (finding/gap/alarm), not just "look up": `POST
 * /vdmi/findings/:findingId/resolve` (persists finding.status='resolved'),
 * `POST /interface-placeholder/gaps/:placeholderId/resolve`, and `POST
 * /jobs/alarms/:alarmId/resolve` (persists alarm status via jobStore). Not
 * fixed in the classifier itself (`src/operation-capability-classifier.js`
 * is relied on by other consumers beyond MCP; narrowing the "resolve" verb
 * there needs its own dedicated audit) — overridden here the same way
 * v0.99.5 handled `znp_deleteProject`'s misclassification.
 */

const fs = require('fs');
const path = require('path');
const { isReadMethod } = require('./gateway-request-classifiers');

const OPERATION_INDEX_PATH = path.join(__dirname, '..', 'operation-capability-index.json');

// Paths (relative to /api) that must never be reachable via execute_read,
// even as GET, even if operation-capability-index.json classifies them as
// agentable data_read — admin/system/credential surfaces are an MCP-agent-
// specific risk judgment stricter than the generic classifier's, not
// something to defer to it for. Per the concept doc's "Nicht exponieren"
// list, plus token-manager/auth (secrets-adjacent) added defensively.
const DENYLIST_PATH_PATTERNS = [
  /^\/backup(\/|$)/,
  /^\/restore(\/|$)/,
  /^\/system\/admin(\/|$)/,
  /^\/domain-routes\/reload$/,
  /^\/tokens(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/tenant-quotas?(\/|$)/,
];

// Confirmed real writes that operation-capability-index.json misclassifies
// as data_read/direct (see the "v0.99.7" module comment above) — checked by
// exact method + path, not folded into DENYLIST_PATH_PATTERNS above since
// the reason is a classifier false positive, not an admin/secret surface.
const KNOWN_MISCLASSIFIED_WRITE_PATTERNS = [
  { method: 'POST', pattern: /^\/vdmi\/findings\/[^/]+\/resolve$/ },
  { method: 'POST', pattern: /^\/interface-placeholder\/gaps\/[^/]+\/resolve$/ },
  { method: 'POST', pattern: /^\/jobs\/alarms\/[^/]+\/resolve$/ },
];

// Fallback for operations not found in operation-capability-index.json —
// POST endpoints that are read-only or dry-run in effect despite the verb.
const POST_ALLOWLIST_PATH_PATTERNS = [
  /^\/evidence-router\/route$/,
  /^\/knowledge-rag\/(query|semantic|federated-search)$/,
  /^\/agent-receipts\/select$/,
  /^\/agent-receipts\/(evaluate|test|explain)$/,
  /^\/agent-receipts\/[^/]+\/(evaluate|test|explain)$/,
  /^\/cookbook\/(search|validate)$/,
  /^\/copilot\/(ask-cernion-agent|answer-dossier)$/,
];

function stripApiPrefix(path_) {
  const normalized = String(path_ || '').split('?')[0];
  return normalized.startsWith('/api') ? normalized.slice(4) || '/' : normalized;
}

function isDenied(relativePath) {
  return DENYLIST_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function isKnownMisclassifiedWrite(method, relativePath) {
  return KNOWN_MISCLASSIFIED_WRITE_PATTERNS.some(
    (entry) => entry.method === method && entry.pattern.test(relativePath)
  );
}

let _operationLookup = null;
function loadOperationLookup() {
  if (_operationLookup) return _operationLookup;
  _operationLookup = new Map();
  try {
    const index = JSON.parse(fs.readFileSync(OPERATION_INDEX_PATH, 'utf8'));
    for (const op of index.operations || []) {
      _operationLookup.set(`${op.method} ${op.path}`, op);
      for (const alias of op.aliases || []) {
        _operationLookup.set(alias, op);
      }
    }
  } catch {
    // Missing/unreadable index just means execute_read falls back to the
    // conservative GET+small-allowlist rules below — never a hard failure.
  }
  return _operationLookup;
}

// `data_read`/`dashboard_read` are empirically always paired with
// `recommendedExecutionMode: 'direct'` in the index (verified across all
// ~880 operations) — no exceptions found. `advisory_plan` is different: it
// splits into genuinely read-only routing/explanation endpoints (paired
// with `explain_only`, e.g. evidence-router.route — "read-only routing...
// never executes, never mutates") and at least one real misclassification
// (`znp_deleteProject`, a DELETE, incorrectly given `operationKind:
// advisory_plan` but correctly flagged `recommendedExecutionMode:
// 'confirm'` since it's a mutation needing confirmation). Checking the
// mode per-kind rather than requiring 'direct' uniformly lets
// evidence-router-style endpoints through while still catching that one.
function isReadSafeIndexEntry(entry) {
  if (entry.agentable !== true) return false;
  if (entry.operationKind === 'data_read' || entry.operationKind === 'dashboard_read') {
    return entry.recommendedExecutionMode === 'direct';
  }
  if (entry.operationKind === 'advisory_plan') {
    return entry.recommendedExecutionMode === 'explain_only';
  }
  return false;
}

/**
 * @param {string} method - HTTP method as catalogued by agent-manifest (e.g. "GET").
 * @param {string} path - Full or /api-relative path, may include the `/api` prefix.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkExecuteReadPolicy(method, path_) {
  const relativePath = stripApiPrefix(path_);
  if (isDenied(relativePath)) {
    return { allowed: false, reason: 'ADMIN_SURFACE_NOT_EXPOSED' };
  }

  const upperMethod = String(method || '').toUpperCase();
  if (isKnownMisclassifiedWrite(upperMethod, relativePath)) {
    return {
      allowed: false,
      reason: 'NOT_READ_ONLY: classifier false positive (resolve-verb heuristic)',
    };
  }

  const fullPath = String(path_ || '').startsWith('/api') ? path_ : `/api${relativePath}`;
  const entry = loadOperationLookup().get(`${upperMethod} ${fullPath}`);
  if (entry) {
    if (isReadSafeIndexEntry(entry)) return { allowed: true };
    if (isReadMethod(upperMethod)) return { allowed: true }; // GET stays allowed regardless
    return {
      allowed: false,
      reason: entry.nonAgentableReason
        ? `NOT_READ_ONLY: ${entry.nonAgentableReason}`
        : 'NOT_READ_ONLY',
    };
  }

  // No index entry (e.g. index stale/regenerating, or a path not catalogued
  // there at all) — fall back to the original conservative rules.
  if (isReadMethod(upperMethod)) {
    return { allowed: true };
  }
  if (
    upperMethod === 'POST' &&
    POST_ALLOWLIST_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'NOT_READ_ONLY' };
}

module.exports = { checkExecuteReadPolicy };
