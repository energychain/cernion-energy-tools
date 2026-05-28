'use strict';

/**
 * Personal Agent Work Log — v0.57.3
 *
 * Per-turn, request-scoped activity log for agentTrace.workLog[].
 * All data is local to the request closure — never stored on service instance.
 *
 * Safety principles:
 * - primitives + enum_array only in metadata (no nested objects, no free-text arrays)
 * - no personaId, confidence, tenantId, userId, sessionId, toolsUsed, warnings, blockers, questionId
 * - toArray() returns Object.freeze([...entries]) — immutable snapshot
 * - unknown actions dropped silently in service path; validateWorkLogEntry() throws in test path
 */

// ---------------------------------------------------------------------------
// Action enum — use WORK_LOG_ACTIONS.CONSTANT_NAME at all callsites
// ---------------------------------------------------------------------------

const WORK_LOG_ACTIONS = Object.freeze({
  ROUTING_CLASSIFIED: 'routing_classified',
  ROUTING_GAP_DETECTED: 'routing_gap_detected',
  EXECUTION_PLAN_REVIEWED: 'execution_plan_reviewed',
  EXECUTION_READINESS_ASSESSED: 'execution_readiness_assessed',
  ONBOARDING_GAP_DETECTED: 'onboarding_gap_detected',
  ONBOARDING_QUESTION_POSED: 'onboarding_question_posed',
  ONBOARDING_ANSWER_CAPTURED: 'onboarding_answer_captured',
  KNOWLEDGE_CONSULTED: 'knowledge_consulted',
  PERSONA_RESOLVED: 'persona_resolved',
  CONSULTATION_SYNTHESIS: 'consultation_synthesis',
  CONSULTATION_FALLBACK: 'consultation_fallback',
  CONTEXT_MUTATION: 'context_mutation',
  EXECUTION_TRIGGERED: 'execution_triggered',
  EXECUTION_PHASE_TRANSITION: 'execution_phase_transition',
  WORKLOG_TRUNCATED: 'worklog_truncated',
});

// Set for .has() validation — the only gating mechanism in the service path
const VALID_WORK_LOG_ACTIONS = new Set(Object.values(WORK_LOG_ACTIONS));

// ---------------------------------------------------------------------------
// Metadata whitelist — primitives and enum_array only, no nested objects
// ---------------------------------------------------------------------------

