/**
 * API Gateway Service
 *
 * This service provides HTTP REST API access to all microservices
 * with OpenAPI documentation support.
 */

const ApiGateway = require('moleculer-web');
const OpenapiMixin = require('moleculer-auto-openapi');

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
        version: '1.0.0',
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
        },
      },
    },

    routes: [
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

    assets: {
      folder: 'public',
      options: {},
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
  },

  async stopped() {
    this.logger.info('API Gateway stopped');
  },
};
