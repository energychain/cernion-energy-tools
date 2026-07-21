'use strict';

const crypto = require('crypto');
const { generateStructured } = require('../src/llm-client');
const {
  MAX_SOURCE_ROWS,
  buildLlmContext,
  deterministicAnswer,
  executeOperations,
  hashValue,
  heuristicPlan,
  profileRows,
  validateAndBindPlan,
} = require('../src/tabular-intelligence');

const PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    operations: { type: 'array', items: { type: 'object' } },
    output: { type: 'object' },
  },
  required: ['operations'],
};

function requestBody(required, properties, example) {
  return {
    content: {
      'application/json': {
        schema: { type: 'object', required, properties },
        examples: { request: { summary: 'Tabular intelligence request', value: example } },
      },
    },
  };
}

function metaOptions(ctx) {
  return { meta: { ...(ctx.meta || {}) } };
}

function sourceIdProperties() {
  return {
    sourceId: { type: 'string', example: 'metering-source-01' },
    maxRows: { type: 'integer', default: 5000, example: 5000 },
    privacyContext: {
      type: 'string',
      enum: ['ai-agent', 'public'],
      default: 'ai-agent',
      example: 'ai-agent',
    },
  };
}

module.exports = {
  name: 'tabular',

  settings: {
    profileMaxRows: Number(process.env.TABULAR_PROFILE_MAX_ROWS || 5000),
    executionMaxRows: Number(process.env.TABULAR_EXECUTION_MAX_ROWS || MAX_SOURCE_ROWS),
    contextMaxTokens: Number(process.env.TABULAR_CONTEXT_MAX_TOKENS || 2000),
  },

  actions: {
    profile: {
      rest: 'POST /tabular/profile',
      params: {
        sourceId: { type: 'string', min: 1 },
        maxRows: {
          type: 'number',
          integer: true,
          min: 1,
          max: 50000,
          optional: true,
          convert: true,
        },
        privacyContext: {
          type: 'enum',
          values: ['ai-agent', 'public'],
          optional: true,
          default: 'ai-agent',
        },
      },
      openapi: {
        summary: 'Build a privacy-aware deterministic table profile',
        tags: ['Tabular Intelligence'],
        requestBody: requestBody(['sourceId'], sourceIdProperties(), {
          sourceId: 'metering-source-01',
          maxRows: 5000,
          privacyContext: 'ai-agent',
        }),
      },
      async handler(ctx) {
        const profile = await this.buildProfile(ctx, ctx.params.sourceId, {
          maxRows: ctx.params.maxRows,
          privacyContext: ctx.params.privacyContext,
        });
        return { success: true, ...profile };
      },
    },

    llmContext: {
      rest: 'POST /tabular/llm-context',
      params: {
        sourceIds: { type: 'array', min: 1, max: 2, items: 'string' },
        maxTokens: {
          type: 'number',
          integer: true,
          min: 128,
          max: 8000,
          optional: true,
          convert: true,
        },
        privacyContext: {
          type: 'enum',
          values: ['ai-agent', 'public'],
          optional: true,
          default: 'ai-agent',
        },
      },
      openapi: {
        summary: 'Build bounded LLM-safe context without raw table rows',
        tags: ['Tabular Intelligence'],
        requestBody: requestBody(
          ['sourceIds'],
          {
            sourceIds: {
              type: 'array',
              items: { type: 'string' },
              example: ['metering-source-01'],
            },
            maxTokens: { type: 'integer', default: 2000, example: 2000 },
            privacyContext: {
              type: 'string',
              enum: ['ai-agent', 'public'],
              default: 'ai-agent',
              example: 'ai-agent',
            },
          },
          { sourceIds: ['metering-source-01'], maxTokens: 2000, privacyContext: 'ai-agent' }
        ),
      },
      async handler(ctx) {
        const profiles = await Promise.all(
          ctx.params.sourceIds.map((sourceId) =>
            this.buildProfile(ctx, sourceId, {
              maxRows: this.settings.profileMaxRows,
              privacyContext: ctx.params.privacyContext,
            })
          )
        );
        return {
          success: true,
          ...buildLlmContext(profiles, {
            maxTokens: ctx.params.maxTokens || this.settings.contextMaxTokens,
          }),
          profileHashes: profiles.map((profile) => profile.hashes.profile),
        };
      },
    },

    queryPlan: {
      rest: 'POST /tabular/query-plan',
      params: {
        sourceIds: { type: 'array', min: 1, max: 2, items: 'string', optional: true },
        question: { type: 'string', min: 1, max: 2000, optional: true },
        plan: { type: 'object', optional: true },
        useLlm: { type: 'boolean', optional: true, default: false, convert: true },
        maxTokens: {
          type: 'number',
          integer: true,
          min: 128,
          max: 8000,
          optional: true,
          convert: true,
        },
      },
      openapi: {
        summary: 'Create or validate an allow-listed tabular analysis plan',
        tags: ['Tabular Intelligence'],
        requestBody: requestBody(
          [],
          {
            sourceIds: {
              type: 'array',
              items: { type: 'string' },
              example: ['metering-source-01'],
            },
            question: { type: 'string', example: 'What is the total consumption?' },
            plan: { type: 'object', default: null, example: {} },
            useLlm: { type: 'boolean', default: false, example: false },
            maxTokens: { type: 'integer', default: 2000, example: 2000 },
          },
          {
            sourceIds: ['metering-source-01'],
            question: 'What is the total consumption?',
            useLlm: false,
          }
        ),
      },
      async handler(ctx) {
        const tenantId = ctx.meta?.tenantId || 'default';
        let candidate = ctx.params.plan;
        const sourceIds =
          ctx.params.sourceIds || candidate?.sources?.map((source) => source.sourceId) || [];
        if (!candidate && !sourceIds.length) throw new Error('sourceIds or plan is required');

        let planner = 'supplied';
        let contextInfo = null;
        if (!candidate) {
          const profiles = await Promise.all(
            sourceIds.map((sourceId) =>
              this.buildProfile(ctx, sourceId, {
                maxRows: this.settings.profileMaxRows,
                privacyContext: 'ai-agent',
              })
            )
          );
          if (ctx.params.useLlm) {
            contextInfo = buildLlmContext(profiles, {
              maxTokens: ctx.params.maxTokens || this.settings.contextMaxTokens,
            });
            const prompt = [
              'Create a read-only CET tabular plan. Return JSON only.',
              'Use only the allowed operations and exact column names in the supplied context.',
              'Do not calculate or state any numeric result.',
              `Question: ${ctx.params.question || 'Summarize this table'}`,
              `Safe context: ${contextInfo.context}`,
            ].join('\n\n');
            const generated = await generateStructured(PLANNER_SCHEMA, prompt, {
              ctx,
              broker: this.broker,
              tenantId,
            });
            candidate = {
              schemaVersion: '1.0',
              sources: sourceIds.map((sourceId, index) => ({
                alias: index === 0 ? 'table' : `table${index + 1}`,
                sourceId,
                privacyContext: 'ai-agent',
              })),
              operations: generated.operations || [],
              output: generated.output || { maxRows: 500 },
            };
            planner = 'llm-client';
          } else {
            if (sourceIds.length !== 1) {
              throw new Error(
                'Deterministic heuristic planning supports one source; supply a join plan'
              );
            }
            candidate = heuristicPlan(ctx.params.question, profiles[0], sourceIds[0]);
            planner = 'deterministic-heuristic';
          }
        }

        const plan = validateAndBindPlan(candidate, tenantId);
        return {
          success: true,
          plan,
          planner,
          planHash: hashValue(plan),
          context: contextInfo
            ? {
                estimatedTokens: contextInfo.estimatedTokens,
                truncated: contextInfo.truncated,
              }
            : null,
          warnings: [],
        };
      },
    },

    executePlan: {
      rest: 'POST /tabular/execute-plan',
      params: { plan: { type: 'object' } },
      openapi: {
        summary: 'Execute a validated tabular plan deterministically',
        tags: ['Tabular Intelligence'],
        requestBody: requestBody(
          ['plan'],
          {
            plan: {
              type: 'object',
              example: { schemaVersion: '1.0', sources: [], operations: [] },
            },
          },
          {
            plan: {
              schemaVersion: '1.0',
              sources: [{ alias: 'table', sourceId: 'metering-source-01' }],
              operations: [
                {
                  op: 'aggregate',
                  groupBy: [],
                  metrics: [{ fn: 'sum', field: 'value', as: 'totalValue' }],
                },
              ],
            },
          }
        ),
      },
      async handler(ctx) {
        return this.executePlan(ctx, ctx.params.plan);
      },
    },

    ask: {
      rest: 'POST /tabular/ask',
      params: {
        question: { type: 'string', min: 1, max: 2000 },
        sourceIds: { type: 'array', min: 1, max: 2, items: 'string', optional: true },
        plan: { type: 'object', optional: true },
        useLlm: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Answer a table question with deterministic results and evidence',
        tags: ['Tabular Intelligence'],
        requestBody: requestBody(
          ['question'],
          {
            question: { type: 'string', example: 'What is the total consumption?' },
            sourceIds: {
              type: 'array',
              items: { type: 'string' },
              example: ['metering-source-01'],
            },
            plan: { type: 'object', default: null, example: {} },
            useLlm: { type: 'boolean', default: false, example: false },
          },
          {
            question: 'What is the total consumption?',
            sourceIds: ['metering-source-01'],
            useLlm: false,
          }
        ),
      },
      async handler(ctx) {
        const planning = await ctx.call(
          'tabular.queryPlan',
          {
            sourceIds: ctx.params.sourceIds,
            question: ctx.params.question,
            plan: ctx.params.plan,
            useLlm: ctx.params.useLlm,
          },
          metaOptions(ctx)
        );
        const execution = await this.executePlan(ctx, planning.plan);
        return {
          success: true,
          answer: deterministicAnswer(execution),
          question: ctx.params.question,
          ...execution,
          planner: planning.planner,
        };
      },
    },

    qualityReport: {
      rest: 'POST /tabular/quality-report',
      params: {
        sourceId: { type: 'string', min: 1 },
        timestampField: { type: 'string', optional: true },
        intervalMinutes: {
          type: 'number',
          integer: true,
          min: 1,
          max: 10080,
          optional: true,
          convert: true,
        },
        duplicateFields: { type: 'array', items: 'string', optional: true },
        outlierField: { type: 'string', optional: true },
        outlierThreshold: { type: 'number', min: 0.1, max: 20, optional: true, convert: true },
      },
      openapi: {
        summary: 'Build an evidence-backed table quality report',
        tags: ['Tabular Intelligence'],
        requestBody: requestBody(
          ['sourceId'],
          {
            sourceId: { type: 'string', example: 'metering-source-01' },
            timestampField: { type: 'string', default: null, example: 'timestamp' },
            intervalMinutes: { type: 'integer', default: 15, example: 15 },
            duplicateFields: {
              type: 'array',
              items: { type: 'string' },
              example: ['timestamp'],
            },
            outlierField: { type: 'string', default: null, example: 'value' },
            outlierThreshold: { type: 'number', default: 3, example: 3 },
          },
          {
            sourceId: 'metering-source-01',
            timestampField: 'timestamp',
            intervalMinutes: 15,
            duplicateFields: ['timestamp'],
            outlierField: 'value',
          }
        ),
      },
      async handler(ctx) {
        const profile = await this.buildProfile(ctx, ctx.params.sourceId, {
          maxRows: this.settings.executionMaxRows,
          privacyContext: 'ai-agent',
        });
        const timestampField =
          ctx.params.timestampField ||
          profile.columns.find((column) => column.type === 'timestamp')?.name;
        const outlierField =
          ctx.params.outlierField ||
          profile.columns.find((column) => column.type === 'number')?.name;
        const duplicateFields =
          ctx.params.duplicateFields ||
          (timestampField
            ? [timestampField]
            : [profile.columns.find((column) => column.distinctRatio >= 0.8)?.name].filter(
                Boolean
              ));
        const operations = [];
        if (timestampField) {
          operations.push({
            op: 'detectMissingIntervals',
            field: timestampField,
            intervalMinutes: ctx.params.intervalMinutes || 15,
          });
        }
        if (duplicateFields.length)
          operations.push({ op: 'detectDuplicates', fields: duplicateFields });
        if (outlierField) {
          operations.push({
            op: 'detectOutliers',
            field: outlierField,
            threshold: ctx.params.outlierThreshold || 3,
          });
        }
        const execution = await this.executePlan(ctx, {
          schemaVersion: '1.0',
          sources: [{ alias: 'table', sourceId: ctx.params.sourceId, privacyContext: 'ai-agent' }],
          operations,
          output: { maxRows: 100 },
        });
        return {
          success: true,
          sourceId: ctx.params.sourceId,
          profile,
          checks: execution.evidence.operations
            .filter((operation) => operation.details)
            .map((operation) => ({ check: operation.op, ...operation.details })),
          evidence: execution.evidence,
          warnings: execution.warnings,
          confidence: execution.confidence,
        };
      },
    },
  },

  methods: {
    async loadSourceRows(ctx, sourceId, options = {}) {
      const maxRows = Math.max(
        1,
        Math.min(MAX_SOURCE_ROWS, Number(options.maxRows) || this.settings.executionMaxRows)
      );
      const pageSize = Math.min(5000, maxRows);
      const rows = [];
      let offset = 0;
      let totalRows = Number.POSITIVE_INFINITY;
      while (offset < totalRows && rows.length < maxRows) {
        const response = await ctx.call(
          'datasource-cache.query',
          {
            sourceId,
            limit: Math.min(pageSize, maxRows - rows.length),
            offset,
            privacyContext: options.privacyContext || 'ai-agent',
          },
          metaOptions(ctx)
        );
        const page = Array.isArray(response?.data) ? response.data : [];
        if (!page.length) break;
        rows.push(...page);
        totalRows = Number.isFinite(Number(response.totalRows))
          ? Number(response.totalRows)
          : offset + page.length;
        offset += page.length;
      }
      return {
        rows: rows.slice(0, maxRows),
        totalRows: Number.isFinite(totalRows) ? totalRows : rows.length,
        truncated: Number.isFinite(totalRows) && totalRows > rows.length,
      };
    },

    async loadSourceMetadata(ctx, sourceId) {
      const sourceResponse = await ctx
        .call('datasource-registry.get', { id: sourceId }, metaOptions(ctx))
        .catch(() => null);
      const source = sourceResponse?.data || {};
      const classificationResponse = await ctx
        .call('datasource-registry.getClassification', { id: sourceId }, metaOptions(ctx))
        .catch(() => null);
      return {
        dictionaryFields: source.dictionary?.fields || [],
        classification: classificationResponse?.data || source.semanticClassification || null,
      };
    },

    async buildProfile(ctx, sourceId, options = {}) {
      const [loaded, metadata] = await Promise.all([
        this.loadSourceRows(ctx, sourceId, {
          maxRows: options.maxRows || this.settings.profileMaxRows,
          privacyContext: options.privacyContext || 'ai-agent',
        }),
        this.loadSourceMetadata(ctx, sourceId),
      ]);
      const profile = profileRows(loaded.rows, {
        sourceId,
        totalRows: loaded.totalRows,
        privacyContext: options.privacyContext || 'ai-agent',
        dictionaryFields: metadata.dictionaryFields,
        classification: metadata.classification,
      });
      if (loaded.truncated)
        profile.warnings.push(`Profile sampled ${loaded.rows.length} of ${loaded.totalRows} rows`);
      return profile;
    },

    async executePlan(ctx, rawPlan) {
      const tenantId = ctx.meta?.tenantId || 'default';
      const plan = validateAndBindPlan(rawPlan, tenantId);
      const sourcesByAlias = new Map(plan.sources.map((source) => [source.alias, source]));
      const join = plan.operations[0]?.op === 'join' ? plan.operations[0] : null;
      let inputRows;
      const inputRowCounts = {};
      const warnings = [];

      if (join) {
        const left = sourcesByAlias.get(join.left);
        const right = sourcesByAlias.get(join.right);
        const joined = await ctx.call(
          'in-memory-join.join',
          {
            left: {
              kind: 'datasource',
              sourceId: left.sourceId,
              maxRows: this.settings.executionMaxRows,
              privacyContext: left.privacyContext,
            },
            right: {
              kind: 'datasource',
              sourceId: right.sourceId,
              maxRows: this.settings.executionMaxRows,
              privacyContext: right.privacyContext,
            },
            join: {
              leftField: join.leftField,
              rightField: join.rightField,
              matchMode: join.matchMode || 'exact',
              joinType: join.joinType || 'left',
              multipleMatches: join.multipleMatches || 'first',
              collisionStrategy: join.collisionStrategy || 'prefix-collisions',
              rightPrefix: join.rightPrefix || 'right_',
            },
          },
          metaOptions(ctx)
        );
        inputRows = Array.isArray(joined.data) ? joined.data : [];
        inputRowCounts[left.sourceId] = joined.leftCount || 0;
        inputRowCounts[right.sourceId] = joined.rightCount || 0;
      } else {
        const source = plan.sources[0];
        const loaded = await this.loadSourceRows(ctx, source.sourceId, {
          maxRows: this.settings.executionMaxRows,
          privacyContext: source.privacyContext,
        });
        inputRows = loaded.rows;
        inputRowCounts[source.sourceId] = loaded.rows.length;
        if (loaded.truncated) warnings.push(`Input truncated to ${loaded.rows.length} rows`);
      }

      const operations = join ? plan.operations.slice(1) : plan.operations;
      const execution = executeOperations(inputRows, operations, plan.output.maxRows);
      warnings.push(...execution.warnings);
      const resultHash = hashValue(execution.rows);
      const traceId = crypto.randomUUID();
      const evidence = {
        sourceIds: plan.sources.map((source) => source.sourceId),
        inputRowCounts,
        resultRowCount: execution.fullResultRowCount,
        evidenceRows: execution.rows.slice(0, 5),
        calculationSummary: execution.trace.length
          ? execution.trace
              .map((item) => `${item.op}:${item.inputRows}->${item.outputRows}`)
              .join('; ')
          : `identity:${inputRows.length}->${execution.fullResultRowCount}`,
        operations: [
          ...(join
            ? [
                {
                  op: 'join',
                  inputRows: Object.values(inputRowCounts).reduce((sum, count) => sum + count, 0),
                  outputRows: inputRows.length,
                  details: null,
                },
              ]
            : []),
          ...execution.trace,
        ],
        hashes: {
          input: hashValue(inputRows),
          plan: hashValue(plan),
          result: resultHash,
        },
        traceId,
      };
      return {
        executedPlan: plan,
        resultTable: execution.rows,
        evidence,
        warnings,
        assumptions: ['All timestamps are interpreted as UTC when no offset is present.'],
        confidence: warnings.length ? 'medium' : 'high',
      };
    },
  },
};