const WORK_LOG_METADATA_WHITELIST = Object.freeze({
  routing_classified: {
    targetDomain: { type: 'string', maxLength: 64 },
    primaryIntent: { type: 'string', maxLength: 64 },
    reasonCode: {
      type: 'string',
      maxLength: 64,
      enumValues: ['INTENT_SIGNAL_DETECTED', 'DEFAULT_ROUTE', 'FALLBACK_ROUTE'],
    },
    warningCodes: {
      type: 'enum_array',
      enumCodes: ['AMBIGUOUS_INTENT', 'LOW_SIGNAL', 'BRIDGE_PARTIAL'],
    },
  },
  routing_gap_detected: {
    gapReason: {
      type: 'string',
      maxLength: 64,
      enumValues: ['NO_MATCH', 'BRIDGE_UNAVAILABLE', 'TIMEOUT'],
    },
    domain: { type: 'string', maxLength: 64 },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
  },
  execution_plan_reviewed: {
    stepCount: { type: 'number' },
    planStatus: {
      type: 'string',
      maxLength: 64,
      enumValues: ['draft', 'ready_for_execution', 'blocked', 'abandoned'],
    },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
  },
  execution_readiness_assessed: {
    status: {
      type: 'string',
      maxLength: 64,
      enumValues: ['ready', 'blocked', 'partial', 'unavailable'],
    },
    blockerCodes: {
      type: 'enum_array',
      enumCodes: ['PARAMS_INCOMPLETE', 'TENANT_UNRESOLVED', 'KNOWLEDGE_SCOPE_MISSING', 'HITL_PENDING'],
    },
    phase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
  },
  onboarding_gap_detected: {
    missingField: {
      type: 'string',
      maxLength: 64,
      enumValues: ['organizationType', 'knowledgeScope', 'region', 'capacity'],
    },
    source: {
      type: 'string',
      maxLength: 64,
      enumValues: ['knownContext', 'session', 'user_response'],
    },
    status: {
      type: 'string',
      maxLength: 64,
      enumValues: ['unknown', 'partial', 'established'],
    },
    severity: {
      type: 'string',
      maxLength: 64,
      enumValues: ['info', 'warning', 'error'],
    },
  },
  onboarding_question_posed: {
    // No questionId — topic, category, phase only
    topic: { type: 'string', maxLength: 128 },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
    phase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
  },
  onboarding_answer_captured: {
    field: {
      type: 'string',
      maxLength: 64,
      enumValues: ['organizationType', 'knowledgeScope', 'region', 'capacity'],
    },
    status: {
      type: 'string',
      maxLength: 64,
      enumValues: ['unknown', 'partial', 'established'],
    },
    phase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    updateReason: {
      type: 'string',
      maxLength: 64,
      enumValues: ['user_input', 'session_inference', 'context_resolution'],
    },
  },
  knowledge_consulted: {
    scope: {
      type: 'string',
      maxLength: 64,
      enumValues: ['session', 'user', 'role', 'tenant_candidate', 'public'],
    },
    sourceCategory: {
      type: 'string',
      maxLength: 64,
      enumValues: ['grid_data', 'market_data', 'geo_data', 'regulatory_data', 'inhouse_data', 'other'],
    },
    toolCount: { type: 'number' },
    elapsedMs: { type: 'number' },
  },
  persona_resolved: {
    // No personaId, no confidence
    roleLabel: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'Grid Analyst',
        'Utility Manager',
        'Project Developer',
        'Aggregator',
        'Trader',
        'Consultant',
        'Unknown',
      ],
    },
    source: {
      type: 'string',
      maxLength: 64,
      enumValues: ['knownContext', 'session', 'user_input'],
    },
    updateReason: {
      type: 'string',
      maxLength: 64,
      enumValues: ['role_consistency_check', 'new_evidence', 'explicit_user_input'],
    },
  },
  consultation_synthesis: {
    // No toolsUsed[] — aggregated count and category only
    toolCount: { type: 'number' },
    sourceCategory: {
      type: 'string',
      maxLength: 64,
      enumValues: ['grid_data', 'market_data', 'geo_data', 'regulatory_data', 'inhouse_data', 'other'],
    },
    phase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    elapsedMs: { type: 'number' },
  },
  consultation_fallback: {
    reason: {
      type: 'string',
      maxLength: 64,
      enumValues: ['BUDGET_EXHAUSTED', 'TOOLS_UNAVAILABLE', 'SYNTHESIS_TIMEOUT', 'MANDATORY_HITL_GATE'],
    },
    phase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
    attemptCount: { type: 'number' },
  },
  context_mutation: {
    mutationReason: {
      type: 'string',
      maxLength: 64,
      enumValues: ['USER_INPUT', 'INFERENCE', 'SESSION_DISCOVERY', 'SCOPE_PROMOTION'],
    },
    scope: {
      type: 'string',
      maxLength: 64,
      enumValues: ['L0', 'L1', 'L2', 'L3'],
    },
    status: {
      type: 'string',
      maxLength: 64,
      enumValues: ['appended', 'replaced', 'rejected'],
    },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
  },
  execution_triggered: {
    phase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    status: {
      type: 'string',
      maxLength: 64,
      enumValues: ['started', 'running', 'pending_approval'],
    },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
  },
  execution_phase_transition: {
    fromPhase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    toPhase: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'routing',
        'planning',
        'onboarding',
        'knowledge_gathering',
        'synthesis',
        'execution',
        'finalization',
      ],
    },
    reason: {
      type: 'string',
      maxLength: 64,
      enumValues: ['PLAN_COMPLETE', 'EXECUTION_READY', 'CONSULTATION_START', 'SYNTHESIS_COMPLETE', 'FALLBACK_APPLIED'],
    },
    category: {
      type: 'string',
      maxLength: 64,
      enumValues: [
        'plan_validation',
        'knowledge_lookup',
        'persona_check',
        'context_check',
        'execution_gate',
        'fallback_strategy',
        'error_handling',
      ],
    },
  },
  worklog_truncated: {
    totalActivities: { type: 'number' },
    retainedFirst: { type: 'number' },
    retainedLast: { type: 'number' },
    droppedMiddle: { type: 'number' },
  },
});

