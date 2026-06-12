'use strict';

const RECEIPT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ACTION_REF_PATTERN = /^[a-z0-9-]+\.[a-zA-Z0-9_]+$/;
const KNOWLEDGE_QUERY_TYPE = 'semantic';

const RECEIPT_STATUSES = ['draft', 'active', 'deprecated', 'archived'];

const CREATOR_SOURCES = ['chat', 'admin', 'api', 'seed'];

const STATUS_TRANSITIONS = {
  draft: new Set(['draft', 'active', 'archived']),
  active: new Set(['active', 'deprecated', 'archived']),
  deprecated: new Set(['deprecated', 'active', 'archived']),
  archived: new Set(['archived']),
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureStringArray(value, field, errors, { minItems = 0 } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push({ field, message: `${field} must be an array of strings.` });
    return [];
  }

  const normalized = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) {
      errors.push({ field, message: `${field} entries must be non-empty strings.` });
      continue;
    }
    normalized.push(entry.trim());
  }

  const unique = Array.from(new Set(normalized));
  if (minItems > 0 && unique.length < minItems) {
    errors.push({ field, message: `${field} requires at least ${minItems} item(s).` });
  }
  return unique;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeParamMapping(rawMapping, stepField, errors) {
  if (!isPlainObject(rawMapping)) {
    errors.push({
      field: `${stepField}.paramMapping`,
      message: 'paramMapping must be an object when provided.',
    });
    return null;
  }

  const normalized = {};
  const allowedSources = new Set(['fixed', 'context', 'default']);

  for (const [targetParam, rawRule] of Object.entries(rawMapping)) {
    const fieldBase = `${stepField}.paramMapping.${targetParam}`;

    if (typeof targetParam !== 'string' || !targetParam.trim()) {
      errors.push({
        field: `${stepField}.paramMapping`,
        message: 'paramMapping keys must be non-empty target parameter names.',
      });
      continue;
    }

    if (!isPlainObject(rawRule)) {
      errors.push({
        field: fieldBase,
        message: 'paramMapping rules must be objects.',
      });
      continue;
    }

    const source = typeof rawRule.source === 'string' ? rawRule.source.trim() : '';
    if (!allowedSources.has(source)) {
      errors.push({
        field: `${fieldBase}.source`,
        message: 'source must be one of: fixed, context, default.',
      });
      continue;
    }

    const rule = { source };

    if (source === 'fixed') {
      if (!hasOwn(rawRule, 'value')) {
        errors.push({
          field: `${fieldBase}.value`,
          message: 'fixed mappings require value.',
        });
      } else {
        rule.value = rawRule.value;
      }
    }

    if (source === 'context') {
      const contextField =
        typeof rawRule.contextField === 'string' ? rawRule.contextField.trim() : '';
      if (!contextField) {
        errors.push({
          field: `${fieldBase}.contextField`,
          message: 'context mappings require contextField.',
        });
      } else {
        rule.contextField = contextField;
      }
    }

    if (source === 'default') {
      const defaultKey = typeof rawRule.defaultKey === 'string' ? rawRule.defaultKey.trim() : '';
      if (defaultKey) {
        rule.defaultKey = defaultKey;
      }
      if (hasOwn(rawRule, 'value')) {
        rule.value = rawRule.value;
      }
    }

    if (typeof rawRule.derivationHint === 'string' && rawRule.derivationHint.trim()) {
      rule.derivationHint = rawRule.derivationHint.trim();
    }

    if (typeof rawRule.llmHint === 'string' && rawRule.llmHint.trim()) {
      rule.llmHint = rawRule.llmHint.trim();
    }

    normalized[targetParam.trim()] = rule;
  }

  return normalized;
}

