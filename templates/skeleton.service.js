/**
 * Skeleton Service Template
 * 
 * This is a template service that demonstrates best practices for creating
 * Moleculer microservices with OpenAPI support, MCP integration, and Gemini AI.
 * 
 * Copy this file to create new services:
 * cp templates/skeleton.service.js services/yourservice.service.js
 */

const { Service } = require('moleculer');

module.exports = {
  name: 'skeleton',
  version: 1,

  /**
   * Service settings
   */
  settings: {
    // Service-specific settings
    idField: '_id',
  },

  /**
   * Service metadata
   */
  metadata: {
    scalable: true,
    priority: 5,
  },

  /**
   * Service dependencies
   */
  dependencies: [],

  /**
   * Actions
   */
  actions: {
    /**
     * Say hello action with OpenAPI documentation
     * 
     * @openapi
     * /skeleton/hello:
     *   get:
     *     summary: Say hello
     *     description: Returns a friendly greeting message
     *     tags:
     *       - Skeleton
     *     parameters:
     *       - in: query
     *         name: name
     *         schema:
     *           type: string
     *           default: World
     *         description: The name to greet
     *     responses:
     *       200:
     *         description: Successful response
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     *                   example: Hello, World!
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     */
    hello: {
      rest: 'GET /hello',
      params: {
        name: { type: 'string', default: 'World', optional: true },
      },
      async handler(ctx) {
        return {
          message: `Hello, ${ctx.params.name}!`,
          timestamp: new Date().toISOString(),
        };
      },
    },

    /**
     * Process data with parameters
     * 
     * @openapi
     * /skeleton/process:
     *   post:
     *     summary: Process data
     *     description: Processes input data and returns result
     *     tags:
     *       - Skeleton
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - data
     *             properties:
     *               data:
     *                 type: string
     *                 description: Data to process
     *               options:
     *                 type: object
     *                 properties:
     *                   uppercase:
     *                     type: boolean
     *                     default: false
     *                   prefix:
     *                     type: string
     *                     default: ''
     *     responses:
     *       200:
     *         description: Processed data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 result:
     *                   type: string
     *                 processed:
     *                   type: boolean
     */
    process: {
      rest: 'POST /process',
      params: {
        data: { type: 'string' },
        options: {
          type: 'object',
          optional: true,
          props: {
            uppercase: { type: 'boolean', default: false },
            prefix: { type: 'string', default: '' },
          },
        },
      },
      async handler(ctx) {
        let result = ctx.params.data;
        const options = ctx.params.options || {};

        if (options.prefix) {
          result = options.prefix + result;
        }

        if (options.uppercase) {
          result = result.toUpperCase();
        }

        return {
          result,
          processed: true,
        };
      },
    },

    /**
     * Get service health status
     * 
     * @openapi
     * /skeleton/health:
     *   get:
     *     summary: Health check
     *     description: Returns service health status
     *     tags:
     *       - Skeleton
     *     responses:
     *       200:
     *         description: Service is healthy
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 status:
     *                   type: string
     *                   enum: [healthy, unhealthy]
     *                 uptime:
     *                   type: number
     *                 timestamp:
     *                   type: string
     *                   format: date-time
     */
    health: {
      rest: 'GET /health',
      async handler(ctx) {
        return {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        };
      },
    },
  },

  /**
   * Events
   */
  events: {
    'skeleton.created'(payload) {
      this.logger.info('Skeleton event received:', payload);
    },
  },

  /**
   * Methods
   */
  methods: {
    /**
     * Format message
     */
    formatMessage(text) {
      return `[SKELETON] ${text}`;
    },

    /**
     * Example method for calling Gemini AI
     * (requires GEMINI_API_KEY in .env)
     */
    async callGemini(prompt) {
      if (!process.env.GEMINI_API_KEY) {
        this.logger.warn('GEMINI_API_KEY not set');
        return null;
      }

      try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
      } catch (error) {
        this.logger.error('Gemini API error:', error);
        return null;
      }
    },
  },

  /**
   * Service created lifecycle event handler
   */
  created() {
    this.logger.info('Skeleton service created');
  },

  /**
   * Service started lifecycle event handler
   */
  async started() {
    this.logger.info('Skeleton service started');
  },

  /**
   * Service stopped lifecycle event handler
   */
  async stopped() {
    this.logger.info('Skeleton service stopped');
  },
};
