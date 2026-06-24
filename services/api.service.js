/**
 * API Gateway Service
 *
 * This service provides HTTP REST API access to all microservices
 * with OpenAPI documentation support.
 */

const ApiGateway = require('moleculer-web');
const OpenapiMixin = require('moleculer-auto-openapi');
const { Errors } = require('moleculer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { version: packageVersion } = require('../package.json');
const metrics = require('../src/metrics');
const rateQuotaStore = require('../src/rate-quota-store');
const tracing = require('../src/tracing');
const { mergeObservabilityContext } = require('../src/observability-context');
const { hasRole, mapRolesFromLegacyToken } = require('../src/auth/rbac');
const { validateTenantId, isTenantAllowed } = require('../src/tenant-context');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const CONTENT_TYPE_HEADER = 'Content-Type';
const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.txt',
  '.xlsx',
  '.xls',
  '.docx',
  '.geojson',
  '.json',
  '.gz',
  '.pdf', // Layer 2: VNB StromNZV §23c structure reports
]);
const CK_TOKEN_SUNSET_HTTP_DATE = 'Wed, 31 Dec 2026 23:59:59 GMT';
const PERSONAL_AGENT_MAX_FILES = 5;
const PERSONAL_AGENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const PERSONAL_AGENT_MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024;
const PERSONAL_AGENT_MAX_FIELDS = 16;
const PERSONAL_AGENT_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.xlsx',
  '.xls',
  '.png',
  '.jpg',
  '.jpeg',
  '.pdf',
]);
const DEFAULT_API_CORS_ORIGINS = [
  'https://energychain.github.io',
  'https://cernion.de',
  'https://*.cernion.de',
  'https://make.powerautomate.com',
  'https://*.powerautomate.com',
  'https://make.powerapps.com',
  'https://*.powerapps.com',
  'https://flow.microsoft.com',
  'https://*.flow.microsoft.com',
];
const COPILOT_OPENAPI_PATH = path.join(__dirname, '..', 'openapi-copilot.json');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function sanitizeUploadFilename(fileName) {
  const base = path.basename(String(fileName || '').trim());
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || '';
}

