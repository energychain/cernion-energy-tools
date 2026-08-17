'use strict';

/**
 * Internal MQTT-shaped EDM measurement ingest contract (issue #503).
 *
 * This is NOT an external MQTT broker/listener. It accepts MQTT-topic-shaped
 * messages via Moleculer actions (`ingestMessage`/`ingestBatch`), validates
 * and normalizes them, and delegates all persistence to the existing
 * `edm.importTimeseries` action (no direct SQLite access). Invalid messages
 * are counted and recorded as bounded, hash-only dead letters (no raw
 * payload retention). State is process-local/in-memory for this MVP slice —
 * no PouchDB registry, no REST alias, no external listener/connector.
 */

const crypto = require('crypto');

const TOPIC_PATTERN = /^cernion\/edm\/([^/]+)\/([^/]+)\/([^/]+)$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const OBIS_PATTERN = /^\d{1,3}-\d{1,3}:\d{1,3}\.\d{1,3}\.\d{1,3}(\*\d{1,3})?$/;
const DEFAULT_MAX_DEAD_LETTERS = 500;

function nowIso() {
  return new Date().toISOString();
}

function isValidIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function parseTopic(topic) {
  const match = TOPIC_PATTERN.exec(String(topic || ''));
  if (!match) return null;
  const [, tenantId, meloId, obis] = match;
  return { tenantId, meloId, obis };
}

function extractReadings(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.values)) {
    return payload.values;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'ts')) {
    return [{ ts: payload.ts, value: payload.value, quality: payload.quality }];
  }
  return null;
}

module.exports = {
  name: 'mqtt-edm-ingest',

  settings: {
    maxDeadLetters:
      Number(process.env.MQTT_EDM_INGEST_MAX_DEAD_LETTERS) || DEFAULT_MAX_DEAD_LETTERS,
  },

  created() {
    this.stats = {
      received: 0,
      imported: 0,
      skipped: 0,
      deadLettered: 0,
      lastReceivedAt: null,
    };
    this.deadLetters = [];
    this._deadLetterSeq = 0;
  },

  actions: {
    ingestMessage: {
      params: {
        topic: { type: 'string', min: 1 },
        payload: { type: 'object' },
        receivedAt: { type: 'string', optional: true },
        source: { type: 'string', optional: true },
      },
      async handler(ctx) {
        return this._ingestOne(ctx, ctx.params);
      },
    },

    ingestBatch: {
      params: {
        messages: { type: 'array', min: 1, items: 'object' },
      },
      async handler(ctx) {
        const results = [];
        for (const message of ctx.params.messages) {
          results.push(await this._ingestOne(ctx, message || {}));
        }

        return {
          success: true,
          count: results.length,
          imported: results.reduce((sum, r) => sum + (r.imported || 0), 0),
          skipped: results.reduce((sum, r) => sum + (r.skipped || 0), 0),
          deadLettered: results.filter((r) => !r.success).length,
          results,
        };
      },
    },

    getStatus: {
      handler() {
        return { ...this.stats };
      },
    },

    listDeadLetters: {
      params: {
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 500, default: 100 },
      },
      handler(ctx) {
        const limit = ctx.params.limit || 100;
        return {
          count: this.deadLetters.length,
          deadLetters: this.deadLetters.slice(-limit).reverse(),
        };
      },
    },
  },

  methods: {
    _recordDeadLetter({ topic, reason, receivedAt, source, payload }) {
      this._deadLetterSeq += 1;
      const entry = {
        id: `dl_${Date.now().toString(36)}_${this._deadLetterSeq}`,
        topic: topic || null,
        reason,
        receivedAt,
        source: source || null,
        payloadHash: payloadHash(payload),
      };

      this.deadLetters.push(entry);
      if (this.deadLetters.length > this.settings.maxDeadLetters) {
        this.deadLetters.splice(0, this.deadLetters.length - this.settings.maxDeadLetters);
      }

      this.stats.deadLettered += 1;
      return entry;
    },

    async _ingestOne(ctx, message) {
      const receivedAt = isValidIsoTimestamp(message.receivedAt) ? message.receivedAt : nowIso();
      const source = typeof message.source === 'string' ? message.source : null;
      const topic = message.topic;
      const payload = message.payload;

      this.stats.received += 1;
      this.stats.lastReceivedAt = receivedAt;

      const reject = (reason) => ({
        success: false,
        reason,
        deadLetterId: this._recordDeadLetter({ topic, reason, receivedAt, source, payload }).id,
        imported: 0,
        skipped: 0,
      });

      const parsedTopic = parseTopic(topic);
      if (!parsedTopic) {
        return reject('INVALID_TOPIC');
      }

      const { tenantId, meloId, obis } = parsedTopic;

      if (!TENANT_ID_PATTERN.test(tenantId)) {
        return reject('INVALID_TENANT');
      }

      if (!OBIS_PATTERN.test(obis)) {
        return reject('INVALID_TOPIC');
      }

      if (payload && typeof payload === 'object') {
        if (Object.prototype.hasOwnProperty.call(payload, 'meloId') && payload.meloId !== meloId) {
          return reject('OBIS_CONFLICT');
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'obis') && payload.obis !== obis) {
          return reject('OBIS_CONFLICT');
        }
      }

      const rawReadings = extractReadings(payload);
      if (!rawReadings || rawReadings.length === 0) {
        return reject('INVALID_TIMESTAMP');
      }

      const data = [];
      for (const reading of rawReadings) {
        if (!reading || !isValidIsoTimestamp(reading.ts)) {
          return reject('INVALID_TIMESTAMP');
        }
        if (
          reading.value !== null &&
          reading.value !== undefined &&
          !Number.isFinite(Number(reading.value))
        ) {
          return reject('VALUE_NOT_NUMERIC');
        }

        data.push({
          ts: new Date(reading.ts).toISOString(),
          value:
            reading.value === undefined || reading.value === null ? null : Number(reading.value),
          quality: reading.quality || payload.quality || 'measured',
          source: `mqtt:${source || 'unknown'}`,
        });
      }

      let result;
      try {
        result = await ctx.call('edm.importTimeseries', {
          meloId,
          obis,
          format: 'json',
          overwriteExisting: false,
          data,
        });
      } catch (err) {
        if (err && err.type === 'MELO_NOT_FOUND') {
          return reject('UNKNOWN_MELO');
        }
        this.logger.warn('mqtt-edm-ingest: edm.importTimeseries failed', err && err.message);
        return reject('EDM_IMPORT_ERROR');
      }

      this.stats.imported += result.imported || 0;
      this.stats.skipped += result.skipped || 0;

      return {
        success: true,
        tenantId,
        meloId,
        obis,
        imported: result.imported || 0,
        skipped: result.skipped || 0,
      };
    },
  },
};
