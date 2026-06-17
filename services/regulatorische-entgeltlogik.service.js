'use strict';

/**
 * Regulatorische Entgeltlogik Service — Regulatory Tariff Rule Versioning
 *
 * Issue #128 — Regulatorische Entgeltlogik
 *
 * Regulatory tariff formulas, fee matrices, and grid charges are subject to
 * regular amendments (ARegV, StromNEV, § 14a EnWG). Billing systems and
 * reporting tools depend on these rules being correct and version-controlled.
 * An audit trail showing which rule version was active for a given billing period
 * is legally required.
 *
 * This service provides:
 *   1. Rule set registry with validity periods (effectiveFrom / effectiveTo)
 *   2. Built-in test cases per rule set (expected outputs for known inputs)
 *   3. Billing impact estimation when transitioning between rule versions
 *   4. Active rule set lookup for a given reference date
 *   5. Audit trail of rule changes with justification
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const RS_PREFIX = 'rel:';

const RULE_TYPE = Object.freeze({
  NETWORK_USAGE_FEE: 'NETWORK_USAGE_FEE', // Netznutzungsentgelt
  METER_OPERATION: 'METER_OPERATION', // Messstellenbetrieb
  REACTIVE_POWER: 'REACTIVE_POWER', // Blindleistungsentgelt
  CONCESSION_FEE: 'CONCESSION_FEE', // Konzessionsabgabe
  DYNAMIC_FEE_14A: 'DYNAMIC_FEE_14A', // §14a EnWG dynamisches Netzentgelt
  FEED_IN_MANAGEMENT: 'FEED_IN_MANAGEMENT', // Einspeisemanagement-Entschädigung
  BALANCING_ENERGY: 'BALANCING_ENERGY', // Ausgleichsenergie
  CAPACITY_CHARGE: 'CAPACITY_CHARGE', // Leistungspreis
});

/**
 * Run the built-in test cases for a rule set and return pass/fail results.
 */
function runTestCases(ruleSet) {
  const results = [];
  for (const tc of ruleSet.testCases ?? []) {
    const actual = evaluateRule(ruleSet, tc.input);
    const passed = Math.abs(actual - tc.expectedOutput) < (tc.tolerance ?? 0.01);
    results.push({
      testCaseId: tc.testCaseId ?? crypto.randomUUID(),
      description: tc.description ?? null,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
      actualOutput: actual,
      passed,
    });
  }
  const passCount = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed: passCount,
    failed: results.length - passCount,
    allPassed: passCount === results.length,
    results,
  };
}

/**
 * Simple rule evaluator. Rules express a formula via fields:
 *   formula: 'LINEAR' → output = baseRate * input.quantity + fixedCharge
 *   formula: 'TIERED' → tiered rate by quantity bands
 *   formula: 'FIXED'  → output = fixedCharge
 */