function buildUploadResponseEntry(fileName) {
  const fullPath = path.join(UPLOAD_DIR, fileName);
  const stat = fs.statSync(fullPath);
  return {
    fileName,
    filePath: fullPath,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function sanitizePathSegment(value, fallback) {
  const cleaned = String(value || fallback || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || String(fallback || 'default');
}

/**
 * Moves a file with cross-device link fallback.
 * Handles EXDEV errors (cross-device link) when /tmp and target are on different mounts.
 * @param {string} sourcePath - Path to source file
 * @param {string} targetPath - Path to target file
 */
function moveFileWithCrossDeviceFallback(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Fallback for cross-device moves (e.g., Docker mount boundary)
      fs.copyFileSync(sourcePath, targetPath);
      fs.unlinkSync(sourcePath);
    } else {
      throw err;
    }
  }
}

function parseOptionalJsonObject(value, fallback = {}) {
  if (value == null || value === '') {
    return fallback;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function parseOptionalJsonStringArray(value, fallback = []) {
  if (value == null || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const raw = value.trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
  } catch (_error) {
    // Fallback to comma-separated values for form payloads
  }

  return raw
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function parseOptionalBoolean(value, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function toFileArray(rawFiles) {
  if (!rawFiles) return [];
  return Array.isArray(rawFiles) ? rawFiles.filter(Boolean) : [rawFiles].filter(Boolean);
}

function buildPersonalAgentUploadPath(tenantId, sessionId, attachmentId, ext) {
  const safeTenant = sanitizePathSegment(tenantId, 'default');
  const safeSession = sanitizePathSegment(sessionId, 'pa_session');
  const safeAttachment = sanitizePathSegment(attachmentId, 'fa_upload');
  return path.join(UPLOAD_DIR, safeTenant, safeSession, `${safeAttachment}${ext}`);
}

function sanitizeErrorMessage(message) {
  if (!message) return message;
  let sanitized = String(message);

  // Redact bearer tokens in free-text messages
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');

  // Redact token-like query/path parameters
  sanitized = sanitized.replace(
    /([?&](?:token|api[_-]?key|secret|password)=)[^&\s]+/gi,
    '$1[REDACTED]'
  );

  // Redact MCP token segment in URL paths
  sanitized = sanitized.replace(
    /(https?:\/\/mcp\.cernion\.de\/)[^/\s]+(\/mcp)/gi,
    '$1[REDACTED]$2'
  );

  return sanitized;
}

function toValidHttpStatus(value) {
  if (Number.isInteger(value) && value >= 100 && value <= 599) {
    return value;
  }

  if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) {
    const parsed = parseInt(value.trim(), 10);
    if (parsed >= 100 && parsed <= 599) {
      return parsed;
    }
  }

  return null;
}

function resolveHttpStatus(err) {
  const candidates = [err?.status, err?.statusCode, err?.code];
  for (const candidate of candidates) {
    const status = toValidHttpStatus(candidate);
    if (status !== null) {
      return status;
    }
  }
  return 500;
}

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

function normalizeRequestPath(req) {
  const raw = String(req?.originalUrl || req?.url || req?.path || '');
  return raw.split('?')[0] || '';
}

function envTrue(name) {
  const raw = process.env[name];
  if (raw == null || raw === '') return false;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCorsOrigins(rawOrigins) {
  if (typeof rawOrigins !== 'string') {
    return DEFAULT_API_CORS_ORIGINS;
  }

  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_API_CORS_ORIGINS;
}

function buildCorsOriginMatcher(allowedOrigins) {
  const exactOrigins = new Set();
  const wildcardPatterns = [];

  for (const origin of allowedOrigins) {
    if (origin.includes('*')) {
      wildcardPatterns.push(new RegExp(`^${escapeRegExp(origin).replace(/\\\*/g, '.*')}$`));
      continue;
    }
    exactOrigins.add(origin);
  }

  return (origin) => {
    if (!origin) return true;
    if (exactOrigins.has(origin)) return true;
    if (wildcardPatterns.some((pattern) => pattern.test(origin))) return true;
    return false;
  };
}

const API_CORS_ORIGINS = parseCorsOrigins(process.env.API_CORS_ORIGINS);
const API_CORS_ORIGIN_MATCHER = buildCorsOriginMatcher(API_CORS_ORIGINS);

function extractRawToken(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  const queryToken = typeof req?.query?.token === 'string' ? req.query.token.trim() : null;
  return queryToken || bearerToken || null;
}

function requiresFullAccess(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];

  if (pathOnly.startsWith('/api/forecast/') && m === 'POST') {
    return true;
  }

  if (pathOnly.startsWith('/api/flex/') && (m === 'POST' || m === 'PUT')) {
    return true;
  }

  if (pathOnly.startsWith('/api/settlement/') && m === 'POST') {
    return true;
  }
  if (pathOnly.startsWith('/api/bilanzkreis') && (m === 'POST' || m === 'DELETE')) {
    return true;
  }

  if (pathOnly.startsWith('/api/edm/melos') && (m === 'POST' || m === 'PUT' || m === 'DELETE')) {
    return true;
  }
  if (pathOnly.startsWith('/api/edm/timeseries') && (m === 'POST' || m === 'DELETE')) {
    return true;
  }
  if (pathOnly === '/api/edm/validate' && m === 'POST') {
    return true;
  }
  if (/^\/api\/edm\/validate\/[^/]+\/fill-gaps$/.test(pathOnly) && m === 'POST') {
    return true;
  }
  if (pathOnly.startsWith('/api/edm/messkonzepte') && (m === 'POST' || m === 'DELETE')) {
    return true;
  }
  if (pathOnly.startsWith('/api/edm/virtual') && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/mscons/import' && m === 'POST') {
    return true;
  }
  if (pathOnly.startsWith('/api/slp/profiles') && (m === 'POST' || m === 'DELETE')) {
    return true;
  }

  if (pathOnly === '/api/tokens' && m === 'GET') return true;
  if (pathOnly === '/api/tokens' && m === 'POST') return true;
  if (pathOnly === '/api/tokens/tenants' && m === 'GET') return true;
  if (/^\/api\/tenants\/[^/]+\/quotas$/.test(pathOnly) && (m === 'GET' || m === 'PUT')) return true;
  if (/^\/api\/tenants\/[^/]+\/rate-limit-events$/.test(pathOnly) && m === 'GET') return true;
  if (pathOnly.startsWith('/api/tokens/') && pathOnly !== '/api/tokens/verify' && m === 'DELETE') {
    return true;
  }
  if (pathOnly === '/api/vnb-monitor/thresholds' && (m === 'PUT' || m === 'DELETE')) return true;
  if (pathOnly === '/api/nbp-monitor/parameters' && (m === 'PUT' || m === 'DELETE')) return true;
  if (pathOnly.startsWith('/api/companies') && (m === 'POST' || m === 'PUT' || m === 'DELETE')) {
    return true;
  }
  if (pathOnly.startsWith('/api/objects') && (m === 'PUT' || m === 'DELETE')) {
    return true;
  }
  if (pathOnly.startsWith('/api/cya/profile') && m === 'POST') {
    return true;
  }
  if (pathOnly.startsWith('/api/webhooks') && m !== 'GET') {
    return true;
  }
  if (pathOnly.startsWith('/api/hitl/items') && m !== 'GET') {
    return true;
  }
  if (pathOnly.startsWith('/api/eog-calculator') && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/vnb/rcs/simulate' && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/vnb/rcs/assess-readiness' && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/vnb/rcs/runs' && (m === 'POST' || m === 'GET')) {
    return true;
  }
  if (
    pathOnly.startsWith('/api/vnb/rcs/runs/') &&
    (m === 'GET' || m === 'DELETE' || m === 'POST')
  ) {
    return true;
  }
  if (pathOnly === '/api/vnb/rcs/portfolio/simulate' && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/vnb/rcs/portfolio/assess-readiness' && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/vnb/rcs/rules' && m === 'GET') {
    return true;
  }
  if (pathOnly.startsWith('/api/vnb/rcs/rules/') && m === 'GET') {
    return true;
  }
  if (pathOnly === '/api/knowledge-rag/collections' && m === 'POST') {
    return true;
  }
  if (pathOnly.startsWith('/api/knowledge-rag/collections/') && m === 'DELETE') {
    return true;
  }
  if (pathOnly === '/api/knowledge-rag/ingest' && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/knowledge-rag/ingest/from-datasource' && m === 'POST') {
    return true;
  }
  if (pathOnly === '/api/knowledge-rag/ingest/from-audit' && m === 'POST') {
    return true;
  }
  if (/^\/api\/knowledge-rag\/reindex\/[^/]+$/.test(pathOnly) && m === 'POST') {
    return true;
  }
  if (/^\/api\/knowledge-rag\/cutover\/[^/]+$/.test(pathOnly) && m === 'POST') {
    return true;
  }
  if (pathOnly.startsWith('/api/mastr-monitor/watches') && (m === 'POST' || m === 'DELETE')) {
    if (pathOnly.includes('/subscribe/')) return false;
    if (pathOnly.endsWith('/subscribe')) return false;
    return true;
  }
  // Dossier Hydration Registry management — write/lifecycle endpoints require full access
  if (pathOnly === '/api/dossier-hydration/drafts' && m === 'POST') return true;
  if (pathOnly === '/api/dossier-hydration/reload' && m === 'POST') return true;
  if (/^\/api\/dossier-hydration\/[^/]+(\/validate|\/test|\/promote|\/rollback|\/deactivate)?$/.test(pathOnly) && m === 'POST') return true;
  // Domain Routes Registry management — write/lifecycle endpoints require full access
  if (pathOnly === '/api/domain-routes/drafts' && m === 'POST') return true;
  if (pathOnly === '/api/domain-routes/reload' && m === 'POST') return true;
  if (/^\/api\/domain-routes\/[^/]+(\/validate|\/test|\/promote|\/rollback|\/deactivate)?$/.test(pathOnly) && m === 'POST') return true;

  return false;
}

function requiresTokenManagementAuth(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];

  if (pathOnly === '/api/tokens/verify' && m === 'POST') return false;
  if (pathOnly === '/api/tokens' && (m === 'GET' || m === 'POST')) return true;
  if (pathOnly === '/api/tokens/tenants' && m === 'GET') return true;
  if (/^\/api\/tokens\/[^/]+$/.test(pathOnly) && m === 'DELETE') return true;

  return false;
}

function isBusinessTokenPath(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];

  // MaStR monitor confirmation/unsubscribe use :token as business path parameter,
  // not as authentication token.
  if (m === 'GET' && /^\/api\/mastr-monitor\/confirm\/[^/]+$/.test(pathOnly)) return true;
  if (m === 'DELETE' && /^\/api\/mastr-monitor\/watches\/[^/]+\/subscribe\/[^/]+$/.test(pathOnly))
    return true;

  return false;
}

function classifyEndpointClass(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];

  if (
    pathOnly === '/api/personal-agent/chat' ||
    pathOnly === '/api/copilot/ask-cernion-agent' ||
    pathOnly === '/api/copilot/answer-dossier' || // v0.63.0 #220
    pathOnly.startsWith('/api/utility-report') ||
    pathOnly === '/api/mastr-quality/audit' ||
    pathOnly === '/api/finance-agent/analyze' ||
    pathOnly.startsWith('/api/knowledge-rag/query') ||
    pathOnly.startsWith('/api/knowledge-rag/semantic') ||
    pathOnly.startsWith('/api/knowledge-rag/ingest') ||
    /^\/api\/knowledge-rag\/(reindex|cutover)\//.test(pathOnly) ||
    pathOnly === '/api/grid-connection/validate' ||
    pathOnly === '/api/energy-sharing/validate' ||
    pathOnly === '/api/redispatch-expost/audit'
  ) {
    return 'compute';
  }

  if (isReadMethod(m)) return 'read';
  return 'write';
}

async function emitRateQuotaEvents(broker, tenantId, events, extra = {}) {
  if (
    !broker ||
    typeof broker.emit !== 'function' ||
    !Array.isArray(events) ||
    events.length === 0
  ) {
    return;
  }

  for (const event of events) {
    await broker.emit(event.type, {
      eventId: event.id,
      tenantId,
      resource: event.resource,
      window: event.window,
      limit: event.limit,
      used: event.used,
      threshold: event.threshold,
      ...extra,
    });
  }
}

function requiresHitlApproverRole(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  if (m !== 'POST') return false;

  return (
    /^\/api\/hitl\/items\/[^/]+\/approve$/.test(pathOnly) ||
    pathOnly === '/api/hitl/items/bulk-approve'
  );
}

function addLegacyTokenDeprecationHeaders(ctx) {
  ctx.meta.$responseHeaders = {
    ...(ctx.meta.$responseHeaders || {}),
    Deprecation: 'true',
    Sunset: CK_TOKEN_SUNSET_HTTP_DATE,
  };
}

function enforceRbacForPath(roles, method, requestPath) {
  const m = String(method || '').toUpperCase();

  if (requiresHitlApproverRole(m, requestPath) && !hasRole(roles, 'hitl-approver')) {
    throw new Errors.MoleculerClientError(
      'Role required: hitl-approver for HITL approval endpoints.',
      403,
      'ROLE_REQUIRED'
    );
  }

  const pathOnly = String(requestPath || '').split('?')[0];
  const isSessionSelfServiceEndpoint =
    pathOnly === '/api/auth/verify' ||
    pathOnly === '/api/auth/refresh' ||
    pathOnly === '/api/auth/logout' ||
    pathOnly === '/api/auth/saml/acs';

  if (
    m !== 'GET' &&
    m !== 'HEAD' &&
    m !== 'OPTIONS' &&
    !isSessionSelfServiceEndpoint &&
    !isReadOnlySidecarInvocation(m, requestPath)
  ) {
    if (!hasRole(roles, 'full-access')) {
      throw new Errors.MoleculerClientError('Role required: full-access.', 403, 'ROLE_REQUIRED');
    }
  }
}

module.exports = {
  name: 'api',
  mixins: [ApiGateway, OpenapiMixin],

  settings: {
    port: process.env.PORT || 3000,

    ip: '0.0.0.0',

    use: [],

    // OpenAPI settings
    openapi: {
      info: {
        title: 'Cernion Energy Tools API',
        version: packageVersion,
        description:
          'MicroService Agent System for Energy Markets - REST API with AI integration.\n\nCERNION_TOKEN: request at https://cernion.de/ or by email: dev@stromdao.com.',
      },
      tags: [
        { name: 'Energy', description: 'Energy market operations' },
        { name: 'Example', description: 'Example service endpoints' },
        { name: 'DataSources', description: 'Inhouse datasource registry, cache, and discovery' },
        { name: 'VNBMonitor', description: 'VNB (grid operator) KPI monitoring and alerts' },
        {
          name: 'NBPMonitor',
          description: 'Netzbetreiberprüfungs-Monitor (MaStR status 2955 queue KPIs)',
        },
        { name: 'IntegrationHub', description: 'Token management and integration helpers' },
        { name: 'Authentication', description: 'OIDC/SAML session bootstrap and verification' },
        {
          name: 'Tenant Quotas',
          description: 'Tenant quota snapshots, events, and admin overrides',
        },
        { name: 'Jobs', description: 'Async job status and result polling (v0.9.8+)' },
        {
          name: 'Datapoints',
          description:
            'Managed data source points with lifecycle tracking and health monitoring (v0.11)',
        },
        {
          name: 'OSM Geo (OpenStreetMap)',
          description:
            'Layer 2 Geo-Architecture: physical grid infrastructure from OpenStreetMap via the Overpass API. ' +
            'Complements authoritative VNBDigital data (Layer 1) with visible substations, transformers, and lines. ' +
            'Data: © OpenStreetMap contributors, ODbL 1.0 — https://opendatacommons.org/licenses/odbl/',
        },
        {
          name: 'OEP (Open Energy Platform)',
          description:
            'Read-only access to Open Energy Platform research and scenario datasets. ' +
            'No authentication required for public tables. ' +
            'Supports schema/table discovery, column metadata, row queries, and full-text search. ' +
            'API: https://openenergyplatform.org/api/v0',
        },
        {
          name: 'Knowledge RAG',
          description:
            'HyDE-aware RAG access with tenant-local ingestion and vector indexing. ' +
            'Supports semantic search, scroll/fetch/collection info, collection lifecycle, datasource/audit ingestion, and reindex/cutover.',
        },
        {
          name: 'Finance Agent',
          description:
            'Deterministic finance/regulatory analysis for VNBs (v0.40). ' +
            'Performs query planning, ontology-aware RAG retrieval, L1/L2 evidence arbitration, and guarded synthesis with audit trail.',
        },
        {
          name: 'Personal Agent',
          description:
            'Interactive personal chat orchestration (v0.52). ' +
            'Builds deterministic L0-L4 context stacks with strict token budgeting. ' +
            'Layer 4 is transient and never persisted.',
        },
        {
          name: 'Actor Personas',
          description:
            'Tenant-scoped actor persona registry for HITL routing, notification ownership, and persona-aware inbox delivery.',
        },
        {
          name: 'Grid Connection Validation',
          description:
            'Deterministic 6-step Netzanschluss validation pipeline (v0.14). ' +
            'Produces structured findings and a Go/No-Go decision sealed with a PouchDB snapshot for audit integrity. ' +
            'No LLM involvement — identical inputs always produce identical finding codes.',
        },
        {
          name: 'Energy Sharing Validation',
          description:
            'Deterministic 6-step Energy Sharing community validation pipeline (v0.15). ' +
            'Validates generator MaStR records, Direktvermarkter status (§ 21 Abs. 2 EEG), ' +
            'share allocations, and § 42c EnWG eligibility. ' +
            'Interims-Prozess for VNBs ahead of § 20b EnWG central platform. ' +
            'No LLM involvement — identical inputs always produce identical finding codes.',
        },
        {
          name: 'Energy Sharing Allocation',
          description:
            'Deterministic 6-step Energy Sharing allocation engine (v0.16). ' +
            'Computes per-consumer 15-min allocation time-series (§ 12 StromNZV) for § 42c EnWG communities. ' +
            'Stufe A: synthetic forecast via mastr_generation_forecast. ' +
            'Stufe B: real iMSys metering data via inhouse CSV upload. ' +
            'KRITIS-compliant: time-series computed in RAM, only metadata persisted. ' +
            'Interimsprozess operative deadline: 01.06.2026 (§ 20b EnWG).',
        },
        {
          name: 'MaStR Data Quality',
          description:
            'Deterministic 8-step MaStR portfolio quality audit (v0.17). ' +
            'Audits the entire VNB portfolio in MaStR: VNB identity → full inventory → ' +
            'status anomalies → capacity anomalies → connection point integrity → ' +
            'duplicate detection → geo spot check → audit trail. ' +
            'Returns a qualityScore (0–100) across 5 weighted dimensions. ' +
            'No LLM involvement. Steps 3–7 independently skippable via skipSteps parameter.',
        },
        {
          name: 'Redispatch Ex-Post',
          description:
            'Deterministic 7-step Redispatch 2.0 Ex-Post settlement audit (v0.18). ' +
            'Cross-references MaStR portfolio (≥100 kW) with Netztransparenz curtailment data: ' +
            'VNB identity → portfolio inventory → master data validation → ' +
            'curtailment correlation → settlement readiness → financial risk assessment → audit trail. ' +
            'Returns settlementReadiness (% of installations ready for A96 settlement) and ' +
            'riskAssessment (estimated lost compensation in €). ' +
            'No LLM involvement. Regulatory basis: §§ 13, 13a EnWG, NABEG, StromNZV, Redispatch 2.0 (BDEW/BNetzA). ' +
            'Steps 3–6 independently skippable via skipSteps parameter.',
        },
        {
          name: 'Dashboard API',
          description:
            'UI-optimised aggregate endpoints (v0.19). ' +
            'Each endpoint consolidates 4–7 internal service calls into a single response, ' +
            'reducing the roundtrips required for an Enterprise UI dashboard page to one. ' +
            'Read-only — no side-effects, no own PouchDB. ' +
            'Endpoints: vnb-overview (VNB identity + KPIs + latest agent results), ' +
            'market-snapshot (spot prices + CO₂ + renewable forecast), ' +
            'quality-summary (recent reports from all agent pipelines), ' +
            'observability-mini (compact health/incidents/performance cards), ' +
            'finding-codes (complete 100-code reference with metadata for UI tooltips).',
        },
        {
          name: 'Observability',
          description:
            'Read-only production feedback endpoints (v0.40.7) for captured service log output, ' +
            'action performance metrics, compact operational summaries, and an agent-ready debugging prompt. ' +
            'Data is retained locally in PouchDB with redaction-safe storage.',
        },
        {
          name: 'Companies',
          description:
            'Company entity management (v0.20.3). ' +
            'Groups multiple BDEW market-partner codes that belong to the same economic unit ' +
            '(Konzernverbund / Stadtwerk). ' +
            'Supports autoDiscover (cernion_market_partners query → draft → confirm flow) ' +
            'and manual member management. ' +
            'enrichResults enriches market-partner search results with companyId + marketRole.',
        },
        {
          name: 'Zielnetzplanung (ZNP)',
          description:
            'Stateful workspace API for target grid planning (v0.20.4). ' +
            'Each project is an in-memory graphology graph for a geographic bounding box. ' +
            'Data Layers are loaded iteratively: ' +
            'Layer 0 (MaStR assets), Layer 1 (OSM buildings — stub), Layer 2 (transformer loads — stub). ' +
            'All assets in Layer 0 connect to a virtual substation SUB_1 (MaStR has no topology). ' +
            'Graph state is persisted in PouchDB (meta + graph split docs) and hydrated on service start. ' +
            'Project metadata (bbox, layer counts) is persisted alongside graph topology.',
        },
        {
          name: 'Object Store',
          description:
            'Generic namespaced document store backed by PouchDB (v0.20.5). ' +
            'Provides CRUD and Mango-query operations for frontend persistence ' +
            '(ZNP workspaces, user settings, etc.) without backend schema changes. ' +
            'Documents are keyed as namespace:key; namespace isolation enforced in all queries.',
        },
        {
          name: 'Cookbook',
          description:
            'Reusable API workflow recipes (v0.20.5). ' +
            'Code-managed community cookbook with semantic lookup, runtime relation graph, ' +
            'and periodic validity checks against live microservice actions.',
        },
        {
          name: 'Agent Receipts',
          description:
            'Runtime-managed receipt documents (v0.54.0 foundation). ' +
            'PouchDB-backed CRUD, validation, lifecycle status transitions, and auditable soft-delete.',
        },
        {
          name: 'CYA Agent',
          description:
            'Stakeholder-perspective argumentation engine with regulatory grounding (v0.26). ' +
            'Generates data-backed, profile-aware narratives from Cernion microservice data + OEO regulatory context.',
        },
        {
          name: 'EDM (Energiedatenmanagement)',
          description:
            'Meter data management with SQLite-backed timeseries storage, MeLo registry, and measurement concepts (v0.28). ' +
            'KRITIS-compliant embedded storage with quarterly partitioning.',
        },
        {
          name: 'SLP (Standardlastprofile)',
          description:
            'Standard load profiles (BDEW H0/G0/L0) and custom profiles for load estimation, settlement, and forecast baseline.',
        },
        {
          name: 'Settlement (Abrechnung)',
          description:
            'Redispatch compensation (§13a/14 EnWG), EEG revenue calculation, and A96 settlement export. ' +
            'Based on EDM timeseries, generation forecasts, and ENTSO-E market prices with KRITIS fallbacks.',
        },
        {
          name: 'Forecast (Prognostik)',
          description:
            'Load forecasting (SLP-based with historical correction), generation forecasting (MCP with KRITIS fallback), residual load calculation, Day-Ahead scheduling, storage dispatch optimization, and forecast quality evaluation (RMSE/MAE/MAPE).',
        },
        {
          name: 'Flex (§14a Flexibilitätsmanagement)',
          description:
            'Controllable consumption device management (§14a EnWG). ' +
            'SVE registry, dimming planning with grid capacity analysis, MQTT-based execution, Entlastungsnachweis, and tariff reduction.',
        },
        {
          name: 'MaStR Monitor',
          description:
            'MaStR installation change monitoring with field-level delta detection and email notifications (v0.27). ' +
            'Watches track changes to MaStR installations based on saved queries with configurable schedules.',
        },
        {
          name: 'HITL',
          description:
            'Human-in-the-loop approval workflow with tenant-scoped review items, intervention trail, and lifecycle events.',
        },
        {
          name: 'Investment Planning',
          description:
            'Deterministic investment planning and budget steering (v0.51.2) with hybrid Soll baselines, ' +
            'Redispatch Ex-Post Ist comparison, mandate alignment checks, and >1M EUR HITL triggers.',
        },
        {
          name: 'Blindflug Radar',
          description:
            'Deterministic disturbance-to-investment signal correlation (v0.51.3) using Redispatch, MaStR monitor deltas, and quality findings with confidence-threshold auto-proposals.',
        },
        {
          name: 'Netzfahrplan / fNAV',
          description:
            'Deterministic fNAV feasibility assessment (v0.51.5): capacity model (firm + flexible + curtailment), ' +
            'N-1 check with hybrid threshold (domain default + tenant/project/scenario override), ' +
            'technical feasibility verdict, governance gate (Option B: requires_governance_decision until legal + contract prerequisites met), ' +
            'and TOTEX-based economics with eog-calculator integration.',
        },
        {
          name: 'Webhooks',
          description:
            'Outbound webhook subscriptions with signed delivery, retry backoff, replay, and dead-letter tracking.',
        },
        {
          name: 'Interface Placeholder',
          description: 'Explicit gap markers for unresolved interfaces, evidence, and ownership',
        },
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Optional Cernion MCP token. If not provided, falls back to CERNION_TOKEN from environment. Request token at https://cernion.de/ or by email: dev@stromdao.com.',
          },
        },
        parameters: {
          TokenQuery: {
            name: 'token',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
            },
            description:
              'Optional Cernion MCP token as URL query parameter. If provided, it overrides CERNION_TOKEN for this request. Prefer Authorization Bearer header in production to reduce token exposure in URLs/logs.',
          },
        },
        schemas: {
          PaginationCursor: {
            type: 'string',
            description: 'Opaque cursor token for keyset pagination.',
            example:
              'eyJwaXZvdCI6eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTA1VDA5OjAwOjAwLjAwMFoiLCJpZCI6ImFiYy0xMjMifSwiZGlyZWN0aW9uIjoibmV4dCIsImhhc2giOiIuLi4ifQ',
          },
          PageInfo: {
            type: 'object',
            properties: {
              nextCursor: {
                oneOf: [{ $ref: '#/components/schemas/PaginationCursor' }, { type: 'null' }],
              },
              prevCursor: {
                oneOf: [{ $ref: '#/components/schemas/PaginationCursor' }, { type: 'null' }],
              },
              hasMore: { type: 'boolean' },
              totalCountApprox: {
                oneOf: [{ type: 'integer' }, { type: 'null' }],
              },
            },
            required: ['hasMore'],
          },
        },
      },
      security: [{}, { BearerAuth: [] }],
    },

    routes: [
      // Root route (redirect to docs)
      {
        path: '/',

        whitelist: [],

        use: [],

        mergeParams: true,

        authentication: false,

        authorization: false,

        autoAliases: true,

        aliases: {
          'GET /'(req, res) {
            res.writeHead(302, { Location: '/api/docs' });
            res.end();
          },

          // Sample Application – AI-powered research agent UI
          'GET /app'(req, res) {
            const appHtml = path.join(__dirname, '..', 'src', 'app.html');
            try {
              const html = fs.readFileSync(appHtml, 'utf-8');
              res.setHeader(CONTENT_TYPE_HEADER, 'text/html; charset=utf-8');
              res.end(html);
            } catch (err) {
              res.writeHead(500);
              res.end('Sample app not found: ' + err.message);
            }
          },

          // LLM context file – machine-readable API surface for AI tooling
          'GET /llm.txt'(req, res) {
            const llmTxt = path.join(__dirname, '..', 'llm.txt');
            try {
              const content = fs.readFileSync(llmTxt, 'utf-8');
              res.setHeader(CONTENT_TYPE_HEADER, 'text/plain; charset=utf-8');
              res.end(content);
            } catch (err) {
              res.writeHead(404);
              res.end('llm.txt not found: ' + err.message);
            }
          },

          // MS365 Copilot uses a curated OpenAPI subset, not the full Swagger spec.
          'GET /openapi-copilot.json'(req, res) {
            try {
              const content = fs.readFileSync(COPILOT_OPENAPI_PATH, 'utf-8');
              res.setHeader(CONTENT_TYPE_HEADER, CONTENT_TYPE_JSON);
              res.setHeader('Cache-Control', 'no-cache');
              res.end(content);
            } catch (_err) {
              res.writeHead(404, { [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON });
              res.end(
                JSON.stringify({
                  success: false,
                  message:
                    'openapi-copilot.json not found. Run npm run export:openapi:copilot before deployment.',
                })
              );
            }
          },

          async 'GET /metrics'(req, res) {
            try {
              if (!envTrue('METRICS_PUBLIC')) {
                const token = extractRawToken(req);
                if (!token || !token.startsWith('ck_')) {
                  res.writeHead(401, { [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON });
                  res.end(
                    JSON.stringify({
                      success: false,
                      message: 'Full-access API token required for /metrics.',
                    })
                  );
                  return;
                }

                const verification = await this.broker.call('token-manager.verify', {
                  token,
                  method: 'GET',
                  path: '/metrics',
                  trackUsage: false,
                });

                if (!verification?.valid) {
                  res.writeHead(401, { [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON });
                  res.end(
                    JSON.stringify({ success: false, message: 'Invalid or revoked API token.' })
                  );
                  return;
                }

                if (verification.scope !== 'full-access') {
                  res.writeHead(403, { [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON });
                  res.end(
                    JSON.stringify({
                      success: false,
                      message: 'Full-access API token required for /metrics.',
                    })
                  );
                  return;
                }

                res.setHeader('Deprecation', 'true');
                res.setHeader('Sunset', CK_TOKEN_SUNSET_HTTP_DATE);
              }

              const payload = await metrics.renderMetrics();
              res.setHeader(CONTENT_TYPE_HEADER, metrics.contentType());
              res.end(payload);
            } catch (err) {
              res.writeHead(500, { [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON });
              res.end(
                JSON.stringify({
                  success: false,
                  message: sanitizeErrorMessage(err.message),
                })
              );
            }
          },
        },
      },
      // Main API routes
      {
        path: '/api',

        whitelist: ['**'],

        cors: {
          origin: API_CORS_ORIGIN_MATCHER,
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
          allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-tenant-id',
            'x-request-id',
            'X-API-Key',
          ],
          exposedHeaders: [
            'x-request-id',
            'x-ratelimit-limit',
            'x-ratelimit-remaining',
            'x-ratelimit-reset',
          ],
          credentials: false,
          maxAge: 3600,
        },

        use: [],

        mergeParams: true,

        authentication: false,

        authorization: false,

        autoAliases: true,

        aliases: {
          'POST /blindflug-radar/scan': 'v1.blindflug-radar.scan',
          'GET /openapi.json': 'api.openapi',
          'GET /openapi-copilot.json': 'api.openapiCopilot',
          'GET /docs'(req, res) {
            // Serve Swagger UI HTML
            res.setHeader(CONTENT_TYPE_HEADER, 'text/html');
            res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cernion Energy Tools API</title>
  <link rel="stylesheet" type="text/css" href="../swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin:0; padding:0; }
    .topbar-wrapper .link::after { content: " | "; color: #ccc; }
    .sample-app-link {
      display: inline-block;
      padding: 6px 14px;
      background: #4ade80;
      color: #0a1a10;
      font-weight: 700;
      font-size: .85rem;
      border-radius: 6px;
      text-decoration: none;
      margin-left: 16px;
      vertical-align: middle;
    }
    .sample-app-link:hover { opacity: .85; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="../swagger-ui-bundle.js"></script>
  <script src="../swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        onComplete: function() {
          // Inject sample-app link into topbar
          const topbarWrapper = document.querySelector('.topbar-wrapper');
          if (topbarWrapper) {
            const a = document.createElement('a');
            a.href = '/app';
            a.className = 'sample-app-link';
            a.textContent = '⚡ Open Research Agent';
            topbarWrapper.appendChild(a);
          }
        }
      });
      window.ui = ui;
    };
  </script>
</body>
</html>
            `);
          },

          // Datasource routes (explicit aliases to avoid fallback mapping to
          // non-existent "datasources" service names when autoAlias resolution
          // is not available at runtime)
          'GET /datasources': 'datasource-registry.list',
          'POST /datasources': 'datasource-registry.create',
          'GET /datasources/connector-types': 'datasource-connector.listPlugins',
          'GET /datasources/:id': 'datasource-registry.get',
          'PUT /datasources/:id': 'datasource-registry.update',
          'DELETE /datasources/:id': 'datasource-registry.remove',
          'GET /datasources/:id/dictionary': 'datasource-registry.getDictionary',
          'PUT /datasources/:id/dictionary': 'datasource-registry.updateDictionary',
          'GET /datasources/:id/dictionary/history': 'datasource-registry.getDictionaryHistory',
          'GET /datasources/:id/dictionary/:version': 'datasource-registry.getDictionaryVersion',
          'GET /datasources/:id/dictionary/check': 'datasource-registry.checkDictionaryVersion',
          'GET /datasources/:id/classification': 'datasource-registry.getClassification',
          'PATCH /datasources/:id/classification': 'datasource-classifier.confirm',
          'POST /datasources/:id/infer': 'datasource-registry.infer',
          'POST /datasources/:id/refresh': 'datasource-registry.refresh',
          'GET /datasource-cache/:sourceId/status': 'datasource-cache.status',
          'GET /datasource-cache/:sourceId': 'datasource-cache.query',
          'DELETE /datasource-cache/:sourceId': 'datasource-cache.invalidate',
          'GET /datasource-cache/:sourceId/audit': 'datasource-cache.audit',
          'GET /datasource-discovery': 'datasource-discovery.list',
          'GET /datasource-discovery/search': 'datasource-discovery.search',
          'GET /datasource-discovery/:sourceId/descriptor': 'datasource-discovery.descriptor',
          'GET /datasource-watcher/status': 'datasource-watcher.status',
          'GET /tokens': 'token-manager.list',
          'POST /tokens': 'token-manager.create',
          'DELETE /tokens/:id': 'token-manager.revoke',
          'POST /tokens/verify': 'token-manager.verify',
          'GET /tokens/tenants': 'token-manager.tenant.list',
          'GET /tenants/:id/quotas': 'tenant-quota.getQuotas',
          'PUT /tenants/:id/quotas': 'tenant-quota.setQuotas',
          'GET /tenants/:id/rate-limit-events': 'tenant-quota.listEvents',
          'GET /auth/oidc/login': 'auth.oidcLogin',
          'GET /auth/oidc/callback': 'auth.oidcCallback',
          'POST /auth/saml/acs': 'auth.samlAcs',
          'POST /auth/verify': 'auth.verify',
          'POST /auth/refresh': 'auth.refresh',
          'POST /auth/logout': 'auth.logout',
          'GET /vnb-monitor/thresholds': 'vnb-monitor.getThresholds',
          'PUT /vnb-monitor/thresholds': 'vnb-monitor.setThresholds',
          'DELETE /vnb-monitor/thresholds': 'vnb-monitor.resetThresholds',
          'GET /vnb-monitor/:bdewCode/nbp-monitor': 'nbp-monitor.snapshot',
          'GET /nbp-monitor/parameters': 'nbp-monitor.getParameters',
          'PUT /nbp-monitor/parameters': 'nbp-monitor.setParameters',
          'DELETE /nbp-monitor/parameters': 'nbp-monitor.resetParameters',
          // Datapoints (v0.11–v0.13) — static routes MUST precede /:name to avoid route shadowing
          'POST /datapoints': 'datapoint.create',
          'POST /datapoints/promote': 'datapoint.promote',
          'GET /datapoints': 'datapoint.list',
          'GET /datapoints/health/overview': 'datapoint.health',
          'GET /datapoints/oeo-context': 'datapoint.oeoContext',
          // Snapshots (v0.13) — must be before /:name
          'POST /datapoints/snapshot': 'datapoint.createSnapshot',
          'GET /datapoints/snapshots': 'datapoint.listSnapshots',
          'GET /datapoints/snapshot/:id': 'datapoint.getSnapshot',
          'POST /datapoints/snapshot/:id/validate': 'datapoint.validateSnapshot',
          'DELETE /datapoints/snapshot/:id': 'datapoint.removeSnapshot',
          'GET /datapoints/:name/oemetadata': 'datapoint.oemetadata',
          'GET /datapoints/:name/interventions': 'datapoint.interventions',
          'GET /datapoints/:name': 'datapoint.get',
          'PUT /datapoints/:name': 'datapoint.update',
          'DELETE /datapoints/:name': 'datapoint.remove',
          'POST /datapoints/:name/refresh': 'datapoint.refresh',
          'GET /datapoints/:name/data': 'datapoint.data',
          'POST /in-memory-join/join': 'in-memory-join.join',
          'POST /in-memory-join/metering-spot-cost': 'in-memory-join.meteringSpotCost',
          'POST /in-memory-join/benchmark-compare': 'in-memory-join.benchmarkCompare',
          'POST /in-memory-join/compare-forecast-actual': 'in-memory-join.compareForecastActual',
          // EEG Claw-Back Simulator (RCS, v0.58+)
          'POST /vnb/rcs/simulate': 'eeg-clawback-calculator.simulate',
          'POST /vnb/rcs/calculate': 'eeg-clawback-calculator.calculate',
          'POST /vnb/rcs/assess-readiness': 'eeg-clawback-calculator.assessReadiness',
          // RCS Portfolio (P1)
          'POST /vnb/rcs/portfolio/simulate': 'eeg-clawback-calculator.simulatePortfolio',
          'POST /vnb/rcs/portfolio/assess-readiness':
            'eeg-clawback-calculator.assessPortfolioReadiness',
          // RCS Simulation Run persistence (P0.4)
          'POST /vnb/rcs/runs': 'rcs-simulation-run.saveRun',
          'GET /vnb/rcs/runs': 'rcs-simulation-run.listRuns',
          'GET /vnb/rcs/runs/:runId': 'rcs-simulation-run.getRun',
          'DELETE /vnb/rcs/runs/:runId': 'rcs-simulation-run.deleteRun',
          // RCS Pagination endpoints (v0.60.6 WP5)
          'GET /vnb/rcs/runs/:runId/assets': 'rcs-simulation-run.listRunAssets',
          'GET /vnb/rcs/runs/:runId/assets/:assetId': 'rcs-simulation-run.getRunAsset',
          'GET /vnb/rcs/runs/:runId/errors': 'rcs-simulation-run.listRunErrors',
          // RCS UI Enablement (v0.60.7)
          'GET /vnb/rcs/rules': 'rcs-rule-catalog.listRuleSets',
          'GET /vnb/rcs/rules/:ruleSetId': 'rcs-rule-catalog.getRuleSet',
          'POST /vnb/rcs/runs/:runId/assets/:assetId/drilldown':
            'eeg-clawback-calculator.drilldownAsset',
          'GET /vnb/rcs/runs/:runId/assets/:assetId/trace': 'rcs-simulation-run.getTrace',
          'GET /vnb/rcs/runs/:runId/readiness': 'rcs-simulation-run.getRunReadiness',
          // EOG Calculator (Revenue Cap Calculation)
          'POST /eog-calculator/input-status': 'eog-calculator.inputStatus',
          'POST /eog-calculator/validate-datapoints': 'eog-calculator.validateDatapoints',
          'POST /eog-calculator/commit-datapoints': 'eog-calculator.commitDatapoints',
          'POST /eog-calculator/calculate': 'eog-calculator.calculate',
          'POST /eog-calculator/scenario': 'eog-calculator.scenario',
          'POST /eog-calculator/request-input': 'eog-calculator.requestInput',
          // VDMI Governance APIs (v0.50.2) — Human Override, Spectator Mode, Findings, Evidence
          // Human Override
          'PATCH /vdmi/tenants/:tenantId/matrices/:matrixId': 'vdmi-human-override.override',
          'POST /vdmi/tenants/:tenantId/matrices/:matrixId/revert': 'vdmi-human-override.revert',
          // Spectator Mode (Negotiation Transparency)
          'GET /vdmi/tenants/:tenantId/tasks/:taskId/negotiation-trace':
            'vdmi-spectator.negotiationTrace',
          'GET /vdmi/tenants/:tenantId/tasks/:taskId/dossier': 'vdmi-spectator.dossier',
          // Governance Findings (Shadow IT Resolution)
          'GET /vdmi/tenants/:tenantId/findings': 'vdmi-findings.list',
          'POST /vdmi/tenants/:tenantId/findings/:findingId/mitigate': 'vdmi-findings.mitigate',
          'POST /vdmi/tenants/:tenantId/findings/:findingId/resolve': 'vdmi-findings.resolve',
          // Evidence Injection (Offline-Realität)
          'POST /vdmi/tenants/:tenantId/tasks/:taskId/evidence': 'vdmi-evidence.inject',
          'POST /vdmi/tenants/:tenantId/evidence/:evidenceId/sign': 'vdmi-evidence.sign',
          // Presentation (#CETview v0.53.x)
          'POST /presentation/render': 'presentation.render',
          'GET /jobs/:jobId/status': 'job-status.status',
          'GET /jobs/:jobId/progress': 'job-status.progress',
          'GET /jobs/:jobId/result': 'job-status.result',
          'POST /jobs/:jobId/wake-up': 'job-status.wakeUp',
          'GET /jobs/alarms': 'job-status.listAlarms',
          'POST /jobs/alarms/:alarmId/ack': 'job-status.acknowledgeAlarm',
          'POST /jobs/alarms/:alarmId/resolve': 'job-status.resolveAlarm',
          // OEP (Open Energy Platform) read-only connector (v0.12)
          'GET /oep/schemas': 'oep.listSchemas',
          'GET /oep/schemas/:schema/tables': 'oep.listTables',
          'GET /oep/tables/:schema/:table/meta': 'oep.getTableMeta',
          'GET /oep/tables/:schema/:table/rows': 'oep.query',
          'GET /oep/search': 'oep.search',
          // OSM Geo (v0.10)
          'POST /osm-geo/validate': 'osm-geo.validate',
          'POST /osm-geo/infrastructure-nearby': 'osm-geo.infrastructureNearby',
          'POST /osm-geo/substation-finder': 'osm-geo.substationFinder',
          'POST /osm-geo/grid-topology': 'osm-geo.gridTopology',
          // Knowledge RAG (v0.39)
          'POST /knowledge-rag/query': 'knowledge-rag.query',
          'POST /knowledge-rag/semantic': 'knowledge-rag.semantic',
          'POST /knowledge-rag/scroll': 'knowledge-rag.scroll',
          'POST /knowledge-rag/fetch': 'knowledge-rag.fetch',
          'POST /knowledge-rag/collection-info': 'knowledge-rag.collectionInfo',
          'POST /knowledge-rag/collections': 'knowledge-rag.createCollection',
          'POST /knowledge-rag/ingest': 'knowledge-rag.ingest',
          'POST /knowledge-rag/ingest/from-datasource': 'knowledge-rag.ingestFromDatasource',
          'POST /knowledge-rag/ingest/from-audit': 'knowledge-rag.ingestFromAudit',
          'DELETE /knowledge-rag/collections/:name': 'knowledge-rag.removeCollection',
          'POST /knowledge-rag/reindex/:collection': 'knowledge-rag.reindex',
          'POST /knowledge-rag/cutover/:collection': 'knowledge-rag.cutover',
          // Grid Connection Validation (v0.14)
          'POST /grid-connection/validate': 'grid-connection.validate',
          'GET /grid-connection/validations': 'grid-connection.list',
          'GET /grid-connection/validations/:id': 'grid-connection.get',
          // Energy Sharing Validation (v0.15)
          'POST /energy-sharing/validate': 'energy-sharing.validate',
          'GET /energy-sharing/validations': 'energy-sharing.list',
          'GET /energy-sharing/validations/:id': 'energy-sharing.get',
          // Energy Sharing Allocation (v0.16) — /download must precede /:id
          'POST /energy-sharing-allocation/allocate': 'energy-sharing-allocation.allocate',
          'GET /energy-sharing-allocation/allocations': 'energy-sharing-allocation.list',
          'GET /energy-sharing-allocation/allocations/:id/download':
            'energy-sharing-allocation.download',
          'GET /energy-sharing-allocation/allocations/:id': 'energy-sharing-allocation.get',
          'DELETE /energy-sharing-allocation/allocations/:id': 'energy-sharing-allocation.remove',
          // MaStR Data Quality (v0.17)
          'POST /mastr-quality/audit': 'mastr-quality.audit',
          'GET /mastr-quality/audits': 'mastr-quality.list',
          'GET /mastr-quality/audits/:id/findings/:findingId/details':
            'mastr-quality.findingDetails',
          'GET /mastr-quality/audits/:id': 'mastr-quality.get',
          'GET /mastr-quality/audits/:id/oemetadata': 'mastr-quality.oemetadata',
          // Redispatch Ex-Post (v0.18)
          'POST /redispatch/audit': 'redispatch-expost.audit',
          'GET /redispatch/audits': 'redispatch-expost.list',
          'GET /redispatch/audits/:id': 'redispatch-expost.get',
          // Investment Planning (v0.51.2)
          'POST /investment-planning/plans': 'investment-planning.createPlan',
          'GET /investment-planning/plans': 'investment-planning.listPlans',
          'GET /investment-planning/plans/:id': 'investment-planning.getPlan',
          // Blindflug Radar (v0.51.3)
          'POST /blindflug-radar/scan': 'blindflug-radar.scanBlindflug',
          'POST /blindflug-radar/recommendations': 'blindflug-radar.recommendFromDisturbances',
          'GET /blindflug-radar/scans': 'blindflug-radar.listScans',
          'GET /blindflug-radar/scans/:id': 'blindflug-radar.getScan',
          // Netzfahrplan / fNAV (v0.51.5)
          'POST /netzfahrplan/generate': 'grid-operations.netzfahrplanGenerate',
          'POST /grid-connection/fnav/validate': 'grid-connection.fnavValidate',
          'POST /finance-agent/fnav/economics': 'finance-agent.fnavEconomics',
          // Finance Agent (v0.40.5)
          'POST /finance-agent/analyze': 'finance-agent.analyze',
          'GET /finance-agent/analyses': 'finance-agent.list',
          'GET /finance-agent/analyses/:id': 'finance-agent.get',
          'GET /finance-agent/prompts': 'finance-agent.prompts',
          'POST /finance-agent/memory': 'finance-agent.remember',
          'GET /finance-agent/memory/:sessionId': 'finance-agent.memory',
          // Personal Agent (v0.52.0)
          'POST /personal-agent/chat': 'personal-agent.chat',
          'POST /copilot/ask-cernion-agent': 'personal-agent.askCernionAgent',
          'POST /copilot/answer-dossier': 'personal-agent.answerDossier', // v0.63.0 #220
          'GET /personal-agent/session/:sessionId': 'personal-agent.getSession',
          'POST /personal-agent/session/:sessionId/reset': 'personal-agent.resetSession',
          'GET /personal-agent/session/:sessionId/dream-status': 'personal-agent.getDreamStatus',
          'GET /personal-agent/dream-audit': 'personal-agent.getDreamAudit',
          // Dossier Hydration Registry management (v0.63.x #234)
          // NOTE: static /drafts and /reload must precede dynamic /:id routes.
          'GET /dossier-hydration': 'dossier-hydration.list',
          'POST /dossier-hydration/drafts': 'dossier-hydration.createDraft',
          'POST /dossier-hydration/reload': 'dossier-hydration.reload',
          'GET /dossier-hydration/:id': 'dossier-hydration.get',
          'POST /dossier-hydration/:id/validate': 'dossier-hydration.validate',
          'POST /dossier-hydration/:id/test': 'dossier-hydration.test',
          'POST /dossier-hydration/:id/promote': 'dossier-hydration.promote',
          'POST /dossier-hydration/:id/rollback': 'dossier-hydration.rollback',
          'POST /dossier-hydration/:id/deactivate': 'dossier-hydration.deactivate',
          // Domain Routes Registry management (v0.63.x #233)
          // NOTE: static /drafts and /reload must precede dynamic /:id routes.
          'GET /domain-routes': 'domain-routes.list',
          'POST /domain-routes/drafts': 'domain-routes.createDraft',
          'POST /domain-routes/reload': 'domain-routes.reload',
          'GET /domain-routes/:id': 'domain-routes.get',
          'POST /domain-routes/:id/validate': 'domain-routes.validate',
          'POST /domain-routes/:id/test': 'domain-routes.test',
          'POST /domain-routes/:id/promote': 'domain-routes.promote',
          'POST /domain-routes/:id/rollback': 'domain-routes.rollback',
          'POST /domain-routes/:id/deactivate': 'domain-routes.deactivate',
          // Interface Placeholder (v0.51.0)
          'POST /interface-placeholder/mark-gap': 'interface-placeholder.markGap',
          'POST /interface-placeholder/request-evidence': 'interface-placeholder.requestEvidence',
          'GET /interface-placeholder/gaps': 'interface-placeholder.listGaps',
          'GET /interface-placeholder/gaps/:placeholderId/status':
            'interface-placeholder.returnMinimalStatus',
          'POST /interface-placeholder/gaps/:placeholderId/resolve':
            'interface-placeholder.resolveGap',
          // HITL (v0.44)
          'POST /hitl/items': 'hitl.create',
          'GET /hitl/items': 'hitl.list',
          'GET /hitl/items/:id': 'hitl.get',
          'GET /hitl/summary': 'hitl.summary',
          'GET /hitl/sla-heatmap': 'hitl.slaHeatmap',
          'POST /hitl/items/:id/approve': 'hitl.approve',
          'POST /hitl/items/:id/reject': 'hitl.reject',
          'POST /hitl/items/:id/escalate': 'hitl.escalate',
          'POST /hitl/items/bulk-approve': 'hitl.bulkApprove',
          'POST /hitl/items/bulk-reject': 'hitl.bulkReject',
          'POST /hitl/items/bulk-escalate': 'hitl.bulkEscalate',
          // Webhooks (v0.44)
          'POST /webhooks': 'webhooks.create',
          'GET /webhooks': 'webhooks.list',
          'DELETE /webhooks/:id': 'webhooks.remove',
          'POST /webhooks/:id/test': 'webhooks.test',
          'GET /webhooks/:id/deliveries': 'webhooks.listDeliveries',
          'POST /webhooks/:id/deliveries/:deliveryId/replay': 'webhooks.replay',
          // Companies (v0.20.3) — Konzernverbund / Stadtwerk entity management
          'GET /companies': 'company.list',
          'POST /companies': 'company.create',
          'GET /companies/:id': 'company.get',
          'PUT /companies/:id': 'company.update',
          'PUT /companies/:id/confirm': 'company.confirm',
          'DELETE /companies/:id': 'company.delete',
          // Dashboard API (v0.19+) — UI-optimised aggregate endpoints
          // Agent Sidecar (v0.64+) — curated OpenClaw-safe tool facade
          'GET /agent-sidecar/tools': 'agent-sidecar.listTools',
          'POST /agent-sidecar/tools/:name/call': 'agent-sidecar.callTool',
          'GET /agent-sidecar/descriptor': 'agent-sidecar.descriptor',
          'GET /agent-sidecar/mcp/tools': 'agent-sidecar.mcpListTools',
          'POST /agent-sidecar/mcp/tools/:name/call': 'agent-sidecar.mcpCallTool',
          // Dashboard API (v0.19+) — UI-optimised aggregate endpoints
          'GET /dashboard/vnb-overview': 'dashboard-api.vnbOverview',
          'GET /dashboard/redispatch-metering-cockpit': 'dashboard-api.redispatchMeteringCockpit',
          'GET /dashboard/load-profile-stream-monitor': 'dashboard-api.loadProfileStreamMonitor',
          'GET /dashboard/redispatch-call-quality-gate': 'dashboard-api.redispatchCallQualityGate',
          'GET /dashboard/evidence-grounding-confidence-audit':
            'dashboard-api.evidenceGroundingConfidenceAudit',
          'GET /dashboard/receipt-grounded-presentation-contract':
            'dashboard-api.receiptGroundedPresentationContract',
          'GET /dashboard/market-communication-evidence-chain':
            'dashboard-api.marketCommunicationEvidenceChainStatus',
          'GET /dashboard/e2e-controllability-governance':
            'dashboard-api.e2eControllabilityGovernanceStatus',
          'GET /dashboard/controllability-asset-handover':
            'dashboard-api.controllabilityAssetHandoverStatus',
          'GET /dashboard/legal-clarification-operating-model':
            'dashboard-api.legalClarificationOperatingModelStatus',
          'GET /dashboard/dr-readiness-evidence':
            'dashboard-api.drReadinessEvidenceStatus',
          'GET /dashboard/special-grid-usage-impact-map':
            'dashboard-api.specialGridUsageImpactMapStatus',
          'GET /dashboard/liquidity-planning-governance':
            'dashboard-api.liquidityPlanningGovernanceStatus',
          'GET /dashboard/energy-sharing-simulation-gate':
            'dashboard-api.energySharingSimulationGateStatus',
          'GET /dashboard/stadtwerk-mauer-sandbox-runtime':
            'dashboard-api.stadtwerkMauerSandboxRuntimeStatus',
          'GET /dashboard/stadtwerk-mauer-external-interface-stubs':
            'dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus',
          'GET /dashboard/stadtwerk-mauer-e2e-process-demo':
            'dashboard-api.stadtwerkMauerE2eProcessDemoStatus',
          'GET /dashboard/stadtwerk-mauer-mastr-data-overlay':
            'dashboard-api.stadtwerkMauerMastrDataOverlayStatus',
          'GET /dashboard/fnav-fast-track-contract-gate':
            'dashboard-api.fnavFastTrackContractGateStatus',
          'GET /dashboard/cross-channel-vnb-signal-queue':
            'dashboard-api.crossChannelVnbSignalQueueStatus',
          'GET /dashboard/asset-valuation-transformation-gate':
            'dashboard-api.assetValuationTransformationGateStatus',
          'GET /dashboard/gas-capacity-booking-review-gate':
            'dashboard-api.gasCapacityBookingReviewGateStatus',
          'GET /dashboard/gas-network-decision-chain':
            'dashboard-api.gasNetworkDecisionChainStatus',
          'GET /dashboard/water-pricing-net-investment-alignment':
            'dashboard-api.waterPricingNetInvestmentAlignmentStatus',
          'GET /dashboard/areal-network-integration-offer-gate':
            'dashboard-api.arealNetworkIntegrationOfferGateStatus',
          'GET /dashboard/transformation-financing-scenario-view':
            'dashboard-api.transformationFinancingScenarioViewStatus',
          'GET /dashboard/gas-grid-transformation-asset-cockpit':
            'dashboard-api.gasGridTransformationAssetCockpitStatus',
          'GET /dashboard/leadership-delta-cockpit':
            'dashboard-api.leadershipDeltaCockpitStatus',
          'POST /stadtwerk-mauer-sandbox-runtime/events':
            'stadtwerk-mauer-sandbox-runtime.ingestEvent',
          'POST /stadtwerk-mauer-sandbox-runtime/reset':
            'stadtwerk-mauer-sandbox-runtime.reset',
          'GET /stadtwerk-mauer-sandbox-runtime/status':
            'stadtwerk-mauer-sandbox-runtime.status',
          'POST /stadtwerk-mauer/external-interface-stubs/call':
            'stadtwerk-mauer-external-interface-stubs.callStub',
          'GET /stadtwerk-mauer/external-interface-stubs/status':
            'stadtwerk-mauer-external-interface-stubs.getStatus',
          'POST /stadtwerk-mauer/e2e-process-demo/run':
            'stadtwerk-mauer-e2e-process-demo.runDemo',
          'GET /stadtwerk-mauer/e2e-process-demo/status':
            'stadtwerk-mauer-e2e-process-demo.getStatus',
          'GET /stadtwerk-mauer/mastr-data-overlay/status':
            'stadtwerk-mauer-mastr-data-overlay.getStatus',
          'GET /dashboard/regulatory-change-readiness':
            'dashboard-api.regulatoryChangeReadinessStatus',
          'GET /dashboard/investment-two-track-control':
            'dashboard-api.investmentTwoTrackControlStatus',
          'GET /dashboard/sap-budget-psp-gate':
            'dashboard-api.sapBudgetPspGateStatus',
          'GET /dashboard/energy-tax-information-package':
            'dashboard-api.energyTaxInformationPackageStatus',
          'GET /dashboard/investment-risk-translation':
            'dashboard-api.investmentRiskTranslationStatus',
          'GET /dashboard/budget-waterfall-governance':
            'dashboard-api.budgetWaterfallGovernanceStatus',
          'GET /dashboard/gas-decommissioning-roadmap':
            'dashboard-api.gasDecommissioningRoadmapStatus',
          'GET /dashboard/jour-fixe-decision-closure':
            'dashboard-api.jourFixeDecisionClosureStatus',
          'GET /dashboard/off-balancing-metering-pruefmatrix':
            'dashboard-api.offBalancingMeteringPruefmatrixStatus',
          'GET /dashboard/automation-requirements-decision-value':
            'dashboard-api.automationRequirementsDecisionValueStatus',
          'GET /dashboard/smart-meter-off-balancing-purpose-lock':
            'dashboard-api.smartMeterOffBalancingPurposeLockStatus',
          'GET /dashboard/imsys-schedule-value-chain-readiness':
            'dashboard-api.imsysScheduleValueChainReadinessStatus',
          'GET /dashboard/cls-digital-twin-compliance-gate':
            'dashboard-api.clsDigitalTwinComplianceGateStatus',
          'GET /dashboard/legacy-control-technology-transition':
            'dashboard-api.legacyControlTechnologyTransitionStatus',
          'GET /dashboard/controllability-submission-cockpit':
            'dashboard-api.controllabilitySubmissionCockpitStatus',
          'GET /dashboard/crisis-decision-routine':
            'dashboard-api.crisisDecisionRoutineStatus',
          'GET /dashboard/investment-committee-steering-cards':
            'dashboard-api.investmentCommitteeSteeringCardsStatus',
          'GET /dashboard/investment-data-review-queue':
            'dashboard-api.investmentDataReviewQueueStatus',
          'GET /dashboard/flex-strategic-demand-intake':
            'dashboard-api.flexStrategicDemandIntakeStatus',
          'GET /dashboard/gas-infrastructure-risk-governance':
            'dashboard-api.gasInfrastructureRiskGovernanceStatus',
          'GET /dashboard/metering-rollout-process-indicator':
            'dashboard-api.meteringRolloutProcessIndicatorStatus',
          'GET /dashboard/heat-transformation-line-asset-model':
            'dashboard-api.heatTransformationLineAssetModelStatus',
          'GET /dashboard/ki-floorwalker-governance':
            'dashboard-api.kiFloorwalkerGovernanceStatus',
          'GET /dashboard/investment-waterfall-governance':
            'dashboard-api.investmentWaterfallGovernanceStatus',
          'GET /dashboard/capacity-contract-risk-asset-cockpit':
            'dashboard-api.capacityContractRiskAssetCockpitStatus',
          'GET /dashboard/imsys-taf2-compliance':
            'dashboard-api.imsysTaf2ComplianceStatus',
          'GET /dashboard/schedule-management-governance-roadmap':
            'dashboard-api.scheduleManagementGovernanceRoadmapStatus',
          'GET /dashboard/gas-transformation-dependency-map':
            'dashboard-api.gasTransformationDependencyMapStatus',
          'GET /dashboard/grid-connection-transformation-gate':
            'dashboard-api.gridConnectionTransformationGateStatus',
          'GET /dashboard/heat-asset-tariff-steering':
            'dashboard-api.heatAssetTariffSteeringStatus',
          'GET /dashboard/tech-commercial-offer-cockpit':
            'dashboard-api.techCommercialOfferCockpitStatus',
          'GET /dashboard/zaehlpark-finanzierung-szenario-cockpit':
            'dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus',
          'GET /dashboard/process-sensitization-readiness-map':
            'dashboard-api.processSensitizationReadinessMapStatus',
          'GET /dashboard/netzprozess-readiness-gate':
            'dashboard-api.netzprozessReadinessGateStatus',
          'GET /dashboard/grossspeicher-anschluss-readiness-gate':
            'dashboard-api.grossspeicherAnschlussReadinessGateStatus',
          'GET /dashboard/role-permission-access-readiness-gate':
            'dashboard-api.rolePermissionAccessReadinessGateStatus',
          'GET /dashboard/owner-deadline-evidence-gate':
            'dashboard-api.ownerDeadlineEvidenceGateStatus',
          'GET /dashboard/automation-risk-gate':
            'dashboard-api.automationRiskGateStatus',
          'GET /dashboard/redispatch-project-controlling-kpi-cockpit':
            'dashboard-api.redispatchProjectControllingKpiCockpitStatus',
          'GET /dashboard/stadtwerk-mauer-vdmi-profile':
            'dashboard-api.stadtwerkMauerVdmiProfileStatus',
          'GET /dashboard/stadtwerk-mauer-capability-projection':
            'dashboard-api.stadtwerkMauerCapabilityProjectionStatus',
          'GET /dashboard/stadtwerk-mauer-event-replay-preview':
            'dashboard-api.stadtwerkMauerEventReplayPreviewStatus',
          'POST /community/consult': 'community.consult',
          'GET /dashboard/market-snapshot': 'dashboard-api.marketSnapshot',
          'GET /dashboard/quality-summary': 'dashboard-api.qualitySummary',
          'GET /dashboard/observability-mini': 'dashboard-api.observabilityMini',
          'GET /dashboard/finding-codes': 'dashboard-api.findingCodes',
          // Observability (v0.40.6+) — production feedback endpoints
          'GET /observability/logs': 'observability.logs',
          'GET /observability/metrics': 'observability.metrics',
          'GET /observability/summary': 'observability.summary',
          'GET /observability/agent-prompt': 'observability.agentPrompt',
          // Zielnetzplanung (ZNP) — Stateful workspace API (v0.20.4 / v0.23)
          // NOTE: specific sub-paths MUST precede the bare /:projectId route to
          // prevent route shadowing. Order: most-specific first.
          'GET /znp/projects': 'znp.listProjects',
          'POST /znp/projects': 'znp.createProject',
          'GET /znp/projects/:projectId/production-readiness/status':
            'znp.productionReadinessStatus',
          'GET /znp/projects/:projectId/strategic-prompts': 'znp.strategicPrompts',
          'POST /znp/projects/:projectId/assumptions': 'znp.addAssumption',
          'POST /znp/projects/:projectId/layer0': 'znp.addLayer0',
          'POST /znp/projects/:projectId/layer1': 'znp.addLayer1',
          'POST /znp/projects/:projectId/layer2': 'znp.addLayer2',
          'GET /znp/projects/:projectId/g-factor': 'znp.calculateGFactor',
          'GET /znp/projects/:projectId/portfolio': 'znp.assessPortfolio',
          'GET /znp/projects/:projectId/assets': 'znp.getProjectAssets',

          // NOVA Decision Feed (project-scoped Phase B endpoints)
          'GET /znp/projects/:projectId/nova/pending-decisions': 'nova.pendingDecisions',
          'POST /znp/projects/:projectId/nova/apply/:id': 'nova.apply',
          'GET /znp/projects/:projectId/nova/decisions': 'nova.listDecisions',
          'GET /znp/projects/:projectId/nova/decisions/stats': 'nova.decisionStats',
          'GET /znp/projects/:projectId/nova/decisions/:id': 'nova.getDecision',
          'POST /znp/projects/:projectId/nova/decisions/:id/approve': 'nova.approveDecision',
          'POST /znp/projects/:projectId/nova/decisions/:id/reject': 'nova.rejectDecision',
          'POST /znp/projects/:projectId/nova/decisions/:id/replay-trigger': 'nova.replayTrigger',

          'GET /znp/projects/:projectId': 'znp.getProjectMeta',
          'DELETE /znp/projects/:projectId': 'znp.deleteProject',

          'GET /nova/stream': 'nova.stream',

          // Asset overrides (persistent + effective view)
          'POST /assets/:assetId/override': 'assets.override',
          'GET /assets/:assetId/overrides': 'assets.overrides',
          'GET /assets/:assetId/effective': 'assets.effective',
          'POST /assets/:assetId/overrides/:id/apply': 'assets.applyOverride',
          'DELETE /assets/:assetId/overrides/:id': 'assets.removeOverride',

          // Backup Orchestrator (v0.47) — Full-Restore Sub-Track G
          'POST /admin/backup/snapshot': 'backup-orchestrator.snapshot',
          'POST /admin/backup/restore': 'backup-orchestrator.restore',
          'GET /admin/backup/snapshots': 'backup-orchestrator.list',
          'GET /admin/backup/snapshots/:snapshotId': 'backup-orchestrator.get',
          'DELETE /admin/backup/snapshots/:snapshotId': 'backup-orchestrator.delete',
          // Bilanzkreis feature-flags (v0.47) — Sub-Track G
          'GET /bilanzkreis/:id/feature-flags': 'bilanzkreis.getFeatureFlags',
          'PATCH /bilanzkreis/:id/feature-flags': 'bilanzkreis.updateFeatureFlags',
          // Object Store — Generic namespaced document persistence (v0.20.5)
          // NOTE: /query sub-path must precede bare /:key to prevent route shadowing.
          'POST /objects/:namespace/query': 'object-store.query',
          'GET /objects/:namespace/:key': 'object-store.get',
          'PUT /objects/:namespace/:key': 'object-store.put',
          'DELETE /objects/:namespace/:key': 'object-store.delete',

          // Cookbook — reusable implementation recipes (v0.20.5)
          'GET /cookbook': 'cookbook.list',
          'GET /cookbook/health': 'cookbook.health',
          'GET /cookbook/services': 'cookbook.serviceCatalogue',
          'GET /cookbook/:id': 'cookbook.get',
          'POST /cookbook/search': 'cookbook.search',
          'POST /cookbook/validate': 'cookbook.validate',

          // Agent Manifest — llm.txt cluster manifest resolve endpoints
          // NOTE: static /capabilities must precede dynamic /capabilities/:name.
          'GET /_agent/capabilities': 'agent-manifest.listCapabilities',
          'GET /_agent/capabilities/:name': 'agent-manifest.getCapability',
          'GET /_agent/operations': 'agent-manifest.listOperations',

          // Agent Receipts — runtime-managed routing receipts (v0.54.0)
          // NOTE: static /validate and /propose must precede dynamic /:id routes.
          'GET /agent-receipts': 'agent-receipts.list',
          'POST /agent-receipts': 'agent-receipts.create',
          'POST /agent-receipts/select': 'agent-receipts.select',
          'POST /agent-receipts/validate': 'agent-receipts.validate',
          'POST /agent-receipts/propose': 'agent-receipts.proposeDraft',
          'GET /agent-receipts/:id': 'agent-receipts.get',
          'PUT /agent-receipts/:id': 'agent-receipts.update',
          'POST /agent-receipts/:id/status': 'agent-receipts.setStatus',
          'POST /agent-receipts/:id/promote': 'agent-receipts.promote',
          'DELETE /agent-receipts/:id': 'agent-receipts.archive',

          // Actor Personas — static role routes must precede dynamic /:id routes.
          'GET /agent-personas': 'agent-persona.list',
          'POST /agent-personas': 'agent-persona.create',
          'GET /agent-personas/by-role/:role': 'agent-persona.listByRole',
          'GET /agent-personas/resolve-by-role/:role': 'agent-persona.resolveByRole',
          'POST /agent-personas/seed-operational-defaults': 'agent-persona.seedOperationalDefaults',
          'GET /agent-personas/:id': 'agent-persona.get',
          'PUT /agent-personas/:id': 'agent-persona.update',
          'DELETE /agent-personas/:id': 'agent-persona.remove',

          // CYA Agent (v0.26)
          'POST /cya/profile': 'cya.createProfile',
          'GET /cya/profile/:profile_id': 'cya.getProfile',
          'GET /cya/profiles': 'cya.listProfiles',
          'GET /cya/templates': 'cya.listTemplates',
          'GET /cya/templates/:templateId': 'cya.getTemplate',
          'POST /cya/profile/from-template': 'cya.createFromTemplate',
          'POST /cya/compare-perspectives': 'cya.compareProfiles',
          'GET /cya/sessions/:session_id/export/pdf': 'cya.exportPdf',
          'GET /cya/sessions/:session_id/export/json': 'cya.exportJson',
          'GET /cya/graph/export/oeo': 'cya.export.oeo',
          'GET /cya/graph/export/oeo-stub': 'cya.export.oeo-stub',
          'GET /cya/graph/cache': 'cya.graph.cacheStatus',
          'DELETE /cya/graph/cache/:operatorId': 'cya.graph.invalidate',
          'POST /cya/generate': 'cya.generate',
          'POST /cya/refine': 'cya.refine',
          'GET /cya/sessions/:id/a2a-log': 'cya.session.a2aLog',
          'GET /cya/sessions/:id/a2a-analysis': 'cya.session.a2aAnalysis',
          'GET /cya/a2a-stats': 'cya.a2aStats',
          'GET /cya/sessions/:id/context-state': 'cya.session.contextState',

          // MaStR Monitor (v0.27)
          'POST /mastr-monitor/watches': 'mastr-monitor.createWatch',
          'GET /mastr-monitor/watches': 'mastr-monitor.listWatches',
          'GET /mastr-monitor/watches/:watchId': 'mastr-monitor.getWatch',
          'DELETE /mastr-monitor/watches/:watchId': 'mastr-monitor.deleteWatch',
          'POST /mastr-monitor/watches/:watchId/run': 'mastr-monitor.runWatch',
          'GET /mastr-monitor/watches/:watchId/deltas': 'mastr-monitor.getDeltas',
          'GET /mastr-monitor/watches/:watchId/deltas/:deltaId': 'mastr-monitor.getDelta',
          'GET /mastr-monitor/watches/:watchId/snapshot': 'mastr-monitor.getSnapshot',
          'POST /mastr-monitor/watches/:watchId/subscribe': 'mastr-monitor.subscribe',
          'DELETE /mastr-monitor/watches/:watchId/subscribe/:token': 'mastr-monitor.unsubscribe',
          'GET /mastr-monitor/confirm/:token': 'mastr-monitor.confirmSubscription',
          'POST /mastr-monitor/from-session': 'mastr-monitor.createFromSession',

          // EDM (v0.28)
          'POST /edm/melos': 'edm.createMelo',
          'GET /edm/melos': 'edm.listMelos',
          'GET /edm/melos/:meloId': 'edm.getMelo',
          'PUT /edm/melos/:meloId': 'edm.updateMelo',
          'DELETE /edm/melos/:meloId': 'edm.deleteMelo',
          'POST /edm/melos/from-mastr': 'edm.createFromMastr',
          'POST /edm/timeseries/import': 'edm.importTimeseries',
          'GET /edm/timeseries/:meloId/summary': 'edm.getTimeseriesSummary',
          'GET /edm/timeseries/:meloId': 'edm.getTimeseries',
          'DELETE /edm/timeseries/:meloId': 'edm.deleteTimeseries',

          // MSCONS Import (v0.28)
          'POST /mscons/parse': 'mscons-import.parse',
          'POST /mscons/import': 'mscons-import.import',
          'GET /mscons/imports': 'mscons-import.listImports',

          // EDM Messkonzept (v0.21)
          'POST /edm/messkonzepte/evaluate-all': 'edm-messkonzept.evaluate-all',
          'POST /edm/messkonzepte/:id/evaluate': 'edm-messkonzept.evaluate',
          'POST /edm/messkonzepte': 'edm-messkonzept.create',
          'GET /edm/messkonzepte': 'edm-messkonzept.list',
          'GET /edm/messkonzepte/:id': 'edm-messkonzept.get',
          'DELETE /edm/messkonzepte/:id': 'edm-messkonzept.delete',

          // EDM Validation (v0.28)
          'POST /edm/validate': 'edm-validation.validate',
          'GET /edm/validate/rules': 'edm-validation.listRules',
          'GET /edm/validate/:meloId/report': 'edm-validation.getReport',
          'POST /edm/validate/:meloId/fill-gaps': 'edm-validation.fillGaps',

          // EDM Virtual Auto-Population (v0.29)
          'POST /edm/virtual/populate-slp': 'edm-virtual.populateBySlp',
          'POST /edm/virtual/auto-populate/day': 'edm-virtual.autoPopulateDay',

          // EDM Messkonzept (v0.28)
          'POST /edm/messkonzepte/evaluate-all': 'edm-messkonzept.evaluate-all',
          'POST /edm/messkonzepte/:id/evaluate': 'edm-messkonzept.evaluate',
          'POST /edm/messkonzepte': 'edm-messkonzept.create',
          'GET /edm/messkonzepte': 'edm-messkonzept.list',
          'GET /edm/messkonzepte/:id': 'edm-messkonzept.get',
          'DELETE /edm/messkonzepte/:id': 'edm-messkonzept.delete',

          // SLP (v0.28)
          'GET /slp/profiles': 'slp.listProfiles',
          'GET /slp/profiles/:profileId': 'slp.getProfile',
          'POST /slp/generate': 'slp.generateTimeseries',
          'POST /slp/profiles': 'slp.createCustomProfile',
          'DELETE /slp/profiles/:profileId': 'slp.deleteCustomProfile',

          // Settlement (v0.30)
          'POST /settlement/redispatch/calculate': 'settlement.calculateRedispatch',
          'GET /settlement/redispatch/report/:settlementId': 'settlement.getRedispatchReport',
          'POST /settlement/eeg/calculate': 'settlement.calculateEeg',
          'GET /settlement/eeg/report/:settlementId': 'settlement.getEegReport',
          'POST /settlement/a96/prepare': 'settlement.prepareA96',
          'POST /settlement/a96/reconcile': 'settlement.reconcileA96',
          'GET /settlement/a96/export/:settlementId': 'settlement.exportA96',
          'GET /settlement/eeg-tariff': 'settlement.lookupEegTariff',
          'GET /settlement': 'settlement.listSettlements',

          // Bilanzkreis (v0.30)
          'POST /bilanzkreis': 'bilanzkreis.create',
          'GET /bilanzkreis': 'bilanzkreis.list',
          'GET /bilanzkreis/:id/readiness': 'bilanzkreis.checkReadiness',
          'GET /bilanzkreis/:id': 'bilanzkreis.get',
          'DELETE /bilanzkreis/:id': 'bilanzkreis.delete',
          'POST /bilanzkreis/:id/calculate': 'bilanzkreis.calculate',

          // Forecast Engine (v0.30.1)
          'POST /forecast/load': 'forecast-engine.forecastLoad',
          'POST /forecast/generation': 'forecast-engine.forecastGeneration',
          'POST /forecast/residual': 'forecast-engine.forecastResidual',
          'POST /forecast/schedule/day-ahead': 'forecast-engine.createSchedule',
          'GET /forecast/schedules': 'forecast-engine.listSchedules',
          'POST /forecast/storage-dispatch': 'forecast-engine.storageDispatch',
          'GET /forecast/schedule/:scheduleId': 'forecast-engine.getSchedule',
          'POST /forecast/quality': 'forecast-engine.evaluateQuality',

          // Flex (§14a) (v0.31)
          'POST /flex/devices': 'flex.registerDevice',
          'GET /flex/devices': 'flex.listDevices',
          'GET /flex/devices/:deviceId': 'flex.getDevice',
          'PUT /flex/devices/:deviceId/status': 'flex.updateDeviceStatus',
          'POST /flex/events/plan': 'flex.planDimming',
          'POST /flex/events/execute': 'flex.executeDimming',
          'GET /flex/relief-proof/:period': 'flex.getReliefProof',
          'GET /flex/customer/:deviceId/reduction': 'flex.getTariffReduction',

          // File Ingest Monitor + Schema Registry (v0.62)
          'POST /file-ingest-schemas': 'file-ingest-monitor.createSchema',
          'GET /file-ingest-schemas': 'file-ingest-monitor.listSchemas',
          'GET /file-ingest-schemas/:schemaId': 'file-ingest-monitor.getSchema',
          'POST /file-ingest-monitors': 'file-ingest-monitor.createMonitor',
          'GET /file-ingest-monitors': 'file-ingest-monitor.listMonitors',
          'GET /file-ingest-monitors/:id': 'file-ingest-monitor.getMonitor',
          'DELETE /file-ingest-monitors/:id': 'file-ingest-monitor.deleteMonitor',
          'POST /file-ingest-monitors/:id/scan': 'file-ingest-monitor.scan',
          'GET /file-ingest-monitors/:id/status': 'file-ingest-monitor.getStatus',
          'GET /file-ingest-monitors/:id/files': 'file-ingest-monitor.getFiles',
          'GET /file-ingest-monitors/:id/findings': 'file-ingest-monitor.getFindings',

          // Redispatch Asset Register (v0.62)
          'POST /redispatch-asset-register/projections':
            'redispatch-asset-register.createProjection',
          'GET /redispatch-asset-register/projections': 'redispatch-asset-register.listProjections',
          'GET /redispatch-asset-register/projections/:id':
            'redispatch-asset-register.getProjection',
          'POST /redispatch-asset-register/relationships':
            'redispatch-asset-register.createRelationship',
          'GET /redispatch-asset-register/relationships':
            'redispatch-asset-register.listRelationships',
          'GET /redispatch-asset-register/relationships/:id':
            'redispatch-asset-register.getRelationship',
          'DELETE /redispatch-asset-register/relationships/:id':
            'redispatch-asset-register.deleteRelationship',

          // Redispatch Data Governance (v0.62)
          'POST /redispatch-data-governance/policies': 'redispatch-data-governance.createPolicy',
          'GET /redispatch-data-governance/policies': 'redispatch-data-governance.listPolicies',
          'GET /redispatch-data-governance/policies/:id': 'redispatch-data-governance.getPolicy',
          'PUT /redispatch-data-governance/policies/:id': 'redispatch-data-governance.updatePolicy',
          'DELETE /redispatch-data-governance/policies/:id':
            'redispatch-data-governance.deletePolicy',
          'POST /redispatch-data-governance/evaluate': 'redispatch-data-governance.evaluate',
          'GET /redispatch-data-governance/evaluations':
            'redispatch-data-governance.listEvaluations',

          // Redispatch Readiness Gate (v0.63)
          'POST /redispatch-readiness-gate/evaluate': 'redispatch-readiness-gate.evaluate',
          'GET /redispatch-readiness-gate/runs': 'redispatch-readiness-gate.listRuns',
          'GET /redispatch-readiness-gate/runs/:id': 'redispatch-readiness-gate.getRun',
          'GET /redispatch-readiness-gate/status': 'redispatch-readiness-gate.getStatus',

          // Battery Redispatch Special Gate (v0.63)
          'POST /battery-redispatch-special-gate/evaluate':
            'battery-redispatch-special-gate.evaluate',
          'GET /battery-redispatch-special-gate/gates':
            'battery-redispatch-special-gate.listGates',
          'GET /battery-redispatch-special-gate/gates/:gateId':
            'battery-redispatch-special-gate.getGate',
          'GET /battery-redispatch-special-gate/:gateId/status':
            'battery-redispatch-special-gate.getStatus',

          // Flexibility Conductor Role Model (v0.63)
          'POST /flexibility-conductor-role-model/evaluate':
            'flexibility-conductor-role-model.evaluate',
          'GET /flexibility-conductor-role-model/models':
            'flexibility-conductor-role-model.listModels',
          'GET /flexibility-conductor-role-model/models/:roleModelId':
            'flexibility-conductor-role-model.getModel',
          'GET /flexibility-conductor-role-model/:processId/status':
            'flexibility-conductor-role-model.getStatus',

          // Knowledge Continuity Governance Gate (v0.63)
          'POST /knowledge-continuity-governance-gate/evaluate':
            'knowledge-continuity-governance-gate.evaluate',
          'GET /knowledge-continuity-governance-gate/gates':
            'knowledge-continuity-governance-gate.listGates',
          'GET /knowledge-continuity-governance-gate/gates/:governanceGateId':
            'knowledge-continuity-governance-gate.getGate',
          'GET /knowledge-continuity-governance-gate/status':
            'knowledge-continuity-governance-gate.getStatus',
          'GET /knowledge-continuity-governance-gate/:processId/status':
            'knowledge-continuity-governance-gate.getStatus',

          // Investment Maturity Off-Balance Gate (v0.63)
          'POST /investment-maturity-off-balance-gate/evaluate':
            'investment-maturity-off-balance-gate.evaluate',
          'GET /investment-maturity-off-balance-gate/gates':
            'investment-maturity-off-balance-gate.listGates',
          'GET /investment-maturity-off-balance-gate/gates/:gateId':
            'investment-maturity-off-balance-gate.getGate',
          'GET /investment-maturity-off-balance-gate/status':
            'investment-maturity-off-balance-gate.getStatus',

          // Gas Capacity Order Revision Gate (v0.63)
          'POST /gas-capacity-order-revision-gate/evaluate':
            'gas-capacity-order-revision-gate.evaluate',
          'GET /gas-capacity-order-revision-gate/revisions':
            'gas-capacity-order-revision-gate.listRevisions',
          'GET /gas-capacity-order-revision-gate/revisions/:revisionId':
            'gas-capacity-order-revision-gate.getRevision',
          'GET /gas-capacity-order-revision-gate/status':
            'gas-capacity-order-revision-gate.getStatus',

          // Redispatch Settlement Sandbox (v0.62)
          'POST /redispatch-settlement-sandbox/scenarios':
            'redispatch-settlement-sandbox.createScenario',
          'GET /redispatch-settlement-sandbox/scenarios':
            'redispatch-settlement-sandbox.listScenarios',
          'GET /redispatch-settlement-sandbox/scenarios/:id':
            'redispatch-settlement-sandbox.getScenario',
          'POST /redispatch-settlement-sandbox/scenarios/:id/reconcile':
            'redispatch-settlement-sandbox.reconcile',
          'GET /redispatch-settlement-sandbox/scenarios/:id/download':
            'redispatch-settlement-sandbox.downloadScenario',

          // Redispatch Special Case Gate (v0.62)
          'POST /redispatch-special-case-gate/evaluate': 'redispatch-special-case-gate.evaluate',
          'GET /redispatch-special-case-gate/runs': 'redispatch-special-case-gate.listRuns',
          'GET /redispatch-special-case-gate/runs/:id': 'redispatch-special-case-gate.getRun',

          // Local upload folder for datasource file connectors (csv/xlsx/docx/...)
          'GET /datasources/uploads'(req, res) {
            try {
              ensureUploadDir();
              const files = fs
                .readdirSync(UPLOAD_DIR)
                .filter((entry) => fs.statSync(path.join(UPLOAD_DIR, entry)).isFile())
                .sort((a, b) => a.localeCompare(b))
                .map((fileName) => buildUploadResponseEntry(fileName));

              res.setHeader(CONTENT_TYPE_HEADER, CONTENT_TYPE_JSON);
              res.end(
                JSON.stringify({
                  success: true,
                  count: files.length,
                  uploadDir: UPLOAD_DIR,
                  data: files,
                })
              );
            } catch (err) {
              res.writeHead(500, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
              res.end(
                JSON.stringify({
                  success: false,
                  message: sanitizeErrorMessage(err.message),
                })
              );
            }
          },

          'POST /datasources/uploads'(req, res) {
            try {
              ensureUploadDir();

              const params = req?.$params || req?.body || {};
              const rawFileName = params.fileName;
              const contentBase64 = params.contentBase64;

              if (!rawFileName || typeof rawFileName !== 'string') {
                res.writeHead(400, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
                res.end(JSON.stringify({ success: false, message: 'fileName is required.' }));
                return;
              }

              if (!contentBase64 || typeof contentBase64 !== 'string') {
                res.writeHead(400, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
                res.end(JSON.stringify({ success: false, message: 'contentBase64 is required.' }));
                return;
              }

              const safeName = sanitizeUploadFilename(rawFileName);
              if (!safeName) {
                res.writeHead(400, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
                res.end(JSON.stringify({ success: false, message: 'Invalid fileName.' }));
                return;
              }

              const ext = path.extname(safeName).toLowerCase();
              if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
                res.writeHead(400, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
                res.end(
                  JSON.stringify({
                    success: false,
                    message: `Unsupported file extension: ${ext || '(none)'}.`,
                  })
                );
                return;
              }

              const payload = contentBase64.includes(',')
                ? contentBase64.split(',').pop()
                : contentBase64;

              const buffer = Buffer.from(payload, 'base64');
              if (!buffer || buffer.length === 0) {
                res.writeHead(400, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
                res.end(JSON.stringify({ success: false, message: 'Uploaded payload is empty.' }));
                return;
              }

              const finalFileName = fs.existsSync(path.join(UPLOAD_DIR, safeName))
                ? `${path.basename(safeName, ext)}_${Date.now()}${ext}`
                : safeName;

              const finalPath = path.join(UPLOAD_DIR, finalFileName);
              fs.writeFileSync(finalPath, buffer);

              res.setHeader(CONTENT_TYPE_HEADER, CONTENT_TYPE_JSON);
              res.end(
                JSON.stringify({
                  success: true,
                  data: buildUploadResponseEntry(finalFileName),
                })
              );
            } catch (err) {
              res.writeHead(500, { CONTENT_TYPE_HEADER: CONTENT_TYPE_JSON });
              res.end(
                JSON.stringify({
                  success: false,
                  message: sanitizeErrorMessage(err.message),
                })
              );
            }
          },
        },

        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '25MB',
          },
          urlencoded: {
            extended: true,
            limit: '25MB',
          },
        },

        busboyConfig: {
          limits: {
            files: PERSONAL_AGENT_MAX_FILES,
            fileSize: PERSONAL_AGENT_MAX_FILE_SIZE_BYTES,
            fields: PERSONAL_AGENT_MAX_FIELDS,
          },
        },

        mappingPolicy: 'all',

        logging: true,

        async onBeforeCall(ctx, route, req, _res) {
          // Mark this context as originating from the REST API gateway.
          // Used by job-aware action handlers to distinguish REST calls
          // (which get async job responses) from internal Moleculer calls
          // (which get synchronous results for backward-compatibility).
          ctx.meta.$gateway = true;
          ctx.meta.requestHeaders = req?.headers || {};

          // Map external agent-role headers for VDMI guardrail checks
          ctx.meta.agentRole =
            req?.headers?.['x-agent-role'] || req?.headers?.['X-Agent-Role'] || null;
          ctx.meta.agentId = req?.headers?.['x-agent-id'] || req?.headers?.['X-Agent-Id'] || null;

          // Token precedence:
          // 1) Request parameter "token" (query/body/path)
          // 2) Authorization: Bearer <token>
          // 3) CERNION_TOKEN from environment (fallback in MCP client)
          const method = String(req?.method || '').toUpperCase();
          const requestPath = normalizeRequestPath(req);
          const isTokenVerifyEndpoint = requestPath === '/api/tokens/verify' && method === 'POST';
          const isAuthTokenEndpoint =
            method === 'POST' &&
            (requestPath === '/api/auth/verify' ||
              requestPath === '/api/auth/refresh' ||
              requestPath === '/api/auth/logout');
          const preserveAuthToken = isTokenVerifyEndpoint || isAuthTokenEndpoint;
          const preserveBusinessToken = isBusinessTokenPath(req?.method, requestPath);

          const authHeader = req.headers['authorization'] || req.headers['Authorization'];
          const bearerToken =
            authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

          const paramTokenCandidates = [
            preserveAuthToken ? undefined : req?.$params?.token,
            preserveAuthToken ? undefined : req?.query?.token,
            preserveAuthToken ? undefined : req?.body?.token,
            preserveAuthToken || preserveBusinessToken ? undefined : req?.params?.token,
          ];

          const paramToken = paramTokenCandidates.find(
            (value) => typeof value === 'string' && value.trim().length > 0
          );

          const tokenToUse = (paramToken || bearerToken || '').trim();
          const tokenManagementAuthRequired = requiresTokenManagementAuth(method, requestPath);

          // Remove token from incoming params so actions don't need to declare it explicitly.
          // For POST /tokens/verify the token IS the action parameter — do not strip it.
          if (
            !preserveAuthToken &&
            !preserveBusinessToken &&
            req?.$params &&
            Object.prototype.hasOwnProperty.call(req.$params, 'token')
          ) {
            delete req.$params.token;
          }
          if (
            !preserveAuthToken &&
            !preserveBusinessToken &&
            req?.query &&
            Object.prototype.hasOwnProperty.call(req.query, 'token')
          ) {
            delete req.query.token;
          }
          if (
            !preserveAuthToken &&
            !preserveBusinessToken &&
            req?.body &&
            Object.prototype.hasOwnProperty.call(req.body, 'token')
          ) {
            delete req.body.token;
          }
          if (
            !preserveAuthToken &&
            !preserveBusinessToken &&
            req?.params &&
            Object.prototype.hasOwnProperty.call(req.params, 'token')
          ) {
            delete req.params.token;
          }

          if (tokenToUse) {
            const isApiToken = tokenToUse.startsWith('ck_');
            const isSessionToken = tokenToUse.startsWith('csess_');

            if (tokenManagementAuthRequired && !isApiToken && !isSessionToken) {
              throw new Errors.MoleculerClientError(
                'Valid API or session token required for token management endpoints.',
                401,
                'AUTH_REQUIRED'
              );
            }

            if (isApiToken) {
              const verification = await this.broker.call('token-manager.verify', {
                token: tokenToUse,
                method: req?.method || 'GET',
                path: requestPath,
                trackUsage: true,
              });

              if (!verification?.valid) {
                if (verification?.reason === 'SCOPE_VIOLATION') {
                  throw new Errors.MoleculerClientError(
                    'Scope violation: read-only token cannot call this endpoint.',
                    403,
                    'TOKEN_SCOPE_VIOLATION'
                  );
                }
                throw new Errors.MoleculerClientError(
                  'Invalid or revoked API token.',
                  401,
                  'INVALID_API_TOKEN'
                );
              }

              if (
                verification.scope === 'read-only' &&
                !isReadMethod(req?.method) &&
                !isReadOnlySidecarInvocation(req?.method, requestPath)
              ) {
                throw new Errors.MoleculerClientError(
                  'Scope violation: read-only token cannot call write endpoints.',
                  403,
                  'TOKEN_SCOPE_VIOLATION'
                );
              }

              if (
                requiresFullAccess(req?.method, requestPath) &&
                verification.scope !== 'full-access'
              ) {
                throw new Errors.MoleculerClientError(
                  'Scope violation: full-access token required for this endpoint.',
                  403,
                  'TOKEN_SCOPE_VIOLATION'
                );
              }

              const roles = mapRolesFromLegacyToken(verification.scope, verification.scopes);
              enforceRbacForPath(roles, req?.method, requestPath);
              addLegacyTokenDeprecationHeaders(ctx);

              ctx.meta.apiToken = {
                id: verification.tokenId,
                name: verification.name,
                scope: verification.scope,
                scopes: verification.scopes || [],
                tenantId: verification.tenantId || null,
                userId: verification.userId || null,
                legacy: Boolean(verification.legacy),
              };
              ctx.meta.authUser = {
                authType: 'legacy-token',
                userId: verification.userId || verification.tokenId || null,
                tenantId: verification.tenantId || null,
                groups: [],
                idpClaims: null,
                roles,
              };
              if (verification.tenantId) {
                ctx.meta.tenantId = verification.tenantId;
              }
              this.logger.debug('Using scoped API token from request');
            } else if (isSessionToken) {
              const verification = await this.broker.call('auth.verify', {
                token: tokenToUse,
                trackUsage: true,
              });

              if (!verification?.valid) {
                throw new Errors.MoleculerClientError(
                  'Invalid or expired session token.',
                  401,
                  'INVALID_SESSION_TOKEN'
                );
              }

              const roles = Array.isArray(verification.roles) ? verification.roles : [];
              enforceRbacForPath(roles, req?.method, requestPath);

              ctx.meta.authSession = {
                id: verification.sessionId,
                expiresAt: verification.expiresAt || null,
              };
              ctx.meta.authUser = {
                authType: 'session',
                userId: verification.userId || null,
                tenantId: verification.tenantId || null,
                groups: Array.isArray(verification.groups) ? verification.groups : [],
                idpClaims: verification.idpClaims || null,
                roles,
              };
              if (verification.tenantId) {
                ctx.meta.tenantId = verification.tenantId;
              }
              this.logger.debug('Using session token from request');
            } else {
              ctx.meta.cernionToken = tokenToUse;
              if (paramToken) {
                this.logger.debug('Using token parameter from request (query/body/path)');
              } else {
                this.logger.debug('Using Bearer token from request header');
              }
            }
          } else {
            if (tokenManagementAuthRequired) {
              throw new Errors.MoleculerClientError(
                'Authentication required for token management endpoints.',
                401,
                'AUTH_REQUIRED'
              );
            }
            this.logger.debug('No request token provided, will use CERNION_TOKEN from environment');
          }

          // ── Fallback tenant resolution for token-less or unscoped requests ──
          if (!ctx.meta.tenantId) {
            const headerTenantId =
              req?.headers?.['x-tenant-id'] || req?.headers?.['X-Tenant-Id'] || null;
            const queryTenantId =
              typeof req?.query?.tenantId === 'string' ? req.query.tenantId.trim() : null;
            const fallbackTenantId = headerTenantId || queryTenantId || null;

            if (fallbackTenantId) {
              try {
                validateTenantId(fallbackTenantId);
                if (!isTenantAllowed(fallbackTenantId)) {
                  throw new Errors.MoleculerClientError(
                    `Tenant '${fallbackTenantId}' is not allowed in this installation. ` +
                      `Allowed tenants are controlled by CERNION_ALLOWED_TENANTS.`,
                    403,
                    'TENANT_NOT_ALLOWED'
                  );
                }
                ctx.meta.tenantId = fallbackTenantId;
                this.logger.debug(`Resolved tenantId from header/query: ${fallbackTenantId}`);
              } catch (validationErr) {
                if (validationErr.code === 'TENANT_NOT_ALLOWED') {
                  throw validationErr;
                }
                this.logger.warn(
                  `Invalid tenantId in header/query ignored: ${fallbackTenantId} — ${validationErr.message}`
                );
              }
            }
          }

          const isAgentPersonaRoute =
            requestPath === '/api/agent-personas' || requestPath.startsWith('/api/agent-personas/');

          if (isAgentPersonaRoute && ctx.meta.tenantId) {
            if (!req.$params || typeof req.$params !== 'object') {
              req.$params = {};
            }

            req.$params.tenantId = ctx.meta.tenantId;

            if (ctx.params && typeof ctx.params === 'object') {
              ctx.params.tenantId = ctx.meta.tenantId;
            }
          }

          const isPersonalAgentChatMultipart =
            method === 'POST' &&
            requestPath === '/api/personal-agent/chat' &&
            Boolean(req?.$multipart);

          if (isPersonalAgentChatMultipart) {
            const fields = req?.$params || {};
            const rawFiles = fields.fileAttachments || fields.files || [];
            const files = toFileArray(rawFiles);

            if (files.length > PERSONAL_AGENT_MAX_FILES) {
              throw new Errors.MoleculerClientError(
                `Too many files. Maximum is ${PERSONAL_AGENT_MAX_FILES}.`,
                413,
                'FILE_TOO_LARGE'
              );
            }

            const tenantId = ctx.meta.tenantId || 'default';
            const sessionId = String(fields.sessionId || `pa_${crypto.randomUUID()}`);
            let totalSizeBytes = 0;

            const processedFiles = files.map((file, index) => {
              const sourcePath = String(file?.path || file?.tempFilePath || '').trim();
              const originalName = String(
                file?.originalname || file?.name || file?.filename || `upload_${index + 1}`
              );
              const ext = path.extname(originalName).toLowerCase();

              if (!PERSONAL_AGENT_ALLOWED_EXTENSIONS.has(ext)) {
                throw new Errors.MoleculerClientError(
                  'Das Dateiformat wird nicht unterstützt. Erlaubt: CSV, Excel, PNG, JPG, PDF.',
                  400,
                  'INVALID_FILE_TYPE'
                );
              }

              const statSize =
                sourcePath && fs.existsSync(sourcePath) ? fs.statSync(sourcePath).size : 0;
              const sizeBytes = Math.max(Number(file?.size || 0), Number(statSize || 0));
              if (sizeBytes > PERSONAL_AGENT_MAX_FILE_SIZE_BYTES) {
                throw new Errors.MoleculerClientError(
                  `File exceeds maximum size of ${PERSONAL_AGENT_MAX_FILE_SIZE_BYTES} bytes.`,
                  413,
                  'FILE_TOO_LARGE'
                );
              }

              totalSizeBytes += sizeBytes;
              const attachmentId = `fa_${crypto.randomUUID().slice(0, 8)}`;
              const targetPath = buildPersonalAgentUploadPath(
                tenantId,
                sessionId,
                attachmentId,
                ext
              );

              fs.mkdirSync(path.dirname(targetPath), { recursive: true });
              if (sourcePath && fs.existsSync(sourcePath) && sourcePath !== targetPath) {
                moveFileWithCrossDeviceFallback(sourcePath, targetPath);
              }

              return {
                attachmentId,
                fileName: sanitizeUploadFilename(originalName) || `upload_${index + 1}${ext}`,
                mimeType: String(file?.mimetype || file?.type || 'application/octet-stream'),
                sizeBytes,
                tempPath: targetPath,
              };
            });

            if (totalSizeBytes > PERSONAL_AGENT_MAX_TOTAL_SIZE_BYTES) {
              throw new Errors.MoleculerClientError(
                `Total upload size exceeds maximum of ${PERSONAL_AGENT_MAX_TOTAL_SIZE_BYTES} bytes.`,
                413,
                'FILE_TOO_LARGE'
              );
            }

            ctx.params = {
              message: String(fields.message || ''),
              sessionId,
              executionMode: String(fields.executionMode || 'auto'),
              chatMode: String(fields.chatMode || '').trim() || undefined,
              forceReceipt: String(fields.forceReceipt || '').trim() || undefined,
              preferredReceipts: parseOptionalJsonStringArray(fields.preferredReceipts, []),
              allowDraftReceipts: parseOptionalBoolean(fields.allowDraftReceipts, false),
              explainReceiptSelection: parseOptionalBoolean(fields.explainReceiptSelection, false),
              disableReceiptSelection: parseOptionalBoolean(fields.disableReceiptSelection, false),
              knownContext: parseOptionalJsonObject(fields.knownContext, {}),
              toolContext: parseOptionalJsonObject(fields.toolContext, {}),
              fileAttachments: processedFiles,
            };
          }

          const tenantIdForQuota = ctx.meta.tenantId || 'default';
          const endpointClass = classifyEndpointClass(method, requestPath);
          const rateLimit = rateQuotaStore.acquireRateLimitToken({
            tenantId: tenantIdForQuota,
            endpointClass,
          });
          ctx.meta.$responseHeaders = {
            ...(ctx.meta.$responseHeaders || {}),
            ...rateLimit.responseHeaders,
          };
          await emitRateQuotaEvents(this.broker, tenantIdForQuota, rateLimit.newEvents || [], {
            endpointClass,
            requestPath,
          });
          if (!rateLimit.allowed) {
            throw new Errors.MoleculerClientError(
              'Rate limit exceeded for tenant.',
              429,
              'RATE_LIMIT_EXCEEDED',
              {
                tenantId: tenantIdForQuota,
                endpointClass,
                retryAfter: rateLimit.retryAfter,
                responseHeaders: rateLimit.responseHeaders,
              }
            );
          }

          const httpSpan = tracing.startSpan(
            `http ${String(req?.method || 'GET').toUpperCase()} ${requestPath}`,
            {
              attributes: {
                'http.method': String(req?.method || 'GET').toUpperCase(),
                'http.route': requestPath,
              },
              parentCarrier: ctx.meta.__otel,
              kind: tracing.SpanKind.SERVER,
            }
          );
          ctx.meta.$httpSpan = httpSpan;
          tracing.ensureCorrelationId(ctx.meta);
          mergeObservabilityContext({
            requestOrigin: 'gateway',
            requestPath,
            tenantId: ctx.meta.tenantId || null,
            authType: ctx.meta.authUser?.authType || null,
            broker: this.broker,
          });
          tracing.attachSpanToMeta(ctx.meta, httpSpan);
        },

        onAfterCall(ctx, _route, _req, _res, data) {
          if (ctx?.meta?.$httpSpan) {
            tracing.setOk(ctx.meta.$httpSpan);
            ctx.meta.$httpSpan.end();
            delete ctx.meta.$httpSpan;
          }
          return data;
        },

        onError(req, res, err) {
          if (req?.$ctx?.meta?.$httpSpan) {
            tracing.setError(req.$ctx.meta.$httpSpan, err);
            req.$ctx.meta.$httpSpan.end();
            delete req.$ctx.meta.$httpSpan;
          }
          const metaHeaders = req?.$ctx?.meta?.$responseHeaders || {};
          const errorHeaders = err?.data?.responseHeaders || {};
          const mergedHeaders = { ...metaHeaders, ...errorHeaders };
          for (const [headerName, headerValue] of Object.entries(mergedHeaders)) {
            if (headerValue != null) {
              res.setHeader(headerName, String(headerValue));
            }
          }
          res.setHeader(CONTENT_TYPE_HEADER, 'application/json');
          res.writeHead(resolveHttpStatus(err));
          res.end(
            JSON.stringify({
              success: false,
              message: sanitizeErrorMessage(err.message),
              code: err.code,
              type: err.type,
            })
          );
        },
      },
    ],

    log4XXResponses: false,
    logRequestParams: null,
    logResponseData: null,

    // Serve static files from swagger-ui-dist
    assets: {
      folder: path.dirname(require.resolve('swagger-ui-dist/package.json')),
      options: {},
    },
  },

  actions: {
    /**
     * Get OpenAPI specification
     */
    openapi: {
      rest: 'GET /openapi.json',
      async handler(ctx) {
        // Build OpenAPI schema from broker's service registry
        const paths = {};

        const categoryTagByService = {
          datapoint: 'Datapoints',
          'osm-geo': 'OSM Geo (OpenStreetMap)',
          oep: 'OEP (Open Energy Platform)',
          'knowledge-rag': 'Knowledge RAG',
          'finance-agent': 'Finance Agent',
          'personal-agent': 'Personal Agent',
          'agent-persona': 'Actor Personas',
          'mastr-quality': 'MaStR Data Quality',
          hitl: 'HITL',
          auth: 'Authentication',
          webhooks: 'Webhooks',
          'dashboard-api': 'Dashboard API',
          cookbook: 'Cookbook',
          'agent-receipts': 'Agent Receipts',
          cya: 'CYA Agent',
        };

        const normalizeApiPath = (routePath) => {
          const asString = String(routePath || '').trim();
          if (!asString) return '/api';

          const prefixed = asString.startsWith('/api')
            ? asString
            : asString.startsWith('/')
              ? `/api${asString}`
              : `/api/${asString}`;

          const compact = prefixed.replace(/\/+/g, '/');
          if (compact.length > 1 && compact.endsWith('/')) {
            return compact.slice(0, -1);
          }
          return compact;
        };

        const ensureTokenQueryParameter = (operation) => {
          if (!Array.isArray(operation.parameters)) {
            operation.parameters = [];
          }

          const hasTokenQueryParam = operation.parameters.some(
            (parameter) =>
              parameter?.$ref === '#/components/parameters/TokenQuery' ||
              (parameter?.name === 'token' && parameter?.in === 'query')
          );

          if (!hasTokenQueryParam) {
            operation.parameters.push({
              $ref: '#/components/parameters/TokenQuery',
            });
          }
        };

        const ensureRequestBodyToken = (operation, method) => {
          if (method === 'get') return;

          const tokenProperty = {
            token: {
              type: 'string',
              description:
                'Optional Cernion MCP token for this request. Overrides CERNION_TOKEN when provided.',
            },
          };

          const currentRequestBody = operation.requestBody;

          if (!currentRequestBody) {
            operation.requestBody = {
              required: false,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: tokenProperty,
                  },
                },
              },
            };
            return;
          }

          const jsonContent = currentRequestBody.content?.['application/json'];
          const existingSchema = jsonContent?.schema;

          if (!existingSchema) return;

          if (existingSchema.$ref) {
            jsonContent.schema = {
              allOf: [
                { $ref: existingSchema.$ref },
                {
                  type: 'object',
                  properties: tokenProperty,
                },
              ],
            };
            return;
          }

          if (!existingSchema.type) {
            existingSchema.type = 'object';
          }
          if (!existingSchema.properties) {
            existingSchema.properties = {};
          }
          if (!existingSchema.properties.token) {
            existingSchema.properties.token = tokenProperty.token;
          }
        };

        const addParamsFallback = (operation, action, method) => {
          if (!action?.params || action?.openapi?.requestBody || action?.openapi?.parameters) {
            return;
          }

          const schema = {
            type: 'object',
            properties: {},
            required: [],
          };

          for (const paramName in action.params) {
            const param = action.params[paramName];
            let paramType = 'string';

            if (typeof param === 'string') {
              paramType = param;
            } else if (param.type) {
              paramType = param.type;
            }

            schema.properties[paramName] = {
              type:
                paramType === 'number' ? 'number' : paramType === 'boolean' ? 'boolean' : 'string',
            };

            if (
              param.optional === false ||
              (typeof param === 'string' && !param.includes('optional'))
            ) {
              schema.required.push(paramName);
            }
          }

          if (method === 'get') {
            for (const paramName in schema.properties) {
              operation.parameters.push({
                name: paramName,
                in: 'query',
                required: schema.required.includes(paramName),
                schema: schema.properties[paramName],
              });
            }
          } else {
            operation.requestBody = {
              required: true,
              content: {
                'application/json': {
                  schema: schema,
                },
              },
            };
          }
        };

        const upsertOperation = (fullPath, method, actionName, action, serviceName) => {
          if (!paths[fullPath]) {
            paths[fullPath] = {};
          }

          if (!paths[fullPath][method]) {
            paths[fullPath][method] = {
              summary: action?.description || actionName,
              tags: action?.openapi?.tags || [serviceName || actionName.split('.')[0]],
              operationId:
                action?.openapi?.operationId || actionName.replace(/\./g, '_').replace(/-/g, '_'),
              parameters: [
                {
                  $ref: '#/components/parameters/TokenQuery',
                },
              ],
              responses: {
                200: {
                  description: 'Successful response',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                      },
                    },
                  },
                },
              },
            };
          }

          const operation = paths[fullPath][method];

          if (action?.openapi) {
            if (action.openapi.summary) operation.summary = action.openapi.summary;
            if (action.openapi.description) operation.description = action.openapi.description;
            if (action.openapi.tags) operation.tags = action.openapi.tags;
            if (action.openapi.operationId) operation.operationId = action.openapi.operationId;

            if (action.openapi.requestBody) {
              operation.requestBody = action.openapi.requestBody;
            }
            if (action.openapi.responses) {
              operation.responses = action.openapi.responses;
            }
            if (action.openapi.parameters) {
              operation.parameters = action.openapi.parameters;
            }
          }

          // Canonicalize tag names so Swagger groups operations under the
          // configured OpenAPI category tags (not raw internal service names).
          if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
            operation.tags = [categoryTagByService[serviceName] || serviceName];
          } else {
            operation.tags = operation.tags.map(
              (tag) => categoryTagByService[String(tag)] || String(tag)
            );
          }

          ensureTokenQueryParameter(operation);
          addParamsFallback(operation, action, method);
          ensureRequestBodyToken(operation, method);
        };

        // Get all registered services
        const services = ctx.broker.registry.getServiceList({ withActions: true });
        const actionRegistry = new Map();

        const registerActionVariants = (serviceName, actionName, actionDef) => {
          if (!serviceName || !actionName || !actionDef) return;

          actionRegistry.set(actionName, actionDef);

          const localActionName = String(actionName).split('.').pop();
          actionRegistry.set(`${serviceName}.${localActionName}`, actionDef);
        };

        // Prefer local service schema actions because they preserve full OpenAPI
        // metadata (tags, descriptions, request/response contracts).
        for (const localService of this.broker.services || []) {
          if (!localService?.name || String(localService.name).startsWith('$')) continue;

          const schemaActions = localService.schema?.actions || {};
          for (const [actionName, actionDef] of Object.entries(schemaActions)) {
            registerActionVariants(localService.name, actionName, actionDef);
          }
        }

        for (const service of services) {
          if (service.name?.startsWith('$')) continue;
          for (const actionName in service.actions || {}) {
            const action = service.actions[actionName];
            registerActionVariants(service.name, actionName, action);
          }
        }

        // Iterate through services and their actions
        for (const service of services) {
          if (service.name.startsWith('$')) continue; // Skip internal services

          if (service.actions) {
            for (const actionName in service.actions) {
              const registryAction = service.actions[actionName];
              const actionRef = `${service.name}.${String(actionName).split('.').pop()}`;
              const action =
                actionRegistry.get(actionRef) || actionRegistry.get(actionName) || registryAction;

              // Check if action has REST configuration
              if (registryAction.rest || action.rest) {
                let method = 'POST';
                let path = `/${service.name}/${actionName.split('.').pop()}`;
                const restConfig = registryAction.rest || action.rest;

                if (typeof restConfig === 'string') {
                  const parts = restConfig.split(' ');
                  if (parts.length === 2) {
                    method = parts[0];
                    path = parts[1];
                  } else {
                    path = restConfig;
                  }
                } else if (typeof restConfig === 'object') {
                  method = restConfig.method || method;
                  path = restConfig.path || path;
                }

                method = method.toLowerCase();

                const isAbsolutePublicPath =
                  path.startsWith('/datasources') ||
                  path.startsWith('/datasource-cache') ||
                  path.startsWith('/datasource-discovery') ||
                  path.startsWith('/tokens') ||
                  path.startsWith('/nbp-monitor') ||
                  path.startsWith('/vnb-monitor') ||
                  path.startsWith('/jobs');

                // Prepend service name if path doesn't start with it and is not an absolute public path
                if (!path.startsWith(`/${service.name}`) && !isAbsolutePublicPath) {
                  path = `/${service.name}${path}`;
                }

                const fullPath = normalizeApiPath(path);
                upsertOperation(fullPath, method, actionRef, action, service.name);
              }
            }
          }
        }

        // Ensure every explicitly exposed API alias is also documented, even when
        // a target service action does not declare `rest` metadata in the registry.
        const apiRoute = (this.settings.routes || []).find((route) => route?.path === '/api');
        const aliases = apiRoute?.aliases || {};

        for (const [aliasKey, aliasTarget] of Object.entries(aliases)) {
          if (typeof aliasTarget !== 'string') continue;

          const [methodRaw, ...routeParts] = String(aliasKey).split(' ');
          if (!methodRaw || routeParts.length === 0) continue;

          const method = String(methodRaw).toLowerCase();
          const routePath = routeParts.join(' ').trim();
          const fullPath = normalizeApiPath(routePath);

          const action = actionRegistry.get(aliasTarget);
          const serviceName = String(aliasTarget).split('.')[0] || 'api';
          upsertOperation(fullPath, method, aliasTarget, action, serviceName);
        }

        // Build the OpenAPI schema
        const serverUrl = process.env.API_URL || `http://localhost:${this.settings.port}`;
        return {
          openapi: '3.0.0',
          info: this.settings.openapi.info,
          servers: [
            {
              url: serverUrl,
              description: 'API Server',
            },
          ],
          paths: paths,
          components: this.settings.openapi.components || {},
          tags: this.settings.openapi.tags || [],
        };
      },
    },

    /**
     * Get the curated MS365 Copilot OpenAPI subset.
     */
    openapiCopilot: {
      rest: 'GET /openapi-copilot.json',
      handler() {
        try {
          return JSON.parse(fs.readFileSync(COPILOT_OPENAPI_PATH, 'utf-8'));
        } catch (_err) {
          throw new Errors.MoleculerError(
            'openapi-copilot.json not found. Run npm run export:openapi:copilot before deployment.',
            404,
            'COPILOT_OPENAPI_NOT_FOUND',
            { path: COPILOT_OPENAPI_PATH }
          );
        }
      },
    },
  },

  methods: {
    /**
     * Authenticate the request
     */
    async authenticate(_ctx, _route, _req) {
      // Implement authentication logic here
      return null;
    },

    /**
     * Authorize the request
     */
    async authorize(ctx, _route, _req) {
      // Implement authorization logic here
      return ctx;
    },
  },

  created() {
    this.logger.info('API Gateway created');
  },

  async started() {
    this.logger.info(`API Gateway started on port ${this.settings.port}`);
    this.logger.info(`API endpoint: http://localhost:${this.settings.port}/api`);
    this.logger.info(`OpenAPI docs: http://localhost:${this.settings.port}/api/openapi.json`);
    this.logger.info(
      `Copilot OpenAPI docs: http://localhost:${this.settings.port}/api/openapi-copilot.json`
    );
    this.logger.info(`Swagger UI: http://localhost:${this.settings.port}/api/docs`);
    this.logger.info(`🤖 Sample App: http://localhost:${this.settings.port}/app`);
  },

  async stopped() {
    this.logger.info('API Gateway stopped');
  },
};
