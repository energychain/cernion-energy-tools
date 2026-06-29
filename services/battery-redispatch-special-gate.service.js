'use strict';

/**
 * Battery Redispatch Special Gate Service.
 *
 * Issue: #244
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  BRS_MALO_DIRECTION_MISSING,
  BRS_METERING_CONCEPT_MISSING,
  BRS_REDISPATCH_DIRECTION_INCOMPLETE,
  BRS_CONTROLLABILITY_DIRECTION_MISSING,
  BRS_TEST_CALL_PROOF_MISSING,
  BRS_PRODUCTION_PROOF_MISSING,
  BRS_SETTLEMENT_DIRECTION_CONFLICT,
  BRS_GATE_READY,
  BRS_GATE_BLOCKED,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Battery Redispatch Special Gate';
const GATE_PREFIX = 'brs:';
const VALID_DIRECTIONS = ['injection', 'withdrawal', 'bidirectional', 'not_applicable'];
const VALID_READINESS = ['ready', 'pending', 'blocked', 'not_applicable'];
const VALID_DECISIONS = ['approved', 'pending', 'blocked', 'not_applicable'];

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeEnum(value, allowed, fallback = null) {
  const normalized = normalizeString(value);
  return normalized && allowed.includes(normalized) ? normalized : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildPositiveFollowUps(missingDataPoints) {
  const mapping = {
    maloDecision: 'adds MaLo/MeLo role separation and billing-path evidence',
    meteringConceptId: 'adds metering-concept evidence for storage injection and withdrawal roles',
    injectionDirection: 'adds positive Redispatch eligibility reasoning',
    withdrawalDirection: 'adds negative Redispatch eligibility reasoning',
    controllabilityDirection: 'adds Steuerbarkeitsrichtung and operating-risk assessment',
    testCallProofRef: 'adds productive test-call evidence and proof chain',
    productionProofConfirmed: 'adds production-readiness statement',
    settlementReadiness: 'adds settlement and clearing consequence explanation',
    clearingDecision: 'adds clearing follow-up and exception-routing summary',
    billingDecision: 'adds commercial billing consequence summary',
  };
  return missingDataPoints.map((missingDataPoint) => ({
    missingDataPoint,
    enablesDossierAddition: mapping[missingDataPoint],
  }));
}

function buildAnswerFacts(gate) {
  return {
    assetId: gate.assetId,
    maloDecision: gate.maloDecision,
    meloRefs: gate.meloRefs,
    meteringConceptId: gate.meteringConceptId,
    injectionDirection: gate.injectionDirection,
    withdrawalDirection: gate.withdrawalDirection,
    positiveRedispatchEligible: gate.positiveRedispatchEligible,
    negativeRedispatchEligible: gate.negativeRedispatchEligible,
    controllabilityDirection: gate.controllabilityDirection,
    testCallLimitKw: gate.testCallLimitKw,
    testCallProofPresent: Boolean(gate.testCallProofRef),
    productionProofConfirmed: gate.productionProofConfirmed,
    settlementReadiness: gate.settlementReadiness,
    clearingDecision: gate.clearingDecision,
    billingDecision: gate.billingDecision,
    evidenceStatus: gate.evidenceStatus,
    recommendedNextDecision: gate.recommendedNextDecision,
    evaluatedAt: gate.createdAt,
  };
}

function buildStatusFromGate(gate) {
  const missingDataPoints = gate.missingDataPoints || [];
  return {
    found: true,
    gateId: gate._id,
    assetId: gate.assetId,
    evidenceStatus: gate.evidenceStatus,
    answerFacts: buildAnswerFacts(gate),
    blockingFindings: gate.blockingFindings,
    missingDataPoints,
    positiveFollowUps: buildPositiveFollowUps(missingDataPoints),
    sourceActions: gate.sourceActions,
    recommendedNextDecision: gate.recommendedNextDecision,
    evaluatedAt: gate.createdAt,
  };
}

module.exports = {
  name: 'battery-redispatch-special-gate',

  settings: {
    dbPath:
      process.env.BATTERY_REDISPATCH_SPECIAL_GATE_DB_PATH ||
      './data/battery-redispatch-special-gate',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['assetId'] } });
    await this.db.createIndex({ index: { fields: ['evidenceStatus'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Battery Redispatch Special Gate DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/battery-redispatch-special-gate/evaluate:
     *   post:
     *     tags: [Battery Redispatch Special Gate]
     *     summary: Evaluate a battery storage Redispatch special gate
     *     security:
     *       - bearerAuth: []
     */
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        assetId: { type: 'string' },
        bessScreeningId: { type: 'string', optional: true },
        maloDecision: { type: 'string', optional: true },
        meloRefs: { type: 'array', optional: true, default: [] },
        meteringConceptId: { type: 'string', optional: true },
        injectionDirection: { type: 'string', optional: true },
        withdrawalDirection: { type: 'string', optional: true },
        positiveRedispatchEligible: { type: 'boolean', optional: true, convert: true },
        negativeRedispatchEligible: { type: 'boolean', optional: true, convert: true },
        controllabilityDirection: { type: 'string', optional: true },
        testCallLimitKw: { type: 'number', optional: true, convert: true },
        testCallProofRef: { type: 'string', optional: true },
        productionProofConfirmed: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
        settlementReadiness: { type: 'string', optional: true },
        clearingDecision: { type: 'string', optional: true },
        billingDecision: { type: 'string', optional: true },
        sourceActions: { type: 'array', optional: true, default: [] },
      },
      openapi: {
        summary: 'Evaluate a battery storage Redispatch special gate',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const p = ctx.params;
        const findings = [];
        const missingDataPoints = [];

        const maloDecision = normalizeString(p.maloDecision);
        if (!maloDecision) missingDataPoints.push('maloDecision');

        const meteringConceptId = normalizeString(p.meteringConceptId);
        const meloRefs = asArray(p.meloRefs);
        if (!meteringConceptId || meloRefs.length === 0) {
          missingDataPoints.push('meteringConceptId');
        }

        const injectionDirection = normalizeEnum(p.injectionDirection, VALID_DIRECTIONS);
        const withdrawalDirection = normalizeEnum(p.withdrawalDirection, VALID_DIRECTIONS);
        if (!injectionDirection) missingDataPoints.push('injectionDirection');
        if (!withdrawalDirection) missingDataPoints.push('withdrawalDirection');

        const controllabilityDirection = normalizeEnum(
          p.controllabilityDirection,
          VALID_DIRECTIONS
        );
        if (!controllabilityDirection) missingDataPoints.push('controllabilityDirection');

        const testCallProofRef = normalizeString(p.testCallProofRef);
        if (!testCallProofRef) missingDataPoints.push('testCallProofRef');
        if (!p.productionProofConfirmed) missingDataPoints.push('productionProofConfirmed');

        const settlementReadiness = normalizeEnum(
          p.settlementReadiness,
          VALID_READINESS,
          'pending'
        );
        const clearingDecision = normalizeEnum(p.clearingDecision, VALID_DECISIONS, 'pending');
        const billingDecision = normalizeEnum(p.billingDecision, VALID_DECISIONS, 'pending');
        if (settlementReadiness !== 'ready') missingDataPoints.push('settlementReadiness');
        if (clearingDecision !== 'approved') missingDataPoints.push('clearingDecision');
        if (billingDecision !== 'approved') missingDataPoints.push('billingDecision');

        if (!maloDecision || !injectionDirection || !withdrawalDirection) {
          findings.push({
            finding: BRS_MALO_DIRECTION_MISSING,
            severity: 'error',
            message:
              'Battery storage MaLo/MeLo role or injection/withdrawal direction is incomplete',
          });
        }
        if (!meteringConceptId || meloRefs.length === 0) {
          findings.push({
            finding: BRS_METERING_CONCEPT_MISSING,
            severity: 'error',
            message: 'Battery storage metering concept or MeLo references are missing',
          });
        }
        if (p.positiveRedispatchEligible == null || p.negativeRedispatchEligible == null) {
          findings.push({
            finding: BRS_REDISPATCH_DIRECTION_INCOMPLETE,
            severity: 'error',
            message: 'Positive and negative Redispatch eligibility must both be explicit',
          });
        }
        if (!controllabilityDirection) {
          findings.push({
            finding: BRS_CONTROLLABILITY_DIRECTION_MISSING,
            severity: 'error',
            message: 'Battery storage controllability direction is missing',
          });
        }
        if (!testCallProofRef) {
          findings.push({
            finding: BRS_TEST_CALL_PROOF_MISSING,
            severity: 'warning',
            message: 'Battery Redispatch test-call proof is missing',
          });
        }
        if (!p.productionProofConfirmed) {
          findings.push({
            finding: BRS_PRODUCTION_PROOF_MISSING,
            severity: 'error',
            message: 'Battery Redispatch production proof is missing',
          });
        }
        if (
          settlementReadiness === 'blocked' ||
          clearingDecision === 'blocked' ||
          billingDecision === 'blocked'
        ) {
          findings.push({
            finding: BRS_SETTLEMENT_DIRECTION_CONFLICT,
            severity: 'error',
            message: 'Settlement, clearing or billing decision blocks the battery Redispatch gate',
          });
        }

        const hasError = findings.some((finding) => finding.severity === 'error');
        const hasWarning = findings.some((finding) => finding.severity === 'warning');
        const evidenceStatus = hasError ? 'blocked' : hasWarning ? 'ready_with_warnings' : 'ready';
        findings.push({
          finding: hasError ? BRS_GATE_BLOCKED : BRS_GATE_READY,
          severity: hasError ? 'error' : 'info',
          message: hasError
            ? 'Battery Redispatch special gate is blocked'
            : 'Battery Redispatch special gate is ready',
        });

        const gateId = `${GATE_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: gateId,
          docType: 'battery-redispatch-special-gate',
          tenantId,
          assetId: p.assetId,
          bessScreeningId: normalizeString(p.bessScreeningId),
          maloDecision,
          meloRefs,
          meteringConceptId,
          injectionDirection,
          withdrawalDirection,
          positiveRedispatchEligible: Boolean(p.positiveRedispatchEligible),
          negativeRedispatchEligible: Boolean(p.negativeRedispatchEligible),
          controllabilityDirection,
          testCallLimitKw: p.testCallLimitKw ?? null,
          testCallProofRef,
          productionProofConfirmed: Boolean(p.productionProofConfirmed),
          settlementReadiness,
          clearingDecision,
          billingDecision,
          evidenceStatus,
          blockingFindings: findings.filter((finding) => finding.severity === 'error'),
          validationFindings: findings,
          missingDataPoints: [...new Set(missingDataPoints)],
          positiveFollowUps: buildPositiveFollowUps([...new Set(missingDataPoints)]),
          sourceActions: asArray(p.sourceActions),
          recommendedNextDecision: hasError
            ? 'Resolve blocking MaLo/MeLo, direction, proof or settlement findings before clearing'
            : 'Proceed to Redispatch storage clearing review with documented evidence chain',
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        return { ...doc, gateId };
      },
    },

    listGates: {
      rest: 'GET /gates',
      params: {
        assetId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List battery Redispatch special gates',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'query', name: 'assetId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'battery-redispatch-special-gate' };
        if (ctx.params.assetId) selector.assetId = ctx.params.assetId;
        const result = await this.db.find({ selector, limit: ctx.params.limit });
        return {
          gates: result.docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
        };
      },
    },

    getGate: {
      rest: 'GET /gates/:gateId',
      params: { gateId: { type: 'string' } },
      openapi: {
        summary: 'Get a battery Redispatch special gate',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'path', name: 'gateId', required: true, schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const gate = await this.db.get(ctx.params.gateId);
          if (gate.tenantId !== tenantId) {
            throw new MoleculerClientError('Gate not found', 404, 'GATE_NOT_FOUND');
          }
          return gate;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Gate not found', 404, 'GATE_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    getStatus: {
      rest: 'GET /:gateId/status',
      params: { gateId: { type: 'string' } },
      openapi: {
        summary: 'Get dossier-safe battery Redispatch special gate status',
        tags: [OPENAPI_TAG],
      
        parameters: [
          { in: 'path', name: 'gateId', required: true, schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const gate = await this.db.get(ctx.params.gateId);
          if (gate.tenantId !== tenantId) {
            throw new MoleculerClientError('Gate status not found', 404, 'GATE_STATUS_NOT_FOUND');
          }
          return buildStatusFromGate(gate);
        } catch (err) {
          if (err.status === 404) {
            return {
              found: false,
              message:
                'No battery Redispatch special gate evidence is available for this tenant yet',
            };
          }
          throw err;
        }
      },
    },
  },
};
