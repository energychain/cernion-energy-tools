'use strict';

/**
 * Gas Capacity Order Revision Gate Service.
 *
 * Issue: #248
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  GCORG_TOOL_VALUE_MISSING,
  GCORG_COLD_YEAR_SCENARIO_MISSING,
  GCORG_RLM_REBOUND_MISSING,
  GCORG_BOTTLENECK_EVIDENCE_MISSING,
  GCORG_NKP_DISTRIBUTION_MISSING,
  GCORG_TARIFF_IMPACT_MISSING,
  GCORG_FLEXIBILITY_EVIDENCE_MISSING,
  GCORG_DECISION_RESOLUTION_MISSING,
  GCORG_SOURCE_ACTIONS_MISSING,
  GCORG_GATE_READY,
  GCORG_GATE_BLOCKED,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Gas Capacity Order Revision Gate';
const REVISION_PREFIX = 'gcorg:';

const DEFAULT_SOURCE_ACTIONS = [
  'gas-storage.countryStorage',
  'gasnetz-waermeplanung.assessSegment',
  'forecast.generate',
  'forecast-engine.evaluate',
  'grid-connection.validate',
  'finance-agent.analyze',
  'vdmi-evidence.inject',
  'presentation.generate',
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasObjectEvidence(value) {
  return Object.keys(normalizeObject(value)).length > 0;
}

function buildPositiveFollowUps(missingDataPoints) {
  const mapping = {
    tool_value: 'adds the tool value baseline for the annual capacity order',
    cold_year_scenario: 'adds cold-year peak-risk explanation and safety-markup justification',
    industrial_rebound_scenario: 'adds rebound-sensitive demand-risk view',
    reversible_rlm_loads: 'adds interruptible/reversible load mitigation evidence',
    historical_bottleneck_evidence: 'adds bottleneck-history rationale for the order value',
    nkp_distribution: 'adds network-coupling-point allocation and concentration risk',
    tariff_impact: 'adds tariff/fee consequence statement',
    pressure_maintenance_flexibility:
      'adds technical flexibility and maintenance-window constraint view',
    decision_resolution: 'adds documented order-decision forum/status',
    source_action_references:
      'adds traceability to reused gas, forecast, grid, finance and evidence capabilities',
  };
  return missingDataPoints.map((missingDataPoint) => ({
    missingDataPoint,
    enablesDossierAddition:
      mapping[missingDataPoint] || 'adds gas-capacity revision evidence to the dossier',
  }));
}

function buildAnswerFacts(model) {
  return {
    revisionId: model._id,
    orderYear: model.orderYear,
    gridOperatorId: model.gridOperatorId,
    nkpIds: model.nkpIds,
    toolValueMwhPerDay: model.toolValueMwhPerDay,
    securityMarkupPercent: model.securityMarkupPercent,
    revisedCapacityHypothesisMwhPerDay: model.revisedCapacityHypothesisMwhPerDay,
    coldYearScenario: model.coldYearScenario,
    industrialReboundScenario: model.industrialReboundScenario,
    reversibleRlmLoads: model.reversibleRlmLoads,
    historicalBottleneckEvidence: model.historicalBottleneckEvidence,
    nkpDistribution: model.nkpDistribution,
    tariffImpact: model.tariffImpact,
    pressureMaintenanceFlexibility: model.pressureMaintenanceFlexibility,
    maintenanceWindows: model.maintenanceWindows,
    decisionForum: model.decisionForum,
    decisionStatus: model.decisionStatus,
    evidenceStatus: model.evidenceStatus,
    evaluatedAt: model.createdAt,
  };
}

function buildStatusFromModel(model) {
  const missingDataPoints = model.missingDataPoints || [];
  return {
    found: true,
    revisionId: model._id,
    orderYear: model.orderYear,
    gridOperatorId: model.gridOperatorId,
    nkpIds: model.nkpIds,
    toolValueMwhPerDay: model.toolValueMwhPerDay,
    securityMarkupPercent: model.securityMarkupPercent,
    revisedCapacityHypothesisMwhPerDay: model.revisedCapacityHypothesisMwhPerDay,
    coldYearScenario: model.coldYearScenario,
    industrialReboundScenario: model.industrialReboundScenario,
    reversibleRlmLoads: model.reversibleRlmLoads,
    historicalBottleneckEvidence: model.historicalBottleneckEvidence,
    nkpDistribution: model.nkpDistribution,
    tariffImpact: model.tariffImpact,
    pressureMaintenanceFlexibility: model.pressureMaintenanceFlexibility,
    maintenanceWindows: model.maintenanceWindows,
    decisionForum: model.decisionForum,
    decisionStatus: model.decisionStatus,
    evidenceStatus: model.evidenceStatus,
    readinessScore: model.readinessScore,
    recommendedStatus: model.recommendedStatus,
    missingDataPoints,
    validationFindings: model.validationFindings,
    blockingFindings: model.blockingFindings,
    positiveFollowUps: buildPositiveFollowUps(missingDataPoints),
    sourceActions: model.sourceActions,
    forbiddenAutomaticActions: model.forbiddenAutomaticActions,
    answerFacts: buildAnswerFacts(model),
    evaluatedAt: model.createdAt,
  };
}

module.exports = {
  name: 'gas-capacity-order-revision-gate',

  settings: {
    dbPath:
      process.env.GAS_CAPACITY_ORDER_REVISION_GATE_DB_PATH ||
      './data/gas-capacity-order-revision-gate',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId', 'orderYear'] } });
    await this.db.createIndex({ index: { fields: ['evidenceStatus'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Gas Capacity Order Revision Gate DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        orderYear: { type: 'number', convert: true },
        gridOperatorId: { type: 'string' },
        nkpIds: { type: 'array', optional: true, default: [] },
        toolValueMwhPerDay: { type: 'number', optional: true, convert: true },
        securityMarkupPercent: { type: 'number', optional: true, default: 0, convert: true },
        coldYearScenario: { type: 'object', optional: true, default: {} },
        industrialReboundScenario: { type: 'object', optional: true, default: {} },
        reversibleRlmLoads: { type: 'array', optional: true, default: [] },
        historicalBottleneckEvidence: { type: 'array', optional: true, default: [] },
        nkpDistribution: { type: 'array', optional: true, default: [] },
        tariffImpact: { type: 'object', optional: true, default: {} },
        pressureMaintenanceFlexibility: { type: 'object', optional: true, default: {} },
        maintenanceWindows: { type: 'array', optional: true, default: [] },
        decisionForum: { type: 'string', optional: true },
        decisionStatus: { type: 'string', optional: true },
        sourceActions: { type: 'array', optional: true, default: [] },
      },
      openapi: {
        summary: 'Evaluate gas-capacity order revision evidence',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const p = ctx.params;
        const findings = [];
        const missingDataPoints = [];
        const sourceActions = asArray(p.sourceActions);
        const toolValue = normalizeNumber(p.toolValueMwhPerDay);
        const markup = normalizeNumber(p.securityMarkupPercent) || 0;

        if (!toolValue || toolValue <= 0) missingDataPoints.push('tool_value');
        if (!hasObjectEvidence(p.coldYearScenario)) missingDataPoints.push('cold_year_scenario');
        if (!hasObjectEvidence(p.industrialReboundScenario))
          missingDataPoints.push('industrial_rebound_scenario');
        if (asArray(p.reversibleRlmLoads).length === 0)
          missingDataPoints.push('reversible_rlm_loads');
        if (asArray(p.historicalBottleneckEvidence).length === 0)
          missingDataPoints.push('historical_bottleneck_evidence');
        if (asArray(p.nkpDistribution).length === 0) missingDataPoints.push('nkp_distribution');
        if (!hasObjectEvidence(p.tariffImpact)) missingDataPoints.push('tariff_impact');
        if (
          !hasObjectEvidence(p.pressureMaintenanceFlexibility) &&
          asArray(p.maintenanceWindows).length === 0
        ) {
          missingDataPoints.push('pressure_maintenance_flexibility');
        }
        if (!normalizeString(p.decisionForum) || !normalizeString(p.decisionStatus)) {
          missingDataPoints.push('decision_resolution');
        }
        if (sourceActions.length === 0) missingDataPoints.push('source_action_references');

        if (!toolValue || toolValue <= 0) {
          findings.push({
            finding: GCORG_TOOL_VALUE_MISSING,
            severity: 'error',
            message: 'Gas-capacity tool value is missing or invalid',
          });
        }
        if (!hasObjectEvidence(p.coldYearScenario)) {
          findings.push({
            finding: GCORG_COLD_YEAR_SCENARIO_MISSING,
            severity: 'error',
            message: 'Cold-year scenario evidence is missing',
          });
        }
        if (
          !hasObjectEvidence(p.industrialReboundScenario) &&
          asArray(p.reversibleRlmLoads).length === 0
        ) {
          findings.push({
            finding: GCORG_RLM_REBOUND_MISSING,
            severity: 'warning',
            message: 'Industrial rebound or reversible RLM load evidence is missing',
          });
        }
        if (asArray(p.historicalBottleneckEvidence).length === 0) {
          findings.push({
            finding: GCORG_BOTTLENECK_EVIDENCE_MISSING,
            severity: 'warning',
            message: 'Historical bottleneck evidence is missing',
          });
        }
        if (asArray(p.nkpDistribution).length === 0) {
          findings.push({
            finding: GCORG_NKP_DISTRIBUTION_MISSING,
            severity: 'error',
            message: 'Network-coupling-point distribution is missing',
          });
        }
        if (!hasObjectEvidence(p.tariffImpact)) {
          findings.push({
            finding: GCORG_TARIFF_IMPACT_MISSING,
            severity: 'warning',
            message: 'Tariff impact evidence is missing',
          });
        }
        if (
          !hasObjectEvidence(p.pressureMaintenanceFlexibility) &&
          asArray(p.maintenanceWindows).length === 0
        ) {
          findings.push({
            finding: GCORG_FLEXIBILITY_EVIDENCE_MISSING,
            severity: 'warning',
            message: 'Pressure or maintenance flexibility evidence is missing',
          });
        }
        if (!normalizeString(p.decisionForum) || !normalizeString(p.decisionStatus)) {
          findings.push({
            finding: GCORG_DECISION_RESOLUTION_MISSING,
            severity: 'error',
            message: 'Documented gas-capacity order decision forum or status is missing',
          });
        }
        if (sourceActions.length === 0) {
          findings.push({
            finding: GCORG_SOURCE_ACTIONS_MISSING,
            severity: 'warning',
            message: 'Gas-capacity source action references are missing',
          });
        }

        const hasError = findings.some((finding) => finding.severity === 'error');
        const hasWarning = findings.some((finding) => finding.severity === 'warning');
        const evidenceStatus = hasError ? 'blocked' : hasWarning ? 'ready_with_warnings' : 'ready';
        findings.push({
          finding: hasError ? GCORG_GATE_BLOCKED : GCORG_GATE_READY,
          severity: hasError ? 'error' : 'info',
          message: hasError
            ? 'Gas-capacity order revision gate is blocked'
            : 'Gas-capacity order revision gate is ready',
        });

        const uniqueMissingDataPoints = [...new Set(missingDataPoints)];
        const readinessScore = Math.max(0, (9 - uniqueMissingDataPoints.length) / 9);
        const revisedCapacityHypothesisMwhPerDay =
          toolValue && toolValue > 0 ? Number((toolValue * (1 + markup / 100)).toFixed(3)) : null;
        const revisionId = `${REVISION_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: revisionId,
          docType: 'gas-capacity-order-revision-gate',
          tenantId,
          orderYear: p.orderYear,
          gridOperatorId: p.gridOperatorId,
          nkpIds: asArray(p.nkpIds),
          toolValueMwhPerDay: toolValue,
          securityMarkupPercent: markup,
          revisedCapacityHypothesisMwhPerDay,
          coldYearScenario: normalizeObject(p.coldYearScenario),
          industrialReboundScenario: normalizeObject(p.industrialReboundScenario),
          reversibleRlmLoads: asArray(p.reversibleRlmLoads),
          historicalBottleneckEvidence: asArray(p.historicalBottleneckEvidence),
          nkpDistribution: asArray(p.nkpDistribution),
          tariffImpact: normalizeObject(p.tariffImpact),
          pressureMaintenanceFlexibility: normalizeObject(p.pressureMaintenanceFlexibility),
          maintenanceWindows: asArray(p.maintenanceWindows),
          decisionForum: normalizeString(p.decisionForum),
          decisionStatus: normalizeString(p.decisionStatus),
          evidenceStatus,
          readinessScore,
          recommendedStatus: hasError
            ? 'needs_evidence'
            : hasWarning
              ? 'review_with_warnings'
              : 'revision_evidence_ready',
          validationFindings: findings,
          blockingFindings: findings.filter((finding) => finding.severity === 'error'),
          missingDataPoints: uniqueMissingDataPoints,
          positiveFollowUps: buildPositiveFollowUps(uniqueMissingDataPoints),
          sourceActions: sourceActions.length > 0 ? sourceActions : DEFAULT_SOURCE_ACTIONS,
          forbiddenAutomaticActions: [
            'gas-capacity-order-submission',
            'nomination-write',
            'contract-mutation',
            'mako-write',
            'settlement-write',
            'billing-write',
            'pressure-control-action',
            'network-operation',
            'hitl-approval',
            'external-connector-call',
          ],
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        return { ...doc, revisionId };
      },
    },

    listRevisions: {
      rest: 'GET /revisions',
      params: {
        orderYear: { type: 'number', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List gas-capacity order revisions',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'query', name: 'orderYear', schema: { type: 'number' } },
          { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'gas-capacity-order-revision-gate' };
        if (ctx.params.orderYear) selector.orderYear = ctx.params.orderYear;
        if (ctx.params.gridOperatorId) selector.gridOperatorId = ctx.params.gridOperatorId;
        const result = await this.db.find({ selector, limit: ctx.params.limit });
        return {
          revisions: result.docs.sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
          ),
        };
      },
    },

    getRevision: {
      rest: 'GET /revisions/:revisionId',
      params: { revisionId: { type: 'string' } },
      openapi: {
        summary: 'Get a gas-capacity order revision',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'path', name: 'revisionId', required: true, schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const model = await this.db.get(ctx.params.revisionId);
          if (model.tenantId !== tenantId) {
            throw new MoleculerClientError(
              'Gas-capacity revision not found',
              404,
              'GAS_CAPACITY_REVISION_NOT_FOUND'
            );
          }
          return model;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              'Gas-capacity revision not found',
              404,
              'GAS_CAPACITY_REVISION_NOT_FOUND'
            );
          }
          throw err;
        }
      },
    },

    getStatus: {
      rest: 'GET /status',
      params: {
        revisionId: { type: 'string', optional: true },
        orderYear: { type: 'number', optional: true, convert: true },
        gridOperatorId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get dossier-safe gas-capacity order revision status',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'query', name: 'revisionId', schema: { type: 'string' } },
          { in: 'query', name: 'orderYear', schema: { type: 'number' } },
          { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          let model;
          if (ctx.params.revisionId) {
            model = await this.db.get(ctx.params.revisionId);
            if (model.tenantId !== tenantId) {
              throw new MoleculerClientError(
                'Gas-capacity revision status not found',
                404,
                'GAS_CAPACITY_REVISION_STATUS_NOT_FOUND'
              );
            }
          } else {
            const selector = { tenantId, docType: 'gas-capacity-order-revision-gate' };
            if (ctx.params.orderYear) selector.orderYear = ctx.params.orderYear;
            if (ctx.params.gridOperatorId) selector.gridOperatorId = ctx.params.gridOperatorId;
            const result = await this.db.find({ selector, limit: 50 });
            model = result.docs.sort((a, b) =>
              String(b.createdAt).localeCompare(String(a.createdAt))
            )[0];
            if (!model) {
              throw new MoleculerClientError(
                'Gas-capacity revision status not found',
                404,
                'GAS_CAPACITY_REVISION_STATUS_NOT_FOUND'
              );
            }
          }
          return buildStatusFromModel(model);
        } catch (err) {
          if (err.status === 404 || err.type === 'GAS_CAPACITY_REVISION_STATUS_NOT_FOUND') {
            return {
              found: false,
              revisionId: ctx.params.revisionId,
              orderYear: ctx.params.orderYear,
              gridOperatorId: ctx.params.gridOperatorId,
              message: 'No gas-capacity order revision evidence is available for this tenant yet',
            };
          }
          throw err;
        }
      },
    },
  },
};
