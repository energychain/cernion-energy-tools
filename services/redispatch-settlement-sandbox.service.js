'use strict';

/**
 * Redispatch Settlement Sandbox Service (v0.62)
 *
 * Immutable append-only settlement scenario orchestration with kWh→EUR method
 * variants and A96 reconciliation orchestration.
 *
 * Issue: #216
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  RDSS_MISSING_SCENARIO,
  RDSS_MISSING_DATAPOINT_EVIDENCE,
  RDSS_SCENARIO_COMPLETE,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Redispatch Settlement Sandbox';
const SCENARIO_PREFIX = 'rdss:';

const SETTLEMENT_METHODS = ['eeg_tariff', 'market_price', 'additional_effort', 'avoided_cost'];

function nowIso() {
  return new Date().toISOString();
}

/**
 * Compute a deterministic input hash from sorted artifact and datapoint refs.
 */
function computeInputHash(inputArtifactRefs, datapointRefs) {
  const sorted = [...(inputArtifactRefs || []), ...(datapointRefs || [])].sort();
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

module.exports = {
  name: 'redispatch-settlement-sandbox',

  settings: {
    dbPath:
      process.env.REDISPATCH_SETTLEMENT_SANDBOX_DB_PATH || './data/redispatch-settlement-sandbox',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['periodStart'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Redispatch Settlement Sandbox DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    // ── Scenarios ─────────────────────────────────────────────────────────

    /**
     * @openapi
     * /api/redispatch-settlement-sandbox/scenarios:
     *   post:
     *     tags: [Redispatch Settlement Sandbox]
     *     summary: Create a settlement scenario
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, periodStart, periodEnd, settlementMethod, policyVersion]
     *             properties:
     *               gridOperatorId: { type: string }
     *               periodStart: { type: string, format: date-time }
     *               periodEnd: { type: string, format: date-time }
     *               settlementMethod:
     *                 type: string
     *                 enum: [eeg_tariff, market_price, additional_effort, avoided_cost]
     *               inputArtifactRefs: { type: array, items: { type: string } }
     *               datapointRefs: { type: array, items: { type: string } }
     *               policyVersion: { type: string }
     *               parentScenarioId: { type: string }
     *               notes: { type: string }
     *     responses:
     *       200:
     *         description: Created scenario
     */
    createScenario: {
      rest: 'POST /scenarios',
      params: {
        gridOperatorId: { type: 'string' },
        periodStart: { type: 'string' },
        periodEnd: { type: 'string' },
        settlementMethod: { type: 'enum', values: SETTLEMENT_METHODS },
        inputArtifactRefs: { type: 'array', optional: true, default: [], items: 'string' },
        datapointRefs: { type: 'array', optional: true, default: [], items: 'string' },
        policyVersion: { type: 'string' },
        parentScenarioId: { type: 'string', optional: true },
        notes: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Create a settlement scenario',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          gridOperatorId,
          periodStart,
          periodEnd,
          settlementMethod,
          inputArtifactRefs,
          datapointRefs,
          policyVersion,
          parentScenarioId,
          notes,
        } = ctx.params;

        const scenarioId = `${SCENARIO_PREFIX}${crypto.randomUUID()}`;
        const inputHash = computeInputHash(inputArtifactRefs, datapointRefs);

        const doc = {
          _id: scenarioId,
          docType: 'rdss-scenario',
          tenantId,
          gridOperatorId,
          periodStart,
          periodEnd,
          settlementMethod,
          inputArtifactRefs,
          datapointRefs,
          policyVersion,
          parentScenarioId: parentScenarioId || null,
          notes: notes || null,
          inputHash,
          status: 'created',
          reconcileResult: null,
          findings: [],
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(`RDSS scenario created: ${scenarioId}`);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/redispatch-settlement-sandbox/scenarios/{id}:
     *   get:
     *     tags: [Redispatch Settlement Sandbox]
     *     summary: Get scenario by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Scenario document
     *       404:
     *         description: Not found
     */
    getScenario: {
      rest: 'GET /scenarios/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get scenario by ID',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Scenario not found', 404, 'SCENARIO_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    /**
     * @openapi
     * /api/redispatch-settlement-sandbox/scenarios:
     *   get:
     *     tags: [Redispatch Settlement Sandbox]
     *     summary: List settlement scenarios
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: periodStart
     *         schema: { type: string }
     *       - in: query
     *         name: status
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: List of scenarios
     */
    listScenarios: {
      rest: 'GET /scenarios',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        periodStart: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List settlement scenarios',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, periodStart, status, limit } = ctx.params;

        const selector = { tenantId, docType: 'rdss-scenario' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (periodStart) selector.periodStart = periodStart;
        if (status) selector.status = status;

        const result = await this.db.find({ selector, limit });
        return { scenarios: result.docs };
      },
    },

    /**
     * @openapi
     * /api/redispatch-settlement-sandbox/scenarios/{id}/reconcile:
     *   post:
     *     tags: [Redispatch Settlement Sandbox]
     *     summary: Reconcile a settlement scenario
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Updated scenario after reconciliation
     */
    reconcile: {
      rest: 'POST /scenarios/:id/reconcile',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Reconcile a settlement scenario',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let scenario;
        try {
          scenario = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Scenario not found', 404, 'SCENARIO_NOT_FOUND');
          }
          throw err;
        }

        // Scenario is immutable after reconcile
        if (scenario.status === 'reconciled') {
          throw new MoleculerClientError(
            'Scenario is already reconciled and immutable. Create a new scenario to re-run.',
            409,
            'SCENARIO_ALREADY_RECONCILED'
          );
        }

        const findings = [];

        // Check for input artifact refs
        if (!scenario.inputArtifactRefs || scenario.inputArtifactRefs.length === 0) {
          findings.push({
            finding: RDSS_MISSING_SCENARIO,
            severity: 'error',
            message: 'Scenario has no input artifact references — reconciliation cannot proceed',
          });

          const updated = {
            ...scenario,
            status: 'reconcile_failed',
            findings,
            reconciledAt: nowIso(),
          };
          await this.db.put(updated);
          return updated;
        }

        // Try to call settlement.a96Reconcile
        let reconcileResult = null;
        try {
          reconcileResult = await ctx.call('settlement.a96Reconcile', {
            gridOperatorId: scenario.gridOperatorId,
            periodStart: scenario.periodStart,
            periodEnd: scenario.periodEnd,
            settlementMethod: scenario.settlementMethod,
            inputArtifactRefs: scenario.inputArtifactRefs,
            datapointRefs: scenario.datapointRefs,
          });
        } catch (_err) {
          findings.push({
            finding: RDSS_MISSING_DATAPOINT_EVIDENCE,
            severity: 'error',
            message: 'Settlement service unavailable or required datapoint evidence is missing',
          });

          const updated = {
            ...scenario,
            status: 'reconcile_failed',
            findings,
            reconciledAt: nowIso(),
          };
          await this.db.put(updated);
          return updated;
        }

        findings.push({
          finding: RDSS_SCENARIO_COMPLETE,
          severity: 'info',
          message: 'Settlement scenario reconciliation completed successfully',
        });

        const updated = {
          ...scenario,
          status: 'reconciled',
          reconcileResult,
          findings,
          reconciledAt: nowIso(),
        };
        await this.db.put(updated);
        return updated;
      },
    },

    /**
     * @openapi
     * /api/redispatch-settlement-sandbox/scenarios/{id}/download:
     *   get:
     *     tags: [Redispatch Settlement Sandbox]
     *     summary: Download scenario as JSON or text summary
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: format
     *         schema: { type: string, enum: [json, text], default: json }
     *     responses:
     *       200:
     *         description: Scenario export
     */
    downloadScenario: {
      rest: 'GET /scenarios/:id/download',
      params: {
        id: { type: 'string' },
        format: { type: 'enum', values: ['json', 'text'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Download scenario as JSON or text summary',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let scenario;
        try {
          scenario = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Scenario not found', 404, 'SCENARIO_NOT_FOUND');
          }
          throw err;
        }

        const { format } = ctx.params;

        if (format === 'text') {
          const lines = [
            `Redispatch Settlement Sandbox — Scenario Export`,
            `ID: ${scenario._id}`,
            `Grid Operator: ${scenario.gridOperatorId}`,
            `Period: ${scenario.periodStart} – ${scenario.periodEnd}`,
            `Settlement Method: ${scenario.settlementMethod}`,
            `Policy Version: ${scenario.policyVersion}`,
            `Status: ${scenario.status}`,
            `Input Hash: ${scenario.inputHash}`,
            `Input Artifact Refs: ${(scenario.inputArtifactRefs || []).join(', ') || '(none)'}`,
            `Datapoint Refs: ${(scenario.datapointRefs || []).join(', ') || '(none)'}`,
            `Created: ${scenario.createdAt}`,
            scenario.reconciledAt ? `Reconciled: ${scenario.reconciledAt}` : '',
            `Findings: ${(scenario.findings || []).map((f) => f.finding).join(', ') || '(none)'}`,
          ]
            .filter(Boolean)
            .join('\n');

          return { format: 'text', content: lines, scenarioId: scenario._id };
        }

        return { format: 'json', scenario };
      },
    },
  },
};
