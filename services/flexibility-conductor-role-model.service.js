'use strict';

/**
 * Flexibility Conductor Role Model Service.
 *
 * Issue: #245
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  FCRM_DECISION_RIGHTS_MISSING,
  FCRM_CONTROL_BOUNDARY_MISSING,
  FCRM_MONITORING_OWNER_MISSING,
  FCRM_COMMERCIAL_OWNER_MISSING,
  FCRM_ESCALATION_PATH_MISSING,
  FCRM_SOURCE_ACTIONS_MISSING,
  FCRM_ROLE_MODEL_READY,
  FCRM_ROLE_MODEL_BLOCKED,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Flexibility Conductor Role Model';
const ROLE_MODEL_PREFIX = 'fcrm:';

const DEFAULT_SOURCE_ACTIONS = [
  'flex.listDevices',
  'flex.getDevice',
  'grid-connection.fnavValidate',
  'grid-operations.netzfahrplanGenerate',
  'forecast-engine.forecast',
  'residual-load.netResidualLoad',
  'finance-agent.analyze',
  'investment-planning.evaluate',
  'vdmi.create',
  'hitl.create',
  'presentation.generate',
];

const ROLE_AREAS = [
  'forecastIntake',
  'fnavBoundary',
  'controlCommandPolicy',
  'softwareMonitoring',
  'commercialValuation',
  'escalationHandover',
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

function normalizeRoleCoverage(decisionRights = {}) {
  const rights = normalizeObject(decisionRights);
  const coverage = {};
  for (const area of ROLE_AREAS) {
    const entry = normalizeObject(rights[area]);
    coverage[area] = {
      accountable: normalizeString(entry.accountable),
      responsible: normalizeString(entry.responsible),
      consulted: asArray(entry.consulted),
      informed: asArray(entry.informed),
    };
  }
  return coverage;
}

function missingRoleAreas(roleCoverage) {
  return ROLE_AREAS.filter((area) => {
    const entry = roleCoverage[area] || {};
    return !entry.accountable || !entry.responsible;
  });
}

function buildPositiveFollowUps(missingDataPoints) {
  const mapping = {
    flex_asset_scope: 'adds affected controllable assets and low-voltage interface scope',
    decision_rights_owner: 'adds accountable and responsible roles for operational decisions',
    control_command_policy: 'adds explicit boundary for allowed and forbidden control actions',
    software_monitoring_owner: 'adds monitoring responsibility and escalation recipient',
    commercial_value_owner: 'adds CAPEX/OPEX/regulatory valuation accountability',
    escalation_path: 'adds handover and HITL routing evidence',
    source_action_references: 'adds traceability to reused Flex/Grid/Finance/VDMI capabilities',
  };
  return missingDataPoints.map((missingDataPoint) => ({
    missingDataPoint,
    enablesDossierAddition: mapping[missingDataPoint],
  }));
}

function buildAnswerFacts(model) {
  return {
    processId: model.processId,
    roleModelId: model._id,
    flexAssetScope: model.flexAssetScope,
    roleCoverage: model.roleCoverage,
    controlCommandBoundary: model.controlCommandBoundary,
    softwareMonitoringOwner: model.softwareMonitoringOwner,
    commercialValueOwner: model.commercialValueOwner,
    escalationPath: model.escalationPath,
    interfaces: model.interfaces,
    forbiddenAutomaticActions: model.forbiddenAutomaticActions,
    evidenceStatus: model.evidenceStatus,
    evaluatedAt: model.createdAt,
  };
}

function buildStatusFromModel(model) {
  const missingDataPoints = model.missingDataPoints || [];
  return {
    found: true,
    processId: model.processId,
    roleModelId: model._id,
    flexAssetScope: model.flexAssetScope,
    decisionRights: model.roleCoverage,
    operationalTasks: model.operationalTasks,
    dataSources: model.dataSources,
    controlCommandBoundary: model.controlCommandBoundary,
    softwareMonitoringOwner: model.softwareMonitoringOwner,
    commercialValueOwner: model.commercialValueOwner,
    escalationPath: model.escalationPath,
    interfaces: model.interfaces,
    evidenceStatus: model.evidenceStatus,
    missingDataPoints,
    validationFindings: model.validationFindings,
    positiveFollowUps: buildPositiveFollowUps(missingDataPoints),
    sourceActions: model.sourceActions,
    forbiddenAutomaticActions: model.forbiddenAutomaticActions,
    answerFacts: buildAnswerFacts(model),
    evaluatedAt: model.createdAt,
  };
}

module.exports = {
  name: 'flexibility-conductor-role-model',

  settings: {
    dbPath:
      process.env.FLEXIBILITY_CONDUCTOR_ROLE_MODEL_DB_PATH ||
      './data/flexibility-conductor-role-model',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['processId'] } });
    await this.db.createIndex({ index: { fields: ['evidenceStatus'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Flexibility Conductor Role Model DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/flexibility-conductor-role-model/evaluate:
     *   post:
     *     tags: [Flexibility Conductor Role Model]
     *     summary: Evaluate flexibility orchestration role-model evidence
     *     security:
     *       - bearerAuth: []
     */
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        processId: { type: 'string' },
        flexAssetScope: { type: 'object', optional: true, default: {} },
        decisionRights: { type: 'object', optional: true, default: {} },
        operationalTasks: { type: 'array', optional: true, default: [] },
        dataSources: { type: 'array', optional: true, default: [] },
        controlCommandBoundary: { type: 'string', optional: true },
        softwareMonitoringOwner: { type: 'string', optional: true },
        commercialValueOwner: { type: 'string', optional: true },
        escalationPath: { type: 'array', optional: true, default: [] },
        interfaces: { type: 'object', optional: true, default: {} },
        sourceActions: { type: 'array', optional: true, default: [] },
      },
      openapi: {
        summary: 'Evaluate flexibility orchestration role-model evidence',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const p = ctx.params;
        const findings = [];
        const missingDataPoints = [];
        const roleCoverage = normalizeRoleCoverage(p.decisionRights);
        const missingAreas = missingRoleAreas(roleCoverage);
        const flexAssetScope = normalizeObject(p.flexAssetScope);
        const sourceActions = asArray(p.sourceActions);
        const escalationPath = asArray(p.escalationPath);

        if (Object.keys(flexAssetScope).length === 0) missingDataPoints.push('flex_asset_scope');
        if (missingAreas.length > 0) missingDataPoints.push('decision_rights_owner');
        if (!normalizeString(p.controlCommandBoundary)) {
          missingDataPoints.push('control_command_policy');
        }
        if (!normalizeString(p.softwareMonitoringOwner)) {
          missingDataPoints.push('software_monitoring_owner');
        }
        if (!normalizeString(p.commercialValueOwner)) {
          missingDataPoints.push('commercial_value_owner');
        }
        if (escalationPath.length === 0) missingDataPoints.push('escalation_path');
        if (sourceActions.length === 0) missingDataPoints.push('source_action_references');

        if (missingAreas.length > 0) {
          findings.push({
            finding: FCRM_DECISION_RIGHTS_MISSING,
            severity: 'error',
            message: `Flexibility role-model decision rights incomplete: ${missingAreas.join(', ')}`,
            missingAreas,
          });
        }
        if (!normalizeString(p.controlCommandBoundary)) {
          findings.push({
            finding: FCRM_CONTROL_BOUNDARY_MISSING,
            severity: 'error',
            message: 'Flexibility role-model control-command boundary is missing',
          });
        }
        if (!normalizeString(p.softwareMonitoringOwner)) {
          findings.push({
            finding: FCRM_MONITORING_OWNER_MISSING,
            severity: 'warning',
            message: 'Flexibility role-model software monitoring owner is missing',
          });
        }
        if (!normalizeString(p.commercialValueOwner)) {
          findings.push({
            finding: FCRM_COMMERCIAL_OWNER_MISSING,
            severity: 'warning',
            message: 'Flexibility role-model commercial value owner is missing',
          });
        }
        if (escalationPath.length === 0) {
          findings.push({
            finding: FCRM_ESCALATION_PATH_MISSING,
            severity: 'error',
            message: 'Flexibility role-model escalation path is missing',
          });
        }
        if (sourceActions.length === 0) {
          findings.push({
            finding: FCRM_SOURCE_ACTIONS_MISSING,
            severity: 'warning',
            message: 'Flexibility role-model source action references are missing',
          });
        }

        const hasError = findings.some((finding) => finding.severity === 'error');
        const hasWarning = findings.some((finding) => finding.severity === 'warning');
        const evidenceStatus = hasError ? 'blocked' : hasWarning ? 'ready_with_warnings' : 'ready';
        findings.push({
          finding: hasError ? FCRM_ROLE_MODEL_BLOCKED : FCRM_ROLE_MODEL_READY,
          severity: hasError ? 'error' : 'info',
          message: hasError
            ? 'Flexibility conductor role model is blocked'
            : 'Flexibility conductor role model is ready',
        });

        const roleModelId = `${ROLE_MODEL_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: roleModelId,
          docType: 'flexibility-conductor-role-model',
          tenantId,
          processId: p.processId,
          flexAssetScope,
          roleCoverage,
          operationalTasks: asArray(p.operationalTasks),
          dataSources: asArray(p.dataSources),
          controlCommandBoundary: normalizeString(p.controlCommandBoundary),
          softwareMonitoringOwner: normalizeString(p.softwareMonitoringOwner),
          commercialValueOwner: normalizeString(p.commercialValueOwner),
          escalationPath,
          interfaces: normalizeObject(p.interfaces),
          evidenceStatus,
          validationFindings: findings,
          blockingFindings: findings.filter((finding) => finding.severity === 'error'),
          missingDataPoints: [...new Set(missingDataPoints)],
          positiveFollowUps: buildPositiveFollowUps([...new Set(missingDataPoints)]),
          sourceActions: sourceActions.length > 0 ? sourceActions : DEFAULT_SOURCE_ACTIONS,
          forbiddenAutomaticActions: [
            'control-command-delivery',
            'device-status-update',
            'dispatch-activation',
            'hitl-approval',
            'mako-write',
            'settlement-write',
            'billing-write',
          ],
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        return { ...doc, roleModelId };
      },
    },

    listModels: {
      rest: 'GET /models',
      params: {
        processId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List flexibility conductor role models',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'query', name: 'processId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'flexibility-conductor-role-model' };
        if (ctx.params.processId) selector.processId = ctx.params.processId;
        const result = await this.db.find({ selector, limit: ctx.params.limit });
        return {
          models: result.docs.sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt))
          ),
        };
      },
    },

    getModel: {
      rest: 'GET /models/:roleModelId',
      params: { roleModelId: { type: 'string' } },
      openapi: {
        summary: 'Get a flexibility conductor role model',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'path', name: 'roleModelId', required: true, schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const model = await this.db.get(ctx.params.roleModelId);
          if (model.tenantId !== tenantId) {
            throw new MoleculerClientError('Role model not found', 404, 'ROLE_MODEL_NOT_FOUND');
          }
          return model;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Role model not found', 404, 'ROLE_MODEL_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    getStatus: {
      rest: 'GET /:processId/status',
      params: {
        processId: { type: 'string' },
        roleModelId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get dossier-safe flexibility conductor role-model status',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'path', name: 'processId', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'roleModelId', schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          let model;
          if (ctx.params.roleModelId) {
            model = await this.db.get(ctx.params.roleModelId);
            if (model.tenantId !== tenantId || model.processId !== ctx.params.processId) {
              throw new MoleculerClientError(
                'Role model status not found',
                404,
                'ROLE_MODEL_STATUS_NOT_FOUND'
              );
            }
          } else {
            const result = await this.db.find({
              selector: {
                tenantId,
                docType: 'flexibility-conductor-role-model',
                processId: ctx.params.processId,
              },
              limit: 50,
            });
            model = result.docs.sort((a, b) =>
              String(b.createdAt).localeCompare(String(a.createdAt))
            )[0];
            if (!model)
              throw new MoleculerClientError(
                'Role model status not found',
                404,
                'ROLE_MODEL_STATUS_NOT_FOUND'
              );
          }
          return buildStatusFromModel(model);
        } catch (err) {
          if (err.status === 404 || err.type === 'ROLE_MODEL_STATUS_NOT_FOUND') {
            return {
              found: false,
              processId: ctx.params.processId,
              message:
                'No flexibility conductor role-model evidence is available for this tenant yet',
            };
          }
          throw err;
        }
      },
    },
  },
};
