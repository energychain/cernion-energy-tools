'use strict';

/**
 * VDMI Portfolio Gatekeeping Service — Portfolio Investment & Connection Governance
 *
 * Issue #120 — VDMI Portfolio-Gatekeeping
 *
 * In complex multi-stakeholder grid investment programs, individual project decisions
 * are made locally while portfolio-level conflicts, regulatory contradictions, and
 * stranded commitments remain invisible. VDMI (Verfahren zur Durchführung von
 * Maßnahmen an Infrastruktur) governance requires an explicit gate for investment
 * decisions that span multiple assets, tenants, or regulatory tracks.
 *
 * This service provides:
 *   1. Investment proposal registry with multi-asset scope declaration
 *   2. Gatekeeping rule set (portfolio-level forbidden assumptions, regulatory gates)
 *   3. Portfolio gate decision (PASS / CONDITIONAL / HOLD / REJECT)
 *   4. Cross-project conflict detection (duplicate scopes, contradicting commitments)
 *   5. C-Level summary with explicit forbidden assumption list
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const DOC_PREFIX = 'vpg:';

const GATE_DECISION = Object.freeze({
  PASS: 'PASS',
  CONDITIONAL: 'CONDITIONAL', // approved with listed conditions
  HOLD: 'HOLD', // pending missing evidence/alignment
  REJECT: 'REJECT',
});

const VIOLATION_TYPE = Object.freeze({
  FORBIDDEN_ASSUMPTION: 'FORBIDDEN_ASSUMPTION',
  REGULATORY_CONFLICT: 'REGULATORY_CONFLICT',
  PORTFOLIO_OVERLAP: 'PORTFOLIO_OVERLAP',
  MISSING_EVIDENCE_GATE: 'MISSING_EVIDENCE_GATE',
  BUDGET_CEILING_BREACH: 'BUDGET_CEILING_BREACH',
});

/**
 * Apply portfolio-level gatekeeping rules to a proposal.
 */
