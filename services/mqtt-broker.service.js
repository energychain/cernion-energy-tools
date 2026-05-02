'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;

const DEFAULT_DB_PATH = process.env.MQTT_BROKER_DB_PATH || './data/mqtt-broker';
const DEFAULT_CONTROL_TTL_SECONDS = 300;
const MAX_PAYLOAD_BYTES = Number(process.env.MQTT_BROKER_MAX_PAYLOAD_BYTES || 32768);
const CLEANUP_INTERVAL_MS = Number(process.env.MQTT_BROKER_CLEANUP_INTERVAL_MS || 60000);

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
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

function calculatePayloadBytes(payload) {
  if (typeof payload === 'string') {
    return Buffer.byteLength(payload, 'utf8');
  }
  return Buffer.byteLength(stableStringify(payload), 'utf8');
}

function calculatePayloadHash(payload) {
  return sha256(stableStringify(payload));
}

function isControlTopic(topic, messageType) {
  return (
    messageType === 'control_command' || /^cernion\/flex\/[^/]+\/dimming$/.test(String(topic || ''))
  );
}

function isTerminalMessageState(state) {
  return state === 'acked' || state === 'expired';
}

function parseOptionalIso(value, fieldName) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MoleculerClientError(
      `Invalid ${fieldName} timestamp`,
      422,
      'MQTT_INVALID_TIMESTAMP',
      {
        field: fieldName,
        value,
      }
    );
  }
  return parsed.toISOString();
}

function buildExpiresAt({ createdAt, expiresAt, ttlSeconds, topic, messageType }) {
  const normalizedExpiresAt = parseOptionalIso(expiresAt, 'expiresAt');
  if (normalizedExpiresAt) {
    return normalizedExpiresAt;
  }

  if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
    return new Date(Date.parse(createdAt) + ttlSeconds * 1000).toISOString();
  }

  if (isControlTopic(topic, messageType)) {
    return new Date(Date.parse(createdAt) + DEFAULT_CONTROL_TTL_SECONDS * 1000).toISOString();
  }

  return null;
}

function toPublicMessage(doc) {
  return {
    messageId: doc.messageId,
    topic: doc.topic,
    qos: doc.qos,
    retain: doc.retain,
    state: doc.state,
    messageType: doc.messageType,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    expiresAt: doc.expiresAt || null,
    ackedAt: doc.ackedAt || null,
    expiredAt: doc.expiredAt || null,
    payloadHash: doc.payloadHash,
    payloadSizeBytes: doc.payloadSizeBytes,
    sourceService: doc.sourceService || null,
    sourceRef: doc.sourceRef || null,
  };
}

