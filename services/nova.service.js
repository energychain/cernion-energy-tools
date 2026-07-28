'use strict';

const crypto = require('crypto');
const { PassThrough } = require('stream');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  STATES: DECISION_STATES,
  FINAL_STATES,
  initLifecycle,
  transition,
} = require('../src/nova-decision-machine');
const { runAsync } = require('../src/async-job-runner');
const { applyCursorPagination, buildFilterHash, resolveTenantId } = require('../src/pagination');
const { isRedispatchEligibleCapacityOnly } = require('../src/redispatch-utils');

const QU_GAIN_FACTOR = 0.15;
const RONT_PV_GAIN_FACTOR = 0.5;
const RONT_WPEV_GAIN_FACTOR = 0.25;
const RONT_CAPEX_EUR = 5500;
const RD_CURTAILMENT_FACTOR = 0.3;
const OPENAPI_TAG = 'NOVA';
const DOC_PREFIX_DECISION = 'nd:';
const DOC_PREFIX_PROJECT_BINDING = 'npb:';
const DEFAULT_DECISION_TTL_HOURS = 72;
const DECISION_KINDS_WITH_HITL = new Set([
  'mastr_correction',
  'asset_override',
  'threshold_update',
]);

module.exports = {
  name: 'nova',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'NOVA_DB_PATH',
      defaultDbPath: './data/nova',
      indexes: [['type'], ['tenantId'], ['projectId'], ['kind'], ['lifecycle.current']],
    }),
  ],

  settings: {
    decisionTtlHours: Number(process.env.NOVA_DECISION_TTL_HOURS || DEFAULT_DECISION_TTL_HOURS),
    expiryCheckIntervalMs: Number(process.env.NOVA_EXPIRY_CHECK_INTERVAL_MS || 60_000),
  },

  created() {
    this.sseClients = new Set();
    this.pendingDecisionIndex = new Map();
    this.expiryTimer = null;
  },

  async started() {
    this.expiryTimer = setInterval(() => {
      this.expireDueDecisions().catch((err) =>
        this.logger.warn(`[nova] expireDueDecisions failed: ${err.message}`)
      );
    }, this.settings.expiryCheckIntervalMs);
  },

  async stopped() {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }

    for (const client of this.sseClients) {
      try {
        clearInterval(client.keepAliveTimer);
        client.stream.end();
      } catch (_) {
        // Ignore cleanup errors on shutdown.
      }
    }
    this.sseClients.clear();
  },

  events: {
    /**
     * Forward existing ZNP updates to all NOVA decision-feed SSE clients.
     */
    'znp.project.updated'(payload) {
      this.broadcastSSE('znp.project.updated', payload);
    },

    async 'mastr-monitor.delta.detected'(payload) {
      await this.ingestSignalDecision({
        tenantId: payload?.tenantId || 'default',
        projectId: payload?.projectId,
        kind: 'mastr_correction',
        source: {
          service: 'mastr-monitor',
          action: 'delta.detected',
          evidence: Array.isArray(payload?.changes) ? payload.changes : [payload].filter(Boolean),
        },
        proposal: {
          field: 'mastr_delta',
          value: payload?.changes || payload || {},
          previousValue: null,
        },
      });
    },

    async 'hitl.item.resolved'(payload) {
      if (!payload?.itemId) return;

      const docs = await this.listAllDecisionDocs();
      const doc = docs.find((entry) => entry.hitlItemId === payload.itemId);
      if (!doc) return;

      if (payload.status === 'approved') {
        await this.transitionDecisionLifecycle(doc, DECISION_STATES.APPROVED, {
          actor: 'hitl',
          reason: 'hitl-approved',
        });
      } else if (payload.status === 'rejected') {
        await this.transitionDecisionLifecycle(doc, DECISION_STATES.REJECTED, {
          actor: 'hitl',
          reason: 'hitl-rejected',
        });
      }
    },
  },

  actions: {
    /**
     * GET /api/nova/pending-decisions
     */
    pendingDecisions: {
      rest: {
        method: 'GET',
        path: '/pending-decisions',
      },
      params: {
        projectId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'List pending NOVA decisions (dynamic)',
        tags: ['NOVA'],
        description:
          'Analyses the project graph and returns dynamic NOVA decisions using O/V heuristics ' +
          '(Q(U) optimization and rONT reinforcement).',
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
      },
      async handler(ctx) {
        const { projectId } = ctx.params;
        const tenantId = await this.assertProjectTenantBinding(projectId, resolveTenantId(ctx));
        const decisions = await this.analyseProjectForPendingDecisions(projectId);

        for (const decision of decisions) {
          this.pendingDecisionIndex.set(`${projectId}:${decision.id}`, decision);
          await this.upsertHeuristicDecision(projectId, tenantId, decision);
        }

        const docs = await this.listProjectDecisions(tenantId, projectId);
        const pending = docs
          .filter((entry) => entry.lifecycle?.current === DECISION_STATES.PENDING_APPROVAL)
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        return pending.map((entry) => this.toPublicDecision(entry));
      },
    },

    /**
     * POST /api/nova/apply/:id
     */
    apply: {
      rest: {
        method: 'POST',
        path: '/apply/:id',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Apply NOVA decision',
        tags: ['NOVA'],
        description:
          'Applies a dynamic NOVA decision to the in-memory ZNP graph, persists the update, ' +
          'and emits znp.project.updated for SSE consumers.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'id'],
                properties: {
                  projectId: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
                  id: { type: 'string', example: 'dec_a1b2c3d4_SUB_1_QU' },
                },
              },
              examples: {
                default: {
                  value: {
                    projectId: 'a1b2c3d4-0000-0000-0000-000000000001',
                    id: 'dec_a1b2c3d4_SUB_1_QU',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { projectId, id } = ctx.params;
        const tenantId = await this.assertProjectTenantBinding(projectId, resolveTenantId(ctx));
        const { znpService } = await this.getProjectGraph(projectId);
        let decisionDoc = await this.getDecisionDocById(id, tenantId, projectId);
        let decision = this.pendingDecisionIndex.get(`${projectId}:${id}`);

        if (!decision && decisionDoc?.proposal?.decision) {
          decision = decisionDoc.proposal.decision;
        }

        if (!decision) {
          const recomputed = await this.analyseProjectForPendingDecisions(projectId);
          for (const item of recomputed) {
            this.pendingDecisionIndex.set(`${projectId}:${item.id}`, item);
            await this.upsertHeuristicDecision(projectId, tenantId, item);
          }
          decision = this.pendingDecisionIndex.get(`${projectId}:${id}`);
          if (!decisionDoc) {
            decisionDoc = await this.getDecisionDocById(id, tenantId, projectId);
          }
        }

        if (!decision) {
          throw new MoleculerError(
            `NOVA decision "${id}" not found for project "${projectId}".`,
            404,
            'NOVA_DECISION_NOT_FOUND',
            { projectId, id }
          );
        }

        if (decisionDoc && decisionDoc.lifecycle?.current === DECISION_STATES.PENDING_APPROVAL) {
          decisionDoc = await this.transitionDecisionLifecycle(
            decisionDoc,
            DECISION_STATES.APPROVED,
            {
              actor: 'nova.apply',
              reason: 'legacy-apply-endpoint',
            }
          );
        }

        const projectGraph = znpService.getProject(projectId);
        const graph = projectGraph.graph;

        if (decision.type === 'QU') {
          this.applyQuRegulationDecision(graph, decision.substationKey);
        } else if (decision.type === 'rONT') {
          this.applyRontDecision(graph, decision.substationKey, decision.capacity_gain_kw);
        } else if (decision.type === 'RD_CURTAILMENT') {
          this.applyRdCurtailmentDecision(
            graph,
            decision.substationKey,
            Array.isArray(decision.redispatchAssetKeys) ? decision.redispatchAssetKeys : []
          );
        } else {
          throw new MoleculerError(
            `Unsupported NOVA decision type "${decision.type}".`,
            400,
            'NOVA_DECISION_TYPE_UNSUPPORTED',
            { projectId, id, type: decision.type }
          );
        }

        if (typeof znpService.recalculateCumulativeCapacitiesUpstream === 'function') {
          znpService.recalculateCumulativeCapacitiesUpstream(graph, [decision.substationKey]);
        }
        if (typeof znpService.persistGraph === 'function') {
          await znpService.persistGraph(projectId, graph);
        }
        if (typeof znpService.updateProjectMeta === 'function') {
          await znpService.updateProjectMeta(projectId, graph, 'nova');
        }

        this.broker.emit('znp.project.updated', {
          type: 'nova-decision-applied',
          data: {
            tenantId,
            projectId,
            id: decision.id,
            decisionType: decision.type,
            gridNode: decision.gridNode,
            capacity_gain_kw: decision.capacity_gain_kw,
            capex: decision.capex,
          },
        });

        if (decisionDoc) {
          await this.transitionDecisionLifecycle(decisionDoc, DECISION_STATES.APPLIED, {
            actor: 'nova.apply',
            reason: 'applied-to-znp-graph',
          });
        }

        return {
          success: true,
          id,
        };
      },
    },

    listDecisions: {
      rest: {
        method: 'GET',
        path: '/decisions',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        status: { type: 'string', optional: true },
        kind: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50 },
        cursor: { type: 'string', optional: true },
        offset: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'List NOVA decisions',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: { type: 'string', example: 'pending_approval' },
          },
          {
            in: 'query',
            name: 'kind',
            required: false,
            schema: { type: 'string', example: 'threshold_update' },
          },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', default: 50 } },
          {
            in: 'query',
            name: 'cursor',
            required: false,
            schema: { type: 'string', example: 'eyJwaXZvdCI6Ii4uLiJ9' },
          },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', default: 0 } },
        ],
      },
      async handler(ctx) {
        const tenantId = await this.assertProjectTenantBinding(
          ctx.params.projectId,
          resolveTenantId(ctx)
        );
        let docs = await this.listProjectDecisions(tenantId, ctx.params.projectId);

        if (ctx.params.status) {
          const status = String(ctx.params.status || '')
            .trim()
            .toLowerCase();
          docs = docs.filter(
            (doc) => String(doc.lifecycle?.current || '').toLowerCase() === status
          );
        }
        if (ctx.params.kind) {
          const kind = String(ctx.params.kind || '')
            .trim()
            .toLowerCase();
          docs = docs.filter((doc) => String(doc.kind || '').toLowerCase() === kind);
        }

        docs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const filterHash = buildFilterHash({
          projectId: ctx.params.projectId,
          status: ctx.params.status || null,
          kind: ctx.params.kind || null,
        });

        const page = applyCursorPagination({
          items: docs,
          limit: ctx.params.limit,
          cursor: ctx.params.cursor,
          offset: ctx.params.offset,
          tenantId,
          filterHash,
        });

        return {
          success: true,
          projectId: ctx.params.projectId,
          items: page.data.map((doc) => this.toPublicDecision(doc)),
          pageInfo: page.pageInfo,
        };
      },
    },

    getDecision: {
      rest: {
        method: 'GET',
        path: '/decisions/:id',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get NOVA decision by id',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', example: 'dec_a1b2c3d4_SUB_1_QU' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = await this.assertProjectTenantBinding(
          ctx.params.projectId,
          resolveTenantId(ctx)
        );
        const doc = await this.getDecisionDocById(ctx.params.id, tenantId, ctx.params.projectId);
        if (!doc) {
          throw new MoleculerError('Decision not found', 404, 'NOVA_DECISION_NOT_FOUND');
        }
        return { success: true, decision: this.toPublicDecision(doc) };
      },
    },

    approveDecision: {
      rest: {
        method: 'POST',
        path: '/decisions/:id/approve',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
        comment: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Approve NOVA decision',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'id'],
                properties: {
                  projectId: {
                    type: 'string',
                    example: 'a1b2c3d4-0000-0000-0000-000000000001',
                  },
                  id: { type: 'string', example: 'dec_a1b2c3d4_SUB_1_QU' },
                  comment: { type: 'string', example: 'Approved via HITL' },
                },
              },
              examples: {
                default: {
                  value: {
                    projectId: 'a1b2c3d4-0000-0000-0000-000000000001',
                    id: 'dec_a1b2c3d4_SUB_1_QU',
                    comment: 'Approved via HITL',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = await this.assertProjectTenantBinding(
          ctx.params.projectId,
          resolveTenantId(ctx)
        );
        const doc = await this.getDecisionDocById(ctx.params.id, tenantId, ctx.params.projectId);
        if (!doc) {
          throw new MoleculerError('Decision not found', 404, 'NOVA_DECISION_NOT_FOUND');
        }

        let updated = doc;
        if (updated.lifecycle?.current === DECISION_STATES.PROPOSED) {
          updated = await this.transitionDecisionLifecycle(updated, DECISION_STATES.TRIAGED, {
            actor: 'nova.approveDecision',
            reason: 'manual-approval',
          });
        }
        if (updated.lifecycle?.current === DECISION_STATES.TRIAGED) {
          updated = await this.transitionDecisionLifecycle(
            updated,
            DECISION_STATES.PENDING_APPROVAL,
            {
              actor: 'nova.approveDecision',
              reason: 'manual-approval',
            }
          );
        }
        if (updated.lifecycle?.current === DECISION_STATES.PENDING_APPROVAL) {
          updated = await this.transitionDecisionLifecycle(updated, DECISION_STATES.APPROVED, {
            actor: 'nova.approveDecision',
            reason: ctx.params.comment || 'approved-via-api',
          });
        }

        await this.broker.call(
          'nova.apply',
          { projectId: ctx.params.projectId, id: ctx.params.id },
          { meta: { ...(ctx.meta || {}), tenantId } }
        );

        return { success: true, decision: this.toPublicDecision(updated) };
      },
    },

    rejectDecision: {
      rest: {
        method: 'POST',
        path: '/decisions/:id/reject',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
        reason: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Reject NOVA decision',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'id'],
                properties: {
                  projectId: {
                    type: 'string',
                    example: 'a1b2c3d4-0000-0000-0000-000000000001',
                  },
                  id: { type: 'string', example: 'dec_a1b2c3d4_SUB_1_QU' },
                  reason: { type: 'string', example: 'Insufficient evidence' },
                },
              },
              examples: {
                default: {
                  value: {
                    projectId: 'a1b2c3d4-0000-0000-0000-000000000001',
                    id: 'dec_a1b2c3d4_SUB_1_QU',
                    reason: 'Insufficient evidence',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = await this.assertProjectTenantBinding(
          ctx.params.projectId,
          resolveTenantId(ctx)
        );
        const doc = await this.getDecisionDocById(ctx.params.id, tenantId, ctx.params.projectId);
        if (!doc) {
          throw new MoleculerError('Decision not found', 404, 'NOVA_DECISION_NOT_FOUND');
        }

        if (FINAL_STATES.has(doc.lifecycle?.current)) {
          return { success: true, decision: this.toPublicDecision(doc), unchanged: true };
        }

        const updated = await this.transitionDecisionLifecycle(doc, DECISION_STATES.REJECTED, {
          actor: 'nova.rejectDecision',
          reason: ctx.params.reason || 'rejected-via-api',
        });

        if (updated.hitlItemId) {
          await this.safeResolveHitl(
            updated.hitlItemId,
            'reject',
            ctx.params.reason || 'Rejected in NOVA'
          );
        }

        return { success: true, decision: this.toPublicDecision(updated) };
      },
    },

    decisionStats: {
      rest: {
        method: 'GET',
        path: '/decisions/stats',
      },
      params: {
        projectId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'NOVA decision status counts',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = await this.assertProjectTenantBinding(
          ctx.params.projectId,
          resolveTenantId(ctx)
        );
        const docs = await this.listProjectDecisions(tenantId, ctx.params.projectId);

        const counts = {
          proposed: 0,
          triaged: 0,
          pending_approval: 0,
          approved: 0,
          applied: 0,
          rejected: 0,
          expired: 0,
        };

        for (const doc of docs) {
          const current = String(doc.lifecycle?.current || '').toLowerCase();
          if (Object.prototype.hasOwnProperty.call(counts, current)) {
            counts[current] += 1;
          }
        }

        return {
          success: true,
          tenantId,
          projectId: ctx.params.projectId,
          total: docs.length,
          counts,
        };
      },
    },

    replayTrigger: {
      rest: {
        method: 'POST',
        path: '/decisions/:id/replay-trigger',
      },
      params: {
        projectId: { type: 'string', min: 1 },
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Replay NOVA decision trigger source (async)',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'id'],
                properties: {
                  projectId: {
                    type: 'string',
                    example: 'a1b2c3d4-0000-0000-0000-000000000001',
                  },
                  id: { type: 'string', example: 'dec_a1b2c3d4_SUB_1_QU' },
                },
              },
              examples: {
                default: {
                  value: {
                    projectId: 'a1b2c3d4-0000-0000-0000-000000000001',
                    id: 'dec_a1b2c3d4_SUB_1_QU',
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Replay accepted as async job',
          },
        },
      },
      async handler(ctx) {
        const tenantId = await this.assertProjectTenantBinding(
          ctx.params.projectId,
          resolveTenantId(ctx)
        );
        const asyncCtx = {
          ...ctx,
          meta: {
            ...(ctx.meta || {}),
            tenantId,
            $gateway: true,
          },
        };

        return runAsync(asyncCtx, {
          service: 'nova',
          action: 'replayTrigger',
          params: ctx.params,
          worker: async () => {
            const doc = await this.getDecisionDocById(
              ctx.params.id,
              tenantId,
              ctx.params.projectId
            );
            if (!doc) {
              throw new MoleculerError('Decision not found', 404, 'NOVA_DECISION_NOT_FOUND');
            }
            const replayResult = await this.reconstructDecision(doc);
            return { success: true, decisionId: doc.id, replay: replayResult };
          },
        });
      },
    },

    /**
     * GET /api/nova/stream
     */
    stream: {
      rest: {
        method: 'GET',
        path: '/stream',
      },
      params: {
        projectId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'NOVA realtime stream (SSE)',
        tags: [OPENAPI_TAG],
        description:
          'Server-Sent Events endpoint with tenant isolation and optional project-scoped filtering.',
        parameters: [
          {
            in: 'query',
            name: 'projectId',
            required: false,
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
      },
      handler(ctx) {
        const stream = new PassThrough();
        const tenantId = resolveTenantId(ctx);
        const projectId = ctx.params.projectId || null;

        ctx.meta.$responseType = 'text/event-stream';
        ctx.meta.$responseHeaders = {
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        };

        const client = {
          stream,
          keepAliveTimer: null,
          tenantId,
          projectId,
        };

        const cleanup = () => {
          if (client.keepAliveTimer) clearInterval(client.keepAliveTimer);
          this.sseClients.delete(client);
          if (!stream.destroyed) stream.end();
        };

        client.keepAliveTimer = setInterval(() => {
          if (!stream.destroyed) stream.write(': keep-alive\n\n');
        }, 15000);

        this.sseClients.add(client);

        // Initial handshake event
        stream.write(
          `event: connected\ndata: ${JSON.stringify({ success: true, tenantId, projectId })}\n\n`
        );

        const req = ctx.meta.$req;
        if (req && typeof req.on === 'function') {
          req.on('close', cleanup);
          req.on('aborted', cleanup);
        }
        stream.on('close', cleanup);
        stream.on('error', cleanup);

        return stream;
      },
    },
  },

  methods: {
    nowIso() {
      return new Date().toISOString();
    },

    makeDecisionExpiry() {
      const hours = Number(this.settings.decisionTtlHours || DEFAULT_DECISION_TTL_HOURS);
      return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    },

    projectBindingId(projectId) {
      return `${DOC_PREFIX_PROJECT_BINDING}${projectId}`;
    },

    decisionDocId(id) {
      return `${DOC_PREFIX_DECISION}${id}`;
    },

    resolveDecisionKind(decisionType) {
      if (decisionType === 'QU') return 'threshold_update';
      if (decisionType === 'rONT') return 'asset_override';
      if (decisionType === 'RD_CURTAILMENT') return 'settlement_correction';
      return 'other';
    },

    shouldRequireHitl(kind, decision) {
      if (kind === 'asset_override' && decision?.capex >= 5000) return true;
      return DECISION_KINDS_WITH_HITL.has(kind);
    },

    toPublicDecision(doc) {
      const legacy = doc?.proposal?.decision || {};
      return {
        id: doc.id,
        kind: doc.kind,
        type: legacy.type || null,
        gridNode: legacy.gridNode || null,
        description: legacy.description || null,
        capex: Number.isFinite(legacy.capex) ? legacy.capex : 0,
        capacity_gain_kw: Number.isFinite(legacy.capacity_gain_kw) ? legacy.capacity_gain_kw : 0,
        source: doc.source,
        proposal: doc.proposal,
        lifecycle: doc.lifecycle,
        tenantId: doc.tenantId,
        projectId: doc.projectId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        expiresAt: doc.expiresAt,
        hitlItemId: doc.hitlItemId || null,
        agent_interventions: Array.isArray(doc.agent_interventions) ? doc.agent_interventions : [],
      };
    },

    async assertProjectTenantBinding(projectId, tenantId) {
      const resolvedTenantId = tenantId || 'default';
      const id = this.projectBindingId(projectId);

      let binding = null;
      try {
        binding = await this.db.get(id);
      } catch (err) {
        if (err?.status !== 404) throw err;
      }

      if (!binding) {
        const createdAt = this.nowIso();
        const doc = {
          _id: id,
          type: 'nova-project-binding',
          projectId,
          tenantId: resolvedTenantId,
          createdAt,
          updatedAt: createdAt,
        };
        await this.db.put(doc);
        return resolvedTenantId;
      }

      if (binding.tenantId !== resolvedTenantId) {
        throw new MoleculerError('Project tenant mismatch', 403, 'NOVA_PROJECT_TENANT_MISMATCH', {
          projectId,
          tenantId: resolvedTenantId,
        });
      }

      return resolvedTenantId;
    },

    async getDecisionDocById(id, tenantId, projectId) {
      try {
        const doc = await this.db.get(this.decisionDocId(id));
        if (doc.type !== 'nova-decision') return null;
        if (tenantId && doc.tenantId !== tenantId) return null;
        if (projectId && doc.projectId !== projectId) return null;
        return doc;
      } catch (err) {
        if (err?.status === 404) return null;
        throw err;
      }
    },

    async listAllDecisionDocs() {
      const rows = await this.db.allDocs({ include_docs: true });
      return rows.rows.map((row) => row.doc).filter((doc) => doc && doc.type === 'nova-decision');
    },

    async listProjectDecisions(tenantId, projectId) {
      const all = await this.listAllDecisionDocs();
      return all.filter((doc) => doc.tenantId === tenantId && doc.projectId === projectId);
    },

    async storeDecisionDoc(doc) {
      const existing = await this.getDecisionDocById(doc.id, doc.tenantId, doc.projectId);
      if (existing?._rev) {
        return this.db.put({ ...doc, _id: existing._id, _rev: existing._rev });
      }
      return this.db.put({ ...doc, _id: this.decisionDocId(doc.id) });
    },

    async upsertHeuristicDecision(projectId, tenantId, decision) {
      const existing = await this.getDecisionDocById(decision.id, tenantId, projectId);
      if (existing) return existing;

      const createdAt = this.nowIso();
      const kind = this.resolveDecisionKind(decision.type);
      let doc = {
        _id: this.decisionDocId(decision.id),
        id: decision.id,
        type: 'nova-decision',
        kind,
        source: {
          service: 'nova',
          action: 'pendingDecisions',
          evidence: [
            {
              projectId,
              substationKey: decision.substationKey,
              decisionType: decision.type,
            },
          ],
        },
        proposal: {
          field: 'znp_graph_adjustment',
          value: {
            type: decision.type,
            gridNode: decision.gridNode,
            capex: decision.capex,
            capacity_gain_kw: decision.capacity_gain_kw,
          },
          previousValue: null,
          decision,
        },
        tenantId,
        projectId,
        hitlItemId: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt: this.makeDecisionExpiry(),
        lifecycle: initLifecycle(),
        agent_interventions: [],
      };

      doc = transition(doc, DECISION_STATES.TRIAGED, 'nova', 'heuristic-triage');
      doc = transition(doc, DECISION_STATES.PENDING_APPROVAL, 'nova', 'awaiting-approval');

      if (this.shouldRequireHitl(kind, decision)) {
        doc.hitlItemId = await this.createHitlItemForDecision(doc);
      }

      await this.db.put(doc);
      await this.emitDecisionEvent('decision.proposed', doc, { reason: 'heuristic-created' });
      return doc;
    },

    async transitionDecisionLifecycle(doc, nextState, { actor = 'nova', reason = null } = {}) {
      if (!doc || FINAL_STATES.has(doc.lifecycle?.current)) return doc;

      let updated;
      try {
        updated = transition(doc, nextState, actor, reason);
      } catch (err) {
        if (err?.code === 'NOVA_INVALID_TRANSITION') {
          return doc;
        }
        throw err;
      }

      updated.agent_interventions = Array.isArray(updated.agent_interventions)
        ? updated.agent_interventions
        : [];
      updated.agent_interventions.push({
        at: updated.updatedAt,
        action: `lifecycle:${nextState}`,
        actor,
        comment: reason,
      });

      await this.storeDecisionDoc(updated);

      const eventName = `decision.${nextState}`;
      await this.emitDecisionEvent(eventName, updated, { reason });
      return updated;
    },

    async createHitlItemForDecision(doc) {
      try {
        const response = await this.broker.call(
          'hitl.create',
          {
            kind: 'nova-decision-approval',
            payload: {
              decisionId: doc.id,
              projectId: doc.projectId,
              kind: doc.kind,
              proposal: doc.proposal,
            },
            originService: 'nova',
            originAction: 'pendingDecisions',
            severity: 'warning',
            requiredScope: 'hitl-approver',
          },
          {
            meta: {
              tenantId: doc.tenantId,
            },
          }
        );

        return response?.item?.id || null;
      } catch (err) {
        this.logger.warn(`[nova] hitl.create failed for decision ${doc.id}: ${err.message}`);
        return null;
      }
    },

    async safeResolveHitl(hitlItemId, action, comment) {
      if (!hitlItemId) return;
      try {
        await this.broker.call(`hitl.${action}`, {
          id: hitlItemId,
          comment,
        });
      } catch (err) {
        this.logger.warn(`[nova] hitl.${action} failed for ${hitlItemId}: ${err.message}`);
      }
    },

    async emitDecisionEvent(eventName, doc, extra = {}) {
      const payload = {
        eventId: crypto.randomUUID(),
        tenantId: doc.tenantId,
        projectId: doc.projectId,
        decisionId: doc.id,
        kind: doc.kind,
        status: doc.lifecycle?.current,
        source: doc.source,
        proposal: doc.proposal,
        timestamp: this.nowIso(),
        ...extra,
      };

      this.broadcastSSE(eventName, payload, {
        tenantId: doc.tenantId,
        projectId: doc.projectId,
      });

      this.broker.emit(eventName, payload);
    },

    async ingestSignalDecision({ tenantId, projectId, kind, source, proposal }) {
      if (!projectId) return null;
      await this.assertProjectTenantBinding(projectId, tenantId || 'default');

      const idInput = JSON.stringify({ projectId, kind, source, proposal });
      const id = `dec_${crypto.createHash('sha256').update(idInput).digest('hex').slice(0, 8)}`;
      const existing = await this.getDecisionDocById(id, tenantId, projectId);
      if (existing) return existing;

      const createdAt = this.nowIso();
      let doc = {
        _id: this.decisionDocId(id),
        id,
        type: 'nova-decision',
        kind,
        source,
        proposal,
        tenantId,
        projectId,
        hitlItemId: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt: this.makeDecisionExpiry(),
        lifecycle: initLifecycle(),
        agent_interventions: [],
      };

      doc = transition(doc, DECISION_STATES.TRIAGED, 'nova.signal', 'signal-triaged');
      doc = transition(
        doc,
        DECISION_STATES.PENDING_APPROVAL,
        'nova.signal',
        'signal-awaiting-approval'
      );

      if (this.shouldRequireHitl(kind)) {
        doc.hitlItemId = await this.createHitlItemForDecision(doc);
      }

      await this.db.put(doc);
      await this.emitDecisionEvent('decision.proposed', doc, { reason: 'signal-ingested' });
      return doc;
    },

    async reconstructDecision(doc) {
      const result = {
        source: doc.source,
        matched: false,
        generatedAt: this.nowIso(),
      };

      if (doc.source?.service === 'nova' && doc.source?.action === 'pendingDecisions') {
        const recomputed = await this.analyseProjectForPendingDecisions(doc.projectId);
        const match = recomputed.find((entry) => entry.id === doc.id);
        result.matched = Boolean(match);
        result.recomputed = match || null;
      } else {
        result.matched = true;
      }

      doc.agent_interventions = Array.isArray(doc.agent_interventions)
        ? doc.agent_interventions
        : [];
      doc.agent_interventions.push({
        at: this.nowIso(),
        action: 'replay-trigger',
        actor: 'nova.replayTrigger',
        comment: result.matched ? 'replay-reconstructed' : 'replay-source-not-found',
      });
      doc.updatedAt = this.nowIso();
      await this.storeDecisionDoc(doc);

      return result;
    },

    async expireDueDecisions() {
      const now = Date.now();
      const docs = await this.listAllDecisionDocs();
      for (const doc of docs) {
        if (FINAL_STATES.has(doc.lifecycle?.current)) continue;
        const expiresAtMs = Date.parse(doc.expiresAt || '');
        if (!Number.isFinite(expiresAtMs) || expiresAtMs > now) continue;

        await this.transitionDecisionLifecycle(doc, DECISION_STATES.EXPIRED, {
          actor: 'nova.expiry',
          reason: 'decision-ttl-expired',
        });
      }
    },

    getZnpService() {
      const znpService = this.broker.services.find((service) => service.name === 'znp');
      if (!znpService) {
        throw new MoleculerError(
          'Service "znp" is required for NOVA graph analysis but is not available.',
          503,
          'NOVA_ZNP_SERVICE_UNAVAILABLE'
        );
      }
      return znpService;
    },

    async getProjectGraph(projectId) {
      const znpService = this.getZnpService();
      if (typeof znpService.getProject !== 'function') {
        throw new MoleculerError(
          'znp.getProject method is unavailable for NOVA analysis.',
          500,
          'NOVA_ZNP_PROJECT_ACCESS_UNAVAILABLE'
        );
      }

      if (typeof znpService.ensureProjectHydrated === 'function') {
        await znpService.ensureProjectHydrated(projectId);
      }

      const project = znpService.getProject(projectId);
      return {
        graph: project.graph,
        znpService,
      };
    },

    listSubstationKeys(graph) {
      const keys = [];
      graph.forEachNode((nodeKey, attrs) => {
        const type = String(attrs.type || '').toLowerCase();
        if (type === 'substation') keys.push(nodeKey);
      });
      return keys;
    },

    async analyseProjectForPendingDecisions(projectId) {
      const { graph } = await this.getProjectGraph(projectId);
      const decisions = [];
      const substationKeys = this.listSubstationKeys(graph);

      for (const substationKey of substationKeys) {
        const profile = await this.buildSubstationProfile(projectId, graph, substationKey);
        if (!profile.isOverloaded) continue;

        const quGain = Math.round(profile.pvEffectiveKW * QU_GAIN_FACTOR * 1000) / 1000;
        if (quGain > 0 && quGain >= profile.overloadKW) {
          decisions.push({
            id: `dec_${projectId}_${substationKey}_QU`,
            type: 'QU',
            gridNode: substationKey,
            substationKey,
            description: 'Aktivierung Q(U)-Regelung für PV-Wechselrichter.',
            capex: 0,
            capacity_gain_kw: quGain,
          });
        }

        const rontGainRaw =
          profile.pvEffectiveKW * RONT_PV_GAIN_FACTOR +
          profile.wpEvEffectiveKW * RONT_WPEV_GAIN_FACTOR;
        const rontGain = Math.round(rontGainRaw * 1000) / 1000;
        if (rontGain > 0 && rontGain >= profile.overloadKW) {
          decisions.push({
            id: `dec_${projectId}_${substationKey}_rONT`,
            type: 'rONT',
            gridNode: substationKey,
            substationKey,
            description: 'Austausch SONT gegen rONT. Hebt PV-Kapazität um ca. 50%.',
            capex: RONT_CAPEX_EUR,
            capacity_gain_kw: rontGain,
          });
        }

        const rdGainRaw = profile.redispatchEligibleEffectiveKW * RD_CURTAILMENT_FACTOR;
        const rdGain = Math.round(rdGainRaw * 1000) / 1000;
        if (rdGain > 0 && rdGain >= profile.overloadKW) {
          decisions.push({
            id: `dec_${projectId}_${substationKey}_RD_CURTAILMENT`,
            type: 'RD_CURTAILMENT',
            gridNode: substationKey,
            substationKey,
            description:
              `${profile.redispatchAssetCount} Redispatch-fähige Großanlagen (>100 kW) ` +
              `am Trafo identifiziert. Abregelung um 30% entspannt den Netzknoten ` +
              `um ${rdGain} kW.`,
            capex: 0,
            capacity_gain_kw: rdGain,
            redispatchAssetKeys: profile.redispatchAssetKeys,
          });
        }
      }

      return decisions;
    },

    async buildSubstationProfile(projectId, graph, substationKey) {
      const znpResult = await this.broker.call('znp.calculateGFactor', {
        projectId,
        substationId: substationKey,
        target_layer: 1,
      });

      const assets = this.collectAssetsBySubstationTraversal(graph, substationKey);
      let pvEffectiveKW = 0;
      let wpEvEffectiveKW = 0;
      let redispatchEligibleEffectiveKW = 0;
      let redispatchAssetCount = 0;
      const redispatchAssetKeys = [];

      for (const asset of assets) {
        const gFactor = this.resolveContributionGFactor(
          graph,
          asset.nodeKey,
          substationKey,
          asset.attrs
        );
        const effectiveKW = (asset.capacityKW || 0) * gFactor;

        if (this.isPvAsset(asset.attrs)) pvEffectiveKW += effectiveKW;
        if (this.isWpEvAsset(asset.attrs)) wpEvEffectiveKW += effectiveKW;
        if (this.isRedispatchEligibleAsset(asset.attrs)) {
          redispatchEligibleEffectiveKW += effectiveKW;
          redispatchAssetCount += 1;
          redispatchAssetKeys.push(asset.nodeKey);
        }
      }

      const thermalLimitKW = this.resolveSubstationThermalLimit(graph, substationKey);
      if (!Number.isFinite(thermalLimitKW) || thermalLimitKW <= 0) {
        return {
          isOverloaded: false,
          overloadKW: 0,
          pvEffectiveKW,
          wpEvEffectiveKW,
          redispatchEligibleEffectiveKW,
          redispatchAssetCount,
          redispatchAssetKeys,
        };
      }

      const overloadKW = Math.max(0, znpResult.adjustedCapacityKW - thermalLimitKW);

      return {
        isOverloaded: overloadKW > 0,
        overloadKW,
        pvEffectiveKW,
        wpEvEffectiveKW,
        redispatchEligibleEffectiveKW,
        redispatchAssetCount,
        redispatchAssetKeys,
      };
    },

    collectAssetsBySubstationTraversal(graph, startSubstationKey) {
      const queue = [startSubstationKey];
      const visitedSubstations = new Set([startSubstationKey]);
      const assets = [];
      const seenAssets = new Set();

      while (queue.length > 0) {
        const nodeKey = queue.shift();

        graph.forEachInEdge(nodeKey, (_edgeKey, edgeAttrs, sourceKey) => {
          if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
          if (!graph.hasNode(sourceKey)) return;

          const sourceAttrs = graph.getNodeAttributes(sourceKey);
          const sourceType = String(sourceAttrs.type || '').toLowerCase();

          if (sourceType === 'substation') {
            if (!visitedSubstations.has(sourceKey)) {
              visitedSubstations.add(sourceKey);
              queue.push(sourceKey);
            }
            return;
          }

          if (sourceType !== 'mastr_asset') return;
          if (seenAssets.has(sourceKey)) return;
          seenAssets.add(sourceKey);

          assets.push({
            nodeKey: sourceKey,
            attrs: sourceAttrs,
            capacityKW: this.resolveAssetCapacityKW(sourceAttrs),
          });
        });
      }

      return assets;
    },

    resolveContributionGFactor(graph, assetKey, substationKey, assetAttrs) {
      const edgeKey = graph.edge(assetKey, substationKey);
      if (!edgeKey) return 1.0;
      const edgeAttrs = graph.getEdgeAttributes(edgeKey);
      const edgeGFactor = Number.isFinite(edgeAttrs.gFactor) ? edgeAttrs.gFactor : 1.0;
      const normalizedEdgeGFactor = Math.max(0, Math.min(1, edgeGFactor));

      if (assetAttrs && assetAttrs.section14a === true && normalizedEdgeGFactor > 0.45) {
        return 0.45;
      }

      return normalizedEdgeGFactor;
    },

    resolveSubstationThermalLimit(graph, substationKey) {
      if (!graph.hasNode(substationKey)) return null;
      const attrs = graph.getNodeAttributes(substationKey);
      const keys = ['thermalLimitKW', 'capacity_kw', 'capacityKW', 'maxCapacityKW'];
      for (const key of keys) {
        if (Number.isFinite(attrs[key])) {
          return attrs[key];
        }
      }
      return null;
    },

    isPvAsset(assetAttrs) {
      const assetType = String(assetAttrs.assetType || '').toLowerCase();
      return /(solar|pv|photovoltaik)/.test(assetType);
    },

    isWpEvAsset(assetAttrs) {
      const assetType = String(assetAttrs.assetType || '').toLowerCase();
      return /(wallbox|ev|e-?mob|heatpump|wärmepumpe|waermepumpe)/.test(assetType);
    },

    resolveAssetCapacityKW(assetAttrs) {
      if (Number.isFinite(assetAttrs.capacity_kw)) return assetAttrs.capacity_kw;
      return Number(assetAttrs.capacity || 0);
    },

    isRedispatchEligibleAsset(assetAttrs) {
      return isRedispatchEligibleCapacityOnly(assetAttrs);
    },

    applyQuRegulationDecision(graph, substationKey) {
      if (!graph.hasNode(substationKey)) return;

      graph.setNodeAttribute(substationKey, 'is_qu_regulated', true);
      graph.setNodeAttribute(substationKey, 'quRegulationAppliedAt', new Date().toISOString());

      graph.forEachInEdge(substationKey, (edgeKey, edgeAttrs, sourceKey) => {
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
        const sourceAttrs = graph.getNodeAttributes(sourceKey);
        if (!this.isPvAsset(sourceAttrs)) return;

        const sourceCapacity = Number(sourceAttrs.capacity || 0);
        const boost = Math.round(sourceCapacity * QU_GAIN_FACTOR * 1000) / 1000;
        const currentBoost = Number(graph.getEdgeAttribute(edgeKey, 'capacity_boost_kw') || 0);
        graph.setEdgeAttribute(
          edgeKey,
          'capacity_boost_kw',
          Math.round((currentBoost + boost) * 1000) / 1000
        );
      });
    },

    applyRontDecision(graph, substationKey, capacityGainKW) {
      if (!graph.hasNode(substationKey)) return;

      graph.setNodeAttribute(substationKey, 'is_rONT', true);
      graph.setNodeAttribute(substationKey, 'rONTAppliedAt', new Date().toISOString());

      const attrs = graph.getNodeAttributes(substationKey);
      const limitKey = Number.isFinite(attrs.thermalLimitKW)
        ? 'thermalLimitKW'
        : Number.isFinite(attrs.capacity_kw)
          ? 'capacity_kw'
          : Number.isFinite(attrs.capacityKW)
            ? 'capacityKW'
            : Number.isFinite(attrs.maxCapacityKW)
              ? 'maxCapacityKW'
              : 'thermalLimitKW';
      const currentLimit = Number(attrs[limitKey] || 0);
      graph.setNodeAttribute(
        substationKey,
        limitKey,
        Math.round((currentLimit + capacityGainKW) * 1000) / 1000
      );

      graph.forEachInEdge(substationKey, (edgeKey, edgeAttrs, sourceKey) => {
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') return;
        const sourceAttrs = graph.getNodeAttributes(sourceKey);
        const sourceCapacity = Number(sourceAttrs.capacity || 0);

        let multiplier = 0;
        if (this.isPvAsset(sourceAttrs)) {
          multiplier = RONT_PV_GAIN_FACTOR;
        } else if (this.isWpEvAsset(sourceAttrs)) {
          multiplier = RONT_WPEV_GAIN_FACTOR;
        }
        if (multiplier <= 0) return;

        const additionalCapacity = Math.round(sourceCapacity * multiplier * 1000) / 1000;
        const currentCapacity = Number(
          graph.getEdgeAttribute(edgeKey, 'capacity_kw') || sourceCapacity
        );
        graph.setEdgeAttribute(
          edgeKey,
          'capacity_kw',
          Math.round((currentCapacity + additionalCapacity) * 1000) / 1000
        );
        graph.setEdgeAttribute(edgeKey, 'is_rONT_applied', true);
      });
    },

    applyRdCurtailmentDecision(graph, substationKey, redispatchAssetKeys) {
      if (!graph.hasNode(substationKey)) return;

      const eligibleKeys = Array.isArray(redispatchAssetKeys) ? redispatchAssetKeys : [];

      for (const assetKey of eligibleKeys) {
        if (!graph.hasNode(assetKey)) continue;
        const attrs = graph.getNodeAttributes(assetKey);
        if (!this.isRedispatchEligibleAsset(attrs)) continue;

        const edgeKey = graph.edge(assetKey, substationKey);
        if (!edgeKey) continue;
        const edgeAttrs = graph.getEdgeAttributes(edgeKey);
        if (edgeAttrs.relationship !== 'CONTRIBUTES_LOAD') continue;

        graph.setEdgeAttribute(edgeKey, 'gFactor', 0.7);
        graph.setEdgeAttribute(edgeKey, 'is_rd_curtailed', true);
        graph.setNodeAttribute(assetKey, 'is_rd_curtailed', true);
      }
    },

    broadcastSSE(eventName, payload, scope = {}) {
      if (!this.sseClients.size) return;
      const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
      const expectedTenant = scope.tenantId || null;
      const expectedProject = scope.projectId || null;

      for (const client of this.sseClients) {
        if (expectedTenant && client.tenantId && client.tenantId !== expectedTenant) {
          continue;
        }
        if (expectedProject && client.projectId && client.projectId !== expectedProject) {
          continue;
        }

        if (!client.stream.destroyed) {
          try {
            client.stream.write(frame);
          } catch (_) {
            if (client.keepAliveTimer) clearInterval(client.keepAliveTimer);
            this.sseClients.delete(client);
          }
        }
      }
    },
  },
};