function applyGateRules(proposal, activeProposals) {
  const violations = [];
  const conditions = [];

  // 1. Forbidden assumptions
  (proposal.forbiddenAssumptions ?? []).forEach((a) => {
    violations.push({
      type: VIOLATION_TYPE.FORBIDDEN_ASSUMPTION,
      detail: a,
      severity: 'BLOCKING',
    });
  });

  // 2. Missing evidence gate
  if (!proposal.technicalFeasibilityConfirmed) {
    violations.push({
      type: VIOLATION_TYPE.MISSING_EVIDENCE_GATE,
      detail: 'Technische Machbarkeit nicht bestätigt',
      severity: 'BLOCKING',
    });
  }
  if (!proposal.regulatoryAlignmentConfirmed) {
    violations.push({
      type: VIOLATION_TYPE.MISSING_EVIDENCE_GATE,
      detail: 'Regulatorische Abstimmung nicht abgeschlossen',
      severity: 'MAJOR',
    });
    conditions.push('Regulatorische Freigabe bis Projektstart sicherstellen');
  }

  // 3. Portfolio overlap detection (same asset + overlapping scope)
  const overlaps = activeProposals.filter(
    (p) =>
      p._id !== proposal._id &&
      (p.assetIds ?? []).some((a) => (proposal.assetIds ?? []).includes(a))
  );
  overlaps.forEach((ov) => {
    violations.push({
      type: VIOLATION_TYPE.PORTFOLIO_OVERLAP,
      detail: `Überschneidung mit Proposal ${ov._id} an Asset(s): ${ov.assetIds.filter((a) => (proposal.assetIds ?? []).includes(a)).join(', ')}`,
      severity: 'MAJOR',
    });
    conditions.push(`Abstimmung mit Proposal ${ov._id} erforderlich`);
  });

  // 4. Budget ceiling
  if (proposal.budgetCeilingEur && proposal.estimatedCostEur > proposal.budgetCeilingEur) {
    violations.push({
      type: VIOLATION_TYPE.BUDGET_CEILING_BREACH,
      detail: `Estimated cost ${proposal.estimatedCostEur}€ exceeds ceiling ${proposal.budgetCeilingEur}€`,
      severity: 'BLOCKING',
    });
  }

  const blockingCount = violations.filter((v) => v.severity === 'BLOCKING').length;

  let decision;
  if (blockingCount > 0) {
    decision = GATE_DECISION.REJECT;
  } else if (violations.length > 0 || conditions.length > 0) {
    decision = GATE_DECISION.CONDITIONAL;
  } else {
    decision = GATE_DECISION.PASS;
  }

  return { decision, violations, conditions };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'vdmi-portfolio-gatekeeping',

  settings: {
    dbPath: process.env.VDMI_GATEKEEPING_DB_PATH || './data/vdmi-portfolio-gatekeeping',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['decision'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`VDMI Portfolio Gatekeeping DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/vdmi-portfolio-gatekeeping/gate:
     *   post:
     *     tags: [VDMI Portfolio Gatekeeping]
     *     summary: Submit an investment proposal through the portfolio gate
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, proposalTitle, assetIds]
     *             properties:
     *               gridOperatorId: { type: string }
     *               proposalTitle: { type: string }
     *               assetIds: { type: array, items: { type: string } }
     *               estimatedCostEur: { type: number }
     *               budgetCeilingEur: { type: number }
     *               technicalFeasibilityConfirmed: { type: boolean }
     *               regulatoryAlignmentConfirmed: { type: boolean }
     *               forbiddenAssumptions: { type: array, items: { type: string } }
     *               notes: { type: string }
     *     responses:
     *       200:
     *         description: Gate decision result
     */
    gate: {
      rest: 'POST /gate',
      params: {
        gridOperatorId: { type: 'string' },
        proposalTitle: { type: 'string' },
        assetIds: { type: 'array', items: 'string', min: 1 },
        estimatedCostEur: { type: 'number', optional: true },
        budgetCeilingEur: { type: 'number', optional: true },
        technicalFeasibilityConfirmed: { type: 'boolean', optional: true, default: false },
        regulatoryAlignmentConfirmed: { type: 'boolean', optional: true, default: false },
        forbiddenAssumptions: { type: 'array', items: 'string', optional: true },
        notes: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const proposalId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        // Load active proposals for overlap detection
        const existing = await this.db.find({
          selector: {
            tenantId,
            type: 'vdmi-portfolio-gatekeeping',
            decision: { $nin: [GATE_DECISION.REJECT] },
          },
          limit: 500,
        });

        const proposal = {
          _id: proposalId,
          type: 'vdmi-portfolio-gatekeeping',
          tenantId,
          pipelineVersion: PIPELINE_VERSION,
          ...ctx.params,
          createdAt: nowIso(),
        };

        const { decision, violations, conditions } = applyGateRules(proposal, existing.docs);
        proposal.decision = decision;
        proposal.violations = violations;
        proposal.conditions = conditions;

        await this.db.put(proposal);

        return {
          proposalId,
          decision,
          violations,
          conditions,
          blockingViolationCount: violations.filter((v) => v.severity === 'BLOCKING').length,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: proposal.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/vdmi-portfolio-gatekeeping/proposals:
     *   get:
     *     tags: [VDMI Portfolio Gatekeeping]
     *     summary: List proposals
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: decision
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of proposals
     */
    list: {
      rest: 'GET /proposals',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        decision: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, decision, limit } = ctx.params;
        const selector = { tenantId, type: 'vdmi-portfolio-gatekeeping' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (decision) selector.decision = decision;
        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { proposals: result.docs };
      },
    },

    /**
     * @openapi
     * /api/vdmi-portfolio-gatekeeping/proposals/{id}:
     *   get:
     *     tags: [VDMI Portfolio Gatekeeping]
     *     summary: Get proposal by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Proposal document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /proposals/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404)
            throw new MoleculerClientError('Proposal not found', 404, 'PROPOSAL_NOT_FOUND');
          throw err;
        }
      },
    },
  },
};