function normalizeStep(rawStep, index, errors) {
  if (!isPlainObject(rawStep)) {
    errors.push({
      field: `toolPlan.steps[${index}]`,
      message: 'Each tool step must be an object.',
    });
    return null;
  }

  const step = {};

  if (typeof rawStep.action !== 'string' || !rawStep.action.trim()) {
    errors.push({
      field: `toolPlan.steps[${index}].action`,
      message: 'action is required and must be a non-empty string.',
    });
  } else {
    step.action = rawStep.action.trim();
    if (!ACTION_REF_PATTERN.test(step.action)) {
      errors.push({
        field: `toolPlan.steps[${index}].action`,
        message: 'action must follow service.action format.',
      });
    }
  }

  if (rawStep.description != null) {
    if (typeof rawStep.description !== 'string' || !rawStep.description.trim()) {
      errors.push({
        field: `toolPlan.steps[${index}].description`,
        message: 'description must be a non-empty string when provided.',
      });
    } else {
      step.description = rawStep.description.trim();
    }
  }

  if (rawStep.params != null) {
    if (!isPlainObject(rawStep.params)) {
      errors.push({
        field: `toolPlan.steps[${index}].params`,
        message: 'params must be an object when provided.',
      });
    } else {
      step.params = rawStep.params;
    }
  }

  if (rawStep.paramMapping != null) {
    const paramMapping = normalizeParamMapping(
      rawStep.paramMapping,
      `toolPlan.steps[${index}]`,
      errors
    );
    if (paramMapping) {
      step.paramMapping = paramMapping;
    }
  }

  if (rawStep.fallbackActions != null) {
    const fallbacks = ensureStringArray(
      rawStep.fallbackActions,
      `toolPlan.steps[${index}].fallbackActions`,
      errors
    );
    if (fallbacks.length > 0) {
      step.fallbackActions = fallbacks;
    }
  }

  if (rawStep.required !== undefined) {
    step.required = Boolean(rawStep.required);
  }

  if (rawStep.requiredScopes != null) {
    const scopes = ensureStringArray(
      rawStep.requiredScopes,
      `toolPlan.steps[${index}].requiredScopes`,
      errors
    );
    if (scopes.length > 0) {
      step.requiredScopes = scopes;
    }
  }

  if (rawStep.evidence != null) {
    if (!isPlainObject(rawStep.evidence)) {
      errors.push({
        field: `toolPlan.steps[${index}].evidence`,
        message: 'evidence must be an object when provided.',
      });
    } else {
      step.evidence = rawStep.evidence;
    }
  }

  return step;
}

function normalizeKnowledgeQuery(rawQuery, index, errors) {
  if (!isPlainObject(rawQuery)) {
    errors.push({
      field: `knowledgeQueries[${index}]`,
      message: 'Each knowledge query must be an object.',
    });
    return null;
  }

  const query = {};

  if (rawQuery.id != null) {
    if (typeof rawQuery.id !== 'string' || !rawQuery.id.trim()) {
      errors.push({
        field: `knowledgeQueries[${index}].id`,
        message: 'id must be a non-empty string when provided.',
      });
    } else {
      query.id = rawQuery.id.trim();
    }
  }

  const queryType =
    typeof rawQuery.queryType === 'string' && rawQuery.queryType.trim()
      ? rawQuery.queryType.trim()
      : KNOWLEDGE_QUERY_TYPE;
  if (queryType !== KNOWLEDGE_QUERY_TYPE) {
    errors.push({
      field: `knowledgeQueries[${index}].queryType`,
      message: 'queryType must be semantic in v0.54.4.',
    });
  } else {
    query.queryType = queryType;
  }

  if (typeof rawQuery.query !== 'string' || !rawQuery.query.trim()) {
    errors.push({
      field: `knowledgeQueries[${index}].query`,
      message: 'query is required and must be a non-empty string.',
    });
  } else {
    query.query = rawQuery.query.trim();
  }

  if (rawQuery.limit != null) {
    const limit = Number(rawQuery.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      errors.push({
        field: `knowledgeQueries[${index}].limit`,
        message: 'limit must be an integer between 1 and 10.',
      });
    } else {
      query.limit = limit;
    }
  }

  if (rawQuery.summaryMaxChars != null) {
    const summaryMaxChars = Number(rawQuery.summaryMaxChars);
    if (!Number.isInteger(summaryMaxChars) || summaryMaxChars < 80 || summaryMaxChars > 600) {
      errors.push({
        field: `knowledgeQueries[${index}].summaryMaxChars`,
        message: 'summaryMaxChars must be an integer between 80 and 600.',
      });
    } else {
      query.summaryMaxChars = summaryMaxChars;
    }
  }

  if (rawQuery.timeoutMs != null) {
    const timeoutMs = Number(rawQuery.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
      errors.push({
        field: `knowledgeQueries[${index}].timeoutMs`,
        message: 'timeoutMs must be an integer between 1000 and 60000.',
      });
    } else {
      query.timeoutMs = timeoutMs;
    }
  }

  return query;
}

