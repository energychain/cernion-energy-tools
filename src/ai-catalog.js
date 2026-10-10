'use strict';

const { createHash } = require('node:crypto');
const { CURATED_CAPABILITIES } = require('./capability-catalog');
const { compareCanonicalStrings } = require('./canonical-order');

const CATALOG_PATH = '/.well-known/ai-catalog.json';
const ARD_PATH = '/.well-known/ard.json';
const CATALOG_TYPE = 'application/ai-catalog+json';
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const operationKey = (name) => name.replace(/[.-]/g, '_');
const sortedUnique = (values) => [...new Set(values)].sort(compareCanonicalStrings);

function catalogOrigin(value) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('AI catalog requires an HTTP(S) origin without credentials or path');
  return url.origin;
}

/** Project published action contracts only; never serialize service settings or execute tools. */
function buildAiCatalog({ spec, services, baseUrl }) {
  const origin = catalogOrigin(baseUrl);
  const publisher = new URL(origin).hostname.replace(/[^a-zA-Z0-9.-]/g, '-');
  const url = (resourcePath) => `${origin}${resourcePath}`;
  const identifier = (name) => `urn:air:${publisher}:${name}`;
  const actionIndex = new Map();
  const groups = new Map();
  for (const service of services) {
    if (!service.name || service.name.startsWith('$')) continue;
    for (const [name, action] of Object.entries(service.actions || {})) {
      if (action.visibility && action.visibility !== 'published') continue;
      const ref = `${service.name}.${name.split('.').pop()}`;
      const metadata = { service, ref };
      actionIndex.set(operationKey(ref), metadata);
      if (action.openapi?.operationId) actionIndex.set(action.openapi.operationId, metadata);
    }
  }
  for (const [apiPath, pathItem] of Object.entries(spec.paths || {}).sort(([a], [b]) =>
    compareCanonicalStrings(a, b)
  )) {
    for (const [method, operation] of Object.entries(pathItem).sort(([a], [b]) =>
      compareCanonicalStrings(a, b)
    )) {
      if (!HTTP_METHODS.has(method)) continue;
      const metadata = actionIndex.get(operation.operationId);
      if (!metadata) continue; // Static aliases to absent/internal services are not offerings.
      const { service, ref } = metadata;
      if (!groups.has(service.name))
        groups.set(service.name, { paths: {}, refs: [], summaries: [], tags: [] });
      const group = groups.get(service.name);
      group.paths[apiPath] ||= {};
      group.paths[apiPath][method] = operation;
      // Preserve shared path parameters without advertising other operations.
      if (pathItem.parameters) group.paths[apiPath].parameters = pathItem.parameters;
      group.refs.push(ref);
      if (operation.summary) group.summaries.push(operation.summary);
      group.tags.push(...(operation.tags || []));
    }
  }
  const version = String(spec.info?.version || '1.0.0');
  const entries = [
    {
      identifier: identifier('api:rest'),
      displayName: 'Cernion Energy Tools REST API',
      type: 'application/json',
      url: url('/api/openapi.json'),
      description: 'OpenAPI-Vertrag der REST-Services für Energiemärkte und Stadtwerke.',
      tags: ['energy', 'openapi', 'rest'],
      capabilities: ['rest-api-discovery'],
      representativeQueries: [
        'Welche Energie-Services und REST-Schnittstellen bietet CET?',
        'Welche Eingaben und Berechtigungen benötigt ein CET-Service?',
      ],
      version,
    },
    {
      identifier: identifier('documentation:llm'),
      displayName: 'CET Agenten-Kontext',
      type: 'text/plain',
      url: url('/llm.txt'),
      description: 'Domänen, Fähigkeiten und Auflösungsprotokoll für CET-Agenten.',
      tags: ['documentation', 'energy'],
      representativeQueries: [
        'Wie finde ich die passende CET-Fähigkeit für meine Aufgabe?',
        'Wie löse ich Domänen und Fähigkeiten in konkrete CET-Operationen auf?',
      ],
    },
  ];
  for (const [name, group] of [...groups].sort(([a], [b]) => compareCanonicalStrings(a, b))) {
    const refs = sortedUnique(group.refs);
    const capabilities = CURATED_CAPABILITIES.filter((capability) =>
      capability.preferredActions?.some((ref) => refs.includes(ref))
    );
    const summaries = sortedUnique(group.summaries);
    const description = summaries.slice(0, 3).join(' · ') || `REST-Service ${name}`;
    entries.push({
      identifier: identifier(`service:${name.replace(/[^a-zA-Z0-9._-]/g, '-')}`),
      displayName: name,
      type: 'application/vnd.oai.openapi+json',
      description,
      tags: sortedUnique([...group.tags, ...capabilities.map((item) => item.domain)]),
      capabilities: sortedUnique([...refs, ...capabilities.map((item) => item.capability)]),
      representativeQueries: [
        `Ich möchte mit ${name}: ${summaries[0] || 'Energieprozesse bearbeiten'}.`,
        summaries[1]
          ? `Ich möchte mit ${name}: ${summaries[1]}.`
          : `Welche Eingaben benötigt ${name} für ${summaries[0] || 'diese Aufgabe'}?`,
      ],
      version,
      data: {
        openapi: spec.openapi,
        info: { title: name, version, description },
        servers: [{ url: origin }],
        paths: group.paths,
        components: spec.components || {},
        ...(spec.security ? { security: spec.security } : {}),
      },
    });
  }
  return {
    specVersion: '1.0',
    host: { displayName: 'Cernion Energy Tools', documentationUrl: url('/api/docs') },
    entries,
  };
}

function advertiseAiCatalog(_req, res, next) {
  const links = `<${CATALOG_PATH}>; rel="ai-catalog"; type="${CATALOG_TYPE}", <${ARD_PATH}>; rel="ard"; type="${CATALOG_TYPE}"`;
  const previous = res.getHeader('Link');
  res.setHeader('Link', previous ? `${previous}, ${links}` : links);
  next();
}

async function serveAiCatalog(req, res) {
  try {
    // API_URL is the deployment's canonical origin, also used for OAuth/OpenAPI.
    // Forwarded headers alone do not control published artifact addresses.
    const baseUrl =
      process.env.API_URL || `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const spec = await this.broker.call('api.openapi');
    const catalog = buildAiCatalog({
      spec,
      services: this.broker.registry.getServiceList({ withActions: true }),
      baseUrl,
    });
    const body = JSON.stringify(catalog);
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    res.setHeader('Content-Type', `${CATALOG_TYPE}; charset=utf-8`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Vary', 'Host');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.end(body);
  } catch (error) {
    this.logger.warn('AI catalog unavailable', error.type || error.name);
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'AI_CATALOG_UNAVAILABLE' }));
  }
}

module.exports = { buildAiCatalog, serveAiCatalog, advertiseAiCatalog };
