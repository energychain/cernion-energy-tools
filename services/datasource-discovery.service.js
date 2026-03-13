/**
 * Datasource Discovery Service
 *
 * Provides AI-ready descriptors for inhouse data sources.
 */

const path = require('path');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

/**
 * Extracts additional alias candidates from a datasource source object.
 * Derives aliases from the file path stem (e.g. "GW29_metering_2026.csv" → ["GW29", "metering", "2026"])
 * and from identifier-like tokens in the description (alphanumeric tokens that contain a digit).
 *
 * @param {object} source - Raw source object from datasource-registry
 * @returns {string[]} Array of additional alias candidates
 */
function extractAliases(source) {
  const candidates = new Set();

  // 1. File stem tokens from connectorConfig.path
  if (source.connectorConfig?.path) {
    const stem = path.basename(
      source.connectorConfig.path,
      path.extname(source.connectorConfig.path)
    );
    stem.split(/[_\-\s]+/).forEach((t) => {
      if (t.length >= 2) candidates.add(t);
    });
    candidates.add(stem);
  }

  // 2. Identifier tokens from description (contain a digit, length >= 2, e.g. "GW29", "2026")
  if (source.description) {
    source.description.split(/\s+/).forEach((t) => {
      const clean = t.replace(/[^a-zA-Z0-9]/g, '');
      if (clean.length >= 2 && /\d/.test(clean)) {
        candidates.add(clean);
      }
    });
  }

  return [...candidates].filter(Boolean);
}