function normalizeKnowledgeQueries(rawQueries, errors) {
  if (rawQueries == null) return [];

  if (!Array.isArray(rawQueries)) {
    errors.push({
      field: 'knowledgeQueries',
      message: 'knowledgeQueries must be an array when provided.',
    });
    return [];
  }

  return rawQueries
    .map((entry, idx) => normalizeKnowledgeQuery(entry, idx, errors))
    .filter(Boolean);
}

function normalizeKnowledgeEvidencePolicy(rawPolicy, errors) {
  if (rawPolicy == null) {
    return { required: false };
  }

  if (!isPlainObject(rawPolicy)) {
    errors.push({
      field: 'knowledgeEvidencePolicy',
      message: 'knowledgeEvidencePolicy must be an object when provided.',
    });
    return { required: false };
  }

  const policy = {
    required: Boolean(rawPolicy.required),
  };

  if (rawPolicy.timeoutBehavior != null) {
    const timeoutBehavior = String(rawPolicy.timeoutBehavior || '')
      .trim()
      .toLowerCase();
    if (timeoutBehavior && timeoutBehavior !== 'degraded') {
      errors.push({
        field: 'knowledgeEvidencePolicy.timeoutBehavior',
        message: 'timeoutBehavior must be degraded when provided.',
      });
    } else if (timeoutBehavior) {
      policy.timeoutBehavior = timeoutBehavior;
    }
  }

  return policy;
}

function normalizeMatching(rawMatching, errors) {
  if (!isPlainObject(rawMatching)) {
    errors.push({
      field: 'matching',
      message: 'matching is required and must be an object.',
    });
    return null;
  }

  const matching = {
    domains: ensureStringArray(rawMatching.domains, 'matching.domains', errors),
    triggerTerms: ensureStringArray(rawMatching.triggerTerms, 'matching.triggerTerms', errors),
    requiredEntities: ensureStringArray(
      rawMatching.requiredEntities,
      'matching.requiredEntities',
      errors
    ),
    workflowTypes: ensureStringArray(rawMatching.workflowTypes, 'matching.workflowTypes', errors),
  };

  const hasAtLeastOneCriterion =
    matching.domains.length > 0 ||
    matching.triggerTerms.length > 0 ||
    matching.requiredEntities.length > 0 ||
    matching.workflowTypes.length > 0;

  if (!hasAtLeastOneCriterion) {
    errors.push({
      field: 'matching',
      message:
        'matching must contain at least one criterion (domains, triggerTerms, requiredEntities, workflowTypes).',
    });
  }

  return matching;
}

