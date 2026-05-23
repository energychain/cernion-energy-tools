'use strict';

const { buildActionRegistry, getActionInfo } = require('./agent-receipts-registry');
const { evaluateReceiptMatch, getByPath, hasUsableValue } = require('./agent-receipts-matcher');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractStructuredEvidence(step = {}) {
  const evidence = isPlainObject(step.evidence) ? step.evidence : {};
  const fields = [];

  const sources = [evidence.requiredOutputFields, evidence.expectedFields];
  for (const candidate of sources) {
    if (!Array.isArray(candidate)) continue;
    for (const field of candidate) {
      if (typeof field === 'string' && field.trim()) {
        fields.push(field.trim());
      }
    }
  }

  return Array.from(new Set(fields));
}

function resolveMappedValue(rule, targetParam, context, defaults) {
  const source = rule?.source;

  if (source === 'fixed') {
    return {
      value: Object.prototype.hasOwnProperty.call(rule, 'value') ? rule.value : undefined,
      from: 'fixed',
      missing: false,
    };
  }

  if (source === 'context') {
    const contextField = typeof rule.contextField === 'string' ? rule.contextField : targetParam;
    const value = getByPath(context, contextField);
    return {
      value,
      from: `context:${contextField}`,
      missing: !hasUsableValue(value),
    };
  }

  if (source === 'default') {
    const defaultKey = typeof rule.defaultKey === 'string' ? rule.defaultKey : targetParam;
    const fromDefaults = getByPath(defaults, defaultKey);
    const hasFallback = Object.prototype.hasOwnProperty.call(rule || {}, 'value');
    const fallback = hasFallback ? rule.value : undefined;
    const value = hasUsableValue(fromDefaults) ? fromDefaults : fallback;
    return {
      value,
      from: `default:${defaultKey}`,
      missing: !hasUsableValue(value),
    };
  }

  return {
    value: undefined,
    from: 'unsupported',
    missing: true,
  };
}

function evaluateStep(
  step,
  index,
  context,
  defaults,
  actionRegistry,
  registryAudit,
  receiptUpdatedAt
) {
  const warnings = [];
  const errors = [];
  const requestedAction = step.action;
  const fallbackActions = Array.isArray(step.fallbackActions) ? step.fallbackActions : [];
  const candidates = [requestedAction, ...fallbackActions];

  let selectedAction = null;
  let actionInfo = null;

  for (const actionRef of candidates) {
    const found = getActionInfo(actionRegistry, actionRef);
    if (found) {
      selectedAction = actionRef;
      actionInfo = found;
      break;
    }
  }

  if (!actionInfo) {
    errors.push({
      code: 'RECEIPT_ACTION_NOT_FOUND',
      message: `No live Moleculer action found for ${requestedAction}.`,
      action: requestedAction,
      fallbackActions,
    });

    return {
      index,
      action: requestedAction,
      selectedAction: null,
      params: {},
      status: 'missing-action',
      missingRequiredParams: [],
      evidenceRequiredFields: extractStructuredEvidence(step),
      warnings,
      errors,
    };
  }

  const params = {
    ...(isPlainObject(step.params) ? step.params : {}),
  };

  const paramMapping = isPlainObject(step.paramMapping) ? step.paramMapping : {};
  const paramSchema = isPlainObject(actionInfo.paramsSchema) ? actionInfo.paramsSchema : {};
  const schemaProperties = isPlainObject(paramSchema.properties) ? paramSchema.properties : {};

  for (const [targetParam, rule] of Object.entries(paramMapping)) {
    if (!Object.prototype.hasOwnProperty.call(schemaProperties, targetParam)) {
      warnings.push({
        code: 'RECEIPT_PARAM_NOT_IN_ACTION_SCHEMA',
        action: selectedAction,
        param: targetParam,
        message: `Mapped parameter ${targetParam} is not in live action schema for ${selectedAction}.`,
      });
    }

    const resolved = resolveMappedValue(rule, targetParam, context, defaults);
    if (resolved.missing) {
      continue;
    }
    params[targetParam] = resolved.value;
  }

  const required = Array.isArray(paramSchema.required) ? paramSchema.required : [];
  const missingRequiredParams = required.filter((field) => !hasUsableValue(params[field]));

  const stepAudit = isPlainObject(registryAudit?.actions)
    ? registryAudit.actions[selectedAction]
    : null;
  if (stepAudit?.signature && stepAudit.signature !== actionInfo.signature) {
    warnings.push({
      code: 'RECEIPT_ACTION_SIGNATURE_CHANGED',
      action: selectedAction,
      updatedAt: receiptUpdatedAt || null,
      message:
        'Live action signature differs from stored registry audit snapshot. Continuing with compatibility check.',
    });
  }

  return {
    index,
    action: requestedAction,
    selectedAction,
    params,
    status: missingRequiredParams.length === 0 ? 'ready' : 'missing-input',
    missingRequiredParams,
    evidenceRequiredFields: extractStructuredEvidence(step),
    warnings,
    errors,
  };
}

