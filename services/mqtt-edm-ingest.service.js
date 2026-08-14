'use strict';

const crypto = require('crypto');

const TOPIC_PATTERN = /^cernion\/edm\/([^/]+)\/([^/]+)\/([^/]+)$/;
const TENANT_PATTERN = /^[A-Za-z0-9_.-]+$/;
const MELO_PATTERN = /^[A-Za-z0-9_.-]+$/;
const OBIS_PATTERN = /^\d{1,3}-\d{1,3}:\d{1,3}\.\d{1,3}\.\d{1,3}(\*\d{1,3})?$/;

const DEFAULT_MAX_DEAD_LETTERS = Number(process.env.MQTT_EDM_INGEST_MAX_DEAD_LETTERS || 200);

function nowIso() {
  return new Date().toISOString();
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

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function parseTopic(topic) {
  const match = TOPIC_PATTERN.exec(String(topic || ''));
  if (!match) {
    return { valid: false, reason: 'INVALID_TOPIC' };
  }

  const [, tenantId, meloId, obis] = match;

  if (!TENANT_PATTERN.test(tenantId)) {
    return { valid: false, reason: 'INVALID_TENANT' };
  }
  if (!MELO_PATTERN.test(meloId) || !OBIS_PATTERN.test(obis)) {
    return { valid: false, reason: 'INVALID_TOPIC' };
  }

  return { valid: true, tenantId, meloId, obis };
}

function isNumericValue(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeEntry(raw) {
  if (!raw || raw.ts === undefined || raw.ts === null) {
    return { valid: false, reason: 'INVALID_TIMESTAMP' };
  }
  const ts = new Date(raw.ts);
  if (Number.isNaN(ts.getTime())) {
    return { valid: false, reason: 'INVALID_TIMESTAMP' };
  }
  if (raw.value !== null && !isNumericValue(raw.value)) {
    return { valid: false, reason: 'VALUE_NOT_NUMERIC' };
  }

  return {
    valid: true,
    ts: ts.toISOString(),
    value: raw.value === null ? null : Number(raw.value),
    quality: raw.quality || (raw.value === null ? 'missing' : 'measured'),
  };
}

function extractRawEntries(payload) {
  if (Array.isArray(payload?.values)) {
    return payload.values;
  }
  return [{ ts: payload?.ts, value: payload?.value, quality: payload?.quality }];
}

module.exports = {
  name: 'mqtt-edm-ingest',

  settings: {
    maxDeadLetters: DEFAULT_MAX_DEAD_LETTERS,
  },

  created() {
    this.deadLetters = [];
    this.counters = {
      received: 0,
      imported: 0,
      skipped: 0,
      deadLettered: 0,
    };
    this.lastReceivedAt = null;
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
        return this.ingestOne(ctx, ctx.params);
      },
    },

    ingestBatch: {
      params: {
        messages: { type: 'array', min: 1, items: 'object' },
      },
      async handler(ctx) {
        const results = [];
        const totals = { received: 0, imported: 0, skipped: 0, deadLettered: 0 };

        for (const message of ctx.params.messages) {
          const result = await this.ingestOne(ctx, message);
          results.push({
            topic: message.topic,
            received: result.received,
            imported: result.imported,
            skipped: result.skipped,
            deadLettered: result.deadLettered,
          });
          totals.received += result.received;
          totals.imported += result.imported;
          totals.skipped += result.skipped;
          totals.deadLettered += result.deadLettered;
        }

        return { success: true, ...totals, results };
      },
    },

    getStatus: {
      async handler() {
        return {
          success: true,
          status: {
            ...this.counters,
            lastReceivedAt: this.lastReceivedAt,
          },
        };
      },
    },

    listDeadLetters: {
      params: {
        limit: {
          type: 'number',
          integer: true,
          positive: true,
          optional: true,
          default: 50,
          convert: true,
        },
      },
      async handler(ctx) {
        const { limit } = ctx.params;
        const entries = this.deadLetters.slice(-limit);
        return { success: true, count: entries.length, deadLetters: entries };
      },
    },
  },

  methods: {
    recordDeadLetter({ reason, topic, receivedAt, source, payload, entryCount }) {
      const entry = {
        id: crypto.randomUUID(),
        topic: topic || null,
        reason,
        receivedAt: receivedAt || nowIso(),
        source: source || null,
        payloadHash: hashPayload(payload),
      };

      this.deadLetters.push(entry);
      if (this.deadLetters.length > this.settings.maxDeadLetters) {
        this.deadLetters.splice(0, this.deadLetters.length - this.settings.maxDeadLetters);
      }

      this.counters.deadLettered += entryCount;
      return entry;
    },

    async ingestOne(ctx, message) {
      const { topic, payload, receivedAt, source } = message;
      const effectiveReceivedAt = receivedAt || nowIso();
      this.lastReceivedAt = effectiveReceivedAt;

      const result = { received: 0, imported: 0, skipped: 0, deadLettered: 0 };
      // A rejected message can carry several measurement entries (batch payload), but the
      // bounded dead-letter list stores one metadata record per reject event, not one per
      // entry — counters below track entry counts, the list tracks events.
      const entryCount = extractRawEntries(payload).length;

      const parsedTopic = parseTopic(topic);
      if (!parsedTopic.valid) {
        this.counters.received += entryCount;
        result.received += entryCount;
        this.recordDeadLetter({
          reason: parsedTopic.reason,
          topic,
          receivedAt: effectiveReceivedAt,
          source,
          payload,
          entryCount,
        });
        result.deadLettered += entryCount;
        return result;
      }

      const { meloId, obis } = parsedTopic;

      if (
        (payload?.meloId !== undefined && payload.meloId !== meloId) ||
        (payload?.obis !== undefined && payload.obis !== obis)
      ) {
        this.counters.received += entryCount;
        result.received += entryCount;
        this.recordDeadLetter({
          reason: 'TOPIC_PAYLOAD_CONFLICT',
          topic,
          receivedAt: effectiveReceivedAt,
          source,
          payload,
          entryCount,
        });
        result.deadLettered += entryCount;
        return result;
      }

      const rawEntries = extractRawEntries(payload);
      this.counters.received += rawEntries.length;
      result.received += rawEntries.length;

      const validRows = [];
      for (const raw of rawEntries) {
        const normalized = normalizeEntry(raw);
        if (!normalized.valid) {
          this.recordDeadLetter({
            reason: normalized.reason,
            topic,
            receivedAt: effectiveReceivedAt,
            source,
            payload: raw,
            entryCount: 1,
          });
          result.deadLettered += 1;
          continue;
        }
        validRows.push({
          ts: normalized.ts,
          value: normalized.value,
          quality: normalized.quality,
          source: `mqtt:${source || 'unknown'}`,
        });
      }

      if (validRows.length === 0) {
        return result;
      }

      try {
        const imported = await ctx.call('edm.importTimeseries', {
          meloId,
          obis,
          format: 'json',
          overwriteExisting: false,
          data: validRows,
        });

        this.counters.imported += imported.imported || 0;
        this.counters.skipped += imported.skipped || 0;
        result.imported += imported.imported || 0;
        result.skipped += imported.skipped || 0;
      } catch (error) {
        const reason = error?.type === 'MELO_NOT_FOUND' ? 'UNKNOWN_MELO' : 'IMPORT_FAILED';
        this.recordDeadLetter({
          reason,
          topic,
          receivedAt: effectiveReceivedAt,
          source,
          payload: { meloId, obis, rowCount: validRows.length },
          entryCount: validRows.length,
        });
        result.deadLettered += validRows.length;
      }

      return result;
    },
  },
};
