/**
 * Datasource Connector Service
 *
 * Loads connector plugins and executes normalized datasource reads.
 */

const fs = require('fs');
const path = require('path');

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function inferPrimitiveType(value) {
  if (value === null || value === undefined || value === '') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  const stringValue = String(value).trim();
  if (/^(true|false)$/i.test(stringValue)) return 'boolean';
  if (/^-?\d+$/.test(stringValue)) return 'integer';
  if (/^-?\d+\.\d+$/.test(stringValue)) return 'number';
  return 'string';
}

function buildInferredSchema(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { fields: [] };
  }

  const sample = rows.slice(0, 200);
  const fieldNames = new Set();
  sample.forEach((row) => {
    Object.keys(row || {}).forEach((key) => fieldNames.add(key));
  });

  const fields = Array.from(fieldNames).map((name) => {
    const values = sample.map((row) => row?.[name]).filter((value) => value !== undefined);
    const typeVotes = new Map();

    values.forEach((value) => {
      const type = inferPrimitiveType(value);
      typeVotes.set(type, (typeVotes.get(type) || 0) + 1);
    });

    let inferredType = 'string';
    let maxVotes = -1;
    for (const [type, votes] of typeVotes.entries()) {
      if (votes > maxVotes) {
        inferredType = type;
        maxVotes = votes;
      }
    }

    return {
      name,
      type: inferredType,
      example: values.length > 0 ? values[0] : null,
    };
  });

  return { fields };
}

