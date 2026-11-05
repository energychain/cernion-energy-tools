#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST = path.join(__dirname, '..', 'manifests', 'stadtwerk-mauer-workbench.json');

function usage() {
  return `Usage:
  node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js [--manifest <file>] [--dry-run]
  node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js [--manifest <file>] --preflight-existing
  node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js [--manifest <file>] --require-existing

Existing-target gate:
  --preflight-existing  read-only; resolves exactly one existing Application and Workspace App
  --require-existing    applies datasource/queries/screen only to that uniquely resolved target;
                        never creates an Application or Workspace App

Required authentication:
  BUDIBASE_BASE_URL=http://localhost:10000
  BUDIBASE_EMAIL=admin@example.local
  BUDIBASE_PASSWORD=...

Alternative authentication for local smoke runs:
  BUDIBASE_COOKIE_FILE=/path/to/curl-cookie-jar

Optional:
  CERNION_BASE_URL=http://172.17.0.1:3900
`;
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    dryRun: false,
    preflightExisting: false,
    requireExisting: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--preflight-existing') {
      args.preflightExisting = true;
    } else if (arg === '--require-existing') {
      args.requireExisting = true;
    } else if (arg === '--manifest') {
      args.manifest = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if ([args.dryRun, args.preflightExisting, args.requireExisting].filter(Boolean).length > 1) {
    throw new Error(
      '--dry-run, --preflight-existing and --require-existing are mutually exclusive.'
    );
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Base URL must be HTTP(S) without credentials, query or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

function parseCookieJar(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !line.startsWith('# Netscape') && !line.startsWith('# https') && !line.startsWith('# This')
    )
    .map((line) => {
      const httpOnly = line.startsWith('#HttpOnly_');
      const normalized = httpOnly ? line.replace(/^#HttpOnly_/, '') : line;
      if (normalized.startsWith('#')) return null;
      const parts = normalized.split(/\t/);
      if (parts.length < 7) return null;
      return `${parts[5]}=${parts.slice(6).join('\t')}`;
    })
    .filter(Boolean)
    .join('; ');
}

function parseSetCookie(headerValue) {
  if (!headerValue) return '';
  return headerValue
    .split(/,(?=[^;,]+=)/)
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10000);
  }
  return Math.min(1000 * 2 ** attempt, 10000);
}

class BudibaseClient {
  constructor({ baseUrl, cookie }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.cookie = cookie || '';
  }

