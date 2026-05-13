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
  INVESTMENT_TRIGGER_THRESHOLD_EUR,
  buildSollBaselines,
  buildSollIstComparison,
  detectInvestmentTriggers,
  detectMandateAlignment,
  roundMoney,
} = require('../src/investment-plan-utils');

const OPENAPI_TAG = 'Investment Planning';
const DOC_PREFIX = 'ip:';
const REQUIRED_ROLES = Object.freeze([ROLE_KAUFMAENNISCHE_LEITUNG, ROLE_NETZPLANUNG]);

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'investment-planning',

  settings: {
    dbPath: process.env.INVESTMENT_PLANNING_DB_PATH || './data/investment-planning',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    this.logger.info(`Investment Planning DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    createPlan: {
      rest: 'POST /plans',
      params: {
        redispatchAuditId: { type: 'string', optional: true },
        gridOperatorId: { type: 'string', optional: true },
        redispatchTargetEur: { type: 'number', optional: true, convert: true },
        financeBudgetEur: { type: 'number', optional: true, convert: true },
        measures: {
          type: 'array',
          optional: true,
          default: [],
          items: {
            type: 'object',
            props: {
              measureId: { type: 'string', optional: true },
              name: { type: 'string', optional: true },
              projectId: { type: 'string', optional: true },
              capexEur: { type: 'number', optional: true, default: 0, convert: true },
              avoidedCostsEur: { type: 'number', optional: true, default: 0, convert: true },
            },
          },
        },
        triggerThresholdEur: {
          type: 'number',
          optional: true,
          default: INVESTMENT_TRIGGER_THRESHOLD_EUR,
          convert: true,
        },
      },
      openapi: {
        summary: 'Create investment plan with Soll-Ist delta and mandate alignment',
        tags: [OPENAPI_TAG],
        description:
          'Builds a deterministic investment planning report using hybrid Soll baselines ' +
          '(redispatch_target + finance_budget), compares against Redispatch Ex-Post Ist, ' +
          'evaluates mandate alignment, and creates HITL items for any measure with capex or ' +
          'avoided costs > 1,000,000 EUR.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  redispatchAuditId: { type: 'string', example: 'rd-12345' },
                  gridOperatorId: { type: 'string', example: 'SNB123456789000' },
                  redispatchTargetEur: { type: 'number', example: 1250000 },
                  financeBudgetEur: { type: 'number', example: 900000 },
                  triggerThresholdEur: { type: 'number', default: 1000000 },
                  measures: {
                    type: 'array',
                    default: [],
                    items: {
                      type: 'object',
                      properties: {
                        measureId: { type: 'string', example: 'm-001' },
                        name: { type: 'string', example: 'Trafo-Upgrade Süd' },
                        projectId: { type: 'string', example: 'proj-77' },
                        capexEur: { type: 'number', example: 1200000 },
                        avoidedCostsEur: { type: 'number', example: 150000 },
                      },
                    },
                  },
                },
              },
              examples: {
                triggerRequired: {
                  value: {
                    gridOperatorId: 'SNB123456789000',
                    redispatchTargetEur: 1250000,
                    financeBudgetEur: 900000,
                    measures: [
                      {
                        measureId: 'm-001',
                        name: 'Trafo-Upgrade Süd',
                        projectId: 'proj-77',
                        capexEur: 1200000,
                        avoidedCostsEur: 150000,
                      },
                    ],
                  },
                },
                belowThreshold: {
                  value: {
                    gridOperatorId: 'SNB123456789000',
                    measures: [
                      {
                        measureId: 'm-002',
                        name: 'Leitungsmonitoring Ost',
                        capexEur: 800000,
                        avoidedCostsEur: 120000,
                      },
                    ],
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
        const planId = crypto.randomUUID();

        const audit = await this.findRedispatchAudit(ctx, {
          redispatchAuditId: ctx.params.redispatchAuditId,
          gridOperatorId: ctx.params.gridOperatorId,
        });

        const redispatchTargetEur =
          Number.isFinite(ctx.params.redispatchTargetEur)
            ? ctx.params.redispatchTargetEur
            : audit?.riskAssessment?.estimatedLostCompensationEur;

        const financeBudgetEur =
          Number.isFinite(ctx.params.financeBudgetEur) ? ctx.params.financeBudgetEur : null;

        const baselines = buildSollBaselines({
          redispatchTargetEur,
          financeBudgetEur,
        });

        const istEur = roundMoney(audit?.riskAssessment?.estimatedLostCompensationEur || 0);
        const planVsActual = buildSollIstComparison({
          sollEur: baselines.sollEur,
          istEur,
        });

        const vdmiList = await ctx.call('vdmi.list', {
          processType: 'redispatch',
          limit: 200,
        });
        const mandateAlignment = detectMandateAlignment(vdmiList?.items || [], [...REQUIRED_ROLES]);

        const roleGaps = await this.ensureRoleGapPlaceholders(ctx, mandateAlignment);

        const triggeredMeasures = detectInvestmentTriggers(
          ctx.params.measures,
          ctx.params.triggerThresholdEur
        );

        const hitlItems = [];
        for (const measure of triggeredMeasures) {
          const hitl = await ctx.call('hitl.create', {
            kind: 'investment-shift-over-1m',
            originService: this.name,
            originAction: 'createPlan',
            severity: 'warning',
            payload: {
              planId,
              measure,
              thresholdEur: ctx.params.triggerThresholdEur,
              requiredRoles: [...REQUIRED_ROLES],
              mandateAlignment,
              planVsActual,
            },
          });
          if (hitl?.item) {
            hitlItems.push(hitl.item);
          }
        }

        const decisionStatus =
          mandateAlignment.aligned && roleGaps.length === 0 ? 'ready' : 'blocked';

        const doc = {
          _id: `${DOC_PREFIX}${planId}`,
          id: planId,
          type: 'investment-plan',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId || audit?.gridOperator?.mastrId || null,
          redispatchAuditId: audit?.id || ctx.params.redispatchAuditId || null,
          portfolio: {
            weg: 'hybrid_baseline_v1',
            provenanceFlags: baselines.provenanceFlags,
          },
          planVsActual,
          mandateAlignment,
          governance: {
            requiredRoles: [...REQUIRED_ROLES],
            roleGaps,
            resolutionMode: 'manual_only',
          },
          triggerPolicy: {
            thresholdEur: ctx.params.triggerThresholdEur,
            semantics: 'strict_greater_than_per_measure',
          },
          triggeredMeasures,
          hitlItemIds: hitlItems.map((item) => item.id),
          decisionStatus,
          metadata: {
            source: {
              redispatchAuditAvailable: Boolean(audit),
            },
          },
          createdAt,
          updatedAt: createdAt,
        };

        await this.db.put(doc);

        return {
          success: true,
          id: planId,
          ...this.toPublic(doc),
          hitlItems,
        };
      },
    },

    listPlans: {
      rest: 'GET /plans',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50, max: 200 },
      },
      openapi: {
        summary: 'List investment planning reports',
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
          plans: items.slice(0, limit).map((doc) => this.toPublic(doc)),
        };
      },
    },

    getPlan: {
      rest: 'GET /plans/:id',
      params: {
        id: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get one investment planning report',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'ip-123' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const doc = await this.getDocOrThrow(ctx.params.id, tenantId);
        return {
          success: true,
          plan: this.toPublic(doc),
        };
      },
    },
  },

  methods: {
    async findRedispatchAudit(ctx, { redispatchAuditId, gridOperatorId }) {
      if (redispatchAuditId) {
        const single = await ctx.call('redispatch-expost.get', { id: redispatchAuditId });
        if (single?.success === false) {
          throw new MoleculerClientError(
            `Redispatch audit not found: ${redispatchAuditId}`,
            404,
            'REDISPATCH_AUDIT_NOT_FOUND'
          );
        }
        return single;
      }

      const list = await ctx.call('redispatch-expost.list', {
        gridOperatorId,
        limit: 200,
      });
      const audits = Array.isArray(list?.audits) ? list.audits : [];
      return audits[0] || null;
    },

    async ensureRoleGapPlaceholders(ctx, mandateAlignment) {
      const roleGaps = [];
      if (mandateAlignment.aligned) {
        return roleGaps;
      }

      const existing = await ctx.call('interface-placeholder.listGaps', {
        includeResolved: false,
        blockingLevel: 'hard',
        role: 'investment_planning',
        limit: 250,
      });

      for (const missingRole of mandateAlignment.missingRoles) {
        const gapKey = `investment_role_gap_${missingRole.toLowerCase()}`;
        const already = (existing?.placeholders || []).find(
          (item) => item.placeholderGapKey === gapKey
        );

        if (already) {
          roleGaps.push(already);
          continue;
        }

        const created = await ctx.call('interface-placeholder.markGap', {
          role: 'investment_planning',
          reason: 'NEEDS_OWNER',
          blockingLevel: 'hard',
          placeholderGapKey: gapKey,
          requiredResolverRoles: [...REQUIRED_ROLES],
          replacementCriteria: {
            kind: 'process',
            capabilityHint: 'investment-planning.createPlan',
            deadline: null,
          },
        });

        if (created?.placeholder) {
          roleGaps.push(created.placeholder);
        }
      }

      return roleGaps;
    },

    async getTenantDocsByPrefix(prefix, tenantId) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\ufff0`,
      });

      return result.rows.map((row) => row.doc).filter((doc) => doc.tenantId === tenantId);
    },

    async getDocOrThrow(id, tenantId) {
      try {
        const doc = await this.db.get(`${DOC_PREFIX}${id}`);
        if (doc.tenantId !== tenantId) {
          throw new MoleculerClientError('Investment plan not found', 404, 'INVESTMENT_PLAN_NOT_FOUND');
        }
        return doc;
      } catch (err) {
        if (err?.status === 404 || err?.type === 'INVESTMENT_PLAN_NOT_FOUND') {
          throw new MoleculerClientError('Investment plan not found', 404, 'INVESTMENT_PLAN_NOT_FOUND');
        }
        throw err;
      }
    },

    toPublic(doc) {
      return {
        id: doc.id,
        tenantId: doc.tenantId,
        gridOperatorId: doc.gridOperatorId,
        redispatchAuditId: doc.redispatchAuditId,
        portfolio: doc.portfolio,
        planVsActual: doc.planVsActual,
        mandateAlignment: doc.mandateAlignment,
        governance: doc.governance,
        triggerPolicy: doc.triggerPolicy,
        triggeredMeasures: doc.triggeredMeasures,
        hitlItemIds: doc.hitlItemIds,
        decisionStatus: doc.decisionStatus,
        metadata: doc.metadata,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  },
};
