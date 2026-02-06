/**
 * Moleculer ServiceBroker configuration file
 */
require('dotenv').config();

module.exports = {
  namespace: process.env.NAMESPACE || 'cernion',
  nodeID: process.env.NODE_ID || null,

  logger: {
    type: 'Console',
    options: {
      level: process.env.LOG_LEVEL || 'info',
      colors: true,
      moduleColors: true,
      formatter: 'full',
      autoPadding: true,
    },
  },

  logLevel: process.env.LOG_LEVEL || 'info',

  transporter: process.env.TRANSPORTER || null,

  cacher: process.env.CACHER || null,

  serializer: 'JSON',

  requestTimeout: 10 * 1000,

  retryPolicy: {
    enabled: false,
    retries: 5,
    delay: 100,
    maxDelay: 1000,
    factor: 2,
    check: (err) => err && !!err.retryable,
  },

  maxCallLevel: 100,

  heartbeatInterval: 10,
  heartbeatTimeout: 30,

  contextParamsCloning: false,

  tracking: {
    enabled: false,
    shutdownTimeout: 5000,
  },

  disableBalancer: false,

  registry: {
    strategy: 'RoundRobin',
    preferLocal: true,
  },

  circuitBreaker: {
    enabled: false,
    threshold: 0.5,
    minRequestCount: 20,
    windowTime: 60,
    halfOpenTime: 10 * 1000,
    check: (err) => err && err.code >= 500,
  },

  bulkhead: {
    enabled: false,
    concurrency: 10,
    maxQueueSize: 100,
  },

  validator: true,

  errorHandler: null,

  metrics: {
    enabled: false,
    reporter: null,
  },

  tracing: {
    enabled: false,
    exporter: null,
  },

  internalServices: true,
  internalMiddlewares: true,

  hotReload: true,

  middlewares: [],

  replDelimiter: 'mol $',
  replCommands: null,

  metadata: {},

  skipProcessEventRegistration: false,

  created(broker) {},

  async started(broker) {
    broker.logger.info('Moleculer broker started successfully');
  },

  async stopped(broker) {
    broker.logger.info('Moleculer broker stopped');
  },
};
