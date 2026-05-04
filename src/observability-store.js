'use strict';

const crypto = require('crypto');
const util = require('util');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { scrubPromptText } = require('./prompt-scrubber');

const DEFAULT_DB_PATH = process.env.OBSERVABILITY_DB_PATH || './data/observability';
const DEFAULT_LOG_RETENTION_DAYS = parsePositiveInt(process.env.OBSERVABILITY_LOG_RETENTION_DAYS, 14);
const DEFAULT_METRIC_RETENTION_DAYS = parsePositiveInt(
  process.env.OBSERVABILITY_METRIC_RETENTION_DAYS,
  30
);
const DEFAULT_MAX_LOG_MESSAGE_LENGTH = parsePositiveInt(
  process.env.OBSERVABILITY_MAX_LOG_MESSAGE_LENGTH,
  2000
);
const GC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_GC_DOCS_PER_RUN = 500;

const state = {
  db: null,
  initPromise: null,
  writeQueue: Promise.resolve(),
  lastGcAt: 0,
  disabled: false,
  config: {
    dbPath: DEFAULT_DB_PATH,
    logRetentionDays: DEFAULT_LOG_RETENTION_DAYS,
    metricRetentionDays: DEFAULT_METRIC_RETENTION_DAYS,
    maxLogMessageLength: DEFAULT_MAX_LOG_MESSAGE_LENGTH,
  },
};