function evaluateReceiptPlan(receipt, payload = {}) {
  const context = isPlainObject(payload.context) ? payload.context : {};
  const input = isPlainObject(payload.input) ? payload.input : {};
  const mergedContext = {
    ...context,
    ...input,
  };

  const defaults = {
    ...(isPlainObject(receipt?.defaults) ? receipt.defaults : {}),
    ...(isPlainObject(receipt?.toolPlan?.defaults) ? receipt.toolPlan.defaults : {}),
  };

  const actionRegistry = isPlainObject(payload.actionRegistry)
    ? payload.actionRegistry
    : buildActionRegistry(payload.broker);

  const match = evaluateReceiptMatch(receipt, mergedContext);

  const declaredRequiredInputs = Array.isArray(receipt?.requiredInputs)
    ? receipt.requiredInputs
    : [];
  const missingRequiredInputs = declaredRequiredInputs.filter((field) => {
    const fromContext = getByPath(mergedContext, field);
    const fromDefault = getByPath(defaults, field);
    return !hasUsableValue(fromContext) && !hasUsableValue(fromDefault);
  });

  const steps = Array.isArray(receipt?.toolPlan?.steps) ? receipt.toolPlan.steps : [];
  const registryAudit = isPlainObject(receipt?.metadata?.registryAudit)
    ? receipt.metadata.registryAudit
    : {};

  const plannedSteps = steps.map((step, index) =>
    evaluateStep(
      step,
      index,
      mergedContext,
      defaults,
      actionRegistry,
      registryAudit,
      receipt?.updatedAt
    )
  );

  const warnings = [];
  const errors = [];

  for (const step of plannedSteps) {
    warnings.push(...step.warnings);
    errors.push(...step.errors);
  }

  const allEvidenceRequirements = plannedSteps
    .map((step) => ({
      stepIndex: step.index,
      action: step.selectedAction || step.action,
      requiredOutputFields: step.evidenceRequiredFields,
    }))
    .filter((entry) => entry.requiredOutputFields.length > 0);

  const knowledgeEvidencePayload = isPlainObject(payload.knowledgeEvidence)
    ? payload.knowledgeEvidence
    : {};
  const knowledgeEvidenceStatus =
    typeof knowledgeEvidencePayload.status === 'string'
      ? knowledgeEvidencePayload.status
      : 'missing';
  const knowledgeEvidence = Array.isArray(knowledgeEvidencePayload.hits)
    ? knowledgeEvidencePayload.hits
    : [];
  const knowledgeEvidencePolicy = isPlainObject(receipt?.knowledgeEvidencePolicy)
    ? receipt.knowledgeEvidencePolicy
    : { required: false };
  const knowledgeRequired = knowledgeEvidencePolicy.required === true;
  const knowledgeEvidenceSatisfied = !knowledgeRequired || knowledgeEvidenceStatus === 'available';

  if (knowledgeRequired && !knowledgeEvidenceSatisfied) {
    warnings.push({
      code: 'RECEIPT_KNOWLEDGE_REQUIRED_NOT_AVAILABLE',
      message: `Knowledge evidence required but status is ${knowledgeEvidenceStatus}.`,
    });
  }

  const executable =
    missingRequiredInputs.length === 0 &&
    errors.length === 0 &&
    plannedSteps.every((step) => step.status === 'ready');

  return {
    receiptId: receipt?.receiptId || null,
    matchScore: match.score,
    matched: match.matched,
    matchReasons: match.reasons,
    missingMatchEntities: match.missingEntities,
    declaredRequiredInputs,
    missingRequiredInputs,
    plannedToolCalls: plannedSteps,
    evidenceRequirements: allEvidenceRequirements,
    knowledgeEvidenceStatus,
    knowledgeEvidence,
    knowledgeEvidencePolicy,
    knowledgeEvidenceRequired: knowledgeRequired,
    knowledgeEvidenceSatisfied,
    knowledgeEvidenceTrace: isPlainObject(knowledgeEvidencePayload.trace)
      ? knowledgeEvidencePayload.trace
      : { queryCount: 0, queries: [] },
    warnings,
    errors,
    executable,
    actionRegistrySummary: {
      actionCount: Object.keys(actionRegistry).length,
      checkedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  evaluateReceiptPlan,
};
