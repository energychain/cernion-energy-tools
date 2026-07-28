'use strict';

/**
 * Redispatch Data Governance Service (v0.62)
 *
 * Process governance layer with configurable deadline classes, owner model,
 * source-of-record resolution, and deterministic governance findings.
 *
 * Issue: #214
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  RDG_DEADLINE_MISSED,
  RDG_OWNER_UNASSIGNED,
  RDG_SOURCE_OF_RECORD_UNRESOLVED,
  RDG_GOVERNANCE_POLICY_MISSING,
  RDG_GOVERNANCE_COMPLIANT,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Redispatch Data Governance';
const POLICY_PREFIX = 'rdg-policy:';
const EVALUATION_PREFIX = 'rdg-eval:';

const OWNER_TYPES = ['org-unit', 'user', 'role', 'market-party', 'external-contact'];
const ASSIGNMENT_MODES = ['rule', 'manual', 'fallback'];

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'redispatch-data-governance',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'REDISPATCH_DATA_GOVERNANCE_DB_PATH',
      defaultDbPath: './data/redispatch-data-governance',
      indexes: [['tenantId', 'docType'], ['dataClass', 'processId'], ['status'], ['createdAt']],
    }),
  ],

  actions: {
    // ── Policies ──────────────────────────────────────────────────────────

    /**
     * @openapi
     * /api/redispatch-data-governance/policies:
     *   post:
     *     tags: [Redispatch Data Governance]
     *     summary: Create a governance policy
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [dataClass, processId, deadlineClass, ownerType, ownerRef, assignmentMode, policyVersion]
     *             properties:
     *               dataClass: { type: string }
     *               processId: { type: string }
     *               deadlineClass: { type: string }
     *               calendarRule: { type: object }
     *               ownerType: { type: string, enum: [org-unit, user, role, market-party, external-contact] }
     *               ownerRef: { type: string }
     *               assignmentMode: { type: string, enum: [rule, manual, fallback] }
     *               severityOnMiss: { type: string, enum: [error, warning] }
     *               sourceOfRecordPriority: { type: array, items: { type: string } }
     *               policyVersion: { type: string }
     *     responses:
     *       200:
     *         description: Created policy
     */
    createPolicy: {
      rest: 'POST /policies',
      params: {
        dataClass: { type: 'string' },
        processId: { type: 'string' },
        deadlineClass: { type: 'string' },
        calendarRule: { type: 'object', optional: true },
        ownerType: { type: 'enum', values: OWNER_TYPES },
        ownerRef: { type: 'string', optional: true },
        assignmentMode: { type: 'enum', values: ASSIGNMENT_MODES },
        severityOnMiss: {
          type: 'enum',
          values: ['error', 'warning'],
          optional: true,
          default: 'error',
        },
        sourceOfRecordPriority: { type: 'array', optional: true, default: [], items: 'string' },
        policyVersion: { type: 'string' },
      },
      openapi: {
        summary: 'Create a governance policy',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          dataClass,
          processId,
          deadlineClass,
          calendarRule,
          ownerType,
          ownerRef,
          assignmentMode,
          severityOnMiss,
          sourceOfRecordPriority,
          policyVersion,
        } = ctx.params;

        const policyId = `${POLICY_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: policyId,
          docType: 'rdg-policy',
          tenantId,
          dataClass,
          processId,
          deadlineClass,
          calendarRule: calendarRule || null,
          ownerType,
          ownerRef: ownerRef || null,
          assignmentMode,
          severityOnMiss,
          sourceOfRecordPriority,
          policyVersion,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(`RDG policy created: ${policyId}`);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/redispatch-data-governance/policies:
     *   get:
     *     tags: [Redispatch Data Governance]
     *     summary: List governance policies
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: dataClass
     *         schema: { type: string }
     *       - in: query
     *         name: processId
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: List of policies
     */
    listPolicies: {
      rest: 'GET /policies',
      params: {
        dataClass: { type: 'string', optional: true },
        processId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List governance policies',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'dataClass', schema: { type: 'string' } },
          { in: 'query', name: 'processId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { dataClass, processId, limit } = ctx.params;

        const selector = { tenantId, docType: 'rdg-policy' };
        if (dataClass) selector.dataClass = dataClass;
        if (processId) selector.processId = processId;

        const result = await this.db.find({ selector, limit });
        return { policies: result.docs };
      },
    },

    /**
     * @openapi
     * /api/redispatch-data-governance/policies/{id}:
     *   get:
     *     tags: [Redispatch Data Governance]
     *     summary: Get policy by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Policy document
     *       404:
     *         description: Not found
     */
    getPolicy: {
      rest: 'GET /policies/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get policy by ID',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Policy not found', 404, 'POLICY_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    /**
     * @openapi
     * /api/redispatch-data-governance/policies/{id}:
     *   put:
     *     tags: [Redispatch Data Governance]
     *     summary: Update policy by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Updated policy
     *       404:
     *         description: Not found
     */
    updatePolicy: {
      rest: 'PUT /policies/:id',
      params: {
        id: { type: 'string' },
        dataClass: { type: 'string', optional: true },
        processId: { type: 'string', optional: true },
        deadlineClass: { type: 'string', optional: true },
        calendarRule: { type: 'object', optional: true },
        ownerType: { type: 'enum', values: OWNER_TYPES, optional: true },
        ownerRef: { type: 'string', optional: true },
        assignmentMode: { type: 'enum', values: ASSIGNMENT_MODES, optional: true },
        severityOnMiss: { type: 'enum', values: ['error', 'warning'], optional: true },
        sourceOfRecordPriority: { type: 'array', optional: true, items: 'string' },
        policyVersion: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Update policy by ID',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Policy not found', 404, 'POLICY_NOT_FOUND');
          }
          throw err;
        }

        const updatable = [
          'dataClass',
          'processId',
          'deadlineClass',
          'calendarRule',
          'ownerType',
          'ownerRef',
          'assignmentMode',
          'severityOnMiss',
          'sourceOfRecordPriority',
          'policyVersion',
        ];
        for (const key of updatable) {
          if (ctx.params[key] !== undefined) {
            doc[key] = ctx.params[key];
          }
        }
        doc.updatedAt = nowIso();

        await this.db.put(doc);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/redispatch-data-governance/policies/{id}:
     *   delete:
     *     tags: [Redispatch Data Governance]
     *     summary: Delete policy by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Deleted
     *       404:
     *         description: Not found
     */
    deletePolicy: {
      rest: 'DELETE /policies/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Delete policy by ID',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Policy not found', 404, 'POLICY_NOT_FOUND');
          }
          throw err;
        }
        await this.db.remove(doc);
        return { success: true, id: ctx.params.id };
      },
    },

    // ── Evaluate ──────────────────────────────────────────────────────────

    /**
     * @openapi
     * /api/redispatch-data-governance/evaluate:
     *   post:
     *     tags: [Redispatch Data Governance]
     *     summary: Evaluate governance status for a data class and process
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [dataClass, processId, periodStart, periodEnd]
     *             properties:
     *               dataClass: { type: string }
     *               processId: { type: string }
     *               periodStart: { type: string, format: date-time }
     *               periodEnd: { type: string, format: date-time }
     *               fileMonitorStatus: { type: object }
     *               availableSources: { type: array, items: { type: string } }
     *     responses:
     *       200:
     *         description: Governance evaluation result
     */
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        dataClass: { type: 'string' },
        processId: { type: 'string' },
        periodStart: { type: 'string' },
        periodEnd: { type: 'string' },
        fileMonitorStatus: { type: 'object', optional: true },
        availableSources: { type: 'array', optional: true, default: [], items: 'string' },
      },
      openapi: {
        summary: 'Evaluate governance status for a data class and process',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          dataClass,
          processId,
          periodStart,
          periodEnd,
          fileMonitorStatus,
          availableSources,
        } = ctx.params;

        // Find matching policy
        const policyResult = await this.db.find({
          selector: { tenantId, docType: 'rdg-policy', dataClass, processId },
          limit: 1,
        });

        const findings = [];
        let policyId = null;
        let policyVersion = null;

        if (policyResult.docs.length === 0) {
          findings.push({
            finding: RDG_GOVERNANCE_POLICY_MISSING,
            severity: 'error',
            message: `No governance policy found for dataClass=${dataClass}, processId=${processId}`,
          });

          const status = 'blocked';
          const evalId = `${EVALUATION_PREFIX}${crypto.randomUUID()}`;
          const evalDoc = {
            _id: evalId,
            docType: 'rdg-evaluation',
            tenantId,
            dataClass,
            processId,
            periodStart,
            periodEnd,
            status,
            findings,
            policyId: null,
            policyVersion: null,
            evaluatedAt: nowIso(),
          };
          await this.db.put(evalDoc);

          return {
            dataClass,
            processId,
            status,
            findings,
            policyId: null,
            policyVersion: null,
            evaluatedAt: evalDoc.evaluatedAt,
          };
        }

        const policy = policyResult.docs[0];
        policyId = policy._id;
        policyVersion = policy.policyVersion;

        // Check owner
        if (!policy.ownerRef) {
          findings.push({
            finding: RDG_OWNER_UNASSIGNED,
            severity: 'warning',
            message: 'No owner is assigned to the governance policy for this data class',
          });
        }

        // Check file monitor status
        if (fileMonitorStatus && fileMonitorStatus.status === 'red') {
          findings.push({
            finding: RDG_DEADLINE_MISSED,
            severity: policy.severityOnMiss || 'error',
            message: 'Data delivery deadline has been missed — file monitor status is red',
          });
        }

        // Check source of record
        if (
          policy.sourceOfRecordPriority &&
          policy.sourceOfRecordPriority.length > 0 &&
          availableSources.length > 0
        ) {
          const topSource = policy.sourceOfRecordPriority[0];
          if (!availableSources.includes(topSource)) {
            findings.push({
              finding: RDG_SOURCE_OF_RECORD_UNRESOLVED,
              severity: 'warning',
              message: `Preferred source of record '${topSource}' is not available in the provided source list`,
            });
          }
        }

        // Determine overall status
        const hasError = findings.some((f) => f.severity === 'error');
        const hasWarning = findings.some((f) => f.severity === 'warning');

        let status;
        if (hasError) {
          status = 'blocked';
        } else if (hasWarning) {
          status = 'warning';
        } else {
          status = 'compliant';
          findings.push({
            finding: RDG_GOVERNANCE_COMPLIANT,
            severity: 'info',
            message: 'Governance evaluation passed — all policy criteria met',
          });
        }

        const evaluatedAt = nowIso();
        const evalId = `${EVALUATION_PREFIX}${crypto.randomUUID()}`;
        const evalDoc = {
          _id: evalId,
          docType: 'rdg-evaluation',
          tenantId,
          dataClass,
          processId,
          periodStart,
          periodEnd,
          status,
          findings,
          policyId,
          policyVersion,
          evaluatedAt,
        };
        await this.db.put(evalDoc);

        return { dataClass, processId, status, findings, policyId, policyVersion, evaluatedAt };
      },
    },

    /**
     * @openapi
     * /api/redispatch-data-governance/evaluations:
     *   get:
     *     tags: [Redispatch Data Governance]
     *     summary: List governance evaluations
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: dataClass
     *         schema: { type: string }
     *       - in: query
     *         name: processId
     *         schema: { type: string }
     *       - in: query
     *         name: status
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: List of evaluations
     */
    listEvaluations: {
      rest: 'GET /evaluations',
      params: {
        dataClass: { type: 'string', optional: true },
        processId: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List governance evaluations',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'dataClass', schema: { type: 'string' } },
          { in: 'query', name: 'processId', schema: { type: 'string' } },
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { dataClass, processId, status, limit } = ctx.params;

        const selector = { tenantId, docType: 'rdg-evaluation' };
        if (dataClass) selector.dataClass = dataClass;
        if (processId) selector.processId = processId;
        if (status) selector.status = status;

        const result = await this.db.find({ selector, limit });
        return { evaluations: result.docs };
      },
    },
  },
};
