'use strict';

/**
 * Redispatch Readiness Gate Service (v0.63)
 *
 * Tenant-scoped readiness gate for Redispatch operational acceptance.
 *
 * Issue: #243
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  RRG_ACCESS_MATRIX_COMPLETE,
  RRG_ACCESS_MATRIX_INCOMPLETE,
  RRG_TEST_CALL_PASSED,
  RRG_TEST_CALL_MISSING,
  RRG_TEST_CALL_FAILED,
  RRG_PRODUCTION_PROOF_CONFIRMED,
  RRG_PRODUCTION_PROOF_MISSING,
  RRG_TEMPLATE_VERSION_CURRENT,
  RRG_TEMPLATE_VERSION_OUTDATED,
  RRG_OPEN_QUESTIONS_PRESENT,
  RRG_RESPONSIBLE_ROLE_ASSIGNED,
  RRG_RESPONSIBLE_ROLE_MISSING,
  RRG_ACCEPTANCE_DEADLINE_MISSED,
  RRG_ACCEPTANCE_DEADLINE_APPROACHING,
  RRG_GATE_READY,
  RRG_GATE_READY_WITH_WARNINGS,
  RRG_GATE_BLOCKED,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Redispatch Readiness Gate';
const RUN_PREFIX = 'rrg:';
const REQUIRED_ACCESS_KEYS = ['gui', 'sftp', 'testsystem', 'produktivsystem'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeAccessEntry(entry) {
  if (typeof entry === 'boolean') return { granted: entry };
  if (entry && typeof entry === 'object') {
    return { ...entry, granted: Boolean(entry.granted) };
  }
  return { granted: false };
}

function daysUntil(dateString, now = new Date()) {
  if (!dateString) return null;
  const deadline = new Date(dateString);
  if (Number.isNaN(deadline.getTime())) return null;
  return Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function buildStatusFromRun(run) {
  return {
    found: true,
    runId: run._id,
    processId: run.processId,
    overallStatus: run.status,
    accessMatrixStatus: run.accessMatrixStatus,
    testCallStatus: run.testCallStatus,
    productionProofConfirmed: run.productionProofConfirmed,
    templateVersion: run.templateVersion,
    requiredTemplateVersion: run.requiredTemplateVersion,
    templateVersionCurrent: run.templateVersionCurrent,
    openQuestionsCount: run.openQuestionsCount,
    responsibleRole: run.responsibleRole,
    acceptanceDeadline: run.acceptanceDeadline,
    daysUntilDeadline: run.daysUntilDeadline,
    evaluatedAt: run.createdAt,
    findings: run.findings,
  };
}

module.exports = {
  name: 'redispatch-readiness-gate',

  settings: {
    dbPath: process.env.REDISPATCH_READINESS_GATE_DB_PATH || './data/redispatch-readiness-gate',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['processId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Redispatch Readiness Gate DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/redispatch-readiness-gate/evaluate:
     *   post:
     *     tags: [Redispatch Readiness Gate]
     *     summary: Evaluate Redispatch operational readiness
     *     security:
     *       - bearerAuth: []
     */
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        processId: { type: 'string' },
        accessMatrix: { type: 'object', optional: true, default: {} },
        testCallStatus: {
          type: 'enum',
          values: ['missing', 'pending', 'passed', 'failed'],
          optional: true,
          default: 'missing',
        },
        productionProofConfirmed: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
        templateVersion: { type: 'string', optional: true },
        requiredTemplateVersion: { type: 'string', optional: true },
        openQuestions: { type: 'array', optional: true, default: [] },
        responsibleRole: { type: 'string', optional: true },
        acceptanceDeadline: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Evaluate Redispatch operational readiness',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          processId,
          accessMatrix,
          testCallStatus,
          productionProofConfirmed,
          templateVersion,
          requiredTemplateVersion,
          openQuestions,
          responsibleRole,
          acceptanceDeadline,
        } = ctx.params;

        const findings = [];
        const normalizedAccessMatrix = {};
        const missingAccess = [];

        for (const key of REQUIRED_ACCESS_KEYS) {
          normalizedAccessMatrix[key] = normalizeAccessEntry(accessMatrix[key]);
          if (!normalizedAccessMatrix[key].granted) missingAccess.push(key);
        }

        if (missingAccess.length > 0) {
          findings.push({
            finding: RRG_ACCESS_MATRIX_INCOMPLETE,
            severity: 'error',
            message: `Redispatch access matrix incomplete: ${missingAccess.join(', ')}`,
            missingAccess,
          });
        } else {
          findings.push({
            finding: RRG_ACCESS_MATRIX_COMPLETE,
            severity: 'info',
            message: 'Redispatch GUI, SFTP, test system and production system access confirmed',
          });
        }

        if (testCallStatus === 'passed') {
          findings.push({
            finding: RRG_TEST_CALL_PASSED,
            severity: 'info',
            message: 'Redispatch test call passed',
          });
        } else if (testCallStatus === 'failed') {
          findings.push({
            finding: RRG_TEST_CALL_FAILED,
            severity: 'error',
            message: 'Redispatch test call failed',
          });
        } else {
          findings.push({
            finding: RRG_TEST_CALL_MISSING,
            severity: 'warning',
            message: 'Redispatch test call is missing or still pending',
          });
        }

        if (productionProofConfirmed) {
          findings.push({
            finding: RRG_PRODUCTION_PROOF_CONFIRMED,
            severity: 'info',
            message: 'Production readiness proof confirmed',
          });
        } else {
          findings.push({
            finding: RRG_PRODUCTION_PROOF_MISSING,
            severity: 'error',
            message: 'Production readiness proof is missing',
          });
        }

        const templateVersionCurrent =
          !requiredTemplateVersion || templateVersion === requiredTemplateVersion;
        if (templateVersionCurrent) {
          findings.push({
            finding: RRG_TEMPLATE_VERSION_CURRENT,
            severity: 'info',
            message: 'Redispatch master-data template version is current',
          });
        } else {
          findings.push({
            finding: RRG_TEMPLATE_VERSION_OUTDATED,
            severity: 'warning',
            message: `Template version ${templateVersion || 'unknown'} does not match required version ${requiredTemplateVersion}`,
          });
        }

        const openQuestionsCount = Array.isArray(openQuestions) ? openQuestions.length : 0;
        if (openQuestionsCount > 0) {
          findings.push({
            finding: RRG_OPEN_QUESTIONS_PRESENT,
            severity: 'warning',
            message: `${openQuestionsCount} open Redispatch readiness question(s) remain`,
          });
        }

        if (responsibleRole) {
          findings.push({
            finding: RRG_RESPONSIBLE_ROLE_ASSIGNED,
            severity: 'info',
            message: `Responsible Redispatch role assigned: ${responsibleRole}`,
          });
        } else {
          findings.push({
            finding: RRG_RESPONSIBLE_ROLE_MISSING,
            severity: 'warning',
            message: 'Responsible Redispatch IT/business role is missing',
          });
        }

        const remainingDays = daysUntil(acceptanceDeadline);
        if (remainingDays !== null && remainingDays < 0) {
          findings.push({
            finding: RRG_ACCEPTANCE_DEADLINE_MISSED,
            severity: 'error',
            message: `Acceptance deadline missed by ${Math.abs(remainingDays)} day(s)`,
          });
        } else if (remainingDays !== null && remainingDays <= 7) {
          findings.push({
            finding: RRG_ACCEPTANCE_DEADLINE_APPROACHING,
            severity: 'warning',
            message: `Acceptance deadline approaches in ${remainingDays} day(s)`,
          });
        }

        const hasError = findings.some((f) => f.severity === 'error');
        const hasWarning = findings.some((f) => f.severity === 'warning');
        const status = hasError ? 'blocked' : hasWarning ? 'ready_with_warnings' : 'ready';

        findings.push({
          finding:
            status === 'blocked'
              ? RRG_GATE_BLOCKED
              : status === 'ready_with_warnings'
                ? RRG_GATE_READY_WITH_WARNINGS
                : RRG_GATE_READY,
          severity:
            status === 'blocked' ? 'error' : status === 'ready_with_warnings' ? 'warning' : 'info',
          message:
            status === 'blocked'
              ? 'Redispatch readiness gate blocked'
              : status === 'ready_with_warnings'
                ? 'Redispatch readiness gate ready with warnings'
                : 'Redispatch readiness gate ready',
        });

        const runId = `${RUN_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: runId,
          docType: 'rrg-eval',
          tenantId,
          processId,
          status,
          accessMatrix: normalizedAccessMatrix,
          accessMatrixStatus: missingAccess.length > 0 ? 'incomplete' : 'complete',
          testCallStatus,
          productionProofConfirmed,
          templateVersion: templateVersion || null,
          requiredTemplateVersion: requiredTemplateVersion || null,
          templateVersionCurrent,
          openQuestions: Array.isArray(openQuestions) ? openQuestions : [],
          openQuestionsCount,
          responsibleRole: responsibleRole || null,
          acceptanceDeadline: acceptanceDeadline || null,
          daysUntilDeadline: remainingDays,
          findings,
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(`Redispatch Readiness Gate evaluation created: ${runId}`);
        return { ...doc, gateRunId: runId };
      },
    },

    listRuns: {
      rest: 'GET /runs',
      params: {
        processId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List Redispatch readiness gate runs',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'rrg-eval' };
        if (ctx.params.processId) selector.processId = ctx.params.processId;

        const result = await this.db.find({ selector, limit: ctx.params.limit });
        const runs = result.docs.sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt))
        );
        return { runs };
      },
    },

    getRun: {
      rest: 'GET /runs/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get Redispatch readiness gate run',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const run = await this.db.get(ctx.params.id);
          if (run.tenantId !== tenantId) {
            throw new MoleculerClientError('Run not found', 404, 'RUN_NOT_FOUND');
          }
          return run;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Run not found', 404, 'RUN_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    getStatus: {
      rest: 'GET /status',
      params: {
        processId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get latest Redispatch readiness status',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'rrg-eval' };
        if (ctx.params.processId) selector.processId = ctx.params.processId;

        const result = await this.db.find({ selector, limit: 100 });
        const latest = result.docs.sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt))
        )[0];

        if (!latest) {
          return {
            found: false,
            message: 'No Redispatch readiness evaluation is available for this tenant yet',
          };
        }

        return buildStatusFromRun(latest);
      },
    },
  },
};