function evaluateRule(ruleSet, input) {
  const { formula, baseRate, fixedCharge, tiers } = ruleSet.formulaDefinition ?? {};
  const quantity = input.quantity ?? 0;

  if (formula === 'FIXED') {
    return fixedCharge ?? 0;
  }
  if (formula === 'LINEAR') {
    return (baseRate ?? 0) * quantity + (fixedCharge ?? 0);
  }
  if (formula === 'TIERED' && Array.isArray(tiers)) {
    let result = 0;
    let remaining = quantity;
    for (const tier of tiers) {
      const band =
        tier.upperLimit !== null
          ? Math.min(remaining, tier.upperLimit - (tier.lowerLimit ?? 0))
          : remaining;
      result += band * tier.rate;
      remaining -= band;
      if (remaining <= 0) break;
    }
    return result + (fixedCharge ?? 0);
  }
  return 0;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'regulatorische-entgeltlogik',

  settings: {
    dbPath: process.env.REG_ENTGELTLOGIK_DB_PATH || './data/regulatorische-entgeltlogik',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['ruleType'] } });
    await this.db.createIndex({ index: { fields: ['effectiveFrom'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Regulatorische Entgeltlogik DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/regulatorische-entgeltlogik/rule-sets:
     *   post:
     *     tags: [Regulatorische Entgeltlogik]
     *     summary: Register a new regulatory tariff rule set
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, ruleType, effectiveFrom, formulaDefinition]
     *             properties:
     *               gridOperatorId: { type: string }
     *               ruleType:
     *                 type: string
     *                 enum: [NETWORK_USAGE_FEE, METER_OPERATION, REACTIVE_POWER, CONCESSION_FEE,
     *                        DYNAMIC_FEE_14A, FEED_IN_MANAGEMENT, BALANCING_ENERGY, CAPACITY_CHARGE]
     *               effectiveFrom: { type: string, description: ISO date }
     *               effectiveTo: { type: string, description: ISO date or null for open-ended }
     *               label: { type: string }
     *               legalBasis: { type: string }
     *               formulaDefinition:
     *                 type: object
     *                 properties:
     *                   formula: { type: string, enum: [LINEAR, TIERED, FIXED] }
     *                   baseRate: { type: number }
     *                   fixedCharge: { type: number }
     *                   tiers: { type: array }
     *               testCases:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     description: { type: string }
     *                     input: { type: object }
     *                     expectedOutput: { type: number }
     *                     tolerance: { type: number }
     *               changeJustification: { type: string }
     *     responses:
     *       200:
     *         description: Rule set registered with test results
     */
    registerRuleSet: {
      rest: 'POST /rule-sets',
      params: {
        gridOperatorId: { type: 'string' },
        ruleType: { type: 'string', enum: Object.values(RULE_TYPE) },
        effectiveFrom: { type: 'string' },
        effectiveTo: { type: 'string', optional: true, nullable: true },
        label: { type: 'string', optional: true },
        legalBasis: { type: 'string', optional: true },
        formulaDefinition: { type: 'object' },
        testCases: { type: 'array', items: 'object', optional: true },
        changeJustification: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          gridOperatorId,
          ruleType,
          effectiveFrom,
          effectiveTo,
          label,
          legalBasis,
          formulaDefinition,
          testCases,
          changeJustification,
        } = ctx.params;
        const ruleSetId = `${RS_PREFIX}${crypto.randomUUID()}`;

        const ruleSet = {
          _id: ruleSetId,
          type: 'regulatorische-entgeltlogik',
          tenantId,
          gridOperatorId,
          ruleType,
          pipelineVersion: PIPELINE_VERSION,
          effectiveFrom,
          effectiveTo: effectiveTo ?? null,
          label: label ?? null,
          legalBasis: legalBasis ?? null,
          formulaDefinition,
          testCases: (testCases ?? []).map((tc) => ({
            ...tc,
            testCaseId: tc.testCaseId ?? crypto.randomUUID(),
          })),
          changeJustification: changeJustification ?? null,
          createdAt: nowIso(),
        };

        const testResults = runTestCases(ruleSet);
        ruleSet.testResults = testResults;

        await this.db.put(ruleSet);
        this.logger.info(
          `Rule set ${ruleSetId} (${ruleType}): tests ${testResults.passed}/${testResults.total} passed`
        );

        return {
          ruleSetId,
          ruleType,
          effectiveFrom,
          effectiveTo: ruleSet.effectiveTo,
          testResults,
          createdAt: ruleSet.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/regulatorische-entgeltlogik/active:
     *   get:
     *     tags: [Regulatorische Entgeltlogik]
     *     summary: Get active rule set for a given rule type and reference date
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: ruleType
     *         required: true
     *         schema: { type: string }
     *       - in: query
     *         name: referenceDate
     *         required: true
     *         schema: { type: string }
     *         description: ISO date (YYYY-MM-DD)
     *     responses:
     *       200:
     *         description: Active rule set
     *       404:
     *         description: No active rule set found
     */
    getActive: {
      rest: 'GET /active',
      params: {
        gridOperatorId: { type: 'string' },
        ruleType: { type: 'string' },
        referenceDate: { type: 'string' },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, ruleType, referenceDate } = ctx.params;

        const result = await this.db.find({
          selector: { tenantId, type: 'regulatorische-entgeltlogik', gridOperatorId, ruleType },
          limit: 100,
        });

        const active = result.docs.filter((r) => {
          return (
            r.effectiveFrom <= referenceDate &&
            (r.effectiveTo === null || r.effectiveTo >= referenceDate)
          );
        });

        if (active.length === 0) {
          throw new MoleculerClientError(
            `No active rule set for ${ruleType} on ${referenceDate}`,
            404,
            'RULE_SET_NOT_FOUND'
          );
        }

        // Return most recent effectiveFrom
        active.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
        return active[0];
      },
    },

    /**
     * @openapi
     * /api/regulatorische-entgeltlogik/rule-sets:
     *   get:
     *     tags: [Regulatorische Entgeltlogik]
     *     summary: List registered rule sets
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: ruleType
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of rule sets
     */
    list: {
      rest: 'GET /rule-sets',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        ruleType: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, ruleType, limit } = ctx.params;
        const selector = { tenantId, type: 'regulatorische-entgeltlogik', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (ruleType) selector.ruleType = ruleType;
        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { ruleSets: result.docs };
      },
    },

    /**
     * @openapi
     * /api/regulatorische-entgeltlogik/rule-sets/{id}:
     *   get:
     *     tags: [Regulatorische Entgeltlogik]
     *     summary: Get rule set by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Rule set document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /rule-sets/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404)
            throw new MoleculerClientError('Rule set not found', 404, 'RULE_SET_NOT_FOUND');
          throw err;
        }
      },
    },
  },
};
