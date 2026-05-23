'use strict';

/**
 * Consultation Routing Guardrails
 *
 * Validates routing intent against workflow type to prevent false positives:
 * - Governance/advisory-only workflows should NOT route to operational intents (e.g., forecast)
 * - BESS workflows should NOT route to asset-validation unless explicitly validating asset context
 * - Process/gremium questions should NOT route to asset-validation
 * - EDM/market-communication should NOT route to asset-validation
 *
 * Uses negative-control logic: block obvious mismatches before allowing routing.
 */

const OPERATIONAL_INTENTS = new Set([
  'residual_load_forecast',
  'redispatch_2_0_potential',
  'grid_congestion_analysis',
  'voltage_stability_check',
  'frequency_response_capability',
  'market_price_analysis',
  'production_forecast',
]);

const GOVERNANCE_WORKFLOWS = new Set([
  'advisory_only',
  'ai_transparency_blackbox',
  'ai_governance_framework',
]);

const BESS_WORKFLOWS = new Set(['bess_screening', 'bess_development', 'bess_feasibility_study']);

const PROCESS_WORKFLOWS = new Set([
  'process_governance_decision_matrix',
  'gremium_decision_support',
  'organizational_workflow',
]);

const MARKET_COMMUNICATION_WORKFLOWS = new Set([
  'edm_market_communication_diagnostics',
  'market_messaging_strategy',
]);

/**
 * Validate routing intent against workflow type.
 *
 * @param {object} params - {workflowType, brokerRecommendation, message}
 * @returns {object} {valid, reason, correctedWorkflow, correctedIntent}
 *
 * Reason codes:
 * - 'governance_advisory_cannot_route_to_operational'
 * - 'bess_workflow_misrouted_to_asset_validation'
 * - 'process_governance_misrouted_to_asset_validation'
 * - 'edm_market_misrouted_to_asset_validation'
 * - 'allowed_routing'
 */
function validateRoutingIntent({
  workflowType = '',
  brokerRecommendation = {},
  message = '',
} = {}) {
  const intent = brokerRecommendation.intent || '';
  const operativeIntent = OPERATIONAL_INTENTS.has(intent);

  // Rule 1: Governance/advisory workflows should not route to operational intents
  if (GOVERNANCE_WORKFLOWS.has(workflowType) && operativeIntent) {
    return {
      valid: false,
      reason: 'governance_advisory_cannot_route_to_operational',
      correctedWorkflow: workflowType,
      correctedIntent: 'governance_context_analysis',
      explanation:
        'Governance/advisory questions must remain advisory; blocked operational routing',
    };
  }

  // Rule 2: BESS workflows routing to asset-validation without asset-context
  if (BESS_WORKFLOWS.has(workflowType) && intent === 'vdmi_asset_validation_governance') {
    const hasAssetContext = /(?:anlage|installation|asset|equipment|prüf|validier|audit)\s/i.test(
      message
    );
    if (!hasAssetContext) {
      return {
        valid: false,
        reason: 'bess_workflow_misrouted_to_asset_validation',
        correctedWorkflow: workflowType,
        correctedIntent: 'bess_viability_assessment',
        explanation:
          'BESS workflow does not require asset validation; redirecting to domain-specific intent',
      };
    }
  }

  // Rule 3: Process/gremium workflows should not route to asset-validation
  if (PROCESS_WORKFLOWS.has(workflowType) && intent === 'vdmi_asset_validation_governance') {
    return {
      valid: false,
      reason: 'process_governance_misrouted_to_asset_validation',
      correctedWorkflow: workflowType,
      correctedIntent: 'process_governance_decision_analysis',
      explanation: 'Process governance is organizational, not asset-validation',
    };
  }

  // Rule 4: EDM/market-communication should not route to asset-validation
  if (
    MARKET_COMMUNICATION_WORKFLOWS.has(workflowType) &&
    intent === 'vdmi_asset_validation_governance'
  ) {
    return {
      valid: false,
      reason: 'edm_market_misrouted_to_asset_validation',
      correctedWorkflow: workflowType,
      correctedIntent: 'market_communication_strategy',
      explanation: 'Market communication is strategic messaging, not asset validation',
    };
  }

  // Default: allowed routing
  return {
    valid: true,
    reason: 'allowed_routing',
    correctedWorkflow: workflowType,
    correctedIntent: intent,
  };
}

module.exports = {
  validateRoutingIntent,
  OPERATIONAL_INTENTS,
  GOVERNANCE_WORKFLOWS,
  BESS_WORKFLOWS,
  PROCESS_WORKFLOWS,
  MARKET_COMMUNICATION_WORKFLOWS,
};
