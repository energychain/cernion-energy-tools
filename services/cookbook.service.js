'use strict';

/**
 * Cookbook Service (v0.20.5)
 *
 * Community-maintained recipe catalogue for reusable API workflows.
 * Recipes are code-managed (src/cookbook-recipes.js) and enriched at runtime with:
 *  - semantic embeddings (gemini-embedding-001)
 *  - auto-generated relatedRecipes links
 *  - periodic validity checks against live Moleculer action registry
 */

const { COOKBOOK_RECIPES, COOKBOOK_RECIPE_SCHEMA } = require('../src/cookbook-recipes');
const {
  EMBEDDING_MODEL,
  buildSearchText,
  computeEmbedding,
  cosineSimilarity,
  keywordScore,
} = require('../src/cookbook-embeddings');
const { MoleculerClientError } = require('moleculer').Errors;

const OEO_CLASS_KEY = 'x-oeo-class';
const OEO_CLASS_URL = 'https://openenergyplatform.org/ontology/oeo/OEO_00000143';

function cloneRecipe(recipe) {
  return JSON.parse(JSON.stringify(recipe));
}

function normalizeRest(rest) {
  if (!rest) return '';
  return String(rest).trim().replace(/\s+/g, ' ').toUpperCase();
}

function toActionRestString(action) {
  if (!action || !action.rest) return '';
  if (typeof action.rest === 'string') return action.rest;
  if (typeof action.rest === 'object') {
    return `${action.rest.method || 'GET'} ${action.rest.path || ''}`.trim();
  }
  return '';
}