function parsePositiveInt(value, fallback) {
  const num = Number.parseInt(value, 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function configure(options = {}) {
  state.disabled = false;
  state.config = {
    ...state.config,
    ...Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ),
  };
  return getConfig();
}

function getConfig() {
  return { ...state.config };
}

async function init() {
  state.disabled = false;
  if (state.db) return state.db;
  if (!state.initPromise) {
    state.db = new PouchDB(state.config.dbPath, { auto_compaction: true });
    state.initPromise = (async () => {
      await state.db.createIndex({ index: { fields: ['docType', 'timestamp'] } });
      await state.db.createIndex({ index: { fields: ['docType', 'service', 'timestamp'] } });
      await state.db.createIndex({ index: { fields: ['docType', 'level', 'timestamp'] } });
      await state.db.createIndex({ index: { fields: ['docType', 'action', 'timestamp'] } });
      await state.db.createIndex({ index: { fields: ['docType', 'status', 'timestamp'] } });
      return state.db;
    })().catch((err) => {
      state.initPromise = null;
      state.db = null;
      throw err;
    });
  }
  return state.initPromise;
}

async function close() {
  state.disabled = true;
  const currentDb = state.db;
  state.db = null;
  state.initPromise = null;
  state.writeQueue = Promise.resolve();
  state.lastGcAt = 0;
  if (currentDb) {
    await currentDb.close();
  }
}

async function flush() {
  await state.writeQueue.catch(() => null);
}

function formatLogArgs(args) {
  if (!Array.isArray(args) || args.length === 0) return '';
  if (typeof args[0] === 'string') {
    try {
      return util.format(...args);
    } catch {
      return args.map(formatValue).join(' ');
    }
  }
  return args.map(formatValue).join(' ');
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  return util.inspect(value, {
    depth: 4,
    breakLength: 120,
    maxArrayLength: 20,
    maxStringLength: 500,
    compact: true,
  });
}

function sanitizeMessage(message) {
  let cleaned = scrubPromptText(String(message || ''));
  cleaned = cleaned.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
  cleaned = cleaned.replace(/\bck_[A-Za-z0-9_-]{8,}\b/g, 'ck_[REDACTED]');
  cleaned = cleaned.replace(/([?&](?:token|api[_-]?key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]');

  if (cleaned.length > state.config.maxLogMessageLength) {
    return `${cleaned.slice(0, state.config.maxLogMessageLength)}…[truncated]`;
  }
  return cleaned;
}

function buildLogDoc(entry = {}) {
  const timestamp = entry.timestamp || new Date().toISOString();
  return {
    _id: buildDocId('log', timestamp),
    docType: 'log',
    timestamp,
    level: String(entry.level || 'info').toLowerCase(),
    service: entry.service || 'broker',
    action: entry.action || null,
    source: entry.source || 'logger',
    nodeID: entry.nodeID || null,
    requestOrigin: entry.requestOrigin || null,
    errorType: entry.errorType || null,
    message: sanitizeMessage(entry.message),
  };
}

function buildMetricDoc(entry = {}) {
  const timestamp = entry.timestamp || new Date().toISOString();
  return {
    _id: buildDocId('metric', timestamp),
    docType: 'metric',
    timestamp,
    service: entry.service || 'unknown',
    action: entry.action || 'unknown',
    nodeID: entry.nodeID || null,
    requestOrigin: entry.requestOrigin || 'internal',
    status: entry.status || 'success',
    durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : 0,
    errorType: entry.errorType || null,
  };
}

function buildDocId(prefix, timestamp) {
  const millis = Date.parse(timestamp);
  const safeMillis = Number.isFinite(millis) ? millis : Date.now();
  return `${prefix}:${safeMillis}:${crypto.randomUUID()}`;
}

function enqueueWrite(operation) {
  state.writeQueue = state.writeQueue
    .catch(() => null)
    .then(async () => {
      const db = await init();
      await operation(db);
      await maybeRunGc(db);
    })
    .catch(() => null);
  return state.writeQueue;
}

function captureLog(entry) {
  const doc = buildLogDoc(entry);
  if (state.disabled) return doc;
  enqueueWrite((db) => db.put(doc));
  return doc;
}

function captureMetric(entry) {
  const doc = buildMetricDoc(entry);
  if (state.disabled) return doc;
  enqueueWrite((db) => db.put(doc));
  return doc;
}

async function maybeRunGc(db) {
  const now = Date.now();
  if (now - state.lastGcAt < GC_INTERVAL_MS) return;
  state.lastGcAt = now;
  await pruneDocs(db, 'log', state.config.logRetentionDays);
  await pruneDocs(db, 'metric', state.config.metricRetentionDays);
}

async function pruneDocs(db, docType, retentionDays) {
  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const response = await db.find({
    selector: {
      docType,
      timestamp: { $lt: cutoffIso },
    },
    fields: ['_id', '_rev'],
    limit: MAX_GC_DOCS_PER_RUN,
  });
  if (!response.docs.length) return;
  await db.bulkDocs(response.docs.map((doc) => ({ ...doc, _deleted: true })));
}

async function listLogs(filters = {}) {
  const db = await init();
  const limit = clampLimit(filters.limit, 50, 1, 500);
  const docs = await findDocs(db, 'log', filters, limit * 5);
  const contains = String(filters.contains || '').trim().toLowerCase();
  return docs
    .filter((doc) => !contains || String(doc.message || '').toLowerCase().includes(contains))
    .sort(sortDescByTimestamp)
    .slice(0, limit)
    .map(toPublicDoc);
}

async function listMetrics(filters = {}) {
  const db = await init();
  const limit = clampLimit(filters.limit, 100, 1, 1000);
  const docs = await findDocs(db, 'metric', filters, limit * 5);
  return docs.sort(sortDescByTimestamp).slice(0, limit).map(toPublicDoc);
}

function clampLimit(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function findDocs(db, docType, filters, limit) {
  const selector = { docType };

  if (filters.service) selector.service = String(filters.service);
  if (filters.action) selector.action = String(filters.action);
  if (docType === 'log' && filters.level) selector.level = String(filters.level).toLowerCase();
  if (docType === 'metric' && filters.status) selector.status = String(filters.status).toLowerCase();

  const range = buildTimestampSelector(filters.since, filters.until, filters.sinceMinutes);
  if (range) selector.timestamp = range;

  const response = await db.find({
    selector,
    limit: Math.max(limit, 1),
  });
  return response.docs || [];
}

function buildTimestampSelector(since, until, sinceMinutes) {
  const range = {};
  const parsedSince = normalizeTimestampInput(since);
  const parsedUntil = normalizeTimestampInput(until);

  if (parsedSince) range.$gte = parsedSince;
  if (parsedUntil) range.$lte = parsedUntil;

  if (!parsedSince && sinceMinutes != null) {
    const minutes = Number(sinceMinutes);
    if (Number.isFinite(minutes) && minutes > 0) {
      range.$gte = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    }
  }

  return Object.keys(range).length ? range : null;
}

function normalizeTimestampInput(value) {
  if (!value) return null;
  const iso = new Date(value).toISOString();
  return iso === 'Invalid Date' ? null : iso;
}

function sortDescByTimestamp(a, b) {
  return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
}

function toPublicDoc(doc) {
  const { _id, _rev, ...rest } = doc;
  return rest;
}

module.exports = {
  configure,
  getConfig,
  init,
  flush,
  close,
  formatLogArgs,
  captureLog,
  captureMetric,
  listLogs,
  listMetrics,
};
