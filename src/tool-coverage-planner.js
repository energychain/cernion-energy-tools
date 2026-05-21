'use strict';

/**
 * Generic Tool-Coverage Planner — Phase 3 (fallback for unregistered capabilities).
 *
 * When a route/capability is not in the Evidence Registry, this planner
 * performs a generic coverage check by analyzing:
 * 1. The plan.steps (what actions must be executed)
 * 2. The step parameters (what data is required)
 * 3. The current knownContext (what is already available)
 *
 * This planner is:
 * - Non-blocking (never throws, always returns a result)
 * - Best-effort (confidence is lower than registry-based planning)
 * - Generic (works for any capability, any action chain)
 * - Fallback-only (used only when registry has no entry)
 *
 * Key insight: Every action has a paramsTemplate. By inspecting required
 * fields in that template, we can infer what data sources are needed.
 *
 * Confidence scoring:
 * - 1.0: All action parameters are resolvable from knownContext
 * - 0.5-0.9: Some parameters resolvable, others might come from action output
 * - 0.0-0.4: Many parameters missing, execution will likely hit onboarding
 */

const GENERIC_REQUIRED_SOURCES = [
  {
    id: 'input_context',
    label: 'User Input / Known Context',
    contextKeys: ['message', 'query', 'location', 'gridOperatorId', 'bdewCode'],
    optional: false,
  },
];

/**
 * Extract required parameter keys from a plan step.
 *
 * Looks at step.paramsTemplate and identifies which keys are required
 * (non-null, not already in knownContext).
 *
 * @param {object} step  Routing plan step
 * @param {object} knownContext
 * @returns {string[]}  Array of missing param keys
 */
function extractMissingParamsFromStep(step, knownContext) {
  if (!step || !step.paramsTemplate || typeof step.paramsTemplate !== 'object') {
    return [];
  }

  const ctx = knownContext && typeof knownContext === 'object' ? knownContext : {};
  const missing = [];

  for (const [key, value] of Object.entries(step.paramsTemplate)) {
    // If template value is null/undefined, it's a required input
    if (value === null || value === undefined) {
      if (!ctx[key] && !ctx[key.replace(/([A-Z])/g, '_$1').toLowerCase()]) {
        missing.push(key);
      }
    }
  }

  return missing;
}

/**
 * Check if an action's output is likely to produce evidence for downstream steps.
 *
 * Actions like `grid-operations.marketPartners`, `grid-operations.vnbLookup`,
 * `finance-agent.analyze` etc. produce structured results that feed into later steps.
 *
 * @param {string} actionName
 * @returns {string[]}  Array of context keys this action likely produces
 */
function inferActionOutputContextKeys(actionName) {
  const actionOutputMap = {
    'grid-operations.marketPartners': ['gridOperatorId', 'bdewCode', 'vnbName', 'contact'],
    'grid-operations.vnbLookup': ['gridOperatorId', 'bdewCode', 'vnbName'],
    'finance-agent.analyze': ['assetProfile', 'riskAssessment', 'financingViability'],
    'residual-load.netResidualLoad': ['residualLoad', 'forecast'],
    'energy-market.co2Intensity': ['co2Intensity', 'timestamp'],
    'vdmi.dossier': ['governanceMatrix', 'taskId', 'evidenceGaps'],
    'vdmi.agentRole': ['actorRole', 'constraints'],
  };

  return actionOutputMap[actionName] || [];
}

/**
 * Build a generic coverage plan for any capability.
 *
 * Fallback for unregistered capabilities. Analyzes the routing plan to
 * infer what data sources are needed and what will be produced.
 *
 * @param {object} plan            Routing plan from buildExecutionPlan()
 * @param {object} knownContext    Current known context
 * @returns {{
 *   sources: object[],
 *   checkedSources: string[],
 *   gaps: object[],
 *   confidence: number,
 *   phaseNote: string,
 *   inferenceNote: string,
 * }|null}  Generic coverage plan or null if plan is too complex
 */
function planGenericToolCoverage(plan, knownContext = {}) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return null;
  }

  const ctx = knownContext && typeof knownContext === 'object' ? knownContext : {};
  const checkedSources = new Set();
  const gaps = [];

  // Collect all required parameters across all steps
  const allRequiredParams = new Set();
  for (const step of plan.steps) {
    const missing = extractMissingParamsFromStep(step, ctx);
    missing.forEach((p) => allRequiredParams.add(p));
  }

  // Check which parameters are already in context
  for (const param of allRequiredParams) {
    const camelCase = param;
    const snakeCase = param.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (ctx[camelCase] || ctx[snakeCase]) {
      checkedSources.add(camelCase);
    }
  }

  // Collect output sources from actions
  const likelyOutputSources = new Set();
  for (const step of plan.steps) {
    const outputs = inferActionOutputContextKeys(step.action || '');
    outputs.forEach((o) => likelyOutputSources.add(o));
  }

  // Identify gaps (required but not in context and not produced by earlier steps)
  const allProducedByActions = Array.from(likelyOutputSources);
  for (const param of allRequiredParams) {
    if (!checkedSources.has(param) && !allProducedByActions.includes(param)) {
      gaps.push({
        id: param,
        label: `${param} (inferred from plan)`,
        resolvedBy: ['user_input'],
      });
    }
  }

  // Compute confidence
  const totalParams = allRequiredParams.size;
  const satisfiedParams = checkedSources.size + allProducedByActions.length;
  const confidence =
    totalParams === 0 ? 1.0 : Math.min(1.0, parseFloat((satisfiedParams / totalParams).toFixed(2)));

  return {
    sources: GENERIC_REQUIRED_SOURCES.concat(
      Array.from(allRequiredParams).map((p) => ({
        id: p,
        label: `${p} (inferred from action params)`,
        optional: false,
        resolvedBy: ['user_input', 'prior_action_output'],
      }))
    ),
    checkedSources: Array.from(checkedSources),
    gaps,
    confidence,
    phaseNote: 'evidence-plan-phase3-generic-coverage',
    inferenceNote: `Generic coverage for ${plan.steps.length} step(s). Confidence is lower than registry-based planning.`,
  };
}

module.exports = {
  planGenericToolCoverage,
  extractMissingParamsFromStep,
  inferActionOutputContextKeys,
  GENERIC_REQUIRED_SOURCES,
};
