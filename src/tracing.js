'use strict';

const crypto = require('crypto');
const { context, propagation, trace, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

let provider;
let initialized = false;

function isEnabled() {
  const raw = String(process.env.TRACING_ENABLED || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function initTracing() {
  if (initialized || !isEnabled()) return;

  provider = new NodeTracerProvider();
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
  if (endpoint) {
    const exporter = new OTLPTraceExporter({ url: endpoint });
    provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  }
  provider.register();
  initialized = true;
}

function getTracer() {
  initTracing();
  return trace.getTracer('cernion-energy-tools', '0.44.1');
}

function extractParentContext(carrier) {
  if (carrier && typeof carrier === 'object' && Object.keys(carrier).length > 0) {
    return propagation.extract(context.active(), carrier);
  }
  return context.active();
}

function startSpan(name, options = {}) {
  if (!isEnabled()) return null;
  const tracer = getTracer();
  const parentContext = extractParentContext(options.parentCarrier);
  return tracer.startSpan(
    name,
    {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes || {},
    },
    parentContext
  );
}

function injectCarrierFromSpan(span) {
  if (!span) return {};
  const carrier = {};
  propagation.inject(trace.setSpan(context.active(), span), carrier);
  return carrier;
}

function attachSpanToMeta(meta, span) {
  if (!meta || !span) return meta;
  const spanContext = span.spanContext();
  meta.__otel = injectCarrierFromSpan(span);
  meta.traceId = spanContext.traceId;
  if (!meta.correlationId) {
    meta.correlationId = spanContext.traceId;
  }
  return meta;
}

async function withSpan(name, options, fn) {
  const span = startSpan(name, options);
  if (!span) {
    return fn(null);
  }

  const parentContext = trace.setSpan(extractParentContext(options?.parentCarrier), span);
  try {
    return await context.with(parentContext, () => fn(span));
  } catch (error) {
    setError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

function addEvent(span, name, attributes) {
  if (!span) return;
  span.addEvent(name, attributes || {});
}

function setError(span, error) {
  if (!span || !error) return;
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

function setOk(span) {
  if (!span) return;
  span.setStatus({ code: SpanStatusCode.OK });
}

function ensureCorrelationId(meta = {}) {
  if (!meta.correlationId) {
    meta.correlationId = crypto.randomUUID();
  }
  return meta.correlationId;
}

module.exports = {
  isEnabled,
  initTracing,
  startSpan,
  withSpan,
  addEvent,
  setError,
  setOk,
  attachSpanToMeta,
  ensureCorrelationId,
  injectCarrierFromSpan,
  SpanKind,
};
