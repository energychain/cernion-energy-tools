#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST = path.join(
  __dirname,
  '..',
  'manifests',
  'stadtwerk-mauer-workbench.json'
);

function usage() {
  return `Usage:
  node integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js [--manifest <file>] [--dry-run]

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
  const args = { manifest: DEFAULT_MANIFEST, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--manifest') {
      args.manifest = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function parseCookieJar(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('# Netscape') && !line.startsWith('# https') && !line.startsWith('# This'))
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
    const response = await fetch(`${this.baseUrl}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${urlPath} failed (${response.status}): ${text}`);
    }
    return text ? JSON.parse(text) : null;
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
    transformer: 'return data',
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

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const manifest = readJson(args.manifest);
  const budibaseBaseUrl = normalizeBaseUrl(process.env.BUDIBASE_BASE_URL || 'http://localhost:10000');
  const cernionBaseUrl = normalizeBaseUrl(
    process.env[manifest.datasource.urlEnv] || manifest.datasource.defaultUrl
  );
  const cookie = process.env.BUDIBASE_COOKIE_FILE
    ? parseCookieJar(process.env.BUDIBASE_COOKIE_FILE)
    : '';
  const client = new BudibaseClient({ baseUrl: budibaseBaseUrl, cookie });
  if (!client.cookie) {
    const email = process.env.BUDIBASE_EMAIL;
    const password = process.env.BUDIBASE_PASSWORD;
    if (!email || !password) {
      throw new Error(`Missing Budibase credentials.\n\n${usage()}`);
    }
    await client.login({ email, password });
  }

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
        },
        null,
        2
      )
    );
    return;
  }

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

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