module.exports = {
  name: 'datasource-connector',

  settings: {
    builtInPluginsDir: process.env.DATASOURCE_CONNECTOR_PLUGINS_DIR || 'src/connectors',
    customPluginsDir: process.env.DATASOURCE_CUSTOM_PLUGINS_DIR || 'custom-connectors',
    inferSampleRows: Number(process.env.DATASOURCE_MAX_INFER_SAMPLE_ROWS || 200),
  },

  actions: {
    listPlugins: {
      rest: 'GET /connector-types',
      openapi: {
        summary: 'List available connector plugin types',
        description:
          'Returns all loaded connector plugins with their type identifier, description, and JSON Schema for connectorConfig validation. Used by the UI to dynamically render the connector configuration form.',
        tags: ['DataSources'],
        responses: {
          200: {
            description: 'List of available connector plugins',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'integer', example: 6 },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', example: 'csv' },
                          description: {
                            type: 'string',
                            example: 'Read rows from a CSV or TSV file',
                          },
                          configSchema: { type: 'object' },
                          source: { type: 'string', example: 'built-in' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      params: {},
      async handler() {
        const plugins = Array.from(this.plugins.values()).map((plugin) => ({
          type: plugin.type,
          description: plugin.description || '',
          configSchema: deepClone(plugin.configSchema || {}),
          source: plugin.__source || 'unknown',
        }));

        plugins.sort((a, b) => a.type.localeCompare(b.type));

        return {
          success: true,
          count: plugins.length,
          data: plugins,
        };
      },
    },

    validateConfig: {
      params: {
        connectorType: { type: 'string', min: 1 },
        connectorConfig: { type: 'object' },
      },
      async handler(ctx) {
        const plugin = this.requirePlugin(ctx.params.connectorType);
        const validation = this.validateAgainstSchema(
          plugin.configSchema,
          ctx.params.connectorConfig
        );

        return {
          success: validation.valid,
          valid: validation.valid,
          errors: validation.errors,
          connectorType: plugin.type,
        };
      },
    },

    read: {
      params: {
        sourceId: { type: 'string', optional: true },
        connectorType: { type: 'string', min: 1 },
        connectorConfig: { type: 'object' },
        options: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const plugin = this.requirePlugin(ctx.params.connectorType);
        const validation = this.validateAgainstSchema(
          plugin.configSchema,
          ctx.params.connectorConfig
        );

        if (!validation.valid) {
          const error = new Error(`Invalid connector config: ${validation.errors.join('; ')}`);
          error.code = 'CONNECTOR_CONFIG_INVALID';
          throw error;
        }

        const startedAt = Date.now();
        const result = await plugin.read(ctx.params.connectorConfig, ctx.params.options || {});
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        const inferredSchema = result?.inferredSchema || buildInferredSchema(rows);

        return {
          success: true,
          sourceId: ctx.params.sourceId || null,
          connectorType: plugin.type,
          rows,
          inferredSchema,
          readAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
        };
      },
    },

    inferSchema: {
      params: {
        connectorType: { type: 'string', min: 1 },
        connectorConfig: { type: 'object' },
        sampleRows: { type: 'number', integer: true, min: 1, optional: true, convert: true },
      },
      async handler(ctx) {
        const sampleRows = ctx.params.sampleRows || this.settings.inferSampleRows;

        const readResult = await ctx.call('datasource-connector.read', {
          connectorType: ctx.params.connectorType,
          connectorConfig: ctx.params.connectorConfig,
          options: {
            limit: sampleRows,
            inferOnly: true,
          },
        });

        return {
          success: true,
          connectorType: ctx.params.connectorType,
          inferredSchema: readResult.inferredSchema,
          sampledRowCount: Array.isArray(readResult.rows) ? readResult.rows.length : 0,
        };
      },
    },
  },

  methods: {
    loadPluginsFromDirectory(baseDir, sourceLabel) {
      const loadedPlugins = [];
      if (!fs.existsSync(baseDir)) return loadedPlugins;

      const files = fs.readdirSync(baseDir).filter((entry) => entry.endsWith('.connector.js'));
      for (const file of files) {
        const fullPath = path.join(baseDir, file);
        const plugin = require(fullPath);

        if (!plugin || typeof plugin !== 'object') {
          this.logger.warn(`Skipping invalid connector plugin (not an object): ${fullPath}`);
          continue;
        }
        if (!plugin.type || typeof plugin.type !== 'string') {
          this.logger.warn(`Skipping connector plugin without valid type: ${fullPath}`);
          continue;
        }
        if (typeof plugin.read !== 'function') {
          this.logger.warn(`Skipping connector plugin without read() function: ${fullPath}`);
          continue;
        }

        const normalizedPlugin = {
          ...plugin,
          __filePath: fullPath,
          __source: sourceLabel,
        };

        this.plugins.set(plugin.type, normalizedPlugin);
        loadedPlugins.push(plugin.type);
      }

      return loadedPlugins;
    },

    reloadPlugins() {
      this.plugins = new Map();

      const rootDir = path.join(__dirname, '..');
      const builtInPath = path.resolve(rootDir, this.settings.builtInPluginsDir);
      const customPath = path.resolve(rootDir, this.settings.customPluginsDir);

      const builtInLoaded = this.loadPluginsFromDirectory(builtInPath, 'built-in');
      const customLoaded = this.loadPluginsFromDirectory(customPath, 'custom');

      this.logger.info(
        `Datasource connector plugins loaded: ${this.plugins.size} total ` +
          `(built-in: ${builtInLoaded.length}, custom: ${customLoaded.length})`
      );
    },

    requirePlugin(connectorType) {
      const plugin = this.plugins.get(connectorType);
      if (!plugin) {
        const available = Array.from(this.plugins.keys()).sort().join(', ');
        throw new Error(
          `Connector plugin not found: ${connectorType}. Available plugins: ${available || 'none'}`
        );
      }
      return plugin;
    },

    validateAgainstSchema(schema, value) {
      const errors = [];
      const cfg = value && typeof value === 'object' ? value : {};
      const targetSchema = schema && typeof schema === 'object' ? schema : {};

      if (targetSchema.required && Array.isArray(targetSchema.required)) {
        targetSchema.required.forEach((field) => {
          if (cfg[field] === undefined || cfg[field] === null || cfg[field] === '') {
            errors.push(`Missing required field: ${field}`);
          }
        });
      }

      if (targetSchema.properties && typeof targetSchema.properties === 'object') {
        for (const [fieldName, fieldSchema] of Object.entries(targetSchema.properties)) {
          const fieldValue = cfg[fieldName];
          if (fieldValue === undefined || fieldValue === null) continue;

          if (fieldSchema.enum && Array.isArray(fieldSchema.enum) && !fieldSchema.enum.includes(fieldValue)) {
            errors.push(
              `Invalid value for ${fieldName}: expected one of [${fieldSchema.enum.join(', ')}]`
            );
          }

          if (fieldSchema.type) {
            const actualType = Array.isArray(fieldValue) ? 'array' : typeof fieldValue;
            const expected = fieldSchema.type;
            const typeOk =
              expected === actualType ||
              (expected === 'number' && actualType === 'number') ||
              (expected === 'integer' && Number.isInteger(fieldValue));

            if (!typeOk) {
              errors.push(
                `Invalid type for ${fieldName}: expected ${expected}, received ${actualType}`
              );
              continue;
            }
          }

          if (typeof fieldValue === 'number' && typeof fieldSchema.minimum === 'number' && fieldValue < fieldSchema.minimum) {
            errors.push(`Invalid value for ${fieldName}: expected >= ${fieldSchema.minimum}`);
          }

          if (typeof fieldValue === 'number' && typeof fieldSchema.maximum === 'number' && fieldValue > fieldSchema.maximum) {
            errors.push(`Invalid value for ${fieldName}: expected <= ${fieldSchema.maximum}`);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    },
  },

  created() {
    this.plugins = new Map();
  },

  started() {
    this.reloadPlugins();
  },
};
