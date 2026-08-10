#!/usr/bin/env node
'use strict';

/**
 * scripts/export-openapi.js
 *
 * Generates a cleaned, UI-annotated OpenAPI export at openapi-export.json.
 *
 * Steps:
 * 1. Boots a headless Moleculer broker with only the API service (and its
 *    mixin dependencies) — no real upstream services needed.
 * 2. Extracts the generated OpenAPI spec from the api service's openapi
 *    settings plus hard-coded aliases.
 * 3. Injects `x-ui-page` annotations (maps endpoints to UI page IDs).
 * 4. Strips internal/dev routes (upload, system.*) from the export.
 * 5. Writes `openapi-export.json` to the project root.
 *
 * Usage:
 *   node scripts/export-openapi.js
 *   npm run export:openapi
 *
 * The generated file is intended for UI consumers (frontend) and API
 * portal documentation. It is NOT the live spec — for the live spec,
 * run the server and GET /api/openapi.json.
 *
 * x-ui-page mapping:
 *   /dashboard/*           → "dashboard"
 *   /vnb-monitor/*         → "vnb-monitor"
 *   /nbp-monitor/*         → "nbp-monitor"
 *   /mastr-quality/*       → "mastr-quality"
 *   /grid-connection/*     → "grid-connection"
 *   /energy-sharing/*      → "energy-sharing"
 *   /redispatch/*          → "redispatch"
 *   /datapoints/*          → "datapoints"
 *   /energy-market/*       → "energy-market"
 *   /gas-storage/*         → "gas-storage"
 *   /grid/*                → "grid"
 *   /tokens/*              → "auth"
 */

const fs = require('fs');
const path = require('path');

// ── Static OpenAPI source ─────────────────────────────────────────────────

// Rather than booting a full broker (which requires all 37 services to
// be loadable), we read the static openapi settings directly from the
// api.service.js source and merge with known route aliases.
// This keeps the script fast, dependency-free, and CI-safe.

const { version: packageVersion } = require('../package.json');

const SERVICES_DIR = path.join(__dirname, '..', 'services');

// ── Route → UI page mapping ──────────────────────────────────────────────

