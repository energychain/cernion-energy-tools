'use strict';

const { CURATED_CAPABILITIES } = require('./capability-catalog');
const { findClarificationPolicyMatch } = require('./clarification-policy-registry');
const { validateVdmiMatrixRow } = require('./vdmi-matrix-schema');

const REASON = Object.freeze({
  POLICY_ALLOWED: 'policy_allowed',
  CLARIFICATION_REQUIRED: 'clarification_required',
  HUMAN_DECISION_REQUIRED: 'human_decision_required',
  EVIDENCE_MISSING: 'evidence_missing',
  CAPABILITY_UNKNOWN: 'capability_unknown',
  CONTROL_CASE_INVALID: 'control_case_invalid',
  ACTION_NOT_ALLOWED: 'action_not_allowed',
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeCapability(capability) {
  if (isPlainObject(capability)) return capability;
  const capabilityName = normalizeText(capability);
  if (!capabilityName) return null;
  return CURATED_CAPABILITIES.find((entry) => entry.capability === capabilityName) || null;
}

function buildDecision(overrides = {}) {
  return {
    allowed: true,
    requiresClarification: false,
    clarificationQuestion: null,
    requiresHumanDecision: false,
    hitlPolicy: null,
    evidenceGaps: [],
    reason: REASON.POLICY_ALLOWED,
    sources: [],
    ...overrides,
  };
}

function buildPositiveFollowUp(gapName, label = gapName) {
  return {
    missingDataPoint: gapName,
    enablesDossierAddition: `Supplied ${label} can be added to the policy evaluation evidence.`,
  };
}

function getContextValue(context, name) {
  if (!isPlainObject(context) || !name) return undefined;
  if (Object.prototype.hasOwnProperty.call(context, name)) return context[name];
  if (isPlainObject(context.inputs) && Object.prototype.hasOwnProperty.call(context.inputs, name)) {
    return context.inputs[name];
  }
  if (
    isPlainObject(context.knownContext) &&
    Object.prototype.hasOwnProperty.call(context.knownContext, name)
  ) {
    return context.knownContext[name];
  }
  return undefined;
}

function collectRequiredInputGaps(capability, context) {
  const requiredInputs = Array.isArray(capability?.requiredInputs) ? capability.requiredInputs : [];
  return requiredInputs
    .filter((input) => input?.required)
    .filter((input) => !hasValue(getContextValue(context, input.name)))
    .map((input) => ({
      name: input.name,
      label: input.label || input.name,
      source: 'capability.requiredInputs',
      positiveFollowUp: buildPositiveFollowUp(input.name, input.label || input.name),
    }));
}

function collectEvidenceRequirementGaps(row, context) {
  const requirements = Array.isArray(row?.evidenceRequirements) ? row.evidenceRequirements : [];
  const providedEvidence = Array.isArray(context?.evidence)
    ? context.evidence
    : Array.isArray(context?.evidenceProvided)
      ? context.evidenceProvided
      : [];
  const provided = new Set(
    providedEvidence
      .map((item) =>
        typeof item === 'string'
          ? item
          : item?.id || item?.name || item?.label || item?.type || null
      )
      .filter(Boolean)
  );

  return requirements
    .map((requirement) => {
      if (typeof requirement === 'string') {
        return {
          name: requirement,
          label: requirement,
          source: 'controlCase.evidenceRequirements',
        };
      }
      return {
        name: requirement.id || requirement.name || requirement.label,
        label: requirement.label || requirement.name || requirement.id,
        source: 'controlCase.evidenceRequirements',
      };
    })
    .filter((requirement) => requirement.name && !provided.has(requirement.name))
    .map((requirement) => ({
      ...requirement,
      positiveFollowUp: buildPositiveFollowUp(requirement.name, requirement.label),
    }));
}

function mapClarificationQuestion(match) {
  const policy = match?.policy;
  if (!policy) return null;
  return {
    policyId: policy.id,
    question: policy.clarification?.question || null,
    fields: policy.clarification?.fields || [],
  };
}

function evaluateCapabilityPolicy({ capability, action, context = {} } = {}) {
  const resolvedCapability = normalizeCapability(capability);
  if (!resolvedCapability) {
    return buildDecision({
      allowed: false,
      reason: REASON.CAPABILITY_UNKNOWN,
      sources: ['capability-catalog'],
    });
  }

  const requestedAction = normalizeText(action || resolvedCapability.preferredActions?.[0]);
  const avoid = Array.isArray(resolvedCapability.avoid) ? resolvedCapability.avoid : [];
  if (requestedAction && avoid.includes(requestedAction)) {
    return buildDecision({
      allowed: false,
      reason: REASON.ACTION_NOT_ALLOWED,
      sources: ['capability-catalog.avoid'],
    });
  }

  const gaps = collectRequiredInputGaps(resolvedCapability, context);
  const clarificationMatch = findClarificationPolicyMatch({
    message: [context.message, context.question, context.task, requestedAction]
      .filter(Boolean)
      .join(' '),
    knownContext: {
      ...context,
      intent: resolvedCapability.intent,
      domainIntent: resolvedCapability.domain,
    },
    chatMode: context.chatMode || null,
  });
  const hitlPolicy = resolvedCapability.hitlPolicy || null;

  if (hitlPolicy) {
    return buildDecision({
      allowed: false,
      requiresHumanDecision: true,
      hitlPolicy,
      evidenceGaps: gaps,
      reason: REASON.HUMAN_DECISION_REQUIRED,
      sources: ['capability-catalog.hitlPolicy'],
    });
  }

  if (clarificationMatch) {
    return buildDecision({
      allowed: false,
      requiresClarification: true,
      clarificationQuestion: mapClarificationQuestion(clarificationMatch),
      evidenceGaps: gaps,
      reason: REASON.CLARIFICATION_REQUIRED,
      sources: ['clarification-policy-registry'],
    });
  }

  if (gaps.length > 0) {
    return buildDecision({
      allowed: false,
      evidenceGaps: gaps,
      reason: REASON.EVIDENCE_MISSING,
      sources: ['capability-catalog.requiredInputs'],
    });
  }

  return buildDecision({
    sources: ['capability-catalog'],
  });
}

function normalizeControlCase(controlCase, context = {}) {
  if (isPlainObject(controlCase)) return controlCase;
  const name = normalizeText(controlCase || context.controlCase);
  if (!name) return {};
  return {
    controlCase: name,
    evidenceRequirements: context.evidenceRequirements || [],
    decisionPolicy: context.decisionPolicy || {},
  };
}

function evaluateControlCasePolicy({ controlCase, context = {} } = {}) {
  const row = normalizeControlCase(controlCase, context);
  const validation = validateVdmiMatrixRow(row, { path: 'controlCase' });
  if (!validation.valid) {
    return buildDecision({
      allowed: false,
      reason: REASON.CONTROL_CASE_INVALID,
      sources: ['vdmi-matrix-schema'],
      validationErrors: validation.errors,
    });
  }

  const gaps = collectEvidenceRequirementGaps(row, context);
  const policy = row.decisionPolicy || {};
  const missingPolicy = policy.onMissingEvidence || null;

  if (gaps.length > 0 && missingPolicy === 'mandatory_human_decision') {
    return buildDecision({
      allowed: false,
      requiresHumanDecision: true,
      hitlPolicy: { source: 'controlCase.decisionPolicy', policy: missingPolicy },
      evidenceGaps: gaps,
      reason: REASON.HUMAN_DECISION_REQUIRED,
      sources: ['vdmi-matrix-schema', 'controlCase.decisionPolicy'],
    });
  }

  if (gaps.length > 0 && missingPolicy === 'clarification') {
    return buildDecision({
      allowed: false,
      requiresClarification: true,
      clarificationQuestion: {
        policyId: 'controlCase.onMissingEvidence',
        question: 'Welche Evidenz kann fuer den Governance-Control-Case nachgereicht werden?',
        fields: gaps.map((gap) => gap.name),
      },
      evidenceGaps: gaps,
      reason: REASON.CLARIFICATION_REQUIRED,
      sources: ['vdmi-matrix-schema', 'controlCase.decisionPolicy'],
    });
  }

  if (gaps.length > 0 && missingPolicy !== 'none') {
    return buildDecision({
      allowed: false,
      evidenceGaps: gaps,
      reason: REASON.EVIDENCE_MISSING,
      sources: ['vdmi-matrix-schema', 'controlCase.evidenceRequirements'],
    });
  }

  if (policy.onHighFinancialImpact === 'mandatory_human_decision' && context.highFinancialImpact) {
    return buildDecision({
      allowed: false,
      requiresHumanDecision: true,
      hitlPolicy: {
        source: 'controlCase.decisionPolicy',
        policy: 'mandatory_human_decision',
        trigger: 'highFinancialImpact',
      },
      reason: REASON.HUMAN_DECISION_REQUIRED,
      sources: ['vdmi-matrix-schema', 'controlCase.decisionPolicy'],
    });
  }

  return buildDecision({
    sources: ['vdmi-matrix-schema'],
  });
}

function evaluateGovernancePolicy(input = {}) {
  const context = isPlainObject(input.context) ? input.context : {};
  if (
    input.controlCase ||
    context.controlCase ||
    context.evidenceRequirements ||
    context.decisionPolicy
  ) {
    return evaluateControlCasePolicy({ controlCase: input.controlCase, context });
  }
  return evaluateCapabilityPolicy({
    capability: input.capability,
    action: input.action,
    context,
  });
}

module.exports = {
  REASON,
  evaluateGovernancePolicy,
  _private: {
    collectEvidenceRequirementGaps,
    collectRequiredInputGaps,
    evaluateCapabilityPolicy,
    evaluateControlCasePolicy,
  },
};
