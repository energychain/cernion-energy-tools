'use strict';

const DEFAULT_MAKO_RUN_CARD_ID = 'RC002_mako_clarification_to_m2c_revenue_risk';

const ALLOWED_DIMENSIONS = Object.freeze([
  'billing_enablement',
  'cashflow_acceleration',
  'revenue_leakage_prevention',
  'data_quality_improvement',
  'compliance_audit_improvement',
  'process_learning',
  'customer_market_partner_deescalation',
  'forecast_budget_confidence',
]);

const FORBIDDEN_MAKO_ACTIONS = Object.freeze([
  'send_market_partner_reply',
  'change_master_data',
  'approve_invoice',
  'state_final_cashflow_amount',
]);

const FORBIDDEN_ASSET_TO_DECISION_ACTIONS = Object.freeze([
  'recommend_final_investment_decision',
  'state_budget_commitment',
  'mark_committee_ready',
]);

function uniqueStrings(values = []) {
  return Array.from(
    new Set(values.filter((value) => typeof value === 'string' && value.length > 0))
  );
}

function buildMakoResolutionValueProjection(input = {}) {
  const requiredEvidence = uniqueStrings([
    'confirmed_invoice_amount',
    'market_partner_confirmation',
    'owner_approval',
  ]);
  const suppliedEvidence = uniqueStrings(input.providedEvidence || input.validatedEvidence || []);
  const missingEvidence = uniqueStrings(
    Array.isArray(input.missingEvidence)
      ? input.missingEvidence
      : requiredEvidence.filter((evidence) => !suppliedEvidence.includes(evidence))
  );
  const evidenceComplete = requiredEvidence.every((evidence) =>
    suppliedEvidence.includes(evidence)
  );
  const forbiddenActions = uniqueStrings([
    ...FORBIDDEN_MAKO_ACTIONS,
    ...(input.forbiddenActions || []),
  ]);

  const pendingConfirmationActions = uniqueStrings([
    ...missingEvidence,
    'external_market_partner_reply',
    'billing_or_cashflow_finalization',
  ]);

  return {
    candidateId: 'CRC001',
    runCardId: input.runCardId || DEFAULT_MAKO_RUN_CARD_ID,
    workedExample: 'mako_m2c_resolution_value',
    roleProjection: {
      accountableRole: 'human_resolver',
      advisoryRole: 'mako_clarification_agent',
    },
    evidenceState: {
      missingEvidence,
    },
    readiness: {
      drl: 1,
      rcr: 1,
      committeeReady: false,
    },
    resolutionValue: [
      {
        dimension: 'cashflow_acceleration',
        evidenceStatus: evidenceComplete ? 'validated' : 'partial',
        qualitativeImpact:
          'Cashflow acceleration is qualitative only until invoice amount, market partner confirmation, and owner approval evidence are complete.',
        confidence: missingEvidence.length > 0 ? 'low' : 'medium',
        requiredEvidence,
        forbiddenClaims: ['final_cashflow_amount', 'approved_invoice_state'],
      },
    ],
    safetyBoundary: {
      noExternalSend: true,
      noBillingApproval: true,
      noBudgetCommitment: true,
      requiresHitlForConsequentialAction: true,
    },
    hitlBoundary: {
      requiresHitl: true,
      requiredResolverRoles: ['mako_owner', 'billing_owner'],
      pendingConfirmationActions,
    },
    allowedActions: [
      'prepare_clarification_summary',
      'request_missing_evidence',
      'draft_internal_handover',
    ],
    forbiddenActions,
    handoverSources: input.handoverSources || {},
  };
}

function buildAssetToDecisionProjection(input = {}) {
  const missingEvidence = uniqueStrings(input.missingEvidence || []);
  const forbiddenActions = uniqueStrings([
    ...FORBIDDEN_ASSET_TO_DECISION_ACTIONS,
    ...(input.forbiddenActions || []),
  ]);

  return {
    candidateId: input.candidateId || 'CRC004',
    runCardId: input.runCardId || 'RC003_asset_state_to_budget_committee',
    workedExample: 'asset_to_decision',
    roleProjection: {
      accountableRole: 'asset_owner',
      advisoryRole: 'controlling_finance_budget_review',
      decisionForum: 'budget_committee',
    },
    evidenceState: {
      missingEvidence,
    },
    readiness: {
      drl: 1,
      rcr: 1,
      committeeReady: false,
    },
    resolutionValue: [
      {
        dimension: 'forecast_budget_confidence',
        evidenceStatus: missingEvidence.length > 0 ? 'partial' : 'missing',
        qualitativeImpact:
          'Budget and committee confidence stays low until asset state, risk, budget assumptions, alternatives, and decision ownership evidence are complete.',
        confidence: 'low',
        requiredEvidence: uniqueStrings([
          'asset_condition_source',
          'risk_quantification',
          'budget_assumption',
          'alternative_options',
          'decision_owner',
          ...missingEvidence,
        ]),
        forbiddenClaims: [
          'final_investment_decision_recommendation',
          'budget_commitment_state',
          'committee_ready_state',
        ],
      },
    ],
    safetyBoundary: {
      noExternalSend: true,
      noBillingApproval: true,
      noBudgetCommitment: true,
      requiresHitlForConsequentialAction: true,
    },
    hitlBoundary: {
      requiresHitl: true,
      requiredResolverRoles: ['asset_owner', 'controlling_finance_owner', 'budget_committee_owner'],
      pendingConfirmationActions: uniqueStrings([...missingEvidence, 'budget_committee_decision']),
    },
    allowedActions: [
      'prepare_asset_state_summary',
      'request_missing_evidence',
      'draft_budget_committee_handover',
    ],
    forbiddenActions,
    handoverSources: input.handoverSources || {},
  };
}

module.exports = {
  ALLOWED_DIMENSIONS,
  buildAssetToDecisionProjection,
  buildMakoResolutionValueProjection,
};
