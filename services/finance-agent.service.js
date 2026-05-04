'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const {
  createFinding,
  summarizeFindings,
  AUDIT_TRAIL_CREATED,
  FA_QUERY_PLANNED,
  FA_EVIDENCE_RETRIEVED,
  FA_RULE_EVIDENCE_USED,
  FA_HYDE_CONTEXT_USED,
  FA_RULE_HYDE_CONFLICT,
  FA_REGULATORY_REFERENCES_MISSING,
  FA_SYNTHESIS_GUARDED,
  FA_NEEDS_CLARIFICATION,
} = require('../src/validation-findings');
const { A2A_NAMESPACE } = require('../src/cya-a2a-protocol');

const OPENAPI_TAG = 'Finance Agent';
const PIPELINE_VERSION = '0.40.3';
const FINANCE_OEO_CLASS = ['https://openenergyplatform.org/ontology/oeo/OEO_00000143'];
const MODE_VALUES = ['rule_only', 'rule_plus_hyde'];
const FINANCE_MEMORY_NAMESPACE = process.env.FINANCE_AGENT_MEMORY_NAMESPACE || 'finance_agent_memory';

function isServiceNotFound(error) {
  return error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError';
}

const INTERNAL_PROMPTS = {
  queryPlanner: `You are the Finance Query Planner for German distribution grid regulation.
Goal: convert a free-text finance question into retrieval intents for knowledge-rag.
Priorities: OEO tags (CAPEX/OPEX/TOTEX), legal references (§ EnWG/ARegV/StromNEV), regulatory period context.
Output constraints: deterministic JSON, no invented tags, no invented legal references.`,
  evidenceArbiter: `You are the Evidence Arbiter.
Use L1_Rule payloads as binding evidence. Use L2_HyDE only as explanatory context.
If L1_Rule and L2_HyDE conflict, keep L1_Rule and flag conflict.
Never produce a claim without an evidence reference.`,
  synthesis: `You are the Regulatory Finance Synthesizer.
Generate concise conclusions for VNB decision-makers.
Allowed claims: only those traceable to retrieved evidence snippets.
If evidence is insufficient, return NEEDS_CLARIFICATION with explicit missing points.`,
};

