'use strict';

const pino = require('pino');
const { getObservabilityContext } = require('./observability-context');

const baseLogger = pino({
  level: process.env.PINO_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  base: undefined,
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'token',
      '*.token',
      'secret',
      '*.secret',
      'authorization',
      'headers.authorization',
      'headers.Authorization',
      'apiKey',
      '*.apiKey',
      'password',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

function sanitizeValue(value) {
  if (value == null) return value;
  return String(value);
}

function buildPayload(entry = {}) {
  const current = getObservabilityContext();
  return {
    service: sanitizeValue(entry.service || current.service || 'unknown'),
    action: sanitizeValue(entry.action || current.action || null),
    tenantId: sanitizeValue(entry.tenantId || current.tenantId || null),
    traceId: sanitizeValue(entry.traceId || current.traceId || null),
    sessionId: sanitizeValue(entry.sessionId || current.sessionId || null),
    correlationId: sanitizeValue(entry.correlationId || current.correlationId || null),
    source: sanitizeValue(entry.source || current.source || null),
    nodeID: sanitizeValue(entry.nodeID || current.nodeID || null),
    requestOrigin: sanitizeValue(entry.requestOrigin || current.requestOrigin || null),
    errorType: sanitizeValue(entry.errorType || null),
    ...((entry.extra && typeof entry.extra === 'object') ||
    (current.extra && typeof current.extra === 'object')
      ? { ...(current.extra || {}), ...(entry.extra || {}) }
      : {}),
  };
}

function emitStructuredLog(level, message, entry = {}) {
  const logLevel = typeof baseLogger[level] === 'function' ? level : 'info';
  baseLogger[logLevel](buildPayload(entry), String(message || ''));
}

function getLogger(bindings = {}) {
  return baseLogger.child(bindings);
}

module.exports = {
  emitStructuredLog,
  getLogger,
  baseLogger,
};