// ---------------------------------------------------------------------------
// Field sanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitize a single metadata field value according to its field spec.
 * Supports: 'string', 'number', 'boolean', 'enum_array' only.
 * Throws on invalid type, wrong value type, or out-of-enum value.
 * NOTE: 'array' (free-text) is intentionally absent.
 *
 * @param {*} value
 * @param {{ type: string, maxLength?: number, enumValues?: string[], enumCodes?: string[] }} fieldSpec
 * @returns {*}
 */
function sanitizeMetadataField(value, fieldSpec) {
  const { type, maxLength, enumValues, enumCodes } = fieldSpec;
  switch (type) {
    case 'string': {
      const str = String(value || '')
        .slice(0, maxLength || 64)
        .trim();
      if (enumValues && !enumValues.includes(str)) {
        throw new Error(`Invalid enum value: ${str}`);
      }
      return str;
    }
    case 'number': {
      const num = Number(value);
      if (!Number.isFinite(num)) throw new Error('Invalid number');
      return num;
    }
    case 'boolean':
      return Boolean(value);
    case 'enum_array': {
      // Only pre-defined codes pass — no free-text strings from runtime sources.
      if (!Array.isArray(enumCodes) || enumCodes.length === 0) {
        throw new Error('enum_array field requires enumCodes definition');
      }
      if (!Array.isArray(value)) throw new Error('Not an array');
      const validCodes = new Set(enumCodes);
      return value.filter(v => validCodes.has(String(v))).slice(0, 10);
    }
    default:
      throw new Error(`Unknown field type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Metadata sanitizer
// ---------------------------------------------------------------------------

/**
 * Apply action whitelist to inputMetadata.
 * Unknown fields are dropped silently. Type errors drop the field.
 *
 * @param {string} action
 * @param {object} inputMetadata
 * @returns {object}
 */
function sanitizeWorkLogMetadata(action, inputMetadata = {}) {
  const allowlist = WORK_LOG_METADATA_WHITELIST[action];
  if (!allowlist) return {};
  const output = {};
  for (const [key, fieldSpec] of Object.entries(allowlist)) {
    const value = inputMetadata[key];
    if (value === undefined || value === null) continue;
    try {
      output[key] = sanitizeMetadataField(value, fieldSpec);
    } catch (_err) {
      // Drop field silently in service path
    }
  }
  return output;
}

// ---------------------------------------------------------------------------
// Entry sanitizer (service-safe — returns null on failure)
// ---------------------------------------------------------------------------

/**
 * Sanitize a single work log entry.
 * Returns null if the action is invalid or the entry cannot be sanitized.
 *
 * @param {{ action: string, label: string, metadata?: object }} entry
 * @returns {{ action: string, label: string, metadata: object }|null}
 */
function sanitizeWorkLogEntry({ action, label, metadata = {} }) {
  if (!VALID_WORK_LOG_ACTIONS.has(action)) {
    return null;
  }
  const sanitizedLabel = String(label || '')
    .slice(0, 120)
    .trim()
    .replace(/[\x00-\x1f]/g, '');
  const sanitizedMetadata = sanitizeWorkLogMetadata(action, metadata);
  return { action, label: sanitizedLabel, metadata: sanitizedMetadata };
}

// ---------------------------------------------------------------------------
// Per-turn accumulator factory
// ---------------------------------------------------------------------------

/**
 * Create a fresh per-turn work log accumulator.
 * Must be called once at the start of each _executeChatCoreLogic() invocation.
 * Never stored on the service instance (this).
 *
 * @returns {{ addEntry: Function, toArray: Function }}
 */
function createTurnWorkLog() {
  let totalActivities = 0; // Separate counter — survives multiple overflow events
  const entries = []; // Internal mutable array — never exposed directly

  function _applyOverflowStrategy() {
    if (entries.length <= 16) return;
    const first8 = entries.slice(0, 8);
    const last7 = entries.slice(-7);
    const truncationEntry = {
      step: 9,
      timestamp: new Date().toISOString(),
      action: WORK_LOG_ACTIONS.WORKLOG_TRUNCATED,
      label: `Activity log trimmed: ${totalActivities} activities in this turn`,
      metadata: {
        totalActivities, // from closure counter, not entries.length
        retainedFirst: 8,
        retainedLast: 7,
        droppedMiddle: totalActivities - 15,
      },
    };
    entries.length = 0;
    entries.push(...first8, truncationEntry, ...last7.map((e, i) => ({ ...e, step: 10 + i })));
  }

  /**
   * Add an activity entry to the log.
   * Unknown actions return null silently — no throw in service path.
   *
   * @param {{ action: string, label: string, metadata?: object }} param0
   * @returns {{ action: string, label: string, metadata: object }|null}
   */
  function addEntry({ action, label, metadata = {} }) {
    if (!VALID_WORK_LOG_ACTIONS.has(action)) {
      return null; // Silent drop
    }

    totalActivities += 1; // Always increment before overflow check

    const sanitized = sanitizeWorkLogEntry({ action, label, metadata });
    if (!sanitized) return null;

    entries.push({
      step: entries.length + 1,
      timestamp: new Date().toISOString(),
      ...sanitized,
    });

    if (entries.length > 16) {
      _applyOverflowStrategy();
    }

    return sanitized;
  }

  /**
   * Return an immutable snapshot of the current entries.
   * Callers cannot mutate the internal array through this reference.
   *
   * @returns {ReadonlyArray}
   */
  function toArray() {
    return Object.freeze([...entries]);
  }

  return { addEntry, toArray };
}

// ---------------------------------------------------------------------------
// Test-level validator (throws — never call in service path)
// ---------------------------------------------------------------------------

/**
 * Strictly validate a work log entry. Throws on any violation.
 * Use only in unit test helpers — not in production service paths.
 *
 * @param {object} entry
 * @throws {Error}
 */
function validateWorkLogEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Entry must be an object');
  if (!VALID_WORK_LOG_ACTIONS.has(entry.action))
    throw new Error(`Invalid action: ${entry.action}`);
  if (typeof entry.step !== 'number' || entry.step < 1) throw new Error('Invalid step number');
  if (!entry.timestamp || !new Date(entry.timestamp).getTime())
    throw new Error('Invalid timestamp');
  if (typeof entry.label !== 'string' || entry.label.length > 120)
    throw new Error('Invalid label (max 120 chars)');
  if (entry.metadata !== null && typeof entry.metadata !== 'object')
    throw new Error('Invalid metadata');

  const FORBIDDEN_KEYS = new Set([
    'personaId',
    'confidence',
    'tenantId',
    'userId',
    'sessionId',
    'knownContext',
    'context',
    'payload',
    'reasoning',
    'internalReason',
    'debugInfo',
    'toolsUsed',
    'warnings',
    'blockers',
    'questionId',
  ]);

  const foundForbidden = Object.keys(entry.metadata || {}).filter(k => FORBIDDEN_KEYS.has(k));
  if (foundForbidden.length > 0) {
    throw new Error(`Forbidden metadata keys: ${foundForbidden.join(', ')}`);
  }

  for (const [k, v] of Object.entries(entry.metadata || {})) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      throw new Error(`Nested object in metadata key "${k}" is not allowed`);
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  WORK_LOG_ACTIONS,
  VALID_WORK_LOG_ACTIONS,
  WORK_LOG_METADATA_WHITELIST,
  createTurnWorkLog,
  sanitizeWorkLogEntry,
  sanitizeWorkLogMetadata,
  sanitizeMetadataField,
  validateWorkLogEntry,
};
