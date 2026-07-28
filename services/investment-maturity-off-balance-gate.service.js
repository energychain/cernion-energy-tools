'use strict';

/**
 * Investment Maturity Off-Balance Gate Service.
 *
 * Issue: #246
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  IMOB_MATURITY_MODEL_MISSING,
  IMOB_PROCESS_QUALITY_LOW,
  IMOB_FINANCING_COST_MISSING,
  IMOB_REGULATORY_RETURN_HYPOTHESIS_MISSING,
  IMOB_ASSET_RISK_REFERENCE_MISSING,
  IMOB_ISO_RISK_REFERENCE_MISSING,
  IMOB_DECISION_FORUM_MISSING,
  IMOB_SOURCE_ACTIONS_MISSING,
  IMOB_GATE_READY,
  IMOB_GATE_BLOCKED,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Investment Maturity Off-Balance Gate';
const GATE_PREFIX = 'imob:';

const DEFAULT_SOURCE_ACTIONS = [
  'investment-planning.createPlan',
  'investment-planning.evaluate',
  'finance-agent.analyze',
  'decision-frame.create',
  'decision-frame.evaluate',
  'vdmi-evidence.inject',
  'vdmi-findings.list',
  'hitl.create',
  'presentation.generate',
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeScore(value) {
  const n = normalizeNumber(value);
  if (n == null) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function buildPositiveFollowUps(missingDataPoints) {
  const mapping = {
    maturity_model: 'adds investment maturity model and stage-specific decision criteria',
    process_quality: 'adds measurable process-quality basis for gate readiness',
    financing_cost: 'adds additional financing-cost transparency for external funding',
    regulatory_return_hypothesis: 'adds return-assumption basis and uncertainty for the dossier',
    asset_risk_reference: 'adds asset-risk linkage to the investment decision',
    iso_risk_reference: 'adds ISO/risk-control traceability',
    decision_forum: 'adds responsible governance and approval context',
    source_action_references:
      'adds traceability to reused finance, investment, VDMI and presentation actions',
  };
  return missingDataPoints.map((missingDataPoint) => ({
    missingDataPoint,
    enablesDossierAddition: mapping[missingDataPoint],
  }));
}

function buildAnswerFacts(gate) {
  return {
    investmentCaseId: gate.investmentCaseId,
    gateId: gate._id,
    assetScope: gate.assetScope,
    maturityLevel: gate.maturityLevel,
    processQualityScore: gate.processQualityScore,
    offBalanceStructure: gate.offBalanceStructure,
    additionalFinancingCostEur: gate.additionalFinancingCostEur,
    regulatoryReturnHypothesis: gate.regulatoryReturnHypothesis,
    observedEvidence: gate.observedEvidence,
    hypothesisEvidence: gate.hypothesisEvidence,
    assetRiskReference: gate.assetRiskReference,
    isoRiskReference: gate.isoRiskReference,
    decisionForum: gate.decisionForum,
    evidenceStatus: gate.evidenceStatus,
    evaluatedAt: gate.createdAt,
  };
}

function buildStatusFromGate(gate) {
  const missingDataPoints = gate.missingDataPoints || [];
  return {
    found: true,
    investmentCaseId: gate.investmentCaseId,
    gateId: gate._id,
    assetScope: gate.assetScope,
    maturityLevel: gate.maturityLevel,
    processQualityScore: gate.processQualityScore,
    offBalanceStructure: gate.offBalanceStructure,
    additionalFinancingCostEur: gate.additionalFinancingCostEur,
    regulatoryReturnHypothesis: gate.regulatoryReturnHypothesis,
    assetRiskReference: gate.assetRiskReference,
    isoRiskReference: gate.isoRiskReference,
    decisionForum: gate.decisionForum,
    decisionFrameId: gate.decisionFrameId,
    financeAnalysisId: gate.financeAnalysisId,
    investmentPlanId: gate.investmentPlanId,
    evidenceStatus: gate.evidenceStatus,
    observedEvidence: gate.observedEvidence,
    hypothesisEvidence: gate.hypothesisEvidence,
    missingDataPoints,
    validationFindings: gate.validationFindings,
    positiveFollowUps: buildPositiveFollowUps(missingDataPoints),
    sourceActions: gate.sourceActions,
    forbiddenAutomaticActions: gate.forbiddenAutomaticActions,
    answerFacts: buildAnswerFacts(gate),
    evaluatedAt: gate.createdAt,
  };
}

module.exports = {
  name: 'investment-maturity-off-balance-gate',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'INVESTMENT_MATURITY_OFF_BALANCE_GATE_DB_PATH',
      defaultDbPath: './data/investment-maturity-off-balance-gate',
      indexes: [['tenantId', 'docType'], ['investmentCaseId'], ['evidenceStatus'], ['createdAt']],
    }),
  ],

  settings: {
    dbPath:
      process.env.INVESTMENT_MATURITY_OFF_BALANCE_GATE_DB_PATH ||
      './data/investment-maturity-off-balance-gate',
  },

  actions: {
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        investmentCaseId: { type: 'string' },
        assetScope: { type: 'object', optional: true, default: {} },
        maturityLevel: { type: 'string', optional: true },
        processQualityScore: { type: 'number', optional: true, convert: true },
        offBalanceStructure: { type: 'object', optional: true, default: {} },
        additionalFinancingCostEur: { type: 'number', optional: true, convert: true },
        regulatoryReturnHypothesis: { type: 'object', optional: true, default: {} },
        assetRiskReference: { type: 'object', optional: true, default: {} },
        isoRiskReference: { type: 'object', optional: true, default: {} },
        decisionForum: { type: 'object', optional: true, default: {} },
        decisionFrameId: { type: 'string', optional: true },
        financeAnalysisId: { type: 'string', optional: true },
        investmentPlanId: { type: 'string', optional: true },
        sourceActions: { type: 'array', optional: true, default: [] },
        evidence: { type: 'array', optional: true, default: [] },
      },
      openapi: {
        summary: 'Evaluate investment maturity off-balance evidence',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const p = ctx.params;
        const findings = [];
        const missingDataPoints = [];
        const maturityLevel = normalizeString(p.maturityLevel);
        const processQualityScore = normalizeScore(p.processQualityScore);
        const sourceActions = asArray(p.sourceActions);
        const observedEvidence = asArray(p.evidence).filter(
          (entry) => entry?.kind !== 'hypothesis'
        );
        const hypothesisEvidence = asArray(p.evidence).filter(
          (entry) => entry?.kind === 'hypothesis'
        );
        const additionalFinancingCostEur = normalizeNumber(p.additionalFinancingCostEur);
        const regulatoryReturnHypothesis = normalizeObject(p.regulatoryReturnHypothesis);
        const assetRiskReference = normalizeObject(p.assetRiskReference);
        const isoRiskReference = normalizeObject(p.isoRiskReference);
        const decisionForum = normalizeObject(p.decisionForum);

        if (!maturityLevel) missingDataPoints.push('maturity_model');
        if (processQualityScore == null) missingDataPoints.push('process_quality');
        if (additionalFinancingCostEur == null) missingDataPoints.push('financing_cost');
        if (Object.keys(regulatoryReturnHypothesis).length === 0) {
          missingDataPoints.push('regulatory_return_hypothesis');
        }
        if (Object.keys(assetRiskReference).length === 0)
          missingDataPoints.push('asset_risk_reference');
        if (Object.keys(isoRiskReference).length === 0)
          missingDataPoints.push('iso_risk_reference');
        if (Object.keys(decisionForum).length === 0) missingDataPoints.push('decision_forum');
        if (sourceActions.length === 0) missingDataPoints.push('source_action_references');

        if (!maturityLevel) {
          findings.push({
            finding: IMOB_MATURITY_MODEL_MISSING,
            severity: 'error',
            message: 'Investment maturity level or model reference is missing',
          });
        }
        if (processQualityScore == null || processQualityScore < 0.6) {
          findings.push({
            finding: IMOB_PROCESS_QUALITY_LOW,
            severity: processQualityScore == null ? 'error' : 'warning',
            message: 'Investment process-quality score is missing or below readiness threshold',
            processQualityScore,
          });
        }
        if (additionalFinancingCostEur == null) {
          findings.push({
            finding: IMOB_FINANCING_COST_MISSING,
            severity: 'error',
            message: 'Additional financing cost for the off-balance structure is missing',
          });
        }
        if (Object.keys(regulatoryReturnHypothesis).length === 0) {
          findings.push({
            finding: IMOB_REGULATORY_RETURN_HYPOTHESIS_MISSING,
            severity: 'warning',
            message: 'Regulatory return hypothesis is missing',
          });
        }
        if (Object.keys(assetRiskReference).length === 0) {
          findings.push({
            finding: IMOB_ASSET_RISK_REFERENCE_MISSING,
            severity: 'error',
            message: 'Asset-risk reference is missing',
          });
        }
        if (Object.keys(isoRiskReference).length === 0) {
          findings.push({
            finding: IMOB_ISO_RISK_REFERENCE_MISSING,
            severity: 'warning',
            message: 'ISO/risk-control reference is missing',
          });
        }
        if (Object.keys(decisionForum).length === 0) {
          findings.push({
            finding: IMOB_DECISION_FORUM_MISSING,
            severity: 'error',
            message: 'Responsible investment decision forum is missing',
          });
        }
        if (sourceActions.length === 0) {
          findings.push({
            finding: IMOB_SOURCE_ACTIONS_MISSING,
            severity: 'warning',
            message: 'Source action references are missing',
          });
        }

        const hasError = findings.some((finding) => finding.severity === 'error');
        const hasWarning = findings.some((finding) => finding.severity === 'warning');
        const evidenceStatus = hasError ? 'blocked' : hasWarning ? 'ready_with_warnings' : 'ready';
        findings.push({
          finding: hasError ? IMOB_GATE_BLOCKED : IMOB_GATE_READY,
          severity: hasError ? 'error' : 'info',
          message: hasError
            ? 'Investment maturity off-balance gate is blocked'
            : 'Investment maturity off-balance gate is ready',
        });

        const gateId = `${GATE_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: gateId,
          docType: 'investment-maturity-off-balance-gate',
          tenantId,
          investmentCaseId: p.investmentCaseId,
          assetScope: normalizeObject(p.assetScope),
          maturityLevel,
          processQualityScore,
          offBalanceStructure: normalizeObject(p.offBalanceStructure),
          additionalFinancingCostEur,
          regulatoryReturnHypothesis,
          assetRiskReference,
          isoRiskReference,
          decisionForum,
          decisionFrameId: normalizeString(p.decisionFrameId),
          financeAnalysisId: normalizeString(p.financeAnalysisId),
          investmentPlanId: normalizeString(p.investmentPlanId),
          evidenceStatus,
          observedEvidence,
          hypothesisEvidence,
          validationFindings: findings,
          blockingFindings: findings.filter((finding) => finding.severity === 'error'),
          missingDataPoints: [...new Set(missingDataPoints)],
          positiveFollowUps: buildPositiveFollowUps([...new Set(missingDataPoints)]),
          sourceActions: sourceActions.length > 0 ? sourceActions : DEFAULT_SOURCE_ACTIONS,
          forbiddenAutomaticActions: [
            'financing-approval',
            'off-balance-legal-determination',
            'accounting-write',
            'investment-plan-mutation',
            'hitl-approval',
            'settlement-write',
            'billing-write',
            'mako-write',
            'control-command-delivery',
          ],
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        return { ...doc, gateId };
      },
    },

    listGates: {
      rest: 'GET /gates',
      params: {
        investmentCaseId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List investment maturity off-balance gates',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'investmentCaseId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const selector = { tenantId, docType: 'investment-maturity-off-balance-gate' };
        if (ctx.params.investmentCaseId) selector.investmentCaseId = ctx.params.investmentCaseId;
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
        summary: 'Get an investment maturity off-balance gate',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'gateId', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const gate = await this.db.get(ctx.params.gateId);
          if (gate.tenantId !== tenantId) {
            throw new MoleculerClientError('Gate not found', 404, 'IMOB_GATE_NOT_FOUND');
          }
          return gate;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Gate not found', 404, 'IMOB_GATE_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    getStatus: {
      rest: 'GET /status',
      params: {
        gateId: { type: 'string', optional: true },
        investmentCaseId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get dossier-safe investment maturity off-balance status',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'gateId', schema: { type: 'string' } },
          { in: 'query', name: 'investmentCaseId', schema: { type: 'string' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gateId, investmentCaseId } = ctx.params;
        try {
          let gate;
          if (gateId) {
            gate = await this.db.get(gateId);
            if (gate.tenantId !== tenantId) {
              throw new MoleculerClientError(
                'Gate status not found',
                404,
                'IMOB_GATE_STATUS_NOT_FOUND'
              );
            }
          } else {
            const result = await this.db.find({
              selector: {
                tenantId,
                docType: 'investment-maturity-off-balance-gate',
                investmentCaseId: investmentCaseId || '__missing__',
              },
              limit: 50,
            });
            gate = result.docs.sort((a, b) =>
              String(b.createdAt).localeCompare(String(a.createdAt))
            )[0];
            if (!gate)
              throw new MoleculerClientError(
                'Gate status not found',
                404,
                'IMOB_GATE_STATUS_NOT_FOUND'
              );
          }
          return buildStatusFromGate(gate);
        } catch (err) {
          if (err.status === 404 || err.type === 'IMOB_GATE_STATUS_NOT_FOUND') {
            return {
              found: false,
              investmentCaseId: investmentCaseId || null,
              gateId: gateId || null,
              message:
                'No investment maturity off-balance gate evidence is available for this tenant yet',
            };
          }
          throw err;
        }
      },
    },
  },
};
