'use strict';

/**
 * Role Workbench Projector — Issue #301.
 *
 * Pure function module: given a role name and a list of VDMI matrices (already
 * fetched from vdmi.service.js), produces a read-only workbench projection.
 *
 * No IO, no broker calls, no side effects. The service action in
 * governance.service.js wraps this function with the VDMI fetch.
 *
 * Design decisions:
 *  - "Role match" means the role appears as an actorId in ANY of the four RACI
 *    fields (verantwortlich, durchfuehrend, mitwirkend, information). String
 *    actorIds and {actorType, actorId} objects are both accepted.
 *  - Policy evaluation and HITL role derivation are injected as function params
 *    so the projector stays free of any imports from governance-policy-evaluator
 *    (avoids circular dependency when governance.service.js calls this module).
 *  - allowedCommands are derived from a curated static map (not runtime
 *    discovery); they are hints only — no execution.
 */

const RACI_FIELDS = Object.freeze(['verantwortlich', 'durchfuehrend', 'mitwirkend', 'information']);

const RACI_RELATION_LABELS = Object.freeze({
  verantwortlich: 'accountable',
  durchfuehrend: 'responsible',
  mitwirkend: 'consulted',
  information: 'informed',
});

// Static map: controlCase → curated runbook hints for next-action guidance.
// Read-only hints; never execution. Extend as new runbooks are registered.
const CONTROL_CASE_COMMAND_HINTS = Object.freeze({
  redispatch: [
    {
      kind: 'runbook_hint',
      id: 'smm-rundeck:stadtwerk-mauer-e2e-smoke',
      label: 'Run controlled E2E smoke (Steuerbarkeit)',
    },
  ],
  steuerbarkeitscheck: [
    {
      kind: 'runbook_hint',
      id: 'smm-rundeck:stadtwerk-mauer-e2e-smoke',
      label: 'Run controlled E2E smoke (Steuerbarkeit)',
    },
  ],
  asset_transformation: [
    {
      kind: 'governance_hint',
      id: 'governance:evaluate-asset-transformation-policy',
      label: 'Re-evaluate asset transformation governance policy',
    },
  ],
});

function normalizeRoleId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object' && value.actorId) return String(value.actorId).trim() || null;
  return null;
}

function rowMatchesRole(task, role) {
  for (const field of RACI_FIELDS) {
    const actors = Array.isArray(task[field]) ? task[field] : [];
    for (const actor of actors) {
      if (normalizeRoleId(actor) === role) return field;
    }
  }
  return null;
}

function collectEvidenceGapNames(policyResult) {
  if (!Array.isArray(policyResult?.evidenceGaps)) return [];
  return policyResult.evidenceGaps.map((g) => g.name || g.id || String(g)).filter(Boolean);
}

function buildPolicySummary(policyResult) {
  if (!policyResult) {
    return {
      decision: 'unknown',
      allowed: null,
      requiresClarification: false,
      requiresHumanDecision: false,
      reason: 'policy_not_evaluated',
      missingEvidence: [],
    };
  }
  return {
    decision: policyResult.allowed
      ? 'allowed'
      : policyResult.requiresHumanDecision
        ? 'requires_human_decision'
        : policyResult.requiresClarification
          ? 'requires_clarification'
          : 'blocked',
    allowed: policyResult.allowed === true,
    requiresClarification: policyResult.requiresClarification === true,
    requiresHumanDecision: policyResult.requiresHumanDecision === true,
    reason: policyResult.reason || null,
    missingEvidence: collectEvidenceGapNames(policyResult),
    hitlPolicy: policyResult.hitlPolicy || null,
  };
}

/**
 * Project a role workbench from pre-fetched VDMI matrices.
 *
 * @param {object} options
 * @param {string} options.role            - role ID to project (e.g. 'ROLE_NETZPLANUNG')
 * @param {Array}  options.matrices        - VDMI matrix objects from vdmi.list response
 * @param {Function} options.evaluatePolicy - (row, context?) => policyResult
 * @param {Function} options.deriveRoles    - (row, policy?) => roleDerivationResult
 * @param {object}  [options.context]      - optional context forwarded to evaluatePolicy
 * @param {boolean} [options.includeResolved] - include rows from completed/resolved matrices
 * @returns {{ items: Array, summary: object }}
 */
function projectRoleWorkbench({
  role,
  matrices = [],
  evaluatePolicy,
  deriveRoles,
  context = {},
  includeResolved = false,
}) {
  const items = [];

  for (const matrix of matrices) {
    if (!includeResolved && matrix.status === 'completed') continue;

    const tasks = Array.isArray(matrix.tasks) ? matrix.tasks : [];

    for (const task of tasks) {
      const matchedField = rowMatchesRole(task, role);
      if (!matchedField) continue;

      const controlCase = task.controlCase || null;
      const evidenceRequirements = Array.isArray(task.evidenceRequirements)
        ? task.evidenceRequirements
        : [];
      const decisionPolicy = task.decisionPolicy || {};

      // Evaluate policy using the injected function (governance-policy-evaluator).
      // Pass the task directly — normalizeControlCase in the evaluator treats plain
      // objects as rows and reads task.controlCase, task.evidenceRequirements, and
      // task.decisionPolicy from it directly.
      let policyResult = null;
      if (controlCase && typeof evaluatePolicy === 'function') {
        try {
          policyResult = evaluatePolicy(task, context);
        } catch {
          // Non-fatal: policy evaluation failure becomes 'unknown' policy
          policyResult = null;
        }
      }

      // Derive HITL resolver roles
      let resolverRoles = [];
      if (typeof deriveRoles === 'function') {
        try {
          const derived = deriveRoles({ row: task, decisionPolicy });
          resolverRoles = derived.requiredResolverRoles || [];
        } catch {
          resolverRoles = [];
        }
      }

      const missingEvidence = collectEvidenceGapNames(policyResult);
      const commandHints = CONTROL_CASE_COMMAND_HINTS[controlCase] || [];

      items.push({
        id: `${matrix.id}:${task.taskId || 'unknown'}`,
        matrixId: matrix.id,
        matrixName: matrix.name || null,
        rowId: task.taskId || null,
        controlCase,
        roleRelation: matchedField,
        roleRelationLabel: RACI_RELATION_LABELS[matchedField] || matchedField,
        title: task.taskName || task.taskId || controlCase || 'Unknown task',
        status: matrix.status || 'unknown',
        policy: buildPolicySummary(policyResult),
        evidenceRequirements,
        missingEvidence,
        resolverRoles,
        allowedCommands: commandHints,
        audit: {
          hasDecisionReceipt: false,
          latestReceiptId: null,
        },
      });
    }
  }

  const openItems = items.filter((i) => i.status !== 'completed').length;
  const requiresClarification = items.filter((i) => i.policy.requiresClarification).length;
  const requiresHumanDecision = items.filter((i) => i.policy.requiresHumanDecision).length;
  const evidenceGapCount = items.reduce((acc, i) => acc + i.missingEvidence.length, 0);

  return {
    items,
    summary: {
      totalItems: items.length,
      openItems,
      requiresClarification,
      requiresHumanDecision,
      evidenceGaps: evidenceGapCount,
    },
  };
}

module.exports = {
  projectRoleWorkbench,
  RACI_FIELDS,
  RACI_RELATION_LABELS,
};
