/**
 * Moleculer ServiceBroker configuration file
 */
require('dotenv').config();

function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function envNum(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

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

  requestTimeout: envNum('REQUEST_TIMEOUT_MS', 15 * 60 * 1000), // default 15 minutes for long-running MCP tools

  retryPolicy: {
    enabled: envBool('RETRY_POLICY_ENABLED', false),
    retries: envNum('RETRY_POLICY_RETRIES', 5),
    delay: envNum('RETRY_POLICY_DELAY_MS', 100),
    maxDelay: envNum('RETRY_POLICY_MAX_DELAY_MS', 1000),
    factor: envNum('RETRY_POLICY_FACTOR', 2),
    check: (err) => err && !!err.retryable,
  },

  maxCallLevel: 100,

  heartbeatInterval: 10,
  heartbeatTimeout: 30,

  contextParamsCloning: false,

  tracking: {
    enabled: envBool('TRACKING_ENABLED', false),
    shutdownTimeout: envNum('TRACKING_SHUTDOWN_TIMEOUT_MS', 5000),
  },

  disableBalancer: false,

  registry: {
    strategy: 'RoundRobin',
    preferLocal: true,
  },

  circuitBreaker: {
    enabled: envBool('CIRCUIT_BREAKER_ENABLED', false),
    threshold: envNum('CIRCUIT_BREAKER_THRESHOLD', 0.5),
    minRequestCount: envNum('CIRCUIT_BREAKER_MIN_REQUEST_COUNT', 20),
    windowTime: envNum('CIRCUIT_BREAKER_WINDOW_TIME_SEC', 60),
    halfOpenTime: envNum('CIRCUIT_BREAKER_HALF_OPEN_MS', 10 * 1000),
    check: (err) => err && err.code >= 500,
  },

  bulkhead: {
    enabled: envBool('BULKHEAD_ENABLED', false),
    concurrency: envNum('BULKHEAD_CONCURRENCY', 10),
    maxQueueSize: envNum('BULKHEAD_MAX_QUEUE_SIZE', 100),
  },

  validator: true,

  errorHandler: null,

  metrics: {
    enabled: envBool('METRICS_ENABLED', false),
    reporter: null,
  },

  tracing: {
    enabled: envBool('TRACING_ENABLED', false),
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

  created(_broker) {},

  async started(broker) {
    broker.logger.info('Moleculer broker started successfully');
  },

  async stopped(broker) {
    broker.logger.info('Moleculer broker stopped');
  },
};