module.exports = {
  name: 'mqtt-broker',

  settings: {
    dbPath: DEFAULT_DB_PATH,
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS,
    controlTtlSeconds: DEFAULT_CONTROL_TTL_SECONDS,
  },

  created() {
    ensureDir(path.resolve(this.settings.dbPath));
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
    this.cleanupTimer = null;
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['docType', 'state'] } });
    await this.db.createIndex({ index: { fields: ['docType', 'topic'] } });
    await this.db.createIndex({ index: { fields: ['docType', 'expiresAt'] } });
    await this.cleanupExpiredState();
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredState().catch((error) => {
        this.logger.warn(`[mqtt-broker] cleanup failed: ${error.message}`);
      });
    }, this.settings.cleanupIntervalMs);
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
    this.logger.info(`[mqtt-broker] DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    publish: {
      params: {
        topic: { type: 'string', min: 1, trim: true },
        payload: { type: 'any' },
        qos: { type: 'enum', values: [0, 1, 2], optional: true, default: 0, convert: true },
        retain: { type: 'boolean', optional: true, default: false, convert: true },
        messageType: { type: 'string', optional: true, default: 'generic', trim: true },
        ttlSeconds: {
          type: 'number',
          integer: true,
          positive: true,
          optional: true,
          convert: true,
        },
        expiresAt: { type: 'string', optional: true },
        sourceService: { type: 'string', optional: true, trim: true },
        sourceRef: { type: 'string', optional: true, trim: true },
        meta: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const createdAt = nowIso();
        const {
          topic,
          payload,
          qos,
          retain,
          messageType,
          ttlSeconds,
          expiresAt,
          sourceService,
          sourceRef,
          meta,
        } = ctx.params;

        if (isControlTopic(topic, messageType) && retain) {
          throw new MoleculerClientError(
            'Retained delivery is not allowed for control commands',
            422,
            'MQTT_RETAIN_NOT_ALLOWED',
            { topic, messageType }
          );
        }

        const payloadSizeBytes = calculatePayloadBytes(payload);
        if (payloadSizeBytes > this.settings.maxPayloadBytes) {
          throw new MoleculerClientError(
            `Payload exceeds ${this.settings.maxPayloadBytes} bytes`,
            413,
            'MQTT_PAYLOAD_TOO_LARGE',
            { topic, payloadSizeBytes }
          );
        }

        const resolvedExpiresAt = buildExpiresAt({
          createdAt,
          expiresAt,
          ttlSeconds,
          topic,
          messageType,
        });

        if (resolvedExpiresAt && Date.parse(resolvedExpiresAt) <= Date.now()) {
          throw new MoleculerClientError(
            'Message expiry must be in the future',
            422,
            'MQTT_EXPIRES_AT_IN_PAST',
            { topic, expiresAt: resolvedExpiresAt }
          );
        }

        const messageId = crypto.randomUUID();
        const state = qos === 0 ? 'accepted' : 'pending_ack';
        const baseDoc = {
          _id: `msg:${messageId}`,
          docType: 'message',
          messageId,
          topic,
          payload,
          payloadHash: calculatePayloadHash(payload),
          payloadSizeBytes,
          qos,
          retain,
          state,
          messageType,
          createdAt,
          updatedAt: createdAt,
          expiresAt: resolvedExpiresAt,
          sourceService: sourceService || null,
          sourceRef: sourceRef || null,
          meta: meta || {},
          ackedAt: qos === 0 ? createdAt : null,
          expiredAt: null,
        };

        await this.db.put(baseDoc);

        if (qos > 0) {
          await this.db.put({
            _id: `inf:${messageId}`,
            docType: 'inflight',
            messageId,
            topic,
            qos,
            state: 'awaiting_ack',
            phase: 'PUBLISH',
            createdAt,
            updatedAt: createdAt,
            expiresAt: resolvedExpiresAt,
          });
        }

        if (retain) {
          await this.upsertRetainedMessage({
            topic,
            messageId,
            createdAt,
            expiresAt: resolvedExpiresAt,
          });
        }

        ctx.emit('mqtt.message.persisted', {
          messageId,
          topic,
          qos,
          retain,
          state,
          messageType,
          createdAt,
        });

        return {
          success: true,
          persisted: true,
          ...toPublicMessage(baseDoc),
        };
      },
    },

    acknowledge: {
      params: {
        messageId: { type: 'string', min: 1, trim: true },
        phase: {
          type: 'enum',
          values: ['PUBACK', 'PUBREC', 'PUBREL', 'PUBCOMP', 'DELIVERED'],
          optional: true,
          default: 'DELIVERED',
        },
      },
      async handler(ctx) {
        const { messageId, phase } = ctx.params;
        const message = await this.requireDoc(`msg:${messageId}`, 'MQTT_MESSAGE_NOT_FOUND');
        const inflight = await this.getDocOrNull(`inf:${messageId}`);
        const timestamp = nowIso();

        if (
          message.expiresAt &&
          Date.parse(message.expiresAt) <= Date.now() &&
          !isTerminalMessageState(message.state)
        ) {
          await this.markMessageExpired(message, inflight, timestamp);
          return {
            success: true,
            expired: true,
            ...toPublicMessage({
              ...message,
              state: 'expired',
              expiredAt: timestamp,
              updatedAt: timestamp,
            }),
          };
        }

        if (phase === 'PUBREC' || phase === 'PUBREL') {
          if (!inflight) {
            throw new MoleculerClientError(
              'Inflight state not found for MQTT message',
              404,
              'MQTT_INFLIGHT_NOT_FOUND',
              { messageId, phase }
            );
          }

          inflight.phase = phase;
          inflight.state = 'in_progress';
          inflight.updatedAt = timestamp;
          await this.db.put(inflight);

          message.state = phase.toLowerCase();
          message.updatedAt = timestamp;
          await this.db.put(message);

          return {
            success: true,
            ...toPublicMessage(message),
            phase,
          };
        }

        message.state = 'acked';
        message.ackedAt = timestamp;
        message.updatedAt = timestamp;
        await this.db.put(message);

        if (inflight) {
          inflight.phase = phase;
          inflight.state = 'completed';
          inflight.updatedAt = timestamp;
          inflight.completedAt = timestamp;
          await this.db.put(inflight);
        }

        return {
          success: true,
          ...toPublicMessage(message),
          phase,
        };
      },
    },

    recoverPendingMessages: {
      params: {
        limit: {
          type: 'number',
          integer: true,
          positive: true,
          optional: true,
          default: 100,
          convert: true,
        },
        topicPrefix: { type: 'string', optional: true, trim: true },
      },
      async handler(ctx) {
        await this.cleanupExpiredState();
        const { limit, topicPrefix } = ctx.params;
        const docs = await this.listDocsByPrefix('msg:');
        const pendingMessages = docs
          .filter((doc) => !isTerminalMessageState(doc.state))
          .filter((doc) => !topicPrefix || doc.topic.startsWith(topicPrefix))
          .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
          .slice(0, limit)
          .map((doc) => toPublicMessage(doc));

        return {
          success: true,
          count: pendingMessages.length,
          messages: pendingMessages,
        };
      },
    },

    getStats: {
      async handler() {
        await this.cleanupExpiredState();
        const docs = await this.listDocsByPrefix('msg:');
        const stats = {
          totalMessages: docs.length,
          pendingAck: 0,
          accepted: 0,
          acked: 0,
          expired: 0,
          retained: 0,
          controlMessages: 0,
        };

        docs.forEach((doc) => {
          if (doc.state === 'pending_ack' || doc.state === 'pubrec' || doc.state === 'pubrel') {
            stats.pendingAck += 1;
          }
          if (doc.state === 'accepted') stats.accepted += 1;
          if (doc.state === 'acked') stats.acked += 1;
          if (doc.state === 'expired') stats.expired += 1;
          if (doc.retain) stats.retained += 1;
          if (isControlTopic(doc.topic, doc.messageType)) stats.controlMessages += 1;
        });

        return {
          success: true,
          stats,
        };
      },
    },

    purgeExpired: {
      async handler() {
        const result = await this.cleanupExpiredState();
        return {
          success: true,
          ...result,
        };
      },
    },
  },

  methods: {
    async getDocOrNull(id) {
      try {
        return await this.db.get(id);
      } catch (error) {
        if (error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async requireDoc(id, errorType) {
      const doc = await this.getDocOrNull(id);
      if (!doc) {
        throw new MoleculerClientError('MQTT message not found', 404, errorType, { id });
      }
      return doc;
    },

    async listDocsByPrefix(prefix) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\uffff`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async upsertRetainedMessage({ topic, messageId, createdAt, expiresAt }) {
      const retainedId = `ret:${topic}`;
      const existing = await this.getDocOrNull(retainedId);
      const doc = {
        _id: retainedId,
        ...(existing ? { _rev: existing._rev } : {}),
        docType: 'retained',
        topic,
        messageId,
        createdAt: existing?.createdAt || createdAt,
        updatedAt: createdAt,
        expiresAt: expiresAt || null,
      };
      await this.db.put(doc);
    },

    async markMessageExpired(message, inflight, timestamp) {
      if (!isTerminalMessageState(message.state)) {
        message.state = 'expired';
        message.expiredAt = timestamp;
        message.updatedAt = timestamp;
        await this.db.put(message);
      }

      if (inflight && inflight.state !== 'expired' && inflight.state !== 'completed') {
        inflight.state = 'expired';
        inflight.phase = 'EXPIRED';
        inflight.updatedAt = timestamp;
        inflight.expiredAt = timestamp;
        await this.db.put(inflight);
      }
    },

    async cleanupExpiredState() {
      const timestamp = nowIso();
      const messages = await this.listDocsByPrefix('msg:');
      let expiredMessages = 0;
      let expiredInflight = 0;

      for (const message of messages) {
        if (!message.expiresAt || Date.parse(message.expiresAt) > Date.now()) {
          continue;
        }

        const inflight = await this.getDocOrNull(`inf:${message.messageId}`);
        const messageWasTerminal = isTerminalMessageState(message.state);
        const inflightWasActive = Boolean(
          inflight && inflight.state !== 'expired' && inflight.state !== 'completed'
        );

        await this.markMessageExpired(message, inflight, timestamp);

        if (!messageWasTerminal) {
          expiredMessages += 1;
        }
        if (inflightWasActive) {
          expiredInflight += 1;
        }
      }

      return {
        expiredMessages,
        expiredInflight,
      };
    },
  },
};