module.exports = {
  name: 'finance-agent',

  settings: {
    dbPath: process.env.FINANCE_AGENT_DB_PATH || './data/finance-agent',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    this.logger.info(`Finance agent DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    analyze: {
      rest: 'POST /analyze',
      timeout: 120_000,
      params: {
        query: { type: 'string', min: 8, trim: true },
        mode: { type: 'enum', values: MODE_VALUES, optional: true, default: 'rule_plus_hyde' },
        topK: { type: 'number', optional: true, default: 6, min: 2, max: 20, convert: true },
        minScore: { type: 'number', optional: true, default: 0.35, min: 0, max: 1, convert: true },
        includeTrace: { type: 'boolean', optional: true, default: false },
        sessionId: { type: 'string', optional: true, trim: true, max: 120 },
        includeMemoryContext: { type: 'boolean', optional: true, default: true },
        includeA2AContext: { type: 'boolean', optional: true, default: true },
        includeDatapointsContext: { type: 'boolean', optional: true, default: true },
        contextLimit: { type: 'number', optional: true, default: 5, min: 1, max: 20, convert: true },
        persistMemory: { type: 'boolean', optional: true, default: true },
        collection: { type: 'string', optional: true, default: 'cernion_knowledge_v1' },
      },
      openapi: {
        summary: 'Analyze finance/regulatory questions with evidence-bound synthesis',
        description:
          'Deterministic finance workflow for VNBs: query planning → knowledge-rag retrieval → ' +
          'L1/L2 evidence arbitration → guarded synthesis. Default mode is rule_plus_hyde. ' +
          'No claim is emitted without source evidence.',
        tags: [OPENAPI_TAG],
        'x-oeo-class': FINANCE_OEO_CLASS,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: {
                    type: 'string',
                    example:
                      'Wie verhalten sich CAPEX, OPEX und TOTEX je 1 EUR Investition in der 5. Regulierungsperiode?',
                  },
                  mode: {
                    type: 'string',
                    enum: MODE_VALUES,
                    default: 'rule_plus_hyde',
                  },
                  topK: { type: 'integer', minimum: 2, maximum: 20, default: 6 },
                  minScore: { type: 'number', minimum: 0, maximum: 1, default: 0.35 },
                  includeTrace: { type: 'boolean', default: false },
                  sessionId: {
                    type: 'string',
                    description: 'Optional session identifier for A2A/memory-aware finance analysis.',
                    example: 'finance-session-2026-05-04',
                  },
                  includeMemoryContext: { type: 'boolean', default: true },
                  includeA2AContext: { type: 'boolean', default: true },
                  includeDatapointsContext: { type: 'boolean', default: true },
                  contextLimit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
                  persistMemory: { type: 'boolean', default: true },
                  collection: {
                    type: 'string',
                    default: 'cernion_knowledge_v1',
                    description: 'Optional knowledge collection name for RAG retrieval.',
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    query:
                      'Wie verhalten sich CAPEX, OPEX und TOTEX je 1 EUR Investition in der 5. Regulierungsperiode?',
                    mode: 'rule_plus_hyde',
                    topK: 6,
                    minScore: 0.35,
                    includeTrace: false,
                    sessionId: 'finance-session-2026-05-04',
                    includeMemoryContext: true,
                    includeA2AContext: true,
                    includeDatapointsContext: true,
                    contextLimit: 5,
                    persistMemory: true,
                    collection: 'cernion_knowledge_v1',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Finance analysis with evidence list and guarded synthesis',
          },
        },
      },
      async handler(ctx) {
        const report = await this.runAnalysis(ctx, ctx.params);
        const id = crypto.randomUUID();

        await this.db.put({
          _id: `fa:${id}`,
          id,
          type: 'finance-analysis',
          query: ctx.params.query,
          sessionId: ctx.params.sessionId || null,
          mode: report.mode,
          status: report.status,
          confidence: report.confidence,
          summary: report.summary,
          findings: report.findings,
          findingsCount: report.findingsCount,
          evidence: report.evidence,
          legalReferences: report.legalReferences,
          oeoTags: report.oeoTags,
          steps: report.steps,
          metadata: {
            inputParams: {
              topK: ctx.params.topK,
              minScore: ctx.params.minScore,
              includeTrace: !!ctx.params.includeTrace,
              includeMemoryContext: !!ctx.params.includeMemoryContext,
              includeA2AContext: !!ctx.params.includeA2AContext,
              includeDatapointsContext: !!ctx.params.includeDatapointsContext,
              contextLimit: ctx.params.contextLimit,
            },
            pipelineVersion: PIPELINE_VERSION,
            generatedAt: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        });

        if (ctx.params.sessionId && ctx.params.persistMemory !== false) {
          await this.upsertSessionMemory(ctx, ctx.params.sessionId, {
            lastAnalysisId: id,
            lastQuery: ctx.params.query,
            lastStatus: report.status,
            lastConfidence: report.confidence,
            legalReferences: report.legalReferences,
            oeoTags: report.oeoTags,
            summary: report.summary,
          });
        }

        return { success: true, id, ...report };
      },
    },

    remember: {
      rest: 'POST /memory',
      params: {
        sessionId: { type: 'string', trim: true, min: 3, max: 120 },
        memory: { type: 'object' },
      },
      openapi: {
        summary: 'Store finance session memory',
        description:
          'Persists session memory in Object Store namespace finance_agent_memory for context-aware follow-up analyses.',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId', 'memory'],
                properties: {
                  sessionId: { type: 'string', example: 'finance-session-2026-05-04' },
                  memory: {
                    type: 'object',
                    example: {
                      summary: 'CAPEX/OPEX baseline aus letzter Sitzung',
                      legalReferences: ['§21a EnWG'],
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    sessionId: 'finance-session-2026-05-04',
                    memory: {
                      summary: 'CAPEX/OPEX baseline aus letzter Sitzung',
                      legalReferences: ['§21a EnWG'],
                      notes: 'Hauptfokus auf RP5 und TOTEX-Wirkung.',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const saved = await this.upsertSessionMemory(ctx, ctx.params.sessionId, ctx.params.memory);
        return {
          success: true,
          sessionId: ctx.params.sessionId,
          namespace: FINANCE_MEMORY_NAMESPACE,
          memory: saved,
        };
      },
    },

    memory: {
      rest: 'GET /memory/:sessionId',
      params: {
        sessionId: { type: 'string', trim: true, min: 3, max: 120 },
      },
      openapi: {
        summary: 'Get finance session memory',
        description: 'Returns persisted session memory for the provided session id.',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'finance-session-2026-05-04' },
          },
        ],
      },
      async handler(ctx) {
        const memory = await this.getSessionMemory(ctx, ctx.params.sessionId);
        return {
          success: true,
          sessionId: ctx.params.sessionId,
          namespace: FINANCE_MEMORY_NAMESPACE,
          memory,
        };
      },
    },

    list: {
      rest: 'GET /analyses',
      params: {
        status: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, max: 100, convert: true },
      },
      openapi: {
        summary: 'List finance analyses',
        description: 'Returns persisted finance analyses (newest first).',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'ok' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        ],
      },
      async handler(ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'fa:',
          endkey: 'fa:\ufff0',
        });

        let docs = result.rows.map((r) => r.doc);
        if (ctx.params.status) {
          docs = docs.filter((d) => d.status === ctx.params.status);
        }

        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        docs = docs.slice(0, Math.min(ctx.params.limit || 20, 100));

        return {
          count: docs.length,
          analyses: docs.map((d) => ({
            id: d.id,
            query: d.query,
            mode: d.mode,
            status: d.status,
            confidence: d.confidence,
            findingsCount: d.findingsCount,
            createdAt: d.createdAt,
          })),
        };
      },
    },

    get: {
      rest: 'GET /analyses/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get finance analysis by id',
        description: 'Returns a full persisted finance analysis document.',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'f8cb0a6b-7f65-4b66-8bae-e8e89aa08877' },
          },
        ],
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`fa:${ctx.params.id}`);
          return { success: true, ...doc };
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Analysis ${ctx.params.id} not found` };
          }
          throw err;
        }
      },
    },

    prompts: {
      rest: 'GET /prompts',
      openapi: {
        summary: 'Get internal finance prompt templates',
        description: 'Returns internal system prompts used in query planning and synthesis.',
        tags: [OPENAPI_TAG],
      },
      async handler() {
        return {
          success: true,
          modeDefault: 'rule_plus_hyde',
          prompts: INTERNAL_PROMPTS,
        };
      },
    },
  },

  methods: {
    async runAnalysis(ctx, params) {
      const findings = [];
      const steps = [];
      const mode = params.mode || 'rule_plus_hyde';
      const topK = params.topK || 6;
      const minScore = params.minScore ?? 0.35;
      const query = String(params.query || '').trim();
      const sessionId = String(params.sessionId || '').trim() || null;
      const collection = params.collection || 'cernion_knowledge_v1';

      if (!query) {
        throw new MoleculerClientError('query is required', 400, 'VALIDATION_ERROR');
      }

      const externalContext = await this.loadExternalContext(ctx, {
        sessionId,
        includeMemoryContext: params.includeMemoryContext !== false,
        includeA2AContext: params.includeA2AContext !== false,
        includeDatapointsContext: params.includeDatapointsContext !== false,
        contextLimit: params.contextLimit || 5,
      });

      const plan = this.buildQueryPlan(query, { mode, topK, minScore }, externalContext);
      findings.push(
        createFinding(
          1,
          'query-planning',
          FA_QUERY_PLANNED,
          'info',
          'Finance query plan generated',
          `Generated ${plan.intents.length} retrieval intents for structured finance retrieval.`,
          { mode, intentCount: plan.intents.length }
        )
      );
      steps.push({ step: 1, name: 'query-planning', status: 'ok', intentCount: plan.intents.length });

      if (sessionId) {
        steps.push({
          step: 1.5,
          name: 'context-loading',
          status: 'ok',
          sessionId,
          memoryLoaded: !!externalContext.memory,
          a2aMessages: externalContext.a2aMessages.length,
          datapoints: externalContext.datapoints.length,
        });
      }

      const retrieval = await this.retrieveEvidence(ctx, plan, query, collection);
      findings.push(
        createFinding(
          2,
          'retrieval',
          FA_EVIDENCE_RETRIEVED,
          'info',
          'Evidence retrieved',
          `Retrieved ${retrieval.totalRaw} raw hits and retained ${retrieval.evidence.length} unique evidence items.`,
          { rawHits: retrieval.totalRaw, kept: retrieval.evidence.length }
        )
      );
      steps.push({
        step: 2,
        name: 'retrieval',
        status: 'ok',
        rawHits: retrieval.totalRaw,
        evidenceKept: retrieval.evidence.length,
      });

      const arbitration = this.arbitrateEvidence(retrieval.evidence, mode);
      if (arbitration.ruleEvidence.length > 0) {
        findings.push(
          createFinding(
            3,
            'evidence-arbitration',
            FA_RULE_EVIDENCE_USED,
            'info',
            'L1_Rule evidence prioritized',
            `Prioritized ${arbitration.ruleEvidence.length} rule-level evidence entries.`,
            { ruleEvidence: arbitration.ruleEvidence.length }
          )
        );
      }
      if (mode === 'rule_plus_hyde' && arbitration.hydeEvidence.length > 0) {
        findings.push(
          createFinding(
            3,
            'evidence-arbitration',
            FA_HYDE_CONTEXT_USED,
            'info',
            'L2_HyDE context included',
            `Added ${arbitration.hydeEvidence.length} HyDE context entries.`,
            { hydeEvidence: arbitration.hydeEvidence.length }
          )
        );
      }
      if (arbitration.conflicts.length > 0) {
        findings.push(
          createFinding(
            4,
            'conflict-check',
            FA_RULE_HYDE_CONFLICT,
            'warning',
            'Rule/HyDE conflict detected',
            'Potential semantic conflict between L1_Rule and L2_HyDE evidence was detected. L1_Rule retained as source of truth.',
            { conflictCount: arbitration.conflicts.length }
          )
        );
      }

      const legalReferences = this.collectLegalReferences(arbitration.selectedEvidence);
      if (legalReferences.length === 0) {
        findings.push(
          createFinding(
            4,
            'compliance-check',
            FA_REGULATORY_REFERENCES_MISSING,
            'warning',
            'No explicit legal references found',
            'No explicit § reference was found in selected evidence. Synthesis is downgraded to clarification mode.',
            { required: 'legal reference grounding' }
          )
        );
      }

      const synthesis = this.synthesize(query, arbitration, legalReferences, mode);
      if (synthesis.status === 'needs_clarification') {
        findings.push(
          createFinding(
            5,
            'synthesis',
            FA_NEEDS_CLARIFICATION,
            'warning',
            'Clarification required',
            synthesis.summary,
            { minRequiredRuleEvidence: 2, ruleEvidence: arbitration.ruleEvidence.length }
          )
        );
      } else {
        findings.push(
          createFinding(
            5,
            'synthesis',
            FA_SYNTHESIS_GUARDED,
            'info',
            'Guarded synthesis completed',
            'Final answer was generated from evidence-backed claims only.',
            {
              claims: synthesis.claims.length,
              legalReferences: legalReferences.length,
            }
          )
        );
      }

      findings.push(
        createFinding(
          6,
          'audit-trail',
          AUDIT_TRAIL_CREATED,
          'info',
          'Audit trail created',
          'Finance analysis trail was persisted with evidence references and pipeline metadata.',
          { pipelineVersion: PIPELINE_VERSION }
        )
      );

      const findingsCount = summarizeFindings(findings);
      const confidence = this.computeConfidence(arbitration, legalReferences, minScore);
      const status = synthesis.status;
      const oeoTags = this.collectOeoTags(arbitration.selectedEvidence);

      const response = {
        mode,
        status,
        confidence,
        summary: synthesis.summary,
        answer: synthesis.answer,
        claims: synthesis.claims,
        legalReferences,
        oeoTags,
        evidence: arbitration.selectedEvidence,
        findings,
        findingsCount,
        steps,
        metadata: {
          pipelineVersion: PIPELINE_VERSION,
          retrieval: {
            intents: plan.intents,
            totalRaw: retrieval.totalRaw,
            evidenceKept: arbitration.selectedEvidence.length,
          },
          context: {
            sessionId,
            memoryLoaded: !!externalContext.memory,
            a2aMessages: externalContext.a2aMessages.length,
            datapoints: externalContext.datapoints.length,
          },
        },
      };

      if (params.includeTrace) {
        response.trace = {
          prompts: INTERNAL_PROMPTS,
          plan,
          conflicts: arbitration.conflicts,
        };
      }

      return response;
    },

    buildQueryPlan(query, options, externalContext = {}) {
      const lowered = query.toLowerCase();
      const intents = [];

      const pushIntent = (name, semanticQuery, filter = {}) => {
        intents.push({
          name,
          queryType: 'semantic',
          query: semanticQuery,
          limit: options.topK,
          scoreThreshold: options.minScore,
          withPayload: true,
          withVectors: false,
          filter,
        });
      };

      pushIntent('base-question', query);

      const financeTags = [];
      if (/(capex|investition|anlageinvest)/.test(lowered)) {
        financeTags.push('ceo:CapitalExpenditure');
        pushIntent('capex-rules', 'Regulatorische CAPEX-Regeln im Verteilnetz und Bezug zu TOTEX', {
          should: [{ key: 'oeoTags', match: { any: ['ceo:CapitalExpenditure', 'CAPEX'] } }],
        });
      }

      if (/(opex|betriebskosten|operating)/.test(lowered)) {
        financeTags.push('ceo:OperatingExpenditure');
        pushIntent('opex-rules', 'Regulatorische OPEX-Regeln im Verteilnetz und Bezug zu TOTEX', {
          should: [{ key: 'oeoTags', match: { any: ['ceo:OperatingExpenditure', 'OPEX'] } }],
        });
      }

      if (/(totex|gesamtkosten|kostenbasis)/.test(lowered)) {
        financeTags.push('ceo:TotalExpenditure');
      }

      if (/(5\.|fünfte|fuenfte).*regulierungsperiode|regulierungsperiode\s*5/.test(lowered)) {
        pushIntent(
          'regulatory-period-5',
          'Regulatorische Vorgaben zur 5. Regulierungsperiode CAPEX OPEX TOTEX',
          {
            should: [{ key: 'referenceText_L0', match: { text: '5. Regulierungsperiode' } }],
          }
        );
      }

      pushIntent('legal-grounding', '§21a EnWG ARegV TOTEX CAPEX OPEX Verteilnetzbetreiber', {
        should: [{ key: 'referenceText_L0', match: { text: '§' } }],
      });

      for (const contextHint of this.buildContextHints(externalContext)) {
        pushIntent('session-context', contextHint);
      }

      return {
        query,
        mode: options.mode,
        financeTags,
        intents,
      };
    },

    buildContextHints(externalContext) {
      const hints = [];
      const memory = externalContext?.memory || null;
      const a2aMessages = Array.isArray(externalContext?.a2aMessages)
        ? externalContext.a2aMessages
        : [];
      const datapoints = Array.isArray(externalContext?.datapoints) ? externalContext.datapoints : [];

      if (memory && typeof memory.summary === 'string' && memory.summary.trim()) {
        hints.push(`Vorwissen aus vorheriger Analyse: ${memory.summary.trim()}`);
      }
      if (Array.isArray(memory?.legalReferences) && memory.legalReferences.length > 0) {
        hints.push(`Bisherige Rechtsanker: ${memory.legalReferences.slice(0, 5).join(', ')}`);
      }
      if (a2aMessages.length > 0) {
        const recent = a2aMessages
          .map((m) => m.eventName)
          .filter(Boolean)
          .slice(0, 4)
          .join(', ');
        hints.push(`A2A-Kontext letzte Events: ${recent}`);
      }
      if (datapoints.length > 0) {
        const names = datapoints
          .map((d) => d.name)
          .filter(Boolean)
          .slice(0, 4)
          .join(', ');
        hints.push(`Relevante Datapoints: ${names}`);
      }

      return hints.slice(0, 3);
    },

    async loadExternalContext(ctx, options) {
      const {
        sessionId,
        includeMemoryContext = true,
        includeA2AContext = true,
        includeDatapointsContext = true,
        contextLimit = 5,
      } = options || {};

      const memory = includeMemoryContext && sessionId ? await this.getSessionMemory(ctx, sessionId) : null;
      const a2aMessages =
        includeA2AContext && sessionId
          ? await this.getA2AMessages(ctx, sessionId, contextLimit)
          : [];
      const datapoints = includeDatapointsContext
        ? await this.getFinanceDatapoints(ctx, contextLimit)
        : [];

      return { memory, a2aMessages, datapoints };
    },

    async upsertSessionMemory(ctx, sessionId, memoryInput) {
      const existing = await this.getSessionMemory(ctx, sessionId);
      const now = new Date().toISOString();
      const payload = {
        ...(existing || {}),
        ...(memoryInput || {}),
        sessionId,
        updatedAt: now,
        createdAt: existing?.createdAt || now,
      };

      try {
        await ctx.call('object-store.put', {
          namespace: FINANCE_MEMORY_NAMESPACE,
          key: sessionId,
          payload,
        });
      } catch (error) {
        if (isServiceNotFound(error)) {
          this.logger.warn('[finance-agent] object-store unavailable, skipping memory write');
          return payload;
        }
        throw error;
      }

      return payload;
    },

    async getSessionMemory(ctx, sessionId) {
      try {
        const response = await ctx.call('object-store.get', {
          namespace: FINANCE_MEMORY_NAMESPACE,
          key: sessionId,
        });
        return response?.payload || null;
      } catch (error) {
        if (
          isServiceNotFound(error) ||
          error?.status === 404 ||
          error?.type === 'OBJECT_NOT_FOUND' ||
          error?.code === 404
        ) {
          return null;
        }
        throw error;
      }
    },

    async getA2AMessages(ctx, sessionId, limit = 5) {
      try {
        const response = await ctx.call('object-store.query', {
          namespace: A2A_NAMESPACE,
          selector: { 'payload.sessionId': sessionId },
          limit: Math.min(Math.max(limit, 1), 20),
        });

        const docs = Array.isArray(response?.docs) ? response.docs : [];
        return docs.map((d) => d.payload || {}).filter((d) => d && d.sessionId === sessionId);
      } catch (error) {
        if (isServiceNotFound(error)) {
          return [];
        }
        throw error;
      }
    },

    async getFinanceDatapoints(ctx, limit = 5) {
      try {
        const response = await ctx.call('datapoint.list', {
          includeHealth: false,
        });
        const datapoints = Array.isArray(response?.datapoints) ? response.datapoints : [];
        return datapoints
          .filter((d) => {
            const hay = `${d.name || ''} ${d.description || ''} ${(d.tags || []).join(' ')}`.toLowerCase();
            return /(finance|regulator|totex|capex|opex|ar\s*egv|stromnev|enwg)/.test(hay);
          })
          .slice(0, Math.min(Math.max(limit, 1), 20));
      } catch (error) {
        if (isServiceNotFound(error)) {
          return [];
        }
        throw error;
      }
    },

    async retrieveEvidence(ctx, plan, originalQuery, collectionName = 'cernion_knowledge_v1') {
      const evidence = [];
      let totalRaw = 0;

      for (const intent of plan.intents) {
        const response = await ctx.call(
          'knowledge-rag.query',
          {
            ...intent,
            query: intent.query || originalQuery,
            collection: collectionName,
          },
          { meta: ctx.meta }
        );

        const rows = response?.data?.results || response?.results || [];
        totalRaw += rows.length;

        for (const row of rows) {
          evidence.push(this.normalizeEvidenceRow(row, intent.name));
        }
      }

      const deduped = [];
      const seen = new Set();
      for (const row of evidence) {
        const key = row.pointId || `${row.intent}:${row.text.slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
      }

      deduped.sort((a, b) => b.adjustedScore - a.adjustedScore);
      return { totalRaw, evidence: deduped.slice(0, 20) };
    },

    normalizeEvidenceRow(row, intentName) {
      const metadata = row?.metadata || {};
      const text = String(row?.referenceText_L0 || row?.vectorText || '').trim();
      const level = this.detectCognitiveLevel(row, text);
      const score = Number(row?.score || 0);
      const adjustedScore = score + (level === 'L1_Rule' ? 0.08 : level === 'L2_HyDE' ? 0.02 : 0);

      return {
        pointId: row?.pointId || null,
        intent: intentName,
        score,
        adjustedScore: Number(adjustedScore.toFixed(4)),
        level,
        text,
        metadata,
        oeoTags: Array.isArray(row?.oeoTags) ? row.oeoTags : [],
      };
    },

    detectCognitiveLevel(row, text) {
      const metadata = row?.metadata || {};
      const direct =
        metadata.cognitiveLevel ||
        metadata.extractionLevel ||
        metadata.level ||
        metadata.sourceLevel ||
        null;
      if (typeof direct === 'string' && direct.trim()) return direct.trim();

      const lowered = String(text || '').toLowerCase();
      if (/l1_rule|wenn\s.+\sdann|muss|verpflichtet|ist\szu/.test(lowered)) return 'L1_Rule';
      if (/l2_hyde|hypothese|szenario|angenommen/.test(lowered)) return 'L2_HyDE';
      return 'unknown';
    },

    arbitrateEvidence(evidence, mode) {
      const ruleEvidence = evidence.filter((e) => e.level === 'L1_Rule');
      const hydeEvidence = evidence.filter((e) => e.level === 'L2_HyDE');
      const unknownEvidence = evidence.filter((e) => e.level === 'unknown');

      const selected = [...ruleEvidence];
      if (mode === 'rule_plus_hyde') {
        selected.push(...hydeEvidence.slice(0, Math.max(0, 8 - selected.length)));
      }
      if (selected.length < 4) {
        selected.push(...unknownEvidence.slice(0, 4 - selected.length));
      }

      const conflicts = this.findConflicts(ruleEvidence, hydeEvidence);
      return {
        ruleEvidence,
        hydeEvidence,
        selectedEvidence: selected.slice(0, 10),
        conflicts,
      };
    },

    findConflicts(ruleEvidence, hydeEvidence) {
      if (!ruleEvidence.length || !hydeEvidence.length) return [];

      const conflicts = [];
      const polarity = (text) => {
        const t = String(text || '').toLowerCase();
        if (/nicht\s+zulässig|ausgeschlossen|verboten/.test(t)) return 'negative';
        if (/zulässig|anerkannt|anrechenbar|möglich/.test(t)) return 'positive';
        return 'neutral';
      };

      for (const rule of ruleEvidence.slice(0, 5)) {
        for (const hyde of hydeEvidence.slice(0, 5)) {
          const rp = polarity(rule.text);
          const hp = polarity(hyde.text);
          if (rp !== 'neutral' && hp !== 'neutral' && rp !== hp) {
            conflicts.push({
              rulePointId: rule.pointId,
              hydePointId: hyde.pointId,
              topic: 'regulatory-polarity',
            });
          }
        }
      }

      return conflicts;
    },

    collectLegalReferences(evidence) {
      const refs = new Set();
      const sectionRegex = /§\s*\d+[a-z]?(?:\s*Abs\.\s*\d+)?(?:\s*Satz\s*\d+)?\s*[A-Za-z]+/gi;

      for (const e of evidence) {
        const md = e.metadata || {};
        const fromMetadata = md.legalReference || md.legalReferences || md.reference || null;
        if (Array.isArray(fromMetadata)) {
          fromMetadata.forEach((r) => refs.add(String(r).trim()));
        } else if (typeof fromMetadata === 'string' && fromMetadata.trim()) {
          refs.add(fromMetadata.trim());
        }

        const matches = String(e.text || '').match(sectionRegex) || [];
        matches.forEach((m) => refs.add(m.trim()));
      }

      return Array.from(refs).slice(0, 12);
    },

    collectOeoTags(evidence) {
      const tags = new Set();
      for (const e of evidence) {
        for (const tag of e.oeoTags || []) {
          tags.add(String(tag));
        }
      }
      return Array.from(tags).slice(0, 20);
    },

    synthesize(query, arbitration, legalReferences, mode) {
      const ruleCount = arbitration.ruleEvidence.length;
      const selected = arbitration.selectedEvidence;

      if (ruleCount < 2 || selected.length < 3 || legalReferences.length === 0) {
        return {
          status: 'needs_clarification',
          summary:
            'Evidenzlage für eine regulatorisch belastbare Antwort ist unzureichend. Bitte präzisieren Sie Regulierungsrahmen oder Zeitraum.',
          answer:
            'Für eine belastbare Einordnung fehlen hinreichende L1-Regeln oder explizite Rechtsreferenzen in den Treffern.',
          claims: [],
        };
      }

      const top = selected.slice(0, 3);
      const claims = top.map((e, idx) => ({
        id: `C-${idx + 1}`,
        statement: this.toClaim(e.text),
        evidencePointId: e.pointId,
        level: e.level,
      }));

      const modeText = mode === 'rule_plus_hyde' ? 'L1-Regeln + L2-Kontext' : 'L1-Regeln';
      const summary =
        `Belastbare Einordnung auf Basis von ${modeText}: ` +
        'CAPEX/OPEX/TOTEX-Abhängigkeiten sind nur in dem Umfang dargestellt, wie sie in den Quellen explizit belegt sind.';
      const answer =
        `${summary} Rechtsanker: ${legalReferences.slice(0, 4).join('; ')}. ` +
        'Bei Zielkonflikten zwischen Regel- und Hypothesenebene wurde strikt die Regel-Ebene priorisiert.';

      return { status: 'ok', summary, answer, claims };
    },

    toClaim(text) {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      if (clean.length <= 240) return clean;
      return `${clean.slice(0, 237)}...`;
    },

    computeConfidence(arbitration, legalReferences, minScore) {
      const selected = arbitration.selectedEvidence;
      if (!selected.length) return 0;

      const avgScore =
        selected.reduce((sum, e) => sum + Number(e.score || 0), 0) / Math.max(1, selected.length);
      const ruleFactor = Math.min(1, arbitration.ruleEvidence.length / 4);
      const legalFactor = legalReferences.length > 0 ? 1 : 0.5;
      const thresholdFactor = avgScore >= minScore ? 1 : 0.7;

      const confidence = 100 * avgScore * 0.55 + 100 * ruleFactor * 0.3 + 100 * legalFactor * 0.15;
      return Math.max(0, Math.min(100, Math.round(confidence * thresholdFactor / 100 * 100)));
    },
  },
};
