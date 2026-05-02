/**
 * Datasource Cache Service
 *
 * In-memory cache scaffold for v0.9 with privacy processing and audit logging.
 * MongoDB persistence is implemented in follow-up CRs.
 */

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

const COL_LEISTUNG_BEZUG = 'Leistung Bezug (W)';
const COL_LEISTUNG_EINSPEISUNG = 'Leistung Einspeisung (W)';

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  name: 'datasource-cache',

  settings: {
    defaultPrivacyContext: process.env.DATASOURCE_DEFAULT_PRIVACY_CONTEXT || 'ai-agent',
  },

  actions: {
    /**
     * Query cached rows with privacy processing.
     */
    query: {
      rest: 'GET /datasource-cache/:sourceId',
      params: {
        sourceId: { type: 'string', min: 1 },
        limit: { type: 'number', integer: true, min: 1, optional: true, convert: true },
        offset: { type: 'number', integer: true, min: 0, optional: true, convert: true },
        includeCost: { type: 'boolean', optional: true, convert: true },
        priceCentPerKWh: { type: 'number', min: 0, optional: true, convert: true },
        intervalMinutes: { type: 'number', integer: true, min: 1, optional: true, convert: true },
        consumptionPowerField: { type: 'string', optional: true },
        feedInPowerField: { type: 'string', optional: true },
        privacyContext: {
          type: 'enum',
          values: ['internal', 'ai-agent', 'public'],
          optional: true,
        },
      },
      openapi: {
        summary: 'Query cached datasource rows',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, example: 50 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 0, example: 0 },
          },
          {
            name: 'includeCost',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false, example: true },
          },
          {
            name: 'priceCentPerKWh',
            in: 'query',
            required: false,
            schema: { type: 'number', default: 40, example: 38.5 },
          },
          {
            name: 'intervalMinutes',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 15, example: 15 },
          },
          {
            name: 'consumptionPowerField',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              default: COL_LEISTUNG_BEZUG,
              example: COL_LEISTUNG_BEZUG,
            },
          },
          {
            name: 'feedInPowerField',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              default: COL_LEISTUNG_EINSPEISUNG,
              example: COL_LEISTUNG_EINSPEISUNG,
            },
          },
          {
            name: 'privacyContext',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['internal', 'ai-agent', 'public'],
              default: 'ai-agent',
              example: 'ai-agent',
            },
          },
        ],
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId;
        const entry = this.cacheBySource.get(sourceId);
        if (!entry) {
          throw new Error(`Cache not found for source: ${sourceId}`);
        }

        const limit = ctx.params.limit || 100;
        const offset = ctx.params.offset || 0;
        const privacyContext =
          ctx.params.privacyContext ||
          ctx.meta.privacyContext ||
          this.settings.defaultPrivacyContext;
        const includeCost = ctx.params.includeCost === true;
        const priceCentPerKWh = toNumber(ctx.params.priceCentPerKWh, 40);
        const intervalMinutes = toNumber(ctx.params.intervalMinutes, 15);
        const consumptionPowerField = ctx.params.consumptionPowerField || COL_LEISTUNG_BEZUG;
        const feedInPowerField = ctx.params.feedInPowerField || COL_LEISTUNG_EINSPEISUNG;

        const windowRows = entry.rows.slice(offset, offset + limit);
        const prepared = this.applyPrivacyContext(windowRows, entry.dictionary, privacyContext);
        const outputRows = includeCost
          ? this.addMeteringCost(prepared.rows, {
              priceCentPerKWh,
              intervalMinutes,
              consumptionPowerField,
              feedInPowerField,
            })
          : prepared.rows;

        if (prepared.substitutedFieldCount > 0) {
          const logEntry = {
            sourceId,
            requestingService: ctx.service?.name || 'unknown',
            privacyContext,
            substitutedFieldCount: prepared.substitutedFieldCount,
            timestamp: nowIso(),
          };

          if (!this.auditLogBySource.has(sourceId)) {
            this.auditLogBySource.set(sourceId, []);
          }
          this.auditLogBySource.get(sourceId).push(logEntry);
        }

        return {
          success: true,
          sourceId,
          privacyContext,
          count: outputRows.length,
          totalRows: entry.rows.length,
          data: outputRows,
        };
      },
    },

    /**
     * Get cache metadata and status.
     */
    status: {
      rest: 'GET /datasource-cache/:sourceId/status',
      params: {
        sourceId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get datasource cache status',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId;
        const entry = this.cacheBySource.get(sourceId);

        if (!entry) {
          return {
            success: true,
            sourceId,
            exists: false,
            stale: true,
            rowCount: 0,
          };
        }

        const stale = this.isEntryStale(entry);

        if (stale) {
          this.broker.emit('datasource.cache.stale', {
            sourceId,
            lastRefreshed: entry.lastRefreshed,
            ttlSeconds: entry.ttlSeconds,
          });
        }

        return {
          success: true,
          sourceId,
          exists: true,
          stale,
          rowCount: entry.rows.length,
          ttlSeconds: entry.ttlSeconds,
          mode: entry.mode,
          lastRefreshed: entry.lastRefreshed,
        };
      },
    },

    /**
     * Invalidate cache entry for source.
     */
    invalidate: {
      rest: 'DELETE /datasource-cache/:sourceId',
      params: {
        sourceId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Invalidate datasource cache',
        tags: ['DataSources'],
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId;
        const existed = this.cacheBySource.has(sourceId);
        this.cacheBySource.delete(sourceId);
        this.auditLogBySource.delete(sourceId);

        return {
          success: true,
          sourceId,
          invalidated: existed,
        };
      },
    },

    /**
     * Get DSGVO audit trail for synthetic substitutions.
     */
    audit: {
      rest: 'GET /datasource-cache/:sourceId/audit',
      params: {
        sourceId: { type: 'string', min: 1 },
        limit: { type: 'number', integer: true, min: 1, optional: true, convert: true },
      },
      openapi: {
        summary: 'Get datasource privacy substitution audit log',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, example: 50 },
          },
        ],
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId;
        const allEntries = this.auditLogBySource.get(sourceId) || [];
        const limit = ctx.params.limit || 100;

        return {
          success: true,
          sourceId,
          count: Math.min(limit, allEntries.length),
          data: deepClone(allEntries.slice(-limit).reverse()),
        };
      },
    },

    /**
     * Refresh cache by reading source via datasource-registry + datasource-connector.
     */
    refresh: {
      rest: 'POST /datasource-cache/:sourceId/refresh',
      params: {
        sourceId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Refresh datasource cache entry',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'sourceId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [],
                properties: {},
              },
              examples: {
                trigger: {
                  summary: 'Trigger cache refresh (no body required)',
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId;
        const startedAt = Date.now();

        try {
          const sourceResponse = await ctx.call('datasource-registry.get', { id: sourceId });
          const source = sourceResponse?.data;
          if (!source) {
            throw new Error(`Datasource not found in registry: ${sourceId}`);
          }

          const readResult = await ctx.call('datasource-connector.read', {
            sourceId,
            connectorType: source.connectorType,
            connectorConfig: source.connectorConfig || {},
            options: {},
          });

          const rows = Array.isArray(readResult.rows) ? readResult.rows : [];
          const ttlSeconds = toNumber(source?.cachePolicy?.ttlSeconds, 3600);
          const mode = source?.cachePolicy?.mode || 'ttl';

          const entry = {
            sourceId,
            rows,
            inferredSchema: deepClone(readResult.inferredSchema || { fields: [] }),
            dictionary: deepClone(source.dictionary || { fields: [] }),
            ttlSeconds,
            mode,
            lastRefreshed: nowIso(),
          };

          this.cacheBySource.set(sourceId, entry);

          this.broker.emit('datasource.cache.refreshed', {
            sourceId,
            rowCount: rows.length,
            durationMs: Date.now() - startedAt,
          });

          return {
            success: true,
            sourceId,
            rowCount: rows.length,
            lastRefreshed: entry.lastRefreshed,
          };
        } catch (error) {
          this.broker.emit('datasource.cache.refresh.failed', {
            sourceId,
            error: error.message,
          });
          throw error;
        }
      },
    },
  },

  events: {
    async 'datasource.cache.refresh.requested'(payload) {
      if (!payload?.sourceId) return;
      try {
        await this.broker.call('datasource-cache.refresh', { sourceId: payload.sourceId });
      } catch (error) {
        this.logger.warn(`Refresh request failed for ${payload.sourceId}: ${error.message}`);
      }
    },
  },

  methods: {
    isEntryStale(entry) {
      if (!entry || !entry.lastRefreshed) return true;
      if (!entry.ttlSeconds || entry.mode === 'manual') return false;

      const ageMs = Date.now() - new Date(entry.lastRefreshed).getTime();
      return ageMs > entry.ttlSeconds * 1000;
    },

    applyPrivacyContext(rows, dictionary, privacyContext) {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { rows: [], substitutedFieldCount: 0 };
      }

      if (privacyContext === 'internal') {
        return {
          rows: deepClone(rows),
          substitutedFieldCount: 0,
        };
      }

      const flaggedFields = (dictionary?.fields || [])
        .filter((field) => field.privacyFlag)
        .map((field) => ({
          name: field.name,
          syntheticPattern: field.syntheticPattern,
          type: field.type,
        }));

      if (!flaggedFields.length) {
        return {
          rows: deepClone(rows),
          substitutedFieldCount: 0,
        };
      }

      const outputRows = [];
      let substitutedFieldCount = 0;

      rows.forEach((row) => {
        const copy = { ...row };

        flaggedFields.forEach((flagged) => {
          if (!Object.prototype.hasOwnProperty.call(copy, flagged.name)) return;

          if (privacyContext === 'public') {
            delete copy[flagged.name];
            substitutedFieldCount += 1;
            return;
          }

          if (privacyContext === 'ai-agent') {
            copy[flagged.name] = this.generateSyntheticValue(
              flagged.syntheticPattern,
              flagged.type,
              copy[flagged.name]
            );
            substitutedFieldCount += 1;
          }
        });

        outputRows.push(copy);
      });

      return {
        rows: outputRows,
        substitutedFieldCount,
      };
    },

    generateSyntheticValue(pattern, type, fallbackValue) {
      if (pattern && typeof pattern === 'string') {
        if (pattern.includes('{{const(')) {
          const match = pattern.match(/\{\{const\("(.+)"\)\}\}/);
          if (match) return match[1];
        }

        if (pattern.includes('{{random.numeric(')) {
          const digitsMatch = pattern.match(/random\.numeric\((\d+)\)/);
          const digits = digitsMatch ? Number(digitsMatch[1]) : 8;
          let out = '';
          for (let i = 0; i < digits; i++) {
            out += Math.floor(Math.random() * 10);
          }
          return out;
        }

        if (pattern.includes('{{random.alphanumeric(')) {
          const sizeMatch = pattern.match(/random\.alphanumeric\((\d+)\)/);
          const size = sizeMatch ? Number(sizeMatch[1]) : 6;
          const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let out = '';
          for (let i = 0; i < size; i++) {
            out += alphabet[Math.floor(Math.random() * alphabet.length)];
          }
          return out;
        }

        if (pattern.includes('{{faker.email}}')) return 'redacted@example.de';
        if (pattern.includes('{{faker.name}}')) return 'Max Mustermann';
        if (pattern.includes('{{faker.iban.de}}')) return 'DE89370400440532013000';
      }

      if (type === 'number' || type === 'integer') return 0;
      if (type === 'boolean') return false;
      if (fallbackValue === null || fallbackValue === undefined) return 'REDACTED';
      return 'REDACTED';
    },

    parseNumericValue(rawValue) {
      if (typeof rawValue === 'number') return Number.isFinite(rawValue) ? rawValue : NaN;
      if (rawValue === null || rawValue === undefined) return NaN;

      const normalized = String(rawValue).trim().replace(/\s+/g, '').replace(',', '.');
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : NaN;
    },

    addMeteringCost(rows, options) {
      const priceCentPerKWh = Math.max(0, toNumber(options?.priceCentPerKWh, 40));
      const intervalMinutes = Math.max(1, toNumber(options?.intervalMinutes, 15));
      const consumptionPowerField = options?.consumptionPowerField || COL_LEISTUNG_BEZUG;
      const feedInPowerField = options?.feedInPowerField || COL_LEISTUNG_EINSPEISUNG;

      const intervalHours = intervalMinutes / 60;

      return (rows || []).map((row) => {
        const consumptionW = this.parseNumericValue(row?.[consumptionPowerField]);
        const feedInW = this.parseNumericValue(row?.[feedInPowerField]);
        const netPowerW = Number.isFinite(consumptionW)
          ? Math.max(0, consumptionW - (Number.isFinite(feedInW) ? feedInW : 0))
          : 0;
        const intervalEnergyKWh = (netPowerW / 1000) * intervalHours;
        const intervalCostEur = (intervalEnergyKWh * priceCentPerKWh) / 100;

        return {
          ...row,
          netPowerW,
          intervalEnergyKWh: Number(intervalEnergyKWh.toFixed(6)),
          intervalCostEur: Number(intervalCostEur.toFixed(6)),
        };
      });
    },
  },

  created() {
    this.cacheBySource = new Map();
    this.auditLogBySource = new Map();
  },
};
