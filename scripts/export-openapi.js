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

// ── Route → UI page mapping ──────────────────────────────────────────────

const UI_PAGE_MAP = [
  [/^\/dashboard\//,          'dashboard'],
  [/^\/vnb-monitor\//,        'vnb-monitor'],
  [/^\/nbp-monitor\//,        'nbp-monitor'],
  [/^\/mastr-quality\//,      'mastr-quality'],
  [/^\/grid-connection\//,    'grid-connection'],
  [/^\/energy-sharing\//,     'energy-sharing'],
  [/^\/energy-sharing-alloc/, 'energy-sharing-allocation'],
  [/^\/redispatch\//,         'redispatch'],
  [/^\/datapoints\//,         'datapoints'],
  [/^\/energy-market\//,      'energy-market'],
  [/^\/gas-storage\//,        'gas-storage'],
  [/^\/osm-geo\//,            'geo'],
  [/^\/grid\//,               'grid'],
  [/^\/tokens\//,             'auth'],
  [/^\/jobs\//,               'jobs'],
  [/^\/eic\//,                'eic'],
  [/^\/entsoe\//,             'entsoe'],
  [/^\/forecast\//,           'forecast'],
  [/^\/residual-load\//,      'residual-load'],
  [/^\/query\//,              'query'],
  [/^\/agent\//,              'agent'],
  [/^\/system\//,             'system'],
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
  const url  = `http://localhost:${port}/api/openapi.json`;

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
function buildStaticSpec() {
  // Attempt to read tags from api.service.js
  let tags = [];
  try {
    // eslint-disable-next-line global-require
    const apiSvc = require('../services/api.service');
    tags = apiSvc.settings?.openapi?.tags || [];
  } catch {
    // fallback: no tags
  }

  return {
    openapi: '3.0.0',
    info: {
      title:   'Cernion Energy Tools API',
      version: packageVersion,
      description:
        'MicroService Agent System for Energy Markets - REST API with AI integration.\n\n' +
        'CERNION_TOKEN: request at https://cernion.de/ or by email: dev@stromdao.com.',
    },
    tags,
    paths: {},  // populated below from KNOWN_ROUTES
  };
}

// ── Known routes (sourced from api.service.js aliases) ───────────────────

// These are the canonical REST routes for annotation. If live spec is
// unavailable, we inject x-ui-page into these stub path entries.
const KNOWN_DASHBOARD_PATHS = {
  '/dashboard/vnb-overview': {
    get: {
      tags:        ['Dashboard API'],
      summary:     'VNB overview — aggregated dashboard data for one grid operator',
      operationId: 'dashboard-api.vnbOverview',
      'x-ui-page': 'dashboard',
      parameters:  [{ name: 'bdewCode', in: 'query', required: true, schema: { type: 'string' } }],
      responses:   { 200: { description: 'Aggregated VNB overview' } },
    },
  },
  '/dashboard/market-snapshot': {
    get: {
      tags:        ['Dashboard API'],
      summary:     'Market snapshot — current spot prices, CO₂ intensity, renewable forecast',
      operationId: 'dashboard-api.marketSnapshot',
      'x-ui-page': 'dashboard',
      parameters:  [
        { name: 'location', in: 'query', required: false, schema: { type: 'string', default: 'Deutschland' } },
        { name: 'region',   in: 'query', required: false, schema: { type: 'string', default: 'Germany' } },
      ],
      responses: { 200: { description: 'Current market snapshot' } },
    },
  },
  '/dashboard/quality-summary': {
    get: {
      tags:        ['Dashboard API'],
      summary:     'Quality summary — recent reports from all agent pipelines',
      operationId: 'dashboard-api.qualitySummary',
      'x-ui-page': 'dashboard',
      parameters:  [{ name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } }],
      responses:   { 200: { description: 'Quality summary across all agent pipelines' } },
    },
  },
  '/dashboard/finding-codes': {
    get: {
      tags:        ['Dashboard API'],
      summary:     'Finding codes reference — all 92 codes with metadata',
      operationId: 'dashboard-api.findingCodes',
      'x-ui-page': 'dashboard',
      responses:   { 200: { description: 'Finding codes reference' } },
    },
  },
};

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const isLive = process.argv.includes('--live');
  let spec;

  if (isLive) {
    spec = await loadSpec();
  } else {
    spec = buildStaticSpec();
    // Merge known dashboard paths into static spec
    Object.assign(spec.paths, KNOWN_DASHBOARD_PATHS);
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

  const exportSpec = {
    ...spec,
    paths: annotatedPaths,
    'x-generated-at': new Date().toISOString(),
    'x-generator':    'scripts/export-openapi.js',
    'x-version':      packageVersion,
  };

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
