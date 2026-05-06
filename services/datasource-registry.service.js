/**
 * Datasource Registry Service
 *
 * Stores and manages inhouse datasource definitions and dictionary versions.
 * Registry data is persisted to disk so definitions survive service restarts.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getSemanticDomainById, listSemanticDomains } = require('../src/semantic-domains');
const {
  applyCursorPagination,
  applyOffsetDeprecationHeader,
  buildFilterHash,
  resolveTenantId,
} = require('../src/pagination');

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  name: 'datasource-registry',

  settings: {
    defaultInferSampleRows: Number(process.env.DATASOURCE_MAX_INFER_SAMPLE_ROWS || 200),
    persistenceEnabled:
      process.env.DATASOURCE_REGISTRY_PERSISTENCE_ENABLED === undefined
        ? process.env.NODE_ENV !== 'test'
        : process.env.DATASOURCE_REGISTRY_PERSISTENCE_ENABLED !== 'false',
    persistenceFile:
      process.env.DATASOURCE_REGISTRY_FILE ||
      path.join(process.cwd(), 'uploads', '.datasource-registry.json'),
  },

  actions: {
    /**
     * Register a new datasource definition.
     */
    create: {
      rest: 'POST /datasources',
      params: {
        name: { type: 'string', min: 1 },
        description: { type: 'string', optional: true },
        connectorType: { type: 'string', min: 1 },
        connectorConfig: { type: 'object', optional: true },
        cachePolicy: { type: 'object', optional: true },
        dictionary: { type: 'object', optional: true },
        tags: { type: 'array', optional: true, items: 'string' },
      },
      openapi: {
        summary: 'Register a new inhouse datasource',
        tags: ['DataSources'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'connectorType'],
                properties: {
                  name: { type: 'string', example: 'Customer Master' },
                  description: { type: 'string', example: 'Main customer data table', default: '' },
                  connectorType: { type: 'string', example: 'csv' },
                  connectorConfig: {
                    type: 'object',
                    example: { filePath: '/data/customers.csv' },
                    default: {},
                  },
                  cachePolicy: {
                    type: 'object',
                    example: { mode: 'ttl', ttlSeconds: 3600 },
                    default: {},
                  },
                  dictionary: { type: 'object', example: {}, default: null },
                  tags: { type: 'array', items: { type: 'string' }, example: ['crm'], default: [] },
                },
              },
              examples: {
                csvSource: {
                  summary: 'Register a CSV datasource',
                  value: {
                    name: 'Customer Master',
                    connectorType: 'csv',
                    connectorConfig: { filePath: '/data/customers.csv' },
                    tags: ['crm'],
                  },
                },
                restSource: {
                  summary: 'Register a REST API datasource',
                  value: {
                    name: 'Live Prices',
                    connectorType: 'rest',
                    connectorConfig: { url: 'https://api.example.com/prices' },
                    cachePolicy: { mode: 'ttl', ttlSeconds: 900 },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const timestamp = nowIso();
        const sourceId = crypto.randomUUID();
        const dictionary = this.buildDictionary(ctx.params.dictionary, timestamp, 'manual');

        const record = {
          id: sourceId,
          name: ctx.params.name,
          description: ctx.params.description || '',
          connectorType: ctx.params.connectorType,
          connectorConfig: ctx.params.connectorConfig || {},
          cachePolicy: ctx.params.cachePolicy || { mode: 'ttl', ttlSeconds: 3600 },
          dictionary,
          semanticClassification: null,
          tags: ctx.params.tags || [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        this.registry.set(sourceId, record);
        this.dictionaryHistory.set(sourceId, [deepClone(dictionary)]);
        await this.persistState();

        this.broker.emit('datasource.registered', {
          sourceId,
          name: record.name,
          connectorType: record.connectorType,
        });

        return {
          success: true,
          data: deepClone(record),
        };
      },
    },

    /**
     * List all registered datasource definitions.
     */
    list: {
      rest: 'GET /datasources',
      params: {
        tag: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true, max: 200 },
        cursor: { type: 'string', optional: true },
        offset: { type: 'number', optional: true, convert: true, min: 0 },
      },
      openapi: {
        summary: 'List registered inhouse datasources',
        tags: ['DataSources'],
        parameters: [
          { name: 'tag', in: 'query', required: false, schema: { type: 'string', example: 'crm' } },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'number', default: 50, example: 50 },
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'eyJvZmZzZXQiOjUwfQ==' },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'number', minimum: 0, example: 0 },
          },
        ],
      },
      async handler(ctx) {
        let items = Array.from(this.registry.values()).map((item) => deepClone(item));

        if (ctx.params.tag) {
          const filterTag = ctx.params.tag.toLowerCase();
          items = items.filter((item) =>
            (item.tags || []).some((tag) => String(tag).toLowerCase() === filterTag)
          );
        }

        items.sort((a, b) => a.name.localeCompare(b.name));

        const normalized = items.map((item) => ({
          ...item,
          createdAt: item.createdAt || item.updatedAt || null,
        }));
        const tenantId = resolveTenantId(ctx);
        const filterHash = buildFilterHash({ tag: ctx.params.tag || null });
        const page = applyCursorPagination({
          items: normalized,
          limit: ctx.params.limit,
          cursor: ctx.params.cursor,
          offset: ctx.params.offset,
          tenantId,
          filterHash,
        });
        applyOffsetDeprecationHeader(ctx, ctx.params.offset != null);

        return {
          success: true,
          count: page.data.length,
          data: page.data,
          pageInfo: page.pageInfo,
        };
      },
    },

    /**
     * Get datasource definition by id.
     */
    get: {
      rest: 'GET /datasources/:id',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get datasource definition',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        return {
          success: true,
          data: deepClone(source),
        };
      },
    },

    /**
     * Update datasource definition (except dictionary content).
     */
    update: {
      rest: 'PUT /datasources/:id',
      params: {
        id: { type: 'string', min: 1 },
        name: { type: 'string', min: 1, optional: true },
        description: { type: 'string', optional: true },
        connectorType: { type: 'string', min: 1, optional: true },
        connectorConfig: { type: 'object', optional: true },
        cachePolicy: { type: 'object', optional: true },
        tags: { type: 'array', optional: true, items: 'string' },
      },
      openapi: {
        summary: 'Update datasource definition',
        tags: ['DataSources'],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        const changedKeys = [];

        const updatable = [
          'name',
          'description',
          'connectorType',
          'connectorConfig',
          'cachePolicy',
          'tags',
        ];

        for (const key of updatable) {
          if (ctx.params[key] !== undefined) {
            source[key] = deepClone(ctx.params[key]);
            changedKeys.push(key);
          }
        }

        source.updatedAt = nowIso();
        this.registry.set(source.id, source);
        await this.persistState();

        this.broker.emit('datasource.updated', {
          sourceId: source.id,
          changes: changedKeys,
        });

        return {
          success: true,
          data: deepClone(source),
          changes: changedKeys,
        };
      },
    },

    /**
     * Delete datasource definition and dictionary history.
     */
    remove: {
      rest: 'DELETE /datasources/:id',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Delete datasource',
        tags: ['DataSources'],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        this.registry.delete(source.id);
        this.dictionaryHistory.delete(source.id);
        await this.persistState();

        this.broker.emit('datasource.deleted', {
          sourceId: source.id,
        });

        return {
          success: true,
          deleted: true,
          sourceId: source.id,
        };
      },
    },

    /**
     * Get current data dictionary.
     */
    getDictionary: {
      rest: 'GET /datasources/:id/dictionary',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get current Data Dictionary',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        return {
          success: true,
          data: deepClone(source.dictionary),
        };
      },
    },

    /**
     * Replace dictionary and create new version.
     */
    updateDictionary: {
      rest: 'PUT /datasources/:id/dictionary',
      params: {
        id: { type: 'string', min: 1 },
        fields: {
          type: 'array',
          items: 'object',
        },
        updatedBy: { type: 'string', optional: true, default: 'manual' },
      },
      openapi: {
        summary: 'Replace Data Dictionary and increment version',
        tags: ['DataSources'],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        const previousVersion = source.dictionary.version;
        const timestamp = nowIso();

        const dictionary = {
          version: previousVersion + 1,
          fields: deepClone(ctx.params.fields),
          updatedAt: timestamp,
          updatedBy: ctx.params.updatedBy,
        };

        source.dictionary = dictionary;
        source.updatedAt = timestamp;
        this.registry.set(source.id, source);

        const history = this.dictionaryHistory.get(source.id) || [];
        history.push(deepClone(dictionary));
        this.dictionaryHistory.set(source.id, history);
        await this.persistState();

        this.broker.emit('datasource.dictionary.updated', {
          sourceId: source.id,
          version: dictionary.version,
          previousVersion,
        });

        return {
          success: true,
          data: deepClone(dictionary),
        };
      },
    },

    /**
     * List dictionary version history.
     */
    getDictionaryHistory: {
      rest: 'GET /datasources/:id/dictionary/history',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'List Data Dictionary history',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
      },
      async handler(ctx) {
        this.requireSource(ctx.params.id);
        const history = this.dictionaryHistory.get(ctx.params.id) || [];
        return {
          success: true,
          count: history.length,
          data: deepClone(history),
        };
      },
    },

    /**
     * Get dictionary by explicit version number.
     */
    getDictionaryVersion: {
      rest: 'GET /datasources/:id/dictionary/:version',
      params: {
        id: { type: 'string', min: 1 },
        version: { type: 'number', integer: true, min: 1, convert: true },
      },
      openapi: {
        summary: 'Get a specific Data Dictionary version',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
          { name: 'version', in: 'path', required: true, schema: { type: 'integer', example: 2 } },
        ],
      },
      async handler(ctx) {
        this.requireSource(ctx.params.id);
        const history = this.dictionaryHistory.get(ctx.params.id) || [];
        const dictionary = history.find((item) => item.version === ctx.params.version);

        if (!dictionary) {
          throw new Error(`Dictionary version not found: ${ctx.params.version}`);
        }

        return {
          success: true,
          data: deepClone(dictionary),
        };
      },
    },

    /**
     * Check whether a referenced dictionary version is still current.
     */
    checkDictionaryVersion: {
      rest: 'GET /datasources/:id/dictionary/check',
      params: {
        id: { type: 'string', min: 1 },
        referencedVersion: { type: 'number', integer: true, min: 1, convert: true },
      },
      openapi: {
        summary: 'Check whether a referenced Data Dictionary version is current',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
          {
            name: 'referencedVersion',
            in: 'query',
            required: true,
            schema: { type: 'integer', example: 1 },
          },
        ],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        const currentVersion = source?.dictionary?.version || 1;
        const referencedVersion = ctx.params.referencedVersion;
        const outdated = referencedVersion !== currentVersion;

        if (outdated) {
          this.broker.emit('datasource.dictionary.outdated', {
            sourceId: source.id,
            currentVersion,
            referencedVersion,
          });
        }

        return {
          success: true,
          sourceId: source.id,
          currentVersion,
          referencedVersion,
          isCurrent: !outdated,
          outdated,
        };
      },
    },

    /**
     * Get semantic classification for one datasource.
     */
    getClassification: {
      rest: 'GET /datasources/:id/classification',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get semantic datasource classification',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);

        return {
          success: true,
          sourceId: source.id,
          data: deepClone(source.semanticClassification),
          availableDomains: listSemanticDomains(),
        };
      },
    },

    /**
     * Persist semantic classification and merge semanticRole mappings into the dictionary.
     */
    updateClassification: {
      params: {
        id: { type: 'string', optional: true },
        sourceId: { type: 'string', optional: true },
        classification: { type: 'object', optional: true },
        fieldMappings: { type: 'object', optional: true },
        confirmedByUser: { type: 'boolean', optional: true, convert: true },
      },
      async handler(ctx) {
        const sourceId = ctx.params.sourceId || ctx.params.id;
        const source = this.requireSource(sourceId);
        const timestamp = nowIso();
        const incomingClassification = deepClone(ctx.params.classification || {});
        const existingClassification = deepClone(source.semanticClassification || {});
        const fieldMappings = {
          ...this.extractFieldMappings(existingClassification),
          ...(ctx.params.fieldMappings || incomingClassification.fieldMappings || {}),
        };

        const domainId =
          incomingClassification.domainId || existingClassification.domainId || 'unknown';
        const domain = getSemanticDomainById(domainId);
        const criticalFieldStatus = Array.isArray(incomingClassification.criticalFieldStatus)
          ? deepClone(incomingClassification.criticalFieldStatus)
          : Array.isArray(existingClassification.criticalFieldStatus)
            ? deepClone(existingClassification.criticalFieldStatus)
            : [];

        const mergedClassification = {
          ...existingClassification,
          ...incomingClassification,
          domainId,
          domainLabel:
            incomingClassification.domainLabel ||
            existingClassification.domainLabel ||
            domain?.label ||
            'Unknown Domain',
          fieldMappings,
          criticalFieldStatus: this.mergeCriticalFieldStatus(criticalFieldStatus, fieldMappings),
          confirmedByUser:
            ctx.params.confirmedByUser !== undefined
              ? ctx.params.confirmedByUser
              : incomingClassification.confirmedByUser === true ||
                existingClassification.confirmedByUser === true,
          resolvedAt: incomingClassification.resolvedAt || timestamp,
          updatedAt: timestamp,
        };

        mergedClassification.requiresUserInput =
          mergedClassification.requiresUserInput === true ||
          mergedClassification.domainId === 'unknown' ||
          mergedClassification.criticalFieldStatus.some((item) => !item.resolved);

        source.dictionary = {
          ...source.dictionary,
          fields: this.applyFieldMappings(source.dictionary?.fields || [], fieldMappings),
        };
        source.semanticClassification = mergedClassification;
        source.updatedAt = timestamp;
        this.registry.set(source.id, source);
        await this.persistState();

        this.broker.emit('datasource.classification.updated', {
          sourceId: source.id,
          domainId: mergedClassification.domainId,
          confirmedByUser: mergedClassification.confirmedByUser,
        });

        if (mergedClassification.confirmedByUser) {
          this.broker.emit('datasource.classification.confirmed', {
            sourceId: source.id,
            domainId: mergedClassification.domainId,
            fieldMappings,
          });
        }

        return {
          success: true,
          sourceId: source.id,
          data: deepClone(mergedClassification),
        };
      },
    },

    /**
     * Trigger schema inference draft.
     */
    infer: {
      rest: 'POST /datasources/:id/infer',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Trigger AI-assisted schema inference',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
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
                  summary: 'Trigger inference (no body required)',
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);
        const inferEventPayload = {
          sourceId: source.id,
          filename: source.connectorConfig?.path || source.connectorConfig?.filePath || null,
          description: source.description || null,
        };
        let result;

        try {
          const inferResult = await ctx.call('datasource-connector.inferSchema', {
            connectorType: source.connectorType,
            connectorConfig: source.connectorConfig || {},
            sampleRows: this.settings.defaultInferSampleRows,
          });

          const inferredFields = Array.isArray(inferResult?.inferredSchema?.fields)
            ? inferResult.inferredSchema.fields
            : [];

          const draftFields = inferredFields.map((field) => {
            const name = String(field.name || '').trim();
            const existing = (source.dictionary?.fields || []).find((item) => item.name === name);
            const suggestedPrivacy = this.suggestPrivacyFlag(name);

            return {
              name,
              type: field.type || existing?.type || 'string',
              description:
                existing?.description || `Auto-inferred field from ${source.connectorType} source`,
              privacyFlag: existing?.privacyFlag ?? suggestedPrivacy,
              example: field.example ?? existing?.example ?? null,
              syntheticPattern:
                existing?.syntheticPattern ||
                (suggestedPrivacy ? '{{const("REDACTED")}}' : undefined),
            };
          });

          const diff = this.computeDictionaryDiff(source.dictionary?.fields || [], draftFields);

          result = {
            success: true,
            status: 'draft',
            sourceId: source.id,
            sampledRowCount: inferResult.sampledRowCount || 0,
            dictionary: {
              version: source.dictionary?.version || 1,
              fields: draftFields,
              updatedAt: nowIso(),
              updatedBy: 'auto-infer',
            },
            diff,
          };
        } catch (error) {
          this.logger.warn(`Schema inference fallback for ${source.id}: ${error.message}`);

          result = {
            success: true,
            status: 'draft',
            sourceId: source.id,
            message:
              'Schema inference is currently unavailable; returning current dictionary as draft fallback.',
            dictionary: deepClone(source.dictionary),
            sampleLimit: this.settings.defaultInferSampleRows,
            warning: error.message,
          };
        } finally {
          this.broker.emit('datasource.inference.complete', inferEventPayload);
        }

        return result;
      },
    },

    /**
     * Trigger manual refresh event for datasource cache pipeline.
     */
    refresh: {
      rest: 'POST /datasources/:id/refresh',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Trigger datasource refresh',
        tags: ['DataSources'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', required: [], properties: {} },
              examples: { trigger: { summary: 'Trigger refresh (no body required)', value: {} } },
            },
          },
        },
      },
      async handler(ctx) {
        const source = this.requireSource(ctx.params.id);

        this.broker.emit('datasource.cache.refresh.requested', {
          sourceId: source.id,
          requestedAt: nowIso(),
          requestedBy: ctx.meta.userId || 'system',
        });

        return {
          success: true,
          sourceId: source.id,
          refreshRequested: true,
        };
      },
    },
  },

  methods: {
    requireSource(id) {
      const source = this.registry.get(id);
      if (!source) {
        throw new Error(`Datasource not found: ${id}`);
      }
      return source;
    },

    buildDictionary(input, updatedAt, updatedBy) {
      if (!input || typeof input !== 'object') {
        return {
          version: 1,
          fields: [],
          updatedAt,
          updatedBy,
        };
      }

      return {
        version: Number(input.version) > 0 ? Number(input.version) : 1,
        fields: Array.isArray(input.fields) ? deepClone(input.fields) : [],
        updatedAt: input.updatedAt || updatedAt,
        updatedBy: input.updatedBy || updatedBy,
      };
    },

    suggestPrivacyFlag(fieldName) {
      const n = String(fieldName || '').toLowerCase();
      const piiTokens = [
        'kunden',
        'name',
        'adresse',
        'email',
        'telefon',
        'phone',
        'iban',
        'konto',
        'person',
      ];

      return piiTokens.some((token) => n.includes(token));
    },

    computeDictionaryDiff(currentFields, draftFields) {
      const byName = (fields) => {
        const map = new Map();
        fields.forEach((field) => {
          if (field?.name) map.set(field.name, field);
        });
        return map;
      };

      const currentMap = byName(currentFields || []);
      const draftMap = byName(draftFields || []);

      const added = [];
      const removed = [];
      const typeChanges = [];

      for (const [name, draft] of draftMap.entries()) {
        if (!currentMap.has(name)) {
          added.push(name);
          continue;
        }

        const existing = currentMap.get(name);
        if ((existing?.type || 'string') !== (draft?.type || 'string')) {
          typeChanges.push({
            field: name,
            from: existing?.type || 'string',
            to: draft?.type || 'string',
          });
        }
      }

      for (const name of currentMap.keys()) {
        if (!draftMap.has(name)) removed.push(name);
      }

      return {
        added,
        removed,
        typeChanges,
      };
    },

    extractFieldMappings(classification) {
      if (!classification || typeof classification !== 'object') return {};
      if (classification.fieldMappings && typeof classification.fieldMappings === 'object') {
        return deepClone(classification.fieldMappings);
      }

      return (classification.criticalFieldStatus || []).reduce((acc, item) => {
        if (item?.resolved && item?.mappedColumn) {
          acc[item.fieldRole] = item.mappedColumn;
        }
        return acc;
      }, {});
    },

    mergeCriticalFieldStatus(existingStatus, fieldMappings) {
      const statusByRole = new Map(
        (existingStatus || []).map((item) => [item.fieldRole, deepClone(item)])
      );

      Object.entries(fieldMappings || {}).forEach(([fieldRole, mappedColumn]) => {
        const current = statusByRole.get(fieldRole) || {
          fieldRole,
          resolved: false,
          mappedColumn: null,
          candidates: [],
        };
        statusByRole.set(fieldRole, {
          ...current,
          resolved: Boolean(mappedColumn),
          mappedColumn: mappedColumn || null,
          candidates: Array.from(
            new Set([...(current.candidates || []), ...(mappedColumn ? [mappedColumn] : [])])
          ),
        });
      });

      return Array.from(statusByRole.values());
    },

    applyFieldMappings(fields, fieldMappings) {
      const nextFields = deepClone(fields || []);
      const mappedColumns = new Set(Object.values(fieldMappings || {}).filter(Boolean));

      return nextFields.map((field) => {
        const assignedRole = Object.entries(fieldMappings || {}).find(
          ([, columnName]) => columnName === field.name
        )?.[0];
        const hasMappedRole = mappedColumns.has(field.name);

        if (assignedRole) {
          return {
            ...field,
            semanticRole: assignedRole,
          };
        }

        if (hasMappedRole) {
          return field;
        }

        const fieldWasMapped = Object.keys(fieldMappings || {}).includes(field.semanticRole);
        if (fieldWasMapped) {
          const nextField = { ...field };
          delete nextField.semanticRole;
          return nextField;
        }

        return field;
      });
    },

    async loadState() {
      if (!this.settings.persistenceEnabled) {
        return;
      }

      let fileContent;
      try {
        fileContent = await fs.readFile(this.settings.persistenceFile, 'utf-8');
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn(`Failed to read datasource registry state: ${error.message}`);
        }
        return;
      }

      let state;
      try {
        state = JSON.parse(fileContent);
      } catch (error) {
        this.logger.warn(`Invalid datasource registry state JSON: ${error.message}`);
        return;
      }

      const items = Array.isArray(state?.registry) ? state.registry : [];
      const historyEntries = Array.isArray(state?.dictionaryHistory) ? state.dictionaryHistory : [];

      this.registry = new Map(
        items
          .filter((item) => item && typeof item.id === 'string' && item.id.length > 0)
          .map((item) => [item.id, item])
      );

      this.dictionaryHistory = new Map(
        historyEntries
          .filter((entry) => entry && typeof entry.sourceId === 'string')
          .map((entry) => [entry.sourceId, Array.isArray(entry.history) ? entry.history : []])
      );

      this.logger.info(
        `Loaded ${this.registry.size} datasource definitions from ${this.settings.persistenceFile}`
      );
    },

    async persistState() {
      if (!this.settings.persistenceEnabled) {
        return;
      }

      const state = {
        version: 1,
        updatedAt: nowIso(),
        registry: Array.from(this.registry.values()),
        dictionaryHistory: Array.from(this.dictionaryHistory.entries()).map(
          ([sourceId, history]) => ({
            sourceId,
            history,
          })
        ),
      };

      const targetFile = this.settings.persistenceFile;
      const targetDir = path.dirname(targetFile);
      const tempFile = `${targetFile}.tmp`;

      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(tempFile, targetFile);
    },
  },

  created() {
    this.registry = new Map();
    this.dictionaryHistory = new Map();
  },

  async started() {
    await this.loadState();
  },
};