  async login({ email, password }) {
    const response = await fetch(`${this.baseUrl}/api/global/auth/default/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Budibase login failed (${response.status}): ${body}`);
    }
    this.cookie = parseSetCookie(response.headers.get('set-cookie'));
    if (!this.cookie) {
      throw new Error('Budibase login succeeded but did not return cookies');
    }
  }

  async request(method, urlPath, { appId, body } = {}) {
    const headers = {
      accept: 'application/json',
      cookie: this.cookie,
    };
    if (appId) headers['x-budibase-app-id'] = appId;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    let lastText = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${urlPath}`, {
        method,
        headers,
        body: serializedBody,
      });
      const text = await response.text();
      if (response.ok) {
        return text ? JSON.parse(text) : null;
      }
      lastText = text;
      if (response.status !== 429 || attempt === 4) {
        throw new Error(`${method} ${urlPath} failed (${response.status}): ${text}`);
      }
      await sleep(retryDelayMs(response, attempt));
    }
    throw new Error(`${method} ${urlPath} failed after retry: ${lastText}`);
  }
}

function fullUrl(baseUrl, queryPath) {
  return `${normalizeBaseUrl(baseUrl)}${queryPath.startsWith('/') ? queryPath : `/${queryPath}`}`;
}

function queryVerb(method) {
  return method.toUpperCase() === 'GET' ? 'read' : 'create';
}

function buildQueryPayload({ manifestQuery, datasourceId, cernionBaseUrl, existing }) {
  const method = manifestQuery.method.toUpperCase();
  const fields = {
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    queryString: manifestQuery.queryString || '',
    path: fullUrl(cernionBaseUrl, manifestQuery.path),
    bodyType: method === 'GET' ? 'none' : 'json',
  };
  if (method !== 'GET') {
    fields.requestBody = JSON.stringify(manifestQuery.body || {}, null, 2);
  }
  return {
    ...(existing || {}),
    name: manifestQuery.name,
    datasourceId,
    queryVerb: queryVerb(method),
    fields,
    parameters: manifestQuery.parameters || [],
    readable: true,
    schema: manifestQuery.schema || {},
    transformer: manifestQuery.transformer || 'return data',
  };
}

function textBlock(id, text, size = 'medium') {
  return {
    _component: '@budibase/standard-components/textv2',
    _id: id,
    _instanceName: id,
    text,
    size,
    _styles: { normal: { margin: '0' } },
  };
}

function containerBlock(id, children) {
  return {
    _component: '@budibase/standard-components/container',
    _id: id,
    _instanceName: id,
    direction: 'column',
    gap: '12px',
    layout: 'flex',
    _styles: {
      normal: {
        display: 'flex',
        'flex-direction': 'column',
        gap: '12px',
        padding: '16px',
        border: '1px solid #d8dee4',
        'border-radius': '8px',
        background: '#fff',
      },
    },
    _children: children,
  };
}

function queryDataSource(query, title) {
  return {
    type: 'query',
    datasourceId: query._id,
    _id: query._id,
    name: title || query.name,
    parameters: query.parameters || [],
  };
}

function tableBlock(id, title, query) {
  return {
    _component: '@budibase/standard-components/tableblock',
    _id: id,
    _instanceName: title,
    title,
    dataSource: queryDataSource(query, title),
    rowCount: 8,
    paginate: false,
    quiet: true,
    compact: false,
    allowSelectRows: false,
    noRowsMessage: 'Keine Datensaetze gefunden',
    _styles: { normal: { width: '100%', height: '360px' } },
  };
}

function buildScreen({ manifest, existingScreen, workspaceAppId, queriesByName }) {
  const children = [
    textBlock('title', manifest.screen.name, 'large'),
    textBlock('intro', 'Fallarbeitsplatz fuer Demo, Evidence und kontrollierte Runbook-Aktionen'),
  ];
  for (const section of manifest.sections || []) {
    const query = queriesByName.get(section.queryName);
    if (!query) throw new Error(`Missing query for section ${section.id}: ${section.queryName}`);
    children.push(
      containerBlock(`${section.id}_section`, [
        textBlock(`${section.id}_heading`, section.title),
        tableBlock(`${section.id}_table_block`, section.tableTitle, query),
      ])
    );
  }
  for (const [index, note] of (manifest.notes || []).entries()) {
    children.push(textBlock(`note_${index + 1}`, note));
  }
  return {
    ...(existingScreen || {}),
    name: manifest.screen.name,
    routing: {
      route: manifest.screen.route,
      roleId: manifest.screen.roleId || 'BASIC',
      homeScreen: !existingScreen,
    },
    width: 'Large',
    workspaceAppId,
    props: {
      _component: '@budibase/standard-components/container',
      _id: 'root',
      _instanceName: 'Root',
      direction: 'column',
      gap: '16px',
      layout: 'flex',
      _styles: {
        normal: {
          display: 'flex',
          'flex-direction': 'column',
          gap: '16px',
          padding: '24px',
          background: '#f6f8fa',
          'min-height': '100vh',
        },
      },
      _children: children,
    },
  };
}

async function ensureApp(client, manifest) {
  const apps = await client.request('GET', '/api/applications?status=all');
  const existing = apps.find((app) => app.name === manifest.name);
  if (existing) return existing;
  return client.request('POST', '/api/applications', {
    body: { name: manifest.name, url: manifest.url },
  });
}

async function ensureWorkspaceApp(client, appId, manifest) {
  const response = await client.request('GET', '/api/workspaceApp', { appId });
  const apps = response.workspaceApps || response || [];
  const existing = apps.find((app) => app.name === manifest.workspaceApp.name);
  if (existing) return existing;
  return client.request('POST', '/api/workspaceApp', {
    appId,
    body: {
      name: manifest.workspaceApp.name,
      url: manifest.workspaceApp.url,
      disabled: false,
    },
  });
}

async function ensureDatasource(client, appId, manifest, cernionBaseUrl) {
  const datasources = await client.request('GET', '/api/datasources', { appId });
  const existing = datasources.find((item) => item.name === manifest.datasource.name);
  const body = {
    datasource: {
      ...(existing || {}),
      name: manifest.datasource.name,
      source: manifest.datasource.source,
      config: {
        url: normalizeBaseUrl(cernionBaseUrl),
        defaultHeaders: {},
        rejectUnauthorized: false,
      },
    },
  };
  const saved = await client.request('POST', '/api/datasources', { appId, body });
  return saved.datasource || saved;
}

async function ensureQueries(client, appId, manifest, datasource, cernionBaseUrl) {
  const existingQueries = await client.request('GET', '/api/queries', { appId });
  const saved = [];
  for (const manifestQuery of manifest.queries) {
    const existing = existingQueries.find((query) => query.name === manifestQuery.name);
    const body = buildQueryPayload({
      manifestQuery,
      datasourceId: datasource._id,
      cernionBaseUrl,
      existing,
    });
    saved.push(await client.request('POST', '/api/queries', { appId, body }));
  }
  return saved;
}

async function ensureScreen(client, appId, manifest, workspaceApp, queries) {
  const screens = await client.request('GET', '/api/screens', { appId });
  const existing = screens.find((screen) => screen.name === manifest.screen.name);
  const queriesByName = new Map(queries.map((query) => [query.name, query]));
  const body = buildScreen({
    manifest,
    existingScreen: existing,
    workspaceAppId: workspaceApp._id,
    queriesByName,
  });
  return client.request('POST', '/api/screens', { appId, body });
}

async function authenticate(client, env) {
  if (!client.cookie) {
    const email = env.BUDIBASE_EMAIL;
    const password = env.BUDIBASE_PASSWORD;
    if (!email || !password) {
      throw new Error(`Missing Budibase credentials.\n\n${usage()}`);
    }
    await client.login({ email, password });
  }
}

const TARGET_STATES = Object.freeze([
  'ready_existing',
  'missing_application',
  'ambiguous_application',
  'missing_workspace_app',
  'ambiguous_workspace_app',
  'manifest_mismatch',
]);

const NEXT_SAFE_GATE = Object.freeze({
  ready_existing: 'require_existing_apply',
  missing_application: 'operator_provision_existing_target',
  ambiguous_application: 'operator_resolve_duplicate_targets',
  missing_workspace_app: 'operator_provision_existing_target',
  ambiguous_workspace_app: 'operator_resolve_duplicate_targets',
  manifest_mismatch: 'operator_reconcile_manifest_identity',
});

const PUBLIC_ERRORS = Object.freeze({
  invalid_arguments: { boundary: 'arguments', message: 'Invalid command line arguments.' },
  manifest_unreadable: { boundary: 'manifest', message: 'Manifest could not be read as JSON.' },
  manifest_invalid: {
    boundary: 'manifest',
    message: 'Manifest lacks bounded identity fields for the existing-target gate.',
  },
  config_invalid: { boundary: 'config', message: 'Budibase or Cernion base URL is invalid.' },
  auth_failed: { boundary: 'budibase_auth', message: 'Budibase authentication failed.' },
  catalog_unreadable: {
    boundary: 'budibase_catalog',
    message: 'Budibase catalog lookup failed or returned an unexpected shape.',
  },
  mutation_blocked: {
    boundary: 'existing_target_gate',
    message: 'A non-GET request was blocked by the read-only preflight.',
  },
  apply_failed: {
    boundary: 'budibase_apply',
    message: 'Applying datasource, queries or screen to the existing target failed.',
  },
});

class PublicGateError extends Error {
  constructor(code) {
    super(PUBLIC_ERRORS[code].message);
    this.code = code;
  }
}

function publicError(code) {
  const entry = PUBLIC_ERRORS[code] || PUBLIC_ERRORS.catalog_unreadable;
  return {
    boundary: entry.boundary,
    code: PUBLIC_ERRORS[code] ? code : 'catalog_unreadable',
    message: entry.message,
  };
}

const MAX_PUBLIC_STRING = 200;

function boundedString(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_PUBLIC_STRING);
}

function validateExistingTargetManifest(manifest) {
  const identity = {
    applicationName: boundedString(manifest?.name),
    applicationUrl: manifest?.url === undefined ? null : boundedString(manifest.url),
    workspaceAppName: boundedString(manifest?.workspaceApp?.name),
    workspaceAppUrl:
      manifest?.workspaceApp?.url === undefined ? null : boundedString(manifest.workspaceApp.url),
    screenRoute: boundedString(manifest?.screen?.route),
  };
  const urlsValid =
    (manifest?.url === undefined || identity.applicationUrl) &&
    (manifest?.workspaceApp?.url === undefined || identity.workspaceAppUrl);
  if (
    !identity.applicationName ||
    !identity.workspaceAppName ||
    !identity.screenRoute ||
    !urlsValid ||
    !Array.isArray(manifest?.queries)
  ) {
    throw new PublicGateError('manifest_invalid');
  }
  return identity;
}

// Read-only view of a Budibase client: any non-GET request is refused before it leaves the process.
function readOnlyClient(client) {
  return {
    request(method, urlPath, options) {
      if (String(method).toUpperCase() !== 'GET') {
        return Promise.reject(new PublicGateError('mutation_blocked'));
      }
      return client.request('GET', urlPath, options);
    },
  };
}

function resolveUnique(items, expectedName, expectedUrl) {
  const nameMatches = items.filter((item) => item && item.name === expectedName);
  const urlMatches = expectedUrl ? items.filter((item) => item && item.url === expectedUrl) : [];
  if (nameMatches.length === 1) {
    const [match] = nameMatches;
    const mismatch = Boolean(expectedUrl) && (match.url !== expectedUrl || urlMatches.length !== 1);
    return { state: mismatch ? 'mismatch' : 'unique', match, nameMatches, urlMatches };
  }
  if (nameMatches.length > 1) return { state: 'ambiguous', nameMatches, urlMatches };
  return { state: urlMatches.length ? 'mismatch' : 'missing', nameMatches, urlMatches };
}

function catalogArray(response, key) {
  const items = key && response && !Array.isArray(response) ? response[key] : response;
  if (!Array.isArray(items)) throw new PublicGateError('catalog_unreadable');
  return items;
}

async function resolveExistingTarget(client, manifest) {
  const identity = validateExistingTargetManifest(manifest);
  const guarded = readOnlyClient(client);
  const receipt = {
    expected: {
      applicationName: identity.applicationName,
      applicationUrl: identity.applicationUrl,
      workspaceAppName: identity.workspaceAppName,
      workspaceAppUrl: identity.workspaceAppUrl,
    },
    matches: {
      applicationByName: 0,
      applicationByUrl: 0,
      workspaceAppByName: 0,
      workspaceAppByUrl: 0,
    },
    application: null,
    workspaceApp: null,
  };

  const apps = catalogArray(await guarded.request('GET', '/api/applications?status=all'));
  const appResult = resolveUnique(apps, identity.applicationName, identity.applicationUrl);
  receipt.matches.applicationByName = appResult.nameMatches.length;
  receipt.matches.applicationByUrl = appResult.urlMatches.length;
  if (appResult.state !== 'unique') {
    const state = {
      missing: 'missing_application',
      ambiguous: 'ambiguous_application',
      mismatch: 'manifest_mismatch',
    }[appResult.state];
    return { targetState: state, receipt };
  }
  const appId = boundedString(appResult.match.appId);
  if (!appId) throw new PublicGateError('catalog_unreadable');
  receipt.application = {
    appId,
    name: boundedString(appResult.match.name),
    url: boundedString(appResult.match.url),
    status: boundedString(appResult.match.status),
  };

  const workspaceApps = catalogArray(
    await guarded.request('GET', '/api/workspaceApp', { appId }),
    'workspaceApps'
  );
  const wsResult = resolveUnique(
    workspaceApps,
    identity.workspaceAppName,
    identity.workspaceAppUrl
  );
  receipt.matches.workspaceAppByName = wsResult.nameMatches.length;
  receipt.matches.workspaceAppByUrl = wsResult.urlMatches.length;
  if (wsResult.state !== 'unique') {
    const state = {
      missing: 'missing_workspace_app',
      ambiguous: 'ambiguous_workspace_app',
      mismatch: 'manifest_mismatch',
    }[wsResult.state];
    return { targetState: state, receipt };
  }
  const workspaceAppId = boundedString(wsResult.match._id);
  if (!workspaceAppId) throw new PublicGateError('catalog_unreadable');
  receipt.workspaceApp = {
    id: workspaceAppId,
    name: boundedString(wsResult.match.name),
    url: boundedString(wsResult.match.url),
  };
  return {
    targetState: 'ready_existing',
    receipt,
    bound: { app: { appId }, workspaceApp: { _id: workspaceAppId } },
  };
}

function buildGateReceipt({
  mode,
  manifestPath,
  manifest,
  resolution,
  mutationPerformed,
  applied,
}) {
  const targetState = resolution?.targetState || null;
  const receipt = {
    mode,
    manifest: {
      path: boundedString(path.basename(String(manifestPath || ''))),
      name: boundedString(manifest?.name),
    },
    screenRoute: boundedString(manifest?.screen?.route),
    expected: resolution?.receipt?.expected || null,
    matches: resolution?.receipt?.matches || null,
    application: targetState === 'ready_existing' ? resolution.receipt.application : null,
    workspaceApp: targetState === 'ready_existing' ? resolution.receipt.workspaceApp : null,
    targetState,
    mutationPerformed: Boolean(mutationPerformed),
    nextSafeGate:
      mode === 'require-existing' && targetState === 'ready_existing' && applied
        ? 'budibase_visible_smoke'
        : NEXT_SAFE_GATE[targetState] || 'operator_review',
  };
  if (applied) receipt.applied = applied;
  return receipt;
}

async function runExistingTargetMode({
  args,
  env = process.env,
  createClient = (options) => new BudibaseClient(options),
  stdout = (text) => console.log(text),
  stderr = (text) => console.error(text),
}) {
  const mode = args.preflightExisting ? 'preflight-existing' : 'require-existing';
  let manifest = null;
  let resolution = null;
  let nonGetRequests = 0;
  let stage = 'manifest_unreadable';
  try {
    try {
      manifest = readJson(args.manifest);
    } catch {
      throw new PublicGateError('manifest_unreadable');
    }
    stage = 'manifest_invalid';
    validateExistingTargetManifest(manifest);

    stage = 'config_invalid';
    const budibaseBaseUrl = normalizeBaseUrl(env.BUDIBASE_BASE_URL || 'http://localhost:10000');
    const cernionBaseUrl = normalizeBaseUrl(
      env[manifest.datasource?.urlEnv] || manifest.datasource?.defaultUrl
    );

    stage = 'auth_failed';
    const cookie = env.BUDIBASE_COOKIE_FILE ? parseCookieJar(env.BUDIBASE_COOKIE_FILE) : '';
    const rawClient = createClient({ baseUrl: budibaseBaseUrl, cookie });
    await authenticate(rawClient, env);

    stage = 'catalog_unreadable';
    resolution = await resolveExistingTarget(rawClient, manifest);
    if (!TARGET_STATES.includes(resolution.targetState)) {
      throw new PublicGateError('catalog_unreadable');
    }

    if (mode === 'preflight-existing' || resolution.targetState !== 'ready_existing') {
      stdout(
        JSON.stringify(
          buildGateReceipt({ mode, manifestPath: args.manifest, manifest, resolution }),
          null,
          2
        )
      );
      return resolution.targetState === 'ready_existing' ? 0 : 3;
    }

    // Ready: bind the resolved IDs; ensureApp/ensureWorkspaceApp are never called here.
    stage = 'apply_failed';
    const client = {
      request(method, urlPath, options) {
        if (String(method).toUpperCase() !== 'GET') nonGetRequests += 1;
        return rawClient.request(method, urlPath, options);
      },
    };
    const { appId } = resolution.bound.app;
    const datasource = await ensureDatasource(client, appId, manifest, cernionBaseUrl);
    const queries = await ensureQueries(client, appId, manifest, datasource, cernionBaseUrl);
    const screen = await ensureScreen(
      client,
      appId,
      manifest,
      resolution.bound.workspaceApp,
      queries
    );
    stdout(
      JSON.stringify(
        buildGateReceipt({
          mode,
          manifestPath: args.manifest,
          manifest,
          resolution,
          mutationPerformed: nonGetRequests > 0,
          applied: {
            datasourceId: boundedString(datasource?._id),
            queryCount: queries.length,
            screenId: boundedString(screen?._id),
            screenRoute: boundedString(screen?.routing?.route),
          },
        }),
        null,
        2
      )
    );
    return 0;
  } catch (error) {
    const code = error instanceof PublicGateError ? error.code : stage;
    stderr(
      JSON.stringify(
        {
          ...buildGateReceipt({
            mode,
            manifestPath: args.manifest,
            manifest,
            resolution,
            mutationPerformed: nonGetRequests > 0,
          }),
          error: publicError(code),
        },
        null,
        2
      )
    );
    return 1;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.preflightExisting || args.requireExisting) {
    process.exitCode = await runExistingTargetMode({ args });
    return;
  }
  const manifest = readJson(args.manifest);
  const budibaseBaseUrl = normalizeBaseUrl(
    process.env.BUDIBASE_BASE_URL || 'http://localhost:10000'
  );
  const cernionBaseUrl = normalizeBaseUrl(
    process.env[manifest.datasource.urlEnv] || manifest.datasource.defaultUrl
  );
  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          budibaseBaseUrl,
          cernionBaseUrl,
          manifest: args.manifest,
          app: manifest.name,
          screenRoute: manifest.screen.route,
          queries: manifest.queries.map((query) => query.name),
          sections: (manifest.sections || []).map((section) => section.id),
        },
        null,
        2
      )
    );
    return;
  }

  const cookie = process.env.BUDIBASE_COOKIE_FILE
    ? parseCookieJar(process.env.BUDIBASE_COOKIE_FILE)
    : '';
  const client = new BudibaseClient({ baseUrl: budibaseBaseUrl, cookie });
  await authenticate(client, process.env);

  const app = await ensureApp(client, manifest);
  const workspaceApp = await ensureWorkspaceApp(client, app.appId, manifest);
  const datasource = await ensureDatasource(client, app.appId, manifest, cernionBaseUrl);
  const queries = await ensureQueries(client, app.appId, manifest, datasource, cernionBaseUrl);
  const screen = await ensureScreen(client, app.appId, manifest, workspaceApp, queries);

  console.log(
    JSON.stringify(
      {
        success: true,
        app: { name: app.name, appId: app.appId, url: app.url, status: app.status },
        workspaceApp: { name: workspaceApp.name, id: workspaceApp._id, url: workspaceApp.url },
        datasource: { name: datasource.name, id: datasource._id, url: datasource.config?.url },
        queries: queries.map((query) => ({
          name: query.name,
          id: query._id,
          schemaFields: Object.keys(query.schema || {}),
        })),
        screen: {
          name: screen.name,
          id: screen._id,
          rev: screen._rev,
          route: screen.routing?.route,
          previewUrl: `${budibaseBaseUrl}/${app.appId}${screen.routing?.route}#${screen.routing?.route}`,
        },
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  TARGET_STATES,
  parseArgs,
  resolveExistingTarget,
  runExistingTargetMode,
  ensureApp,
  ensureWorkspaceApp,
};
