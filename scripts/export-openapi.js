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

const EXCLUDED_PATH_PATTERNS = [
  /^\/upload/,
  /^\/system\//,
];

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
    // eslint-disable-next-line global-require, import/no-dynamic-require
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
  if (openapi['x-oeo-class']) operation['x-oeo-class'] = openapi['x-oeo-class'];

  return operation;
}

function buildStaticPaths(apiSvc, actionRegistry) {
  const routes = apiSvc.settings?.routes || [];
  const apiRoute = routes.find((route) => route && route.path === '/api');
  const aliases = apiRoute?.aliases || {};
  const paths = {};

  for (const [aliasKey, aliasTarget] of Object.entries(aliases)) {
    if (typeof aliasTarget !== 'string') continue;

    const [methodRaw, ...restParts] = aliasKey.split(' ');
    if (!methodRaw || restParts.length === 0) continue;

    const method = methodRaw.toLowerCase();
    const routePath = restParts.join(' ').trim();
    const openapiPath = normaliseApiPath(routePath);

    if (!paths[openapiPath]) paths[openapiPath] = {};

    const actionDef = actionRegistry.get(aliasTarget);
    paths[openapiPath][method] = buildOperationFromAction(aliasTarget, actionDef || {});
  }

  return paths;
}

function buildStaticSpec() {
  // eslint-disable-next-line global-require
  const apiSvc = require('../services/api.service');
  const tags = apiSvc.settings?.openapi?.tags || [];
  const actionRegistry = loadActionRegistry();
  const paths = buildStaticPaths(apiSvc, actionRegistry);

  return {
    openapi: '3.0.0',
    info: {
      title: 'Cernion Energy Tools API',
      version: packageVersion,
      description:
        'MicroService Agent System for Energy Markets - REST API with AI integration.\n\n' +
        'CERNION_TOKEN: request at https://cernion.de/ or by email: dev@stromdao.com.',
    },
    tags,
    paths,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const isLive = process.argv.includes('--live');
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

  const includeTimestamp = String(process.env.OPENAPI_EXPORT_INCLUDE_TIMESTAMP || 'false') === 'true';

  const exportSpec = {
    ...spec,
    paths: annotatedPaths,
    'x-generator':    'scripts/export-openapi.js',
    'x-version':      packageVersion,
  };

  if (includeTimestamp) {
    exportSpec['x-generated-at'] = new Date().toISOString();
  }

  const outPath = path.join(__dirname, '..', 'openapi-export.json');
  fs.writeFileSync(outPath, JSON.stringify(exportSpec, null, 2), 'utf-8');

  const pathCount = Object.keys(annotatedPaths).length;
  console.log(`[export-openapi] ✅ Wrote ${pathCount} path(s) to ${outPath}`);
  console.log(`[export-openapi]    Version: ${packageVersion}`);
  console.log(`[export-openapi]    Tip: run with --live to fetch from a running server`);
}

main().catch((err) => {
  console.error('[export-openapi] ❌ Error:', err.message);
  process.exit(1);
});
