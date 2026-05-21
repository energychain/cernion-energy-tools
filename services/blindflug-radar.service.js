'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  ROLE_KAUFMAENNISCHE_LEITUNG,
  ROLE_NETZPLANUNG,
} = require('../src/interface-placeholder-schema');
const {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MIN_EVENTS,
  DEFAULT_WINDOW_DAYS,
  buildSignalsFromEvents,
  buildInvestmentProposals,
} = require('../src/disturbance-schema');

const OPENAPI_TAG = 'Blindflug Radar';
const DOC_PREFIX = 'bfr:';
const HIGH_VALUE_THRESHOLD_EUR = 1_000_000;

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'blindflug-radar',

  settings: {
    dbPath: process.env.BLINDFLUG_RADAR_DB_PATH || './data/blindflug-radar',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    this.logger.info(`Blindflug Radar DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    scanBlindflug: {
      rest: 'POST /scan',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        projectId: { type: 'string', optional: true },
        watchIds: { type: 'array', items: 'string', optional: true, default: [] },
        timeWindowDays: {
          type: 'number',
          optional: true,
          default: DEFAULT_WINDOW_DAYS,
          min: 7,
          max: 365,
          convert: true,
        },
        minEvents: {
          type: 'number',
          optional: true,
          default: DEFAULT_MIN_EVENTS,
          min: 2,
          max: 20,
          convert: true,
        },
        confidenceThreshold: {
          type: 'number',
          optional: true,
          default: DEFAULT_CONFIDENCE_THRESHOLD,
          min: 0.5,
          max: 1,
          convert: true,
        },
      },
      openapi: {
        summary: 'Scan disturbance patterns and generate Blindflug-Radar signals',
        tags: [OPENAPI_TAG],
        description:
          'Collects Redispatch Ex-Post audits, MaStR monitor deltas, and quality findings, then ' +
          'builds deterministic disturbance signals (`DISTURBANCE_PATTERN`, `REPEATING_FAULT`) ' +
          'for investment-oriented planning.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperatorId: { type: 'string', example: 'SNB123456789000' },
                  projectId: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
                  watchIds: {
                    type: 'array',
                    default: [],
                    items: { type: 'string', example: 'twl-monitor-main' },
                  },
                  timeWindowDays: { type: 'number', default: 90 },
                  minEvents: { type: 'number', default: 3 },
                  confidenceThreshold: { type: 'number', default: 0.7 },
                },
              },
              examples: {
                default: {
                  value: {
                    gridOperatorId: 'SNB123456789000',
                    projectId: 'a1b2c3d4-0000-0000-0000-000000000001',
                    watchIds: ['twl-monitor-main'],
                    timeWindowDays: 90,
                    minEvents: 3,
                    confidenceThreshold: 0.72,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const createdAt = nowIso();
        const scanId = crypto.randomUUID();

        const sourceData = await this.collectSourceData(ctx, {
          gridOperatorId: ctx.params.gridOperatorId,
          watchIds: ctx.params.watchIds,
        });

        const signals = buildSignalsFromEvents({
          events: sourceData.events,
          now: createdAt,
          minEvents: ctx.params.minEvents,
          windowDays: ctx.params.timeWindowDays,
        });

        const znpContext = await this.resolveZnpContext(ctx, {
          projectId: ctx.params.projectId,
        });

        const proposals = buildInvestmentProposals({
          signals,
          confidenceThreshold: ctx.params.confidenceThreshold,
        }).map((proposal) => ({
          ...proposal,
          znpProjectId: znpContext.projectId || null,
          znpOverallScore: znpContext.overallScore,
          znpDecisionStatus: znpContext.decisionStatus,
        }));

        const hitlItems = await this.createAutoProposalHitlItems(ctx, {
          scanId,
          confidenceThreshold: ctx.params.confidenceThreshold,
          proposals,
        });

        const placeholders = await this.ensureEvidencePlaceholder(ctx, {
          signals,
          znpContext,
          confidenceThreshold: ctx.params.confidenceThreshold,
        });

        const decisionStatus = placeholders.length > 0 ? 'blocked' : 'ready';

        const doc = {
          _id: `${DOC_PREFIX}${scanId}`,
          id: scanId,
          type: 'blindflug-radar-scan',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId || null,
          projectId: znpContext.projectId || null,
          signalPolicy: {
            minEvents: ctx.params.minEvents,
            timeWindowDays: ctx.params.timeWindowDays,
            confidenceThreshold: ctx.params.confidenceThreshold,
          },
          sourceSummary: sourceData.summary,
          signals,
          proposals,
          hitlItemIds: hitlItems.map((item) => item.id),
          placeholders,
          znpContext,
          decisionStatus,
          createdAt,
          updatedAt: createdAt,
        };

        await this.db.put(doc);

        return {
          success: true,
          id: scanId,
          ...this.toPublic(doc),
          hitlItems,
        };
      },
    },

    recommendFromDisturbances: {
      rest: 'POST /recommendations',
      params: {
        scanId: { type: 'string', optional: true },
        confidenceThreshold: {
          type: 'number',
          optional: true,
          default: DEFAULT_CONFIDENCE_THRESHOLD,
          min: 0.5,
          max: 1,
          convert: true,
        },
      },
      openapi: {
        summary: 'Get confidence-threshold auto-proposals from disturbance signals',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  scanId: { type: 'string', example: 'bfr-2026-04-18-001' },
                  confidenceThreshold: { type: 'number', default: 0.7 },
                },
              },
              examples: {
                default: {
                  value: {
                    scanId: 'c73c2f77-5535-4ca4-a5cc-9038a6a75d9f',
                    confidenceThreshold: 0.75,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);

        const doc = ctx.params.scanId
          ? await this.getDocOrThrow(ctx.params.scanId, tenantId)
          : await this.getLatestDocOrThrow(tenantId);

        const proposals = buildInvestmentProposals({
          signals: doc.signals || [],
          confidenceThreshold: ctx.params.confidenceThreshold,
        }).map((proposal) => ({
          ...proposal,
          znpProjectId: doc.projectId || null,
          znpOverallScore: doc.znpContext?.overallScore ?? null,
          znpDecisionStatus: doc.znpContext?.decisionStatus ?? null,
        }));

        return {
          success: true,
          sourceScanId: doc.id,
          confidenceThreshold: ctx.params.confidenceThreshold,
          proposals,
          autoProposedCount: proposals.filter((proposal) => proposal.autoProposal).length,
        };
      },
    },

    listScans: {
      rest: 'GET /scans',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50, max: 200 },
      },
      openapi: {
        summary: 'List Blindflug-Radar scans',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB123456789000' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);

        let items = docs;
        if (ctx.params.gridOperatorId) {
          items = items.filter((doc) => doc.gridOperatorId === ctx.params.gridOperatorId);
        }

        items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const limit = Math.min(ctx.params.limit || 50, 200);

        return {
          success: true,
          count: Math.min(items.length, limit),
          scans: items.slice(0, limit).map((doc) => this.toPublic(doc)),
        };
      },
    },

    getScan: {
      rest: 'GET /scans/:id',
      params: {
        id: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get one Blindflug-Radar scan',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'c73c2f77-5535-4ca4-a5cc-9038a6a75d9f' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const doc = await this.getDocOrThrow(ctx.params.id, tenantId);
        return {
          success: true,
          scan: this.toPublic(doc),
        };
      },
    },
  },

  methods: {
    async collectSourceData(ctx, { gridOperatorId, watchIds = [] }) {
      const redispatchEvents = await this.collectRedispatchEvents(ctx, { gridOperatorId });
      const mastrEvents = await this.collectMastrDeltaEvents(ctx, { watchIds });
      const findingsEvents = await this.collectFindingEvents(ctx, { gridOperatorId });

      return {
        events: [...redispatchEvents, ...mastrEvents, ...findingsEvents],
        summary: {
          redispatchEvents: redispatchEvents.length,
          mastrDeltaEvents: mastrEvents.length,
          findingsEvents: findingsEvents.length,
        },
      };
    },

    async collectRedispatchEvents(ctx, { gridOperatorId }) {
      let list = null;
      try {
        list = await ctx.call('redispatch-expost.list', {
          gridOperatorId,
          limit: 200,
        });
      } catch (error) {
        this.logger.warn(`[blindflug-radar] redispatch-expost.list unavailable: ${error.message}`);
        return [];
      }

      return (Array.isArray(list?.audits) ? list.audits : [])
        .filter((audit) => Number(audit?.riskAssessment?.estimatedLostCompensationEur || 0) > 0)
        .map((audit) => ({
          sourceType: 'redispatch',
          timestamp: audit.createdAt,
          gridOperatorId: audit.gridOperator?.mastrId || gridOperatorId || null,
          region: audit.gridOperator?.name || null,
          groupKey:
            `redispatch:${audit.gridOperator?.mastrId || 'unknown'}:` +
            `${audit.riskAssessment?.riskLevel || 'unknown'}`,
          severity: audit.riskAssessment?.riskLevel || 'warning',
          reason: 'Redispatch compensation risk exposure',
          context: {
            estimatedLostCompensationEur: audit.riskAssessment?.estimatedLostCompensationEur || 0,
            readinessPercent: audit.settlementReadiness?.readinessPercent ?? null,
          },
        }));
    },

    async collectMastrDeltaEvents(ctx, { watchIds = [] }) {
      let watchesResult = null;
      try {
        watchesResult = await ctx.call('mastr-monitor.listWatches', {
          limit: 200,
        });
      } catch (error) {
        this.logger.warn(
          `[blindflug-radar] mastr-monitor.listWatches unavailable: ${error.message}`
        );
        return [];
      }

      const watches = Array.isArray(watchesResult?.watches) ? watchesResult.watches : [];
      const filteredWatches =
        Array.isArray(watchIds) && watchIds.length > 0
          ? watches.filter((watch) => watchIds.includes(watch.watchId || watch.id))
          : watches;

      const events = [];
      for (const watch of filteredWatches.slice(0, 20)) {
        const watchId = watch.watchId || watch.id;
        if (!watchId) continue;
        try {
          const deltaRes = await ctx.call('mastr-monitor.getDeltas', {
            watchId,
            limit: 100,
          });
          const deltas = Array.isArray(deltaRes?.deltas) ? deltaRes.deltas : [];
          for (const delta of deltas) {
            const changed = Number(delta?.summary?.changed || 0);
            const removed = Number(delta?.summary?.removed || 0);
            const pressure = changed + removed;
            if (pressure <= 0) continue;

            events.push({
              sourceType: 'mastr_monitor',
              timestamp: delta.timestamp || delta.createdAt,
              region: watch.name || watchId,
              groupKey: `mastr:${watchId}:delta_pressure`,
              severity: pressure >= 8 ? 'high' : pressure >= 4 ? 'warning' : 'info',
              reason: 'MaStR delta pressure (changed/removed assets)',
              context: {
                watchId,
                changed,
                removed,
                added: Number(delta?.summary?.added || 0),
              },
            });
          }
        } catch (error) {
          this.logger.debug(`[blindflug-radar] skip watch ${watchId}: ${error.message}`);
        }
      }

      return events;
    },

    async collectFindingEvents(ctx, { gridOperatorId }) {
      let list = null;
      try {
        list = await ctx.call('mastr-quality.list', {
          gridOperatorId,
          limit: 200,
        });
      } catch (error) {
        this.logger.warn(`[blindflug-radar] mastr-quality.list unavailable: ${error.message}`);
        return [];
      }

      const audits = Array.isArray(list?.audits) ? list.audits : [];
      return audits
        .filter((audit) => {
          const warningCount = Number(audit?.findingsCount?.warning || 0);
          const errorCount = Number(audit?.findingsCount?.error || 0);
          return warningCount + errorCount > 0;
        })
        .map((audit) => {
          const warningCount = Number(audit?.findingsCount?.warning || 0);
          const errorCount = Number(audit?.findingsCount?.error || 0);
          return {
            sourceType: 'quality_findings',
            timestamp: audit.createdAt,
            gridOperatorId: audit.gridOperator?.mastrId || gridOperatorId || null,
            region: audit.gridOperator?.name || null,
            groupKey: `findings:${audit.gridOperator?.mastrId || 'unknown'}:quality`,
            severity: errorCount > 0 ? 'error' : 'warning',
            reason: 'Persistent quality findings in MaStR audits',
            context: {
              warningCount,
              errorCount,
              qualityScore: audit.qualityScore ?? null,
              auditId: audit.id || null,
            },
          };
        });
    },

    async resolveZnpContext(ctx, { projectId }) {
      let resolvedProjectId = projectId || null;

      if (!resolvedProjectId) {
        try {
          const list = await ctx.call('znp.listProjects', {});
          const projects = Array.isArray(list?.projects) ? list.projects : [];
          resolvedProjectId = projects[0]?.projectId || null;
        } catch (error) {
          this.logger.debug(`[blindflug-radar] znp.listProjects unavailable: ${error.message}`);
        }
      }

      if (!resolvedProjectId) {
        return {
          projectId: null,
          decisionStatus: 'unknown',
          overallScore: null,
        };
      }

      try {
        const assessment = await ctx.call('znp.assessPortfolio', {
          projectId: resolvedProjectId,
          kaufmaennischeFreigabeFnav: false,
        });

        return {
          projectId: resolvedProjectId,
          decisionStatus: assessment?.decisionStatus || 'unknown',
          overallScore: assessment?.overallScore ?? null,
          portfolio: assessment?.portfolio || null,
          governance: assessment?.governance || null,
        };
      } catch (error) {
        this.logger.debug(`[blindflug-radar] znp.assessPortfolio unavailable: ${error.message}`);
        return {
          projectId: resolvedProjectId,
          decisionStatus: 'unknown',
          overallScore: null,
        };
      }
    },

    async createAutoProposalHitlItems(ctx, { scanId, confidenceThreshold, proposals }) {
      const items = [];
      for (const proposal of proposals) {
        if (!proposal.autoProposal) continue;
        if (Number(proposal.capexEstimateEur || 0) <= HIGH_VALUE_THRESHOLD_EUR) continue;

        try {
          const created = await ctx.call('hitl.create', {
            kind: 'blindflug-auto-proposal',
            originService: this.name,
            originAction: 'scanBlindflug',
            severity: 'warning',
            payload: {
              scanId,
              proposal,
              confidenceThreshold,
              thresholdEur: HIGH_VALUE_THRESHOLD_EUR,
            },
          });
          if (created?.item) items.push(created.item);
        } catch (error) {
          this.logger.warn(`[blindflug-radar] hitl.create failed: ${error.message}`);
        }
      }
      return items;
    },

    async ensureEvidencePlaceholder(ctx, { signals, znpContext, confidenceThreshold }) {
      const placeholders = [];

      const needsEvidence = !signals.length;
      const missingProject = !znpContext?.projectId;
      if (!needsEvidence && !missingProject) return placeholders;

      const existing = await ctx.call('interface-placeholder.listGaps', {
        includeResolved: false,
        blockingLevel: 'hard',
        role: 'blindflug_radar',
        limit: 250,
      });

      const gapKey = needsEvidence
        ? 'blindflug_missing_disturbance_evidence'
        : 'blindflug_missing_znp_project';

      const already = (existing?.placeholders || []).find(
        (placeholder) => placeholder.placeholderGapKey === gapKey
      );
      if (already) {
        placeholders.push(already);
        return placeholders;
      }

      const created = await ctx.call('interface-placeholder.markGap', {
        role: 'blindflug_radar',
        reason: 'NEEDS_EVIDENCE',
        blockingLevel: 'hard',
        placeholderGapKey: gapKey,
        requiredResolverRoles: [ROLE_KAUFMAENNISCHE_LEITUNG, ROLE_NETZPLANUNG],
        replacementCriteria: {
          kind: 'process',
          capabilityHint: 'blindflug-radar.scanBlindflug',
          deadline: null,
        },
        signalCodes: ['REQUEST_SUPPORTING_EVIDENCE'],
        context: {
          needsEvidence,
          missingProject,
          confidenceThreshold,
        },
      });

      if (created?.placeholder) {
        placeholders.push(created.placeholder);
      }

      return placeholders;
    },

    async getTenantDocsByPrefix(prefix, tenantId) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\ufff0`,
      });

      return result.rows.map((row) => row.doc).filter((doc) => doc.tenantId === tenantId);
    },

    async getLatestDocOrThrow(tenantId) {
      const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
      docs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      if (!docs.length) {
        throw new MoleculerClientError('Blindflug scan not found', 404, 'BLINDFLUG_SCAN_NOT_FOUND');
      }
      return docs[0];
    },

    async getDocOrThrow(id, tenantId) {
      try {
        const doc = await this.db.get(`${DOC_PREFIX}${id}`);
        if (doc.tenantId !== tenantId) {
          throw new MoleculerClientError(
            'Blindflug scan not found',
            404,
            'BLINDFLUG_SCAN_NOT_FOUND'
          );
        }
        return doc;
      } catch (err) {
        if (err?.status === 404 || err?.type === 'BLINDFLUG_SCAN_NOT_FOUND') {
          throw new MoleculerClientError(
            'Blindflug scan not found',
            404,
            'BLINDFLUG_SCAN_NOT_FOUND'
          );
        }
        throw err;
      }
    },

    toPublic(doc) {
      return {
        id: doc.id,
        tenantId: doc.tenantId,
        gridOperatorId: doc.gridOperatorId,
        projectId: doc.projectId,
        signalPolicy: doc.signalPolicy,
        sourceSummary: doc.sourceSummary,
        signals: doc.signals,
        proposals: doc.proposals,
        hitlItemIds: doc.hitlItemIds,
        placeholders: doc.placeholders,
        znpContext: doc.znpContext,
        decisionStatus: doc.decisionStatus,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  },
};