const UI_PAGE_MAP = [
  [/^\/dashboard\//, 'dashboard'],
  [/^\/vnb-monitor\//, 'vnb-monitor'],
  [/^\/nbp-monitor\//, 'nbp-monitor'],
  [/^\/mastr-quality\//, 'mastr-quality'],
  [/^\/grid-connection\//, 'grid-connection'],
  [/^\/energy-sharing\//, 'energy-sharing'],
  [/^\/energy-sharing-alloc/, 'energy-sharing-allocation'],
  [/^\/redispatch\//, 'redispatch'],
  [/^\/datapoints\//, 'datapoints'],
  [/^\/energy-market\//, 'energy-market'],
  [/^\/gas-storage\//, 'gas-storage'],
  [/^\/osm-geo\//, 'geo'],
  [/^\/grid\//, 'grid'],
  [/^\/tokens\//, 'auth'],
  [/^\/jobs\//, 'jobs'],
  [/^\/eic\//, 'eic'],
  [/^\/entsoe\//, 'entsoe'],
  [/^\/forecast\//, 'forecast'],
  [/^\/residual-load\//, 'residual-load'],
  [/^\/query\//, 'query'],
  [/^\/agent\//, 'agent'],
  [/^\/v1\/chat\/completions$/, 'agent'],
  [/^\/system\//, 'system'],
];

/**
 * Resolves the UI page ID for a given OpenAPI path.
 * @param {string} openapiPath  e.g. '/dashboard/vnb-overview'
 * @returns {string|null}
 */
function resolveUiPage(openapiPath) {
  for (const [pattern, page] of UI_PAGE_MAP) {
    if (pattern.test(openapiPath)) return page;
  }
  return null;
}

// ── Paths to exclude from the export ─────────────────────────────────────

const EXCLUDED_PATH_PATTERNS = [/^\/upload/, /^\/system\//];

function shouldExclude(openapiPath) {
  return EXCLUDED_PATH_PATTERNS.some((re) => re.test(openapiPath));
}

// ── Load OpenAPI spec from running server or static assembly ──────────────

/**
 * Attempts to fetch the live OpenAPI spec from a running server.
 * Falls back to static assembly from api.service.js metadata if unreachable.
 *
 * @returns {Promise<object>}  OpenAPI 3.0 spec object
 */
async function loadSpec() {
  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/api/openapi.json`;

  try {
    const { default: fetch } = await import('node-fetch').catch(() => {
      throw new Error('node-fetch not available');
    });
    const resp = await fetch(url, { timeout: 3000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const spec = await resp.json();
    console.log(`[export-openapi] Loaded live spec from ${url}`);
    return spec;
  } catch {
    console.log('[export-openapi] Server not reachable — assembling static spec');
    return buildStaticSpec();
  }
}

/**
 * Builds a minimal static spec by parsing the api.service.js metadata.
 * This avoids the need to boot the full Moleculer broker.
 *
 * NOTE: This static spec will be missing detailed schemas and parameter
 * definitions that are only generated at runtime by moleculer-auto-openapi.
 * For a complete spec, run the server and use --live flag.
 */
function normaliseApiPath(routePath) {
  if (routePath.startsWith('/v1/')) return routePath.replace(/\/+/g, '/');
  const prefixed = routePath.startsWith('/') ? `/api${routePath}` : `/api/${routePath}`;
  return prefixed.replace(/\/+/g, '/');
}

function loadActionRegistry() {
  const registry = new Map();
  const files = fs
    .readdirSync(SERVICES_DIR)
    .filter((name) => name.endsWith('.service.js'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const svc = require(path.join(SERVICES_DIR, file));
    if (!svc || !svc.name || !svc.actions || typeof svc.actions !== 'object') continue;

    for (const [actionName, actionDef] of Object.entries(svc.actions)) {
      registry.set(`${svc.name}.${actionName}`, actionDef);
    }
  }

  return registry;
}

function buildOperationFromAction(actionRef, actionDef) {
  const serviceName = actionRef.split('.')[0];
  const openapi = actionDef?.openapi || {};

  const operation = {
    operationId: openapi.operationId || actionRef.replace(/\./g, '_'),
    summary: openapi.summary || actionRef,
    tags: Array.isArray(openapi.tags) && openapi.tags.length > 0 ? openapi.tags : [serviceName],
    responses: openapi.responses || {
      200: {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
    },
  };

  if (openapi.description) operation.description = openapi.description;
  if (openapi.parameters) operation.parameters = openapi.parameters;
  if (openapi.requestBody) operation.requestBody = openapi.requestBody;

  // Copy all x-* extension fields (Copilot, OEO, etc.)
  for (const [key, val] of Object.entries(openapi)) {
    if (key.startsWith('x-')) operation[key] = val;
  }

  return operation;
}

// Function-valued aliases under the /v1 route (live gateway handlers in
// api.service.js) map 1:1 to the broker action that actually carries the
// `openapi` metadata this exporter reads.
const V1_FUNCTION_ALIAS_ACTIONS = {
  'POST /chat/completions': 'openai-compatible.chatCompletions',
  'POST /images/generations': 'openai-compatible.imageGenerations',
  'POST /embeddings': 'openai-compatible.embeddings',
};

function buildStaticPaths(apiSvc, actionRegistry) {
  const routes = apiSvc.settings?.routes || [];
  const paths = {};

  for (const route of routes) {
    if (!route || (route.path !== '/api' && route.path !== '/v1')) continue;
    const aliases = route.aliases || {};

    for (const [aliasKey, rawAliasTarget] of Object.entries(aliases)) {
      // Function-valued /v1 aliases (the live gateway handlers in
      // api.service.js) aren't action-registry strings; translate the known
      // ones to their underlying action so the static export still finds
      // their openapi metadata.
      const aliasTarget =
        route.path === '/v1' && V1_FUNCTION_ALIAS_ACTIONS[aliasKey]
          ? V1_FUNCTION_ALIAS_ACTIONS[aliasKey]
          : rawAliasTarget;
      if (typeof aliasTarget !== 'string') continue;

      const [methodRaw, ...restParts] = aliasKey.split(' ');
      if (!methodRaw || restParts.length === 0) continue;

      const method = methodRaw.toLowerCase();
      const routePath = restParts.join(' ').trim();
      const fullRoutePath =
        route.path === '/v1' && routePath.startsWith('/') ? `/v1${routePath}` : routePath;
      const openapiPath = normaliseApiPath(fullRoutePath);

      if (!paths[openapiPath]) paths[openapiPath] = {};

      const actionDef = actionRegistry.get(aliasTarget);
      paths[openapiPath][method] = buildOperationFromAction(aliasTarget, actionDef || {});
    }
  }

  return paths;
}

// Mirrors the live-server autoAliases logic from api.service.js so the static
// export also covers service actions that rely on Moleculer's autoAliases (no
// explicit alias entry in api.service.js routes).
const AUTO_ALIAS_ABSOLUTE_PREFIXES = [
  '/datasources',
  '/datasource-cache',
  '/datasource-discovery',
  '/tokens',
  '/nbp-monitor',
  '/vnb-monitor',
  '/jobs',
];

function buildAutoAliasedPaths() {
  const paths = {};
  const files = fs
    .readdirSync(SERVICES_DIR)
    .filter((name) => name.endsWith('.service.js'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    let svc;
    try {
      svc = require(path.join(SERVICES_DIR, file));
    } catch {
      continue;
    }
    if (!svc || !svc.name || !svc.actions || typeof svc.actions !== 'object') continue;

    for (const [actionName, actionDef] of Object.entries(svc.actions)) {
      if (!actionDef || !actionDef.rest) continue;

      let method = 'POST';
      let restPath = '';
      const restConfig = actionDef.rest;

      if (typeof restConfig === 'string') {
        const parts = restConfig.trim().split(' ');
        if (parts.length === 2) {
          method = parts[0];
          restPath = parts[1];
        } else {
          restPath = parts[0];
        }
      } else if (typeof restConfig === 'object') {
        method = restConfig.method || method;
        restPath = restConfig.path || '';
      }

      if (!restPath) continue;
      method = method.toLowerCase();

      const isAbsolutePublicPath = AUTO_ALIAS_ABSOLUTE_PREFIXES.some((p) => restPath.startsWith(p));
      let finalPath = restPath;
      if (!finalPath.startsWith(`/${svc.name}`) && !isAbsolutePublicPath) {
        finalPath = `/${svc.name}${finalPath}`;
      }

      const fullPath = normaliseApiPath(finalPath);
      if (!paths[fullPath]) paths[fullPath] = {};
      paths[fullPath][method] = buildOperationFromAction(`${svc.name}.${actionName}`, actionDef);
    }
  }

  return paths;
}

function buildStaticSpec() {
  const apiSvc = require('../services/api.service');
  const tags = apiSvc.settings?.openapi?.tags || [];
  const actionRegistry = loadActionRegistry();

  // Auto-aliased paths (service action rest declarations) provide the base;
  // explicit api.service.js aliases override where they overlap.
  const autoAliasedPaths = buildAutoAliasedPaths();
  const explicitPaths = buildStaticPaths(apiSvc, actionRegistry);
  const paths = { ...autoAliasedPaths, ...explicitPaths };

  return {
    openapi: '3.0.0',
    info: {
      title: 'Cernion Energy Tools API',
      version: packageVersion,
      description:
        'API-first grid-intelligence and agentic energy-operations services for Cernion.\n\n' +
        'CERNION_TOKEN: request at https://cernion.de/ or by email: dev@stromdao.com.\n\n' +
        'For the public instance at https://api.cernion.de/, create your token at https://cernion.de/cet-token/.',
    },
    servers: [
      {
        url: process.env.API_URL || 'https://api.cernion.de',
        description: 'Cernion API Server',
      },
    ],
    tags,
    paths,
  };
}

// ── Copilot subset builder ────────────────────────────────────────────────

function sanitizeCopilotText(value, maxLen = 900) {
  if (typeof value !== 'string') return value;
  const cleaned = value.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}

function sanitizeCopilotSchema(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeCopilotSchema(item));
  if (!value || typeof value !== 'object') return value;

  const copy = {};
  for (const [key, nested] of Object.entries(value)) {
    copy[key] =
      key === 'description' || key === 'summary'
        ? sanitizeCopilotText(nested, key === 'description' ? 900 : 180)
        : sanitizeCopilotSchema(nested);
  }
  return copy;
}

/**
 * Builds a curated OpenAPI spec containing only operations from the
 * Copilot allowlist (config/copilot-operations.json).
 *
 * Applies:
 * - Lookup via `specOperationId` (actual ID in spec) when it differs from `operationId`
 * - Stable Copilot-friendly `operationId` in output (camelCase, no hyphens)
 * - Description overrides from allowlist entries (`copilotDescription`)
 * - x-openai-isConsequential based on mode (read/draft → false, prepare/consequential → true)
 * - Path parameter normalization: Express `:param` → OpenAPI `{param}`
 * - Auto-adds missing `in: "path"` parameter definitions for any path params
 *
 * @param {object} fullSpec  Annotated full spec (output of main annotation loop)
 * @param {object[]} allowlist  Array of allowlist entries from copilot-operations.json
 * @returns {object}  Filtered OpenAPI spec
 */
function buildCopilotSpec(fullSpec, allowlist) {
  // Key by specOperationId when present (actual ID in spec), else by operationId
  const allowMap = new Map(
    allowlist.map((entry) => [entry.specOperationId || entry.operationId, entry])
  );

  const paths = {};
  for (const [openapiPath, pathItem] of Object.entries(fullSpec.paths || {})) {
    // Normalize Express :param → OpenAPI {param}
    const normalizedPath = openapiPath.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, '{$1}');
    const pathParamNames = [...normalizedPath.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(
      (m) => m[1]
    );

    const filteredItem = {};
    for (const [method, operation] of Object.entries(pathItem)) {
      const entry = allowMap.get(operation.operationId);
      if (!entry) continue;

      const isConsequential = entry.mode === 'prepare' || entry.mode === 'consequential';

      // Auto-add path param definitions that are missing from the operation
      const existingPathParams = new Set(
        (operation.parameters || []).filter((p) => p.in === 'path').map((p) => p.name)
      );
      const missingParams = pathParamNames
        .filter((n) => !existingPathParams.has(n))
        .map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));

      const filteredOperation = {
        ...operation,
        operationId: entry.operationId, // stable Copilot-friendly ID (no hyphens)
        'x-openai-isConsequential': isConsequential,
        ...(entry.copilotDescription ? { description: entry.copilotDescription } : {}),
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(missingParams.length > 0
          ? { parameters: [...(operation.parameters || []), ...missingParams] }
          : {}),
      };

      filteredItem[method] = sanitizeCopilotSchema(filteredOperation);
    }
    if (Object.keys(filteredItem).length > 0) paths[normalizedPath] = filteredItem;
  }

  return {
    ...fullSpec,
    paths,
    'x-copilot-subset': true,
    'x-copilot-operations-version': allowlist.length,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const isLive = process.argv.includes('--live');
  const isCopilot = process.argv.includes('--copilot');
  let spec;

  if (isLive) {
    spec = await loadSpec();
  } else {
    spec = buildStaticSpec();
  }

  // Inject x-ui-page on all paths, remove excluded paths
  const annotatedPaths = {};
  for (const [openapiPath, pathItem] of Object.entries(spec.paths || {})) {
    if (shouldExclude(openapiPath)) continue;

    const uiPage = resolveUiPage(openapiPath);
    const annotatedPathItem = {};

    for (const [method, operation] of Object.entries(pathItem)) {
      annotatedPathItem[method] = {
        ...operation,
        ...(uiPage ? { 'x-ui-page': uiPage } : {}),
      };
    }

    annotatedPaths[openapiPath] = annotatedPathItem;
  }

  const includeTimestamp =
    String(process.env.OPENAPI_EXPORT_INCLUDE_TIMESTAMP || 'false') === 'true';

  const exportSpec = {
    ...spec,
    paths: annotatedPaths,
    'x-generator': 'scripts/export-openapi.js',
    'x-version': packageVersion,
  };

  if (includeTimestamp) {
    exportSpec['x-generated-at'] = new Date().toISOString();
  }

  if (!isCopilot) {
    // Default: write full export
    const outPath = path.join(__dirname, '..', 'openapi-export.json');
    fs.writeFileSync(outPath, JSON.stringify(exportSpec, null, 2), 'utf-8');
    const pathCount = Object.keys(annotatedPaths).length;
    console.log(`[export-openapi] ✅ Wrote ${pathCount} path(s) to ${outPath}`);
    console.log(`[export-openapi]    Version: ${packageVersion}`);
    console.log(`[export-openapi]    Tip: run with --live to fetch from a running server`);
    console.log(`[export-openapi]    Tip: run with --copilot to generate openapi-copilot.json`);
  } else {
    // --copilot: write Copilot subset only
    const copilotConfigPath = path.join(__dirname, '..', 'config', 'copilot-operations.json');
    if (!fs.existsSync(copilotConfigPath)) {
      console.error(
        '[export-openapi] ❌ config/copilot-operations.json not found. Cannot build Copilot subset.'
      );
      process.exit(1);
    }

    const { allowlist } = require(copilotConfigPath);
    const copilotSpec = buildCopilotSpec(exportSpec, allowlist);
    const copilotOutPath = path.join(__dirname, '..', 'openapi-copilot.json');
    fs.writeFileSync(copilotOutPath, JSON.stringify(copilotSpec, null, 2), 'utf-8');
    const copilotPathCount = Object.keys(copilotSpec.paths).length;
    console.log(
      `[export-openapi] ✅ Wrote ${copilotPathCount} Copilot path(s) to ${copilotOutPath}`
    );
    console.log(`[export-openapi]    Allowlist: ${allowlist.length} operations`);
    console.log(`[export-openapi]    Version: ${packageVersion}`);
  }
}

main().catch((err) => {
  console.error('[export-openapi] ❌ Error:', err.message);
  process.exit(1);
});