function normalizeReceiptInput(input, errors) {
  if (!isPlainObject(input)) {
    errors.push({ field: 'receipt', message: 'receipt must be an object.' });
    return null;
  }

  const receipt = {};

  if (typeof input.receiptId !== 'string' || !input.receiptId.trim()) {
    errors.push({ field: 'receiptId', message: 'receiptId is required.' });
  } else {
    receipt.receiptId = input.receiptId.trim();
    if (!RECEIPT_ID_PATTERN.test(receipt.receiptId)) {
      errors.push({
        field: 'receiptId',
        message: 'receiptId must be a stable slug (lowercase letters, numbers, hyphens).',
      });
    }
  }

  if (typeof input.title !== 'string' || !input.title.trim()) {
    errors.push({ field: 'title', message: 'title is required.' });
  } else {
    receipt.title = input.title.trim();
  }

  if (typeof input.description !== 'string' || !input.description.trim()) {
    errors.push({ field: 'description', message: 'description is required.' });
  } else {
    receipt.description = input.description.trim();
  }

  if (typeof input.domain !== 'string' || !input.domain.trim()) {
    errors.push({ field: 'domain', message: 'domain is required.' });
  } else {
    receipt.domain = input.domain.trim().toLowerCase();
  }

  receipt.tags = ensureStringArray(input.tags, 'tags', errors);
  receipt.requiredInputs = ensureStringArray(input.requiredInputs, 'requiredInputs', errors);
  receipt.forbiddenInferences = ensureStringArray(
    input.forbiddenInferences,
    'forbiddenInferences',
    errors
  );

  const status = (input.status || 'draft').trim();
  if (!RECEIPT_STATUSES.includes(status)) {
    errors.push({
      field: 'status',
      message: `status must be one of: ${RECEIPT_STATUSES.join(', ')}.`,
    });
  } else {
    receipt.status = status;
  }

  const matching = normalizeMatching(input.matching, errors);
  if (matching) {
    receipt.matching = matching;
  }

  if (!isPlainObject(input.toolPlan)) {
    errors.push({ field: 'toolPlan', message: 'toolPlan is required and must be an object.' });
  } else {
    const rawSteps = Array.isArray(input.toolPlan.steps) ? input.toolPlan.steps : null;
    if (!rawSteps || rawSteps.length === 0) {
      errors.push({
        field: 'toolPlan.steps',
        message: 'toolPlan.steps is required and must contain at least one step.',
      });
    }

    const steps = rawSteps
      ? rawSteps.map((step, idx) => normalizeStep(step, idx, errors)).filter(Boolean)
      : [];

    const toolPlan = {
      steps,
    };

    if (input.toolPlan.defaults != null) {
      if (!isPlainObject(input.toolPlan.defaults)) {
        errors.push({
          field: 'toolPlan.defaults',
          message: 'toolPlan.defaults must be an object when provided.',
        });
      } else {
        toolPlan.defaults = input.toolPlan.defaults;
      }
    }

    receipt.toolPlan = toolPlan;
  }

  if (input.defaults != null) {
    if (!isPlainObject(input.defaults)) {
      errors.push({ field: 'defaults', message: 'defaults must be an object.' });
    } else {
      receipt.defaults = input.defaults;
    }
  } else {
    receipt.defaults = {};
  }

  if (input.knowledgePlan != null) {
    if (!isPlainObject(input.knowledgePlan)) {
      errors.push({ field: 'knowledgePlan', message: 'knowledgePlan must be an object.' });
    } else {
      receipt.knowledgePlan = input.knowledgePlan;
    }
  }

  if (input.evidencePolicy != null) {
    if (!isPlainObject(input.evidencePolicy)) {
      errors.push({ field: 'evidencePolicy', message: 'evidencePolicy must be an object.' });
    } else {
      receipt.evidencePolicy = input.evidencePolicy;
    }
  }

  if (input.responsePolicy != null) {
    if (!isPlainObject(input.responsePolicy)) {
      errors.push({ field: 'responsePolicy', message: 'responsePolicy must be an object.' });
    } else {
      receipt.responsePolicy = input.responsePolicy;
    }
  }

  const knowledgeQueries = normalizeKnowledgeQueries(input.knowledgeQueries, errors);
  if (knowledgeQueries.length > 0) {
    receipt.knowledgeQueries = knowledgeQueries;
  } else {
    receipt.knowledgeQueries = [];
  }

  receipt.knowledgeEvidencePolicy = normalizeKnowledgeEvidencePolicy(
    input.knowledgeEvidencePolicy,
    errors
  );

  if (input.metadata != null) {
    if (!isPlainObject(input.metadata)) {
      errors.push({ field: 'metadata', message: 'metadata must be an object.' });
    } else {
      receipt.metadata = input.metadata;
    }
  } else {
    receipt.metadata = {};
  }

  return receipt;
}

function validateReceipt(input) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeReceiptInput(input, errors);

  if (normalized && normalized.toolPlan && Array.isArray(normalized.toolPlan.steps)) {
    for (let i = 0; i < normalized.toolPlan.steps.length; i += 1) {
      const step = normalized.toolPlan.steps[i];
      if (Array.isArray(step.fallbackActions)) {
        for (const fallbackAction of step.fallbackActions) {
          if (!ACTION_REF_PATTERN.test(fallbackAction)) {
            errors.push({
              field: `toolPlan.steps[${i}].fallbackActions`,
              message: 'fallbackActions must contain service.action strings.',
            });
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized,
  };
}

function isStatusTransitionAllowed(fromStatus, toStatus) {
  const transitions = STATUS_TRANSITIONS[fromStatus];
  if (!transitions) return false;
  return transitions.has(toStatus);
}

module.exports = {
  RECEIPT_ID_PATTERN,
  RECEIPT_STATUSES,
  CREATOR_SOURCES,
  STATUS_TRANSITIONS,
  validateReceipt,
  isStatusTransitionAllowed,
};