module.exports = {
  name: 'cookbook',

  settings: {
    validationIntervalMs: Number(process.env.COOKBOOK_VALIDATION_INTERVAL_MS || 300000),
    relatedLimit: Number(process.env.COOKBOOK_RELATED_LIMIT || 3),
    relatedMinScore: Number(process.env.COOKBOOK_RELATED_MIN_SCORE || 0.72),
  },

  created() {
    this.recipes = [];
    this.lastValidatedAt = null;
    this.validationSummary = {
      total: 0,
      valid: 0,
      degraded: 0,
      broken: 0,
      deprecated: 0,
    };
    this.validationTimer = null;
  },

  async started() {
    await this.reloadRecipes();

    this.validationTimer = setInterval(() => {
      this.validateAllRecipes().catch((err) => {
        this.logger.warn(`[cookbook] scheduled validation failed: ${err.message}`);
      });
    }, this.settings.validationIntervalMs);

    this.logger.info(
      `[cookbook] loaded ${this.recipes.length} recipes (embedding model: ${EMBEDDING_MODEL})`
    );
  },

  async stopped() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
  },

  actions: {
    list: {
      rest: 'GET /',
      params: {
        domain: { type: 'string', optional: true },
        tag: { type: 'string', optional: true },
        status: {
          type: 'string',
          optional: true,
          values: ['valid', 'degraded', 'broken', 'deprecated'],
        },
      },
      openapi: {
        summary: 'List cookbook recipes',
        tags: ['Cookbook'],
        description:
          'Returns all cookbook recipes with runtime metadata (status, relatedRecipes, validation timestamps).',
        [OEO_CLASS_KEY]: [OEO_CLASS_URL],
        parameters: [
          {
            name: 'domain',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'grid-operations' },
            description: 'Filter by recipe domain (exact, case-insensitive).',
          },
          {
            name: 'tag',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'mastr' },
            description: 'Filter by tag (case-insensitive, any-of match).',
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['valid', 'degraded', 'broken', 'deprecated'],
              example: 'valid',
            },
            description: 'Filter by runtime validation status.',
          },
        ],
      },
      async handler(ctx) {
        const { domain, tag, status } = ctx.params;
        let rows = this.recipes.map((recipe) => this.sanitizeRecipe(recipe));

        if (domain) {
          const d = domain.toLowerCase();
          rows = rows.filter((row) => String(row.domain || '').toLowerCase() === d);
        }
        if (tag) {
          const t = tag.toLowerCase();
          rows = rows.filter(
            (row) => Array.isArray(row.tags) && row.tags.some((x) => String(x).toLowerCase() === t)
          );
        }
        if (status) {
          rows = rows.filter((row) => row.status === status);
        }

        return {
          success: true,
          data: rows,
          metadata: {
            count: rows.length,
            lastValidatedAt: this.lastValidatedAt,
            validationSummary: this.validationSummary,
          },
        };
      },
    },

    get: {
      rest: 'GET /:id',
      params: {
        id: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get a single cookbook recipe',
        tags: ['Cookbook'],
        description: 'Returns one recipe by id including validation status and related recipes.',
        [OEO_CLASS_KEY]: [OEO_CLASS_URL],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'vnb-assets-from-name' },
            description: 'Unique recipe identifier.',
          },
        ],
      },
      async handler(ctx) {
        const recipe = this.recipes.find((row) => row.id === ctx.params.id);
        if (!recipe) {
          throw new MoleculerClientError(
            `Recipe not found: ${ctx.params.id}`,
            404,
            'COOKBOOK_RECIPE_NOT_FOUND',
            { id: ctx.params.id }
          );
        }
        return {
          success: true,
          data: this.sanitizeRecipe(recipe),
        };
      },
    },

    search: {
      rest: 'POST /search',
      params: {
        query: { type: 'string', min: 5 },
        limit: {
          type: 'number',
          integer: true,
          min: 1,
          max: 20,
          optional: true,
          default: 5,
          convert: true,
        },
        includeBroken: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Semantic recipe lookup',
        tags: ['Cookbook'],
        description:
          'Finds best-matching cookbook recipes for a free-text implementation problem using Gemini embeddings with keyword fallback.',
        [OEO_CLASS_KEY]: [OEO_CLASS_URL],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: {
                    type: 'string',
                    minLength: 5,
                    example: 'How do I look up a grid operator and list its MaStR assets?',
                  },
                  limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
                  includeBroken: { type: 'boolean', default: false },
                },
              },
              examples: {
                vnbLookup: {
                  summary: 'Find recipes for grid operator asset lookup',
                  value: { query: 'How do I find assets for a named grid operator?' },
                },
                validationAgent: {
                  summary: 'Find a validation agent workflow',
                  value: {
                    query: 'redispatch settlement audit risk assessment',
                    includeBroken: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { query, limit, includeBroken } = ctx.params;
        const hits = await this.searchRecipes(query, { limit, includeBroken });
        return {
          success: true,
          data: hits,
          metadata: {
            model: EMBEDDING_MODEL,
            lastValidatedAt: this.lastValidatedAt,
          },
        };
      },
    },

    validate: {
      rest: 'POST /validate',
      openapi: {
        summary: 'Force cookbook validity check',
        tags: ['Cookbook'],
        description:
          'Re-validates all recipes against the live action registry and refreshes runtime statuses.',
        [OEO_CLASS_KEY]: [OEO_CLASS_URL],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: {} },
              examples: {
                default: {
                  summary: 'Trigger a forced re-validation',
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler() {
        const summary = await this.validateAllRecipes();
        return {
          success: true,
          data: summary,
        };
      },
    },

    health: {
      rest: 'GET /health',
      openapi: {
        summary: 'Cookbook service health',
        tags: ['Cookbook'],
        description: 'Returns recipe counts and latest validation timestamp.',
        [OEO_CLASS_KEY]: [OEO_CLASS_URL],
      },
      async handler() {
        return {
          success: true,
          data: {
            total: this.recipes.length,
            model: EMBEDDING_MODEL,
            lastValidatedAt: this.lastValidatedAt,
            validationSummary: this.validationSummary,
            validationIntervalMs: this.settings.validationIntervalMs,
          },
        };
      },
    },

    serviceCatalogue: {
      rest: 'GET /services',
      openapi: {
        summary: 'Live service/action catalogue for recipe generator UI',
        tags: ['Cookbook'],
        description: 'Returns all REST-exposed actions from the live Moleculer registry.',
        [OEO_CLASS_KEY]: [OEO_CLASS_URL],
      },
      async handler() {
        const actions = this.getActionRegistry();
        return {
          success: true,
          data: Object.values(actions).sort((a, b) => a.action.localeCompare(b.action)),
        };
      },
    },
  },

  methods: {
    sanitizeRecipe(recipe) {
      const publicRecipe = { ...recipe };
      delete publicRecipe._embedding;
      delete publicRecipe._searchText;
      delete publicRecipe._validation;

      return {
        ...publicRecipe,
        relatedRecipes: Array.isArray(recipe.relatedRecipes) ? recipe.relatedRecipes : [],
        status: recipe.status || 'valid',
        validation: recipe._validation || { errors: [], warnings: [] },
      };
    },

    validateRecipeShape(recipe) {
      const errors = [];

      if (!recipe || typeof recipe !== 'object') errors.push('Recipe must be an object');
      if (!recipe.id) errors.push('Recipe id is required');
      if (!recipe.title) errors.push('Recipe title is required');
      if (!Array.isArray(recipe.process) || recipe.process.length === 0) {
        errors.push('Recipe process must have at least one step');
      }

      return {
        ok: errors.length === 0,
        errors,
      };
    },

    getActionRegistry() {
      const services = this.broker.registry.getServiceList({ withActions: true });
      const map = {};

      for (const service of services) {
        if (!service?.actions) continue;

        for (const actionName of Object.keys(service.actions)) {
          const action = service.actions[actionName];
          const shortName = actionName.includes('.') ? actionName.split('.').pop() : actionName;
          const fullName = `${service.name}.${shortName}`;
          const rest = toActionRestString(action);

          map[fullName] = {
            service: service.name,
            action: fullName,
            rest,
            params: action.params || null,
          };
        }
      }

      return map;
    },

    async reloadRecipes() {
      const normalized = [];

      for (const raw of COOKBOOK_RECIPES) {
        const recipe = cloneRecipe(raw);
        const shapeResult = this.validateRecipeShape(recipe, COOKBOOK_RECIPE_SCHEMA);
        if (!shapeResult.ok) {
          this.logger.warn(
            `[cookbook] invalid recipe ${recipe?.id || 'unknown'}: ${shapeResult.errors.join('; ')}`
          );
          continue;
        }

        recipe._searchText = buildSearchText(recipe);

        try {
          recipe._embedding = await computeEmbedding(recipe._searchText);
        } catch (err) {
          recipe._embedding = null;
          this.logger.warn(`[cookbook] embedding failed for ${recipe.id}: ${err.message}`);
        }

        normalized.push(recipe);
      }

      this.recipes = normalized;
      this.computeRelatedRecipes();
      await this.validateAllRecipes();
    },

    computeRelatedRecipes() {
      const useEmbeddings = this.recipes.some((recipe) => Array.isArray(recipe._embedding));

      this.recipes.forEach((recipe) => {
        const scored = this.recipes
          .filter((candidate) => candidate.id !== recipe.id)
          .map((candidate) => {
            const score =
              useEmbeddings &&
              Array.isArray(recipe._embedding) &&
              Array.isArray(candidate._embedding)
                ? cosineSimilarity(recipe._embedding, candidate._embedding)
                : keywordScore(recipe._searchText, candidate._searchText);
            return {
              id: candidate.id,
              score,
            };
          })
          .filter((entry) => entry.score >= this.settings.relatedMinScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, this.settings.relatedLimit)
          .map((entry) => entry.id);

        recipe.relatedRecipes = scored;
      });
    },

    assessRecipeStatus(recipe, actionRegistry) {
      const errors = [];
      const warnings = [];

      for (const step of recipe.process || []) {
        const actionDef = actionRegistry[step.action];
        if (!actionDef) {
          errors.push(`Missing action: ${step.action}`);
          continue;
        }

        if (step.restPath) {
          const expected = normalizeRest(step.restPath);
          const actual = normalizeRest(actionDef.rest);
          if (expected && actual && expected !== actual) {
            warnings.push(
              `REST mismatch for ${step.action}: recipe=${step.restPath}, live=${actionDef.rest}`
            );
          }
        }
      }

      let status = 'valid';
      if (recipe.deprecated) status = 'deprecated';
      else if (errors.length > 0) status = 'broken';
      else if (warnings.length > 0) status = 'degraded';

      return {
        status,
        errors,
        warnings,
      };
    },

    async validateAllRecipes() {
      const actionRegistry = this.getActionRegistry();
      const summary = {
        total: this.recipes.length,
        valid: 0,
        degraded: 0,
        broken: 0,
        deprecated: 0,
      };

      this.recipes = this.recipes.map((recipe) => {
        const validation = this.assessRecipeStatus(recipe, actionRegistry);
        const next = {
          ...recipe,
          status: validation.status,
          _validation: {
            checkedAt: new Date().toISOString(),
            errors: validation.errors,
            warnings: validation.warnings,
          },
        };
        summary[validation.status] += 1;
        return next;
      });

      this.lastValidatedAt = new Date().toISOString();
      this.validationSummary = summary;

      this.broker.emit('cookbook.validation.complete', {
        at: this.lastValidatedAt,
        summary,
      });

      return {
        ...summary,
        at: this.lastValidatedAt,
      };
    },

    async searchRecipes(query, options = {}) {
      const limit = Number.isFinite(options.limit) ? options.limit : 5;
      const includeBroken = Boolean(options.includeBroken);

      let queryEmbedding = null;
      try {
        queryEmbedding = await computeEmbedding(query);
      } catch (err) {
        this.logger.warn(`[cookbook] query embedding failed: ${err.message}`);
      }

      return this.recipes
        .filter(
          (recipe) =>
            includeBroken || (recipe.status !== 'broken' && recipe.status !== 'deprecated')
        )
        .map((recipe) => {
          const score =
            Array.isArray(queryEmbedding) && Array.isArray(recipe._embedding)
              ? cosineSimilarity(queryEmbedding, recipe._embedding)
              : keywordScore(query, recipe._searchText);

          return {
            ...this.sanitizeRecipe(recipe),
            score: Number(score.toFixed(4)),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  },
};
