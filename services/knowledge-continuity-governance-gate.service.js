'use strict';

/**
 * Knowledge Continuity Governance Gate Service.
 *
 * Issue: #247
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  KCGG_DECISION_RIGHTS_MISSING,
  KCGG_CONTROL_BOUNDARY_MISSING,
  KCGG_MONITORING_OWNER_MISSING,
  KCGG_COMMERCIAL_OWNER_MISSING,
  KCGG_ESCALATION_PATH_MISSING,
  KCGG_SOURCE_ACTIONS_MISSING,
  KCGG_GOVERNANCE_GATE_READY,
  KCGG_GOVERNANCE_GATE_BLOCKED,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Knowledge Continuity Governance Gate';
const GOVERNANCE_GATE_PREFIX = 'kcgg:';

const DEFAULT_SOURCE_ACTIONS = [
  'vdmi.create',
  'vdmi-evidence.inject',
  'vdmi-findings.evaluate',
  'interface-placeholder.list',
  'hitl.create',
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

function buildPositiveFollowUps(missingDataPoints) {
  const mapping = {
    mainFolderRef: 'adds verified primary knowledge location',
    permissionOwner: 'adds accountable permission owner and escalation path',
    adminOwner: 'adds admin-rights continuity evidence',
    handoverDocumentRef: 'adds documented handover/readiness proof',
    chatMailBoundary: 'adds explicit volatile-vs-durable communication boundary',
    retentionPolicy: 'adds retention-policy evidence',
    deletionDeadline: 'adds deletion-risk evidence',
    itApprovalStatus: 'adds IT acceptance status and residual blocker classification',
    source_action_references:
      'adds traceability to reused VDMI/Evidence/HITL/Presentation capabilities',
  };
  return missingDataPoints.map((missingDataPoint) => ({
    missingDataPoint,
    enablesDossierAddition: mapping[missingDataPoint] || 'adds governance evidence to the dossier',
  }));
}

function buildAnswerFacts(model) {
  return {
    criticalProcessId: model.criticalProcessId,
    processName: model.processName,
    gateId: model._id,
    mainFolderRef: model.mainFolderRef,
    permissionOwner: model.permissionOwner,
    adminOwner: model.adminOwner,
    guestAccessPolicy: model.guestAccessPolicy,
    handoverDocumentRef: model.handoverDocumentRef,
    chatMailBoundary: model.chatMailBoundary,
    retentionPolicy: model.retentionPolicy,
    deletionDeadline: model.deletionDeadline,
    itApprovalStatus: model.itApprovalStatus,
    roleChangeRisk: model.roleChangeRisk,
    blockedCapabilities: model.blockedCapabilities,
    forbiddenAutomaticActions: model.forbiddenAutomaticActions,
    evidenceStatus: model.evidenceStatus,
    evaluatedAt: model.createdAt,
  };
}

function buildStatusFromModel(model) {
  const missingDataPoints = model.missingDataPoints || [];
  return {
    found: true,
    gateId: model._id,
    criticalProcessId: model.criticalProcessId,
    processName: model.processName,
    mainFolderRef: model.mainFolderRef,
    permissionOwner: model.permissionOwner,
    adminOwner: model.adminOwner,
    guestAccessPolicy: model.guestAccessPolicy,
    handoverDocumentRef: model.handoverDocumentRef,
    chatMailBoundary: model.chatMailBoundary,
    retentionPolicy: model.retentionPolicy,
    deletionDeadline: model.deletionDeadline,
    itApprovalStatus: model.itApprovalStatus,
    roleChangeRisk: model.roleChangeRisk,
    blockedCapabilities: model.blockedCapabilities,
    evidenceStatus: model.evidenceStatus,
    readinessScore: model.readinessScore,
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
  name: 'knowledge-continuity-governance-gate',

  settings: {
    dbPath:
      process.env.KNOWLEDGE_CONTINUITY_GOVERNANCE_GATE_DB_PATH ||
      './data/knowledge-continuity-governance-gate',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['criticalProcessId'] } });
    await this.db.createIndex({ index: { fields: ['evidenceStatus'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(
      `Knowledge Continuity Governance Gate DB initialized at ${this.settings.dbPath}`
    );
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/knowledge-continuity-governance-gate/evaluate:
     *   post:
     *     tags: [Knowledge Continuity Governance Gate]
     *     summary: Evaluate knowledge-continuity governance evidence
     *     security:
     *       - bearerAuth: []
     */
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        criticalProcessId: { type: 'string' },
        processName: { type: 'string', optional: true },
        mainFolderRef: { type: 'string', optional: true },
        permissionOwner: { type: 'string', optional: true },
        adminOwner: { type: 'string', optional: true },
        guestAccessPolicy: { type: 'string', optional: true },
        handoverDocumentRef: { type: 'string', optional: true },
        chatMailBoundary: { type: 'string', optional: true },
        retentionPolicy: { type: 'string', optional: true },
        deletionDeadline: { type: 'string', optional: true },
        itApprovalStatus: { type: 'string', optional: true },
        roleChangeRisk: { type: 'string', optional: true },
        blockedCapabilities: { type: 'array', optional: true, default: [] },
        evidenceRefs: { type: 'array', optional: true, default: [] },
        sourceActions: { type: 'array', optional: true, default: [] },
      },
      openapi: {
        summary: 'Evaluate knowledge-continuity governance evidence',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const p = ctx.params;
        const findings = [];
        const missingDataPoints = [];
        const sourceActions = asArray(p.sourceActions);
        const requiredStringFields = [
          'mainFolderRef',
          'permissionOwner',
          'adminOwner',
          'handoverDocumentRef',
          'chatMailBoundary',
          'retentionPolicy',
          'itApprovalStatus',
        ];

        for (const field of requiredStringFields) {
          if (!normalizeString(p[field])) missingDataPoints.push(field);
        }
        if (normalizeString(p.retentionPolicy) && !normalizeString(p.deletionDeadline)) {
          missingDataPoints.push('deletionDeadline');
        }
        if (sourceActions.length === 0) missingDataPoints.push('source_action_references');

        if (!normalizeString(p.permissionOwner)) {
          findings.push({
            finding: KCGG_DECISION_RIGHTS_MISSING,
            severity: 'error',
            message: 'Knowledge-continuity permission owner is missing',
          });
        }
        if (!normalizeString(p.adminOwner)) {
          findings.push({
            finding: KCGG_CONTROL_BOUNDARY_MISSING,
            severity: 'error',
            message: 'Knowledge-continuity admin owner is missing',
          });
        }
        if (!normalizeString(p.mainFolderRef)) {
          findings.push({
            finding: KCGG_MONITORING_OWNER_MISSING,
            severity: 'warning',
            message: 'Knowledge-continuity main folder reference is missing',
          });
        }
        if (!normalizeString(p.handoverDocumentRef)) {
          findings.push({
            finding: KCGG_COMMERCIAL_OWNER_MISSING,
            severity: 'warning',
            message: 'Knowledge-continuity handover document reference is missing',
          });
        }
        if (!normalizeString(p.chatMailBoundary) || !normalizeString(p.retentionPolicy)) {
          findings.push({
            finding: KCGG_ESCALATION_PATH_MISSING,
            severity: 'error',
            message: 'Knowledge-continuity durable communication or retention boundary is missing',
          });
        }
        if (sourceActions.length === 0) {
          findings.push({
            finding: KCGG_SOURCE_ACTIONS_MISSING,
            severity: 'warning',
            message: 'Knowledge-continuity source action references are missing',
          });
        }

        const hasError = findings.some((finding) => finding.severity === 'error');
        const hasWarning = findings.some((finding) => finding.severity === 'warning');
        const evidenceStatus = hasError ? 'blocked' : hasWarning ? 'ready_with_warnings' : 'ready';
        findings.push({
          finding: hasError ? KCGG_GOVERNANCE_GATE_BLOCKED : KCGG_GOVERNANCE_GATE_READY,
          severity: hasError ? 'error' : 'info',
          message: hasError
            ? 'Knowledge-continuity governance gate is blocked'
            : 'Knowledge-continuity governance gate is ready',
        });

        const governanceGateId = `${GOVERNANCE_GATE_PREFIX}${crypto.randomUUID()}`;
        const uniqueMissingDataPoints = [...new Set(missingDataPoints)];
        const readinessScore = Math.max(
          0,
          (requiredStringFields.length - uniqueMissingDataPoints.length) /
            requiredStringFields.length
        );
        const doc = {
          _id: governanceGateId,
          docType: 'knowledge-continuity-governance-gate',
          tenantId,
          criticalProcessId: p.criticalProcessId,
          processName: normalizeString(p.processName),
          mainFolderRef: normalizeString(p.mainFolderRef),
          permissionOwner: normalizeString(p.permissionOwner),
          adminOwner: normalizeString(p.adminOwner),
          guestAccessPolicy: normalizeString(p.guestAccessPolicy),
          handoverDocumentRef: normalizeString(p.handoverDocumentRef),
          chatMailBoundary: normalizeString(p.chatMailBoundary),
          retentionPolicy: normalizeString(p.retentionPolicy),
          deletionDeadline: normalizeString(p.deletionDeadline),
          itApprovalStatus: normalizeString(p.itApprovalStatus),
          roleChangeRisk: normalizeString(p.roleChangeRisk),
          blockedCapabilities: asArray(p.blockedCapabilities),
          evidenceRefs: asArray(p.evidenceRefs),
          evidenceStatus,
          readinessScore,
          validationFindings: findings,
          blockingFindings: findings.filter((finding) => finding.severity === 'error'),
          missingDataPoints: uniqueMissingDataPoints,
          positiveFollowUps: buildPositiveFollowUps(uniqueMissingDataPoints),
          sourceActions: sourceActions.length > 0 ? sourceActions : DEFAULT_SOURCE_ACTIONS,
          forbiddenAutomaticActions: [
            'permission-mutation',
            'admin-rights-mutation',
            'guest-access-change',
            'retention-policy-change',
            'external-collaboration-sync',
            'hitl-approval',
          ],
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        return { ...doc, governanceGateId };
      },
    },

    listGates: {
      rest: 'GET /gates',
      params: {
        criticalProcessId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List knowledge-continuity governance gates',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'criticalProcessId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'knowledge-continuity-governance-gate' };
        if (ctx.params.criticalProcessId) selector.criticalProcessId = ctx.params.criticalProcessId;
        const result = await this.db.find({ selector, limit: ctx.params.limit });
        return {
          gates: result.docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
        };
      },
    },

    getGate: {
      rest: 'GET /gates/:governanceGateId',
      params: { governanceGateId: { type: 'string' } },
      openapi: {
        summary: 'Get a knowledge-continuity governance gate',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'path', name: 'governanceGateId', required: true, schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const model = await this.db.get(ctx.params.governanceGateId);
          if (model.tenantId !== tenantId) {
            throw new MoleculerClientError(
              'Governance gate not found',
              404,
              'GOVERNANCE_GATE_NOT_FOUND'
            );
          }
          return model;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              'Governance gate not found',
              404,
              'GOVERNANCE_GATE_NOT_FOUND'
            );
          }
          throw err;
        }
      },
    },

    getStatus: {
      rest: 'GET /:processId/status',
      params: {
        processId: { type: 'string', optional: true },
        criticalProcessId: { type: 'string', optional: true },
        governanceGateId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get dossier-safe knowledge-continuity governance status',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'path', name: 'processId', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'criticalProcessId', schema: { type: 'string' } },
          { in: 'query', name: 'governanceGateId', schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const requestedProcessId = ctx.params.processId || ctx.params.criticalProcessId;
        try {
          let model;
          if (ctx.params.governanceGateId) {
            model = await this.db.get(ctx.params.governanceGateId);
            if (
              model.tenantId !== tenantId ||
              (requestedProcessId && model.criticalProcessId !== requestedProcessId)
            ) {
              throw new MoleculerClientError(
                'Governance gate status not found',
                404,
                'GOVERNANCE_GATE_STATUS_NOT_FOUND'
              );
            }
          } else {
            const result = await this.db.find({
              selector: {
                tenantId,
                docType: 'knowledge-continuity-governance-gate',
                criticalProcessId: requestedProcessId,
              },
              limit: 50,
            });
            model = result.docs.sort((a, b) =>
              String(b.createdAt).localeCompare(String(a.createdAt))
            )[0];
            if (!model)
              throw new MoleculerClientError(
                'Governance gate status not found',
                404,
                'GOVERNANCE_GATE_STATUS_NOT_FOUND'
              );
          }
          return buildStatusFromModel(model);
        } catch (err) {
          if (err.status === 404 || err.type === 'GOVERNANCE_GATE_STATUS_NOT_FOUND') {
            return {
              found: false,
              criticalProcessId: requestedProcessId,
              message:
                'No knowledge-continuity governance evidence is available for this tenant yet',
            };
          }
          throw err;
        }
      },
    },
  },
};
