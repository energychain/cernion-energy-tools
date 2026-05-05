/**
 * Moleculer ServiceBroker configuration file
 */
require('dotenv').config();

const observabilityStore = require('./src/observability-store');
const metrics = require('./src/metrics');
const tracing = require('./src/tracing');
const { emitStructuredLog } = require('./src/logger');
const {
  runWithObservabilityContext,
  getObservabilityContext,
} = require('./src/observability-context');

const LOGGER_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
const OBSERVABILITY_LOGGER_WRAPPED = Symbol.for('cernion.observability.loggerWrapped');
const OBSERVABILITY_ACTION_WRAPPED = Symbol.for('cernion.observability.actionWrapped');
const OBSERVABILITY_HOOKS_INSTALLED = Symbol.for('cernion.observability.hooksInstalled');

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

function installObservabilityHooks(broker) {
  if (!broker || broker[OBSERVABILITY_HOOKS_INSTALLED]) return;
  broker[OBSERVABILITY_HOOKS_INSTALLED] = true;
  metrics.initMetrics();
  metrics.registerBroker(broker);
  tracing.initTracing();

  wrapLoggerMethods(broker.logger, () => ({
    service: 'broker',
    source: 'broker',
    nodeID: broker.nodeID || null,
  }));

  const originalCreateService = broker.createService.bind(broker);
  broker.createService = function patchedCreateService(schema, ...args) {
    const instrumentedSchema = instrumentSchema(schema, broker);
    const service = originalCreateService(instrumentedSchema, ...args);
    wrapServiceLogger(service, broker);
    metrics.registerBroker(broker);
    return service;
  };

  for (const service of broker.services || []) {
    wrapServiceLogger(service, broker);
  }

  metrics.registerBroker(broker);
}

function instrumentSchema(schema, broker) {
  if (!schema || typeof schema !== 'object' || !schema.actions) return schema;

  for (const [actionName, actionDef] of Object.entries(schema.actions)) {
    if (typeof actionDef === 'function') {
      schema.actions[actionName] = wrapActionHandler(schema.name, actionName, actionDef, broker);
      continue;
    }

    if (actionDef && typeof actionDef.handler === 'function') {
      actionDef.handler = wrapActionHandler(schema.name, actionName, actionDef.handler, broker);
    }
  }

  return schema;
}

function wrapActionHandler(serviceName, actionName, handler, broker) {
  if (typeof handler !== 'function' || handler[OBSERVABILITY_ACTION_WRAPPED]) return handler;

  const wrapped = async function observabilityWrappedAction(ctx) {
    const startedAt = Date.now();
    const meta = ctx?.meta || {};
    tracing.ensureCorrelationId(meta);
    const action = `${serviceName || this?.name || 'unknown'}.${actionName}`;
    const span = tracing.startSpan(`moleculer.action ${action}`, {
      parentCarrier: meta.__otel,
      attributes: {
        'cernion.service': serviceName || this?.name || 'unknown',
        'cernion.action': action,
        'cernion.request_origin': meta.$gateway ? 'gateway' : 'internal',
      },
    });
    tracing.attachSpanToMeta(meta, span);

    let status = 'success';
    let errorType = null;

    try {
      return await runWithObservabilityContext(
        {
          ...(getObservabilityContext() || {}),
          service: serviceName || this?.name || 'unknown',
          action,
          tenantId: meta.tenantId || null,
          traceId: meta.traceId || null,
          traceCarrier: meta.__otel || null,
          sessionId: meta.sessionId || ctx?.params?.sessionId || ctx?.params?.session_id || null,
          correlationId: meta.correlationId || null,
          requestOrigin: meta.$gateway ? 'gateway' : 'internal',
          source: 'service',
          nodeID: broker.nodeID || null,
        },
        () => handler.call(this, ctx)
      );
    } catch (err) {
      status = 'error';
      errorType = err?.type || err?.code || err?.name || 'UNKNOWN_ERROR';
      tracing.setError(span, err);
      throw err;
    } finally {
      const durationMs = Date.now() - startedAt;
      observabilityStore.captureMetric({
        service: serviceName || this?.name || 'unknown',
        action,
        durationMs,
        status,
        errorType,
        requestOrigin: ctx?.meta?.$gateway ? 'gateway' : 'internal',
        nodeID: broker.nodeID || null,
      });
      metrics.recordActionMetric({
        service: serviceName || this?.name || 'unknown',
        action,
        durationMs,
        status,
        requestOrigin: ctx?.meta?.$gateway ? 'gateway' : 'internal',
      });
      if (status === 'success') {
        tracing.setOk(span);
      }
      if (span) {
        span.end();
      }
    }
  };

  wrapped[OBSERVABILITY_ACTION_WRAPPED] = true;
  return wrapped;
}

function wrapServiceLogger(service, broker) {
  if (!service?.logger) return;
  wrapLoggerMethods(service.logger, () => ({
    service: service.fullName || service.name || 'unknown',
    source: 'service',
    nodeID: broker.nodeID || null,
  }));
}

function wrapLoggerMethods(logger, contextFactory) {
  if (!logger || logger[OBSERVABILITY_LOGGER_WRAPPED]) return;

  for (const level of LOGGER_LEVELS) {
    if (typeof logger[level] !== 'function') continue;
    const original = logger[level].bind(logger);

    logger[level] = (...args) => {
      original(...args);
      const entry = {
        ...contextFactory(),
        level,
        message: observabilityStore.formatLogArgs(args),
        ...getObservabilityContext(),
      };
      observabilityStore.captureLog(entry);
      metrics.recordLogEvent(entry);
      emitStructuredLog(level, entry.message, entry);
    };
  }

  logger[OBSERVABILITY_LOGGER_WRAPPED] = true;
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

  created(broker) {
    observabilityStore.configure({
      dbPath: process.env.OBSERVABILITY_DB_PATH || './data/observability',
    });
    metrics.initMetrics();
    tracing.initTracing();
    installObservabilityHooks(broker);
  },

  async started(broker) {
    await observabilityStore.init();
    broker.logger.info('Moleculer broker started successfully');
  },

  async stopped(broker) {
    broker.logger.info('Moleculer broker stopped');
    await observabilityStore.flush();
    await observabilityStore.close();
  },
};
