/**
 * API Gateway Service
 *
 * This service provides HTTP REST API access to all microservices
 * with OpenAPI documentation support.
 */

const ApiGateway = require('moleculer-web');
const OpenapiMixin = require('moleculer-auto-openapi');
const { Errors } = require('moleculer');
const path = require('path');
const fs = require('fs');
const { version: packageVersion } = require('../package.json');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
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
]);

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

function isReadMethod(method) {
  const m = String(method || '').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

function normalizeRequestPath(req) {
  const raw = String(req?.originalUrl || req?.url || req?.path || '');
  return raw.split('?')[0] || '';
}

function requiresFullAccess(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];

  if (pathOnly === '/api/tokens' && m === 'GET') return true;
  if (pathOnly === '/api/tokens' && m === 'POST') return true;
  if (pathOnly.startsWith('/api/tokens/') && pathOnly !== '/api/tokens/verify' && m === 'DELETE') {
    return true;
  }
  if (pathOnly === '/api/vnb-monitor/thresholds' && (m === 'PUT' || m === 'DELETE')) return true;
  if (pathOnly === '/api/nbp-monitor/parameters' && (m === 'PUT' || m === 'DELETE')) return true;

  return false;
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
        { name: 'NBPMonitor', description: 'Netzbetreiberprüfungs-Monitor (MaStR status 2955 queue KPIs)' },
        { name: 'IntegrationHub', description: 'Token management and integration helpers' },
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
        },        {
          name: 'OEP (Open Energy Platform)',
          description:
            'Read-only access to Open Energy Platform research and scenario datasets. ' +
            'No authentication required for public tables. ' +
            'Supports schema/table discovery, column metadata, row queries, and full-text search. ' +
            'API: https://openenergyplatform.org/api/v0',
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
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(html);
            } catch (err) {
              res.writeHead(500);
              res.end('Sample app not found: ' + err.message);
            }
          },
        },
      },
      // Main API routes
      {
        path: '/api',

        whitelist: ['**'],

        use: [],

        mergeParams: true,

        authentication: false,

        authorization: false,

        autoAliases: true,

        aliases: {
          'GET /openapi.json': 'api.openapi',
          'GET /docs'(req, res) {
            // Serve Swagger UI HTML
            res.setHeader('Content-Type', 'text/html');
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
          'GET /vnb-monitor/thresholds': 'vnb-monitor.getThresholds',
          'PUT /vnb-monitor/thresholds': 'vnb-monitor.setThresholds',
          'DELETE /vnb-monitor/thresholds': 'vnb-monitor.resetThresholds',
          'GET /vnb-monitor/:bdewCode/nbp-monitor': 'nbp-monitor.snapshot',
          'GET /nbp-monitor/parameters': 'nbp-monitor.getParameters',
          'PUT /nbp-monitor/parameters': 'nbp-monitor.setParameters',
          'DELETE /nbp-monitor/parameters': 'nbp-monitor.resetParameters',
          // Datapoints (v0.11–v0.13) — static routes MUST precede /:name to avoid route shadowing
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
          'GET /jobs/:jobId/status': 'job-status.status',
          'GET /jobs/:jobId/result': 'job-status.result',
          // OEP (Open Energy Platform) read-only connector (v0.12)
          'GET /oep/schemas': 'oep.listSchemas',
          'GET /oep/schemas/:schema/tables': 'oep.listTables',
          'GET /oep/tables/:schema/:table/meta': 'oep.getTableMeta',
          'GET /oep/tables/:schema/:table/rows': 'oep.query',
          'GET /oep/search': 'oep.search',
          // Grid Connection Validation (v0.14)
          'POST /grid-connection/validate': 'grid-connection.validate',
          'GET /grid-connection/validations': 'grid-connection.list',
          'GET /grid-connection/validations/:id': 'grid-connection.get',
          // Energy Sharing Validation (v0.15)
          'POST /energy-sharing/validate': 'energy-sharing.validate',
          'GET /energy-sharing/validations': 'energy-sharing.list',
          'GET /energy-sharing/validations/:id': 'energy-sharing.get',
          // Energy Sharing Allocation (v0.16) — /download must precede /:id
          'POST /energy-sharing/allocate': 'energy-sharing-allocation.allocate',
          'GET /energy-sharing/allocations': 'energy-sharing-allocation.list',
          'GET /energy-sharing/allocations/:id/download': 'energy-sharing-allocation.download',
          'GET /energy-sharing/allocations/:id': 'energy-sharing-allocation.get',
          'DELETE /energy-sharing/allocations/:id': 'energy-sharing-allocation.remove',
          // MaStR Data Quality (v0.17)
          'POST /mastr-quality/audit': 'mastr-quality.audit',
          'GET /mastr-quality/audits': 'mastr-quality.list',
          'GET /mastr-quality/audits/:id': 'mastr-quality.get',

          // Local upload folder for datasource file connectors (csv/xlsx/docx/...)
          'GET /datasources/uploads'(req, res) {
            try {
              ensureUploadDir();
              const files = fs
                .readdirSync(UPLOAD_DIR)
                .filter((entry) => fs.statSync(path.join(UPLOAD_DIR, entry)).isFile())
                .sort((a, b) => a.localeCompare(b))
                .map((fileName) => buildUploadResponseEntry(fileName));

              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  success: true,
                  count: files.length,
                  uploadDir: UPLOAD_DIR,
                  data: files,
                })
              );
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
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
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: 'fileName is required.' }));
                return;
              }

              if (!contentBase64 || typeof contentBase64 !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: 'contentBase64 is required.' }));
                return;
              }

              const safeName = sanitizeUploadFilename(rawFileName);
              if (!safeName) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: 'Invalid fileName.' }));
                return;
              }

              const ext = path.extname(safeName).toLowerCase();
              if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
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
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, message: 'Uploaded payload is empty.' }));
                return;
              }

              const finalFileName = fs.existsSync(path.join(UPLOAD_DIR, safeName))
                ? `${path.basename(safeName, ext)}_${Date.now()}${ext}`
                : safeName;

              const finalPath = path.join(UPLOAD_DIR, finalFileName);
              fs.writeFileSync(finalPath, buffer);

              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  success: true,
                  data: buildUploadResponseEntry(finalFileName),
                })
              );
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
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

        mappingPolicy: 'all',

        logging: true,

        async onBeforeCall(ctx, route, req, _res) {
          // Mark this context as originating from the REST API gateway.
          // Used by job-aware action handlers to distinguish REST calls
          // (which get async job responses) from internal Moleculer calls
          // (which get synchronous results for backward-compatibility).
          ctx.meta.$gateway = true;

          // Token precedence:
          // 1) Request parameter "token" (query/body/path)
          // 2) Authorization: Bearer <token>
          // 3) CERNION_TOKEN from environment (fallback in MCP client)
          const requestPath = normalizeRequestPath(req);
          const isTokenVerifyEndpoint =
            requestPath === '/api/tokens/verify' && String(req?.method || '').toUpperCase() === 'POST';

          const authHeader = req.headers['authorization'] || req.headers['Authorization'];
          const bearerToken =
            authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

          const paramTokenCandidates = [
            req?.$params?.token,
            req?.query?.token,
            isTokenVerifyEndpoint ? undefined : req?.body?.token,
            req?.params?.token,
          ];

          const paramToken = paramTokenCandidates.find(
            (value) => typeof value === 'string' && value.trim().length > 0
          );

          const tokenToUse = (paramToken || bearerToken || '').trim();

          // Remove token from incoming params so actions don't need to declare it explicitly
          if (req?.$params && Object.prototype.hasOwnProperty.call(req.$params, 'token')) {
            delete req.$params.token;
          }
          if (req?.query && Object.prototype.hasOwnProperty.call(req.query, 'token')) {
            delete req.query.token;
          }
          if (
            !isTokenVerifyEndpoint &&
            req?.body &&
            Object.prototype.hasOwnProperty.call(req.body, 'token')
          ) {
            delete req.body.token;
          }
          if (req?.params && Object.prototype.hasOwnProperty.call(req.params, 'token')) {
            delete req.params.token;
          }

          if (tokenToUse) {
            const isApiToken = tokenToUse.startsWith('ck_');

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
                throw new Errors.MoleculerClientError('Invalid or revoked API token.', 401, 'INVALID_API_TOKEN');
              }

              if (verification.scope === 'read-only' && !isReadMethod(req?.method)) {
                throw new Errors.MoleculerClientError(
                  'Scope violation: read-only token cannot call write endpoints.',
                  403,
                  'TOKEN_SCOPE_VIOLATION'
                );
              }

              if (requiresFullAccess(req?.method, requestPath) && verification.scope !== 'full-access') {
                throw new Errors.MoleculerClientError(
                  'Scope violation: full-access token required for this endpoint.',
                  403,
                  'TOKEN_SCOPE_VIOLATION'
                );
              }

              ctx.meta.apiToken = {
                id: verification.tokenId,
                name: verification.name,
                scope: verification.scope,
                scopes: verification.scopes || [],
              };
              this.logger.debug('Using scoped API token from request');
            } else {
              ctx.meta.cernionToken = tokenToUse;
              if (paramToken) {
                this.logger.debug('Using token parameter from request (query/body/path)');
              } else {
                this.logger.debug('Using Bearer token from request header');
              }
            }
          } else {
            this.logger.debug('No request token provided, will use CERNION_TOKEN from environment');
          }
        },

        onError(req, res, err) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(err.code || 500);
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

        // Get all registered services
        const services = ctx.broker.registry.getServiceList({ withActions: true });

        // Iterate through services and their actions
        for (const service of services) {
          if (service.name.startsWith('$')) continue; // Skip internal services

          if (service.actions) {
            for (const actionName in service.actions) {
              const action = service.actions[actionName];

              // Check if action has REST configuration
              if (action.rest) {
                let method = 'POST';
                let path = `/${service.name}/${actionName.split('.').pop()}`;

                if (typeof action.rest === 'string') {
                  const parts = action.rest.split(' ');
                  if (parts.length === 2) {
                    method = parts[0];
                    path = parts[1];
                  } else {
                    path = action.rest;
                  }
                } else if (typeof action.rest === 'object') {
                  method = action.rest.method || method;
                  path = action.rest.path || path;
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

                const fullPath = `/api${path}`;

                if (!paths[fullPath]) {
                  paths[fullPath] = {};
                }

                paths[fullPath][method] = {
                  summary: action.description || `${service.name}.${actionName}`,
                  tags: [service.name],
                  operationId: `${service.name}_${actionName.replace(/\./g, '_')}`,
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

                // Merge with openapi configuration if it exists
                if (action.openapi) {
                  // Merge summary, description, tags
                  if (action.openapi.summary)
                    paths[fullPath][method].summary = action.openapi.summary;
                  if (action.openapi.description)
                    paths[fullPath][method].description = action.openapi.description;
                  if (action.openapi.tags) paths[fullPath][method].tags = action.openapi.tags;
                  if (action.openapi.operationId)
                    paths[fullPath][method].operationId = action.openapi.operationId;

                  // Merge requestBody if provided
                  if (action.openapi.requestBody) {
                    paths[fullPath][method].requestBody = action.openapi.requestBody;
                  }

                  // Merge responses if provided
                  if (action.openapi.responses) {
                    paths[fullPath][method].responses = action.openapi.responses;
                  }

                  // Merge parameters if provided
                  if (action.openapi.parameters) {
                    paths[fullPath][method].parameters = action.openapi.parameters;
                  }
                }

                // Ensure token query parameter is always documented for every endpoint
                if (!Array.isArray(paths[fullPath][method].parameters)) {
                  paths[fullPath][method].parameters = [];
                }

                const hasTokenQueryParam = paths[fullPath][method].parameters.some(
                  (parameter) =>
                    parameter?.$ref === '#/components/parameters/TokenQuery' ||
                    (parameter?.name === 'token' && parameter?.in === 'query')
                );

                if (!hasTokenQueryParam) {
                  paths[fullPath][method].parameters.push({
                    $ref: '#/components/parameters/TokenQuery',
                  });
                }

                // Add parameters if defined and not already provided by openapi config
                if (action.params && !action.openapi?.requestBody && !action.openapi?.parameters) {
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
                        paramType === 'number'
                          ? 'number'
                          : paramType === 'boolean'
                            ? 'boolean'
                            : 'string',
                    };

                    if (
                      param.optional === false ||
                      (typeof param === 'string' && !param.includes('optional'))
                    ) {
                      schema.required.push(paramName);
                    }
                  }

                  if (method === 'get') {
                    // For GET requests, add as query parameters
                    for (const paramName in schema.properties) {
                      paths[fullPath][method].parameters.push({
                        name: paramName,
                        in: 'query',
                        required: schema.required.includes(paramName),
                        schema: schema.properties[paramName],
                      });
                    }
                  } else {
                    // For POST/PUT/PATCH, add as request body
                    paths[fullPath][method].requestBody = {
                      required: true,
                      content: {
                        'application/json': {
                          schema: schema,
                        },
                      },
                    };
                  }
                }

                // Ensure token in request body is documented for non-GET operations
                if (method !== 'get') {
                  const tokenProperty = {
                    token: {
                      type: 'string',
                      description:
                        'Optional Cernion MCP token for this request. Overrides CERNION_TOKEN when provided.',
                    },
                  };

                  const operation = paths[fullPath][method];
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
                  } else {
                    const jsonContent = currentRequestBody.content?.['application/json'];
                    const existingSchema = jsonContent?.schema;

                    if (existingSchema) {
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
                      } else {
                        if (!existingSchema.type) {
                          existingSchema.type = 'object';
                        }
                        if (!existingSchema.properties) {
                          existingSchema.properties = {};
                        }
                        if (!existingSchema.properties.token) {
                          existingSchema.properties.token = tokenProperty.token;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
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
    this.logger.info(`Swagger UI: http://localhost:${this.settings.port}/api/docs`);
    this.logger.info(`🤖 Sample App: http://localhost:${this.settings.port}/app`);
  },

  async stopped() {
    this.logger.info('API Gateway stopped');
  },
};
