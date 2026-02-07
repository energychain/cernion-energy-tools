/**
 * API Gateway Service
 *
 * This service provides HTTP REST API access to all microservices
 * with OpenAPI documentation support.
 */

const ApiGateway = require('moleculer-web');
const OpenapiMixin = require('moleculer-auto-openapi');
const path = require('path');

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
        version: '0.1.0',
        description: 'MicroService Agent System for Energy Markets - REST API with AI integration',
      },
      tags: [
        { name: 'Energy', description: 'Energy market operations' },
        { name: 'Example', description: 'Example service endpoints' },
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
              'Optional Cernion MCP token. If not provided, falls back to CERNION_TOKEN from environment.',
          },
        },
      },
      security: [{}, { BearerAuth: [] }],
    },

    routes: [
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
        layout: "StandaloneLayout"
      });
      window.ui = ui;
    };
  </script>
</body>
</html>
            `);
          },
        },

        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '1MB',
          },
          urlencoded: {
            extended: true,
            limit: '1MB',
          },
        },

        mappingPolicy: 'all',

        logging: true,

        onBeforeCall(ctx, route, req, res) {
          // Extract Bearer token from Authorization header if present
          const authHeader = req.headers['authorization'] || req.headers['Authorization'];
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7); // Remove 'Bearer ' prefix
            ctx.meta.cernionToken = token;
            this.logger.debug('Using Bearer token from request header');
          } else {
            this.logger.debug('No Bearer token provided, will use CERNION_TOKEN from environment');
          }
        },

        onError(req, res, err) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(err.code || 500);
          res.end(
            JSON.stringify({
              success: false,
              message: err.message,
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

                // Prepend service name if path doesn't start with it
                if (!path.startsWith(`/${service.name}`)) {
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
                  parameters: [],
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
    this.logger.info(`Swagger UI: http://localhost:${this.settings.port}/docs`);
  },

  async stopped() {
    this.logger.info('API Gateway stopped');
  },
};