module.exports = {
  name: 'datasource-discovery',

  actions: {
    list: {
      rest: 'GET /datasource-discovery',
      params: {},
      openapi: {
        summary: 'List discoverable inhouse datasource descriptors',
        tags: ['DataSources'],
      },
      async handler(ctx) {
        const descriptors = await this.buildDescriptors(ctx);
        return {
          success: true,
          count: descriptors.length,
          data: descriptors,
        };
      },
    },

    search: {
      rest: 'GET /datasource-discovery/search',
      params: {
        q: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Search discoverable inhouse datasource descriptors',
        tags: ['DataSources'],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', example: 'customer' } },
        ],
      },
      async handler(ctx) {
        const query = String(ctx.params.q || '').toLowerCase().trim();
        const descriptors = await this.buildDescriptors(ctx);

        const filtered = descriptors.filter((descriptor) => {
          const source = descriptor.__sourceMeta || {};
          const fields = source.dictionaryFields || [];
          const bag = [
            descriptor.sourceId,
            descriptor.name,
            descriptor.description,
            ...(descriptor.aliases || []),
            source.sourceName,
            source.sourceDescription,
            ...(source.tags || []),
            ...fields,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return bag.includes(query);
        });

        return {
          success: true,
          query: ctx.params.q,
          count: filtered.length,
          data: filtered,
        };
      },
    },

    descriptor: {
      rest: 'GET /datasource-discovery/:sourceId/descriptor',
      params: {
        sourceId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get AI descriptor for one datasource',
        tags: ['DataSources'],
        parameters: [
          { name: 'sourceId', in: 'path', required: true, schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000000' } },
        ],
      },
      async handler(ctx) {
        const descriptors = await this.buildDescriptors(ctx);
        const match = descriptors.find((item) => item.sourceId === ctx.params.sourceId);
        if (!match) {
          throw new Error(`Descriptor not found for source: ${ctx.params.sourceId}`);
        }

        return {
          success: true,
          data: match,
        };
      },
    },
  },

  events: {
    'datasource.cache.refreshed'() {
      this.descriptorCache = null;
    },
    'datasource.dictionary.updated'() {
      this.descriptorCache = null;
    },
    'datasource.dictionary.outdated'() {
      this.descriptorCache = null;
    },
    'datasource.updated'() {
      this.descriptorCache = null;
    },
    'datasource.deleted'() {
      this.descriptorCache = null;
    },
  },

  methods: {
    async buildDescriptors(ctx) {
      if (this.descriptorCache) {
        return deepClone(this.descriptorCache);
      }

      const listResponse = await ctx.call('datasource-registry.list', {});
      const sources = Array.isArray(listResponse?.data) ? listResponse.data : [];

      const descriptors = [];

      for (const source of sources) {
        const statusResponse = await ctx.call('datasource-cache.status', {
          sourceId: source.id,
        });

        const cacheExists = !!statusResponse?.exists;
        if (!cacheExists) continue;

        const dictionaryFields = (source?.dictionary?.fields || []).map((field) => field.name);
        const flaggedFields = (source?.dictionary?.fields || [])
          .filter((field) => field.privacyFlag)
          .map((field) => field.name);
        const semanticHints = this.inferSemanticHints(dictionaryFields);
        const fileAliases = extractAliases(source);
        const aliases = uniq([
          source.name,
          source.id,
          slugify(source.name || source.id),
          ...(source.tags || []),
          ...fileAliases,
        ]);

        const descriptor = {
          name: `inhouse__${slugify(source.name || source.id)}`,
          description: this.buildDescription(source, dictionaryFields),
          aliases,
          capabilities: semanticHints.capabilities,
          semanticHints: semanticHints.hints,
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'Optional field=value filter expression',
              },
              limit: {
                type: 'integer',
                default: 100,
              },
            },
          },
          source: 'inhouse',
          sourceId: source.id,
          cacheStatus: statusResponse?.stale ? 'stale' : 'fresh',
          lastRefreshed: statusResponse.lastRefreshed,
          privacyFlaggedFields: flaggedFields,
          __sourceMeta: {
            sourceName: source.name,
            sourceDescription: source.description,
            tags: source.tags || [],
            dictionaryFields,
            aliases,
            capabilities: semanticHints.capabilities,
            semanticHints: semanticHints.hints,
          },
        };

        descriptors.push(descriptor);
      }

      this.descriptorCache = descriptors;
      return deepClone(descriptors);
    },

    buildDescription(source, dictionaryFields) {
      const fieldsSnippet = dictionaryFields.length
        ? `Contains: ${dictionaryFields.join(', ')}.`
        : 'No Data Dictionary fields registered yet.';

      return `${source.name || 'Inhouse datasource'}. ${source.description || ''} ${fieldsSnippet}`
        .replace(/\s+/g, ' ')
        .trim();
    },

    inferSemanticHints(fields) {
      const normalized = (fields || []).map((f) => ({ raw: f, key: String(f || '').toLowerCase() }));

      const pick = (candidates) => {
        for (const f of normalized) {
          if (candidates.some((re) => re.test(f.key))) return f.raw;
        }
        return null;
      };

      const timeField = pick([/\bzeit\b/, /timestamp/, /datetime/, /datum/, /time/]);
      const consumptionPowerField = pick([
        /leistung\s*bezug/,
        /verbrauch.*leistung/,
        /consumption.*power/,
      ]);
      const feedInPowerField = pick([
        /leistung\s*einspeisung/,
        /einspeisung.*leistung/,
        /feed.?in.*power/,
      ]);
      const actualGenerationField = pick([
        /actual.*generation/,
        /ist.*erzeug/,
        /tats.*erzeug/,
        /generation/,
        /erzeugung/,
      ]);
      const installationMastrField = pick([/mastr/, /^see/, /^swe/, /^san/]);
      const messlokationField = pick([/messlokation/, /\bmelo\b/, /^de\d{10,}/]);

      const capabilities = ['timeseries'];
      if (timeField && (consumptionPowerField || feedInPowerField)) {
        capabilities.push('timeseries_cost_enrichment');
      }
      if (timeField && (actualGenerationField || feedInPowerField)) {
        capabilities.push('timeseries_compare_actual_vs_forecast');
        capabilities.push('timeseries_delta_analysis');
      }

      return {
        capabilities: uniq(capabilities),
        hints: {
          timeField,
          consumptionPowerField,
          feedInPowerField,
          actualGenerationField,
          installationMastrField,
          messlokationField,
        },
      };
    },
  },

  created() {
    this.descriptorCache = null;
  },
};
