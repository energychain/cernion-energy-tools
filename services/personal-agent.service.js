'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const jobStore = require('../src/job-store');
const { getTenantId, tenantNamespace } = require('../src/tenant-context');
const {
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
  assertNoL4RawInPersistedState,
  resolveContextMutation,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
} = require('../src/personal-agent-context');
const {
  PERSONAL_AGENT_STATES,
  createStateMachine,
  transitionStateMachine,
  deriveTerminalState,
  summarizeStateMachine,
} = require('../src/personal-agent-state-machine');
const {
  createExecutionStateGraph,
  advanceExecutionStateGraph,
  summarizeExecutionStateGraph,
  createMessageFingerprint,
} = require('../src/personal-agent-execution-state-graph');
const {
  createTurnGraph,
  addNode,
  addEdge,
  finalizeTurnGraph,
  summarizeTurnGraph,
  addWorkflowPlanNode,
} = require('../src/personal-agent-turn-graph');
const {
  buildConsultationExecutionPlan,
  executeWithReceipt,
  EXECUTION_READINESS,
} = require('../src/consultation-execution-bridge');
const {
  extractAvailableInputs,
  isInputAlreadyProvided,
} = require('../src/consultation-input-extractor');
const { validateRoutingIntent } = require('../src/consultation-routing-guardrails');
const { decideRoutingTarget } = require('../src/personal-agent-routing-graph');
const { buildExecutionGapResponse } = require('../src/mark-execution-gap');
const { createExecutionTrace } = require('../src/execution-trace');
const { createToolCallTracker } = require('../src/tool-call-tracker');
const {
  EXECUTION_MODES,
  CHAT_MODES,
  ROUTING_CONTROL_ACTIONS,
  normalizeExecutionMode,
  normalizeChatMode,
  detectExplicitChatModeSwitch,
  detectChatMode,
  detectRequestedDomains,
  buildExecutionPlan,
  applyMissingContextFallback,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
  runExecutionPreflight,
  extractPromptHints,
  fuzzyClassifyConsultationIntent,
} = require('../src/personal-agent-routing');
const {
  shouldBlockSynthesisOnGaps,
  buildEvidenceGapPresentation,
} = require('../src/evidence-planner');
const {
  queryKnowledgeOrientation: queryKnowledgeOrientationAdapter,
} = require('../src/personal-agent-knowledge-rag');
const {
  scheduleDream,
  cancelDream,
  isDreamPending,
  runDreamPipeline,
  DREAM_AUDIT_NAMESPACE,
} = require('../src/personal-agent-dreamer');
const {
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
  ONBOARDING_PARAM_ALTERNATIVES,
} = require('../src/personal-agent-onboarding');
const {
  buildResponseStrategy: buildPersonalAgentResponseStrategy,
  buildStrategyLead: buildPersonalAgentStrategyLead,
} = require('../src/personal-agent-response-strategy');
const {
  buildGroundedReceiptReply: buildGroundedReceiptReplyAdapter,
} = require('../src/ev-co2-synthesis');
const {
  extractBlueprintPolicy,
  checkStickinessRetain,
  buildSynthesisPolicyDirectives,
} = require('../src/blueprint-policy-interpreter');
const { detectBlueprintIntent, findBlueprintByPrimaryIntent } = require('../src/l3-broker');
const { loadBlueprint } = require('../src/blueprint-registry');
const {
  resolveLocationFromText,
  buildLocationContextPatch,
  buildLocationResolutionTrace,
  classifyMarketPartnerRole,
} = require('../src/location-resolution');
const {
  generateText: llmGenerateText,
  generateStructured: llmGenerateStructured,
} = require('../src/llm-client');
const {
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  ocrExtractImage,
  extractDocumentText,
  readTextContent,
  injectFileIntoL3,
} = require('../src/personal-agent-file-handler');
const { executeToolWithRetry } = require('../src/consultation-tool-resolver');
const {
  pushPlanFrame,
  markTopFrameCompleted,
  findResumableParentFrame,
  resumeParentPlanFrame,
  mergeResolvedParamsIntoPlan,
  hasRecentIntentLoop,
  assertNoRecentIntentLoop,
} = require('../src/session-manager');
const { buildZnpContextSnapshot } = require('../src/znp-context-snapshot'); // v0.56.3
const {
  WORK_LOG_ACTIONS,
  createTurnWorkLog,
  getSafePersonaLabel,
} = require('../src/personal-agent-work-log'); // v0.57.3
const {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildContextFieldWorkOutLoudPayload,
} = require('../src/personal-agent-work-out-loud');
const {
  REFLECTION_OUTPUT_SCHEMA,
  buildReflectionPrompt,
  validateReflectionPatch,
  hasScopeBlockedOrMissingSteps,
} = require('../src/personal-agent-reflection'); // v0.57.5 #158

const OPENAPI_TAG = 'Personal Agent';
const SESSION_NAMESPACE = process.env.PERSONAL_AGENT_SESSION_NAMESPACE || 'personal_agent_sessions';
const PROFILE_NAMESPACE =
  process.env.PERSONAL_AGENT_PROFILE_NAMESPACE || 'personal_agent_user_profiles';
const DEFAULT_SYSTEM_PROMPT =
  process.env.PERSONAL_AGENT_SYSTEM_PROMPT ||
  'Du bist der Cernion Personal Agent. Arbeite deterministisch, knapp und fachlich korrekt.';

const CONSULTATION_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['reply', 'hypotheses', 'openQuestions', 'nextActions', 'factsUsed'],
  additionalProperties: false,
  properties: {
    reply: { type: 'string', minLength: 1 },
    hypotheses: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'confidence', 'evidence'],
        properties: {
          statement: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: { type: 'string' },
        },
      },
    },
    openQuestions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'whyRelevant'],
        properties: {
          question: { type: 'string' },
          whyRelevant: { type: 'string' },
        },
      },
    },
    nextActions: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'description'],
        properties: {
          action: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    factsUsed: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'value'],
        properties: {
          source: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
  },
};

const CONSULTATION_REACT_MAX_ITERATIONS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_REACT_MAX_ITERATIONS || 4
);
const CONSULTATION_REACT_MAX_MS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_REACT_MAX_MS || 90000
);
const PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT = 90000;
const CONSULTATION_SYNTHESIS_MIN_MS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_SYNTHESIS_MIN_MS || 5_000
);
const CONSULTATION_TOOL_MAX_ATTEMPTS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_TOOL_MAX_ATTEMPTS || 2
);
const CONSULTATION_TOOL_TIMEOUT_MS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_TOOL_TIMEOUT_MS || 16000
);
const CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS || 750
);
const CONSULTATION_HISTORY_MAX_ENTRIES = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_HISTORY_MAX_ENTRIES || 6
);
const CONSULTATION_HISTORY_MAX_CHARS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_HISTORY_MAX_CHARS || 1200
);
const CONSULTATION_HISTORY_ENTRY_MAX_CHARS = Number(
  process.env.PERSONAL_AGENT_CONSULTATION_HISTORY_ENTRY_MAX_CHARS || 220
);
const CONSULTATION_HISTORY_REDACTION_PLACEHOLDER =
  '[technischer Rohinhalt aus vorherigem Turn ausgeblendet]';

function isNotFound(error) {
  return error?.code === 404 || error?.type === 'OBJECT_NOT_FOUND';
}

function isActionUnavailable(error) {
  return (
    error?.code === 404 ||
    error?.type === 'SERVICE_NOT_FOUND' ||
    error?.type === 'SERVICE_NOT_AVAILABLE' ||
    error?.type === 'SERVICE_SCHEMA_ERROR' ||
    error?.name === 'ServiceNotFoundError'
  );
}

function sanitizeReflectionContextValue(value, maxLen = 120) {
  if (value == null) return null;
  return String(value)
    .replace(/(authorization|api[_-]?key|token|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ck)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
    .trim();
}

function isReflectionContextSuspiciousKey(key = '') {
  const normalized = String(key || '').toLowerCase();
  return (
    normalized.includes('l4') ||
    normalized.includes('toolcontext') ||
    normalized.includes('tool_context') ||
    normalized.includes('raw') ||
    normalized.includes('payload') ||
    normalized.includes('response') ||
    normalized.includes('hems') ||
    normalized.includes('nap') ||
    normalized.includes('inhouse') ||
    normalized.includes('tenant') ||
    normalized.includes('session') ||
    normalized.includes('auth') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('attachment') ||
    normalized.includes('datasource') ||
    normalized.includes('result')
  );
}

function isReflectionContextSuspiciousValue(value = '') {
  const normalized = String(value || '').toLowerCase();
  return (
    normalized.includes('tenant:') ||
    normalized.includes('session:') ||
    normalized.includes('layer4') ||
    normalized.includes('l4') ||
    normalized.includes('hems') ||
    normalized.includes('nap') ||
    normalized.includes('inhouse') ||
    normalized.includes('toolcontext') ||
    normalized.includes('responseRaw'.toLowerCase()) ||
    normalized.includes('datasource-cache.query')
  );
}

function sanitizeKnownContextForReflectionPrompt(knownContext = {}) {
  if (!knownContext || typeof knownContext !== 'object' || Array.isArray(knownContext)) {
    return {};
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(knownContext)) {
    if (value == null || value === '') continue;
    if (isReflectionContextSuspiciousKey(key)) continue;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const safeValue = sanitizeReflectionContextValue(value, 140);
      if (!safeValue || isReflectionContextSuspiciousValue(safeValue)) continue;
      sanitized[key] = safeValue;
      continue;
    }

    if (Array.isArray(value)) {
      const preview = value
        .filter((entry) => entry != null)
        .slice(0, 3)
        .map((entry) => sanitizeReflectionContextValue(entry, 80))
        .filter((entry) => entry && !isReflectionContextSuspiciousValue(entry));
      if (preview.length > 0) {
        sanitized[key] = preview.join(', ');
      }
      continue;
    }

    if (typeof value === 'object') {
      const compactEntries = Object.entries(value)
        .filter(([nestedKey, nestedVal]) => {
          if (nestedVal == null || nestedVal === '') return false;
          if (isReflectionContextSuspiciousKey(nestedKey)) return false;
          return (
            typeof nestedVal === 'string' ||
            typeof nestedVal === 'number' ||
            typeof nestedVal === 'boolean'
          );
        })
        .slice(0, 4)
        .map(([nestedKey, nestedVal]) => {
          const safeNestedVal = sanitizeReflectionContextValue(nestedVal, 80);
          return [nestedKey, safeNestedVal];
        })
        .filter(([, nestedVal]) => nestedVal && !isReflectionContextSuspiciousValue(nestedVal));

      if (compactEntries.length > 0) {
        sanitized[key] = compactEntries.map(([k, v]) => `${k}=${v}`).join('; ');
      }
    }
  }

  return sanitized;
}

function flattenScopeViolations(evaluation = null) {
  return (Array.isArray(evaluation?.plannedToolCalls) ? evaluation.plannedToolCalls : []).flatMap(
    (step) =>
      Array.isArray(step?.scopeViolations)
        ? step.scopeViolations
            .filter((violation) => violation && typeof violation === 'object')
            .map((violation) => ({
              scope: violation.scope || null,
              code: violation.code || null,
              message: sanitizeReflectionContextValue(violation.message || '', 160),
            }))
        : []
  );
}

function buildReceiptReflectionSummary(selection = null) {
  if (!selection || typeof selection !== 'object') return null;
  const evaluation =
    selection?.evaluation && typeof selection.evaluation === 'object' ? selection.evaluation : null;
  const receiptIdCandidate =
    selection?.receiptId || selection?.selectedReceipt?.receiptId || selection?.selectedReceipt?.id;
  if (!receiptIdCandidate && !evaluation && selection?.selected !== true) {
    return null;
  }
  const missingRequiredInputs = Array.isArray(evaluation?.missingRequiredInputs)
    ? evaluation.missingRequiredInputs.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const scopeViolations = flattenScopeViolations(evaluation);
  const blockedSteps = Array.isArray(evaluation?.plannedToolCalls)
    ? evaluation.plannedToolCalls.filter(
        (step) => step?.status === 'scope-blocked' || step?.status === 'missing-input'
      ).length
    : 0;

  return {
    receiptId: receiptIdCandidate || null,
    status: selection?.status || selection?.selectedReceipt?.status || null,
    mode: selection?.mode || null,
    score: typeof selection?.score === 'number' ? selection.score : null,
    execution: {
      used: selection?.execution?.used === true,
      fallbackReason: selection?.execution?.fallbackReason || null,
    },
    evaluation: {
      executable: typeof evaluation?.executable === 'boolean' ? evaluation.executable : null,
      missingRequiredInputsCount: missingRequiredInputs.length,
      scopeViolationsCount: scopeViolations.length,
      blockedStepsCount: blockedSteps,
    },
  };
}

function buildReceiptReflectionAuditSeed(selection = null) {
  if (!selection || typeof selection !== 'object') return null;
  const receiptSummary = buildReceiptReflectionSummary(selection);
  if (!receiptSummary) return null;
  const evaluation =
    selection?.evaluation && typeof selection.evaluation === 'object' ? selection.evaluation : null;
  const missingRequiredInputs = Array.isArray(evaluation?.missingRequiredInputs)
    ? evaluation.missingRequiredInputs.filter((item) => typeof item === 'string' && item.trim())
    : [];
  const scopeViolations = flattenScopeViolations(evaluation);

  return {
    attempted: false,
    outcome: 'unavailable',
    initialExecutable: typeof evaluation?.executable === 'boolean' ? evaluation.executable : null,
    initialBlocked:
      typeof evaluation?.executable === 'boolean' ? evaluation.executable === false : null,
    initialMissingRequiredInputs: missingRequiredInputs,
    initialScopeViolations: scopeViolations,
    validationOutcome: 'not-performed',
    rejectedKeys: [],
    resolvedFields: [],
    confidence: null,
    evidence: '',
    unresolvedScopes: [],
    reEvaluation: {
      performed: false,
      executable: null,
    },
    receipt: receiptSummary,
  };
}

/**
 * Detects a Moleculer parameter validation error that slipped past preflight.
 * These should be converted to a structured PREFLIGHT_MISS signal instead of
 * exposing raw schema internals to the user.
 */
function isParametersValidationError(error) {
  const msg = String(error?.message || '');
  return (
    /parameters\s+validation\s+error/i.test(msg) ||
    error?.type === 'VALIDATION_ERROR' ||
    error?.name === 'ValidationError'
  );
}

function normalizeHitlStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase();
}

function isHitlApprovedStatus(status) {
  return normalizeHitlStatus(status) === 'approved';
}

function isHitlTerminalStatus(status) {
  return ['approved', 'rejected', 'declined', 'cancelled', 'expired', 'resolved'].includes(
    normalizeHitlStatus(status)
  );
}

function buildConsultationToolExecutionContext(ctx, brokerOverride = null) {
  const boundCtxCall = typeof ctx?.call === 'function' ? ctx.call.bind(ctx) : null;
  const resolvedBroker = brokerOverride || ctx?.broker || null;
  const boundBrokerCall =
    resolvedBroker && typeof resolvedBroker.call === 'function'
      ? resolvedBroker.call.bind(resolvedBroker)
      : null;

  const call =
    boundCtxCall ||
    boundBrokerCall ||
    (() => {
      throw new TypeError('ctx.call is not a function');
    });

  return {
    call,
    meta: ctx?.meta && typeof ctx.meta === 'object' ? ctx.meta : {},
    broker: resolvedBroker,
  };
}

function isConsultationDebugEnabled(knownContext = {}) {
  return knownContext?.debugTrace === true || knownContext?.debugConsultation === true;
}

function sanitizeConsultationDebugText(value, maxLen = 240) {
  if (value == null) {
    return null;
  }

  return String(value)
    .replace(/(authorization|api[_-]?key|token|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|ck)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .slice(0, maxLen);
}

function sanitizeConsultationDebugError(error) {
  if (!error) {
    return null;
  }

  const normalized = typeof error === 'object' ? error : { message: String(error) };
  return pruneUndefinedDeep({
    name: sanitizeConsultationDebugText(normalized.name || 'Error', 80),
    code: sanitizeConsultationDebugText(normalized.code || normalized.type || null, 80),
    message: sanitizeConsultationDebugText(normalized.message || String(error), 240),
  });
}

function buildConsultationDebugLogMessage(type, payload = {}) {
  switch (type) {
    case 'consultation_route_selected':
      return `Consultation route: ${payload.primaryIntent || 'consultation'} / ${payload.workflowType || 'unknown'}`;
    case 'consultation_budget_check':
      return `Budget ${payload.phase || 'check'}: ${payload.remainingMs}ms remaining`;
    case 'consultation_planner_start':
      return `Planner start (iteration ${payload.iteration || 0})`;
    case 'consultation_planner_end':
      return `Planner end (iteration ${payload.iteration || 0}, ${payload.durationMs}ms)`;
    case 'consultation_planner_error':
      return `Planner error (iteration ${payload.iteration || 0}): ${payload.errorMessage || 'unknown error'}`;
    case 'consultation_tool_start':
      return `Tool start: ${payload.tool || payload.action || 'unknown'} (attempt ${payload.attempt || 1})`;
    case 'consultation_tool_end':
      return `Tool end: ${payload.tool || payload.action || 'unknown'} → ${payload.status || 'unknown'} (${payload.durationMs}ms)`;
    case 'consultation_tool_error':
      return `Tool error: ${payload.tool || payload.action || 'unknown'} (attempt ${payload.attempt || 1}) ${payload.errorMessage || 'unknown error'}`;
    case 'effective_tool_timeout':
      return `Effective tool timeout: ${payload.tool || payload.action || 'unknown'} -> ${payload.effectiveToolTimeoutMs}ms`;
    case 'tool_skipped_due_to_budget':
      return `Tool skipped due to budget: ${payload.tool || payload.action || 'unknown'} (${payload.reason || 'budget'})`;
    case 'synthesis_budget_reserved':
      return `Synthesis budget reserved: ${payload.synthesisMinMs}ms`;
    case 'consultation_observation':
      return `Observation: ${payload.action || 'unknown'} → ${payload.status || 'unknown'}`;
    case 'consultation_synthesis_skipped':
      return `Synthesis skipped: ${payload.reason || 'unknown'} (${payload.remainingMs}ms remaining)`;
    case 'consultation_synthesis_start':
      return `Synthesis start (observations=${payload.observationsCount || 0}, timeout=${payload.timeoutMs || 'n/a'}ms)`;
    case 'consultation_synthesis_end':
      return `Synthesis end (${payload.durationMs}ms)`;
    case 'consultation_synthesis_error':
      return `Synthesis error (${payload.durationMs || 0}ms): ${payload.errorMessage || 'unknown error'}`;
    case 'consultation_synthesis_null':
      return `Synthesis null: ${payload.reason || 'unknown'}`;
    case 'consultation_fallback_selected':
      return `Consultation fallback: ${payload.branch || payload.reason || 'unknown'}`;
    default:
      return type;
  }
}

function buildConsultationDebugProgress(type, payload = {}) {
  const iteration = typeof payload.iteration === 'number' ? payload.iteration : 0;

  switch (type) {
    case 'consultation_route_selected':
      return 25;
    case 'consultation_budget_check':
      return Math.min(88, 26 + iteration * 5);
    case 'consultation_planner_start':
      return Math.min(88, 28 + iteration * 5);
    case 'consultation_planner_end':
      return Math.min(88, 29 + iteration * 5);
    case 'consultation_tool_start':
      return Math.min(88, 31 + iteration * 5);
    case 'consultation_tool_end':
    case 'consultation_tool_error':
    case 'effective_tool_timeout':
    case 'tool_skipped_due_to_budget':
    case 'consultation_observation':
      return Math.min(90, 33 + iteration * 5);
    case 'synthesis_budget_reserved':
      return 80;
    case 'consultation_synthesis_skipped':
      return 82;
    case 'consultation_synthesis_start':
      return 84;
    case 'consultation_synthesis_end':
      return 89;
    case 'consultation_synthesis_error':
    case 'consultation_synthesis_null':
      return 86;
    case 'consultation_fallback_selected':
      return 84;
    default:
      return 50;
  }
}

function createConsultationDebugRecorder({
  enabled = false,
  trace = null,
  agenticJobStore = null,
  agenticJobId = null,
} = {}) {
  const sink = Array.isArray(trace) ? trace : [];

  return {
    trace: sink,
    emit(type, payload = {}) {
      if (!enabled) {
        return null;
      }

      const event = pruneUndefinedDeep({
        type,
        at: new Date().toISOString(),
        ...payload,
      });
      sink.push(event);

      if (agenticJobStore && agenticJobId) {
        const phase = [type, payload.iteration, payload.phase].filter(Boolean).join('_');
        agenticJobStore.appendLog(
          agenticJobId,
          phase,
          buildConsultationDebugProgress(type, payload),
          buildConsultationDebugLogMessage(type, payload),
          event
        );
      }

      return event;
    },
  };
}

/**
 * Returns true only if `value` looks like a real BDEW code (5–13 digits).
 * Rejects free-text tokens that NLP extraction may have accidentally placed
 * in promptHints.bdew (e.g. "KANNST", "WER", "FÜR").
 */
function isPlausibleBdewCode(value) {
  if (!value || typeof value !== 'string') return false;
  return /^\d{5,13}$/.test(value.trim());
}

module.exports = {
  name: 'personal-agent',

  settings: {
    maxContextTokens: Number(process.env.PERSONAL_AGENT_MAX_CONTEXT_TOKENS || 128_000),
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },

  actions: {
    chat: {
      rest: 'POST /chat',
      params: {
        message: { type: 'string', min: 1, trim: true, max: 8000 },
        sessionId: { type: 'string', optional: true, trim: true, max: 120 },
        toolContext: { type: 'object', optional: true },
        fileAttachments: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              attachmentId: { type: 'string', optional: true },
              fileName: { type: 'string', optional: true },
              mimeType: { type: 'string', optional: true },
              sizeBytes: { type: 'number', optional: true, convert: true },
              tempPath: { type: 'string', optional: true },
            },
          },
        },
        executionMode: {
          type: 'enum',
          optional: true,
          values: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL],
          default: EXECUTION_MODES.AUTO,
        },
        chatMode: {
          type: 'enum',
          optional: true,
          values: [CHAT_MODES.EXECUTION, CHAT_MODES.CONSULTATION],
        },
        forceReceipt: { type: 'string', optional: true, trim: true, max: 120 },
        preferredReceipts: {
          type: 'array',
          optional: true,
          items: 'string',
          default: [],
        },
        allowDraftReceipts: { type: 'boolean', optional: true, default: false, convert: true },
        explainReceiptSelection: { type: 'boolean', optional: true, default: false, convert: true },
        disableReceiptSelection: { type: 'boolean', optional: true, default: false, convert: true },
        knownContext: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Run one Personal-Agent chat turn with deterministic L0-L4 context stacking',
        description:
          'Builds a deterministic context stack (L0-L4), binds the capability-broker routing layer, supports auto-execution or HITL plan return, and guarantees Layer 4 purge after synthesis. ' +
          'Layer-4 raw tool JSON is never persisted.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 8000,
                    example: 'Plane eine neue PV-Anlage in Troisdorf.',
                  },
                  sessionId: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
                  executionMode: {
                    type: 'string',
                    enum: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL],
                    default: EXECUTION_MODES.AUTO,
                  },
                  chatMode: {
                    type: 'string',
                    enum: [CHAT_MODES.EXECUTION, CHAT_MODES.CONSULTATION],
                    default: CHAT_MODES.CONSULTATION,
                    example: CHAT_MODES.CONSULTATION,
                    description:
                      'Optional explicit chat mode. If set, it overrides auto detection for this turn.',
                  },
                  forceReceipt: {
                    type: 'string',
                    example: 'vnb-lookup-v1',
                    description:
                      'Optional receipt id to force. Invalid or policy-forbidden ids fail with 422.',
                  },
                  preferredReceipts: {
                    type: 'array',
                    items: { type: 'string' },
                    default: [],
                    example: ['vnb-lookup-v1', 'grid-ops-fallback-v1'],
                    description: 'Optional ordered list of preferred runtime receipt ids.',
                  },
                  allowDraftReceipts: {
                    type: 'boolean',
                    default: false,
                    description: 'When true, draft receipts can be selected in controlled testing.',
                  },
                  explainReceiptSelection: {
                    type: 'boolean',
                    default: false,
                    description:
                      'When true, includes receipt-selection diagnostics in metadata.receiptSelection.',
                  },
                  disableReceiptSelection: {
                    type: 'boolean',
                    default: false,
                    description:
                      'When true, bypasses runtime receipt selection and enforces legacy routing behavior.',
                  },
                  toolContext: { type: 'object', additionalProperties: true, default: {} },
                  knownContext: { type: 'object', additionalProperties: true, default: {} },
                  fileAttachments: {
                    type: 'array',
                    example: [
                      {
                        attachmentId: 'att_7f3c2e9b',
                        fileName: 'netzanschluss-anfrage.pdf',
                        mimeType: 'application/pdf',
                        sizeBytes: 248731,
                        tempPath: '/tmp/uploads/tenant-default/session-pa_a1b2c3/att_7f3c2e9b.pdf',
                      },
                    ],
                    items: {
                      type: 'object',
                      properties: {
                        attachmentId: { type: 'string' },
                        fileName: { type: 'string' },
                        mimeType: { type: 'string' },
                        sizeBytes: { type: 'number' },
                        tempPath: { type: 'string' },
                      },
                    },
                  },
                },
              },
              examples: {
                auto: {
                  summary: 'AUTO execution with deterministic plan run',
                  value: {
                    message: 'Prüfe die Netzanschlusskapazität für Troisdorf.',
                    executionMode: EXECUTION_MODES.AUTO,
                    knownContext: { location: 'Troisdorf' },
                  },
                },
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string' },
                  sessionId: { type: 'string' },
                  executionMode: {
                    type: 'string',
                    enum: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL],
                  },
                  chatMode: {
                    type: 'string',
                    enum: [CHAT_MODES.EXECUTION, CHAT_MODES.CONSULTATION],
                    default: CHAT_MODES.CONSULTATION,
                    example: CHAT_MODES.CONSULTATION,
                  },
                  knownContext: { type: 'string', description: 'JSON-stringified object' },
                  toolContext: { type: 'string', description: 'JSON-stringified object' },
                  forceReceipt: { type: 'string' },
                  preferredReceipts: {
                    type: 'string',
                    description: 'JSON array string, e.g. ["receipt-a","receipt-b"]',
                  },
                  allowDraftReceipts: { type: 'string', description: 'true/false' },
                  explainReceiptSelection: { type: 'string', description: 'true/false' },
                  disableReceiptSelection: { type: 'string', description: 'true/false' },
                  fileAttachments: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description:
              'Chat turn completed (internal Moleculer calls only; REST gateway calls receive 202 Accepted)',
            content: {
              'application/json': {
                examples: {
                  // Example 1: HITL Mode - Plan only returned
                  hitlPlanOnly: {
                    summary: 'HITL Mode: Plan returned for manual review',
                    value: {
                      success: true,
                      sessionId: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
                      executionMode: 'hitl',
                      reply:
                        'Ich habe einen 2-stufigen Plan entworfen. Sie können ihn überprüfen und dann manuell ausführen.',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 2850,
                        estimatedPromptTokens: 1200,
                        estimatedCompletionTokens: 1650,
                        maxTokens: 128000,
                        percentUsed: 2.2,
                      },
                      historyCount: 5,
                      routing: {
                        source: 'broker',
                        routeKey: null,
                        routeLabel: null,
                        primaryIntent: 'investment-analysis',
                        secondaryIntents: ['grid-planning', 'financial-modeling'],
                        requestedDomains: [],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'complete',
                        steps: [
                          {
                            stepId: 1,
                            action: 'finance-agent.analyze',
                            label: 'Investitionsanalyse',
                            params: {
                              gridOperator: 'Stadtwerke München',
                              investmentType: 'cable',
                              location: 'Schwabing',
                              plannedCapacityMW: 15,
                            },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'znp.assessPortfolio',
                            label: 'Portfolio-Assessment',
                            params: {
                              projectId: '__step_1.financialProjectId',
                              assumptions: { growthRate: 0.08, discountRate: 0.055 },
                            },
                            dependencies: [1],
                          },
                        ],
                      },
                      execution: {
                        status: 'skipped',
                        steps: [],
                        stopPoint: null,
                      },
                    },
                  },
                  awaitingOnboarding: {
                    summary: 'AUTO Mode: Awaiting onboarding answer',
                    value: {
                      success: true,
                      sessionId: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
                      executionMode: 'auto',
                      reply:
                        'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 2100,
                        estimatedPromptTokens: 1200,
                        estimatedCompletionTokens: 900,
                        maxTokens: 128000,
                        percentUsed: 1.6,
                      },
                      historyCount: 3,
                      routing: {
                        source: 'capability-broker',
                        routeKey: null,
                        routeLabel: 'grid_operator_identity_resolution',
                        primaryIntent: 'grid-connection.validate',
                        secondaryIntents: [],
                        requestedDomains: ['grid-connection'],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'partial',
                        steps: [
                          {
                            stepId: 1,
                            action: 'grid-connection.validate',
                            label: 'Netzanschluss Validierung',
                            params: { gridOperatorName: null },
                            dependencies: [],
                            blocked: true,
                          },
                        ],
                      },
                      execution: {
                        status: 'awaiting-onboarding',
                        completedSteps: 0,
                        steps: [],
                        stopPoint: {
                          reasonCode: 'MISSING_INPUTS',
                          blockedStep: 1,
                          blockedAction: 'grid-connection.validate',
                          missingParams: ['gridOperatorName'],
                          message:
                            'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                          status: 'awaiting-onboarding',
                          onboardingQuestion: {
                            questionId: 'oq_abc123',
                            paramKey: 'gridOperatorName',
                            questionText:
                              'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                            ts: '2026-05-15T14:20:00Z',
                            answeredAt: null,
                            answer: null,
                            status: 'pending',
                          },
                        },
                      },
                    },
                  },
                  // Example 2: AUTO Mode - Full execution success
                  autoFullSuccess: {
                    summary: 'AUTO Mode: Full execution completed',
                    value: {
                      success: true,
                      sessionId: 'pa_x9y8z7w6-v5u4-t3s2-r1q0-p9o8n7m6l5k4',
                      executionMode: 'auto',
                      reply:
                        'Die Investitionsanalyse ist abgeschlossen. Die Kosten betragen ca. 45.000 EUR mit einer Amortisationszeit von 8,2 Jahren bei 7% Rendite.',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 5420,
                        estimatedPromptTokens: 2100,
                        estimatedCompletionTokens: 3320,
                        maxTokens: 128000,
                        percentUsed: 4.2,
                      },
                      historyCount: 7,
                      routing: {
                        source: 'matrix',
                        routeKey: 'investment-grid',
                        routeLabel: 'Investment-Grid Integration',
                        primaryIntent: 'investment-grid-check',
                        secondaryIntents: [],
                        requestedDomains: ['investment', 'grid'],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'complete',
                        steps: [
                          {
                            stepId: 1,
                            action: 'finance-agent.analyze',
                            label: 'NPV Analysis',
                            params: { gridOperator: 'TWL Netze', investmentType: 'transformer' },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'znp.assessPortfolio',
                            label: 'Grid Impact Assessment',
                            params: { projectId: '__step_1.projectId' },
                            dependencies: [1],
                          },
                        ],
                      },
                      execution: {
                        status: 'completed',
                        completedSteps: [1, 2],
                        steps: [
                          {
                            stepId: 1,
                            action: 'finance-agent.analyze',
                            result: {
                              npv: 125000,
                              irr: 0.092,
                              paybackYears: 8.2,
                              projectId: 'proj_invest_001',
                            },
                            timestamp: '2026-05-15T14:23:45Z',
                          },
                          {
                            stepId: 2,
                            action: 'znp.assessPortfolio',
                            result: {
                              gridStress: 0.68,
                              requiresExpansion: false,
                              recommendation: 'proceed',
                            },
                            timestamp: '2026-05-15T14:23:52Z',
                          },
                        ],
                        stopPoint: null,
                      },
                    },
                  },
                  // Example 3: AUTO Mode - Partial execution (missing inputs stop)
                  autoPartialMissingInputs: {
                    summary: 'AUTO Mode: Partial execution stopped at missing inputs',
                    value: {
                      success: true,
                      sessionId: 'pa_m5l4k3j2-i1h0-g9f8-e7d6-c5b4a3z2y1x0',
                      executionMode: 'auto',
                      reply:
                        'Ich habe die Energiefreigabe-Validierung gestartet, benötige aber noch die Projekt-ID. Können Sie bitte angeben, welches Projekt Sie prüfen möchten?',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 3100,
                        estimatedPromptTokens: 1500,
                        estimatedCompletionTokens: 1600,
                        maxTokens: 128000,
                        percentUsed: 2.4,
                      },
                      historyCount: 6,
                      routing: {
                        source: 'matrix',
                        routeKey: 'energy-sharing-znp',
                        routeLabel: 'Energy Sharing Validation + ZNP',
                        primaryIntent: 'energy-sharing-check',
                        secondaryIntents: [],
                        requestedDomains: ['energy-sharing', 'znp'],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'partial',
                        steps: [
                          {
                            stepId: 1,
                            action: 'energy-sharing.validate',
                            label: 'Energiefreigabe Validierung',
                            params: {
                              gridOperatorId: 'GNB0000003456',
                              generators: [{ capacity: 50, location: 'München-Nord' }],
                            },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'znp.getProjectMeta',
                            label: 'ZNP Projekt Details',
                            params: {
                              projectId: '__user_input.projectId',
                            },
                            dependencies: [1],
                            blocked: true,
                          },
                        ],
                      },
                      execution: {
                        status: 'partial',
                        completedSteps: [1],
                        steps: [
                          {
                            stepId: 1,
                            action: 'energy-sharing.validate',
                            result: { status: 'eligible', findings: [] },
                            timestamp: '2026-05-15T14:20:10Z',
                          },
                        ],
                        stopPoint: {
                          reasonCode: 'MISSING_INPUTS',
                          blockedStep: 2,
                          blockedAction: 'znp.getProjectMeta',
                          missingParams: ['projectId'],
                          message:
                            'Step 2 blocked: requires projectId. Available aliases: project, projectName, projectCode.',
                          status: 'user-input-required',
                          placeholderId: 'placeholder_user_input_v1',
                        },
                      },
                    },
                  },
                  // Example 4: AUTO Mode - Partial execution (unsupported chain degradation)
                  autoPartialUnsupported: {
                    summary: 'AUTO Mode: Partial execution, unsupported chain degraded gracefully',
                    value: {
                      success: true,
                      sessionId: 'pa_n0o1p2q3-r4s5-t6u7-v8w9-x0y1z2a3b4c5',
                      executionMode: 'auto',
                      reply:
                        'Die Redispatch-Analyse ist abgeschlossen. Die Erweiterung auf die Speicherplanung ist in dieser Version nicht freigeschaltet – ich stelle Ihnen dafür ein Manual-Interface zur Verfügung.',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 3850,
                        estimatedPromptTokens: 1800,
                        estimatedCompletionTokens: 2050,
                        maxTokens: 128000,
                        percentUsed: 3.0,
                      },
                      historyCount: 6,
                      routing: {
                        source: 'broker',
                        routeKey: null,
                        routeLabel: null,
                        primaryIntent: 'redispatch-analysis',
                        secondaryIntents: ['storage-planning'],
                        requestedDomains: ['redispatch', 'storage'],
                        unsupportedDomains: ['storage'],
                        warnings: [
                          'Requested domain "storage" is not in the routing matrix for redispatch. Stopping after redispatch completion.',
                        ],
                      },
                      plan: {
                        status: 'partial',
                        steps: [
                          {
                            stepId: 1,
                            action: 'redispatch-expost.audit',
                            label: 'Redispatch Settlement Audit',
                            params: { gridOperatorId: 'SNB0000001234', minCapacityKW: 100 },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'storage.optimizer',
                            label: 'Storage Optimization (UNSUPPORTED)',
                            params: {},
                            dependencies: [1],
                            blocked: true,
                          },
                        ],
                      },
                      execution: {
                        status: 'partial',
                        completedSteps: [1],
                        steps: [
                          {
                            stepId: 1,
                            action: 'redispatch-expost.audit',
                            result: {
                              status: 'ready',
                              portfolioSize: 247,
                              totalCapacity: 3560,
                              findings: [],
                            },
                            timestamp: '2026-05-15T14:18:30Z',
                          },
                        ],
                        stopPoint: {
                          reasonCode: 'UNSUPPORTED_CHAIN',
                          blockedStep: 2,
                          blockedAction: 'storage.optimizer',
                          message:
                            'Domain "storage" is not routable in deterministic chains. Interface placeholder activated for manual continuation.',
                          status: 'interface-placeholder',
                          placeholderId: 'placeholder_storage_gap_v1',
                          placeholderMetadata: {
                            title: 'Speicheroptimierung',
                            description:
                              'Manuelle Speicheroptimierung auf Basis des Redispatch-Audits erforderlich.',
                            suggestedNextSteps: [
                              'Laden Sie die Audit-Ergebnisse herunter',
                              'Nutzen Sie unser Storage-Analyse-Tool',
                              'Kontaktieren Sie unseren Speicher-Spezialisten',
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          202: {
            description:
              'Accepted - Chat turn submitted as async job. Poll /api/jobs/:jobId/status for progress. (REST gateway only; internal Moleculer calls receive 200.)',
            headers: {
              Location: { description: 'URL to poll job status', schema: { type: 'string' } },
              'Retry-After': {
                description: 'Recommended polling interval in seconds',
                schema: { type: 'string' },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    jobId: { type: 'string' },
                    status: { type: 'string', enum: ['queued'] },
                    message: { type: 'string' },
                    statusUrl: { type: 'string' },
                    resultUrl: { type: 'string' },
                    progressUrl: { type: 'string' },
                    reused: { type: 'boolean' },
                  },
                  required: ['success', 'jobId', 'status', 'statusUrl', 'resultUrl', 'progressUrl'],
                },
              },
            },
          },
          400: {
            description: 'Bad request - invalid parameters or validation error',
          },
          404: {
            description: 'Service or action not found',
          },
          500: {
            description: 'Internal server error',
          },
        },
      },
      async handler(ctx) {
        const sessionKey = String(ctx.params.sessionId || '').trim();
        const messageKey = String(ctx.params.message || '').trim();
        const receiptKey = String(ctx.params.forceReceipt || '').trim();
        const idempotencyKey =
          sessionKey && messageKey
            ? `${sessionKey}:${crypto
                .createHash('sha256')
                .update(`${messageKey}|${receiptKey}`)
                .digest('hex')
                .slice(0, 16)}`
            : sessionKey || undefined;

        // Gateway-aware async job routing wrapper
        return await jobStore.startJob(
          ctx,
          { service: 'personal-agent', action: 'chat' },
          (jobId) => this._executeChatCoreLogic(ctx, jobId),
          {
            idempotencyKey,
            wakeContext: {
              params: {
                sessionId: sessionKey || undefined,
                message: messageKey,
                forceReceipt: receiptKey || undefined,
              },
              meta: {
                tenantId: ctx.meta?.tenantId,
                userId: ctx.meta?.authUser?.userId,
              },
            },
          }
        );
      },

      // Core chat logic extracted as a method callable from async job wrapper
      async _executeChatCoreLogic(ctx, jobId = null) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const sessionId = String(ctx.params.sessionId || `pa_${crypto.randomUUID()}`);
        const executionMode = normalizeExecutionMode(ctx.params.executionMode);
        const executionTrace = createExecutionTrace({ sessionId });
        const toolCallTracker = createToolCallTracker({ sessionId });
        let stateMachine = createStateMachine({
          sessionId,
          chatMode: normalizeChatMode(ctx.params.chatMode || ctx.meta?.chatMode || null),
          executionMode,
          message: ctx.params.message,
        });
        let executionStateGraph = createExecutionStateGraph({
          sessionId,
          chatMode: normalizeChatMode(ctx.params.chatMode || ctx.meta?.chatMode || null),
          executionMode,
          message: ctx.params.message,
        });
        let turnGraph = createTurnGraph({
          sessionId,
          chatMode: normalizeChatMode(ctx.params.chatMode || ctx.meta?.chatMode || null),
          executionMode,
          message: ctx.params.message,
        });

        // v0.57.3 — per-turn work log accumulator (local closure, never stored on this)
        const turnWorkLog = createTurnWorkLog();

        // jobId parameter passed from startJob wrapper
        const jobStore = jobId ? require('../src/job-store') : null;

        // Log chat mode classification start
        if (jobStore) {
          jobStore.appendLog(jobId, 'chat_init', 5, 'Personal Agent initialized', {
            tenantId,
            userId,
            sessionId,
            executionMode,
          });
        }

        const session = await this.loadSession(ctx, tenantId, sessionId, userId, {
          createIfMissing: true,
        });
        turnGraph = addNode(turnGraph, {
          id: 'ctx:session',
          type: 'context',
          label: 'Session context',
          data: {
            hasPersistedSession: Boolean(session.updatedAt),
            historyCount: Array.isArray(session?.l3?.history) ? session.l3.history.length : 0,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'msg:user',
          to: 'ctx:session',
          type: 'contextualized_by',
        });
        stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.SESSION_LOADED, {
          hasPersistedSession: Boolean(session.updatedAt),
          previousStateMachine: session?.l3?.stateMachine?.currentState || null,
        });
        executionStateGraph = advanceExecutionStateGraph(
          executionStateGraph,
          'execution_mode_resolved',
          {
            executionMode,
            previousChatMode: session?.l3?.chatMode || null,
          }
        );
        session.planStack = Array.isArray(session?.l3?.planStack) ? session.l3.planStack : [];
        session.resolvedParams =
          session?.l3?.resolvedParams && typeof session.l3.resolvedParams === 'object'
            ? session.l3.resolvedParams
            : {};
        session.resolvedCapabilities = Array.isArray(session?.l3?.resolvedCapabilities)
          ? session.l3.resolvedCapabilities
          : [];
        if (!session.planStack) session.planStack = [];
        if (!session.resolvedParams) session.resolvedParams = {};
        if (!session.resolvedCapabilities) session.resolvedCapabilities = [];
        if (!session.chatMode) session.chatMode = CHAT_MODES.CONSULTATION;
        if (!session.l3.chatMode) session.l3.chatMode = session.chatMode;
        if (!session.l3.chatModeSource) session.l3.chatModeSource = null;
        if (!session.l3.lastClassification) session.l3.lastClassification = null;

        // A) Strategic milestone: session loaded
        if (jobStore) {
          jobStore.appendLog(jobId, 'session_loaded', 10, 'Session loaded successfully', {
            isNewSession: !session.createdAt || session.createdAt === session.updatedAt,
            historyLength: Array.isArray(session.l3?.history) ? session.l3.history.length : 0,
          });
        }

        const fileProcessing = this.processFileAttachments(
          session,
          Array.isArray(ctx.params.fileAttachments) ? ctx.params.fileAttachments : []
        );
        const inhouseData = this.buildInhouseDataFromAttachments(
          Array.isArray(ctx.params.fileAttachments) ? ctx.params.fileAttachments : [],
          fileProcessing
        );
        const userMessage = {
          role: 'user',
          text: ctx.params.message,
          ts: new Date().toISOString(),
        };

        // ── Context mutation: append vs. replace ──────────────────────────
        // If incoming knownContext changes a decisive parameter (location,
        // operator, project), replace the stored resolvedParams to prevent
        // old-scenario context bleeding into the new turn.
        const previousBootstrapContext = sanitizeBootstrapContext(
          session?.l3?.bootstrapContext || null
        );
        const previousSessionKnowledgeScopeDataPoints = sanitizeScopedDatapoints(
          session?.l3?.knowledgeScopeDataPoints || []
        );
        const previousUserKnowledgeScopeDataPoints = sanitizeScopedDatapoints(
          session?.l2?.userProfile?.knowledgeScopeDataPoints || []
        );
        const rawKnownContext =
          ctx.params.knownContext && typeof ctx.params.knownContext === 'object'
            ? ctx.params.knownContext
            : {};
        const contextMutation = resolveContextMutation(session.resolvedParams, rawKnownContext);
        if (contextMutation.mode === 'replace') {
          session.resolvedParams = contextMutation.mergedParams;
          if (jobStore) {
            jobStore.appendLog(jobId, 'context_mutation', 12, 'Context replaced', {
              replacedKeys: contextMutation.replacedKeys,
            });
          }
        } else if (Object.keys(rawKnownContext).length > 0) {
          session.resolvedParams = contextMutation.mergedParams;
        }
        const knownContext = { ...rawKnownContext };
        const bootstrapContext = this.resolveBootstrapContext({
          session,
          knownContext: rawKnownContext,
        });
        session.l3.bootstrapContext = bootstrapContext;

        // v0.57.3 — workLog callsite 2: onboarding gap detected
        if (bootstrapContext?.status === 'unknown' || bootstrapContext?.status === 'partial') {
          const _wlMissingField =
            bootstrapContext.organizationType === 'unknown' ? 'organizationType' : 'knowledgeScope';
          turnWorkLog.addEntry({
            action: WORK_LOG_ACTIONS.ONBOARDING_GAP_DETECTED,
            label: `Missing: ${_wlMissingField}`,
            metadata: {
              missingField: _wlMissingField,
              source: bootstrapContext.source || 'knownContext',
              status: bootstrapContext.status,
              severity: 'warning',
            },
          });
        }

        const scopedKnowledgeState = this.resolveScopedKnowledgeState({
          session,
          knownContext: rawKnownContext,
        });
        session.l3.knowledgeScopeDataPoints = scopedKnowledgeState.sessionDataPoints;
        session.l2.userProfile = {
          ...(session.l2?.userProfile || {}),
          knowledgeScopeDataPoints: scopedKnowledgeState.userDataPoints,
        };
        this.emitBootstrapWorkOutLoudIfChanged(ctx, {
          previousBootstrapContext,
          nextBootstrapContext: bootstrapContext,
          contextMutationMode: contextMutation.mode,
        });
        this.emitScopedKnowledgeWorkOutLoud(ctx, {
          previousSessionDataPoints: previousSessionKnowledgeScopeDataPoints,
          previousUserDataPoints: previousUserKnowledgeScopeDataPoints,
          nextSessionDataPoints: scopedKnowledgeState.sessionDataPoints,
          nextUserDataPoints: scopedKnowledgeState.userDataPoints,
          knownContext: rawKnownContext,
        });
        // ─────────────────────────────────────────────────────────────────

        const sessionHitlGate = await this.resolveSessionHitlResumeGate(ctx, {
          session,
          knownContext: rawKnownContext,
          message: ctx.params.message,
        });

        if (
          sessionHitlGate?.mode === 'blocked' ||
          sessionHitlGate?.mode === 'terminal' ||
          sessionHitlGate?.mode === 'approved-missing-plan'
        ) {
          const isDiagnosticMissingPlan = sessionHitlGate?.mode === 'approved-missing-plan';
          const isBlockedHitl = sessionHitlGate?.mode === 'blocked';
          const forcedChatMode =
            normalizeChatMode(
              ctx.params.chatMode || ctx.meta?.chatMode || ctx.meta?.$params?.chatMode
            ) || CHAT_MODES.EXECUTION;

          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED,
            {
              activeDomains: detectRequestedDomains(ctx.params.message),
              knowledgeDomain: null,
            }
          );
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
            {
              intent: 'hitl_resume_gate',
              capability: 'personal-agent.hitl_resume_gate',
            }
          );
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED,
            {
              chatMode: forcedChatMode,
              source: 'session_hitl_gate',
              executionMode,
            }
          );
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.EXECUTION_PLANNED,
            {
              primaryIntent: 'critical_step_hitl_resume_gate',
              stepCount: 0,
            }
          );
          stateMachine = transitionStateMachine(
            stateMachine,
            isDiagnosticMissingPlan
              ? PERSONAL_AGENT_STATES.FAILED
              : isBlockedHitl
                ? PERSONAL_AGENT_STATES.HITL_BLOCKED
                : PERSONAL_AGENT_STATES.COMPLETED,
            {
              reasonCode: isDiagnosticMissingPlan
                ? 'approved_hitl_resume_missing_plan'
                : isBlockedHitl
                  ? 'MANDATORY_HITL_APPROVAL'
                  : 'HITL_TERMINAL_DECISION',
              blockedAction: sessionHitlGate?.stopPoint?.blockedAction || null,
              hitlItemId: sessionHitlGate?.stopPoint?.hitlItemId || null,
              hitlStatus: sessionHitlGate?.status || null,
            }
          );

          const stackResult = buildContextStack({
            systemPrompt: this.settings.systemPrompt,
            tenantFacts: session.l1?.tenantFacts || [],
            userProfile: session.l2?.userProfile || {},
            sessionHistory: [...(session.l3?.history || []), userMessage],
            fileAttachments: session.l3?.fileAttachments || [],
            bootstrapContext,
            knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
            toolContext: ctx.params.toolContext || null,
            maxContextTokens: this.settings.maxContextTokens,
          });
          const finalized = synthesizeAndPurgeLayer4(
            stackResult.stack,
            sessionHitlGate.reply || ''
          );

          const execution = {
            status: isDiagnosticMissingPlan
              ? 'failed'
              : isBlockedHitl
                ? 'awaiting-onboarding'
                : 'partial',
            plan: null,
            steps: [],
            stopPoint: sessionHitlGate.stopPoint || null,
            meta: executionTrace.summarize({
              toolCalls: toolCallTracker.summarize().calls,
              chatModeSource: 'session_hitl_gate',
            }),
          };

          const responseStrategy = this.buildResponseStrategy({
            message: ctx.params.message,
            execution,
            knownContext,
            missingParams: [],
            existingAssumptions: Array.isArray(session.l3?.assumptions)
              ? session.l3.assumptions
              : [],
          });

          turnGraph = addNode(turnGraph, {
            id: 'knowledge:orientation',
            type: 'knowledge',
            label: 'Knowledge orientation',
            data: {
              domainHint: null,
              styleHint: null,
              activeDomains: detectRequestedDomains(ctx.params.message),
              contextMutationMode: contextMutation.mode,
              contextReplacedKeys:
                contextMutation.replacedKeys.length > 0 ? contextMutation.replacedKeys : null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'msg:user',
            to: 'knowledge:orientation',
            type: 'oriented_by',
          });

          turnGraph = addNode(turnGraph, {
            id: 'broker:recommendation',
            type: 'broker',
            label: 'Capability recommendation',
            data: {
              intent: 'hitl_resume_gate',
              capability: 'personal-agent.hitl_resume_gate',
              semanticWorkflowType: null,
              semanticConfidence: null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'knowledge:orientation',
            to: 'broker:recommendation',
            type: 'routes_to',
          });
          turnGraph = addNode(turnGraph, {
            id: 'chat:mode',
            type: 'decision',
            label: 'Chat mode resolved',
            data: {
              mode: forcedChatMode,
              source: 'session_hitl_gate',
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'broker:recommendation',
            to: 'chat:mode',
            type: 'decides',
          });
          turnGraph = finalizeTurnGraph(turnGraph, {
            status: sessionHitlGate.mode === 'blocked' ? 'hitl_blocked' : 'hitl_terminal',
          });

          const persisted = buildPersistableSessionState({
            id: sessionId,
            tenantId,
            userId,
            l1: finalized.stack.l1,
            l2: finalized.stack.l2,
            l3: {
              ...finalized.stack.l3,
              chatMode: forcedChatMode,
              chatModeSource: 'session_hitl_gate',
              executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
              stateMachine: summarizeStateMachine(stateMachine),
              turnGraph: summarizeTurnGraph(turnGraph),
              responseStrategy,
              planStack: Array.isArray(session.planStack) ? session.planStack : [],
              resolvedParams:
                session.resolvedParams && typeof session.resolvedParams === 'object'
                  ? session.resolvedParams
                  : {},
              resolvedCapabilities: Array.isArray(session.resolvedCapabilities)
                ? session.resolvedCapabilities
                : [],
              lastCompletedPlan:
                session.l3?.lastCompletedPlan && typeof session.l3.lastCompletedPlan === 'object'
                  ? session.l3.lastCompletedPlan
                  : null,
              stopPoint:
                sessionHitlGate.stopPoint && typeof sessionHitlGate.stopPoint === 'object'
                  ? sessionHitlGate.stopPoint
                  : null,
              criticalStepCheckpoints:
                session.l3?.criticalStepCheckpoints &&
                typeof session.l3.criticalStepCheckpoints === 'object'
                  ? session.l3.criticalStepCheckpoints
                  : {},
            },
            createdAt: session.createdAt,
          });

          assertNoL4RawInPersistedState(persisted);
          await this.persistSession(ctx, tenantId, sessionId, persisted);

          const quality = this.buildQualitySummary({
            evidencePlan: null,
            execution,
            consultation: null,
          });
          // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
          // v0.56.3 — ZNP context signals
          const _hitlItemId1 =
            session?.l3?.stopPoint?.hitlItemId ?? ctx.params?.knownContext?.hitlItemId ?? null;
          const _handoffCtx1 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId1);
          const _znpCtx1 = buildZnpContextSnapshot(ctx, session, null);
          const personaResolution = await this.resolvePersonaForTrace(ctx, {
            tenantId,
            sessionId,
            sourceService: 'personal-agent',
            sourceAction: 'chat',
            workflowType: null,
            domainIntent: null,
            ..._znpCtx1,
            handoffPersonaId: _handoffCtx1.handoffPersonaId,
            hitlItemId: _hitlItemId1,
            workflowCompletionState: _handoffCtx1.workflowCompletionState,
          });

          // v0.57.3 — workLog callsite 3: persona resolved
          if (personaResolution?.roleLabel) {
            turnWorkLog.addEntry({
              action: WORK_LOG_ACTIONS.PERSONA_RESOLVED,
              label: getSafePersonaLabel(personaResolution.roleLabel),
              metadata: {
                roleLabel: personaResolution.roleLabel,
                source: personaResolution.source || 'session',
                updateReason: 'role_consistency_check',
              },
            });
          }

          const agentTrace = this.buildAgentTrace({
            routing: {
              source: 'session-hitl-gate',
              routeKey: null,
              routeLabel: 'hitl_resume_gate',
              primaryIntent: 'critical_step_hitl_resume_gate',
              secondaryIntents: [],
              requestedDomains: detectRequestedDomains(ctx.params.message),
              unsupportedDomains: [],
              warnings: [],
              chatMode: forcedChatMode,
            },
            plan: null,
            execution,
            evidencePlan: null,
            consultation: null,
            responseStrategy,
            stateMachine,
            executionStateGraph,
            turnGraph,
            routingDecision: {
              target: 'execution_node',
              label: 'session-hitl-gate',
              confidence: 1,
              determinism: 'high',
            },
            personaResolution,
            bootstrapContext,
            knowledgeScope: [
              ...(session.l3?.knowledgeScopeDataPoints || []),
              ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
            ],
            workLog: turnWorkLog.toArray(),
          });

          return {
            success: true,
            status: execution.status,
            sessionId,
            executionMode,
            chatMode: forcedChatMode,
            reply: sessionHitlGate.reply,
            execution,
            plan: {
              steps: [],
              onboardingHints: [],
            },
            quality,
            agentTrace,
            stateMachine: summarizeStateMachine(stateMachine),
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            turnGraph: summarizeTurnGraph(turnGraph),
            layer4Purged: finalized.layer4Purged,
            l3Compressed: finalized.stack.l3?.compressed || false,
            historyCount: Array.isArray(finalized.stack.l3?.history)
              ? finalized.stack.l3.history.length
              : 0,
            contextUsage: stackResult.usage,
            fileProcessing,
          };
        }

        // ── Approved HITL Resume: inject stored plan and enrich knownContext ──
        const approvedHitlResumePlan =
          sessionHitlGate?.mode === 'approved' ? sessionHitlGate.planSnapshot || null : null;
        const hasApprovedHitlResumePlan = Boolean(
          approvedHitlResumePlan?.steps && approvedHitlResumePlan.steps.length > 0
        );
        if (hasApprovedHitlResumePlan) {
          if (!session.l3 || typeof session.l3 !== 'object') {
            session.l3 = {};
          }
          session.l3._approvedHitlResume = approvedHitlResumePlan;
          if (!knownContext.hitlItemId && sessionHitlGate.hitlItemId) {
            knownContext.hitlItemId = sessionHitlGate.hitlItemId;
          }
        }
        // ───────────────────────────────────────────────────────────────────────

        let knowledgeContext = hasApprovedHitlResumePlan
          ? { domainHint: null, styleHint: null }
          : await this.queryKnowledgeOrientation(ctx, {
              message: ctx.params.message,
              activeDomains: detectRequestedDomains(ctx.params.message),
            });
        turnGraph = addNode(turnGraph, {
          id: 'knowledge:orientation',
          type: 'knowledge',
          label: 'Knowledge orientation',
          data: {
            domainHint: knowledgeContext?.domainHint || null,
            styleHint: knowledgeContext?.styleHint || null,
            activeDomains: detectRequestedDomains(ctx.params.message),
            contextMutationMode: contextMutation.mode,
            contextReplacedKeys:
              contextMutation.replacedKeys.length > 0 ? contextMutation.replacedKeys : null,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'msg:user',
          to: 'knowledge:orientation',
          type: 'oriented_by',
        });
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED,
          {
            activeDomains: detectRequestedDomains(ctx.params.message),
            knowledgeDomain: knowledgeContext?.domainHint || null,
          }
        );
        const brokerKnownContext = this.attachKnowledgeHintsToKnownContext(
          knownContext,
          knowledgeContext
        );

        let routing = null;
        let plan = null;
        let status = null;
        let brokerRecommendationRaw = null;
        let semanticClassification = null;
        let brokerRecommendation = null;

        if (!hasApprovedHitlResumePlan) {
          brokerRecommendationRaw = await this.getBrokerRecommendation(
            ctx,
            ctx.params.message,
            brokerKnownContext,
            session.resolvedParams,
            session.resolvedCapabilities
          );

          semanticClassification = await this.classifyConsultationIntentHybrid(
            ctx,
            ctx.params.message,
            brokerKnownContext,
            { executionTrace }
          );

          brokerRecommendation = this.applyConsultationGuardrailsToBroker(
            brokerRecommendationRaw,
            semanticClassification
          );
          turnGraph = addNode(turnGraph, {
            id: 'broker:recommendation',
            type: 'broker',
            label: 'Capability recommendation',
            data: {
              intent: brokerRecommendation?.intent || null,
              capability: brokerRecommendation?.capability || null,
              semanticWorkflowType: semanticClassification?.workflowType || null,
              semanticConfidence:
                typeof semanticClassification?.confidence === 'number'
                  ? semanticClassification.confidence
                  : null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'knowledge:orientation',
            to: 'broker:recommendation',
            type: 'routes_to',
          });
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
            {
              intent: brokerRecommendation?.intent || null,
              capability: brokerRecommendation?.capability || null,
            }
          );
          executionTrace.recordBrokerDecision({
            intent: brokerRecommendation?.intent || null,
            capability: brokerRecommendation?.capability || null,
            confidence:
              typeof brokerRecommendation?.confidence === 'number'
                ? brokerRecommendation.confidence
                : null,
            scoringBreakdown: brokerRecommendation?.scoringBreakdown || null,
            source: brokerRecommendation?.summary || 'capability-broker',
          });

          // A) Strategic milestone: broker ready
          if (jobStore) {
            jobStore.appendLog(jobId, 'broker_ready', 30, 'Broker recommendation ready', {
              intent: brokerRecommendation?.intent || null,
              capability: brokerRecommendation?.capability || null,
            });
          }
        } else {
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
            {
              intent: 'approved_hitl_resume',
              capability: 'personal-agent.hitl_resume',
            }
          );
          routing = {
            primaryIntent: hasApprovedHitlResumePlan
              ? approvedHitlResumePlan?.primaryIntent || 'approved_hitl_resume'
              : null,
            requestedDomains: Array.isArray(approvedHitlResumePlan?.requestedDomains)
              ? approvedHitlResumePlan.requestedDomains
              : [],
          };
        }

        // ═══ ChatMode-Auflösung (4-Ebenen-Fallback) ═══

        // Ebene 1: Expliziter API-Parameter
        const rawRequestedChatMode =
          ctx.params.chatMode || ctx.meta?.chatMode || ctx.meta?.$params?.chatMode;
        let effectiveChatMode = normalizeChatMode(rawRequestedChatMode);
        let chatModeSource = 'api';
        let chatModeConfidence = rawRequestedChatMode ? 1 : null;

        if (hasApprovedHitlResumePlan) {
          effectiveChatMode = CHAT_MODES.EXECUTION;
          chatModeSource = 'approved_hitl_resume';
          chatModeConfidence = 1;
        }

        // Cache-Prüfung: identische Nachricht bereits klassifiziert?
        const msgHash = createMessageFingerprint(ctx.params.message || '');
        if (
          !effectiveChatMode &&
          session.l3?.lastClassification?.fingerprint === msgHash &&
          normalizeChatMode(session.l3?.lastClassification?.chatMode)
        ) {
          effectiveChatMode = session.l3.lastClassification.chatMode;
          chatModeSource = 'cached';
          chatModeConfidence =
            typeof session.l3?.lastClassification?.confidence === 'number'
              ? session.l3.lastClassification.confidence
              : 0.95;
          executionStateGraph = advanceExecutionStateGraph(
            executionStateGraph,
            'chat_mode_cached',
            {
              chatMode: effectiveChatMode,
              source: chatModeSource,
              confidence: chatModeConfidence,
            }
          );
          this.logger?.info(`[chatMode] Cache-Hit: ${effectiveChatMode}`);
        }

        if (effectiveChatMode && rawRequestedChatMode && !hasApprovedHitlResumePlan) {
          executionStateGraph = advanceExecutionStateGraph(
            executionStateGraph,
            'api_params_validated',
            {
              chatMode: effectiveChatMode,
              source: chatModeSource,
              confidence: 1,
            }
          );
        }

        // Ebene 2: LLM-Klassifikator
        if (!effectiveChatMode) {
          const llmClassification = await this.classifyChatModeLLM(
            ctx,
            ctx.params.message,
            session,
            { executionTrace }
          );
          if (llmClassification.chatMode && llmClassification.confidence >= 0.7) {
            effectiveChatMode = llmClassification.chatMode;
            chatModeSource = 'llm';
            chatModeConfidence = llmClassification.confidence;
            executionStateGraph = advanceExecutionStateGraph(
              executionStateGraph,
              'chat_mode_classified',
              {
                chatMode: effectiveChatMode,
                source: chatModeSource,
                confidence: llmClassification.confidence,
                reasoning: llmClassification.reasoning,
              }
            );
            this.logger?.info(
              `[chatMode] LLM-Klassifikation: ${effectiveChatMode} (conf=${llmClassification.confidence.toFixed(2)}): ${llmClassification.reasoning}`
            );
          }
        }

        // Ebene 3: Heuristik-Fallback
        if (!effectiveChatMode) {
          effectiveChatMode = detectChatMode(ctx.params.message, brokerRecommendation, session);
          chatModeSource = 'heuristic';
          chatModeConfidence = Number(brokerRecommendation?.confidence || 0.55);
          executionStateGraph = advanceExecutionStateGraph(
            executionStateGraph,
            'chat_mode_fallback',
            {
              chatMode: effectiveChatMode,
              source: chatModeSource,
              confidence: chatModeConfidence,
            }
          );
          this.logger?.info(`[chatMode] Heuristik-Fallback: ${effectiveChatMode}`);
        }

        // Ebene 4: Hard-Default
        if (!effectiveChatMode) {
          effectiveChatMode = CHAT_MODES.CONSULTATION;
          chatModeSource = 'default';
          chatModeConfidence = 0.5;
          executionStateGraph = advanceExecutionStateGraph(
            executionStateGraph,
            'chat_mode_fallback',
            {
              chatMode: effectiveChatMode,
              source: chatModeSource,
              confidence: chatModeConfidence,
            }
          );
        }

        executionStateGraph = advanceExecutionStateGraph(executionStateGraph, 'ready_for_routing', {
          chatMode: effectiveChatMode,
          source: chatModeSource,
          executionMode,
        });
        executionTrace.recordStateTransition({
          family: 'chat_mode',
          from: session?.l3?.chatMode || null,
          to: effectiveChatMode,
          reason: chatModeSource,
          metadata: {
            confidence: chatModeConfidence,
          },
        });

        this.logger?.info(
          `[chatMode] Request: ${rawRequestedChatMode || 'null'}, Effective: ${effectiveChatMode}, Source: ${chatModeSource}`
        );

        // Log chat mode classification result
        if (jobStore) {
          jobStore.appendLog(
            jobId,
            'chat_mode_classified',
            15,
            `chatMode=${effectiveChatMode}, source=${chatModeSource}`,
            {
              chatMode: effectiveChatMode,
              chatModeSource,
              confidence: null,
            }
          );
        }

        session.chatMode = effectiveChatMode;
        session.l3.chatMode = effectiveChatMode;
        session.l3.chatModeSource = chatModeSource;
        session.l3.lastClassification = {
          messageHash: msgHash,
          fingerprint: msgHash,
          chatMode: effectiveChatMode,
          source: chatModeSource,
          confidence: chatModeConfidence,
          timestamp: new Date().toISOString(),
        };
        session.l3.executionStateGraph = summarizeExecutionStateGraph(executionStateGraph);
        turnGraph = addNode(turnGraph, {
          id: 'chat:mode',
          type: 'decision',
          label: 'Chat mode resolved',
          data: {
            mode: effectiveChatMode,
            source: chatModeSource,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'broker:recommendation',
          to: 'chat:mode',
          type: 'decides',
        });
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED,
          {
            chatMode: effectiveChatMode,
            source: chatModeSource,
            executionMode,
          }
        );

        const forceReceiptRequested =
          typeof ctx.params.forceReceipt === 'string' && ctx.params.forceReceipt.trim().length > 0;
        const receiptSelectionDiagnosticsRequested =
          ctx.params.explainReceiptSelection === true ||
          forceReceiptRequested ||
          isConsultationDebugEnabled(rawKnownContext);

        if (forceReceiptRequested && ctx.params.disableReceiptSelection === true) {
          throw new MoleculerClientError(
            'forceReceipt cannot be combined with disableReceiptSelection=true.',
            422,
            'RECEIPT_FORCE_CONFLICTS_WITH_DISABLE'
          );
        }

        // ── Location Resolution: hydrate brokerKnownContext from current message + history ──
        // This ensures that "74889 Sinsheim" mentioned inline in the user message reaches
        // the consultation bridge as structured postalCode/municipality fields, even when the
        // client does not send a pre-populated knownContext object.

        // 1. Extract location from the current turn message
        const currentMsgLocation = resolveLocationFromText(ctx.params.message, brokerKnownContext);
        const currentMsgLocationPatch = buildLocationContextPatch(currentMsgLocation);
        for (const [key, value] of Object.entries(currentMsgLocationPatch)) {
          if (brokerKnownContext[key] == null && value != null) {
            brokerKnownContext[key] = value;
          }
        }

        // 2. Hydrate from session history (multi-turn: postalCode from a prior turn)
        const multiTurnHints = this.extractMultiTurnContextHints(session);
        for (const [key, value] of Object.entries(multiTurnHints)) {
          if (brokerKnownContext[key] == null && value != null) {
            brokerKnownContext[key] = value;
          }
        }

        // 3. Store resolution trace for agentTrace / dataLineage (best-effort, non-blocking)
        if (currentMsgLocation.evidence.length > 0 || currentMsgLocation.municipalityResolved) {
          brokerKnownContext._locationResolutionTrace = buildLocationResolutionTrace(
            currentMsgLocation
          );
        }

        const preferredReceiptsForTurn = this.buildPreferredReceiptsForTurn(
          ctx.params.message,
          brokerKnownContext,
          ctx.params.preferredReceipts,
          session
        );

        const receiptSelectionResult = await this.selectRuntimeReceipt(ctx, {
          message: ctx.params.message,
          context: {
            knownContext: brokerKnownContext,
            semanticClassification,
            brokerRecommendation,
            effectiveChatMode,
            sessionId,
          },
          input: {
            message: ctx.params.message,
            knownContext: brokerKnownContext,
            workflowType: semanticClassification?.workflowType || null,
            domainIntent:
              semanticClassification?.domainIntent || brokerRecommendation?.intent || null,
          },
          forceReceipt: ctx.params.forceReceipt,
          preferredReceipts: preferredReceiptsForTurn,
          allowDraftReceipts: ctx.params.allowDraftReceipts === true,
          explainReceiptSelection: receiptSelectionDiagnosticsRequested,
          disableReceiptSelection: ctx.params.disableReceiptSelection === true,
        });

        let receiptSelectionMetadata = this.buildReceiptSelectionMetadata(receiptSelectionResult, {
          includeDiagnostics: receiptSelectionDiagnosticsRequested,
        });

        if (
          Array.isArray(receiptSelectionResult?.evaluation?.plannedToolCalls) &&
          receiptSelectionResult.execution &&
          typeof receiptSelectionResult.execution === 'object'
        ) {
          receiptSelectionResult.execution.plannedToolCalls =
            receiptSelectionResult.evaluation.plannedToolCalls.map((step) => ({
              step: Number(step?.step || 0) || null,
              action: step?.selectedAction || step?.action || null,
              requestedAction: step?.action || null,
              params: step?.params || {},
              status: step?.status || null,
            }));
        }

        if (forceReceiptRequested && receiptSelectionResult?.selected !== true) {
          throw new MoleculerClientError(
            `Forced receipt '${ctx.params.forceReceipt}' was not selected for execution.`,
            422,
            'RECEIPT_FORCED_NOT_SELECTED',
            {
              forceReceipt: ctx.params.forceReceipt,
              selectionMode: receiptSelectionResult?.mode || 'none',
            }
          );
        }

        const receiptSelectionExecutable =
          receiptSelectionResult?.selected === true &&
          (receiptSelectionResult?.evaluation
            ? receiptSelectionResult.evaluation.executable === true
            : true);

        if (forceReceiptRequested && !receiptSelectionExecutable) {
          throw new MoleculerClientError(
            `Forced receipt '${ctx.params.forceReceipt}' is not executable for the current context.`,
            422,
            'RECEIPT_FORCED_NOT_EXECUTABLE',
            {
              forceReceipt: ctx.params.forceReceipt,
              diagnostics: receiptSelectionResult?.diagnostics || null,
            }
          );
        }

        const shouldPreferReceiptExecution =
          receiptSelectionExecutable && ctx.params.disableReceiptSelection !== true;

        const routingDecision = decideRoutingTarget({
          effectiveChatMode,
          brokerRecommendation,
          message: ctx.params.message,
          chatModeSource,
        });
        executionTrace.recordStateTransition({
          family: 'routing',
          from: 'chat_mode_resolved',
          to: routingDecision.target,
          reason: routingDecision.label,
          metadata: {
            confidence: routingDecision.confidence,
            determinism: routingDecision.determinism,
            gapReason: routingDecision?.gap?.reason || null,
          },
        });

        // v0.57.3 — workLog callsite 1: routing classified
        turnWorkLog.addEntry({
          action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
          label: `Classified as ${brokerRecommendation?.intent || routingDecision.target || 'unknown'} inquiry`,
          metadata: {
            targetDomain: brokerRecommendation?.domain || null,
            primaryIntent: brokerRecommendation?.intent || null,
            reasonCode:
              routingDecision.target && routingDecision.target !== 'mark_unknown_execution_gap'
                ? 'INTENT_SIGNAL_DETECTED'
                : 'DEFAULT_ROUTE',
          },
        });

        if (
          routingDecision.target === 'mark_unknown_execution_gap' &&
          String(
            process.env.PERSONAL_AGENT_ENABLE_ROUTING_GAP_SHORT_CIRCUIT || 'false'
          ).toLowerCase() === 'true'
        ) {
          const responsePolicyContract = this.buildResponsePolicyContract({
            message: ctx.params.message,
            workflowType: semanticClassification?.workflowType || null,
            domainIntent:
              semanticClassification?.domainIntent || brokerRecommendation?.intent || null,
            knownContext: brokerKnownContext,
            receiptKnowledgeEvidence: receiptSelectionResult?.knowledgeEvidence || null,
            verifiedFacts: [],
          });
          const gapResponse = buildExecutionGapResponse({
            routingDecision,
            brokerRecommendation,
            message: ctx.params.message,
          });
          const stackResult = buildContextStack({
            systemPrompt: this.settings.systemPrompt,
            tenantFacts: session.l1?.tenantFacts || [],
            userProfile: session.l2?.userProfile || {},
            sessionHistory: [...(session.l3?.history || []), userMessage],
            fileAttachments: session.l3?.fileAttachments || [],
            bootstrapContext,
            knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
            toolContext: ctx.params.toolContext || null,
            maxContextTokens: this.settings.maxContextTokens,
          });
          const reply = [
            'Ich habe aktuell noch keinen belastbaren deterministischen Ausführungspfad für diese Anfrage.',
            gapResponse?.suggestions?.[0] || null,
            gapResponse?.suggestions?.[1] || null,
          ]
            .filter(Boolean)
            .join(' ');
          const finalized = synthesizeAndPurgeLayer4(stackResult.stack, reply);
          const execution = {
            status: 'partial',
            completedSteps: 0,
            steps: [],
            stopPoint: gapResponse,
            meta: executionTrace.summarize({
              toolCalls: toolCallTracker.summarize().calls,
              chatModeSource,
            }),
          };
          const responseStrategy = this.buildResponseStrategy({
            message: ctx.params.message,
            knowledgeContext,
            knownContext,
            existingAssumptions: Array.isArray(session.l3?.assumptions)
              ? session.l3.assumptions
              : [],
            execution,
          });
          turnGraph = addNode(turnGraph, {
            id: 'response:strategy',
            type: 'strategy',
            label: 'Response strategy',
            data: {
              audienceType: responseStrategy.audience || null,
              epistemicState: responseStrategy.epistemicState || null,
              abstractionLevel: responseStrategy.abstractionLevel || null,
              nextDialogueMove: responseStrategy.nextMove || null,
              decisionRole: responseStrategy.decisionRole || null,
              confidence:
                typeof responseStrategy.confidence === 'number'
                  ? responseStrategy.confidence
                  : null,
              assumptionCount: Array.isArray(responseStrategy.assumptions)
                ? responseStrategy.assumptions.length
                : 0,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'chat:mode',
            to: 'response:strategy',
            type: 'shapes',
          });
          const persisted = buildPersistableSessionState({
            id: sessionId,
            tenantId,
            userId,
            l1: finalized.stack.l1,
            l2: finalized.stack.l2,
            l3: {
              ...finalized.stack.l3,
              chatMode: effectiveChatMode,
              chatModeSource,
              lastClassification: session.l3.lastClassification,
              executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
              stateMachine: summarizeStateMachine(stateMachine),
              turnGraph: summarizeTurnGraph(turnGraph),
              responseStrategy,
            },
            createdAt: session.createdAt,
          });
          await this.persistSession(ctx, tenantId, sessionId, persisted);
          // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
          // v0.56.3 — ZNP context signals
          const _hitlItemId2 = ctx.params?.knownContext?.hitlItemId ?? null;
          const _handoffCtx2 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId2);
          const _znpCtx2 = buildZnpContextSnapshot(ctx, session, semanticClassification);
          const personaResolution = await this.resolvePersonaForTrace(ctx, {
            tenantId,
            sessionId,
            sourceService: 'personal-agent',
            sourceAction: 'chat',
            workflowType: semanticClassification?.workflowType ?? null,
            domainIntent:
              semanticClassification?.domainIntent ?? brokerRecommendation?.intent ?? null,
            ..._znpCtx2,
            handoffPersonaId: _handoffCtx2.handoffPersonaId,
            hitlItemId: _hitlItemId2,
            workflowCompletionState: _handoffCtx2.workflowCompletionState,
          });

          // v0.57.3 — workLog callsite 3: persona resolved
          if (personaResolution?.roleLabel) {
            turnWorkLog.addEntry({
              action: WORK_LOG_ACTIONS.PERSONA_RESOLVED,
              label: getSafePersonaLabel(personaResolution.roleLabel),
              metadata: {
                roleLabel: personaResolution.roleLabel,
                source: personaResolution.source || 'session',
                updateReason: 'role_consistency_check',
              },
            });
          }

          return {
            success: true,
            sessionId,
            executionMode,
            chatMode: effectiveChatMode,
            reply,
            workflowType: responsePolicyContract.workflowType,
            domainIntent: responsePolicyContract.domainIntent,
            evidenceStatus: responsePolicyContract.evidenceStatus,
            missingEvidence: responsePolicyContract.missingEvidence,
            nextVerificationSteps: responsePolicyContract.nextVerificationSteps,
            guardrailCorrections: [],
            layer4Purged: finalized.layer4Purged,
            l3Compressed: finalized.stack.l3?.compressed || false,
            historyCount: Array.isArray(finalized.stack.l3?.history)
              ? finalized.stack.l3.history.length
              : 0,
            routing: {
              source: 'routing-graph',
              routeKey: null,
              routeLabel: routingDecision.label,
              primaryIntent: brokerRecommendation?.intent || null,
              secondaryIntents: [],
              requestedDomains: detectRequestedDomains(ctx.params.message),
              unsupportedDomains: [],
              warnings: [gapResponse.gapReason],
            },
            plan: null,
            execution,
            stateMachine: summarizeStateMachine(stateMachine),
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            turnGraph: summarizeTurnGraph(turnGraph),
            responseStrategy,
            agentTrace: this.buildAgentTrace({
              routing: null,
              plan: null,
              execution,
              evidencePlan: null,
              consultation: null,
              responseStrategy,
              stateMachine,
              executionStateGraph,
              turnGraph,
              routingDecision,
              personaResolution,
              bootstrapContext,
              knowledgeScope: [
                ...(session.l3?.knowledgeScopeDataPoints || []),
                ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
              ],
              workLog: turnWorkLog.toArray(),
            }),
            ...(receiptSelectionMetadata ? { metadata: receiptSelectionMetadata } : {}),
          };
        }

        if (
          (routingDecision.target === 'consultation_node' ||
            routingDecision.target === 'consultation_intro') &&
          !shouldPreferReceiptExecution
        ) {
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE,
            {
              intent: brokerRecommendation?.intent || 'consultation',
            }
          );
          if (jobStore) {
            jobStore.appendLog(
              jobId,
              'consultation_mode_entered',
              25,
              'Agentic consultation loop starting...',
              {
                chatMode: CHAT_MODES.CONSULTATION,
              }
            );
          }

          const consultationResponseStrategy = this.buildResponseStrategy({
            message: ctx.params.message,
            knowledgeContext,
            knownContext: brokerKnownContext,
            existingAssumptions: Array.isArray(session.l3?.assumptions)
              ? session.l3.assumptions
              : [],
          });
          const recentHistoryWindow = this.buildConsultationRecentHistoryWindow(session);

          // Resolve blueprint policy for this consultation turn (stickiness + synthesis framing)
          const _consultationTurnIndex = Array.isArray(session.l3?.history)
            ? session.l3.history.length
            : 0;
          let _activeConsultationRoutingPolicy = null;
          let _activeConsultationSynthesisPolicy = null;
          let _activeConsultationStickinessStart = null;

          // Enrich detection context with broker/semantic signals so that
          // single-signal messages (e.g. "Bürgermeister von 74889 Sinsheim")
          // reach MATCH_THRESHOLD when the broker already knows the intent.
          const _bpDetectContext = {
            ...brokerKnownContext,
            intent: brokerRecommendation?.intent || brokerKnownContext?.intent || null,
            domainIntent:
              semanticClassification?.domainIntent ||
              brokerKnownContext?.domainIntent ||
              null,
          };
          const _bpPromptHints = extractPromptHints(ctx.params.message);
          const _bpSignalMatch = detectBlueprintIntent(
            ctx.params.message,
            _bpDetectContext,
            _bpPromptHints
          );

          // Fallback: if signal scoring misses, resolve blueprint directly by primary intent.
          // This covers cases where the broker or semantic classifier already identified the
          // blueprint intent but the message alone had < MATCH_THRESHOLD signal hits.
          const _bpDocForPolicy = _bpSignalMatch
            ? loadBlueprint(_bpSignalMatch.blueprintId)
            : findBlueprintByPrimaryIntent(brokerRecommendation?.intent) ||
              findBlueprintByPrimaryIntent(semanticClassification?.domainIntent) ||
              null;

          if (_bpDocForPolicy) {
            const _bpPolicy = extractBlueprintPolicy(_bpDocForPolicy);
            const _bpHasPolicy = Boolean(_bpPolicy.routingPolicy || _bpPolicy.synthesisPolicy);
            if (_bpHasPolicy) {
              // Embed blueprint identity so appliedPolicy exposes blueprintId/version to callers.
              _activeConsultationRoutingPolicy = _bpPolicy.routingPolicy
                ? {
                    ..._bpPolicy.routingPolicy,
                    _blueprintId: _bpDocForPolicy.id,
                    _blueprintVersion: _bpDocForPolicy.version || null,
                  }
                : null;
              _activeConsultationSynthesisPolicy = _bpPolicy.synthesisPolicy;
              _activeConsultationStickinessStart = _consultationTurnIndex;
            }
          }

          if (!_activeConsultationRoutingPolicy && !_activeConsultationSynthesisPolicy) {
            const _sessionRp = session?.l3?.activeRoutingPolicy || null;
            const _sessionStart =
              typeof session?.l3?.activeStickinessStartTurn === 'number'
                ? session.l3.activeStickinessStartTurn
                : null;
            if (_sessionRp && _sessionStart !== null) {
              const _elapsed = _consultationTurnIndex - _sessionStart;
              const _sticky = checkStickinessRetain(_sessionRp, ctx.params.message, _elapsed);
              if (_sticky.retain) {
                _activeConsultationRoutingPolicy = _sessionRp;
                _activeConsultationSynthesisPolicy = session?.l3?.activeSynthesisPolicy || null;
                _activeConsultationStickinessStart = _sessionStart;
              }
            }
          }

          const consultationResult = await this.handleConsultationTurn(ctx, {
            message: ctx.params.message,
            brokerRecommendation,
            knowledgeContext,
            receiptKnowledgeEvidence: receiptSelectionResult?.knowledgeEvidence || null,
            responseStrategy: consultationResponseStrategy,
            semanticClassification,
            session,
            resolvedParams: session.resolvedParams,
            knownContext: brokerKnownContext,
            routingDecision,
            jobId,
            executionTrace,
            toolCallTracker,
            recentHistoryWindow,
            synthesisPolicy: _activeConsultationSynthesisPolicy,
            routingPolicy: _activeConsultationRoutingPolicy,
          });

          const consultationExecution = {
            status:
              consultationResult?.status === 'awaiting-onboarding'
                ? 'awaiting-onboarding'
                : 'consulting',
            plan: null,
            steps: [],
            stopPoint:
              consultationResult?.stopPoint && typeof consultationResult.stopPoint === 'object'
                ? consultationResult.stopPoint
                : null,
          };
          const consultationPrimaryIntent = this.deriveConsultationPrimaryIntent({
            brokerRecommendation,
            routingDecision,
          });
          const consultationRouting = {
            source: 'consultation',
            routeKey: null,
            routeLabel: 'consultation',
            primaryIntent: consultationPrimaryIntent,
            secondaryIntents: [],
            requestedDomains: detectRequestedDomains(ctx.params.message),
            unsupportedDomains: [],
            warnings: [],
            chatMode: CHAT_MODES.CONSULTATION,
          };

          const stackResult = buildContextStack({
            systemPrompt: this.settings.systemPrompt,
            tenantFacts: session.l1?.tenantFacts || [],
            userProfile: session.l2?.userProfile || {},
            sessionHistory: [...(session.l3?.history || []), userMessage],
            fileAttachments: session.l3?.fileAttachments || [],
            bootstrapContext,
            knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
            toolContext: ctx.params.toolContext || null,
            maxContextTokens: this.settings.maxContextTokens,
          });

          stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.SYNTHESIZING, {
            consultationFacts: Array.isArray(consultationResult.factsUsed)
              ? consultationResult.factsUsed.length
              : 0,
          });
          if (consultationExecution.status === 'awaiting-onboarding') {
            stateMachine = transitionStateMachine(
              stateMachine,
              PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
              {
                reasonCode: consultationExecution?.stopPoint?.reasonCode || null,
                blockedAction: consultationExecution?.stopPoint?.blockedAction || null,
                blockedStep: consultationExecution?.stopPoint?.blockedStep || null,
              }
            );
          }
          stateMachine = transitionStateMachine(
            stateMachine,
            deriveTerminalState({
              consultation: consultationResult,
              status: consultationExecution.status,
            }),
            {
              status: consultationExecution.status,
              openQuestions: Array.isArray(consultationResult.openQuestions)
                ? consultationResult.openQuestions.length
                : 0,
            }
          );

          // Reuse the responseStrategy that was passed to the consultation LLM
          const responseStrategy = consultationResponseStrategy;
          turnGraph = addNode(turnGraph, {
            id: 'response:strategy',
            type: 'strategy',
            label: 'Response strategy',
            data: {
              audienceType: responseStrategy.audience || null,
              epistemicState: responseStrategy.epistemicState || null,
              abstractionLevel: responseStrategy.abstractionLevel || null,
              nextDialogueMove: responseStrategy.nextMove || null,
              decisionRole: responseStrategy.decisionRole || null,
              confidence:
                typeof responseStrategy.confidence === 'number'
                  ? responseStrategy.confidence
                  : null,
              assumptionCount: Array.isArray(responseStrategy.assumptions)
                ? responseStrategy.assumptions.length
                : 0,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'chat:mode',
            to: 'response:strategy',
            type: 'shapes',
          });

          const finalized = synthesizeAndPurgeLayer4(stackResult.stack, consultationResult.reply);
          const persisted = buildPersistableSessionState({
            id: sessionId,
            tenantId,
            userId,
            l1: finalized.stack.l1,
            l2: finalized.stack.l2,
            l3: {
              ...finalized.stack.l3,
              chatMode: effectiveChatMode,
              chatModeSource,
              lastClassification: session.l3.lastClassification,
              consultationContext: {
                hypotheses: consultationResult.hypotheses,
                openQuestions: consultationResult.openQuestions,
                nextActions: consultationResult.nextActions,
                factsUsed: consultationResult.factsUsed,
                attemptsSummary: Array.isArray(consultationResult.attemptsSummary)
                  ? consultationResult.attemptsSummary
                  : [],
                ts: new Date().toISOString(),
              },
              stateMachine: summarizeStateMachine(stateMachine),
              executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
              responseStrategy,
              activeRoutingPolicy: _activeConsultationRoutingPolicy || null,
              activeSynthesisPolicy: _activeConsultationSynthesisPolicy || null,
              activeStickinessStartTurn:
                _activeConsultationStickinessStart !== null
                  ? _activeConsultationStickinessStart
                  : null,
            },
            createdAt: session.createdAt,
          });

          persisted.l3.onboardingQuestions = Array.isArray(session.l3?.onboardingQuestions)
            ? session.l3.onboardingQuestions
            : [];
          persisted.l3.assumptions = Array.isArray(session.l3?.assumptions)
            ? session.l3.assumptions
            : [];
          persisted.l3.planStack = Array.isArray(session.planStack) ? session.planStack : [];
          persisted.l3.resolvedParams =
            session.resolvedParams && typeof session.resolvedParams === 'object'
              ? session.resolvedParams
              : {};
          persisted.l3.lastCompletedPlan =
            session.l3?.lastCompletedPlan && typeof session.l3.lastCompletedPlan === 'object'
              ? session.l3.lastCompletedPlan
              : null;
          persisted.l3.stopPoint =
            consultationExecution?.stopPoint && typeof consultationExecution.stopPoint === 'object'
              ? consultationExecution.stopPoint
              : null;
          persisted.l3.criticalStepCheckpoints =
            session.l3?.criticalStepCheckpoints &&
            typeof session.l3.criticalStepCheckpoints === 'object'
              ? session.l3.criticalStepCheckpoints
              : {};

          assertNoL4RawInPersistedState(persisted);
          await this.persistSession(ctx, tenantId, sessionId, persisted);

          await cancelDream(tenantId, sessionId);
          const profileNs = tenantNamespace(PROFILE_NAMESPACE, tenantId);
          await scheduleDream({
            broker: this.broker,
            sessionId,
            tenantId,
            userId,
            profileNamespace: profileNs,
            authMeta: this.buildDreamAuthMeta(ctx.meta, tenantId, userId),
            runFn: async (payload) => {
              await this.runDream(this.broker, payload);
            },
          });

          status = 'consulting';

          const consultationPayload = {
            hypotheses: consultationResult.hypotheses,
            openQuestions: consultationResult.openQuestions,
            nextActions: consultationResult.nextActions,
            factsUsed: consultationResult.factsUsed,
            attemptsSummary: Array.isArray(consultationResult.attemptsSummary)
              ? consultationResult.attemptsSummary
              : [],
            workflowType:
              consultationResult.workflowType || semanticClassification?.workflowType || null,
            domainIntent:
              consultationResult.domainIntent || semanticClassification?.domainIntent || null,
            evidenceStatus: consultationResult.evidenceStatus || 'unverified',
            missingEvidence: Array.isArray(consultationResult.missingEvidence)
              ? consultationResult.missingEvidence
              : [],
            nextVerificationSteps: Array.isArray(consultationResult.nextVerificationSteps)
              ? consultationResult.nextVerificationSteps
              : [],
            guardrailCorrections: Array.isArray(consultationResult.guardrailCorrections)
              ? consultationResult.guardrailCorrections
              : [],
            ...(Array.isArray(consultationResult.debugTrace)
              ? { debugTrace: consultationResult.debugTrace }
              : {}),
          };

          const _consultationEvidenceCandidates = this.buildEvidenceRequirementsForRevalidation({
            tenantId,
            sessionId,
            personaId: rawKnownContext?.personaId || null,
            responsibleRole: rawKnownContext?.responsibleRole || null,
            missingEvidence: consultationPayload.missingEvidence,
            evidencePlan: null,
            execution: consultationExecution,
          });
          if (_consultationEvidenceCandidates.length > 0) {
            this.recordEvidenceRequirementsForRevalidation(ctx, _consultationEvidenceCandidates).catch(
              (err) => this.logger?.warn(`evidence requirement recording failed: ${err.message}`)
            );
          }

          const consultationAttempts = Array.isArray(consultationPayload.attemptsSummary)
            ? consultationPayload.attemptsSummary
            : [];

          // v0.57.3 — workLog callsite 4a: consultation synthesis
          if (consultationResult && !consultationResult._isFallback) {
            turnWorkLog.addEntry({
              action: WORK_LOG_ACTIONS.CONSULTATION_SYNTHESIS,
              label: `Synthesized response from ${consultationAttempts.length} tool calls`,
              metadata: {
                toolCount: consultationAttempts.length,
                sourceCategory: (() => {
                  const d = String(brokerRecommendation?.domain || '').toLowerCase();
                  if (d.includes('grid') || d.includes('netz')) return 'grid_data';
                  if (d.includes('market') || d.includes('markt') || d.includes('price'))
                    return 'market_data';
                  if (d.includes('geo') || d.includes('location') || d.includes('osm'))
                    return 'geo_data';
                  if (d.includes('regulat') || d.includes('recht') || d.includes('compliance'))
                    return 'regulatory_data';
                  return 'other';
                })(),
                phase: 'synthesis',
              },
            });
          } else {
            // callsite 4b: consultation fallback
            turnWorkLog.addEntry({
              action: WORK_LOG_ACTIONS.CONSULTATION_FALLBACK,
              label: `Used fallback: TOOLS_UNAVAILABLE`,
              metadata: {
                reason: 'TOOLS_UNAVAILABLE',
                phase: 'synthesis',
                attemptCount: consultationAttempts.length,
              },
            });
          }

          consultationAttempts.forEach((attempt, idx) => {
            const toolNodeId = `tool:consultation:${idx + 1}:${attempt.tool || 'unknown'}`;
            turnGraph = addNode(turnGraph, {
              id: toolNodeId,
              type: 'tool',
              label: attempt.tool || 'consultation-tool',
              data: {
                status: attempt.status || null,
                attempts: attempt.attempts || null,
              },
            });
            turnGraph = addEdge(turnGraph, {
              from: 'chat:mode',
              to: toolNodeId,
              type: 'invokes',
            });
          });

          const factsUsed = Array.isArray(consultationPayload.factsUsed)
            ? consultationPayload.factsUsed
            : [];
          factsUsed.slice(0, 8).forEach((fact, idx) => {
            const factNodeId = `fact:consultation:${idx + 1}`;
            turnGraph = addNode(turnGraph, {
              id: factNodeId,
              type: 'fact',
              label: `Consultation fact ${idx + 1}`,
              data: {
                source: fact?.source || null,
                value: fact?.value || null,
              },
            });
            turnGraph = addEdge(turnGraph, {
              from: 'chat:mode',
              to: factNodeId,
              type: 'grounds',
            });
          });

          turnGraph = finalizeTurnGraph(turnGraph, { status: 'completed' });

          // ═══ Consultation-to-Execution Bridge ═══
          let executionReadiness = null;
          let consultationPlanResults = null;
          let receiptReflectionResult = buildReceiptReflectionAuditSeed(receiptSelectionResult); // v0.57.5 #158
          // effectiveReceiptContext carries the hydrated context into executeWithReceipt.
          // Starts as brokerKnownContext; upgraded to patchedContext after a successful reflection.
          let effectiveReceiptContext = brokerKnownContext || {}; // v0.57.5 #158

          try {
            executionReadiness = buildConsultationExecutionPlan({
              message: ctx.params.message,
              consultation: consultationPayload,
              brokerRecommendation,
              knownContext: brokerKnownContext || {},
              semanticClassification,
              responseStrategy: consultationResponseStrategy,
              executionMode,
              routingPolicy: _activeConsultationRoutingPolicy || null,
              synthesisPolicy: _activeConsultationSynthesisPolicy || null,
            });

            turnGraph = addWorkflowPlanNode(turnGraph, executionReadiness);

            // ─── Receipt Selection Integration (v0.54.3) ─────
            // If receiptSelectionResult has a selectedReceipt and disableReceiptSelection is false,
            // use executeWithReceipt for deterministic receipt-based execution.
            let selectedReceipt = receiptSelectionResult?.selectedReceipt || null;

            // ─── Receipt Reflection / Context-Hydration Loop (v0.57.5 #158) ─────
            // When a receipt is selected but not executable due to scope-blocked or
            // missing-input steps, perform exactly one bounded reflection attempt:
            // extract structured context from the user message and session history,
            // validate the patch, merge it, and re-run receipt evaluation.
            // No WOL events, no tenant knowledge promotion, no raw-data persistence.
            if (
              selectedReceipt &&
              !ctx.params.disableReceiptSelection &&
              !forceReceiptRequested &&
              receiptSelectionResult?.evaluation?.executable === false &&
              hasScopeBlockedOrMissingSteps(receiptSelectionResult?.evaluation)
            ) {
              try {
                const reflectionEval = receiptSelectionResult.evaluation;
                const missingRequiredInputs = Array.isArray(reflectionEval?.missingRequiredInputs)
                  ? reflectionEval.missingRequiredInputs
                  : [];
                const scopeViolations = flattenScopeViolations(reflectionEval);

                // Source: current session only (tenant-scoped, sanitized by #149 infrastructure)
                const recentHistory = this.buildConsultationRecentHistoryWindow(session);

                const { system: reflSystem, user: reflUser } = buildReflectionPrompt({
                  userMessage: ctx.params.message,
                  consultationHistory: recentHistory,
                  knownContext: sanitizeKnownContextForReflectionPrompt(brokerKnownContext || {}),
                  missingRequiredInputs,
                  scopeViolations,
                  receiptId: receiptSelectionResult.receiptId || null,
                });

                const reflectionResponse = await this.callLlmGenerate(ctx, {
                  system: reflSystem,
                  user: reflUser,
                  schema: REFLECTION_OUTPUT_SCHEMA,
                  temperature: 0.1,
                  maxTokens: 512,
                });

                // Unwrap structured response (broker vs local llm-client shape)
                const reflData =
                  reflectionResponse &&
                  typeof reflectionResponse === 'object' &&
                  reflectionResponse.data &&
                  typeof reflectionResponse.data === 'object'
                    ? reflectionResponse.data
                    : reflectionResponse || {};

                const rawPatch =
                  reflData.resolvedContextPatch && typeof reflData.resolvedContextPatch === 'object'
                    ? reflData.resolvedContextPatch
                    : {};
                const rawConfidence =
                  typeof reflData.confidence === 'string' ? reflData.confidence : 'low';
                const rawEvidence = typeof reflData.evidence === 'string' ? reflData.evidence : '';
                const rawUnresolvedScopes = Array.isArray(reflData.unresolvedScopes)
                  ? reflData.unresolvedScopes
                  : [];

                const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
                  patch: rawPatch,
                  missingRequiredInputs,
                  scopeViolations,
                });

                const patchedFields = Object.keys(sanitizedPatch);

                if (patchedFields.length > 0) {
                  // Merge via resolveContextMutation to enforce Zwiebelmodus semantics
                  const { mergedParams: patchedContext } = resolveContextMutation(
                    brokerKnownContext || {},
                    sanitizedPatch
                  );

                  // Re-run receipt selection exactly once with the hydrated context
                  const reflectedResult = await this.selectRuntimeReceipt(ctx, {
                    message: ctx.params.message,
                    context: {
                      knownContext: patchedContext,
                      semanticClassification,
                      brokerRecommendation,
                      effectiveChatMode,
                      sessionId,
                    },
                    input: {
                      message: ctx.params.message,
                      knownContext: patchedContext,
                      workflowType: semanticClassification?.workflowType || null,
                      domainIntent:
                        semanticClassification?.domainIntent ||
                        brokerRecommendation?.intent ||
                        null,
                    },
                    // Prefer the same receipt; do NOT forceReceipt (would throw if still blocked)
                    preferredReceipts: [receiptSelectionResult.receiptId].filter(Boolean),
                    allowDraftReceipts: ctx.params.allowDraftReceipts === true,
                    explainReceiptSelection: false,
                    disableReceiptSelection: false,
                  });

                  const reflectionResolved = reflectedResult?.evaluation?.executable === true;

                  if (reflectionResolved) {
                    // Promote the reflected result into the live receipt selection state
                    selectedReceipt = reflectedResult?.selectedReceipt || selectedReceipt;
                    receiptSelectionResult.evaluation = reflectedResult.evaluation;
                    receiptSelectionResult.selectedReceipt =
                      reflectedResult.selectedReceipt || receiptSelectionResult.selectedReceipt;
                    // Ensure execution uses the hydrated context, not the original brokerKnownContext
                    effectiveReceiptContext = patchedContext; // v0.57.5 #158
                  }

                  receiptReflectionResult = {
                    ...(receiptReflectionResult || {}),
                    attempted: true,
                    outcome: reflectionResolved ? 'resolved' : 'still-blocked',
                    validationOutcome:
                      rejectedKeys.length > 0 ? 'accepted-with-rejections' : 'accepted',
                    resolvedFields: patchedFields,
                    confidence: rawConfidence,
                    evidence: String(rawEvidence).slice(0, 300),
                    unresolvedScopes: rawUnresolvedScopes,
                    rejectedKeys,
                    reEvaluation: {
                      performed: true,
                      executable: reflectedResult?.evaluation?.executable === true,
                    },
                    receipt: buildReceiptReflectionSummary(receiptSelectionResult),
                  };
                } else {
                  receiptReflectionResult = {
                    ...(receiptReflectionResult || {}),
                    attempted: true,
                    outcome: 'validation-rejected',
                    validationOutcome: 'rejected',
                    resolvedFields: [],
                    confidence: rawConfidence,
                    evidence: String(rawEvidence).slice(0, 300),
                    unresolvedScopes: rawUnresolvedScopes,
                    rejectedKeys,
                    reEvaluation: {
                      performed: false,
                      executable: null,
                    },
                    receipt: buildReceiptReflectionSummary(receiptSelectionResult),
                  };
                }
              } catch (reflectionError) {
                this.logger?.warn(`Receipt reflection attempt failed: ${reflectionError.message}`);
                const reflectionOutcome =
                  isActionUnavailable(reflectionError) || isNotFound(reflectionError)
                    ? 'unavailable'
                    : 'llm-error';
                receiptReflectionResult = {
                  ...(receiptReflectionResult || {}),
                  attempted: true,
                  outcome: reflectionOutcome,
                  validationOutcome: 'not-performed',
                  resolvedFields: [],
                  confidence: 'low',
                  evidence: '',
                  unresolvedScopes: [],
                  rejectedKeys: [],
                  reEvaluation: {
                    performed: false,
                    executable: null,
                  },
                  receipt: buildReceiptReflectionSummary(receiptSelectionResult),
                };
              }
            }

            if (receiptReflectionResult && receiptSelectionResult) {
              receiptReflectionResult.receipt =
                buildReceiptReflectionSummary(receiptSelectionResult);
            }
            // ─────────────────────────────────────────────────

            const useReceiptExecution =
              selectedReceipt &&
              !ctx.params.disableReceiptSelection &&
              receiptSelectionResult?.evaluation?.executable === true;

            if (useReceiptExecution) {
              try {
                const toolResolver = {
                  executeTool: async (action, params) => {
                    const result = await ctx.call(action, params, { meta: ctx.meta });
                    return {
                      action,
                      status: result?.success === false ? 'failed' : 'completed',
                      result,
                      error:
                        result?.success === false
                          ? result?.error?.message || result?.message
                          : null,
                    };
                  },
                };
                consultationPlanResults = await executeWithReceipt(
                  selectedReceipt,
                  this.buildReceiptExecutionContext({
                    message: ctx.params.message,
                    knownContext: {
                      ...effectiveReceiptContext,
                      ...(receiptSelectionResult?.evaluation?.plannedToolCalls?.[0]?.params || {}),
                    }, // v0.57.5 #158: patched after reflection + receipt-evaluated hints
                    resolvedParams: session?.resolvedParams || {},
                    observations: [],
                  }),
                  [],
                  toolResolver,
                  this.logger
                );
                receiptSelectionResult.execution = {
                  used: true,
                  executor: 'executeWithReceipt',
                  fallbackReason: null,
                  executedToolCalls: Array.isArray(consultationPlanResults?.steps)
                    ? consultationPlanResults.steps.map((step) => ({
                        step: Number(step?.step || 0) || null,
                        action: step?.action || step?.outcome?.action || null,
                        status: step?.status || null,
                        params: step?.params || {},
                      }))
                    : [],
                };
                if (receiptReflectionResult && receiptSelectionResult) {
                  receiptReflectionResult.receipt =
                    buildReceiptReflectionSummary(receiptSelectionResult);
                }
              } catch (receiptExecError) {
                this.logger?.warn(
                  `Receipt execution failed (${selectedReceipt.receiptId || selectedReceipt.id || 'unknown-receipt'}): ${receiptExecError.message}, falling back to legacy execution`
                );
                if (forceReceiptRequested) {
                  throw new MoleculerClientError(
                    `Forced receipt execution failed: ${receiptExecError.message}`,
                    422,
                    'RECEIPT_FORCED_EXECUTION_FAILED',
                    {
                      forceReceipt: ctx.params.forceReceipt,
                    }
                  );
                }
                receiptSelectionResult.execution = {
                  used: false,
                  executor: 'executeWithReceipt',
                  fallbackReason: 'receipt_execution_failed',
                };
                // Fall back to legacy if receipt execution fails
                if (
                  executionReadiness.canExecuteNow &&
                  executionReadiness.executableSteps.length > 0
                ) {
                  consultationPlanResults = await this.executeConsultationToolPlan(ctx, {
                    plan: executionReadiness,
                    knownContext: brokerKnownContext || {},
                    session,
                    executionTrace,
                    toolCallTracker,
                  });
                }
              }
            } else if (
              executionReadiness.canExecuteNow &&
              executionReadiness.executableSteps.length > 0
            ) {
              receiptSelectionResult.execution = {
                used: false,
                executor: 'executeWithReceipt',
                fallbackReason:
                  ctx.params.disableReceiptSelection === true
                    ? 'disabled_by_request'
                    : selectedReceipt
                      ? 'receipt_not_executable'
                      : 'no_selected_receipt',
              };
              // Legacy execution path (no receipt, or receipt selection disabled)
              consultationPlanResults = await this.executeConsultationToolPlan(ctx, {
                plan: executionReadiness,
                knownContext: brokerKnownContext || {},
                session,
                executionTrace,
                toolCallTracker,
              });
            }
            // ─────────────────────────────────────────────────

            if (jobStore) {
              jobStore.appendLog(
                jobId,
                'consultation_execution_bridge',
                45,
                `Execution readiness: ${executionReadiness.readiness} / workflow: ${executionReadiness.workflowType}${useReceiptExecution ? ` / receipt: ${selectedReceipt.id}` : ''}`,
                {
                  canExecuteNow: executionReadiness.canExecuteNow,
                  stepCount: executionReadiness.executableSteps.length,
                  receiptUsed: Boolean(useReceiptExecution),
                }
              );
            }
          } catch (bridgeError) {
            executionReadiness = null;
            consultationPlanResults = null;
          }
          // ═══════════════════════════════════════

          const consultationExecutionForTrace = {
            ...consultationExecution,
            meta: executionTrace.summarize({
              toolCalls: toolCallTracker.summarize().calls,
              chatModeSource,
              consultationIterations: consultationAttempts.length,
            }),
          };
          const quality = this.buildQualitySummary({
            evidencePlan: null,
            execution: consultationExecution,
            consultation: consultationPayload,
          });
          receiptSelectionMetadata = this.buildReceiptSelectionMetadata(receiptSelectionResult, {
            includeDiagnostics: receiptSelectionDiagnosticsRequested,
          });
          // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
          // v0.56.3 — ZNP context signals
          const _hitlItemId3 =
            session?.l3?.stopPoint?.hitlItemId ?? ctx.params?.knownContext?.hitlItemId ?? null;
          const _handoffCtx3 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId3);
          const _znpCtx3 = buildZnpContextSnapshot(ctx, session, semanticClassification);
          const personaResolution = await this.resolvePersonaForTrace(ctx, {
            tenantId,
            sessionId,
            sourceService: 'personal-agent',
            sourceAction: 'chat',
            workflowType:
              consultationPayload?.workflowType ?? semanticClassification?.workflowType ?? null,
            domainIntent:
              consultationPayload?.domainIntent ?? semanticClassification?.domainIntent ?? null,
            ..._znpCtx3,
            handoffPersonaId: _handoffCtx3.handoffPersonaId,
            hitlItemId: _hitlItemId3,
            workflowCompletionState: _handoffCtx3.workflowCompletionState,
          });

          // v0.57.3 — workLog callsite 3: persona resolved
          if (personaResolution?.roleLabel) {
            turnWorkLog.addEntry({
              action: WORK_LOG_ACTIONS.PERSONA_RESOLVED,
              label: getSafePersonaLabel(personaResolution.roleLabel),
              metadata: {
                roleLabel: personaResolution.roleLabel,
                source: personaResolution.source || 'session',
                updateReason: 'role_consistency_check',
              },
            });
          }

          const activeConsultationPolicy =
            executionReadiness?.appliedPolicy ||
            (_activeConsultationRoutingPolicy
              ? {
                  sessionIntent: _activeConsultationRoutingPolicy.sessionIntent || null,
                  blueprintId: _activeConsultationRoutingPolicy._blueprintId || null,
                  blueprintVersion: _activeConsultationRoutingPolicy._blueprintVersion || null,
                  source: 'blueprint-policy',
                }
              : null);

          const agentTrace = this.buildAgentTrace({
            routing: consultationRouting,
            plan: null,
            execution: consultationExecutionForTrace,
            evidencePlan: null,
            consultation: consultationPayload,
            responseStrategy,
            stateMachine,
            executionStateGraph,
            turnGraph,
            routingDecision,
            personaResolution,
            bootstrapContext,
            knowledgeScope: [
              ...(session.l3?.knowledgeScopeDataPoints || []),
              ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
            ],
            workLog: turnWorkLog.toArray(),
            reflection: receiptReflectionResult, // v0.57.5 #158
            locationResolution: brokerKnownContext._locationResolutionTrace || null, // v0.60
            policy: activeConsultationPolicy,
          });

          persisted.l3.turnGraph = summarizeTurnGraph(turnGraph);

          const consultationExecutionPublic =
            receiptSelectionResult?.execution?.used === true &&
            Array.isArray(consultationPlanResults?.steps) &&
            consultationPlanResults.steps.length > 0
              ? {
                  ...consultationExecution,
                  status: 'completed',
                  steps: consultationPlanResults.steps,
                }
              : consultationExecution;
          const groundedReceiptReply = this.buildGroundedReceiptReply(
            ctx.params.message,
            receiptSelectionResult,
            consultationPlanResults
          );

          const consultationGroundedReply = this.appendGroundingContractToReply(
            groundedReceiptReply || consultationResult.reply,
            {
              execution: consultationPlanResults || consultationExecutionPublic,
              knowledgeScope: [
                ...(session.l3?.knowledgeScopeDataPoints || []),
                ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
              ],
              missingEvidence: consultationPayload.missingEvidence,
              assumptions: consultationPayload.hypotheses,
            }
          );

          return {
            success: true,
            status,
            sessionId,
            executionMode,
            chatMode: effectiveChatMode,
            reply: consultationGroundedReply,
            workflowType: consultationPayload.workflowType,
            domainIntent: consultationPayload.domainIntent,
            evidenceStatus: consultationPayload.evidenceStatus,
            missingEvidence: consultationPayload.missingEvidence,
            nextVerificationSteps: consultationPayload.nextVerificationSteps,
            guardrailCorrections: consultationPayload.guardrailCorrections,
            consultation: consultationPayload,
            layer4Purged: finalized.layer4Purged,
            l3Compressed: Boolean(finalized.stack?.l3?.compressed),
            contextUsage: stackResult.usage,
            historyCount: finalized.stack?.l3?.history?.length || 0,
            fileProcessing,
            routing: consultationRouting,
            responseStrategy,
            policy: activeConsultationPolicy,
            executionReadiness: executionReadiness || null,
            consultationPlanResults: consultationPlanResults || null,
            plan: {
              steps: [],
              onboardingHints: [],
            },
            evidencePlan: null,
            evidenceGaps: [],
            evidenceConfidence: null,
            quality,
            agentTrace,
            stateMachine: summarizeStateMachine(stateMachine),
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            turnGraph: summarizeTurnGraph(turnGraph),
            execution: consultationExecutionPublic,
            ...(receiptSelectionMetadata ? { metadata: receiptSelectionMetadata } : {}),
          };
        }

        // Log broker plan phase
        if (jobStore) {
          jobStore.appendLog(jobId, 'broker_plan', 20, 'Planning execution strategy...', {
            chatMode: effectiveChatMode,
          });
        }

        if (!hasApprovedHitlResumePlan) {
          const resumable = findResumableParentFrame(session.planStack);
          if (resumable?.parentFrame) {
            const freshDomains = detectRequestedDomains(ctx.params.message);
            const parentDomains = Array.isArray(resumable.parentFrame.routing?.requestedDomains)
              ? resumable.parentFrame.routing.requestedDomains
              : [];
            const domainMismatch =
              freshDomains.length > 0 &&
              freshDomains.some((domain) => !parentDomains.includes(domain));

            if (!domainMismatch) {
              const resumed = resumeParentPlanFrame(session.planStack, session.resolvedParams);
              if (resumed?.parentFrame) {
                session.planStack = resumed.planStack;
                routing = {
                  ...(resumed.parentFrame.routing || {}),
                  primaryIntent:
                    resumed.parentFrame.intent ||
                    resumed.parentFrame.routing?.primaryIntent ||
                    null,
                };
                plan = mergeResolvedParamsIntoPlan(
                  resumed.parentFrame.plan,
                  session.resolvedParams
                );
              }
            }
          }
        }

        // Approved HITL resume: use the stored plan from the blocked checkpoint instead of broker-derived plan
        if (!plan && hasApprovedHitlResumePlan) {
          plan = session.l3._approvedHitlResume || approvedHitlResumePlan;
          routing = {
            primaryIntent: plan.primaryIntent || 'approved_hitl_resume',
            requestedDomains: Array.isArray(plan.requestedDomains) ? plan.requestedDomains : [],
          };
        }

        if (!plan) {
          plan = buildExecutionPlan({
            message: ctx.params.message,
            brokerRecommendation,
            knowledgeContext,
            knownContext,
          });
          routing = {
            primaryIntent: plan.primaryIntent,
            requestedDomains: Array.isArray(plan.requestedDomains) ? plan.requestedDomains : [],
          };
        }

        const preflightKnownContext = this.hydrateKnownContextFromSession(
          { ...knownContext },
          session
        );
        if (inhouseData.length > 0) {
          preflightKnownContext.inhouseData = inhouseData;
        }
        const routedPlan = applyMissingContextFallback(plan, {
          knownContext: preflightKnownContext,
          executionMode,
        });
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.EXECUTION_PLANNED,
          {
            primaryIntent: routedPlan?.primaryIntent || null,
            stepCount: Array.isArray(routedPlan?.steps) ? routedPlan.steps.length : 0,
          }
        );

        // Log execution start
        if (jobStore) {
          jobStore.appendLog(
            jobId,
            'broker_execute',
            50,
            `Executing plan (${Array.isArray(routedPlan?.steps) ? routedPlan.steps.length : 0} steps)...`,
            {
              planId: routedPlan?.id || null,
              primaryIntent: routing?.primaryIntent || null,
              stepCount: Array.isArray(routedPlan?.steps) ? routedPlan.steps.length : 0,
            }
          );
        }

        let execution = null;
        const selectedReceiptForExecution = receiptSelectionResult?.selectedReceipt || null;
        const canRunReceiptExecution =
          Boolean(selectedReceiptForExecution) &&
          ctx.params.disableReceiptSelection !== true &&
          (executionMode === EXECUTION_MODES.AUTO ||
            forceReceiptRequested ||
            shouldPreferReceiptExecution);

        if (canRunReceiptExecution) {
          try {
            const receiptExecutionContext = this.buildReceiptExecutionContext({
              message: ctx.params.message,
              knownContext: {
                ...preflightKnownContext,
                ...(routedPlan?.promptHints || {}),
                ...(receiptSelectionResult?.evaluation?.plannedToolCalls?.[0]?.params || {}),
              },
              resolvedParams: session?.resolvedParams || {},
              observations: [],
            });

            const receiptExecutionResult = await executeWithReceipt(
              selectedReceiptForExecution,
              receiptExecutionContext,
              [],
              {
                executeTool: async (action, params) => {
                  const result = await ctx.call(action, params, {
                    meta: { ...ctx.meta, $gateway: false },
                  });
                  return {
                    action,
                    status: result?.success === false ? 'failed' : 'completed',
                    result,
                    error:
                      result?.success === false ? result?.error?.message || result?.message : null,
                  };
                },
              },
              this.logger
            );

            execution = this.normalizeReceiptExecutionResult(receiptExecutionResult, {
              plan: routedPlan,
              message: ctx.params.message,
            });

            receiptSelectionResult.execution = {
              used: true,
              executor: 'executeWithReceipt',
              fallbackReason: null,
              executedToolCalls: Array.isArray(execution?.steps)
                ? execution.steps.map((step) => ({
                    step: Number(step?.step || 0) || null,
                    action: step?.action || null,
                    status: step?.status || null,
                    params: step?.params || {},
                  }))
                : [],
            };
          } catch (receiptExecError) {
            receiptSelectionResult.execution = {
              used: false,
              executor: 'executeWithReceipt',
              fallbackReason: 'receipt_execution_failed',
            };

            if (forceReceiptRequested) {
              throw new MoleculerClientError(
                `Forced receipt execution failed: ${receiptExecError.message}`,
                422,
                'RECEIPT_FORCED_EXECUTION_FAILED',
                {
                  forceReceipt: ctx.params.forceReceipt,
                }
              );
            }
          }
        } else if (forceReceiptRequested) {
          throw new MoleculerClientError(
            'Forced receipt was selected but cannot be executed in the current mode/context.',
            422,
            'RECEIPT_FORCED_NOT_EXECUTABLE',
            {
              executionMode,
            }
          );
        }

        if (!execution) {
          if (!receiptSelectionResult.execution) {
            receiptSelectionResult.execution = {
              used: false,
              executor: 'executeWithReceipt',
              fallbackReason:
                ctx.params.disableReceiptSelection === true ? 'disabled_by_request' : 'legacy_path',
            };
          }

          execution = await this.handleExecutionWithOnboarding(ctx, {
            message: ctx.params.message,
            plan: routedPlan,
            knownContext: preflightKnownContext,
            session,
            executionMode,
            executionTrace,
            toolCallTracker,
          });
        }
        receiptSelectionMetadata = this.buildReceiptSelectionMetadata(receiptSelectionResult, {
          includeDiagnostics: receiptSelectionDiagnosticsRequested,
        });
        const executionStepsForGraph = Array.isArray(execution?.steps) ? execution.steps : [];
        executionStepsForGraph.forEach((step) => {
          const stepNodeId = `tool:execution:${step?.step || 'x'}:${step?.action || 'unknown'}`;
          turnGraph = addNode(turnGraph, {
            id: stepNodeId,
            type: 'tool',
            label: step?.action || 'execution-step',
            data: {
              step: step?.step || null,
              status: step?.status || null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'chat:mode',
            to: stepNodeId,
            type: 'invokes',
          });
        });
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.EXECUTION_RUNNING,
          {
            status: execution?.status || null,
            completedSteps: (Array.isArray(execution?.steps) ? execution.steps : []).filter(
              (step) => step?.status === 'completed'
            ).length,
          }
        );

        // Log execution result
        if (jobStore) {
          jobStore.appendLog(
            jobId,
            'broker_execute_complete',
            70,
            `Execution ${execution?.status || 'unknown'}`,
            {
              executionStatus: execution?.status || null,
              completedSteps: (Array.isArray(execution?.steps) ? execution.steps : []).filter(
                (s) => s?.status === 'completed'
              ).length,
              totalSteps: Array.isArray(execution?.steps) ? execution.steps.length : 0,
            }
          );
        }

        let responsePlan = execution?.plan || routedPlan || plan;
        const receiptExecutionUsed = receiptSelectionResult?.execution?.used === true;
        const receiptGroundedReply = receiptExecutionUsed
          ? this.buildGroundedReceiptReply(ctx.params.message, receiptSelectionResult, execution)
          : null;
        status = execution?.status || 'completed';
        const evidenceGapsForGraph = Array.isArray(responsePlan?.evidencePlan?.gaps)
          ? responsePlan.evidencePlan.gaps
          : [];
        evidenceGapsForGraph.slice(0, 8).forEach((gap, idx) => {
          const gapNodeId = `gap:evidence:${idx + 1}`;
          turnGraph = addNode(turnGraph, {
            id: gapNodeId,
            type: 'gap',
            label: gap?.id || `Evidence gap ${idx + 1}`,
            data: {
              required: gap?.required || null,
              severity: gap?.severity || null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'broker:recommendation',
            to: gapNodeId,
            type: 'requires_evidence',
          });
        });
        routing = {
          ...(routing || {}),
          primaryIntent: responsePlan?.primaryIntent || routing?.primaryIntent || null,
          requestedDomains: Array.isArray(responsePlan?.requestedDomains)
            ? responsePlan.requestedDomains
            : Array.isArray(routing?.requestedDomains)
              ? routing.requestedDomains
              : [],
        };

        if (
          (execution?.status === 'awaiting-onboarding' || execution?.status === 'partial') &&
          routing?.primaryIntent
        ) {
          const currentStack = Array.isArray(session.planStack) ? session.planStack : [];
          if (hasRecentIntentLoop(currentStack, routing.primaryIntent)) {
            try {
              assertNoRecentIntentLoop(currentStack, routing.primaryIntent);
            } catch (loopError) {
              this.logger?.warn(
                `Plan-stack loop guard triggered for intent ${routing.primaryIntent}: ${loopError.message}`
              );
            }
          }
          session.planStack = pushPlanFrame(
            currentStack,
            {
              intent: routing.primaryIntent,
              routing,
              plan: responsePlan,
              awaitingParams: execution.stopPoint?.missingParams || [],
              resolvedParamsSnapshot: { ...session.resolvedParams },
              hitlItemId: execution.stopPoint?.hitlItemId || null,
              blockedAction: execution.stopPoint?.blockedAction || null,
              blockedStep: execution.stopPoint?.blockedStep || null,
              checkpointKey:
                execution.stopPoint?.hitlItemId && responsePlan
                  ? this.buildCriticalStepCheckpointKey(responsePlan, {
                      step: execution.stopPoint?.blockedStep || 0,
                      action: execution.stopPoint?.blockedAction || 'unknown-action',
                    })
                  : null,
              planSnapshot:
                execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL'
                  ? this.buildCriticalStepResumeSnapshot(responsePlan, {
                      action: execution.stopPoint?.blockedAction || null,
                      step: execution.stopPoint?.blockedStep || null,
                      responsibleRole: execution.stopPoint?.responsibleRole || null,
                      requiredResolverRoles: Array.isArray(
                        execution.stopPoint?.requiredResolverRoles
                      )
                        ? execution.stopPoint.requiredResolverRoles
                        : [],
                      personaId: execution.stopPoint?.personaId || null,
                      personaName: execution.stopPoint?.personaName || null,
                      personaType: execution.stopPoint?.personaType || null,
                      personaResolution: execution.stopPoint?.personaResolution || null,
                      routingContext: execution.stopPoint?.routingContext || null,
                    })
                  : null,
              responsibleRole: execution.stopPoint?.responsibleRole || null,
              requiredResolverRoles: Array.isArray(execution.stopPoint?.requiredResolverRoles)
                ? execution.stopPoint.requiredResolverRoles
                : [],
              personaId: execution.stopPoint?.personaId || null,
              personaName: execution.stopPoint?.personaName || null,
              personaType: execution.stopPoint?.personaType || null,
              personaResolution: execution.stopPoint?.personaResolution || null,
              routingContext: execution.stopPoint?.routingContext || null,
            },
            { maxDepth: 5 }
          );
        }

        if (execution?.status === 'completed') {
          session.planStack = markTopFrameCompleted(
            session.planStack,
            routing?.primaryIntent || null
          );
          const stepResults = (Array.isArray(execution.steps) ? execution.steps : [])
            .filter((step) => step?.status === 'completed')
            .map((step) => step?.result?.data)
            .filter((data) => data && typeof data === 'object' && !Array.isArray(data))
            .reduce((acc, data) => ({ ...acc, ...data }), {});
          session.resolvedParams = {
            ...session.resolvedParams,
            ...stepResults,
          };
          // Track resolved capabilities to prevent broker from re-selecting them
          if (!session.resolvedCapabilities) session.resolvedCapabilities = [];
          if (routing?.primaryIntent) {
            session.resolvedCapabilities.push({
              capability: routing.primaryIntent,
              resolvedAt: new Date().toISOString(),
            });
          }
          if (routing?.primaryIntent) {
            session.l3.lastCompletedPlan = {
              intent: routing.primaryIntent,
              at: new Date().toISOString(),
            };
          }
        }

        session.l3.planStack = Array.isArray(session.planStack) ? session.planStack : [];
        session.l3.resolvedParams =
          session.resolvedParams && typeof session.resolvedParams === 'object'
            ? session.resolvedParams
            : {};
        session.l3.resolvedCapabilities = Array.isArray(session.resolvedCapabilities)
          ? session.resolvedCapabilities
          : [];

        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: session.l1?.tenantFacts || [],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: [...(session.l3?.history || []), userMessage],
          fileAttachments: session.l3?.fileAttachments || [],
          bootstrapContext,
          knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });
        stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.SYNTHESIZING, {
          status: execution?.status || null,
          presentationCandidate: this.hasStructuredExecutionResult(execution),
        });

        // A) Strategic milestone: about to generate LLM synthesis
        if (jobStore) {
          jobStore.appendLog(jobId, 'llm_generating', 50, 'Generating synthesis reply...', {
            executionStatus: execution?.status || null,
            stepCount: Array.isArray(execution?.steps) ? execution.steps.length : 0,
          });
        }

        const responseStrategy = this.buildResponseStrategy({
          message: ctx.params.message,
          plan: responsePlan,
          execution,
          knowledgeContext,
          knownContext: preflightKnownContext,
          missingParams: execution?.stopPoint?.missingParams || [],
          existingAssumptions: Array.isArray(execution?.assumptions)
            ? execution.assumptions
            : Array.isArray(session.l3?.assumptions)
              ? session.l3.assumptions
              : [],
        });
        turnGraph = addNode(turnGraph, {
          id: 'response:strategy',
          type: 'strategy',
          label: 'Response strategy',
          data: {
            audienceType: responseStrategy.audience || null,
            epistemicState: responseStrategy.epistemicState || null,
            abstractionLevel: responseStrategy.abstractionLevel || null,
            nextDialogueMove: responseStrategy.nextMove || null,
            decisionRole: responseStrategy.decisionRole || null,
            confidence:
              typeof responseStrategy.confidence === 'number' ? responseStrategy.confidence : null,
            assumptionCount: Array.isArray(responseStrategy.assumptions)
              ? responseStrategy.assumptions.length
              : 0,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'chat:mode',
          to: 'response:strategy',
          type: 'shapes',
        });

        let synthesisText = this.synthesizeTurn({
          message: ctx.params.message,
          toolContext: ctx.params.toolContext,
          executionMode,
          plan: responsePlan,
          execution,
          fileProcessing,
          knowledgeContext,
          responseStrategy,
          ctx,
          tenantId,
          sessionId,
        });
        if (receiptGroundedReply) {
          synthesisText = receiptGroundedReply;
        }

        // A) Strategic milestone: synthesis done, now building presentation
        if (jobStore) {
          jobStore.appendLog(
            jobId,
            'synthesizing',
            80,
            'Synthesis complete, building presentation...',
            {
              replyLength: String(synthesisText || '').length,
            }
          );
        }

        // Try to render presentation for execution result
        let presentationResult = {};
        let presentationApplied = false;
        let presentationType = null;

        if (receiptGroundedReply) {
          presentationApplied = true;
          presentationType = 'receipt_grounded_reply';
          presentationResult = {
            markdown: synthesisText,
            presentation: {
              type: presentationType,
              title: 'EV-Ladefenster nach CO₂-Prognose',
              summary: 'Receipt-Ausführung mit ausgewerteter CO₂-/Grünstrom-Prognose.',
              sources: ['energy-market.co2Intensity'],
              sections: [
                {
                  title: 'Empfehlung',
                  content: synthesisText,
                },
              ],
              nextActions: [
                {
                  label: 'Laden im empfohlenen Fenster planen',
                  action: 'schedule_ev_charging_window',
                },
              ],
            },
          };
        }

        // ── Phase 2: Evidence-Gap-Gate (before synthesis) ──
        // If critical evidence gaps exist, block synthesis and surface evidence_gap_table
        if (
          execution?.status === 'completed' &&
          !receiptExecutionUsed &&
          responsePlan?.evidencePlan &&
          shouldBlockSynthesisOnGaps(responsePlan.evidencePlan)
        ) {
          const fallbackGapMarkdown = this.buildEvidenceGapUserMessage(responsePlan.evidencePlan);
          try {
            const gapPresentation = buildEvidenceGapPresentation(responsePlan.evidencePlan);
            presentationResult = await ctx.call(
              'presentation.render',
              {
                intent: responsePlan?.primaryIntent || 'evidence_gap_analysis',
                audience: 'operations',
                preferredFormat: 'evidence_gap_table',
                domainResult: gapPresentation,
                context: {
                  tenantId,
                  sessionId,
                  source: 'personal-agent-evidence-gate',
                  phaseNote: 'evidence-plan-phase2-synthesis-gate',
                },
                locale: 'de-DE',
              },
              { meta: { ...ctx.meta, $gateway: false } }
            );

            if (
              presentationResult &&
              typeof presentationResult === 'object' &&
              presentationResult.markdown
            ) {
              presentationApplied = true;
              presentationType = 'evidence_gap_table';
              // Synthesis is skipped — we replace reply with the gap table
              synthesisText = /evidence_gap_table_renderer_not_implemented/i.test(
                presentationResult.markdown
              )
                ? fallbackGapMarkdown
                : presentationResult.markdown;
              presentationResult.markdown = synthesisText;
            }
          } catch (error) {
            this.logger?.warn(`Evidence-gap presentation render failed: ${error.message}`);
            presentationApplied = true;
            presentationType = 'evidence_gap_table';
            presentationResult = {
              markdown: fallbackGapMarkdown,
              presentation: {
                type: 'evidence_gap_table',
                title: 'Fehlende Evidenz',
                summary: 'Für eine belastbare Antwort fehlen noch konkrete Nachweise.',
              },
            };
            synthesisText = fallbackGapMarkdown;
          }
        }

        if (execution?.status === 'awaiting-onboarding') {
          const onboardingQuestion = execution?.stopPoint?.onboardingQuestion;
          const questionText = onboardingQuestion?.questionText || execution?.stopPoint?.message;
          const isMandatoryHitlApproval =
            execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL';

          if (isMandatoryHitlApproval) {
            stateMachine = transitionStateMachine(
              stateMachine,
              PERSONAL_AGENT_STATES.HITL_BLOCKED,
              {
                reasonCode: 'MANDATORY_HITL_APPROVAL',
                blockedAction: execution?.stopPoint?.blockedAction || null,
                blockedStep: execution?.stopPoint?.blockedStep || null,
                hitlItemId:
                  onboardingQuestion?.hitlItem?.id || execution?.stopPoint?.hitlItemId || null,
              }
            );
          }

          // ── Parent-Plan Resume Status Transparency ──
          // Wenn wir von einem resolved Zwischen-Intent zurückkehren,
          // zeigen wir dem Nutzer das Ziel + bestätigte Daten, nicht nur die nächste Frage
          let statusPrefix = '';
          const resumableFrame = findResumableParentFrame(session.planStack);
          const resolvedParamKeys = Object.keys(session.resolvedParams || {});
          if (resumableFrame?.parentFrame && resolvedParamKeys.length > 0) {
            const summaryParts = ['Wir arbeiten weiter an Ihrer Anfrage'];
            const ackKeys = resolvedParamKeys.slice(0, 3);
            const ackData = ackKeys
              .map((key) => `${key}: ${session.resolvedParams[key]}`)
              .join(', ');
            if (ackData) {
              summaryParts.push(`Die bisher bestätigten Daten (${ackData}) bleiben erhalten.`);
            }
            statusPrefix = `${summaryParts.join('. ')}\n\n`;
          }

          const missingParams = Array.isArray(execution?.stopPoint?.missingParams)
            ? execution.stopPoint.missingParams
            : [];

          if (questionText) {
            let hitlOnboardingQuestion = onboardingQuestion;
            let replyMarkdown = questionText;
            let onboardingNextActions = [];

            if (isMandatoryHitlApproval) {
              hitlOnboardingQuestion = this.buildHitlOnboardingQuestion(
                execution?.stopPoint || {},
                responsePlan
              );
              replyMarkdown = this.buildHitlApprovalMarkdown(hitlOnboardingQuestion);
              onboardingNextActions = [
                {
                  label: 'Freigabe öffnen',
                  action: 'open_hitl_item',
                  hitlItemId:
                    hitlOnboardingQuestion?.hitlItem?.id || execution?.stopPoint?.hitlItemId,
                },
              ];
            } else {
              const empathetic = await this.buildEmpathethicOnboardingReply({
                message: ctx.params.message,
                execution,
                plan: responsePlan,
                executionTrace,
              });
              replyMarkdown = empathetic.markdown || questionText;
              onboardingNextActions = empathetic.nextActions || [];
            }

            synthesisText = statusPrefix + replyMarkdown;

            presentationApplied = true;
            presentationType = 'conversational_onboarding';
            presentationResult = {
              type: 'conversational_onboarding',
              markdown: synthesisText,
              warnings: missingParams.map((param) => `missing_context:${param}`),
              presentation: {
                type: 'conversational_onboarding',
                title: 'Fehlende Eingaben',
                summary: isMandatoryHitlApproval
                  ? 'Für den nächsten Schritt ist eine Freigabe erforderlich.'
                  : 'Bitte ergänzen Sie die fehlenden Angaben, damit die Ausführung fortgesetzt werden kann.',
                markdown: replyMarkdown,
                warnings: missingParams.map((param) => `missing_context:${param}`),
                sections: [
                  {
                    key: 'onboarding',
                    title: 'Benötigte Angaben',
                    body: replyMarkdown,
                  },
                ],
                nextActions: onboardingNextActions,
                structuredData: {
                  reasonCode: execution?.stopPoint?.reasonCode || 'MISSING_INPUTS',
                  blockedAction: execution?.stopPoint?.blockedAction || null,
                  blockedStep: execution?.stopPoint?.blockedStep || null,
                  missingParams,
                  onboardingQuestion:
                    (isMandatoryHitlApproval ? hitlOnboardingQuestion : onboardingQuestion) || null,
                  hitlItem: isMandatoryHitlApproval
                    ? hitlOnboardingQuestion?.hitlItem ||
                      (execution?.stopPoint?.hitlItemId
                        ? { id: execution.stopPoint.hitlItemId, status: 'pending' }
                        : null)
                    : null,
                  nextActions: onboardingNextActions,
                },
              },
            };
          }
        } else if (
          execution?.status === 'completed' &&
          this.hasStructuredExecutionResult(execution)
        ) {
          try {
            const domainResult = this.extractDomainResultFromExecution(execution);
            if (domainResult && Object.keys(domainResult).length > 0) {
              const intent =
                responsePlan?.primaryIntent || responsePlan?.routeKey || 'execution_result';
              const presentationContext = {
                tenantId,
                sessionId,
                processType: responsePlan?.routeKey || null,
                matrixId: domainResult?.matrix?.id || domainResult?.matrixId || null,
                taskId:
                  domainResult?.taskId ||
                  (Array.isArray(domainResult?.matrix?.tasks) && domainResult.matrix.tasks[0]
                    ? domainResult.matrix.tasks[0].taskId || null
                    : null),
                source: 'personal-agent',
              };

              const preferredFormat =
                intent && /vdmi|governance/i.test(String(intent)) ? 'vdmi_matrix_table' : 'auto';

              presentationResult = await ctx.call(
                'presentation.render',
                {
                  intent,
                  audience: 'management',
                  preferredFormat,
                  domainResult,
                  context: presentationContext,
                  locale: 'de-DE',
                },
                { meta: { ...ctx.meta, $gateway: false } }
              );

              if (
                presentationResult &&
                typeof presentationResult === 'object' &&
                presentationResult.markdown
              ) {
                presentationApplied = true;
                presentationType =
                  presentationResult?.presentation?.type || presentationResult?.type || null;
              }
            }
          } catch (error) {
            this.logger?.warn(`Presentation render failed (non-blocking): ${error.message}`);
            presentationApplied = false;
          }
        }

        const executionResponsePolicyContract = this.buildResponsePolicyContract({
          message: ctx.params.message,
          workflowType: responsePlan?.workflowType || semanticClassification?.workflowType || null,
          domainIntent:
            responsePlan?.domainIntent ||
            responsePlan?.primaryIntent ||
            semanticClassification?.domainIntent ||
            null,
          knownContext: preflightKnownContext,
          receiptKnowledgeEvidence: receiptSelectionResult?.knowledgeEvidence || null,
          responsePlan,
          execution,
          evidencePlan: receiptExecutionUsed ? null : responsePlan?.evidencePlan || null,
        });

        const _executionEvidenceCandidates = this.buildEvidenceRequirementsForRevalidation({
          tenantId,
          sessionId,
          personaId: rawKnownContext?.personaId || null,
          responsibleRole: rawKnownContext?.responsibleRole || null,
          missingEvidence: executionResponsePolicyContract.missingEvidence,
          evidencePlan: receiptExecutionUsed ? null : responsePlan?.evidencePlan || null,
          execution,
        });
        if (_executionEvidenceCandidates.length > 0) {
          this.recordEvidenceRequirementsForRevalidation(ctx, _executionEvidenceCandidates).catch(
            (err) => this.logger?.warn(`evidence requirement recording failed: ${err.message}`)
          );
        }

        const executionTimeoutFallback =
          execution?.status === 'partial' ||
          execution?.status === 'timeout' ||
          execution?.stopPoint?.reasonCode === 'TIMEOUT';
        const executionGuardedReply = this.applyResponsePolicyGuardrails({
          reply: presentationApplied ? presentationResult.markdown : synthesisText,
          contract: executionResponsePolicyContract,
          timeoutFallback: executionTimeoutFallback,
        });
        const responseReply = this.appendGroundingContractToReply(executionGuardedReply.reply, {
          execution,
          knowledgeScope: [
            ...(session.l3?.knowledgeScopeDataPoints || []),
            ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
          ],
          missingEvidence: executionResponsePolicyContract.missingEvidence,
          assumptions: execution?.assumptions,
        });
        turnGraph = addNode(turnGraph, {
          id: 'answer:final',
          type: 'answer',
          label: 'Final answer',
          data: {
            status,
            presentationApplied,
            replyLength: String(responseReply || '').length,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'chat:mode',
          to: 'answer:final',
          type: 'produces',
        });
        turnGraph = finalizeTurnGraph(turnGraph, {
          status: status === 'completed' ? 'completed' : 'incomplete',
        });

        const finalized = synthesizeAndPurgeLayer4(stackResult.stack, responseReply);
        stateMachine = transitionStateMachine(
          stateMachine,
          deriveTerminalState({ execution, status }),
          {
            status,
            stopReason: execution?.stopPoint?.reasonCode || null,
            presentationApplied,
          }
        );
        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: {
            ...finalized.stack.l3,
            chatMode: effectiveChatMode,
            chatModeSource,
            lastClassification: session.l3.lastClassification,
            stateMachine: summarizeStateMachine(stateMachine),
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            turnGraph: summarizeTurnGraph(turnGraph),
            responseStrategy,
          },
          createdAt: session.createdAt,
        });
        persisted.l3.onboardingQuestions = Array.isArray(session.l3?.onboardingQuestions)
          ? session.l3.onboardingQuestions
          : [];
        persisted.l3.chatMode = effectiveChatMode;
        persisted.l3.consultationContext = null;
        persisted.l3.assumptions = this.mergeAssumptions(
          session.l3?.assumptions || [],
          execution?.assumptions || []
        );
        persisted.l3.planStack = Array.isArray(session.planStack) ? session.planStack : [];
        persisted.l3.resolvedParams =
          session.resolvedParams && typeof session.resolvedParams === 'object'
            ? session.resolvedParams
            : {};
        persisted.l3.lastCompletedPlan =
          session.l3?.lastCompletedPlan && typeof session.l3.lastCompletedPlan === 'object'
            ? session.l3.lastCompletedPlan
            : null;
        persisted.l3.stopPoint =
          execution?.stopPoint && typeof execution.stopPoint === 'object'
            ? execution.stopPoint
            : null;
        persisted.l3.criticalStepCheckpoints =
          session.l3?.criticalStepCheckpoints &&
          typeof session.l3.criticalStepCheckpoints === 'object'
            ? session.l3.criticalStepCheckpoints
            : {};

        assertNoL4RawInPersistedState(persisted);
        await this.persistSession(ctx, tenantId, sessionId, persisted);

        // Schedule (or re-schedule) the post-session Dream pipeline
        await cancelDream(tenantId, sessionId);
        const profileNs = tenantNamespace(PROFILE_NAMESPACE, tenantId);
        await scheduleDream({
          broker: this.broker,
          sessionId,
          tenantId,
          userId,
          profileNamespace: profileNs,
          authMeta: this.buildDreamAuthMeta(ctx.meta, tenantId, userId),
          runFn: async (payload) => {
            await this.runDream(this.broker, payload);
          },
        });

        knowledgeContext = null;
        execution.meta = executionTrace.summarize({
          toolCalls: toolCallTracker.summarize().calls,
          chatModeSource,
          presentationApplied,
        });
        const quality = this.buildQualitySummary({
          evidencePlan: responsePlan.evidencePlan || null,
          execution,
          consultation: null,
        });
        // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
        // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
        // v0.56.3 — ZNP context signals
        const _hitlItemId4 = ctx.params?.knownContext?.hitlItemId ?? null;
        const _handoffCtx4 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId4);
        const _znpCtx4 = buildZnpContextSnapshot(ctx, session, semanticClassification);
        const personaResolution = await this.resolvePersonaForTrace(ctx, {
          tenantId,
          sessionId,
          sourceService: 'personal-agent',
          sourceAction: 'chat',
          workflowType:
            executionResponsePolicyContract?.workflowType ??
            semanticClassification?.workflowType ??
            null,
          domainIntent:
            executionResponsePolicyContract?.domainIntent ??
            semanticClassification?.domainIntent ??
            null,
          ..._znpCtx4,
          handoffPersonaId: _handoffCtx4.handoffPersonaId,
          hitlItemId: _hitlItemId4,
          workflowCompletionState: _handoffCtx4.workflowCompletionState,
        });
        const agentTrace = this.buildAgentTrace({
          routing: {
            source: responsePlan.source,
            routeKey: responsePlan.routeKey,
            routeLabel: responsePlan.routeLabel,
            primaryIntent: responsePlan.primaryIntent,
            warnings: responsePlan.warnings,
          },
          plan: responsePlan,
          execution,
          evidencePlan: responsePlan.evidencePlan || null,
          consultation: null,
          responseStrategy,
          stateMachine,
          executionStateGraph,
          turnGraph,
          routingDecision,
          personaResolution,
          bootstrapContext,
          knowledgeScope: [
            ...(session.l3?.knowledgeScopeDataPoints || []),
            ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
          ],
          workLog: turnWorkLog.toArray(),
          locationResolution: brokerKnownContext._locationResolutionTrace || null, // v0.60
        });

        // Log completion
        if (jobStore) {
          jobStore.appendLog(jobId, 'chat_complete', 100, `Chat completed with status=${status}`, {
            status,
            presentationApplied,
            replyLength: String(responseReply || '').length,
          });
        }

        return {
          success: true,
          status,
          sessionId,
          executionMode,
          chatMode: effectiveChatMode,
          reply: responseReply,
          workflowType: executionResponsePolicyContract.workflowType,
          domainIntent: executionResponsePolicyContract.domainIntent,
          evidenceStatus: executionResponsePolicyContract.evidenceStatus,
          missingEvidence: executionResponsePolicyContract.missingEvidence,
          nextVerificationSteps: executionResponsePolicyContract.nextVerificationSteps,
          guardrailCorrections: executionGuardedReply.guardrailCorrections,
          presentationApplied,
          presentationType: presentationType || null,
          presentation: presentationApplied
            ? {
                ...(presentationResult.presentation || {}),
                type: presentationType || presentationResult?.type || null,
                title: presentationResult?.presentation?.title || null,
                summary: presentationResult?.presentation?.summary || null,
                markdown: presentationResult.markdown,
                warnings:
                  presentationResult?.presentation?.warnings || presentationResult?.warnings || [],
                sections: Array.isArray(presentationResult?.presentation?.sections)
                  ? presentationResult.presentation.sections
                  : [],
                tables: Array.isArray(presentationResult?.presentation?.tables)
                  ? presentationResult.presentation.tables
                  : [],
                kpis: Array.isArray(presentationResult?.presentation?.kpis)
                  ? presentationResult.presentation.kpis
                  : [],
                sources: Array.isArray(presentationResult?.presentation?.sources)
                  ? presentationResult.presentation.sources
                  : [],
                nextActions: Array.isArray(presentationResult?.presentation?.nextActions)
                  ? presentationResult.presentation.nextActions
                  : [],
              }
            : null,
          layer4Purged: finalized.layer4Purged,
          l3Compressed: Boolean(finalized.stack?.l3?.compressed),
          responseStrategy,
          contextUsage: stackResult.usage,
          historyCount: finalized.stack?.l3?.history?.length || 0,
          fileProcessing,
          routing: {
            source: responsePlan.source,
            routeKey: responsePlan.routeKey,
            routeLabel: responsePlan.routeLabel,
            primaryIntent: responsePlan.primaryIntent,
            secondaryIntents: responsePlan.secondaryIntents,
            requestedDomains: responsePlan.requestedDomains,
            unsupportedDomains: responsePlan.unsupportedDomains,
            warnings: responsePlan.warnings,
            chatMode: effectiveChatMode,
          },
          plan: {
            status: responsePlan.status,
            steps: responsePlan.steps,
            onboardingHints: responsePlan.onboardingHints,
          },
          evidencePlan: responsePlan.evidencePlan || null,
          evidenceGaps: Array.isArray(responsePlan?.evidencePlan?.gaps)
            ? responsePlan.evidencePlan.gaps
            : [],
          evidenceConfidence:
            typeof responsePlan?.evidencePlan?.confidence === 'number'
              ? responsePlan.evidencePlan.confidence
              : null,
          quality,
          agentTrace,
          stateMachine: summarizeStateMachine(stateMachine),
          executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
          turnGraph: summarizeTurnGraph(turnGraph),
          execution,
          ...(receiptSelectionMetadata ? { metadata: receiptSelectionMetadata } : {}),
        };
      },
    },

    getSession: {
      rest: 'GET /session/:sessionId',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Load persisted Personal-Agent session (L3 history)',
        description:
          'Returns persisted session state for UI reload. Includes Layer 3 history/summary and profile metadata. ' +
          'Layer 4 is never returned because it is transient.',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
            description: 'Personal-Agent session ID',
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const session = await this.loadSession(ctx, tenantId, ctx.params.sessionId, userId);

        return {
          success: true,
          sessionId: session.id,
          chatMode: session.chatMode || session?.l3?.chatMode || CHAT_MODES.CONSULTATION,
          chatModeSource: session?.l3?.chatModeSource || null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          stateMachine:
            session?.l3?.stateMachine && typeof session.l3.stateMachine === 'object'
              ? session.l3.stateMachine
              : null,
          executionStateGraph:
            session?.l3?.executionStateGraph && typeof session.l3.executionStateGraph === 'object'
              ? session.l3.executionStateGraph
              : null,
          turnGraph:
            session?.l3?.turnGraph && typeof session.l3.turnGraph === 'object'
              ? session.l3.turnGraph
              : null,
          planStack: Array.isArray(session?.l3?.planStack) ? session.l3.planStack : [],
          resolvedParams:
            session?.l3?.resolvedParams && typeof session.l3.resolvedParams === 'object'
              ? session.l3.resolvedParams
              : {},
          l2: session.l2,
          l3: session.l3,
          layer4: null,
        };
      },
    },

    pullProactiveMessages: {
      rest: 'GET /session/:sessionId/proactive-messages',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
        personaId: { type: 'string', optional: true, trim: true, max: 180 },
        limit: {
          type: 'number',
          optional: true,
          convert: true,
          integer: true,
          min: 1,
          max: 100,
          default: 20,
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Pull queued proactive persona messages for the current session',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
          },
          {
            in: 'query',
            name: 'personaId',
            required: false,
            schema: { type: 'string', example: 'tenant-a/thorsten-human' },
          },
          {
            in: 'query',
            name: 'limit',
            required: false,
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const sessionId = String(ctx.params.sessionId || '').trim();
        const explicitPersonaId = String(ctx.params.personaId || '').trim() || null;
        const limit = Number(ctx.params.limit || 20);

        await this.loadSession(ctx, tenantId, sessionId, userId, { createIfMissing: true });

        const persona = await this.resolvePersonaForSession(ctx, {
          tenantId,
          sessionId,
          personaId: explicitPersonaId,
        });

        if (!persona?.id) {
          return {
            success: true,
            sessionId,
            personaId: null,
            count: 0,
            proactiveMessages: [],
          };
        }

        const pending = await this.fetchPendingPersonaInboxMessages(ctx, {
          tenantId,
          personaId: persona.id,
          sessionId,
          limit,
        });

        return {
          success: true,
          sessionId,
          personaId: persona.id,
          count: pending.length,
          proactiveMessages: pending.map((item) => this.toPublicProactiveMessage(item)),
        };
      },
    },

    acknowledgeProactiveMessage: {
      rest: 'POST /session/:sessionId/proactive-messages/:id/acknowledge',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
        id: { type: 'string', min: 1, trim: true, max: 120 },
        personaId: { type: 'string', optional: true, trim: true, max: 180 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Acknowledge a proactive persona message',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
          },
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', example: 'inbox-1' },
          },
          {
            in: 'query',
            name: 'personaId',
            required: false,
            schema: { type: 'string', example: 'tenant-a/thorsten-human' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {},
              },
              examples: {
                default: {
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const sessionId = String(ctx.params.sessionId || '').trim();
        const explicitPersonaId = String(ctx.params.personaId || '').trim() || null;

        await this.loadSession(ctx, tenantId, sessionId, userId, { createIfMissing: true });
        const persona = await this.resolvePersonaForSession(ctx, {
          tenantId,
          sessionId,
          personaId: explicitPersonaId,
        });

        if (!persona?.id) {
          throw new MoleculerClientError(
            'Persona not resolved for session',
            404,
            'PERSONA_SESSION_NOT_RESOLVED'
          );
        }

        const response = await ctx.call(
          'persona-inbox.acknowledge',
          {
            tenantId,
            id: ctx.params.id,
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );

        return {
          success: true,
          sessionId,
          personaId: persona.id,
          item: this.toPublicProactiveMessage(response?.item || {}),
        };
      },
    },

    resetSession: {
      rest: 'POST /session/:sessionId/reset',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Reset chat context stack for a session (keeps hard user profile L2)',
        description:
          'Flushes conversational Layer 3 for the given session while keeping the persisted Layer 2 profile.',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
            description: 'Session ID to reset',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', default: 'manual-reset', example: 'manual-reset' },
                },
              },
              examples: {
                default: {
                  summary: 'Reset request payload (optional metadata)',
                  value: { reason: 'manual-reset' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const current = await this.loadSession(ctx, tenantId, ctx.params.sessionId, userId);
        const resetState = buildPersistableSessionState({
          id: current.id,
          tenantId,
          userId,
          l1: { tenantFacts: current.l1?.tenantFacts || [] },
          l2: current.l2,
          l3: {
            history: [],
            fileAttachments: [],
            summary: null,
            compressed: false,
            chatMode: 'auto',
            chatModeSource: null,
            lastClassification: null,
            consultationContext: null,
            planStack: Array.isArray(current?.l3?.planStack) ? current.l3.planStack : [],
            resolvedParams:
              current?.l3?.resolvedParams && typeof current.l3.resolvedParams === 'object'
                ? current.l3.resolvedParams
                : {},
            stateMachine: null,
            executionStateGraph: null,
            turnGraph: null,
          },
          createdAt: current.createdAt,
        });
        resetState.l3.onboardingQuestions = [];
        resetState.l3.assumptions = [];

        await this.persistSession(ctx, tenantId, current.id, resetState);

        return {
          success: true,
          sessionId: current.id,
          reset: true,
          keptLayer2: true,
        };
      },
    },

    'dream-pipeline': {
      params: {
        tenantId: { type: 'string', optional: true, trim: true, min: 1, max: 120 },
        sessionId: { type: 'string', trim: true, min: 1, max: 120 },
        userId: { type: 'string', optional: true, trim: true, min: 1, max: 120 },
      },
      async handler(ctx) {
        const tenantId = String(ctx.params.tenantId || getTenantId(ctx) || 'default');
        const sessionId = String(ctx.params.sessionId || '').trim();
        const userId = String(ctx.params.userId || ctx.meta?.authUser?.userId || 'anonymous');

        try {
          await this.broker.waitForServices(['object-store'], 10_000);
        } catch (_err) {
          return {
            success: false,
            sessionId,
            tenantId,
            status: 'deferred',
            reason: 'DEPENDENCY_NOT_READY',
          };
        }

        const profileNamespace = tenantNamespace(PROFILE_NAMESPACE, tenantId);

        await this.runDream(this.broker, {
          tenantId,
          sessionId,
          userId,
          profileNamespace,
          authMeta: this.buildDreamAuthMeta(ctx.meta, tenantId, userId),
        });

        return {
          success: true,
          sessionId,
          tenantId,
          status: 'processed',
        };
      },
    },

    getDreamStatus: {
      rest: 'GET /session/:sessionId/dream-status',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Get Dream-pipeline status for a session',
        description:
          'Returns whether the post-session Dream pipeline is currently pending (timer running) ' +
          'or idle for the given sessionId. The Dream runs after the inactivity timeout configured ' +
          'via DREAM_INACTIVITY_MS (default 5 min) and enriches L2 user profile and L1 tenant memory.',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
            description: 'Session ID to inspect dream timer state for',
          },
        ],
        responses: {
          200: {
            description: 'Dream status for the session',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    sessionId: { type: 'string' },
                    dreamPending: {
                      type: 'boolean',
                      description: 'true if inactivity timer is active',
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const sessionId = String(ctx.params.sessionId);
        const tenantId = getTenantId(ctx);
        return {
          success: true,
          sessionId,
          dreamPending: isDreamPending(tenantId, sessionId),
        };
      },
    },

    getDreamAudit: {
      rest: 'GET /dream-audit',
      params: {
        limit: {
          type: 'number',
          integer: true,
          min: 1,
          max: 200,
          optional: true,
          default: 50,
          convert: true,
        },
        offset: {
          type: 'number',
          integer: true,
          min: 0,
          optional: true,
          default: 0,
          convert: true,
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'List Dream-pipeline audit trail entries for the current tenant',
        description:
          'Returns the append-only Dream audit log for the authenticated tenant. ' +
          'Each entry records a Dream pipeline run with fact counts, conflict/retry stats, ' +
          'L1/L2 enrichment results, and a SHA-256 integrity hash. ' +
          'Entries are scoped to the tenant and sorted newest-first.',
        parameters: [
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', default: 50 },
            description: 'Maximum number of audit entries to return (1–200)',
          },
          {
            in: 'query',
            name: 'offset',
            schema: { type: 'integer', default: 0 },
            description: 'Pagination offset',
          },
        ],
        responses: {
          200: {
            description: 'Dream audit trail entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    total: { type: 'integer' },
                    entries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                          sessionId: { type: 'string' },
                          startedAt: { type: 'string' },
                          finishedAt: { type: 'string' },
                          l1FactsAdded: { type: 'integer' },
                          l2Conflicts: { type: 'integer' },
                          integrityHash: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const namespace = `${DREAM_AUDIT_NAMESPACE}:${tenantId}`;
        const limit = ctx.params.limit || 50;
        const offset = ctx.params.offset || 0;

        let docs = [];
        try {
          const result = await ctx.call(
            'object-store.query',
            { namespace, limit: limit + offset },
            { meta: ctx.meta }
          );
          docs = Array.isArray(result?.docs) ? result.docs : [];
        } catch (err) {
          if (
            err?.code === 'NOT_FOUND' ||
            err?.type === 'NOT_FOUND' ||
            err?.message?.includes('not found')
          ) {
            docs = [];
          } else {
            throw err;
          }
        }

        // Sort newest-first by key (keys start with 'dream:<ISO timestamp>')
        docs.sort((a, b) => (b.key || '').localeCompare(a.key || ''));
        const page = docs.slice(offset, offset + limit);

        return {
          success: true,
          total: docs.length,
          limit,
          offset,
          entries: page.map((d) => ({ key: d.key, ...(d.payload || {}) })),
        };
      },
    },
  },

  methods: {
    async _executeChatCoreLogic(ctx) {
      const chatActionSchema = this?.schema?.actions?.chat;
      const chatCore = chatActionSchema?._executeChatCoreLogic;
      if (typeof chatCore !== 'function') {
        throw new Error('personal-agent.chat core handler is not available');
      }
      return await chatCore.call(this, ctx);
    },

    buildResponseStrategy(input = {}) {
      return buildPersonalAgentResponseStrategy(input);
    },

    buildStrategyLead(responseStrategy = null) {
      return buildPersonalAgentStrategyLead(responseStrategy || {});
    },

    resolveConsultationSynthesisTimeoutMs() {
      const raw = Number(
        process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS ||
          PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT
      );

      if (!Number.isFinite(raw) || raw < 1_000) {
        return PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT;
      }

      return Math.floor(raw);
    },

    collectAllowedLegalRefs({
      knownContext = {},
      verifiedFacts = [],
      workflowType = '',
      domainIntent = '',
    } = {}) {
      const refs = new Set();
      const refRegex = /§\s*\d+[a-zA-Z]*\s*EnWG/gi;
      const register = (value) => {
        if (value == null) {
          return;
        }

        if (Array.isArray(value)) {
          value.forEach((item) => register(item));
          return;
        }

        const text = String(value);
        const matches = text.match(refRegex) || [];
        matches.forEach((match) => refs.add(String(match).replace(/\s+/g, ' ').trim()));
      };

      register(knownContext?.allowedLegalRefs);
      register(knownContext?.legalReferences);
      register(knownContext?.legalReference);
      register(knownContext?.regulatoryFrame);

      (Array.isArray(verifiedFacts) ? verifiedFacts : []).forEach((fact) => {
        register(fact?.value);
        register(fact?.source);
      });

      const workflowSignal = [workflowType, domainIntent].filter(Boolean).join(' ').toLowerCase();

      if (
        /(wallbox|prosumer|nap|pv|heat|waermepumpe|wärmepumpe|bess|storage)/i.test(workflowSignal)
      ) {
        refs.add('§ 14a EnWG');
      }
      if (/(dynamic|dynamisch|tariff|tarif)/i.test(workflowSignal)) {
        refs.add('§ 41a EnWG');
      }
      if (/(mieterstrom|tenant)/i.test(workflowSignal)) {
        refs.add('§ 42c EnWG');
      }

      return Array.from(refs);
    },

    buildResponsePolicyContract({
      message = '',
      workflowType = null,
      domainIntent = null,
      knownContext = {},
      receiptKnowledgeEvidence = null,
      responsePlan = null,
      observations = [],
      execution = null,
      evidencePlan = null,
      verifiedFacts = [],
    } = {}) {
      const resolvedWorkflowType =
        workflowType ||
        responsePlan?.workflowType ||
        responsePlan?.executionReadiness?.workflowType ||
        'consultation_general';
      const resolvedDomainIntent =
        domainIntent ||
        responsePlan?.domainIntent ||
        responsePlan?.primaryIntent ||
        'consultation_general';

      const observationFacts = (Array.isArray(observations) ? observations : [])
        .filter((obs) => obs?.status === 'completed')
        .map((obs) => ({
          source: obs?.action || 'tool',
          value: String(obs?.summary || obs?.result?.description || 'completed').slice(0, 220),
        }));

      const executionFacts = (Array.isArray(execution?.steps) ? execution.steps : [])
        .filter((step) => step?.status === 'completed')
        .map((step) => ({
          source: step?.action || 'step',
          value: String(step?.purpose || step?.status || 'completed').slice(0, 220),
        }));

      const normalizedVerifiedFacts = [
        ...(Array.isArray(verifiedFacts) ? verifiedFacts : []).map((item) => {
          if (item && typeof item === 'object') {
            return {
              source: String(item.source || 'fact').slice(0, 160),
              value: String(item.value || '').slice(0, 220),
            };
          }
          return {
            source: 'fact',
            value: String(item || '').slice(0, 220),
          };
        }),
        ...observationFacts,
        ...executionFacts,
      ].filter((fact) => Boolean(fact.value));

      const knowledgeEvidence =
        receiptKnowledgeEvidence && typeof receiptKnowledgeEvidence === 'object'
          ? receiptKnowledgeEvidence
          : null;
      const knowledgeStatus = String(knowledgeEvidence?.status || '').toLowerCase();
      const knowledgeRequired = knowledgeEvidence?.required === true;
      const knowledgeHits = Array.isArray(knowledgeEvidence?.hits) ? knowledgeEvidence.hits : [];

      const knowledgeFacts = knowledgeHits
        .slice(0, 4)
        .map((hit) => ({
          source: String(hit?.source || 'knowledge').slice(0, 160),
          value: String(hit?.summary || '').slice(0, 220),
        }))
        .filter((entry) => entry.value);

      normalizedVerifiedFacts.push(...knowledgeFacts);

      const hasVerifiedVnbLookup =
        (Array.isArray(observations) ? observations : []).some(
          (obs) =>
            obs?.action === 'grid-operations.vnbLookup' &&
            obs?.status === 'completed' &&
            !obs?.error &&
            obs?.result?.error == null
        ) ||
        (Array.isArray(execution?.steps) ? execution.steps : []).some(
          (step) =>
            step?.action === 'grid-operations.vnbLookup' &&
            step?.status === 'completed' &&
            !step?.error &&
            step?.result?.error == null
        );

      const hasMarketPartnersContext = (Array.isArray(observations) ? observations : []).some(
        (obs) => obs?.action === 'grid-operations.marketPartners'
      );
      const hasVnbEvidenceSignal =
        /(?:\bvnb\b|\bnetzbetreiber\b|\bnetzgebiet\b|\bnetzzone\b|\bstandort\b|\banschluss\b|\bbdew\b|\bmarktlokation\b|\bnetzanschlusspunkt\b)/i.test(
          String(message || '')
        ) ||
        hasMarketPartnersContext ||
        Boolean(
          knownContext?.gridOperatorName ||
          knownContext?.assertedGridOperatorName ||
          knownContext?.bdew ||
          knownContext?.bdewCode ||
          knownContext?.vnbName ||
          knownContext?.operatorEvidence ||
          knownContext?.gridOperatorBdew
        );

      const missingEvidence = [];
      if (hasVnbEvidenceSignal && !hasVerifiedVnbLookup) {
        missingEvidence.push({
          id: 'vnb_lookup_required',
          label: 'Dedizierter VNB-/Netzgebietslookup fehlt.',
          severity: 'high',
        });
      }

      (Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : []).slice(0, 10).forEach((gap) => {
        missingEvidence.push({
          id: String(gap?.id || gap?.requirementId || 'evidence_gap'),
          label: String(gap?.required || gap?.label || 'Fehlende Evidenz').slice(0, 220),
          severity: String(gap?.severity || 'medium'),
        });
      });

      if (knowledgeRequired && knowledgeStatus && knowledgeStatus !== 'available') {
        missingEvidence.push({
          id: 'receipt_knowledge_required',
          label: 'Receipt fordert Knowledge-Evidenz, aber sie ist derzeit nicht verfügbar.',
          severity: knowledgeStatus === 'timeout' ? 'high' : 'medium',
        });
      }

      if (knowledgeStatus === 'timeout') {
        missingEvidence.push({
          id: 'knowledge_evidence_timeout',
          label: 'Knowledge-Evidenz konnte wegen Timeout nicht geladen werden.',
          severity: knowledgeRequired ? 'high' : 'medium',
        });
      }

      if (knowledgeStatus === 'unavailable') {
        missingEvidence.push({
          id: 'knowledge_evidence_unavailable',
          label: 'Knowledge Service ist derzeit nicht verfügbar.',
          severity: knowledgeRequired ? 'high' : 'low',
        });
      }

      const unverifiedAssumptions = [];
      if (hasVnbEvidenceSignal && !hasVerifiedVnbLookup) {
        unverifiedAssumptions.push({
          type: 'location_operator_unverified',
          statement:
            'Die Zuständigkeit des VNB ist ohne dedizierten Lookup nicht belastbar verifiziert.',
          confidence: 'low',
        });
      }

      if (knowledgeRequired && knowledgeStatus && knowledgeStatus !== 'available') {
        unverifiedAssumptions.push({
          type: 'knowledge_evidence_missing',
          statement:
            'Receipt-spezifische Knowledge-Evidenz ist derzeit nicht verifiziert verfügbar.',
          confidence: 'low',
        });
      }

      const nextVerificationSteps = [];
      if (missingEvidence.some((item) => item.id === 'vnb_lookup_required')) {
        nextVerificationSteps.push({
          action: 'grid-operations.vnbLookup',
          description: 'Zuständigen VNB über dedizierten Netzgebietslookup verifizieren.',
        });
      }

      if (knowledgeRequired && knowledgeStatus && knowledgeStatus !== 'available') {
        nextVerificationSteps.push({
          action: 'knowledge-rag.query',
          description: 'Receipt-spezifische Knowledge-Evidenz erneut laden und verifizieren.',
        });
      }

      (Array.isArray(evidencePlan?.nextSteps) ? evidencePlan.nextSteps : [])
        .slice(0, 5)
        .forEach((step) => {
          nextVerificationSteps.push({
            action: String(step?.action || 'evidence_step').slice(0, 100),
            description: String(step?.description || step?.label || 'Evidenz ergänzen').slice(
              0,
              220
            ),
          });
        });

      const allowedLegalRefs = this.collectAllowedLegalRefs({
        knownContext,
        verifiedFacts: normalizedVerifiedFacts,
        workflowType: resolvedWorkflowType,
        domainIntent: resolvedDomainIntent,
      });

      const evidenceStatus =
        normalizedVerifiedFacts.length > 0 && missingEvidence.length === 0
          ? 'verified'
          : normalizedVerifiedFacts.length > 0
            ? 'partial'
            : 'unverified';

      return {
        workflowType: resolvedWorkflowType,
        domainIntent: resolvedDomainIntent,
        verifiedFacts: normalizedVerifiedFacts.slice(0, 12),
        unverifiedAssumptions,
        missingEvidence,
        forbiddenClaims: [
          'no_unverified_vnb_assertion',
          'no_unbacked_legal_reference',
          'no_timeout_relief_without_evidence',
          'no_workflow_mismatch_claim',
          'no_knowledge_overclaim_without_evidence',
        ],
        nextVerificationSteps,
        allowedLegalRefs,
        evidenceStatus,
      };
    },

    buildConservativeResponseFromContract(contract = {}) {
      const facts = Array.isArray(contract?.verifiedFacts) ? contract.verifiedFacts : [];
      const missingEvidence = Array.isArray(contract?.missingEvidence)
        ? contract.missingEvidence
        : [];
      const nextSteps = Array.isArray(contract?.nextVerificationSteps)
        ? contract.nextVerificationSteps
        : [];

      const factSummary =
        facts.length > 0
          ? `Vorliegende Evidenz: ${facts
              .slice(0, 3)
              .map((fact) => `${fact.source}: ${fact.value}`)
              .join('; ')}.`
          : 'Derzeit liegt keine vollständige, belastbare Evidenz vor.';
      const missingSummary =
        missingEvidence.length > 0
          ? `Offene Evidenz: ${missingEvidence
              .slice(0, 3)
              .map((item) => item.label)
              .join('; ')}.`
          : '';
      const nextSummary =
        nextSteps.length > 0
          ? `Nächste Verifikation: ${nextSteps
              .slice(0, 2)
              .map((step) => step.description)
              .join('; ')}.`
          : 'Nächste Verifikation: Bitte fehlende Evidenz gezielt ergänzen.';

      return [
        'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen.',
        factSummary,
        missingSummary,
        nextSummary,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
    },

    buildEvidenceRequirementsForRevalidation({
      tenantId,
      sessionId,
      personaId,
      responsibleRole,
      missingEvidence = [],
      evidencePlan = null,
      execution = null,
    } = {}) {
      if (!personaId && !responsibleRole) return [];

      const candidates = [];
      const seen = new Set();

      const addCandidate = (requestedFact, scope) => {
        if (seen.has(requestedFact)) return;
        seen.add(requestedFact);
        const candidate = {
          evidenceRequirementId: `evreq:${sessionId}:${requestedFact}`,
          originSessionId: sessionId,
          requestedFact,
          scope,
        };
        if (personaId) candidate.originPersonaId = personaId;
        if (responsibleRole) candidate.responsibleRole = responsibleRole;
        candidates.push(candidate);
      };

      const GRID_OPERATOR_MISSING_IDS = new Set([
        'vnb_lookup_required',
        'gridOperatorBdew',
        'bdew',
        'bdewCode',
        'operatorEvidence',
      ]);
      const GRID_OPERATOR_PARAMS = new Set([
        'gridOperatorBdew',
        'bdew',
        'bdewCode',
        'gridOperatorId',
        'gridOperatorName',
        'vnbName',
      ]);

      const safeMissingEvidence = Array.isArray(missingEvidence) ? missingEvidence : [];
      if (safeMissingEvidence.some((e) => GRID_OPERATOR_MISSING_IDS.has(e?.id))) {
        addCandidate('gridOperatorBdew', 'tenant_candidate');
      }

      const stopMissingParams = Array.isArray(execution?.stopPoint?.missingParams)
        ? execution.stopPoint.missingParams
        : [];
      if (stopMissingParams.some((p) => GRID_OPERATOR_PARAMS.has(p))) {
        addCandidate('gridOperatorBdew', 'tenant_candidate');
      }

      const gaps = Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : [];
      if (gaps.some((g) => GRID_OPERATOR_MISSING_IDS.has(g?.id || g?.requirementId))) {
        addCandidate('gridOperatorBdew', 'tenant_candidate');
      }

      return candidates;
    },

    async recordEvidenceRequirementsForRevalidation(ctx, candidates) {
      if (!Array.isArray(candidates) || candidates.length === 0) return;
      const tenantId = getTenantId(ctx);
      for (const candidate of candidates) {
        try {
          await ctx.call(
            'evidence-revalidation.recordRequirement',
            {
              tenantId,
              evidenceRequirementId: candidate.evidenceRequirementId,
              originSessionId: candidate.originSessionId,
              ...(candidate.originPersonaId ? { originPersonaId: candidate.originPersonaId } : {}),
              ...(candidate.responsibleRole ? { responsibleRole: candidate.responsibleRole } : {}),
              requestedFact: candidate.requestedFact,
              scope: candidate.scope,
            },
            { meta: { tenantId, $gateway: false } }
          );
        } catch (error) {
          this.logger?.warn(
            `evidence-revalidation.recordRequirement failed (non-blocking): ${error.message}`
          );
        }
      }
    },

    applyResponsePolicyGuardrails({ reply = '', contract = {}, timeoutFallback = false } = {}) {
      let guardedReply = String(reply || '').trim();
      const guardrailCorrections = [];

      const workflowType = String(contract?.workflowType || '').toLowerCase();
      const missingEvidence = Array.isArray(contract?.missingEvidence)
        ? contract.missingEvidence
        : [];
      const hasUnverifiedVnbGap = missingEvidence.some(
        (item) => item?.id === 'vnb_lookup_required'
      );
      const definiteVnbClaimRegex =
        /(?:zust[äa]ndig(?:e[rn])?|verantwortlich(?:e[rn])?)\b[^.\n]{0,120}\b(?:ist|sei|wird|bleibt)\b/i;

      if (hasUnverifiedVnbGap && definiteVnbClaimRegex.test(guardedReply)) {
        guardedReply = this.buildConservativeResponseFromContract(contract);
        guardrailCorrections.push({
          code: 'UNVERIFIED_VNB_CLAIM_BLOCKED',
          severity: 'high',
          replacement: 'conservative_response',
        });
      }

      const allowedLegalRefs = new Set(
        (Array.isArray(contract?.allowedLegalRefs) ? contract.allowedLegalRefs : []).map((item) =>
          String(item || '')
            .replace(/\s+/g, ' ')
            .trim()
        )
      );
      const legalRefRegex = /§\s*\d+[a-zA-Z]*\s*EnWG/gi;
      const legalRefsInReply = guardedReply.match(legalRefRegex) || [];
      legalRefsInReply.forEach((ref) => {
        const normalized = String(ref || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!allowedLegalRefs.has(normalized)) {
          guardedReply = guardedReply.replace(ref, 'EnWG (Quelle erforderlich)');
          guardrailCorrections.push({
            code: 'UNBACKED_LEGAL_REFERENCE_BLOCKED',
            severity: 'medium',
            reference: normalized,
          });
        }
      });

      const workflowMismatch =
        (workflowType.includes('bess') &&
          /\b(vdmi|governance|asset\s*validation|residual\s*load|forecast)\b/i.test(
            guardedReply
          )) ||
        ((workflowType.includes('governance') || workflowType.includes('vdmi')) &&
          /\b(bess\s*screening|battery\s*sizing|wallbox|prosumer\s*tarif)\b/i.test(guardedReply)) ||
        (workflowType.includes('edm') &&
          /\b(asset\s*validation|bess\s*screening|residual\s*load\s*forecast)\b/i.test(
            guardedReply
          ));

      if (workflowMismatch) {
        guardedReply = this.buildConservativeResponseFromContract(contract);
        guardrailCorrections.push({
          code: 'WORKFLOW_CONTEXT_MISMATCH_BLOCKED',
          severity: 'high',
          replacement: 'conservative_response',
        });
      }

      const knowledgeTimeoutGap = missingEvidence.some(
        (item) => item?.id === 'knowledge_evidence_timeout'
      );
      const knowledgeRequiredGap = missingEvidence.some(
        (item) => item?.id === 'receipt_knowledge_required'
      );

      if (knowledgeTimeoutGap || knowledgeRequiredGap) {
        const hint =
          'Hinweis: Knowledge-Evidenz ist aktuell nicht verfügbar; die Antwort bleibt konservativ bis zur Verifikation.';
        if (!guardedReply.includes(hint)) {
          guardedReply = `${guardedReply}\n\n${hint}`.trim();
        }
        guardrailCorrections.push({
          code: knowledgeTimeoutGap
            ? 'KNOWLEDGE_EVIDENCE_TIMEOUT_CONSERVATIVE'
            : 'KNOWLEDGE_EVIDENCE_REQUIRED_CONSERVATIVE',
          severity: 'medium',
        });
      }

      if (timeoutFallback && /keine kritischen probleme identifiziert/i.test(guardedReply)) {
        guardedReply = guardedReply.replace(
          /keine kritischen probleme identifiziert/gi,
          'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen'
        );
        guardrailCorrections.push({
          code: 'MISLEADING_TIMEOUT_RELIEF_BLOCKED',
          severity: 'high',
        });
      }

      if (
        timeoutFallback &&
        !/synthese unvollständig; belastbare bewertung nicht abgeschlossen/i.test(guardedReply)
      ) {
        guardedReply =
          `Synthese unvollständig; belastbare Bewertung nicht abgeschlossen. ${guardedReply}`.trim();
      }

      if (!guardedReply) {
        guardedReply = this.buildConservativeResponseFromContract(contract);
        guardrailCorrections.push({
          code: 'EMPTY_REPLY_RECOVERED',
          severity: 'high',
          replacement: 'conservative_response',
        });
      }

      return {
        reply: guardedReply,
        guardrailCorrections,
      };
    },

    /**
     * Wraps buildConsultationExecutionPlan for service-level use.
     * Enhanced with input extraction and routing validation.
     */
    buildConsultationExecutionArtifact(
      _ctx,
      {
        message,
        consultation,
        brokerRecommendation,
        knownContext,
        semanticClassification,
        responseStrategy,
        executionMode,
      }
    ) {
      // 1. Extract available inputs from message, consultation facts, and known context
      const extractedInputs = extractAvailableInputs(
        message,
        consultation?.factsUsed || {},
        knownContext || {}
      );

      // 2. Classify workflow and validate routing intent
      const { classifyWorkflowType } = require('../src/consultation-execution-bridge');
      const workflowType = classifyWorkflowType({
        message,
        consultation: {
          ...(consultation || {}),
          semanticClassification:
            semanticClassification && typeof semanticClassification === 'object'
              ? semanticClassification
              : consultation?.semanticClassification || null,
        },
        knownContext,
        brokerRecommendation,
        extractedInputs,
      });

      const routingValidation = validateRoutingIntent({
        workflowType,
        brokerRecommendation,
        message,
      });

      // 3. Use corrected workflow type if routing validation detected a mismatch
      const finalWorkflowType = routingValidation.correctedWorkflow || workflowType;
      if (!routingValidation.valid) {
        this.logger?.warn('Routing intent mismatch detected', {
          reason: routingValidation.reason,
          originalWorkflow: workflowType,
          correctedWorkflow: finalWorkflowType,
          correctedIntent: routingValidation.correctedIntent,
        });
      }

      // 4. Build plan with extracted inputs and corrected workflow
      return buildConsultationExecutionPlan({
        message,
        consultation,
        brokerRecommendation,
        knownContext,
        semanticClassification,
        extractedInputs,
        responseStrategy,
        executionMode,
      });
    },

    /**
     * Executes up to 3 safe, read-only tool steps from a consultation execution plan.
     * Only called when plan.canExecuteNow === true.
     */
    async executeConsultationToolPlan(
      ctx,
      { plan, knownContext: _knownContext, session: _session, executionTrace, toolCallTracker }
    ) {
      const stepsToRun = (Array.isArray(plan.executableSteps) ? plan.executableSteps : [])
        .filter((s) => s.canExecute)
        .slice(0, 3);

      const results = [];

      for (const step of stepsToRun) {
        try {
          const result = await ctx.call(step.action, step.params || {}, {
            meta: { ...ctx.meta, $timeout: 5000 },
          });

          if (executionTrace && typeof executionTrace.addStep === 'function') {
            executionTrace.addStep({
              step: step.step,
              action: step.action,
              purpose: step.purpose,
              status: 'success',
            });
          }
          if (toolCallTracker && typeof toolCallTracker.track === 'function') {
            toolCallTracker.track({
              action: step.action,
              status: 'success',
              source: 'consultation_plan',
            });
          }

          results.push({
            step: step.step,
            action: step.action,
            status: 'success',
            result,
            purpose: step.purpose,
          });
        } catch (stepError) {
          results.push({
            step: step.step,
            action: step.action,
            status: 'error',
            error: String(stepError?.message || stepError),
            purpose: step.purpose,
          });
        }
      }

      return { results, completedSteps: results.filter((r) => r.status === 'success').length };
    },

    buildConsultationPrompt({
      message,
      brokerRecommendation,
      resolvedParams,
      knowledgeContext,
      responseStrategy = null,
      recentHistoryWindow = [],
      observations = [],
      toolRegistry = [],
      synthesisPolicy = null,
      routingPolicy = null,
    }) {
      const facts = [];
      const knownFacts = resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {};
      for (const [key, value] of Object.entries(knownFacts)) {
        if (value === undefined || value === null || value === '') continue;
        if (typeof value === 'object') {
          facts.push(`- ${key}: ${JSON.stringify(value).slice(0, 300)}`);
        } else {
          facts.push(`- ${key}: ${String(value).slice(0, 300)}`);
        }
      }

      if (knowledgeContext?.domainHint) {
        facts.push(`- domainHint: ${knowledgeContext.domainHint}`);
      }
      if (knowledgeContext?.regulatoryFrame) {
        facts.push(`- regulatoryFrame: ${knowledgeContext.regulatoryFrame}`);
      }
      if (brokerRecommendation?.intent) {
        facts.push(`- brokerIntent: ${brokerRecommendation.intent}`);
      }

      const strategy =
        responseStrategy ||
        this.buildResponseStrategy({
          message,
          knowledgeContext,
          resolvedParams,
        });

      facts.push('');
      facts.push('Antwortstrategie:');
      facts.push(`- audience: ${strategy.audience || 'general'}`);
      facts.push(`- epistemicState: ${strategy.epistemicState || 'clear'}`);
      facts.push(`- abstractionLevel: ${strategy.abstractionLevel || 'balanced'}`);
      facts.push(`- nextMove: ${strategy.nextMove || 'answer'}`);
      facts.push('- keine internen Schema-Feldnamen an den Nutzer ausgeben');
      if (strategy.epistemicState === 'inferable') {
        facts.push(
          '- Working Assumptions ausdrücklich benennen, bevor deterministische Schritte folgen'
        );
      }
      if (strategy.epistemicState === 'ambiguous') {
        facts.push('- nur eine präzise Klärungsfrage stellen, statt zu raten');
      }
      if (strategy.audience === 'leadership') {
        facts.push('- zuerst Entscheidung, Wirkung und Risiko, dann Details');
      }
      if (strategy.audience === 'technical') {
        facts.push('- technische Begriffe in Klartext, aber ohne interne Parameternamen');
      }

      if (Array.isArray(recentHistoryWindow) && recentHistoryWindow.length > 0) {
        facts.push('');
        facts.push('Gleicher Session-Verlauf (nur vorherige Turns, lokal/unbestätigt):');
        facts.push('- Diese Turns stammen nur aus derselben Session.');
        facts.push('- Behandle sie als Gesprächskontext, nicht als bestätigtes Tenant-Wissen.');
        facts.push('- Bei Konflikten zählen neuere Angaben und deterministische Evidenz stärker.');
        facts.push('- Fehlende Felder nicht erfinden; stattdessen eine präzise Rückfrage stellen.');
        for (const entry of recentHistoryWindow) {
          const roleLabel = entry?.role === 'assistant' ? 'ASSISTANT' : 'NUTZER';
          const text = String(entry?.text || '').trim();
          if (!text) {
            continue;
          }
          facts.push(`- ${roleLabel}: ${text}`);
        }
      }

      if (Array.isArray(observations) && observations.length > 0) {
        facts.push('');
        facts.push('Tool-Beobachtungen:');
        for (const observation of observations.slice(0, 6)) {
          facts.push(
            `- ${observation.action || 'tool'} [${observation.status || 'unknown'}]: ${String(
              observation.summary || observation.error || observation.result || ''
            ).slice(0, 400)}`
          );
        }
      }

      if (Array.isArray(toolRegistry) && toolRegistry.length > 0) {
        facts.push('');
        facts.push('Verfügbare Werkzeuge:');
        for (const tool of toolRegistry) {
          facts.push(
            `- ${tool.action}: ${tool.description}${tool.guidance ? ` | ${tool.guidance}` : ''}`
          );
        }
      }

      const synthPolicyDirectives = buildSynthesisPolicyDirectives(synthesisPolicy, routingPolicy);
      if (synthPolicyDirectives.length > 0) {
        facts.push('');
        facts.push('Blueprint-Syntheserichtlinien:');
        for (const directive of synthPolicyDirectives) {
          facts.push(directive);
        }
      }

      return [
        'Du bist ein Experte für deutsche Energiewirtschaft.',
        'Der Nutzer sucht Beratung und Einordnung. KEINE deterministische Blockade-Antwort.',
        'Regeln:',
        '- Erkläre kurz und verständlich.',
        '- Formuliere belastbar mit Unsicherheiten, wenn Evidenz fehlt.',
        '- Keine Sätze wie "Schnittstelle fehlt" oder "Methodik-Hinweis".',
        '- Leite fehlende Informationen als fachliche Konzepte, nie als interne Schemafelder, her.',
        '- Wenn die Lage inferierbar ist, benenne die Working Assumption ausdrücklich, bevor du fortfährst.',
        '- Wenn die Lage unklar ist, stelle genau eine präzise Klärungsfrage.',
        '- Passe die Abstraktion an: Führungsebene = Entscheidung/Risiko/Wirkung, technisch = Details/Eingaben.',
        '- Schlage konkrete nächste Schritte vor.',
        '',
        'Verfügbare Fakten:',
        facts.length > 0 ? facts.join('\n') : '- keine belastbaren Zusatzfakten vorhanden',
        '',
        `Nutzerfrage: ${String(message || '').trim()}`,
        '',
        'Antworte im geforderten JSON-Schema.',
      ].join('\n');
    },

    sanitizeConsultationRecentHistoryText(value = '') {
      const raw = String(value || '');
      if (!raw.trim()) {
        return null;
      }

      const normalized = raw.replace(/\s+/g, ' ').trim();
      if (!normalized) {
        return null;
      }

      const jsonLike =
        ((/^[\[{]/.test(normalized) || /[\]}]$/.test(normalized)) &&
          /"[^"\n]{1,80}"\s*:/.test(normalized)) ||
        /"responseRaw"\s*:|"toolContext"\s*:|"inhouseData"\s*:|"rawJson"\s*:/i.test(raw);
      const xmlLike = /<[^>]{1,80}>/.test(raw);
      const base64Like = /(?:^|\s)[A-Za-z0-9+/]{80,}={0,2}(?:\s|$)/.test(raw);
      const csvLike =
        /(?:^|[\r\n])[^\r\n]*(,|;|\t)[^\r\n]*(,|;|\t)[^\r\n]*(?:[\r\n]|$)/.test(raw) &&
        raw.split(/\r?\n/).length > 1;
      const rawSensitiveHint =
        /(responseRaw|toolContext|inhouseData|rawJson|rawResponse|attachment|extract|hems|nap|payload)/i.test(
          raw
        ) && normalized.length > 80;

      if (jsonLike || xmlLike || base64Like || csvLike || rawSensitiveHint) {
        return CONSULTATION_HISTORY_REDACTION_PLACEHOLDER;
      }

      return normalized.slice(0, CONSULTATION_HISTORY_ENTRY_MAX_CHARS);
    },

    buildConsultationRecentHistoryWindow(session = null) {
      const history = Array.isArray(session?.l3?.history) ? session.l3.history : [];
      if (history.length === 0) {
        return [];
      }

      const sanitizedEntries = history
        .map((entry) => ({
          role: String(entry?.role || '')
            .trim()
            .toLowerCase(),
          text: this.sanitizeConsultationRecentHistoryText(entry?.text || entry?.content || ''),
        }))
        .filter(
          (entry) =>
            ['user', 'assistant'].includes(entry.role) && Boolean(String(entry.text || '').trim())
        );

      if (sanitizedEntries.length === 0) {
        return [];
      }

      const recentEntries = sanitizedEntries.slice(-CONSULTATION_HISTORY_MAX_ENTRIES);
      const bounded = [];
      let remainingChars = CONSULTATION_HISTORY_MAX_CHARS;

      for (let index = recentEntries.length - 1; index >= 0; index -= 1) {
        const entry = recentEntries[index];
        const text = String(entry?.text || '').trim();
        if (!text) {
          continue;
        }

        const allowedChars = Math.max(0, remainingChars - 24);
        if (allowedChars <= 0) {
          break;
        }

        const truncatedText = text.slice(0, allowedChars).trim();
        if (!truncatedText) {
          continue;
        }

        bounded.unshift({ role: entry.role, text: truncatedText });
        remainingChars -= truncatedText.length;
      }

      return bounded;
    },

    /**
     * Generates a graceful fallback consultation reply when synthesis times out.
     * Preserves fidelity of collected facts without technical schema leaks.
     */
    fallbackConsultationReply(message = '', observations = [], collectedFacts = [], options = {}) {
      // Extract top 2 most relevant facts from observations
      const topFacts = (Array.isArray(observations) ? observations : []).slice(0, 2).map((obs) => ({
        label: obs.action || 'Überprüfung',
        summary: String(
          obs.summary || obs.result?.description || obs.error || 'durchgeführt'
        ).slice(0, 200),
      }));
      const uncertaintyNote = this.buildConsultationVnbUncertaintyNote(message, observations);

      return {
        reply:
          'Ich habe die Beratung eingeleitet und verschiedene Aspekte überprüft. ' +
          'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen. ' +
          (topFacts.length > 0
            ? topFacts.map((f) => `${f.label}: ${f.summary}`).join('; ')
            : 'Es liegt derzeit keine vollständige Evidenz für eine belastbare Bewertung vor.') +
          uncertaintyNote +
          ' Bitte nutzen Sie den Ausführungs-Modus, um konkrete nächste Schritte zu initiieren.',
        hypotheses: [],
        openQuestions: [],
        nextActions: [
          {
            action: 'Ausführungs-Modus verwenden',
            description:
              'Initiieren Sie einen der verfügbaren Tools zur konkreten Schrittausführung',
          },
        ],
        factsUsed: topFacts.map((f) => f.label),
        attemptsSummary:
          collectedFacts.length > 0
            ? collectedFacts.slice(0, 3).map((item) => ({
                iteration: item.iteration || 1,
                tool: item.tool || 'unknown',
                status: item.status || 'unknown',
                attempts: item.attempts || 1,
              }))
            : [],
        toolTrace: [],
        degradation: this.buildConsultationDegradation({
          reason: options?.degradationReason || 'synthesis_budget_exhausted',
          timeoutFallback: true,
          recoveredFromEvidence: topFacts.length > 0,
          userVisible: true,
        }),
        ...(Array.isArray(options?.debugTrace) ? { debugTrace: options.debugTrace } : {}),
      };
    },

    buildConsultationOperationalDegradationReply(message = '', options = {}) {
      const normalizedMessage = String(message || '').trim();

      return {
        reply:
          'Der Beratungsmodus ist aktuell nur eingeschränkt verfügbar. ' +
          'Die sprachliche Synthese konnte nicht zuverlässig abgeschlossen werden; ' +
          'deshalb gebe ich keine belastbare fachliche Einordnung aus. ' +
          'Wenn Sie möchten, kann ich stattdessen konkrete Prüfschritte im Ausführungs-Modus starten ' +
          'oder gezielt die fehlenden Evidenzpunkte klären.',
        hypotheses: [],
        openQuestions: normalizedMessage
          ? [
              {
                question:
                  'Soll ich direkt in den Ausführungs-Modus wechseln oder zuerst fehlende Evidenz sammeln?',
                whyRelevant:
                  'So bleibt das weitere Vorgehen transparent, obwohl die Synthese derzeit degradiert ist.',
              },
            ]
          : [],
        nextActions: [
          {
            action: 'Ausführungs-Modus verwenden',
            description: 'Starte konkrete Prüfschritte statt einer rein sprachlichen Einordnung.',
          },
          {
            action: 'Fehlende Evidenz klären',
            description:
              'Sammle erst belastbare Eingaben oder Tool-Evidenz für eine spätere Bewertung.',
          },
        ],
        factsUsed: normalizedMessage
          ? [
              {
                source: 'user_prompt',
                value: normalizedMessage.slice(0, 280),
              },
            ]
          : [],
        degradation: this.buildConsultationDegradation({
          reason: options?.reason || 'non_agentic_synthesis_unavailable',
          timeoutFallback: options?.timeoutFallback !== false,
          recoveredFromEvidence: false,
          userVisible: true,
        }),
        ...(Array.isArray(options?.debugTrace) ? { debugTrace: options.debugTrace } : {}),
      };
    },

    buildConsultationDegradation({
      reason = 'consultation_degraded',
      timeoutFallback = false,
      recoveredFromEvidence = false,
      userVisible = true,
    } = {}) {
      return {
        active: true,
        code: 'CONSULTATION_SYNTHESIS_DEGRADED',
        phase: 'consultation_synthesis',
        reason: String(reason || 'consultation_degraded').slice(0, 80),
        timeoutFallback: Boolean(timeoutFallback),
        recoveredFromEvidence: Boolean(recoveredFromEvidence),
        userVisible: Boolean(userVisible),
      };
    },

    deriveConsultationDegradation(result = {}, { timeoutFallback = false } = {}) {
      if (result?.degradation && typeof result.degradation === 'object') {
        return result.degradation;
      }

      const debugTrace = Array.isArray(result?.debugTrace) ? result.debugTrace : [];
      if (debugTrace.length === 0 && !timeoutFallback) {
        return null;
      }

      const fallbackEvent = debugTrace.find(
        (event) => event?.type === 'consultation_fallback_selected'
      );
      const synthesisNullEvent = debugTrace.find(
        (event) => event?.type === 'consultation_synthesis_null'
      );
      const synthesisErrorEvent = debugTrace.find(
        (event) => event?.type === 'consultation_synthesis_error'
      );
      const synthesisSkippedEvent = debugTrace.find(
        (event) => event?.type === 'consultation_synthesis_skipped'
      );
      const recoveredFromEvidence =
        fallbackEvent?.branch === 'observation_summary_reply' ||
        (Array.isArray(result?.factsUsed) && result.factsUsed.length > 0 && !timeoutFallback);

      return this.buildConsultationDegradation({
        reason:
          fallbackEvent?.reason ||
          synthesisNullEvent?.reason ||
          synthesisErrorEvent?.errorCode ||
          synthesisSkippedEvent?.reason ||
          (timeoutFallback ? 'timeout_fallback' : 'consultation_degraded'),
        timeoutFallback,
        recoveredFromEvidence,
        userVisible: true,
      });
    },

    buildConsultationVnbUncertaintyNote(message = '', observations = []) {
      const observationList = Array.isArray(observations) ? observations : [];
      const hasVerifiedVnbLookup = observationList.some(
        (obs) =>
          obs?.action === 'grid-operations.vnbLookup' &&
          obs?.status === 'completed' &&
          !obs?.error &&
          obs?.result?.error == null
      );

      const hasMarketPartnersContext = observationList.some(
        (obs) => obs?.action === 'grid-operations.marketPartners'
      );

      const hasVnbContext =
        /(?:\bvnb\b|\bnetzbetreiber\b|\bnetzgebiet\b|\bnetzzone\b|\bstandort\b|\banschluss\b|\bbdew\b|\bmarktlokation\b|\bnetzanschlusspunkt\b)/i.test(
          String(message || '')
        ) ||
        hasMarketPartnersContext ||
        observationList.some((obs) => obs?.action === 'grid-operations.vnbLookup');

      if (!hasVnbContext || hasVerifiedVnbLookup) {
        return '';
      }

      return hasMarketPartnersContext
        ? ' Die Zuständigkeit des VNB ist noch nicht belastbar verifiziert (Marktpartner-Treffer allein sind kein Netzgebietsnachweis).'
        : ' Die Zuständigkeit des VNB ist noch nicht belastbar verifiziert.';
    },

    buildConsultationObservationSummaryReply(
      message = '',
      observations = [],
      collectedFacts = [],
      options = {}
    ) {
      const synthesisPolicy = options.synthesisPolicy || null;
      const routingPolicy = options.routingPolicy || null;
      const deprioritizeToolFailure =
        Array.isArray(synthesisPolicy?.deprioritize) &&
        synthesisPolicy.deprioritize.includes('tool_failure_as_main_answer');
      const isMunicipalSitePrecheck =
        routingPolicy?.sessionIntent === 'municipal_energy_site_precheck' ||
        synthesisPolicy?.audience === 'municipal_official';

      const observationList = Array.isArray(observations) ? observations : [];
      const topFacts = observationList
        .slice(0, 3)
        .map((obs) => ({
          label: obs.action || 'Überprüfung',
          summary: String(
            obs.summary || obs.result?.description || obs.error || 'durchgeführt'
          ).slice(0, 220),
        }))
        .filter((item) => Boolean(item.label));

      const uncertaintyNote = this.buildConsultationVnbUncertaintyNote(message, observationList);
      const hasUnverifiedVnbContext = Boolean(uncertaintyNote);

      const knownContext =
        options.knownContext && typeof options.knownContext === 'object' ? options.knownContext : {};
      const resolvedParams =
        options.resolvedParams && typeof options.resolvedParams === 'object'
          ? options.resolvedParams
          : {};
      const knowledgeContext =
        options.knowledgeContext && typeof options.knowledgeContext === 'object'
          ? options.knowledgeContext
          : {};
      const locationContext = {
        ...knownContext,
        ...resolvedParams,
        ...knowledgeContext,
      };
      const location = resolveLocationFromText(message, locationContext);
      const municipality =
        location?.municipality || locationContext.municipality || locationContext.city;
      const postalCode =
        location?.postalCode || locationContext.postalCode || locationContext.postleitzahl;
      const locationLabel = [postalCode, municipality].filter(Boolean).join(' ').trim();
      const asksAboutOsm = /\bOSM\b|openstreetmap|topolog/i.test(String(message || ''));
      const asksAboutDecisionClarity =
        /(?:klarheit|belastbar|tatsächlich|tatsaechlich|heute|möglich|moeglich|spekulativ|annehmen|woher)/i.test(
          String(message || '')
        );

      let replyText;
      if (deprioritizeToolFailure && isMunicipalSitePrecheck) {
        if (asksAboutDecisionClarity && !asksAboutOsm) {
          replyText =
            `Für ${locationLabel || 'den kommunalen Standort'} bekommen Sie belastbare Klarheit erst über eine konkrete Fläche oder Koordinaten, die gewünschte Anschlussleistung in MW und die formelle Vorprüfung beim zuständigen Netzbetreiber. ` +
            'Heute seriös möglich ist eine Gemeindeebenen-Einordnung: Standortkontext, grobe Flächenlogik, Nähe zu Infrastruktur und erkennbare Ausschluss- oder Risikothemen. ' +
            'Noch spekulativ bleiben VNB-Zuständigkeit, verfügbare Netzkapazität, Netzanschlusspunkt, Kosten und Zeithorizont, solange keine flächenscharfe Netzanschlussprüfung vorliegt. ' +
            'Öffentliche Spatial-Daten wie OSM können diese Hypothese plausibilisieren, ersetzen aber keine Netzanschlussprüfung.';
        } else {
          replyText =
            `Für ${locationLabel || 'den kommunalen Standort'} bleibt die Einordnung ein kommunaler Standort-Precheck auf Gemeindeebene. ` +
            'Tool-Lücken sind hier keine Hauptaussage: VNB-Zuständigkeit und Netzkapazität sind noch nicht belastbar verifiziert. ' +
            (asksAboutOsm
              ? 'OSM kann als öffentlicher Spatial-Context-Layer helfen, Lage, Verkehrsanbindung, Gewerbekontext und mögliche Flächenbezüge zu strukturieren; es ersetzt aber keine Netzanschlussprüfung. '
              : 'Öffentliche Spatial-Daten wie OSM können die Lage- und Flächenhypothese plausibilisieren; sie ersetzen aber keine Netzanschlussprüfung. ') +
            'Nächster sinnvoller Schritt: konkrete Fläche oder Koordinaten, gewünschte Anschlussleistung in MW und Zeithorizont ergänzen.';
        }
      } else if (deprioritizeToolFailure) {
        replyText =
          'Die bisherige Tool-Prüfung liefert noch keine belastbare Hauptaussage. ' +
          (topFacts.length > 0
            ? topFacts.map((f) => `${f.label} ist noch nicht abschließend verifiziert`).join('; ')
            : `Zur Anfrage "${String(message || '').slice(0, 120)}" laufen noch Prüfungen.`);
      } else {
        replyText =
          'Kurzfazit auf Basis der erhobenen Tool-Evidenz: ' +
          (topFacts.length > 0
            ? topFacts.map((f) => `${f.label}: ${f.summary}`).join('; ')
            : `Zur Anfrage "${String(message || '').slice(0, 120)}" liegt bereits belastbare Evidenz vor.`) +
          uncertaintyNote;
      }

      return {
        reply: replyText,
        hypotheses: hasUnverifiedVnbContext
          ? [
              {
                statement:
                  'Die Zuständigkeit des Netzbetreibers ist ohne VNB-Lookup bzw. Netzgebietslogik nicht final bestätigt.',
                confidence: 'low',
                evidence: 'Aktuell liegt nur Marktpartner-Kontext vor.',
              },
            ]
          : [],
        openQuestions: hasUnverifiedVnbContext
          ? [
              {
                question:
                  'Soll ich den zuständigen VNB über vnbLookup bzw. Netzgebietsauflösung verifizieren?',
                whyRelevant:
                  'Marktpartner-Suchergebnisse können vom tatsächlich zuständigen VNB abweichen.',
              },
            ]
          : [],
        nextActions: [
          {
            action: 'Ausführungs-Modus verwenden',
            description: 'Nutzen Sie den Ausführungs-Modus für konkrete nächste Schritte.',
          },
        ],
        factsUsed: topFacts.map((f) => f.label),
        attemptsSummary:
          collectedFacts.length > 0
            ? collectedFacts.slice(0, 3).map((item) => ({
                iteration: item.iteration || 1,
                tool: item.tool || 'unknown',
                status: item.status || 'unknown',
                attempts: item.attempts || 1,
              }))
            : [],
        toolTrace: [],
        ...(Array.isArray(options?.debugTrace) ? { debugTrace: options.debugTrace } : {}),
      };
    },

    buildConsultationToolRegistry({
      message,
      brokerRecommendation,
      resolvedParams,
      knowledgeContext,
      responseStrategy = null,
    } = {}) {
      const registry = [];
      const messageText = String(message || '').toLowerCase();
      const knownFacts = resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {};
      const operatorName =
        knownFacts.gridOperatorName ||
        knownFacts.assertedGridOperatorName ||
        knowledgeContext?.gridOperatorName ||
        knowledgeContext?.assertedGridOperatorName ||
        brokerRecommendation?.gridOperatorName ||
        '';
      const bdewCode = knownFacts.bdew || knownFacts.bdewCode || knowledgeContext?.bdew || '';

      registry.push({
        action: 'grid-operations.marketPartners',
        description: 'Sucht Netzbetreiber/Marktpartner über Name, City oder Suchbegriff.',
        guidance:
          'Nutze das Tool, wenn ein Netzbetreibername, eine Stadt oder ein lokaler DSO-Hinweis vorliegt.',
      });

      registry.push({
        action: 'grid-operations.vnbLookup',
        description: 'Verifiziert VNB-Zuständigkeit und löst BDEW-/Ortsdaten auf.',
        guidance:
          'Nutze das Tool für BDEW-Codes, Zuständigkeitsprüfungen oder wenn Marktpartner-Evidenz vorliegt.',
      });

      if (
        !operatorName &&
        !bdewCode &&
        !/vnb|netzbetreiber|netzoperator|bdew|bde[w]?/i.test(messageText)
      ) {
        return registry;
      }

      return registry;
    },

    parseConsultationJsonResponse(raw) {
      const jsonMatch = String(raw || '').match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      try {
        return JSON.parse(jsonMatch[0]);
      } catch (_error) {
        return null;
      }
    },

    inferConsultationToolCall({
      message,
      brokerRecommendation,
      resolvedParams,
      knowledgeContext,
      responseStrategy = null,
      observations = [],
    } = {}) {
      const knownFacts = resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {};
      const messageText = String(message || '').toLowerCase();
      const operatorName =
        knownFacts.gridOperatorName ||
        knownFacts.assertedGridOperatorName ||
        knowledgeContext?.gridOperatorName ||
        knowledgeContext?.assertedGridOperatorName ||
        brokerRecommendation?.gridOperatorName ||
        '';
      const bdewCode = knownFacts.bdew || knownFacts.bdewCode || knowledgeContext?.bdew || '';
      const lastObservation = observations[observations.length - 1] || null;

      if (!observations.length) {
        if (bdewCode) {
          return {
            mode: 'tool',
            thought: 'BDEW-Code ist vorhanden, daher starte ich mit einer Zuständigkeitsprüfung.',
            toolCall: {
              action: 'grid-operations.vnbLookup',
              params: pruneUndefinedDeep({
                bdew: bdewCode,
                city: knowledgeContext?.city || knownFacts.city,
              }),
            },
          };
        }

        if (operatorName) {
          return {
            mode: 'tool',
            thought:
              'Ein Netzbetreibername ist vorhanden, daher löse ich zuerst den Marktpartner auf.',
            toolCall: {
              action: 'grid-operations.marketPartners',
              params: pruneUndefinedDeep({ query: operatorName, limit: 5 }),
            },
          };
        }

        if (/vnb|netzbetreiber|bdew|zuständig|zuständigkeit/i.test(messageText)) {
          return {
            mode: 'tool',
            thought:
              'Die Nachricht betrifft die Zuständigkeit eines VNB, daher probiere ich eine VNB-Auflösung.',
            toolCall: {
              action: 'grid-operations.vnbLookup',
              params: pruneUndefinedDeep({
                bdew: knownFacts.bdew || knownFacts.bdewCode,
                city: knownFacts.city || knowledgeContext?.city,
                query: operatorName || String(message || '').slice(0, 120),
              }),
            },
          };
        }
      }

      if (
        lastObservation?.action === 'grid-operations.marketPartners' &&
        lastObservation?.status === 'completed'
      ) {
        const results = Array.isArray(lastObservation.result?.data?.results)
          ? lastObservation.result.data.results
          : Array.isArray(lastObservation.result?.results)
            ? lastObservation.result.results
            : [];
        const topHit = results[0] || null;

        if (topHit) {
          const bdew = topHit.bdewCode || topHit.bdew || '';
          const city =
            topHit.contacts?.[0]?.city ||
            topHit.city ||
            knownFacts.city ||
            knownFacts.municipality ||
            knowledgeContext?.city ||
            knowledgeContext?.municipality ||
            '';
          return {
            mode: 'tool',
            thought:
              'Der Marktpartner ist gefunden; ich verifiziere nun den zuständigen VNB über Lookup/Netzgebietsauflösung.',
            toolCall: {
              action: 'grid-operations.vnbLookup',
              params: pruneUndefinedDeep({
                bdew,
                city,
                query:
                  topHit.name ||
                  operatorName ||
                  knownFacts.municipality ||
                  knownFacts.location ||
                  String(message || '').slice(0, 120),
                vnbName: topHit.name || operatorName,
              }),
            },
          };
        }
      }

      if (
        lastObservation?.action === 'grid-operations.vnbLookup' &&
        lastObservation?.status === 'completed'
      ) {
        return {
          mode: 'final',
          thought: 'Es liegt genug Evidenz vor, um die Beratung zu finalisieren.',
          reply: '',
        };
      }

      return null;
    },

    summarizeConsultationObservation(action, result, error = null) {
      if (error) {
        return {
          action,
          status: isActionUnavailable(error) ? 'unsupported' : 'failed',
          summary: String(error.message || 'Tool call failed').slice(0, 400),
        };
      }

      let summary = '';
      if (result && typeof result === 'object') {
        const data = result.data !== undefined ? result.data : result;
        if (Array.isArray(data?.results)) {
          const top = data.results[0] || null;
          summary = top ? JSON.stringify(top).slice(0, 400) : `0 Ergebnisse von ${action}`;
        } else if (data?.operator && typeof data.operator === 'object') {
          summary = JSON.stringify(data.operator).slice(0, 400);
        } else {
          summary = JSON.stringify(data).slice(0, 400);
        }
      } else {
        summary = String(result || '').slice(0, 400);
      }

      return {
        action,
        status: 'completed',
        summary,
      };
    },

    shouldEarlyExitConsultationLoop(action, result) {
      if (!result || typeof result !== 'object') {
        return false;
      }

      const data = result.data !== undefined ? result.data : result;
      if (Array.isArray(data?.results) && data.results.length > 0) {
        return ['grid-operations.marketPartners', 'grid-operations.vnbLookup'].includes(action);
      }

      if (data?.operator && typeof data.operator === 'object') {
        return true;
      }

      if (Array.isArray(data?.items) && data.items.length > 0) {
        return true;
      }

      return false;
    },

    deriveConsultationPrimaryIntent({ brokerRecommendation = {}, routingDecision = null } = {}) {
      const brokerIntent = String(brokerRecommendation?.intent || '').trim();
      const brokerCapability = String(brokerRecommendation?.capability || '').trim();

      if (routingDecision?.target === 'consultation_intro') {
        return 'consultation';
      }

      if (
        brokerIntent === 'mark_unknown_execution_gap' ||
        brokerCapability === 'interface_placeholder' ||
        brokerIntent === 'interface-placeholder.markGap'
      ) {
        return 'consultation';
      }

      return brokerIntent || 'consultation';
    },

    async handleConsultationTurnAgentic(ctx, input = {}) {
      const message = String(input.message || '').trim();
      const brokerRecommendation = input.brokerRecommendation || {};
      const resolvedParams =
        input.resolvedParams && typeof input.resolvedParams === 'object'
          ? input.resolvedParams
          : {};
      const knowledgeContext = input.knowledgeContext || null;
      const responseStrategy = input.responseStrategy || null;
      const knownContext = input.knownContext || {};
      const synthesisPolicy = input.synthesisPolicy || null;
      const routingPolicy = input.routingPolicy || null;
      const recentHistoryWindow = Array.isArray(input.recentHistoryWindow)
        ? input.recentHistoryWindow
        : [];
      const session = input.session && typeof input.session === 'object' ? input.session : null;
      const executionTrace = input.executionTrace || null;
      const toolCallTracker = input.toolCallTracker || null;

      const pendingHitlStopPoint =
        session?.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
          ? session.l3.stopPoint
          : null;
      const pendingHitlStatus = String(
        pendingHitlStopPoint?.hitlItem?.status ||
          pendingHitlStopPoint?.onboardingQuestion?.hitlItem?.status ||
          'pending'
      ).toLowerCase();

      if (
        pendingHitlStopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL' &&
        !['approved', 'rejected', 'declined', 'cancelled'].includes(pendingHitlStatus)
      ) {
        const onboardingQuestion = this.buildHitlOnboardingQuestion(
          pendingHitlStopPoint,
          pendingHitlStopPoint?.onboardingQuestion?.planSnapshot || null
        );
        const reply = this.buildHitlApprovalMarkdown(onboardingQuestion);

        return {
          status: 'awaiting-onboarding',
          stopPoint: {
            ...pendingHitlStopPoint,
            onboardingQuestion,
            message: onboardingQuestion.message,
            hitlItemId:
              onboardingQuestion?.hitlItem?.id || pendingHitlStopPoint?.hitlItemId || null,
          },
          reply,
          hypotheses: [],
          openQuestions: [
            {
              question: onboardingQuestion.message,
              whyRelevant:
                'Für den nächsten kritischen Schritt ist eine ausdrückliche Freigabe erforderlich.',
            },
          ],
          nextActions: [
            {
              action: 'HITL-Freigabe entscheiden',
              description:
                'Öffnen Sie das Freigabe-Element und bestätigen oder lehnen Sie den Schritt ab.',
            },
          ],
          factsUsed: [
            {
              source: 'session_stop_point',
              value: 'MANDATORY_HITL_APPROVAL',
            },
          ],
        };
      }

      // C) Receive jobId from caller for per-iteration progress logging
      const agenticJobId = input.jobId || null;
      const agenticJobStore = agenticJobId ? require('../src/job-store') : null;
      const consultationDebugEnabled = isConsultationDebugEnabled(knownContext);
      const consultationDebugRecorder = createConsultationDebugRecorder({
        enabled: consultationDebugEnabled,
        trace: consultationDebugEnabled
          ? Array.isArray(input.consultationDebugSink)
            ? input.consultationDebugSink
            : []
          : null,
        agenticJobStore,
        agenticJobId,
      });
      const consultationDebugTrace = consultationDebugRecorder.trace;

      if (!message) {
        return null;
      }

      const toolRegistry = this.buildConsultationToolRegistry({
        message,
        brokerRecommendation,
        resolvedParams,
        knowledgeContext,
        responseStrategy,
      });

      consultationDebugRecorder.emit('consultation_route_selected', {
        routeKey: null,
        routeTarget: input.routingDecision?.target || CHAT_MODES.CONSULTATION,
        primaryIntent: this.deriveConsultationPrimaryIntent({
          brokerRecommendation,
          routingDecision: input.routingDecision || null,
        }),
        workflowType: input.semanticClassification?.workflowType || null,
        capability: brokerRecommendation?.capability || null,
        plannedToolCalls: toolRegistry.map((tool) => tool.action).slice(0, 10),
      });

      if (toolRegistry.length === 0) {
        return null;
      }

      const observations = [];
      const toolTrace = [];
      const collectedFacts = [];
      let plannerFailed = false;
      const startedAt = Date.now();
      let iterationsExecuted = 0;
      let hadUnavailableAttemptOverall = false;
      let lastToolStatus = null;
      let lastError = null;

      const emitBudgetCheck = (phase, iteration = null) => {
        const elapsedMs = Date.now() - startedAt;
        const remainingMs = CONSULTATION_REACT_MAX_MS - elapsedMs;
        consultationDebugRecorder.emit('consultation_budget_check', {
          elapsedMs,
          remainingMs,
          maxMs: CONSULTATION_REACT_MAX_MS,
          iteration,
          iterationsLeft:
            typeof iteration === 'number'
              ? Math.max(CONSULTATION_REACT_MAX_ITERATIONS - iteration, 0)
              : CONSULTATION_REACT_MAX_ITERATIONS,
          phase,
        });
        return { elapsedMs, remainingMs };
      };

      consultationDebugRecorder.emit('synthesis_budget_reserved', {
        maxMs: CONSULTATION_REACT_MAX_MS,
        synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
      });

      const summarizeAttempts = (toolResult) => {
        if (!toolResult || typeof toolResult !== 'object') {
          return { attempts: 1, outcome: 'unknown' };
        }

        const attempts = Array.isArray(toolResult.attemptsLog)
          ? Math.max(1, toolResult.attemptsLog.length + (toolResult.success ? 1 : 0))
          : 1;

        return {
          attempts,
          outcome: toolResult.success ? 'success' : 'failed',
        };
      };

      const collectRetryFacts = () => {
        const lastObservation = observations[observations.length - 1] || null;
        const lastResult =
          lastObservation?.result && typeof lastObservation.result === 'object'
            ? lastObservation.result
            : {};
        const firstResult = Array.isArray(lastResult?.data?.results)
          ? lastResult.data.results[0]
          : Array.isArray(lastResult?.results)
            ? lastResult.results[0]
            : null;

        return pruneUndefinedDeep({
          message,
          brokerIntent: brokerRecommendation?.intent,
          resolvedParams,
          knownContext,
          knowledgeContext,
          observationCount: observations.length,
          lastAction: lastObservation?.action,
          bdew:
            resolvedParams?.bdew ||
            resolvedParams?.bdewCode ||
            firstResult?.bdewCode ||
            firstResult?.bdew,
          city:
            resolvedParams?.city ||
            knowledgeContext?.city ||
            firstResult?.contacts?.[0]?.city ||
            firstResult?.city,
          operatorName:
            resolvedParams?.gridOperatorName ||
            resolvedParams?.assertedGridOperatorName ||
            firstResult?.name,
        });
      };

      for (let iteration = 1; iteration <= CONSULTATION_REACT_MAX_ITERATIONS; iteration += 1) {
        iterationsExecuted = iteration;
        const loopBudget = emitBudgetCheck('loop_start', iteration);
        if (loopBudget.elapsedMs >= CONSULTATION_REACT_MAX_MS) {
          toolTrace.push({
            iteration,
            phase: 'guard',
            status: 'timeout-budget-reached',
            maxMs: CONSULTATION_REACT_MAX_MS,
          });
          break;
        }

        let stepPlan = null;

        // C) Log each agentic loop iteration (THINK phase)
        if (agenticJobStore) {
          const iterPercent = Math.min(
            25 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
            45
          );
          agenticJobStore.appendLog(
            agenticJobId,
            `agentic_iteration_${iteration}`,
            iterPercent,
            `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: THINK...`,
            { iteration, maxIterations: CONSULTATION_REACT_MAX_ITERATIONS, phase: 'think' }
          );
        }

        try {
          const plannerStartedAt = Date.now();
          consultationDebugRecorder.emit('consultation_planner_start', {
            iteration,
            phase: 'think',
          });
          const plannerPrompt = [
            'Du bist der interne ReAct-Planer des Personal Agent.',
            'Arbeite in kurzen Schleifen: THINK → ACT → OBSERVE.',
            'Nutze pro Antwort maximal einen Tool-Call.',
            'Wenn genug Evidenz vorliegt, antworte mit mode="final".',
            'Antworte ausschließlich als JSON mit den Schlüsseln mode, thought und toolCall.',
            'toolCall muss die Form { "action": "...", "params": {...} } haben.',
            '',
            `Iteration: ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}`,
            `Nutzerfrage: ${message}`,
            '',
            this.buildConsultationPrompt({
              message,
              brokerRecommendation,
              resolvedParams,
              knowledgeContext,
              responseStrategy,
              recentHistoryWindow,
              observations,
              toolRegistry,
              synthesisPolicy,
              routingPolicy,
            }),
          ].join('\n');

          const plannerResponse = await this.callLlmGenerate(ctx, {
            system: plannerPrompt,
            user: message,
            temperature: 0.1,
            maxTokens: 512,
            trace: {
              executionTrace,
              phase: `consultation_think_${iteration}`,
              metadata: { iteration },
            },
          });

          stepPlan = this.parseConsultationJsonResponse(
            plannerResponse?.text || plannerResponse?.content || plannerResponse
          );
          consultationDebugRecorder.emit('consultation_planner_end', {
            iteration,
            durationMs: Date.now() - plannerStartedAt,
          });
        } catch (error) {
          plannerFailed = true;
          const sanitizedPlannerError = sanitizeConsultationDebugError(error);
          lastError =
            sanitizedPlannerError?.message || sanitizedPlannerError?.code || 'planner_failed';
          consultationDebugRecorder.emit('consultation_planner_error', {
            iteration,
            durationMs: null,
            errorName: sanitizedPlannerError?.name || null,
            errorCode: sanitizedPlannerError?.code || null,
            errorMessage: sanitizedPlannerError?.message || null,
          });
          toolTrace.push({ iteration, phase: 'think', status: 'failed', error: error.message });
          break;
        }

        const postPlannerBudget = emitBudgetCheck('post_planner', iteration);
        if (postPlannerBudget.remainingMs <= CONSULTATION_SYNTHESIS_MIN_MS) {
          consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
            iteration,
            action: stepPlan?.toolCall?.action || null,
            tool: stepPlan?.toolCall?.action || null,
            reason: 'insufficient_budget_after_planner',
            remainingMs: postPlannerBudget.remainingMs,
            synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
          });
          break;
        }

        if (!stepPlan) {
          stepPlan = this.inferConsultationToolCall({
            message,
            brokerRecommendation,
            resolvedParams,
            knowledgeContext,
            responseStrategy,
            observations,
          });
        }

        if (!stepPlan) {
          break;
        }

        toolTrace.push({
          iteration,
          phase: 'think',
          status: 'completed',
          thought: String(stepPlan.thought || '').slice(0, 200),
        });

        if (String(stepPlan.mode || '').toLowerCase() === 'final' || !stepPlan.toolCall?.action) {
          const hasMarketPartnerObservation = observations.some(
            (obs) => obs?.action === 'grid-operations.marketPartners' && obs?.status === 'completed'
          );
          const hasVerifiedVnbObservation = observations.some(
            (obs) => obs?.action === 'grid-operations.vnbLookup' && obs?.status === 'completed'
          );
          if (hasMarketPartnerObservation && !hasVerifiedVnbObservation) {
            const enforcedStepPlan = this.inferConsultationToolCall({
              message,
              brokerRecommendation,
              resolvedParams,
              knowledgeContext,
              responseStrategy,
              observations,
            });
            if (enforcedStepPlan?.toolCall?.action) {
              stepPlan = enforcedStepPlan;
            } else {
              break;
            }
          } else {
            break;
          }
        }

        let action = String(stepPlan.toolCall.action || '').trim();
        let params = pruneUndefinedDeep(stepPlan.toolCall.params || {});

        if (action === 'grid-operations.vnbLookup') {
          const hasBdewFact = Boolean(
            resolvedParams?.bdew ||
            resolvedParams?.bdewCode ||
            knowledgeContext?.bdew ||
            knownContext?.bdew ||
            params?.bdew
          );
          if (!hasBdewFact) {
            const fallbackQuery =
              resolvedParams?.gridOperatorName ||
              resolvedParams?.assertedGridOperatorName ||
              knowledgeContext?.gridOperatorName ||
              brokerRecommendation?.gridOperatorName ||
              String(message || '').slice(0, 120);
            action = 'grid-operations.marketPartners';
            params = pruneUndefinedDeep({ query: fallbackQuery, limit: 5 });
            toolTrace.push({
              iteration,
              phase: 'think',
              status: 'deprioritized',
              fromAction: 'grid-operations.vnbLookup',
              toAction: action,
              reason: 'missing_required_bdew_fact',
            });
          }
        }

        const registryEntry = toolRegistry.find((tool) => tool.action === action);

        if (!registryEntry) {
          observations.push({
            action,
            status: 'unsupported',
            summary: `Tool ${action} ist nicht im Registry verfügbar.`,
          });
          toolTrace.push({ iteration, phase: 'act', action, status: 'unsupported' });
          continue;
        }

        // C) Log ACT phase: which tool is being called
        if (agenticJobStore) {
          const actPercent = Math.min(
            26 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
            46
          );
          agenticJobStore.appendLog(
            agenticJobId,
            `agentic_act_${iteration}`,
            actPercent,
            `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: ACT → ${action}`,
            { iteration, action, phase: 'act' }
          );
        }

        const toolCtx = buildConsultationToolExecutionContext(ctx, this.broker);

        const preToolBudget = emitBudgetCheck('pre_tool', iteration);
        const effectiveToolTimeoutMs = Math.max(
          0,
          Math.min(
            CONSULTATION_TOOL_TIMEOUT_MS,
            preToolBudget.remainingMs - CONSULTATION_SYNTHESIS_MIN_MS
          )
        );
        consultationDebugRecorder.emit('effective_tool_timeout', {
          iteration,
          action,
          tool: action,
          configuredToolTimeoutMs: CONSULTATION_TOOL_TIMEOUT_MS,
          effectiveToolTimeoutMs,
          remainingMs: preToolBudget.remainingMs,
          synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
        });

        if (effectiveToolTimeoutMs < CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS) {
          toolTrace.push({
            iteration,
            phase: 'act',
            action,
            status: 'skipped-budget',
            effectiveToolTimeoutMs,
          });
          consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
            iteration,
            action,
            tool: action,
            reason: 'effective_timeout_below_minimum',
            effectiveToolTimeoutMs,
            minimumMs: CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS,
            remainingMs: preToolBudget.remainingMs,
            synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
          });
          break;
        }

        const toolStartedAt = Date.now();

        const toolResult = await executeToolWithRetry(toolCtx, {
          toolName: action,
          knownFacts: {
            ...collectRetryFacts(),
            requestedParams: params,
            toolRegistry: toolRegistry.map((tool) => tool.action),
          },
          userMessage: message,
          maxAttempts: CONSULTATION_TOOL_MAX_ATTEMPTS,
          allowOpenApiFallback: true,
          toolTimeoutMs: effectiveToolTimeoutMs,
          llmGenerate: async (request) => this.callLlmGenerate(ctx, request),
          parser: (raw) => this.parseConsultationJsonResponse(raw),
          onAttemptStart: ({ toolName, attempt, timeoutMs }) => {
            consultationDebugRecorder.emit('consultation_tool_start', {
              iteration,
              action: toolName,
              tool: toolName,
              attempt,
              timeoutMs,
            });
          },
          onAttemptError: ({ toolName, attempt, durationMs, errorCode, errorMessage }) => {
            lastError = sanitizeConsultationDebugText(errorMessage, 240);
            consultationDebugRecorder.emit('consultation_tool_error', {
              iteration,
              action: toolName,
              tool: toolName,
              attempt,
              durationMs,
              errorCode: sanitizeConsultationDebugText(errorCode, 80),
              errorMessage: sanitizeConsultationDebugText(errorMessage, 240),
            });
          },
        });

        const attemptInfo = summarizeAttempts(toolResult);
        const retryCount = Math.max(0, (attemptInfo.attempts || 1) - 1);
        const toolDurationMs = Date.now() - toolStartedAt;
        const hadUnavailableAttempt = Array.isArray(toolResult.attemptsLog)
          ? toolResult.attemptsLog.some((attempt) =>
              /service not found|service not available|schema error|action not found/i.test(
                String(attempt?.error || '')
              )
            )
          : false;
        hadUnavailableAttemptOverall = hadUnavailableAttemptOverall || hadUnavailableAttempt;
        consultationDebugRecorder.emit('consultation_tool_end', {
          iteration,
          action,
          tool: action,
          attempt: attemptInfo.attempts,
          durationMs: toolDurationMs,
          status: toolResult.success ? 'success' : toolResult.failFast ? 'failed-fast' : 'failed',
          failFast: Boolean(toolResult.failFast),
          hadUnavailableAttempt,
        });

        if (toolResult.success) {
          const observation = this.summarizeConsultationObservation(action, toolResult.observation);
          observation.result = toolResult.observation;
          observation.attempts = attemptInfo.attempts;
          observations.push(observation);
          lastToolStatus = observation.status;
          toolTrace.push({
            iteration,
            phase: 'act',
            action,
            status: 'completed',
            params: toolResult.params || params,
            attempts: attemptInfo.attempts,
            schemaSource: toolResult.schemaSource,
          });
          collectedFacts.push({
            iteration,
            tool: action,
            status: 'completed',
            attempts: attemptInfo.attempts,
          });
          toolCallTracker?.record({
            phase: 'consultation',
            tool: action,
            params: toolResult.params || params,
            success: true,
            retries: retryCount,
            latencyMs: toolDurationMs,
            result: toolResult.observation,
          });
          executionTrace?.recordToolInvocation({
            phase: 'consultation',
            tool: action,
            params: toolResult.params || params,
            success: true,
            latencyMs: toolDurationMs,
            retries: retryCount,
            result: toolResult.observation,
          });
          consultationDebugRecorder.emit('consultation_observation', {
            iteration,
            action,
            status: observation.status,
            error: null,
            factsCount: collectedFacts.length,
          });

          // C) Log OBSERVE phase success
          if (agenticJobStore) {
            const obsPercent = Math.min(
              27 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
              47
            );
            agenticJobStore.appendLog(
              agenticJobId,
              `agentic_observe_${iteration}`,
              obsPercent,
              `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: OBSERVE ✓ ${action} (${attemptInfo.attempts} attempt${attemptInfo.attempts !== 1 ? 's' : ''})`,
              { iteration, action, status: 'completed', attempts: attemptInfo.attempts }
            );
          }

          if (
            iteration === 1 &&
            this.shouldEarlyExitConsultationLoop(action, toolResult.observation)
          ) {
            toolTrace.push({
              iteration,
              phase: 'observe',
              action,
              status: 'early-exit',
              reason: 'sufficient_first_tool_evidence',
            });
            break;
          }

          if (Date.now() - startedAt >= CONSULTATION_REACT_MAX_MS) {
            toolTrace.push({
              iteration,
              phase: 'guard',
              status: 'timeout-budget-reached-after-tool',
              maxMs: CONSULTATION_REACT_MAX_MS,
            });
            break;
          }

          const postToolBudget = emitBudgetCheck('post_tool', iteration);
          if (postToolBudget.remainingMs <= CONSULTATION_SYNTHESIS_MIN_MS) {
            consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
              iteration,
              action: null,
              tool: null,
              reason: 'insufficient_budget_after_tool',
              remainingMs: postToolBudget.remainingMs,
              synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
            });
            break;
          }

          continue;
        }

        const failFastError = new Error(toolResult.error || 'Tool-Call fehlgeschlagen');
        const observation = this.summarizeConsultationObservation(action, null, failFastError);
        observation.attempts = attemptInfo.attempts;
        observation.summary = [
          observation.summary,
          Array.isArray(toolResult.attemptsLog) && toolResult.attemptsLog.length > 0
            ? `Attempts: ${toolResult.attemptsLog.length}`
            : null,
        ]
          .filter(Boolean)
          .join(' | ')
          .slice(0, 400);
        observations.push(observation);
        lastToolStatus = observation.status;
        lastError = sanitizeConsultationDebugText(observation.summary, 240);

        toolTrace.push({
          iteration,
          phase: 'act',
          action,
          status: toolResult.failFast ? 'failed-fast' : 'failed',
          error: observation.summary,
          attempts: attemptInfo.attempts,
          schemaSource: toolResult.schemaSource,
        });

        collectedFacts.push({
          iteration,
          tool: action,
          status: toolResult.failFast ? 'failed-fast' : 'failed',
          attempts: attemptInfo.attempts,
        });
        toolCallTracker?.record({
          phase: 'consultation',
          tool: action,
          params,
          success: false,
          retries: retryCount,
          latencyMs: toolDurationMs,
          result: toolResult.observation,
          error: observation.summary,
        });
        executionTrace?.recordToolInvocation({
          phase: 'consultation',
          tool: action,
          params,
          success: false,
          latencyMs: toolDurationMs,
          retries: retryCount,
          result: toolResult.observation,
          error: observation.summary,
        });
        consultationDebugRecorder.emit('consultation_observation', {
          iteration,
          action,
          status: observation.status,
          error: sanitizeConsultationDebugText(observation.summary, 240),
          factsCount: collectedFacts.length,
        });

        // C) Log OBSERVE phase failure
        if (agenticJobStore) {
          const obsPercent = Math.min(
            27 + Math.round((iteration / CONSULTATION_REACT_MAX_ITERATIONS) * 20),
            47
          );
          agenticJobStore.appendLog(
            agenticJobId,
            `agentic_observe_${iteration}`,
            obsPercent,
            `Iteration ${iteration}/${CONSULTATION_REACT_MAX_ITERATIONS}: OBSERVE ✗ ${action} (${toolResult.failFast ? 'fail-fast' : 'failed'}, ${attemptInfo.attempts} attempt${attemptInfo.attempts !== 1 ? 's' : ''})`,
            {
              iteration,
              action,
              status: toolResult.failFast ? 'failed-fast' : 'failed',
              attempts: attemptInfo.attempts,
            }
          );
        }

        if (toolResult.failFast || hadUnavailableAttempt) {
          break;
        }

        const postToolBudget = emitBudgetCheck('post_tool', iteration);
        if (postToolBudget.remainingMs <= CONSULTATION_SYNTHESIS_MIN_MS) {
          consultationDebugRecorder.emit('tool_skipped_due_to_budget', {
            iteration,
            action: null,
            tool: null,
            reason: 'insufficient_budget_after_tool',
            remainingMs: postToolBudget.remainingMs,
            synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
          });
          break;
        }
      }

      if (observations.length === 0 && plannerFailed) {
        return null;
      }

      // Check if synthesis phase has enough time remaining (need at least 500ms)
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = CONSULTATION_REACT_MAX_MS - elapsedMs;
      emitBudgetCheck('pre_synthesis', iterationsExecuted || null);
      consultationDebugRecorder.emit('synthesis_budget_reserved', {
        phase: 'pre_synthesis',
        elapsedMs,
        remainingMs,
        maxMs: CONSULTATION_REACT_MAX_MS,
        synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
      });
      if (remainingMs < CONSULTATION_SYNTHESIS_MIN_MS) {
        // Synthesis budget reserve exceeded
        consultationDebugRecorder.emit('consultation_synthesis_skipped', {
          reason: 'remaining_budget_below_synthesis_reserve',
          remainingMs,
          synthesisMinMs: CONSULTATION_SYNTHESIS_MIN_MS,
        });

        if (observations.length > 0) {
          consultationDebugRecorder.emit('consultation_fallback_selected', {
            reason: 'budget_summary_from_observations',
            branch: 'observation_summary_reply',
            plannerFailed,
            hadUnavailableAttempt: hadUnavailableAttemptOverall,
            remainingMs,
            elapsedMs,
            iterations: iterationsExecuted,
            lastToolStatus,
            lastError,
          });
          return this.buildConsultationObservationSummaryReply(
            message,
            observations,
            collectedFacts,
            {
              debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
              synthesisPolicy,
              routingPolicy,
              knownContext,
              resolvedParams,
              knowledgeContext,
            }
          );
        }

        consultationDebugRecorder.emit('consultation_fallback_selected', {
          reason: 'synthesis_budget_exhausted',
          branch: 'fallbackConsultationReply',
          plannerFailed,
          hadUnavailableAttempt: hadUnavailableAttemptOverall,
          remainingMs,
          elapsedMs,
          iterations: iterationsExecuted,
          lastToolStatus,
          lastError,
        });
        return this.fallbackConsultationReply(message, observations, collectedFacts, {
          debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
        });
      }

      let synthesisStartedAt = null;
      try {
        const synthesisPrompt = this.buildConsultationPrompt({
          message,
          brokerRecommendation,
          resolvedParams,
          knowledgeContext,
          responseStrategy,
          recentHistoryWindow,
          observations,
          toolRegistry,
          synthesisPolicy,
          routingPolicy,
        });
        const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();

        synthesisStartedAt = Date.now();
        consultationDebugRecorder.emit('consultation_synthesis_start', {
          observationsCount: observations.length,
          collectedFactsCount: collectedFacts.length,
          elapsedMs,
          remainingMs,
          timeoutMs: synthesisTimeoutMs,
        });

        const raw = await this.callLlmGenerate(ctx, {
          system: synthesisPrompt,
          user: message,
          schema: CONSULTATION_OUTPUT_SCHEMA,
          timeoutMs: synthesisTimeoutMs,
          trace: {
            executionTrace,
            phase: 'consultation_synthesis',
            metadata: { observationCount: observations.length, timeoutMs: synthesisTimeoutMs },
          },
        });

        consultationDebugRecorder.emit('consultation_synthesis_end', {
          durationMs: Date.now() - synthesisStartedAt,
          observationsCount: observations.length,
        });

        const data = raw?.data || raw;
        if (!data || typeof data !== 'object' || !String(data.reply || '').trim()) {
          consultationDebugRecorder.emit('consultation_synthesis_null', {
            reason: 'empty_synthesis_payload',
            durationMs: Date.now() - synthesisStartedAt,
            observationsCount: observations.length,
          });

          if (observations.length > 0) {
            consultationDebugRecorder.emit('consultation_fallback_selected', {
              reason: 'agentic_synthesis_null_with_observations',
              branch: 'observation_summary_reply',
              plannerFailed,
              hadUnavailableAttempt: hadUnavailableAttemptOverall,
              remainingMs,
              elapsedMs,
              iterations: iterationsExecuted,
              lastToolStatus,
              lastError,
            });
            return this.buildConsultationObservationSummaryReply(
              message,
              observations,
              collectedFacts,
              {
                debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
                synthesisPolicy,
                routingPolicy,
                knownContext,
                resolvedParams,
                knowledgeContext,
              }
            );
          }

          return null;
        }

        const sanitizeArray = (arr) => (Array.isArray(arr) ? arr : []);
        return {
          reply: String(data.reply || '').trim(),
          hypotheses: sanitizeArray(data.hypotheses),
          openQuestions: sanitizeArray(data.openQuestions),
          nextActions: sanitizeArray(data.nextActions),
          factsUsed: sanitizeArray(data.factsUsed),
          attemptsSummary: collectedFacts.map((item) => ({
            iteration: item.iteration,
            tool: item.tool,
            status: item.status,
            attempts: item.attempts,
          })),
          toolTrace,
          ...(consultationDebugEnabled ? { debugTrace: consultationDebugTrace } : {}),
        };
      } catch (error) {
        const sanitizedSynthesisError = sanitizeConsultationDebugError(error);
        const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();
        consultationDebugRecorder.emit('consultation_synthesis_error', {
          durationMs:
            typeof synthesisStartedAt === 'number'
              ? Math.max(0, Date.now() - synthesisStartedAt)
              : null,
          errorName: sanitizedSynthesisError?.name || null,
          errorCode: sanitizedSynthesisError?.code || null,
          errorMessage: sanitizedSynthesisError?.message || null,
          observationsCount: observations.length,
          timeoutMs: synthesisTimeoutMs,
        });

        if (!isActionUnavailable(error)) {
          this.logger?.warn(
            `Consultation agentic synthesis failed (timeout=${synthesisTimeoutMs}ms, legacy fallback active): ${error.message}`
          );
        }

        consultationDebugRecorder.emit('consultation_synthesis_null', {
          reason: 'synthesis_exception',
          durationMs:
            typeof synthesisStartedAt === 'number'
              ? Math.max(0, Date.now() - synthesisStartedAt)
              : null,
          observationsCount: observations.length,
          errorCode: sanitizedSynthesisError?.code || null,
          errorMessage: sanitizedSynthesisError?.message || null,
        });

        if (observations.length > 0) {
          consultationDebugRecorder.emit('consultation_fallback_selected', {
            reason: 'agentic_synthesis_exception_with_observations',
            branch: 'observation_summary_reply',
            plannerFailed,
            hadUnavailableAttempt: hadUnavailableAttemptOverall,
            remainingMs,
            elapsedMs,
            iterations: iterationsExecuted,
            lastToolStatus,
            lastError:
              sanitizedSynthesisError?.message ||
              sanitizedSynthesisError?.code ||
              lastError ||
              null,
          });
          return this.buildConsultationObservationSummaryReply(
            message,
            observations,
            collectedFacts,
            {
              debugTrace: consultationDebugEnabled ? consultationDebugTrace : null,
              synthesisPolicy,
              routingPolicy,
              knownContext,
              resolvedParams,
              knowledgeContext,
            }
          );
        }

        return null;
      }
    },

    async callLlmGenerate(ctx, payload = {}) {
      const startedAt = Date.now();
      const trace = payload?.trace || null;
      const llmPayload = { ...payload };
      delete llmPayload.trace;
      const hasLocalLlmService =
        !!ctx?.broker &&
        typeof ctx.broker.hasLocalService === 'function' &&
        ctx.broker.hasLocalService('llm');
      const canCallBrokerAction =
        typeof ctx?.call === 'function' &&
        (!ctx?.broker || process.env.NODE_ENV === 'test' || hasLocalLlmService);

      if (canCallBrokerAction) {
        const response = await ctx.call('llm.generate', llmPayload, {
          meta: { ...ctx.meta, $gateway: false },
        });
        trace?.executionTrace?.recordLLMCall({
          phase: trace?.phase || 'llm.generate',
          latencyMs: Date.now() - startedAt,
          metadata: trace?.metadata || null,
        });
        return response;
      }

      const systemText = String(llmPayload.system || '').trim();
      const userText = String(llmPayload.user || '').trim();
      const prompt = [systemText, userText].filter(Boolean).join('\n\n');
      const options = {
        temperature: llmPayload.temperature,
        maxTokens: llmPayload.maxTokens,
      };

      if (llmPayload.schema && typeof llmPayload.schema === 'object') {
        const response = await llmGenerateStructured(llmPayload.schema, prompt, options);
        trace?.executionTrace?.recordLLMCall({
          phase: trace?.phase || 'llm.generate.structured',
          latencyMs: Date.now() - startedAt,
          metadata: trace?.metadata || null,
        });
        return response;
      }

      const text = await llmGenerateText(prompt, options);
      trace?.executionTrace?.recordLLMCall({
        phase: trace?.phase || 'llm.generate.text',
        latencyMs: Date.now() - startedAt,
        metadata: trace?.metadata || null,
      });
      return { text };
    },

    /**
     * Klassifiziert die Nutzer-Intention via LLM.
     * Versteht Kontext, Satzstruktur, Imperativ vs. Statement.
     * @param {Context} ctx — Moleculer Context
     * @param {string} message — Nutzer-Nachricht
     * @param {object} session — Aktuelle Session
     * @returns {Promise<{chatMode: string, confidence: number, reasoning: string}>}
     */
    async classifyChatModeLLM(ctx, message, session, options = {}) {
      const systemPrompt = [
        'Du bist ein Klassifikator für Chat-Modi in einem deutschen Energie-Beratungssystem.',
        '',
        'Deine Aufgabe: Analysiere die Nutzernachricht und entscheide, ob der Nutzer',
        '1. eine BERATUNG sucht (consultation) — Einordnung, Erklärung, Problembeschreibung',
        '2. eine PRÜFUNG/AUSFÜHRUNG fordert (execution) — konkrete Aktion, Datenabruf',
        '',
        'REGELN:',
        '- „Ich habe...", „Der Code ist...", „Ich werde abgeregelt" → consultation (Beschreibung)',
        '- „Prüfe...", „Finde...", „Gib mir...", „Starte..." → execution (Aufforderung)',
        '- „Wie hoch ist...", „Was soll ich tun...", „Warum..." → consultation (Frage/Rat)',
        '- „Stadtwerke X, BDEW unbekannt" → consultation (Information bereitstellen)',
        '- „Validiere den MaStR-Eintrag" → execution (konkrete Prüfung)',
        '',
        'Antworte NUR mit einem JSON-Objekt: { "chatMode": "consultation"|"execution", "confidence": 0.0-1.0, "reasoning": "..." }',
        'Kein Markdown, keine Erklärung außerhalb des JSON.',
      ].join('\n');

      const hasPlanStack = Array.isArray(session?.l3?.planStack) && session.l3.planStack.length > 0;
      const userPrompt = [
        `Nachricht: "${String(message || '').trim()}"`,
        '',
        `Session-Kontext: ${hasPlanStack ? 'Es gibt einen offenen Plan-Stack.' : 'Kein offener Plan.'}`,
        '',
        'Klassifiziere:',
      ].join('\n');

      try {
        const llmResponse = await this.callLlmGenerate(ctx, {
          system: systemPrompt,
          user: userPrompt,
          temperature: 0.1,
          maxTokens: 256,
          trace: {
            executionTrace: options.executionTrace || null,
            phase: 'chat_mode_classifier',
            metadata: {
              hasPlanStack,
            },
          },
        });

        const raw = llmResponse?.text || llmResponse?.content || llmResponse;
        const jsonMatch = String(raw || '').match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          this.logger?.warn('[classifyChatModeLLM] Kein JSON in LLM-Antwort gefunden:', raw);
          return { chatMode: null, confidence: 0, reasoning: 'JSON parse error' };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return {
          chatMode: ['consultation', 'execution'].includes(parsed.chatMode)
            ? parsed.chatMode
            : null,
          confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
          reasoning: parsed.reasoning || 'Keine Begründung',
        };
      } catch (error) {
        this.logger?.warn('[classifyChatModeLLM] LLM-Fehler:', error.message);
        return { chatMode: null, confidence: 0, reasoning: `LLM error: ${error.message}` };
      }
    },

    async classifyConsultationIntentHybrid(ctx, message, knownContext = {}, options = {}) {
      const fallback = fuzzyClassifyConsultationIntent(message, knownContext, []);

      const systemPrompt = [
        'Du bist ein Intent-Klassifikator für Consultation-to-Execution im Energiemarkt.',
        'Klassifiziere die Anfrage strikt als JSON.',
        'Felder:',
        '- workflowType',
        '- personaType',
        '- domainIntent',
        '- executionReadinessIntent',
        '- advisoryOnly (boolean)',
        '- availableInputs (array)',
        '- missingInputs (array)',
        '- confidence (0..1)',
        '- rationale',
        'Wichtig: Nutze Semantik, keine starren Keyword-Matches.',
        'Wenn Governance/Blackbox/AI-Risiko: advisoryOnly=true.',
      ].join('\n');

      try {
        const raw = await this.callLlmGenerate(ctx, {
          system: systemPrompt,
          user: `Anfrage: ${String(message || '').trim()}\nKontext: ${JSON.stringify(knownContext || {})}`,
          temperature: 0,
          maxTokens: 500,
          trace: {
            executionTrace: options.executionTrace || null,
            phase: 'consultation_intent_classifier',
          },
        });

        const parsed = this.parseConsultationJsonResponse(raw?.text || raw?.content || raw);
        if (!parsed || typeof parsed !== 'object') {
          return fallback;
        }

        return {
          workflowType: String(parsed.workflowType || fallback.workflowType),
          personaType: String(parsed.personaType || fallback.personaType || 'general'),
          domainIntent: String(
            parsed.domainIntent || fallback.domainIntent || 'consultation_general'
          ),
          executionReadinessIntent: String(
            parsed.executionReadinessIntent || fallback.executionReadinessIntent || 'awaiting_input'
          ),
          advisoryOnly: Boolean(parsed.advisoryOnly),
          availableInputs: Array.isArray(parsed.availableInputs)
            ? parsed.availableInputs
            : fallback.availableInputs,
          missingInputs: Array.isArray(parsed.missingInputs)
            ? parsed.missingInputs
            : fallback.missingInputs,
          confidence: Math.max(
            0,
            Math.min(1, Number(parsed.confidence || fallback.confidence || 0))
          ),
          rationale: String(parsed.rationale || fallback.rationale || 'hybrid-fallback'),
          source: 'llm',
        };
      } catch (_error) {
        return fallback;
      }
    },

    applyConsultationGuardrailsToBroker(brokerRecommendation = {}, semanticClassification = null) {
      if (!brokerRecommendation || typeof brokerRecommendation !== 'object') {
        return brokerRecommendation;
      }
      if (!semanticClassification || typeof semanticClassification !== 'object') {
        return brokerRecommendation;
      }

      const intent = String(brokerRecommendation.intent || '').toLowerCase();
      const workflowType = String(semanticClassification.workflowType || '').toLowerCase();
      const advisoryOnly = Boolean(semanticClassification.advisoryOnly);

      const blocksForecast = advisoryOnly && /residual_load_forecast|forecast/.test(intent);
      const blocksVdmiAsset =
        /vdmi_asset_validation_governance/.test(intent) &&
        [
          'bess_screening',
          'bess_development',
          'process_governance_decision_matrix',
          'edm_market_communication_diagnostics',
          'prosumer_nap_wallet_onboarding',
        ].includes(workflowType);

      const blocksMastrInventory =
        /mastr_asset_inventory/.test(intent) && workflowType === 'prosumer_nap_wallet_onboarding';

      if (!(blocksForecast || blocksVdmiAsset || blocksMastrInventory)) {
        return brokerRecommendation;
      }

      return {
        ...brokerRecommendation,
        intent: semanticClassification.domainIntent || brokerRecommendation.intent,
        confidence: Math.min(Number(brokerRecommendation.confidence || 0.5), 0.45),
        summary: 'hybrid-semantic-guardrail-correction',
        guardrailCorrection: {
          applied: true,
          workflowType: semanticClassification.workflowType,
          domainIntent: semanticClassification.domainIntent,
          advisoryOnly,
        },
      };
    },

    async handleConsultationTurn(ctx, input = {}) {
      const message = String(input.message || '').trim();
      const brokerRecommendation = input.brokerRecommendation || {};
      const resolvedParams =
        input.resolvedParams && typeof input.resolvedParams === 'object'
          ? input.resolvedParams
          : {};
      const knowledgeContext = input.knowledgeContext || null;
      const responseStrategy = input.responseStrategy || null;
      const synthesisPolicy = input.synthesisPolicy || null;
      const routingPolicy = input.routingPolicy || null;
      const recentHistoryWindow = Array.isArray(input.recentHistoryWindow)
        ? input.recentHistoryWindow
        : this.buildConsultationRecentHistoryWindow(input.session || null);
      const consultationDebugEnabled = isConsultationDebugEnabled(input.knownContext || {});
      const consultationDebugSink = consultationDebugEnabled
        ? Array.isArray(input.consultationDebugSink)
          ? input.consultationDebugSink
          : []
        : null;

      const finalizeConsultationResult = (result, { timeoutFallback = false } = {}) => {
        const normalizedResult = result && typeof result === 'object' ? result : {};
        const degradation = this.deriveConsultationDegradation(normalizedResult, {
          timeoutFallback,
        });
        const responsePolicyContract = this.buildResponsePolicyContract({
          message,
          workflowType:
            normalizedResult.workflowType || input?.semanticClassification?.workflowType || null,
          domainIntent:
            normalizedResult.domainIntent ||
            input?.semanticClassification?.domainIntent ||
            brokerRecommendation?.intent ||
            null,
          knownContext: input.knownContext || {},
          receiptKnowledgeEvidence: input.receiptKnowledgeEvidence || null,
          observations: Array.isArray(normalizedResult.toolTrace) ? normalizedResult.toolTrace : [],
          verifiedFacts: Array.isArray(normalizedResult.factsUsed)
            ? normalizedResult.factsUsed
            : [],
        });

        const guarded = this.applyResponsePolicyGuardrails({
          reply: String(normalizedResult.reply || ''),
          contract: responsePolicyContract,
          timeoutFallback,
        });

        return {
          ...normalizedResult,
          reply: guarded.reply,
          workflowType: responsePolicyContract.workflowType,
          domainIntent: responsePolicyContract.domainIntent,
          evidenceStatus: responsePolicyContract.evidenceStatus,
          missingEvidence: responsePolicyContract.missingEvidence,
          nextVerificationSteps: responsePolicyContract.nextVerificationSteps,
          guardrailCorrections: guarded.guardrailCorrections,
          ...(degradation ? { degradation } : {}),
        };
      };

      const agenticConsultation = await this.handleConsultationTurnAgentic(ctx, {
        ...input,
        responseStrategy,
        recentHistoryWindow,
        consultationDebugSink,
        synthesisPolicy,
        routingPolicy,
      });
      if (agenticConsultation) {
        const debugTrace = Array.isArray(agenticConsultation.debugTrace)
          ? agenticConsultation.debugTrace
          : [];
        const timeoutFallback = debugTrace.some(
          (event) =>
            event?.type === 'consultation_fallback_selected' &&
            event?.reason === 'synthesis_budget_exhausted'
        );
        return finalizeConsultationResult(agenticConsultation, { timeoutFallback });
      }

      if (consultationDebugEnabled) {
        createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
          'consultation_fallback_selected',
          {
            reason: 'agentic_returned_null',
            branch: 'legacy_non_agentic_consultation',
            plannerFailed: false,
            hadUnavailableAttempt: false,
            remainingMs: null,
            elapsedMs: null,
            iterations: null,
            lastToolStatus: null,
            lastError: null,
          }
        );
      }

      const buildLegacyFallback = (reason) =>
        this.buildConsultationOperationalDegradationReply(message, {
          reason,
          timeoutFallback: true,
          debugTrace: consultationDebugEnabled ? consultationDebugSink : null,
        });

      if (!message) {
        return finalizeConsultationResult(buildLegacyFallback('empty_message'), {
          timeoutFallback: true,
        });
      }

      try {
        const systemPrompt = this.buildConsultationPrompt({
          message,
          brokerRecommendation,
          resolvedParams,
          knowledgeContext,
          responseStrategy,
          recentHistoryWindow,
        });
        const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();

        const raw = await this.callLlmGenerate(ctx, {
          system: systemPrompt,
          user: message,
          schema: CONSULTATION_OUTPUT_SCHEMA,
          timeoutMs: synthesisTimeoutMs,
          trace: {
            executionTrace: input.executionTrace || null,
            phase: 'consultation_non_agentic',
            metadata: { timeoutMs: synthesisTimeoutMs },
          },
        });

        const data = raw?.data || raw;
        if (!data || typeof data !== 'object' || !String(data.reply || '').trim()) {
          if (consultationDebugEnabled) {
            createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
              'consultation_synthesis_null',
              {
                reason: 'non_agentic_empty_payload',
              }
            );
            createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
              'consultation_fallback_selected',
              {
                reason: 'non_agentic_empty_payload',
                branch: 'deterministic_consultation_fallback',
                plannerFailed: false,
                hadUnavailableAttempt: false,
                remainingMs: null,
                elapsedMs: null,
                iterations: null,
                lastToolStatus: null,
                lastError: null,
              }
            );
          }
          return finalizeConsultationResult(buildLegacyFallback('non_agentic_empty_payload'), {
            timeoutFallback: true,
          });
        }

        const sanitizeArray = (arr) => (Array.isArray(arr) ? arr : []);
        return finalizeConsultationResult({
          reply: String(data.reply || '').trim(),
          hypotheses: sanitizeArray(data.hypotheses),
          openQuestions: sanitizeArray(data.openQuestions),
          nextActions: sanitizeArray(data.nextActions),
          factsUsed: sanitizeArray(data.factsUsed),
          ...(consultationDebugEnabled ? { debugTrace: consultationDebugSink } : {}),
        });
      } catch (error) {
        const synthesisTimeoutMs = this.resolveConsultationSynthesisTimeoutMs();
        if (!isActionUnavailable(error)) {
          this.logger?.warn(
            `Consultation LLM generation failed (timeout=${synthesisTimeoutMs}ms, fallback active): ${error.message}`
          );
        }
        if (consultationDebugEnabled) {
          const sanitizedError = sanitizeConsultationDebugError(error);
          createConsultationDebugRecorder({ enabled: true, trace: consultationDebugSink }).emit(
            'consultation_fallback_selected',
            {
              reason: 'non_agentic_exception',
              branch: 'deterministic_consultation_fallback',
              plannerFailed: false,
              hadUnavailableAttempt: false,
              remainingMs: null,
              elapsedMs: null,
              iterations: null,
              lastToolStatus: null,
              lastError: sanitizedError?.message || sanitizedError?.code || null,
            }
          );
        }
        const fallbackResult = buildLegacyFallback('non_agentic_exception');
        return finalizeConsultationResult(fallbackResult, { timeoutFallback: true });
      }
    },

    /**
     * Build an empathetic, context-aware onboarding reply using the LLM.
     *
     * When a required parameter is missing and execution enters `awaiting-onboarding`,
     * this method generates a short (2-3 sentence) German reply that:
     *   1. Explains WHY the missing parameter is needed in the context of the user's request.
     *   2. Poses the actual question (from `onboardingQuestion.questionText`).
     *   3. Optionally suggests an alternative path if the user cannot answer immediately.
     *
     * Falls back gracefully to the raw `questionText` if the LLM call fails or is not
     * configured, so existing deterministic tests are not affected.
     *
     * @param {object} opts
     * @param {string} opts.message       Original user message for this turn.
     * @param {object} opts.execution     Execution result with stopPoint.
     * @param {object} opts.plan          Resolved execution plan.
     * @returns {Promise<{markdown: string, nextActions: Array}>}
     */
    async buildEmpathethicOnboardingReply({ message, execution, plan }) {
      const onboardingQuestion = execution?.stopPoint?.onboardingQuestion;
      const questionText = onboardingQuestion?.questionText || execution?.stopPoint?.message || '';
      const paramKey = onboardingQuestion?.paramKey || null;

      const staticAlternatives =
        paramKey && Array.isArray(ONBOARDING_PARAM_ALTERNATIVES[paramKey])
          ? ONBOARDING_PARAM_ALTERNATIVES[paramKey]
          : [];

      const fallback = { markdown: questionText, nextActions: [] };
      if (!questionText) return fallback;

      const nextActions = staticAlternatives.map((alt) => ({
        label: alt,
        type: 'alternative_path',
      }));

      const deterministicTemplate = [
        'Damit ich die angeforderte Prüfung belastbar fortsetzen kann, fehlt mir noch eine entscheidende Angabe.',
        questionText,
        staticAlternatives.length > 0
          ? `Falls das gerade nicht vorliegt: ${staticAlternatives[0]}`
          : null,
      ]
        .filter(Boolean)
        .join(' ');

      if (String(process.env.PERSONAL_AGENT_ONBOARDING_LLM || 'false').toLowerCase() !== 'true') {
        return { markdown: deterministicTemplate, nextActions };
      }

      const userSnippet = String(message || '')
        .trim()
        .slice(0, 400);
      const planSteps = Array.isArray(plan?.steps)
        ? plan.steps
            .map((s) => s.label || s.action)
            .filter(Boolean)
            .join(', ')
        : '';
      const altHint =
        staticAlternatives.length > 0
          ? `Falls die Angabe noch nicht verfügbar ist, biete als Alternative an: "${staticAlternatives[0]}"`
          : 'Falls die Angabe nicht sofort verfügbar ist, biete kurz eine sinnvolle Alternative an.';

      const prompt = [
        'Du bist ein professioneller, empathischer Energie-Assistent (Cernion Personal Agent).',
        `Der Nutzer stellte folgende Anfrage: "${userSnippet}"`,
        planSteps ? `Geplante Prüfschritte: ${planSteps}` : '',
        '',
        `Um fortzufahren, muss der Assistent die folgende Angabe erfragen: "${questionText}"`,
        '',
        'Schreibe eine kurze, kontextbezogene Antwort (2-3 Sätze) auf Deutsch:',
        '- Satz 1: Erkläre empathisch und direkt, WARUM genau diese Angabe für die konkrete Nutzeranfrage benötigt wird.',
        '- Satz 2: Stelle die eigentliche Frage (wortgetreu oder leicht adaptiert an den Kontext).',
        `- Satz 3 (wenn sinnvoll): ${altHint}`,
        '',
        'Antworte NUR mit dem fertigen Text. Keine Überschriften, keine Markdown-Liste, keine Erklärungen.',
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const llmText = (
          await llmGenerateText(prompt, {
            operation: 'onboarding-empathetic-reply',
            maxTokens: 220,
            timeoutMs: 8000,
          })
        )?.trim();

        if (!llmText || llmText.length < 15) return fallback;

        return { markdown: llmText, nextActions };
      } catch (err) {
        this.logger?.warn(
          `buildEmpathethicOnboardingReply LLM failed (non-blocking): ${err?.message}`
        );
        // Deterministic fallback: return raw question with static alternatives
        return { markdown: deterministicTemplate, nextActions };
      }
    },

    /**
     * Run the Dream pipeline for a session.
     * Called by the inactivity timer; errors are silently swallowed.
     */
    async runDream(broker, payload = {}) {
      const tenantId = String(payload.tenantId || 'default');
      const sessionId = String(payload.sessionId || '');
      const userId = String(payload.userId || payload.authMeta?.authUser?.userId || 'anonymous');
      const profileNamespace =
        payload.profileNamespace || tenantNamespace(PROFILE_NAMESPACE, tenantId);

      if (!sessionId) {
        this.logger?.warn('Dream pipeline skipped: missing sessionId in payload');
        return;
      }

      const dreamMeta = this.deepMergeMeta(
        this.buildDreamAuthMeta(payload.authMeta || {}, tenantId, userId),
        {
          source: 'personal-agent.dream',
          wakeUp: true,
        }
      );

      const dreamCtx = {
        meta: dreamMeta,
        call: (action, params, options = {}) => {
          const mergedMeta = this.deepMergeMeta(options.meta || {}, dreamMeta);
          return broker.call(action, params, { ...options, meta: mergedMeta });
        },
      };

      let session;
      try {
        session = await this.loadSession(dreamCtx, tenantId, sessionId, userId, {
          createIfMissing: false,
        });
      } catch (err) {
        if (isNotFound(err) && payload.session && typeof payload.session === 'object') {
          // v0.52.5 payload compatibility fallback (zero-downtime rollout)
          session = payload.session;
        } else if (isNotFound(err)) {
          this.logger?.info(`Dream pipeline skipped: session ${sessionId} no longer exists.`);
          return;
        } else {
          throw err;
        }
      }

      try {
        await runDreamPipeline(dreamCtx, sessionId, tenantId, userId, profileNamespace, session);
      } catch (err) {
        this.logger?.warn(`Dream pipeline failed for session ${sessionId}: ${err.message}`);
      }
    },

    buildDreamAuthMeta(meta = {}, tenantId, userId) {
      const safeMeta = meta && typeof meta === 'object' ? meta : {};
      const authUser =
        safeMeta.authUser && typeof safeMeta.authUser === 'object' ? safeMeta.authUser : {};
      const requestHeaders = this.sanitizeDreamRequestHeaders(safeMeta.requestHeaders);

      const nextAuthUser = {
        ...authUser,
        userId,
      };

      return {
        tenantId,
        authUser: nextAuthUser,
        roles: Array.isArray(safeMeta.roles) ? safeMeta.roles : undefined,
        scopes: Array.isArray(safeMeta.scopes) ? safeMeta.scopes : undefined,
        permissions: Array.isArray(safeMeta.permissions) ? safeMeta.permissions : undefined,
        auth: safeMeta.auth && typeof safeMeta.auth === 'object' ? safeMeta.auth : undefined,
        requestHeaders,
      };
    },

    sanitizeDreamRequestHeaders(headers) {
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        return undefined;
      }

      const allowed = ['x-request-id', 'x-correlation-id', 'traceparent', 'tracestate'];
      const sanitized = {};

      for (const [key, value] of Object.entries(headers)) {
        const normalizedKey = String(key || '')
          .trim()
          .toLowerCase();
        if (!allowed.includes(normalizedKey)) {
          continue;
        }
        sanitized[normalizedKey] = value;
      }

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },

    deepMergeMeta(base = {}, patch = {}) {
      const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
      if (!isObject(base)) {
        return isObject(patch) ? { ...patch } : patch;
      }
      if (!isObject(patch)) {
        return { ...base };
      }

      const merged = { ...base };
      for (const [key, patchValue] of Object.entries(patch)) {
        const baseValue = merged[key];
        if (isObject(baseValue) && isObject(patchValue)) {
          merged[key] = this.deepMergeMeta(baseValue, patchValue);
          continue;
        }
        merged[key] = patchValue;
      }
      return merged;
    },

    buildFileProcessingIntro(fileProcessing = []) {
      if (!Array.isArray(fileProcessing) || fileProcessing.length === 0) {
        return '';
      }

      const okCount = fileProcessing.filter((item) => item.status === 'ok').length;
      const errorItems = fileProcessing.filter((item) => item.status === 'error');
      const total = fileProcessing.length;

      if (errorItems.length === 0) {
        return `Ich habe ${okCount} Datei(en) verarbeitet. `;
      }

      const names = errorItems
        .map((item) => item.fileName)
        .filter(Boolean)
        .join(', ');
      return `Ich habe ${okCount} von ${total} Datei(en) verarbeitet. Bei ${names} gab es einen Parse-Fehler. `;
    },

    resolveExtractForAttachment(file, typeInfo) {
      if (!typeInfo) {
        return null;
      }

      if (typeInfo.category === 'tabular' && typeInfo.ext === '.csv') {
        return parseCsvExtract(file.tempPath);
      }

      if (
        typeInfo.category === 'tabular' &&
        (typeInfo.ext === '.xlsx' || typeInfo.ext === '.xls')
      ) {
        return parseExcelExtract(file.tempPath);
      }

      if (typeInfo.category === 'image') {
        return ocrExtractImage(file.tempPath);
      }

      if (typeInfo.category === 'document') {
        return extractDocumentText(file.tempPath);
      }

      return {
        type: 'unsupported',
        summary: `Dateityp ${typeInfo.mimeType} wird in dieser Version nicht unterstützt.`,
      };
    },

    /**
     * Read the raw text content from successfully processed text-based attachments
     * and return as a transient inhouseData array for the current turn only.
     * This data is injected into preflightKnownContext but is NEVER persisted
     * into the session (guarded by FORBIDDEN_L4_KEYS in personal-agent-context.js).
     */
    buildInhouseDataFromAttachments(rawFiles = [], fileProcessing = []) {
      if (!Array.isArray(rawFiles) || rawFiles.length === 0) return [];

      const successIds = new Set(
        (Array.isArray(fileProcessing) ? fileProcessing : [])
          .filter((r) => r.status === 'ok')
          .map((r) => r.attachmentId)
      );

      const result = [];
      for (const file of rawFiles) {
        const attachmentId = String(file?.attachmentId || '');
        if (!successIds.has(attachmentId)) continue;
        if (!file?.tempPath) continue;

        try {
          const textContent = readTextContent(file.tempPath);
          if (!textContent) continue; // non-text format, silently skip

          result.push({
            attachmentId,
            fileName: String(file.fileName || 'attachment'),
            mimeType: String(file.mimeType || 'text/plain'),
            content: textContent.content,
            truncated: textContent.truncated,
            originalSizeBytes: textContent.originalSizeBytes,
          });
        } catch {
          // File errors during text read are non-fatal for this turn
        }
      }
      return result;
    },

    processFileAttachments(session, files = []) {
      if (!Array.isArray(files) || files.length === 0) {
        return [];
      }

      const results = [];

      for (const file of files) {
        const attachmentId = String(file?.attachmentId || `fa_${crypto.randomUUID().slice(0, 8)}`);
        const fileName = String(file?.fileName || 'attachment');
        const mimeType = String(file?.mimeType || 'application/octet-stream');
        const sizeBytes = Number(file?.sizeBytes || 0);

        try {
          const typeInfo = recognizeFileType(file?.tempPath);
          const extract = this.resolveExtractForAttachment(file, typeInfo);

          injectFileIntoL3(session, {
            attachmentId,
            fileName,
            mimeType,
            category: typeInfo.category,
            sizeBytes,
            extract,
          });

          results.push({
            attachmentId,
            fileName,
            status: 'ok',
          });
        } catch (error) {
          const mappedError = {
            code: error?.code || 'PARSE_ERROR',
            message: error?.message || 'Datei konnte nicht verarbeitet werden.',
          };

          injectFileIntoL3(session, {
            attachmentId,
            fileName,
            mimeType,
            category: 'unknown',
            sizeBytes,
            extract: null,
            error: mappedError,
          });

          results.push({
            attachmentId,
            fileName,
            status: 'error',
            error: mappedError,
          });
        }
      }

      return results;
    },

    synthesizeTurn({
      message,
      toolContext,
      executionMode,
      plan,
      execution,
      fileProcessing = [],
      knowledgeContext = null,
      responseStrategy = null,
    }) {
      const fileIntro = this.buildFileProcessingIntro(fileProcessing);
      const promptExcerpt = String(message || '')
        .trim()
        .slice(0, 220);
      const synthesisStyle = knowledgeContext?.synthesisStyle || null;
      const styleLead = this.buildSynthesisStyleLead(synthesisStyle);
      const strategyLead = this.buildStrategyLead(responseStrategy);
      const prefixed = (text) => {
        const segments = [styleLead, strategyLead, text].filter(Boolean);
        return segments.length > 0 ? segments.join(' ') : text;
      };

      if (toolContext && toolContext.responseRaw) {
        const keyCount = Object.keys(toolContext.responseRaw || {}).length;
        return prefixed(
          `${fileIntro}Tool-Ergebnis verarbeitet (${keyCount} Felder). Zusammenfassung erstellt und Layer 4 verworfen.`
        );
      }
      if (executionMode === EXECUTION_MODES.HITL) {
        return prefixed(
          `${fileIntro}Plan bereit: ${plan.steps.length} deterministische Schritte für „${String(
            message
          )
            .trim()
            .slice(0, 160)}“. Ausführung wartet auf Freigabe.`
        );
      }
      if (execution?.status === 'awaiting-onboarding') {
        return this.buildRecoveryReply({
          message,
          plan,
          execution,
          fileIntro,
          assumptions: execution?.assumptions || [],
          synthesisStyle,
          responseStrategy,
        });
      }
      if (execution?.status === 'completed') {
        if (plan?.primaryIntent === 'netzbetreiber_flexibility_potential') {
          return this.buildGridOperatorFlexibilityCompletedReply({
            execution,
            message,
            fileIntro,
          });
        }
        return prefixed(
          `${fileIntro}Plan abgeschlossen: ${execution.steps.length} Schritte deterministisch ausgeführt. Kontext: ${promptExcerpt}`
        );
      }
      if (execution?.status === 'partial') {
        return this.buildRecoveryReply({
          message,
          plan,
          execution,
          fileIntro,
          assumptions: execution?.assumptions || [],
          synthesisStyle,
          responseStrategy,
        });
      }
      return prefixed(
        `${fileIntro}Verstanden. Nächster Schritt für: ${String(message).trim().slice(0, 240)}`
      );
    },

    buildGridOperatorFlexibilityCompletedReply({ execution = {}, message = '', fileIntro = '' } = {}) {
      const steps = Array.isArray(execution?.steps) ? execution.steps : [];
      const marketStep = steps.find((step) => step?.action === 'grid-operations.marketPartners');
      const cockpitStep = steps.find(
        (step) => step?.action === 'dashboard-api.redispatchMeteringCockpit'
      );
      const cockpit = cockpitStep?.result && typeof cockpitStep.result === 'object' ? cockpitStep.result : {};
      const evidence = cockpit.evidence && typeof cockpit.evidence === 'object' ? cockpit.evidence : {};
      const readiness = cockpit.decisionReadiness || {};
      const operator = cockpit.operator || {};
      const marketResult =
        marketStep?.result && typeof marketStep.result === 'object' ? marketStep.result : {};
      const marketCandidates =
        marketResult?.data?.results ||
        marketResult?.results ||
        marketResult?.result?.results ||
        marketResult?.result?.vnbs ||
        [];
      const candidate = Array.isArray(marketCandidates) ? marketCandidates[0] || null : null;
      const operatorLabel =
        operator.name ||
        candidate?.name ||
        candidate?.companyName ||
        candidate?.vnbName ||
        'Stadtwerke Tübingen / Netzbetreiber-Kontext';

      const valueOrOpen = (value, suffix = '') =>
        value === 0 || value ? `${value}${suffix}` : 'Offen';
      const gapCodes = Array.isArray(cockpit.blockingEvidenceGaps)
        ? cockpit.blockingEvidenceGaps.map((gap) => gap?.code || gap?.message).filter(Boolean)
        : [];
      const blockers = gapCodes.length > 0 ? gapCodes.join(', ') : 'Keine Cockpit-Blocker gemeldet';

      const rows = [
        [
          'Operator-Kandidat',
          operatorLabel,
          'grid-operations.marketPartners',
          candidate ? 'Mittel' : 'Offen',
          'Basis fuer BDEW/MaStR-Aufloesung vor Detailinventar',
        ],
        [
          'Redispatch/Metering Readiness',
          readiness.signal ? `${readiness.signal}${readiness.score ? ` (${readiness.score})` : ''}` : 'Offen',
          'dashboard-api.redispatchMeteringCockpit',
          readiness.signal ? 'Mittel' : 'Offen',
          'Zeigt, ob RD2.0/Messdaten als Entscheidungsbasis nutzbar sind',
        ],
        [
          'Redispatch Settlement Readiness',
          valueOrOpen(evidence.redispatch?.settlementReadinessPercent, ' %'),
          'dashboard-api.redispatchMeteringCockpit',
          evidence.redispatch?.settlementReadinessPercent == null ? 'Offen' : 'Mittel',
          'Indikator fuer Prozessreife, nicht fuer freies MW-Potenzial',
        ],
        [
          'Messdaten gesund / stale / fehlerhaft',
          `${valueOrOpen(evidence.metering?.datapointsHealthy)} / ${valueOrOpen(
            evidence.metering?.datapointsStale
          )} / ${valueOrOpen(evidence.metering?.datapointsErrored)}`,
          'dashboard-api.redispatchMeteringCockpit',
          evidence.metering ? 'Mittel' : 'Offen',
          'Grundlage fuer Lastgang- und Gleichzeitigkeitsbewertung',
        ],
        [
          'Masterdata Quality',
          valueOrOpen(evidence.masterData?.qualityScore),
          'dashboard-api.redispatchMeteringCockpit',
          evidence.masterData?.qualityScore == null ? 'Offen' : 'Mittel',
          'Qualitaetsanker fuer Anlagen-/Netzbetreiber-Zuordnung',
        ],
        [
          '§14a / RD2.0 MW-Inventar',
          'Offen',
          'VNBdigital §14a, MaStR/Assets, Topologie/Lastfluss noch nachziehen',
          'Offen',
          'Keine MW-Zusage ohne BDEW/MaStR, Topologie und Lastfluss',
        ],
      ];

      const table = [
        '| Kennzahl | Wert | Quelle | Belastbarkeit | Bedeutung fuer Entscheidung |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map((row) => `| ${row.join(' | ')} |`),
      ].join('\n');

      return [
        `${fileIntro}${table}`,
        '',
        `Kurzfazit: Der Dialog ist als Executive Erstlagebild nutzbar. Die aktuellen Zahlen sind Prozess- und Evidenzkennzahlen, noch kein belastbares MW-Flexibilitaetspotenzial.`,
        `Offene Evidenz: ${blockers}. Fuer MW-Potenzial muessen §14a-Anlagen, Redispatch-2.0-Anlagen, Topologie, Lastfluss und Gleichzeitigkeitsannahmen nachgezogen werden.`,
        'Empfehlung: Speicher zuerst pruefen, weil sie Rueckspeisespitzen direkt verschieben koennen; danach flexible Industrie und Ladeparks mit netzdienlichem Fahrplan; Rechenzentren nur mit Standort-, Abwaerme- und Netzanschlussnachweis priorisieren.',
        `Kontext: ${String(message || '').trim().slice(0, 220)}`,
      ].join('\n');
    },

    buildSynthesisStyleLead(synthesisStyle) {
      if (synthesisStyle === 'cautionary') {
        return 'Risikohinweis:';
      }
      if (synthesisStyle === 'methodological') {
        return 'Methodik-Hinweis:';
      }
      return '';
    },

    buildRecoveryReply({
      message,
      plan = {},
      execution = {},
      fileIntro = '',
      assumptions = [],
      synthesisStyle = null,
      responseStrategy = null,
    }) {
      const taskTone =
        synthesisStyle === 'cautionary' || this.isFinanceRiskTask(message, plan, execution)
          ? 'finance-risk'
          : 'general';
      const completedStepSummaries = this.summarizeCompletedSteps(plan, execution);
      const stopPoint = execution?.stopPoint || {};
      const progressPrefix =
        taskTone === 'finance-risk' ? 'Für die Risikoprüfung' : 'Für die fachliche Bewertung';
      const styleLead = this.buildSynthesisStyleLead(synthesisStyle);
      const strategyLead = this.buildStrategyLead(responseStrategy);

      const progressText =
        completedStepSummaries.length > 0
          ? `${progressPrefix} habe ich bereits ${completedStepSummaries.length === 1 ? 'einen Prüfschritt' : `${completedStepSummaries.length} Prüfschritte`} abgeschlossen: ${completedStepSummaries.join('; ')}.`
          : `${progressPrefix} konnte ich noch keinen Prüfschritt abschließen.`;

      const locationAssumption = assumptions.find((a) => a.type === 'location_operator_unverified');
      const riskWarning = locationAssumption
        ? this.buildLocationAssumptionWarning(locationAssumption)
        : '';

      const stopText = this.buildRecoveryStopText({ plan, execution, stopPoint, taskTone });
      const nextText = this.buildRecoveryNextText({
        message,
        plan,
        execution,
        stopPoint,
        taskTone,
        assumptions,
      });

      const assumptionText =
        responseStrategy?.assumptions?.length > 0
          ? responseStrategy.assumptions
              .slice(0, 2)
              .map((assumption) => assumption?.statement)
              .filter(Boolean)
              .join(' ')
          : '';

      return this.normalizeRecoveryText(
        [
          styleLead,
          strategyLead,
          fileIntro,
          assumptionText,
          progressText,
          riskWarning,
          stopText,
          nextText,
        ]
          .filter(Boolean)
          .join(' ')
      );
    },

    buildLocationAssumptionWarning(assumption = {}) {
      if (!assumption || !assumption.assertedGridOperatorName) {
        return '';
      }
      return `Wichtig: Die Zuständigkeit des Netzbetreibers ${assumption.assertedGridOperatorName} am Standort ${assumption.location} ist noch nicht durch Evidenz belegt (nur Projektannahme mit Risikoflag).`;
    },

    normalizeRecoveryText(text = '') {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/\.{2,}/g, '.')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,.;:!?]){2,}/g, '$1')
        .trim();
    },

    isCompleteSentence(text = '') {
      return /[.!?]$/.test(String(text || '').trim());
    },

    dedupeCompletedStepSummaries(summaries = []) {
      const seen = new Set();
      const result = [];

      for (const summary of summaries) {
        const value = this.normalizeRecoveryText(summary);
        if (!value) continue;
        const key = value
          .toLowerCase()
          .replace(/\s*\(\s*\d+\s*treffer\s*\)\s*$/i, '')
          .trim();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
      }

      return result;
    },

    humanizeCapabilityLabel(label, fallback = 'fachlicher Prüfschritt') {
      const raw = String(label || '').trim();
      if (!raw) {
        return fallback;
      }

      const normalized = raw.toLowerCase();
      const mappings = [
        ['grid_operator_identity_resolution', 'Netzbetreiber-Zuordnung'],
        ['mastr_asset_inventory', 'Anlagenregister-/MaStR-Prüfung'],
        ['vnb_kpi_benchmark_comparison', 'Netzbetreiber-Benchmark-Prüfung'],
        ['interface_placeholder', 'fehlende Schnittstelle oder Evidenzquelle'],
        ['grid-operator-identity-resolution', 'Netzbetreiber-Zuordnung'],
        ['mastr-asset-inventory', 'Anlagenregister-/MaStR-Prüfung'],
        ['vnb-kpi-benchmark-comparison', 'Netzbetreiber-Benchmark-Prüfung'],
      ];

      for (const [needle, replacement] of mappings) {
        if (normalized.includes(needle)) {
          return replacement;
        }
      }

      if (/execute curated capability path/i.test(raw)) {
        return fallback;
      }

      const isTechnicalToken =
        /execute curated capability path/i.test(raw) ||
        /\binterface_placeholder\b/i.test(raw) ||
        /\b(grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison)\b/i.test(
          raw
        ) ||
        /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/i.test(raw);

      const stripped = raw
        .replace(/^execute curated capability path for\s+/i, '')
        .replace(/^execute curated capability path:\s*/i, '')
        .replace(/\binterface_placeholder\b/gi, 'fehlende Schnittstelle oder Evidenzquelle')
        .replace(
          /\b(grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison)\b/gi,
          ''
        )
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!stripped) {
        return fallback;
      }

      if (isTechnicalToken) {
        return fallback;
      }

      return stripped;
    },

    buildRecoveryStopText({ plan = {}, execution = {}, stopPoint = {}, taskTone }) {
      const blockedStepLabel = this.describeBlockedStep(plan, stopPoint);

      if (
        stopPoint.reasonCode === 'MISSING_INPUTS' ||
        execution?.status === 'awaiting-onboarding'
      ) {
        const missingText = this.describeMissingRecoveryInputs(stopPoint);
        const hasFullQuestion = this.isCompleteSentence(missingText);
        const missingSummary = hasFullQuestion ? 'die offene Evidenz' : missingText;
        return taskTone === 'finance-risk'
          ? `Es fehlt noch ${missingSummary}.`
          : `Mir fehlt noch ${missingSummary}.`;
      }

      if (
        stopPoint.status === 'interface-placeholder' ||
        stopPoint.reasonCode === 'UNSUPPORTED_CHAIN'
      ) {
        return taskTone === 'finance-risk'
          ? `Der Stopp liegt an einer fehlenden Schnittstelle oder Evidenzquelle beim Prüfpunkt "${blockedStepLabel}".`
          : `Der Stopp liegt an einer fehlenden Schnittstelle oder Evidenzquelle beim Schritt "${blockedStepLabel}".`;
      }

      if (stopPoint.reasonCode === 'ACTION_FAILED') {
        const detail = stopPoint.message
          ? ` Grund: ${this.normalizeRecoveryText(stopPoint.message)}`
          : '';
        return taskTone === 'finance-risk'
          ? `Der Prüfpunkt "${blockedStepLabel}" konnte fachlich nicht belastbar abgeschlossen werden.${detail}`
          : `Der Schritt "${blockedStepLabel}" konnte fachlich nicht belastbar abgeschlossen werden.${detail}`;
      }

      if (stopPoint.reasonCode) {
        return taskTone === 'finance-risk'
          ? `Der Prüfpunkt "${blockedStepLabel}" ist an einer offenen fachlichen Bedingung hängengeblieben.`
          : `Der Schritt "${blockedStepLabel}" ist an einer offenen fachlichen Bedingung hängengeblieben.`;
      }

      return taskTone === 'finance-risk'
        ? 'Für die Risikoprüfung fehlt noch ein belastbarer Anschlussprüfpunkt.'
        : 'Für die fachliche Bewertung fehlt noch ein belastbarer Anschlussprüfpunkt.';
    },

    detectAssumptionDrivenFollowUp(message = '') {
      const normalized = String(message || '').toLowerCase();

      if (!normalized) {
        return null;
      }

      if (
        /(risk assessment|risikoampel|kreditausschuss|condition precedent|due diligence|due-diligence|risikobewertung|risikoanalyse)/i.test(
          normalized
        )
      ) {
        return 'risk';
      }

      if (
        /(markt|regulator|preisdaten|preis|entso-e|netztransparenz|methodik|methodologie|datenquelle|day-ahead|negativpreis|volatilität|volatilitaet)/i.test(
          normalized
        )
      ) {
        return 'market';
      }

      if (
        /(vorläufigen annahme|vorlaeufigen annahme|arbeite .* weiter|weiterarbeiten|nächste fachliche schritte|naechste fachliche schritte|nächste schritte|naechste schritte|wie weiter|fortfahren|weiter vorgehen)/i.test(
          normalized
        )
      ) {
        return 'continuation';
      }

      return null;
    },

    buildAssumptionContinuationNextText(taskTone = 'general', assumption = null) {
      const assumptionNote = assumption
        ? ' Die Bewertung bleibt bis zur Evidenzprüfung ausdrücklich vorläufig.'
        : '';

      return taskTone === 'finance-risk'
        ? `Ich kann auf Basis der Working Assumption fachlich weiterarbeiten: zunächst offene Evidenzpunkte priorisieren, dann Markt-/Regulatorik-Annahmen dokumentieren und anschließend die Condition-Precedent-Themen für die Due Diligence strukturieren.${assumptionNote}`
        : `Ich kann auf Basis der Working Assumption fachlich weiterarbeiten: als Nächstes die Methodik, offene Evidenzpunkte und benötigten Anschlussunterlagen strukturiert auflisten.${assumptionNote}`;
    },

    mergeAssumptions(existing = [], incoming = []) {
      const merged = [];
      const seen = new Set();

      for (const item of [...(existing || []), ...(incoming || [])]) {
        if (!item || typeof item !== 'object' || !item.type) {
          continue;
        }

        const key = [
          item.type,
          item.location || '',
          item.assertedGridOperatorName || '',
          item.status || '',
        ]
          .join('::')
          .toLowerCase();

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        merged.push(item);
      }

      return merged;
    },

    resolveMethodologyFallbackType({ message, plan = {}, execution = {} }) {
      const routingSignals = [
        message,
        plan?.primaryIntent,
        plan?.routeKey,
        plan?.routeLabel,
        ...(Array.isArray(plan?.secondaryIntents) ? plan.secondaryIntents : []),
        ...(Array.isArray(plan?.requestedDomains) ? plan.requestedDomains : []),
        ...(Array.isArray(plan?.unsupportedDomains) ? plan.unsupportedDomains : []),
        ...(Array.isArray(plan?.steps)
          ? plan.steps.map((step) => `${step?.purpose || ''} ${step?.label || ''}`)
          : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (
        /(market|markt|regulator|preis|pricing|preisdaten|entso-e|netztransparenz|day-ahead|negativpreis|volatil)/i.test(
          routingSignals
        )
      ) {
        return 'market';
      }

      if (
        /(risk assessment|risk|risiko|due diligence|due-diligence|kreditausschuss|kredit|loan|lender|investment committee|komitee|condition precedent)/i.test(
          routingSignals
        )
      ) {
        return 'risk';
      }

      if (this.isFinanceRiskTask(message, plan, execution)) {
        return 'finance-risk-generic';
      }

      return null;
    },

    buildGenericMethodologicalNextText(taskTone = 'finance-risk', assumption = null) {
      const assumptionNote = assumption
        ? ' Die Einordnung bleibt bis zur Evidenzprüfung ausdrücklich vorläufig.'
        : '';

      return taskTone === 'finance-risk'
        ? `Ohne angebundene Fachschnittstelle liefere ich zunächst eine belastbare Methodik: Annahmen offenlegen, Evidenzlücken priorisieren, Sensitivitäten dokumentieren und Entscheidungsvorbehalte sauber trennen.${assumptionNote}`
        : `Ohne angebundene Fachschnittstelle kann ich zunächst Methodik, Evidenzlücken und nächste Prüfschritte strukturiert benennen.${assumptionNote}`;
    },

    buildRecoveryNextText({
      message,
      plan = {},
      execution = {},
      stopPoint = {},
      taskTone,
      assumptions = [],
    }) {
      const locationAssumption = assumptions.find((a) => a.type === 'location_operator_unverified');
      const followUpType = locationAssumption ? this.detectAssumptionDrivenFollowUp(message) : null;

      if (followUpType === 'market') {
        return this.buildMarketMethodologicalNextText(taskTone, locationAssumption);
      }

      if (followUpType === 'risk') {
        return this.buildRiskAssessmentNextText(taskTone, locationAssumption);
      }

      if (followUpType === 'continuation') {
        return this.buildAssumptionContinuationNextText(taskTone, locationAssumption);
      }

      if (
        stopPoint.reasonCode === 'MISSING_INPUTS' ||
        execution?.status === 'awaiting-onboarding'
      ) {
        const questionText = stopPoint?.onboardingQuestion?.questionText;
        if (questionText) {
          return this.isCompleteSentence(questionText)
            ? questionText
            : `Bitte beantworte konkret: ${this.normalizeRecoveryText(questionText)}`;
        }

        const missingText = this.describeMissingRecoveryInputs(stopPoint);
        return taskTone === 'finance-risk'
          ? `Bitte nenne ${missingText}, damit ich die Due-Diligence-Bedingung prüfen kann.`
          : `Bitte nenne ${missingText}, damit ich fortfahren kann.`;
      }

      if (
        stopPoint.status === 'interface-placeholder' ||
        stopPoint.reasonCode === 'UNSUPPORTED_CHAIN'
      ) {
        const fallbackType = this.resolveMethodologyFallbackType({
          message,
          plan,
          execution,
        });

        if (fallbackType === 'market') {
          return this.buildMarketMethodologicalNextText(taskTone, locationAssumption);
        }

        if (fallbackType === 'risk') {
          return this.buildRiskAssessmentNextText(taskTone, locationAssumption);
        }

        if (fallbackType === 'finance-risk-generic') {
          return this.buildGenericMethodologicalNextText(taskTone, locationAssumption);
        }

        const suggestion = this.getRecoveryNextSuggestion(stopPoint, plan);
        return taskTone === 'finance-risk'
          ? `Nächster Schritt: ${suggestion} oder die fehlende Evidenz nachreichen.`
          : `Nächster Schritt: ${suggestion} oder die fehlende Evidenz nachreichen.`;
      }

      if (stopPoint.reasonCode === 'ACTION_FAILED') {
        const failureText = String(stopPoint.message || '').toLowerCase();
        if (/vnblookup|vnb|bdew|netzbetreiber/.test(failureText)) {
          return 'Nächster Schritt: den BDEW-Code nennen oder zuerst eine eindeutige Marktpartner-/Netzbetreiber-Suche durchführen, damit die VNB-Zuordnung belastbar aufgelöst werden kann.';
        }
        return taskTone === 'finance-risk'
          ? 'Nächster Schritt: die offene Evidenz nachreichen oder den Prüfpunkt mit einer verfügbaren Capability neu anstoßen.'
          : 'Nächster Schritt: die offene Evidenz nachreichen oder den Prüfschritt mit einer verfügbaren Capability neu anstoßen.';
      }

      return taskTone === 'finance-risk'
        ? 'Bitte liefere die fehlende Evidenz für die belastbare Risikobewertung.'
        : 'Bitte liefere die fehlenden Angaben für den nächsten Prüfschritt.';
    },

    buildMarketMethodologicalNextText(taskTone = 'general', assumption = null) {
      const assumptionNote = assumption
        ? ` Die Auswertung unter unbestätigter Netzbetreiber-Zuständigkeit bleibt vorläufig.`
        : '';
      return taskTone === 'finance-risk'
        ? `Methodik für Preisdaten: Day-Ahead-Spreads, Negativpreisstunden und Volatilität separat auswerten. Erforderliche Datenquellen: ENTSO-E, Netztransparenz oder Market Snapshot.${assumptionNote}`
        : `Verfügbare Datenquellen: ENTSO-E, Netztransparenz, Market Snapshot. Ohne angebundene Live-Quelle nur Methodologie möglich.${assumptionNote}`;
    },

    buildRiskAssessmentNextText(taskTone = 'finance-risk', assumption = null) {
      const assumptionCondition = assumption
        ? `\n• Condition Precedent: Vor Auszahlung muss Netzbetreiber-/Netzanschlusspunkt-Zuständigkeit durch BKZ, BDEW-Code oder Netzanschlusszusage verifiziert sein.`
        : '';
      return taskTone === 'finance-risk'
        ? `Ich stelle ein vorläufiges Risk Assessment zusammen basierend auf bisheriger Evidenz. Struktur: Projektverständnis, Risikoampel, offene Due-Diligence-Punkte, Kreditausschuss-Empfehlung.${assumptionCondition}`
        : `Risk Assessment mit bisheriger Evidenz (vorläufig).${assumptionCondition}`;
    },

    getRecoveryNextSuggestion(stopPoint = {}, plan = {}) {
      if (stopPoint?.onboardingQuestion?.questionText) {
        return stopPoint.onboardingQuestion.questionText;
      }

      const metadataSuggestions = Array.isArray(stopPoint?.placeholderMetadata?.suggestedNextSteps)
        ? stopPoint.placeholderMetadata.suggestedNextSteps.filter(
            (item) => typeof item === 'string' && item.trim()
          )
        : [];
      if (metadataSuggestions.length > 0) {
        return this.humanizeCapabilityLabel(
          metadataSuggestions[0],
          'die fehlende Evidenz nachreichen'
        );
      }

      const blockedStepLabel = this.describeBlockedStep(plan, stopPoint);
      return `den Prüfpunkt "${blockedStepLabel}" an eine verfügbare Schnittstelle oder Evidenzquelle übergeben`;
    },

    summarizeCompletedSteps(plan = {}, execution = {}) {
      const completedSteps = Array.isArray(execution?.steps)
        ? execution.steps.filter((step) => step && step.status === 'completed')
        : [];

      const summaries = completedSteps.slice(0, 3).map((step) => {
        const plannedStep = Array.isArray(plan?.steps)
          ? plan.steps.find((item) => item.step === step.step || item.action === step.action)
          : null;
        const label = this.humanizeCapabilityLabel(
          plannedStep?.purpose || plannedStep?.label || step.label || step.action,
          this.humanizeActionName(step.action)
        );
        const outcome = this.summarizeStepOutcome(step.result);
        return outcome ? `${label} (${outcome})` : label;
      });

      return this.dedupeCompletedStepSummaries(summaries);
    },

    summarizeStepOutcome(result) {
      if (!result || typeof result !== 'object') {
        return '';
      }

      const hints = [];
      if (typeof result.recommendation === 'string' && result.recommendation.trim()) {
        hints.push(result.recommendation.trim());
      }
      if (typeof result.decision === 'string' && result.decision.trim()) {
        hints.push(result.decision.trim());
      }
      if (typeof result.riskLevel === 'string' && result.riskLevel.trim()) {
        hints.push(`Risiko ${result.riskLevel.trim()}`);
      }
      if (Number.isFinite(result.paybackYears)) {
        hints.push(`Amortisation ${Number(result.paybackYears).toFixed(1)} Jahre`);
      }
      if (Array.isArray(result.findings)) {
        hints.push(`${result.findings.length} Befund${result.findings.length === 1 ? '' : 'e'}`);
      }
      const resultList = Array.isArray(result?.data?.results)
        ? result.data.results
        : Array.isArray(result?.results)
          ? result.results
          : null;
      if (Array.isArray(resultList)) {
        hints.push(resultList.length === 0 ? 'kein Treffer' : `${resultList.length} Treffer`);
      }
      if (typeof result.status === 'string') {
        const status = result.status.trim().toLowerCase();
        if (['eligible', 'ready', 'approved', 'ok', 'warning'].includes(status)) {
          hints.push(`Status ${result.status.trim()}`);
        }
      }

      return hints.slice(0, 2).join(', ');
    },

    describeBlockedStep(plan = {}, stopPoint = {}) {
      const blockedStepNumber = Number(stopPoint?.blockedStep || 0);
      const plannedStep = Array.isArray(plan?.steps)
        ? plan.steps.find(
            (step) => step.step === blockedStepNumber || step.action === stopPoint?.blockedAction
          )
        : null;

      if (plannedStep) {
        return this.humanizeCapabilityLabel(
          plannedStep.purpose || plannedStep.label || plannedStep.action,
          this.humanizeActionName(plannedStep.action)
        );
      }

      const rawBlocked = stopPoint?.placeholderMetadata?.title || stopPoint?.blockedAction;
      return this.humanizeCapabilityLabel(
        rawBlocked,
        blockedStepNumber > 0 ? `Schritt ${blockedStepNumber}` : 'der nächste fachliche Prüfschritt'
      );
    },

    describeMissingRecoveryInputs(stopPoint = {}) {
      const questionText = stopPoint?.onboardingQuestion?.questionText;
      if (questionText) {
        return questionText;
      }

      const missingParams = Array.isArray(stopPoint?.missingParams) ? stopPoint.missingParams : [];
      if (missingParams.length > 0) {
        const labels = missingParams.map((param) => this.humanizeMissingParam(param));
        if (labels.length === 1) {
          return labels[0];
        }
        return `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`;
      }

      return 'die fehlenden Angaben';
    },

    humanizeMissingParam(param) {
      const mapping = {
        taskId: 'die VDMI-Task-ID',
        agentId: 'den verantwortlichen Akteur',
        matrixId: 'die VDMI-Matrix-ID',
        processId: 'die Prozess-ID',
        projectId: 'die Projekt-ID',
        gridOperatorName: 'den Netzbetreiber',
        gridOperatorId: 'die Netzbetreiber-ID',
        gridOperatorBdew: 'den BDEW-Code',
        bdew: 'den BDEW-Code',
        city: 'den Ort',
        vnbName: 'den Netzbetreibernamen',
        query: 'einen belastbaren Suchhinweis (Netzbetreiber, BDEW-Code oder Ort)',
        operatorEvidence: 'den Netzbetreiber oder den BDEW-Code',
        fnavProfile: 'das fNAV-Profil',
        voltageLevel: 'die Spannungsebene',
        ownerContact: 'den Ansprechpartner',
        communityName: 'den Gemeinschaftsnamen',
        communityId: 'die Gemeinschafts-ID',
        generators: 'die Erzeugungsdaten',
        consumers: 'die Verbrauchsdaten',
        dateFrom: 'den Startzeitpunkt',
        dateTo: 'den Endzeitpunkt',
        annualFeeEur: 'den Jahresbetrag',
      };

      if (mapping[param]) {
        return mapping[param];
      }

      const fallback = String(param || 'Angabe')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();

      return fallback ? `den Wert für ${fallback}` : 'die fehlende Angabe';
    },

    humanizeActionName(action) {
      const text = String(action || 'der nächste Schritt')
        .replace(/\./g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'der nächste Schritt';
    },

    isFinanceRiskTask(message, plan = {}, execution = {}) {
      const haystack = [
        message,
        plan?.primaryIntent,
        plan?.routeLabel,
        plan?.routeKey,
        ...(Array.isArray(plan?.steps)
          ? plan.steps.map((step) => `${step.action || ''} ${step.purpose || ''}`)
          : []),
        ...(Array.isArray(execution?.steps)
          ? execution.steps.map((step) => `${step.action || ''} ${step.purpose || ''}`)
          : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return /(kredit|credit|loan|bank|finanz|finance|risk|risiko|due diligence|due-diligence|bewertung|invest|investment|lender|komitee)/i.test(
        haystack
      );
    },

    async getBrokerRecommendation(
      ctx,
      message,
      knownContext = {},
      resolvedParams = {},
      resolvedCapabilities = []
    ) {
      try {
        return await ctx.call(
          'capability-broker.recommend',
          {
            schemaVersion: 'cernion.capabilityRecommendation.v1',
            task: message,
            mode: 'initial',
            knownContext,
            resolvedParams,
            resolvedCapabilities,
          },
          { meta: { ...ctx.meta, $gateway: false } }
        );
      } catch (error) {
        if (isActionUnavailable(error)) {
          return null;
        }
        throw error;
      }
    },

    isEvCo2ChargingRequest(message = '', knownContext = {}, session = null) {
      const historyTexts = [];
      if (session?.l3?.history && Array.isArray(session.l3.history)) {
        // Include last 6 history entries (~3 prior turns) to detect multi-turn EV+CO2 intent
        session.l3.history.slice(-6).forEach((turn) => {
          if (turn?.role === 'user' && turn?.text) {
            historyTexts.push(turn.text);
          }
        });
      }

      const haystack = [
        message,
        knownContext?.message,
        knownContext?.intent,
        knownContext?.domainIntent,
        ...historyTexts,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const hasChargingIntent =
        /\b(?:ev|e-?auto|elektroauto|wallbox|laden|ladezeit|ladung|charging)\b/i.test(haystack);
      const hasCarbonIntent =
        /(?:\b(?:co2|kohlenstoff|emission|emissions|grünstrom|gruenstrom|gsi|strommix|klima)\b|co₂)/i.test(
          haystack
        );

      return hasChargingIntent && hasCarbonIntent;
    },

    // Extracts postal code, city, and other location hints from recent session history turns.
    // Used for multi-turn blueprint receipt selection in consultation mode so that a postal code
    // mentioned in turn N is still available for receipt evaluation in turn N+2.
    extractMultiTurnContextHints(session = null) {
      if (!session?.l3?.history || !Array.isArray(session.l3.history)) {
        return {};
      }
      const hints = {};
      const recentUserTurns = session.l3.history
        .slice(-8)
        .filter((turn) => turn?.role === 'user' && turn?.text);

      for (const turn of recentUserTurns) {
        const text = String(turn.text);
        if (!hints.postalCode) {
          const plzMatch = text.match(/\b(\d{5})\b/);
          if (plzMatch) {
            hints.postalCode = plzMatch[1];
            hints.postleitzahl = plzMatch[1];
            const cityMatch = text.match(
              new RegExp(`\\b${plzMatch[1]}\\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+)`)
            );
            if (cityMatch) {
              hints.city = cityMatch[1];
              hints.location = cityMatch[1];
            }
          }
        }
      }
      return hints;
    },

    buildPreferredReceiptsForTurn(message = '', knownContext = {}, explicitPreferred = [], session = null) {
      const preferred = Array.isArray(explicitPreferred) ? [...explicitPreferred] : [];
      if (
        this.isEvCo2ChargingRequest(message, knownContext, session) &&
        !preferred.includes('ev-charging-co2-optimization-v1')
      ) {
        preferred.unshift('ev-charging-co2-optimization-v1');
      }
      return preferred;
    },

    isHitlApprovalIntent(message = '') {
      const normalized = String(message || '')
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');

      return (
        /\b(?:ja|ok|okay|approve|approved|freigeben|freigabe|genehmigen|genehmigt|bestaetigen|bestaetigt|bestaetogt)\b/.test(
          normalized
        ) || /\bich\s+(?:gebe\s+frei|genehmige|bestaetige)\b/.test(normalized)
      );
    },

    buildGroundedReceiptReply(_message = '', receiptSelection = null, executionResult = null) {
      return buildGroundedReceiptReplyAdapter(_message, receiptSelection, executionResult);
    },

    buildEvidenceGapUserMessage(evidencePlan = {}) {
      const gaps = Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps : [];
      const requiredGaps = gaps.filter((gap) => gap?.required !== false).slice(0, 5);
      const listed = (requiredGaps.length > 0 ? requiredGaps : gaps.slice(0, 5)).map((gap) => {
        const label = gap?.label || gap?.id || gap?.sourceId || 'Evidenz';
        const reason =
          gap?.reason ||
          gap?.missingReason ||
          gap?.severity ||
          'für die belastbare Prüfung erforderlich';
        return `- ${label}: ${reason}.`;
      });

      if (listed.length === 0) {
        return 'Ich kann die Antwort noch nicht belastbar abschließen, weil die erforderliche Evidenz noch nicht vollständig vorliegt. Bitte ergänze die fehlenden Nachweise oder starte die passende Datenabfrage erneut.';
      }

      return [
        'Ich kann die Antwort noch nicht belastbar abschließen, weil folgende Evidenz fehlt:',
        ...listed,
        'Sobald diese Evidenz vorliegt, kann ich die Bewertung ohne Platzhalter fortsetzen.',
      ].join('\n');
    },

    appendGroundingContractToReply(
      reply = '',
      { execution = null, knowledgeScope = [], missingEvidence = [], assumptions = [] } = {}
    ) {
      const baseReply = String(reply || '').trim();
      if (!baseReply || /\bDatengrundlage\s*:/i.test(baseReply)) {
        return baseReply;
      }

      const datapoints = sanitizeScopedDatapoints(knowledgeScope)
        .slice(0, 4)
        .map((point) => {
          const status = point.status ? `, ${point.status}` : '';
          return `${point.key} (${point.scope}/${point.source}${status})`;
        });

      const toolEvidence = (Array.isArray(execution?.steps) ? execution.steps : [])
        .filter((step) => step?.status === 'completed' && step?.action)
        .slice(0, 4)
        .map((step) => step.action);

      const openEvidence = (Array.isArray(missingEvidence) ? missingEvidence : [])
        .map((gap) => gap?.label || gap?.id || gap)
        .filter(Boolean)
        .slice(0, 3);

      const assumptionTexts = (Array.isArray(assumptions) ? assumptions : [])
        .map((item) => {
          if (typeof item === 'string') return item;
          return item?.label || item?.type || item?.value || null;
        })
        .filter(Boolean)
        .slice(0, 3);

      if (
        datapoints.length === 0 &&
        toolEvidence.length === 0 &&
        openEvidence.length === 0 &&
        assumptionTexts.length === 0
      ) {
        return baseReply;
      }

      const lines = ['Datengrundlage:'];
      if (datapoints.length > 0) {
        lines.push(`- Genutzte Datenpunkte: ${datapoints.join('; ')}.`);
      }
      if (toolEvidence.length > 0) {
        lines.push(`- Tool-Evidenz: ${toolEvidence.join('; ')}.`);
      }
      lines.push(
        `- Annahmen: ${assumptionTexts.length > 0 ? `${assumptionTexts.join('; ')}.` : 'keine zusätzlichen Annahmen für die Kernaussage.'}`
      );
      if (openEvidence.length > 0) {
        lines.push(`- Noch offen: ${openEvidence.join('; ')}.`);
      }

      return `${baseReply}\n\n${lines.join('\n')}`;
    },

    buildReceiptExecutionContext({
      message = '',
      knownContext = {},
      resolvedParams = {},
      observations = [],
    } = {}) {
      const baseContext = {
        ...(knownContext && typeof knownContext === 'object' ? knownContext : {}),
        ...(resolvedParams && typeof resolvedParams === 'object' ? resolvedParams : {}),
      };

      const city =
        baseContext.city ||
        baseContext.municipality ||
        baseContext.location ||
        baseContext.promptHints?.city ||
        null;
      const rawBdew = baseContext.bdewCode || baseContext.bdew || baseContext.promptHints?.bdew;
      const bdewCode = isPlausibleBdewCode(rawBdew) ? rawBdew : undefined;
      const vnbName =
        baseContext.vnbName ||
        baseContext.gridOperatorName ||
        baseContext.assertedGridOperatorName ||
        baseContext.promptHints?.vnbName;

      return pruneUndefinedDeep({
        ...baseContext,
        message: String(message || ''),
        city: city,
        municipality: baseContext.municipality || city || undefined,
        bdewCode: bdewCode || undefined,
        bdew: isPlausibleBdewCode(baseContext.bdew) ? baseContext.bdew : bdewCode || undefined,
        vnbName: vnbName || undefined,
        gridOperatorName: baseContext.gridOperatorName || vnbName || undefined,
        observations: Array.isArray(observations) ? observations : [],
      });
    },

    normalizeReceiptExecutionResult(result = {}, { plan = null, message = '' } = {}) {
      const rawSteps = Array.isArray(result?.steps) ? result.steps : [];
      const normalizedSteps = rawSteps.map((step, idx) => ({
        step: Number(step?.step || idx + 1),
        action: step?.action || step?.outcome?.action || 'unknown.action',
        status:
          step?.status === 'error' || step?.status === 'failed'
            ? 'failed'
            : step?.status === 'fallback'
              ? 'completed'
              : step?.status === 'skipped'
                ? 'blocked'
                : 'completed',
        params: step?.params || {},
        result: step?.outcome?.result || step?.result || null,
        error: step?.error || step?.outcome?.error || null,
      }));

      const completedSteps = normalizedSteps.filter((step) => step.status === 'completed').length;
      const failedStep = normalizedSteps.find((step) => step.status === 'failed');
      const blockedStep = normalizedSteps.find((step) => step.status === 'blocked');

      let stopPoint = null;
      if (failedStep) {
        stopPoint = {
          reasonCode: 'ACTION_FAILED',
          message: failedStep.error || 'Runtime receipt execution failed.',
          blockedStep: failedStep.step,
          blockedAction: failedStep.action,
          status: 'action-error',
        };
      } else if (blockedStep) {
        stopPoint = {
          reasonCode: 'MISSING_INPUTS',
          message: 'Runtime receipt execution blocked because required inputs are missing.',
          blockedStep: blockedStep.step,
          blockedAction: blockedStep.action,
          status: 'missing-inputs',
        };
      }

      return {
        status: stopPoint ? 'partial' : 'completed',
        completedSteps,
        steps: normalizedSteps,
        stopPoint,
        message,
        assumptions: [],
        plan,
      };
    },

    async selectRuntimeReceipt(ctx, payload = {}) {
      if (payload.disableReceiptSelection === true) {
        return {
          selected: false,
          receiptId: null,
          mode: 'disabled',
          score: null,
          status: null,
          warnings: [],
          diagnostics: null,
          selectedReceipt: null,
          execution: {
            used: false,
            executor: null,
            fallbackReason: 'disabled_by_request',
          },
        };
      }

      try {
        const result = await ctx.call(
          'agent-receipts.select',
          {
            message: payload.message || '',
            context: payload.context || {},
            input: payload.input || {},
            forceReceipt: payload.forceReceipt,
            preferredReceipts: Array.isArray(payload.preferredReceipts)
              ? payload.preferredReceipts
              : [],
            allowDraftReceipts: payload.allowDraftReceipts === true,
            explainReceiptSelection: payload.explainReceiptSelection === true,
            disableReceiptSelection: false,
            includeEvaluation: true,
          },
          { meta: { ...ctx.meta, $gateway: false } }
        );

        const data =
          result && typeof result === 'object' && result.data && typeof result.data === 'object'
            ? result.data
            : result;

        let selectedReceipt =
          data?.selectedReceipt && typeof data.selectedReceipt === 'object'
            ? data.selectedReceipt
            : null;

        if (
          !selectedReceipt &&
          data?.selected === true &&
          typeof data?.receiptId === 'string' &&
          data.receiptId.trim().length > 0
        ) {
          try {
            const fetched = await ctx.call(
              'agent-receipts.get',
              {
                id: data.receiptId.trim(),
                includeArchived: false,
              },
              { meta: { ...ctx.meta, $gateway: false } }
            );
            const fetchedData =
              fetched &&
              typeof fetched === 'object' &&
              fetched.data &&
              typeof fetched.data === 'object'
                ? fetched.data
                : fetched;
            if (fetchedData && typeof fetchedData === 'object') {
              selectedReceipt = fetchedData;
            }
          } catch (fetchError) {
            this.logger?.warn?.(
              `Runtime receipt selected but not hydrated (${data.receiptId}): ${fetchError.message}`
            );
          }
        }

        return {
          selected: Boolean(data?.selected),
          receiptId: typeof data?.receiptId === 'string' ? data.receiptId : null,
          mode: typeof data?.mode === 'string' ? data.mode : data?.selected ? 'matched' : 'none',
          score: typeof data?.score === 'number' ? data.score : null,
          status: typeof data?.status === 'string' ? data.status : null,
          warnings: Array.isArray(data?.warnings) ? data.warnings : [],
          diagnostics:
            data?.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : null,
          selectedReceipt,
          evaluation:
            data?.evaluation && typeof data.evaluation === 'object'
              ? {
                  executable: data.evaluation.executable === true,
                  matchScore:
                    typeof data.evaluation.matchScore === 'number'
                      ? data.evaluation.matchScore
                      : null,
                  plannedToolCalls: Array.isArray(data.evaluation.plannedToolCalls)
                    ? data.evaluation.plannedToolCalls
                    : [],
                }
              : null,
          execution: {
            used: false,
            executor: null,
            fallbackReason: null,
          },
          knowledgeEvidence:
            data?.evaluation && typeof data.evaluation === 'object'
              ? {
                  status:
                    typeof data.evaluation.knowledgeEvidenceStatus === 'string'
                      ? data.evaluation.knowledgeEvidenceStatus
                      : null,
                  required: data.evaluation.knowledgeEvidenceRequired === true,
                  hits: Array.isArray(data.evaluation.knowledgeEvidence)
                    ? data.evaluation.knowledgeEvidence
                    : [],
                  trace:
                    data.evaluation.knowledgeEvidenceTrace &&
                    typeof data.evaluation.knowledgeEvidenceTrace === 'object'
                      ? data.evaluation.knowledgeEvidenceTrace
                      : { queryCount: 0, queries: [] },
                }
              : null,
        };
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          if (typeof payload.forceReceipt === 'string' && payload.forceReceipt.trim().length > 0) {
            throw new MoleculerClientError(
              'Forced runtime receipt cannot be resolved because agent-receipts service is unavailable.',
              422,
              'RECEIPT_SELECTION_UNAVAILABLE',
              {
                forceReceipt: payload.forceReceipt,
              }
            );
          }

          return {
            selected: false,
            receiptId: null,
            mode: 'unavailable',
            score: null,
            status: null,
            warnings: [],
            diagnostics: null,
            selectedReceipt: null,
            execution: {
              used: false,
              executor: null,
              fallbackReason: 'selection_service_unavailable',
            },
          };
        }
        throw error;
      }
    },

    buildReceiptSelectionMetadata(selection = null, { includeDiagnostics = false } = {}) {
      if (!includeDiagnostics || !selection || typeof selection !== 'object') {
        return null;
      }

      return {
        receiptSelection: pruneUndefinedDeep({
          mode: selection.mode || 'none',
          selected: Boolean(selection.selected),
          receiptId: selection.receiptId || null,
          status: selection.status || null,
          score: typeof selection.score === 'number' ? selection.score : null,
          warnings: Array.isArray(selection.warnings) ? selection.warnings : [],
          diagnostics:
            selection.diagnostics && typeof selection.diagnostics === 'object'
              ? selection.diagnostics
              : null,
          execution:
            selection.execution && typeof selection.execution === 'object'
              ? {
                  used: selection.execution.used === true,
                  executor: selection.execution.executor || null,
                  fallbackReason: selection.execution.fallbackReason || null,
                  plannedToolCalls: Array.isArray(selection.execution.plannedToolCalls)
                    ? selection.execution.plannedToolCalls
                    : [],
                  executedToolCalls: Array.isArray(selection.execution.executedToolCalls)
                    ? selection.execution.executedToolCalls
                    : [],
                }
              : null,
          knowledgeEvidence:
            selection.knowledgeEvidence && typeof selection.knowledgeEvidence === 'object'
              ? {
                  status: selection.knowledgeEvidence.status || null,
                  required: selection.knowledgeEvidence.required === true,
                  hitCount: Array.isArray(selection.knowledgeEvidence.hits)
                    ? selection.knowledgeEvidence.hits.length
                    : 0,
                }
              : null,
        }),
      };
    },

    attachKnowledgeHintsToKnownContext(knownContext = {}, knowledgeContext = null) {
      const enriched = { ...(knownContext || {}) };
      if (!knowledgeContext) {
        return enriched;
      }

      enriched._knowledgeHints = {
        domainHint: knowledgeContext.domainHint || null,
        regulatoryFrame: knowledgeContext.regulatoryFrame || null,
        synthesisStyle: knowledgeContext.synthesisStyle || null,
      };
      return enriched;
    },

    buildQualitySummary({ evidencePlan = null, execution = null, consultation = null } = {}) {
      const confidence =
        evidencePlan && typeof evidencePlan.confidence === 'number'
          ? evidencePlan.confidence
          : null;
      const gapCount = Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps.length : 0;
      const consultationFactCount = Array.isArray(consultation?.factsUsed)
        ? consultation.factsUsed.length
        : 0;

      const groundednessScore =
        confidence !== null
          ? Number(Math.max(0, Math.min(1, confidence)).toFixed(2))
          : consultationFactCount > 0
            ? 0.6
            : 0.3;

      const uncertaintyReasons = [];
      if (gapCount > 0) {
        uncertaintyReasons.push('missing_evidence');
      }
      if (execution?.status === 'partial') {
        uncertaintyReasons.push('partial_execution');
      }
      if (consultation && consultationFactCount === 0) {
        uncertaintyReasons.push('low_consultation_evidence');
      }

      const uncertaintyScore = Number(
        Math.max(0, Math.min(1, 1 - groundednessScore + (gapCount > 0 ? 0.15 : 0))).toFixed(2)
      );

      return {
        groundedness: {
          score: groundednessScore,
          basis: confidence !== null ? 'evidence_plan' : 'consultation_facts',
          confidence: confidence,
        },
        uncertainty: {
          score: uncertaintyScore,
          reasons: uncertaintyReasons,
          requiresHITL: uncertaintyReasons.includes('missing_evidence') || uncertaintyScore >= 0.6,
        },
      };
    },

    getHandoffPersonaIdFromWorkflowAuditTrail(item = null) {
      const trail = Array.isArray(item?.workflowAuditTrail) ? item.workflowAuditTrail : [];
      if (trail.length === 0) {
        return null;
      }
      for (let i = trail.length - 1; i >= 0; i -= 1) {
        const entry = trail[i];
        if (!entry || entry.action !== 'workflow_completed') {
          continue;
        }
        const handoffPersonaId =
          typeof entry.handoffPersonaId === 'string' ? entry.handoffPersonaId.trim() : '';
        if (handoffPersonaId) {
          return handoffPersonaId;
        }
      }
      return null;
    },

    async getPersonaHandoffSnapshotContext(ctx, hitlItemId) {
      const normalizedHitlItemId =
        typeof hitlItemId === 'string' && hitlItemId.trim() ? hitlItemId.trim() : null;
      if (!normalizedHitlItemId) {
        return {
          workflowCompletionState: null,
          handoffPersonaId: null,
        };
      }

      const item = await this.getHitlItem(ctx, normalizedHitlItemId);
      if (!item) {
        return {
          workflowCompletionState: null,
          handoffPersonaId: null,
        };
      }

      const workflowCompletionStateRaw =
        typeof item.workflowCompletionState === 'string' ? item.workflowCompletionState.trim() : '';
      const workflowCompletionState = workflowCompletionStateRaw || null;

      const explicitHandoffPersonaId =
        typeof item.handoffPersonaId === 'string' ? item.handoffPersonaId.trim() : '';
      const handoffPersonaId =
        explicitHandoffPersonaId || this.getHandoffPersonaIdFromWorkflowAuditTrail(item) || null;

      return {
        workflowCompletionState,
        handoffPersonaId,
      };
    },

    /**
     * v0.56.2 — Resolve persona for agentTrace. Best-effort, never throws.
     * Returns { resolved: true, ...whitelisted fields } or { resolved: false, reason }.
     */
    async resolvePersonaForTrace(ctx, snapshot) {
      const { tenantId } = snapshot;
      if (!tenantId) {
        return { resolved: false, reason: 'no_tenant' };
      }
      try {
        const result = await ctx.call('agent-persona.resolvePersona', snapshot, {
          meta: { ...ctx.meta, $gateway: false },
          timeout: 1500,
        });
        if (result?.success && result?.resolvedPersona) {
          const handoffApplied = result.resolvedPersona.resolutionMode === 'handoff';
          return {
            resolved: true,
            ...result.resolvedPersona,
            auditEventId:
              typeof result.auditEventId === 'string' && result.auditEventId.trim()
                ? result.auditEventId.trim()
                : null,
            handoffApplied,
            appliedHandoffPersonaId:
              handoffApplied && typeof result.resolvedPersona.personaId === 'string'
                ? result.resolvedPersona.personaId
                : null,
          };
        }
        return { resolved: false, reason: 'no_match' };
      } catch (err) {
        const isUnavailable =
          err?.type === 'SERVICE_NOT_FOUND' ||
          err?.type === 'SERVICE_NOT_AVAILABLE' ||
          err?.code === 'SERVICE_NOT_FOUND';
        const isTimeout = err?.type === 'REQUEST_TIMEOUT' || /timeout/i.test(err?.message || '');
        if (isTimeout) return { resolved: false, reason: 'timeout' };
        if (isUnavailable) return { resolved: false, reason: 'service_unavailable' };
        return { resolved: false, reason: 'error' };
      }
    },

    resolveBootstrapContext({ session = {}, knownContext = {} } = {}) {
      const existingRaw =
        session?.l3?.bootstrapContext && typeof session.l3.bootstrapContext === 'object'
          ? session.l3.bootstrapContext
          : null;
      const existing = sanitizeBootstrapContext(existingRaw);

      // Extract explicit organizationType from knownContext (root level or nested bootstrapContext)
      const explicitRootOrganizationType =
        typeof knownContext?.organizationType === 'string' ? knownContext.organizationType : null;
      const explicitBootstrap =
        knownContext?.bootstrapContext && typeof knownContext.bootstrapContext === 'object'
          ? knownContext.bootstrapContext
          : null;
      const explicitOrganizationType =
        typeof explicitBootstrap?.organizationType === 'string'
          ? explicitBootstrap.organizationType
          : explicitRootOrganizationType;

      const candidateForOrgType = sanitizeBootstrapContext({
        status: 'unknown',
        organizationType: explicitOrganizationType,
        source: 'knownContext',
        updatedAt: new Date().toISOString(),
      });
      const hasExplicitOrganizationType = candidateForOrgType.organizationType !== 'unknown';

      if (hasExplicitOrganizationType) {
        // established ONLY if explicitly set to 'established' in knownContext.bootstrapContext.status
        // and it passes sanitization — never derived from organizationType alone
        const rawExplicitStatus = String(explicitBootstrap?.status || '')
          .trim()
          .toLowerCase();
        const status = rawExplicitStatus === 'established' ? 'established' : 'partial';

        return sanitizeBootstrapContext({
          status,
          organizationType: candidateForOrgType.organizationType,
          source: 'knownContext',
          updatedAt: new Date().toISOString(),
        });
      }

      // No explicit organizationType: carry forward existing sanitized context
      return sanitizeBootstrapContext({
        status: existing.status,
        organizationType: existing.organizationType,
        source: existing.source || 'default',
        updatedAt: new Date().toISOString(),
      });
    },

    buildBootstrapTraceContext(bootstrapContext = null) {
      return sanitizeBootstrapContext(bootstrapContext);
    },

    emitWorkOutLoudSafe(ctx, payload) {
      if (!payload) {
        return null;
      }

      try {
        this.broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);
        return payload;
      } catch (error) {
        this.logger?.warn(
          `personal-agent.work-out-loud emit failed for tenantId=${payload?.tenantId || 'n/a'}: ${error.message}`
        );
        return null;
      }
    },

    emitBootstrapWorkOutLoudIfChanged(
      ctx,
      {
        previousBootstrapContext = null,
        nextBootstrapContext = null,
        contextMutationMode = 'append',
      } = {}
    ) {
      const before = sanitizeBootstrapContext(previousBootstrapContext);
      const after = sanitizeBootstrapContext(nextBootstrapContext);

      if (!after?.organizationType || after.organizationType === 'unknown') {
        return null;
      }

      const sameOrganizationType = before?.organizationType === after.organizationType;
      const sameStatus = before?.status === after.status;
      if (sameOrganizationType && sameStatus) {
        return null;
      }

      const payload = buildContextFieldWorkOutLoudPayload({
        tenantId: getTenantId(ctx),
        userId: String(ctx.meta?.authUser?.userId || 'anonymous'),
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.BOOTSTRAP_CONTEXT_UPDATED,
        contextField: 'organizationType',
        rawValue: after.organizationType,
        sourceKind: 'bootstrap_context',
        scope: 'user',
        updateReason: contextMutationMode === 'replace' ? 'context_replace' : 'context_append',
        confidence: after.status === 'established' ? 1 : 0.9,
      });

      return this.emitWorkOutLoudSafe(ctx, payload);
    },

    emitScopedKnowledgeWorkOutLoud(
      ctx,
      {
        previousSessionDataPoints = [],
        previousUserDataPoints = [],
        nextSessionDataPoints = [],
        nextUserDataPoints = [],
        knownContext = {},
      } = {}
    ) {
      const previous = new Set(
        [...previousSessionDataPoints, ...previousUserDataPoints].map(
          (point) => `${point.scope}|${point.key}|${point.status}|${point.source}`
        )
      );
      const next = [...nextSessionDataPoints, ...nextUserDataPoints];

      for (const point of next) {
        const diffKey = `${point.scope}|${point.key}|${point.status}|${point.source}`;
        if (previous.has(diffKey)) {
          continue;
        }

        const payload = buildContextFieldWorkOutLoudPayload({
          tenantId: getTenantId(ctx),
          userId: String(ctx.meta?.authUser?.userId || 'anonymous'),
          signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
          contextField: point.key,
          rawValue: knownContext?.[point.key],
          sourceKind: point.source === 'knownContext' ? 'known_context' : 'scoped_knowledge',
          scope: point.scope,
          updateReason: 'known_context_merge',
          confidence: 0.8,
        });

        this.emitWorkOutLoudSafe(ctx, payload);
      }

      return null;
    },

    emitOnboardingWorkOutLoud(ctx, { answer = null, hydratedContext = {} } = {}) {
      if (!answer?.paramKey) {
        return null;
      }

      const payload = buildContextFieldWorkOutLoudPayload({
        tenantId: getTenantId(ctx),
        userId: String(ctx.meta?.authUser?.userId || 'anonymous'),
        signalType: WORK_OUT_LOUD_SIGNAL_TYPES.ONBOARDING_FACT_LEARNED,
        contextField: answer.paramKey,
        rawValue: hydratedContext?.[answer.paramKey],
        sourceKind: 'onboarding_answer',
        scope: 'user',
        updateReason: 'onboarding_answer',
        confidence: 0.85,
      });

      return this.emitWorkOutLoudSafe(ctx, payload);
    },

    resolveScopedKnowledgeState({ session = {}, knownContext = {} } = {}) {
      const now = new Date().toISOString();
      const existingSession = sanitizeScopedDatapoints(session?.l3?.knowledgeScopeDataPoints || []);
      const existingUser = sanitizeScopedDatapoints(
        session?.l2?.userProfile?.knowledgeScopeDataPoints || []
      );

      const KNOWN_CONTEXT_ALLOWLIST = {
        organizationType: 'user',
        responsibleRole: 'role',
        roleId: 'role',
        gridOperatorBdew: 'tenant_candidate',
        gridOperatorId: 'tenant_candidate',
        gridOperatorName: 'tenant_candidate',
        bdew: 'tenant_candidate',
        vnbName: 'tenant_candidate',
        postalCode: 'session',
        city: 'session',
        voltageLevel: 'session',
      };

      const derivedFromKnownContext = Object.entries(KNOWN_CONTEXT_ALLOWLIST).reduce(
        (acc, [key, scope]) => {
          const value = (knownContext || {})[key];
          if (value === undefined || value === null) {
            return acc;
          }
          const isScalar =
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
          if (!isScalar) {
            return acc;
          }
          acc.push({
            key,
            scope,
            source: 'knownContext',
            status: 'observed',
            updatedAt: now,
          });
          return acc;
        },
        []
      );

      const explicitRaw = Array.isArray(knownContext?.knowledgeScopeDataPoints)
        ? knownContext.knowledgeScopeDataPoints
        : [];
      const explicitNormalized = sanitizeScopedDatapoints(
        explicitRaw.map((point) => ({
          key: point?.key,
          scope: point?.scope,
          source: point?.source || 'knownContext',
          status: point?.status,
          updatedAt: point?.updatedAt || now,
        }))
      );

      const merged = sanitizeScopedDatapoints([
        ...existingSession,
        ...existingUser,
        ...derivedFromKnownContext,
        ...explicitNormalized,
      ]);

      return {
        sessionDataPoints: merged.filter(
          (point) => point.scope === 'session' || point.scope === 'tenant_candidate'
        ),
        userDataPoints: merged.filter((point) => point.scope === 'user' || point.scope === 'role'),
      };
    },

    buildKnowledgeScopeTraceSummary(knowledgeScope = []) {
      const sanitized = sanitizeScopedDatapoints(knowledgeScope);
      const byScope = {};
      const bySource = {};

      for (const point of sanitized) {
        byScope[point.scope] = (byScope[point.scope] || 0) + 1;
        bySource[point.source] = (bySource[point.source] || 0) + 1;
      }

      return {
        total: sanitized.length,
        byScope,
        bySource,
      };
    },

    buildAgentTrace({
      routing = null,
      plan = null,
      execution = null,
      evidencePlan = null,
      consultation = null,
      responseStrategy = null,
      stateMachine = null,
      executionStateGraph = null,
      turnGraph = null,
      routingDecision = null,
      personaResolution = null,
      bootstrapContext = null,
      knowledgeScope = null,
      workLog = null, // v0.57.3
      reflection = null, // v0.57.5 #158
      locationResolution = null, // v0.60: location resolution trace
      policy = null,
    } = {}) {
      const toolAttempts = Array.isArray(consultation?.attemptsSummary)
        ? consultation.attemptsSummary.map((attempt) => ({
            tool: attempt.tool,
            success: attempt.success,
            attempts: attempt.attempts,
            inputType: attempt.inputType,
          }))
        : [];

      return {
        traceId: `trace_${Date.now()}`,
        planning: {
          source: routing?.source || null,
          primaryIntent: routing?.primaryIntent || null,
          routeKey: routing?.routeKey || null,
          routeLabel: routing?.routeLabel || null,
          planStatus: plan?.status || null,
          plannedSteps: Array.isArray(plan?.steps) ? plan.steps.length : 0,
          warnings: Array.isArray(routing?.warnings) ? routing.warnings : [],
        },
        execution: {
          status: execution?.status || null,
          completedSteps: execution?.completedSteps || 0,
          stopReason: execution?.stopPoint?.reasonCode || null,
          hitlItemId: execution?.stopPoint?.hitlItemId || null,
          criticalStepBlocked: execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL',
          meta: execution?.meta || null,
        },
        routingDecision: routingDecision
          ? {
              target: routingDecision.target || null,
              label: routingDecision.label || null,
              confidence:
                typeof routingDecision.confidence === 'number' ? routingDecision.confidence : null,
              determinism: routingDecision.determinism || null,
              gapReason: routingDecision?.gap?.reason || null,
            }
          : null,
        responseStrategy: responseStrategy
          ? {
              audienceType: responseStrategy.audience || null,
              audience: responseStrategy.audience || null,
              audienceConfidence:
                typeof responseStrategy.audienceConfidence === 'number'
                  ? responseStrategy.audienceConfidence
                  : null,
              epistemicState: responseStrategy.epistemicState || null,
              abstractionLevel: responseStrategy.abstractionLevel || null,
              nextMove: responseStrategy.nextMove || null,
              nextDialogueMove: responseStrategy.nextMove || null,
              decisionRole: responseStrategy.decisionRole || null,
              confidence:
                typeof responseStrategy.confidence === 'number'
                  ? responseStrategy.confidence
                  : null,
              workingAssumptions: Array.isArray(responseStrategy.assumptions)
                ? responseStrategy.assumptions
                : [],
              userFacingQuestionStyle: responseStrategy.userFacingQuestionStyle || null,
              shouldHideInternalSchema: Boolean(responseStrategy.shouldHideInternalSchema),
              assumptionCount: Array.isArray(responseStrategy.assumptions)
                ? responseStrategy.assumptions.length
                : 0,
            }
          : null,
        evidence: {
          source: evidencePlan?.source || null,
          registryKey: evidencePlan?.registryKey || null,
          confidence: typeof evidencePlan?.confidence === 'number' ? evidencePlan.confidence : null,
          gapIds: Array.isArray(evidencePlan?.gaps) ? evidencePlan.gaps.map((gap) => gap.id) : [],
        },
        stateMachine: summarizeStateMachine(stateMachine),
        executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
        turnGraph: summarizeTurnGraph(turnGraph),
        consultationDebug: Array.isArray(consultation?.debugTrace)
          ? consultation.debugTrace
          : undefined,
        degradation:
          consultation?.degradation && typeof consultation.degradation === 'object'
            ? consultation.degradation
            : undefined,
        toolAttempts,
        personaResolution, // v0.56.2
        bootstrapContext: this.buildBootstrapTraceContext(bootstrapContext),
        knowledgeScope: this.buildKnowledgeScopeTraceSummary(knowledgeScope || []),
        workLog: Array.isArray(workLog) ? workLog : [], // v0.57.3
        reflection: reflection && typeof reflection === 'object' ? reflection : undefined, // v0.57.5 #158
        locationResolution: // v0.60: location extraction trace for DevOps/OSM/MaStR consumers
          locationResolution && typeof locationResolution === 'object'
            ? locationResolution
            : undefined,
        policy: policy && typeof policy === 'object' ? policy : null,
      };
    },

    async queryKnowledgeOrientation(ctx, { message, activeDomains = [] } = {}) {
      return queryKnowledgeOrientationAdapter(ctx, {
        message,
        activeDomains,
      });
    },

    normalizeRoutingContext(routingContext) {
      if (!routingContext || typeof routingContext !== 'object' || Array.isArray(routingContext)) {
        return null;
      }
      return { ...routingContext };
    },

    deriveCriticalStepRoutingMetadata({ plan = {}, plannedStep = {}, knownContext = {} } = {}) {
      const stepResolverRoles = Array.isArray(plannedStep?.requiredResolverRoles)
        ? plannedStep.requiredResolverRoles
        : [];
      const planResolverRoles = Array.isArray(plan?.requiredResolverRoles)
        ? plan.requiredResolverRoles
        : [];
      const contextResolverRoles = Array.isArray(knownContext?.requiredResolverRoles)
        ? knownContext.requiredResolverRoles
        : [];

      return {
        responsibleRole:
          plannedStep?.responsibleRole ||
          plannedStep?.ownerRole ||
          plan?.responsibleRole ||
          knownContext?.responsibleRole ||
          null,
        requiredResolverRoles:
          stepResolverRoles.length > 0
            ? stepResolverRoles
            : planResolverRoles.length > 0
              ? planResolverRoles
              : contextResolverRoles,
        personaId: plannedStep?.personaId || plan?.personaId || knownContext?.personaId || null,
        routingContext:
          this.normalizeRoutingContext(plannedStep?.routingContext) ||
          this.normalizeRoutingContext(plan?.routingContext) ||
          this.normalizeRoutingContext(knownContext?.routingContext) ||
          null,
      };
    },

    updateCriticalStepCheckpointStatus(session = {}, hitlItemId, status) {
      const normalizedStatus = normalizeHitlStatus(status);
      if (!hitlItemId || !normalizedStatus) {
        return;
      }

      const store = this.ensureCriticalStepCheckpointStore(session);
      for (const [checkpointKey, checkpoint] of Object.entries(store)) {
        if (!checkpoint || checkpoint.hitlItemId !== hitlItemId) {
          continue;
        }

        store[checkpointKey] = {
          ...checkpoint,
          status: normalizedStatus,
          updatedAt: new Date().toISOString(),
          ...(normalizedStatus === 'approved' ? { approvedAt: new Date().toISOString() } : {}),
        };
      }
    },

    findSessionPendingHitlReference(session = {}, knownContext = {}) {
      const sessionStopPoint =
        session?.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
          ? session.l3.stopPoint
          : null;
      const stateMachineState = String(session?.l3?.stateMachine?.currentState || '').trim();

      const knownContextHitlItemId =
        knownContext?.hitlItemId ||
        knownContext?.hitl?.itemId ||
        knownContext?.hitlItem?.id ||
        null;

      const stopPointHitlItemId =
        sessionStopPoint?.hitlItemId ||
        sessionStopPoint?.hitlItem?.id ||
        sessionStopPoint?.onboardingQuestion?.hitlItem?.id ||
        null;

      const stopPointIndicatesMandatoryHitl =
        sessionStopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL' && Boolean(stopPointHitlItemId);
      const stateIndicatesHitlBlocked =
        stateMachineState === PERSONAL_AGENT_STATES.HITL_BLOCKED ||
        stateMachineState === 'hitl_blocked';

      const checkpointContext = this.findCriticalStepCheckpointContext(session, {
        hitlItemId: knownContextHitlItemId || stopPointHitlItemId || null,
        blockedAction: sessionStopPoint?.blockedAction || null,
        blockedStep: sessionStopPoint?.blockedStep || null,
      });
      const checkpointHitlItemId = checkpointContext?.hitlItemId || null;

      const hitlItemId =
        knownContextHitlItemId || stopPointHitlItemId || checkpointHitlItemId || null;

      const shouldGateBySession =
        Boolean(hitlItemId) &&
        (stopPointIndicatesMandatoryHitl ||
          stateIndicatesHitlBlocked ||
          Boolean(checkpointContext));

      return {
        shouldGateBySession,
        hitlItemId,
        sessionStopPoint,
        checkpointContext,
        stateMachineState,
      };
    },

    buildHitlTerminalMessage(status, blockedAction = null) {
      const suffix = blockedAction ? ` (${blockedAction})` : '';
      if (['rejected', 'declined', 'cancelled'].includes(status)) {
        return `Die erforderliche HITL-Freigabe${suffix} wurde abgelehnt oder widerrufen. Der blockierte Schritt wird nicht ausgeführt.`;
      }
      if (status === 'expired') {
        return `Die erforderliche HITL-Freigabe${suffix} ist abgelaufen. Bitte starten Sie den Vorgang neu, falls der Schritt erneut ausgeführt werden soll.`;
      }
      if (status === 'resolved') {
        return `Die HITL-Freigabe${suffix} ist bereits abgeschlossen. Es liegt kein offener Freigabe-Blocker mehr vor.`;
      }
      return `Die HITL-Freigabe${suffix} befindet sich nicht mehr in einem ausführbaren Zustand.`;
    },

    async resolveSessionHitlResumeGate(
      ctx,
      { session = {}, knownContext = {}, message = '' } = {}
    ) {
      const hitlRef = this.findSessionPendingHitlReference(session, knownContext);

      if (!hitlRef?.shouldGateBySession || !hitlRef?.hitlItemId) {
        return { mode: 'none' };
      }

      const hitlItem = await this.getHitlItem(ctx, hitlRef.hitlItemId);
      const resolvedStatus = normalizeHitlStatus(
        hitlItem?.status ||
          hitlRef?.sessionStopPoint?.hitlItem?.status ||
          hitlRef?.sessionStopPoint?.onboardingQuestion?.hitlItem?.status ||
          hitlRef?.checkpointContext?.status ||
          'pending'
      );

      this.updateCriticalStepCheckpointStatus(
        session,
        hitlRef.hitlItemId,
        resolvedStatus || 'pending'
      );

      if (isHitlApprovedStatus(resolvedStatus)) {
        const savedStopPoint =
          session.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
            ? { ...session.l3.stopPoint }
            : null;
        const resumePlanState = this.resolveCriticalStepResumePlan(session, hitlRef);
        session.l3.stopPoint = null;

        if (!resumePlanState.planSnapshot?.steps?.length) {
          const diagnosticMessage =
            'Die HITL-Freigabe wurde bestätigt, aber der gespeicherte Resume-Plan konnte nicht wiederhergestellt werden. Bitte den Vorgang aus dem ursprünglichen Schritt neu starten.';
          const diagnosticStopPoint = this.buildStopPoint({
            reasonCode: 'approved_hitl_resume_missing_plan',
            message: diagnosticMessage,
            blockedStep:
              Number(savedStopPoint?.blockedStep || hitlRef?.checkpointContext?.step || 1) || 1,
            status: 'failed',
            placeholder: {
              blockedAction:
                savedStopPoint?.blockedAction || hitlRef?.checkpointContext?.action || null,
              hitlItem: hitlItem
                ? this.toPublicStopPointHitlItem(hitlItem)
                : hitlRef.hitlItemId
                  ? { id: hitlRef.hitlItemId, status: resolvedStatus || 'approved' }
                  : null,
              responsibleRole:
                savedStopPoint?.responsibleRole ||
                hitlRef?.checkpointContext?.responsibleRole ||
                null,
              requiredResolverRoles: Array.isArray(savedStopPoint?.requiredResolverRoles)
                ? savedStopPoint.requiredResolverRoles
                : Array.isArray(hitlRef?.checkpointContext?.requiredResolverRoles)
                  ? hitlRef.checkpointContext.requiredResolverRoles
                  : [],
              personaId: savedStopPoint?.personaId || hitlRef?.checkpointContext?.personaId || null,
              personaName:
                savedStopPoint?.personaName || hitlRef?.checkpointContext?.personaName || null,
              personaType:
                savedStopPoint?.personaType || hitlRef?.checkpointContext?.personaType || null,
              personaResolution:
                savedStopPoint?.personaResolution ||
                hitlRef?.checkpointContext?.personaResolution ||
                null,
              routingContext:
                this.normalizeRoutingContext(savedStopPoint?.routingContext) ||
                this.normalizeRoutingContext(hitlRef?.checkpointContext?.routingContext) ||
                null,
            },
          });
          return {
            mode: 'approved-missing-plan',
            hitlItemId: hitlRef.hitlItemId,
            hitlItem,
            status: resolvedStatus,
            savedStopPoint,
            checkpointContext: resumePlanState.checkpointContext,
            planStackFrame: resumePlanState.planStackFrame,
            planSnapshot: null,
            stopPoint: diagnosticStopPoint,
            reply: diagnosticMessage,
          };
        }

        if (!session.l3 || typeof session.l3 !== 'object') {
          session.l3 = {};
        }
        session.l3._approvedHitlResume = resumePlanState.planSnapshot;
        return {
          mode: 'approved',
          hitlItemId: hitlRef.hitlItemId,
          hitlItem,
          status: resolvedStatus,
          savedStopPoint,
          checkpointContext: resumePlanState.checkpointContext,
          planStackFrame: resumePlanState.planStackFrame,
          planSnapshot: resumePlanState.planSnapshot,
        };
      }

      const baseStopPoint =
        hitlRef?.sessionStopPoint && typeof hitlRef.sessionStopPoint === 'object'
          ? hitlRef.sessionStopPoint
          : {};
      const basePlaceholder =
        baseStopPoint?.placeholder && typeof baseStopPoint.placeholder === 'object'
          ? baseStopPoint.placeholder
          : {};
      const publicHitlItem =
        this.toPublicStopPointHitlItem(hitlItem) ||
        this.toPublicStopPointHitlItem(baseStopPoint?.hitlItem) ||
        (hitlRef.hitlItemId
          ? {
              id: hitlRef.hitlItemId,
              status: resolvedStatus || 'pending',
              responsibleRole:
                baseStopPoint?.responsibleRole || basePlaceholder?.responsibleRole || null,
              requiredResolverRoles: Array.isArray(baseStopPoint?.requiredResolverRoles)
                ? baseStopPoint.requiredResolverRoles
                : Array.isArray(basePlaceholder?.requiredResolverRoles)
                  ? basePlaceholder.requiredResolverRoles
                  : [],
              personaId: baseStopPoint?.personaId || basePlaceholder?.personaId || null,
              personaName: baseStopPoint?.personaName || basePlaceholder?.personaName || null,
              personaType: baseStopPoint?.personaType || basePlaceholder?.personaType || null,
              personaResolution:
                baseStopPoint?.personaResolution || basePlaceholder?.personaResolution || null,
              routingContext:
                this.normalizeRoutingContext(baseStopPoint?.routingContext) ||
                this.normalizeRoutingContext(basePlaceholder?.routingContext) ||
                null,
            }
          : null);

      const blockedAction =
        baseStopPoint?.blockedAction ||
        basePlaceholder?.blockedAction ||
        hitlRef?.checkpointContext?.action ||
        null;
      const blockedStep =
        Number(
          baseStopPoint?.blockedStep ||
            basePlaceholder?.blockedStep ||
            hitlRef?.checkpointContext?.step ||
            1
        ) || 1;

      const placeholder = {
        ...basePlaceholder,
        blockedAction,
        missingParams: [],
        responsibleRole:
          baseStopPoint?.responsibleRole ||
          basePlaceholder?.responsibleRole ||
          publicHitlItem?.responsibleRole ||
          null,
        requiredResolverRoles: Array.isArray(baseStopPoint?.requiredResolverRoles)
          ? baseStopPoint.requiredResolverRoles
          : Array.isArray(basePlaceholder?.requiredResolverRoles)
            ? basePlaceholder.requiredResolverRoles
            : Array.isArray(publicHitlItem?.requiredResolverRoles)
              ? publicHitlItem.requiredResolverRoles
              : [],
        personaId:
          baseStopPoint?.personaId ||
          basePlaceholder?.personaId ||
          publicHitlItem?.personaId ||
          null,
        personaName:
          baseStopPoint?.personaName ||
          basePlaceholder?.personaName ||
          publicHitlItem?.personaName ||
          null,
        personaType:
          baseStopPoint?.personaType ||
          basePlaceholder?.personaType ||
          publicHitlItem?.personaType ||
          null,
        personaResolution:
          baseStopPoint?.personaResolution ||
          basePlaceholder?.personaResolution ||
          publicHitlItem?.personaResolution ||
          null,
        routingContext:
          this.normalizeRoutingContext(baseStopPoint?.routingContext) ||
          this.normalizeRoutingContext(basePlaceholder?.routingContext) ||
          this.normalizeRoutingContext(publicHitlItem?.routingContext) ||
          null,
        hitlItem: publicHitlItem,
      };

      if (isHitlTerminalStatus(resolvedStatus)) {
        const terminalMessage = this.buildHitlTerminalMessage(resolvedStatus, blockedAction);
        const terminalStopPoint = this.buildStopPoint({
          reasonCode: 'HITL_TERMINAL_DECISION',
          message: terminalMessage,
          blockedStep,
          status: 'hitl-terminal',
          placeholder,
        });
        session.l3.stopPoint = terminalStopPoint;
        return {
          mode: 'terminal',
          hitlItemId: hitlRef.hitlItemId,
          status: resolvedStatus,
          stopPoint: terminalStopPoint,
          reply: terminalMessage,
        };
      }

      const blockedStopPoint = this.buildStopPoint({
        reasonCode: 'MANDATORY_HITL_APPROVAL',
        message:
          String(baseStopPoint?.message || '').trim() ||
          `Kritischer Prüfschritt ${blockedStep}${blockedAction ? ` (${blockedAction})` : ''} erfordert vor Ausführung eine verpflichtende HITL-Freigabe.`,
        blockedStep,
        status: 'hitl-required',
        placeholder,
      });

      const onboardingQuestion = this.buildHitlOnboardingQuestion(
        blockedStopPoint,
        baseStopPoint?.onboardingQuestion?.planSnapshot || null
      );
      const stopPoint = {
        ...blockedStopPoint,
        onboardingQuestion,
        message: onboardingQuestion.message,
        hitlItemId: onboardingQuestion?.hitlItem?.id || blockedStopPoint?.hitlItemId || null,
      };

      session.l3.stopPoint = stopPoint;

      const explicitApprovalIntent = this.isHitlApprovalIntent(message);

      if (explicitApprovalIntent) {
        try {
          await ctx.call(
            'hitl.approve',
            {
              id: hitlRef.hitlItemId,
              comment: 'Approved from Personal Agent conversation turn.',
            },
            { meta: { ...ctx.meta, $gateway: false } }
          );
          this.updateCriticalStepCheckpointStatus(session, hitlRef.hitlItemId, 'approved');
          return this.resolveSessionHitlResumeGate(ctx, {
            session,
            knownContext: { ...(knownContext || {}), hitlItemId: hitlRef.hitlItemId },
            message: '',
          });
        } catch (error) {
          this.logger?.warn?.(`HITL approval intent could not be applied: ${error.message}`);
        }
      }

      const replyBase = this.buildHitlApprovalMarkdown(onboardingQuestion);
      const reply = explicitApprovalIntent
        ? `${replyBase}\n\nHinweis: Ich habe die Freigabe erkannt, konnte sie aber nicht automatisch auf das HITL-Element anwenden. Bitte bestätigen Sie das HITL-Element explizit oder nennen Sie die HITL-ID.`
        : replyBase;

      return {
        mode: 'blocked',
        hitlItemId: hitlRef.hitlItemId,
        status: resolvedStatus || 'pending',
        stopPoint,
        reply,
      };
    },

    toPublicStopPointHitlItem(hitlItem) {
      if (!hitlItem || typeof hitlItem !== 'object') {
        return null;
      }

      return {
        id: hitlItem.id || null,
        status: hitlItem.status || null,
        kind: hitlItem.kind || null,
        severity: hitlItem.severity || null,
        dueAt: hitlItem.dueAt || null,
        createdAt: hitlItem.createdAt || null,
        updatedAt: hitlItem.updatedAt || null,
        responsibleRole: hitlItem.responsibleRole || null,
        requiredResolverRoles: Array.isArray(hitlItem.requiredResolverRoles)
          ? hitlItem.requiredResolverRoles
          : [],
        personaId: hitlItem.personaId || null,
        personaName: hitlItem.personaName || null,
        personaType: hitlItem.personaType || null,
        personaResolution:
          hitlItem.personaResolution && typeof hitlItem.personaResolution === 'object'
            ? hitlItem.personaResolution
            : null,
        routingContext: this.normalizeRoutingContext(hitlItem.routingContext),
      };
    },

    buildStopPoint({ reasonCode, message, blockedStep, status, placeholder }) {
      const hitlItem = this.toPublicStopPointHitlItem(placeholder?.hitlItem || null);
      const personaId =
        placeholder?.personaId ||
        hitlItem?.personaId ||
        placeholder?.personaResolution?.personaId ||
        null;
      const personaName =
        placeholder?.personaName ||
        hitlItem?.personaName ||
        placeholder?.personaResolution?.personaName ||
        null;
      const personaType =
        placeholder?.personaType ||
        hitlItem?.personaType ||
        placeholder?.personaResolution?.personaType ||
        null;
      const responsibleRole =
        placeholder?.responsibleRole ||
        hitlItem?.responsibleRole ||
        placeholder?.personaResolution?.responsibleRole ||
        null;
      const requiredResolverRoles = Array.isArray(placeholder?.requiredResolverRoles)
        ? placeholder.requiredResolverRoles
        : Array.isArray(hitlItem?.requiredResolverRoles)
          ? hitlItem.requiredResolverRoles
          : Array.isArray(placeholder?.personaResolution?.requiredResolverRoles)
            ? placeholder.personaResolution.requiredResolverRoles
            : null;

      return {
        status,
        reasonCode,
        message,
        blockedStep,
        blockedAction: placeholder?.blockedAction || null,
        missingParams: Array.isArray(placeholder?.missingParams) ? placeholder.missingParams : null,
        onboardingQuestion: placeholder?.onboardingQuestion || null,
        onboardingHints: placeholder?.onboardingHints || null,
        placeholder: placeholder || null,
        placeholderId: placeholder?.placeholder?.placeholderId || null,
        placeholderMetadata: placeholder?.placeholderMetadata || null,
        hitlItem,
        hitlItemId: hitlItem?.id || null,
        responsibleRole,
        requiredResolverRoles,
        personaId,
        personaName,
        personaType,
        personaResolution: placeholder?.personaResolution || hitlItem?.personaResolution || null,
        routingContext: placeholder?.routingContext || hitlItem?.routingContext || null,
      };
    },

    hydrateKnownContextFromSession(knownContext = {}, session = {}) {
      const target = knownContext;
      const profileFacts = session?.l2?.userProfile?.onboardingFacts || {};
      const persistedResolved =
        session?.l3?.resolvedParams && typeof session.l3.resolvedParams === 'object'
          ? session.l3.resolvedParams
          : {};

      const normalizeOnboardingValue = (paramKey, rawValue) => {
        if (rawValue === undefined || rawValue === null) {
          return rawValue;
        }

        const text = String(rawValue).trim();
        if (!text) {
          return text;
        }

        if (paramKey === 'gridOperatorName' || paramKey === 'vnbName' || paramKey === 'query') {
          const fromPhrase = text.match(
            /(?:^|\b)(?:bei|f(?:ü|u)r|netzbetreiber(?:\s+ist)?|vnb(?:\s+ist)?)\s+(.+)$/i
          );
          const candidate = (fromPhrase?.[1] || text)
            .replace(/^(?:den|dem|die|das)\s+/i, '')
            .trim();
          return candidate || text;
        }

        if (paramKey === 'location' || paramKey === 'city') {
          const fromPhrase = text.match(/(?:^|\b)(?:in|bei|standort)\s+(.+)$/i);
          return (fromPhrase?.[1] || text).trim();
        }

        if (paramKey === 'postalCode' || paramKey === 'postleitzahl') {
          const plzMatch = text.match(/\b\d{5}\b/);
          return plzMatch ? plzMatch[0] : text;
        }

        if (paramKey === 'gridOperatorBdew' || paramKey === 'bdew') {
          const bdewMatch = text.match(/\b[0-9]{13}\b/) || text.match(/\b[A-Z0-9]{6,20}\b/i);
          return bdewMatch ? String(bdewMatch[0]).toUpperCase() : text;
        }

        return text;
      };

      const parseFnavProfileAnswer = (rawValue) => {
        if (!rawValue) return null;
        if (typeof rawValue === 'object') return rawValue;
        const text = String(rawValue).trim();
        if (!text) return null;

        const mwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*mw\b/i);
        const kwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*kw\b/i);

        let requestedCapacity = null;
        if (mwMatch) {
          requestedCapacity = Number(mwMatch[1].replace(',', '.')) * 1000;
        } else if (kwMatch) {
          requestedCapacity = Number(kwMatch[1].replace(',', '.'));
        }

        if (!Number.isFinite(requestedCapacity) || requestedCapacity <= 0) {
          return null;
        }

        return {
          requestedCapacity,
        };
      };

      for (const [key, value] of Object.entries(profileFacts)) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
          continue;
        }
        const resolvedValue = normalizeOnboardingValue(key, value?.value);
        if (resolvedValue !== undefined && resolvedValue !== null) {
          target[key] = resolvedValue;
        }
      }

      for (const [key, value] of Object.entries(persistedResolved)) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
          continue;
        }
        if (value === undefined || value === null) {
          continue;
        }
        target[key] = value;
      }

      const answeredFacts = listAnsweredOnboardingFacts(session?.l3 || {});
      for (const fact of answeredFacts) {
        if (!fact?.paramKey || Object.prototype.hasOwnProperty.call(target, fact.paramKey)) {
          continue;
        }
        if (fact.paramKey === 'fnavProfile') {
          target[fact.paramKey] = parseFnavProfileAnswer(fact.value) || fact.value;
          continue;
        }
        target[fact.paramKey] = normalizeOnboardingValue(fact.paramKey, fact.value);
      }

      return target;
    },

    findFirstMissingStep(plan = {}, knownContext = {}) {
      const executionState = { stepResults: {} };
      for (const plannedStep of plan.steps || []) {
        if (plannedStep?.action === ROUTING_CONTROL_ACTIONS.MISSING_CONTEXT) {
          continue;
        }
        const params = pruneUndefinedDeep(
          fillTemplateWithContext(
            plannedStep.paramsTemplate,
            plannedStep.action,
            knownContext,
            plan.promptHints,
            executionState
          )
        );
        const missingParams = getMissingInputs(plannedStep.action, params);
        if (missingParams.length > 0) {
          return {
            step: plannedStep,
            params,
            missingParams,
          };
        }
      }
      return null;
    },

    buildOnboardingStopPoint({
      plan,
      missingParams,
      blockedStep,
      blockedAction,
      questionTextOverride,
      locationOperatorConsistency,
      evidenceHints,
      responseStrategy = null,
    }) {
      const paramKey = resolveParamKeyFromMissing(missingParams);
      const onboardingQuestion = buildOnboardingQuestion({
        paramKey,
        action: blockedAction || plan?.steps?.[0]?.action,
        fallbackText: questionTextOverride,
        strategy: responseStrategy,
      });
      onboardingQuestion.planSnapshot = {
        source: plan?.source || 'onboarding-resume',
        routeKey: plan?.routeKey || null,
        routeLabel: plan?.routeLabel || null,
        primaryIntent: plan?.primaryIntent || blockedAction || null,
        secondaryIntents: plan?.secondaryIntents || [],
        requestedDomains: plan?.requestedDomains || [],
        unsupportedDomains: plan?.unsupportedDomains || [],
        warnings: plan?.warnings || [],
        promptHints: plan?.promptHints || {},
        status: plan?.status || 'ready',
        steps: Array.isArray(plan?.steps) ? plan.steps : [],
      };

      return {
        reasonCode: 'MISSING_INPUTS',
        status: 'awaiting-onboarding',
        blockedStep,
        blockedAction,
        missingParams,
        responseStrategy,
        locationOperatorConsistency: locationOperatorConsistency || null,
        evidenceHints: evidenceHints || null,
        message: onboardingQuestion.questionText,
        onboardingQuestion,
      };
    },

    buildHitlOnboardingQuestion(stopPoint = {}, plan = {}) {
      const placeholder =
        stopPoint?.placeholder && typeof stopPoint.placeholder === 'object'
          ? stopPoint.placeholder
          : {};
      const placeholderHitlItem = this.toPublicStopPointHitlItem(placeholder?.hitlItem || null);

      const personaId =
        stopPoint?.personaId || placeholder?.personaId || placeholderHitlItem?.personaId || null;
      const personaName =
        stopPoint?.personaName ||
        placeholder?.personaName ||
        placeholderHitlItem?.personaName ||
        null;
      const personaType =
        stopPoint?.personaType ||
        placeholder?.personaType ||
        placeholderHitlItem?.personaType ||
        null;
      const responsibleRole =
        stopPoint?.responsibleRole ||
        placeholder?.responsibleRole ||
        placeholderHitlItem?.responsibleRole ||
        null;
      const requiredResolverRoles = Array.isArray(stopPoint?.requiredResolverRoles)
        ? stopPoint.requiredResolverRoles
        : Array.isArray(placeholder?.requiredResolverRoles)
          ? placeholder.requiredResolverRoles
          : Array.isArray(placeholderHitlItem?.requiredResolverRoles)
            ? placeholderHitlItem.requiredResolverRoles
            : [];
      const routingContext =
        stopPoint?.routingContext ||
        placeholder?.routingContext ||
        placeholderHitlItem?.routingContext ||
        null;

      const hitlItem =
        placeholderHitlItem ||
        (stopPoint?.hitlItemId
          ? {
              id: stopPoint.hitlItemId,
              status: 'pending',
              personaId,
              personaName,
              personaType,
              responsibleRole,
              requiredResolverRoles,
              routingContext,
            }
          : null);

      const blockedAction = stopPoint?.blockedAction || placeholder?.blockedAction || null;
      const blockedStep = Number(stopPoint?.blockedStep || 0) || 1;
      const message =
        String(stopPoint?.message || '').trim() ||
        `Um den Schritt ${blockedStep}${blockedAction ? ` (${blockedAction})` : ''} auszuführen, ist eine Freigabe erforderlich.`;

      return {
        reasonCode: 'MANDATORY_HITL_APPROVAL',
        questionId: `hitl_approval_${hitlItem?.id || blockedStep}`,
        questionText: message,
        message,
        status: 'pending',
        blockedAction,
        blockedStep,
        action: blockedAction,
        missingParams: [],
        hitlItem,
        hitlItemId: hitlItem?.id || null,
        responsibleRole,
        requiredResolverRoles,
        personaId,
        personaName,
        personaType,
        personaResolution:
          stopPoint?.personaResolution ||
          placeholder?.personaResolution ||
          hitlItem?.personaResolution ||
          null,
        routingContext,
        placeholderId: stopPoint?.placeholderId || placeholder?.placeholder?.placeholderId || null,
        placeholderMetadata:
          stopPoint?.placeholderMetadata || placeholder?.placeholderMetadata || null,
        planSnapshot:
          plan && typeof plan === 'object'
            ? this.buildCriticalStepResumeSnapshot(plan, {
                action: blockedAction,
                step: blockedStep,
                responsibleRole,
                requiredResolverRoles,
                personaId,
                personaName,
                personaType,
                personaResolution:
                  stopPoint?.personaResolution || placeholder?.personaResolution || null,
                routingContext,
              })
            : null,
      };
    },

    buildHitlApprovalMarkdown(onboardingQuestion = {}) {
      const hitlItemId = onboardingQuestion?.hitlItem?.id || onboardingQuestion?.hitlItemId || null;
      const baseMessage =
        String(onboardingQuestion?.message || onboardingQuestion?.questionText || '').trim() ||
        'Um diesen Schritt auszuführen, ist eine Freigabe erforderlich.';

      if (!hitlItemId) {
        return `${baseMessage}\n\nBitte bestätige die Freigabe, damit ich fortfahren kann.`;
      }

      return [
        baseMessage,
        '',
        `[embed ref="hitl_item_${hitlItemId}" title="Freigabe erforderlich" /]`,
        '',
        'Bitte bestätige oder lehne die Freigabe ab, damit ich den blockierten Schritt fortsetzen kann.',
      ].join('\n');
    },

    enrichPlanWithOnboardingHints(plan = {}, knownContext = {}) {
      const firstMissing = this.findFirstMissingStep(plan, knownContext);
      if (!firstMissing) {
        return { ...plan, onboardingHints: [] };
      }

      const paramKey = resolveParamKeyFromMissing(firstMissing.missingParams);
      return {
        ...plan,
        onboardingHints: [
          {
            blockedStep: firstMissing.step.step,
            blockedAction: firstMissing.step.action,
            missingParams: firstMissing.missingParams,
            suggestedParamKey: paramKey,
          },
        ],
      };
    },

    async handleExecutionWithOnboarding(
      ctx,
      {
        message,
        plan,
        knownContext,
        session,
        executionMode,
        executionTrace = null,
        toolCallTracker = null,
      }
    ) {
      if (executionMode === EXECUTION_MODES.HITL) {
        const hydratedContext = this.hydrateKnownContextFromSession(knownContext, session);
        const enrichedPlan = this.enrichPlanWithOnboardingHints(plan, hydratedContext);
        return {
          status: 'skipped',
          steps: [],
          stopPoint:
            plan.status === 'partial'
              ? this.buildStopPoint({
                  reasonCode: 'UNSUPPORTED_CHAIN',
                  message: plan.warnings[0] || 'Chain requires manual continuation.',
                  blockedStep: (plan.steps?.length || 0) + 1,
                  status: 'plan-only',
                })
              : null,
          plan: enrichedPlan,
        };
      }

      session.l3 = {
        history: [],
        summary: null,
        compressed: false,
        ...(session.l3 || {}),
      };
      session.l3.onboardingQuestions = markStaleQuestions(session.l3, 24);

      const pendingQuestion = findPendingOnboardingQuestion(session.l3);
      const existingAssumptions = Array.isArray(session?.l3?.assumptions)
        ? session.l3.assumptions
        : [];
      let effectivePlan = plan;
      let answer = null;
      if (pendingQuestion) {
        const explicitSwitch = detectExplicitChatModeSwitch(message);
        answer = explicitSwitch
          ? null
          : captureOnboardingAnswer({ question: pendingQuestion, message });
        if (!answer) {
          const planUsesPendingAction = Array.isArray(plan?.steps)
            ? plan.steps.some((step) => step?.action === pendingQuestion.action)
            : false;

          if (planUsesPendingAction) {
            return {
              status: 'awaiting-onboarding',
              completedSteps: 0,
              steps: [],
              assumptions: existingAssumptions,
              stopPoint: {
                reasonCode: 'MISSING_INPUTS',
                status: 'awaiting-onboarding',
                blockedStep: 1,
                blockedAction: pendingQuestion.action,
                missingParams: [pendingQuestion.paramKey],
                message: pendingQuestion.questionText,
                onboardingQuestion: pendingQuestion,
              },
            };
          }
        }

        if (answer) {
          session.l3.onboardingQuestions = (session.l3.onboardingQuestions || []).map((q) =>
            q.questionId === answer.questionId ? answer : q
          );

          const stepActions = Array.isArray(plan?.steps)
            ? plan.steps.map((step) => step.action)
            : [];
          if (
            !stepActions.includes(pendingQuestion.action) &&
            Array.isArray(pendingQuestion?.planSnapshot?.steps) &&
            pendingQuestion.planSnapshot.steps.length > 0
          ) {
            effectivePlan = pendingQuestion.planSnapshot;
          }
        }
      }

      const hydratedContext = this.hydrateKnownContextFromSession(knownContext, session);

      if (answer) {
        this.emitOnboardingWorkOutLoud(ctx, {
          answer,
          hydratedContext,
        });
      }

      const firstMissing = this.findFirstMissingStep(effectivePlan, hydratedContext);
      if (firstMissing) {
        const responseStrategy = this.buildResponseStrategy({
          message,
          plan: effectivePlan,
          knownContext: hydratedContext,
          missingParams: firstMissing.missingParams,
          existingAssumptions,
        });
        const stopPoint = this.buildOnboardingStopPoint({
          plan: effectivePlan,
          missingParams: firstMissing.missingParams,
          blockedStep: firstMissing.step.step,
          blockedAction: firstMissing.step.action,
          responseStrategy,
        });
        session.l3.onboardingQuestions = [
          ...(session.l3.onboardingQuestions || []),
          stopPoint.onboardingQuestion,
        ];
        session.l3.stopPoint = null;
        return {
          status: 'awaiting-onboarding',
          completedSteps: 0,
          steps: [],
          stopPoint,
        };
      }

      const execution = await this.executeDeterministicPlan(ctx, {
        message,
        plan: effectivePlan,
        knownContext: hydratedContext,
        executionMode,
        session,
        skipGapForMissingInputs: true,
        existingAssumptions,
        executionTrace,
        toolCallTracker,
      });

      if (execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL') {
        const onboardingQuestion = this.buildHitlOnboardingQuestion(
          execution.stopPoint,
          effectivePlan
        );
        const stopPoint = {
          ...execution.stopPoint,
          onboardingQuestion,
          message: onboardingQuestion.message,
          blockedAction: onboardingQuestion.blockedAction || execution.stopPoint.blockedAction,
          blockedStep: onboardingQuestion.blockedStep || execution.stopPoint.blockedStep,
          hitlItemId: onboardingQuestion?.hitlItem?.id || execution?.stopPoint?.hitlItemId || null,
        };
        session.l3.stopPoint = stopPoint;

        return {
          ...execution,
          plan: effectivePlan,
          status: 'awaiting-onboarding',
          completedSteps: execution.completedSteps || 0,
          stopPoint,
          onboardingQuestion,
        };
      }

      if (execution?.stopPoint?.reasonCode === 'MISSING_INPUTS') {
        const responseStrategy = this.buildResponseStrategy({
          message,
          plan: effectivePlan,
          knownContext: hydratedContext,
          missingParams: execution.stopPoint?.missingParams || [],
          existingAssumptions,
          execution,
        });
        const stopPoint = this.buildOnboardingStopPoint({
          plan: effectivePlan,
          missingParams: execution.stopPoint?.missingParams || [],
          blockedStep: execution.stopPoint?.blockedStep || 1,
          blockedAction: execution.stopPoint?.blockedAction || effectivePlan?.steps?.[0]?.action,
          questionTextOverride: execution.stopPoint?.questionTextOverride,
          locationOperatorConsistency: execution.stopPoint?.locationOperatorConsistency,
          evidenceHints: execution.stopPoint?.evidenceHints,
          responseStrategy,
        });
        session.l3.onboardingQuestions = [
          ...(session.l3.onboardingQuestions || []),
          stopPoint.onboardingQuestion,
        ];
        session.l3.stopPoint = null;

        return {
          ...execution,
          plan: effectivePlan,
          status: 'awaiting-onboarding',
          completedSteps: execution.completedSteps || 0,
          stopPoint,
        };
      }

      session.l3.stopPoint = null;

      return {
        ...execution,
        plan: effectivePlan,
      };
    },

    async markRoutingGap(ctx, { reasonCode, message, blockedStep, blockingLevel = 'soft' }) {
      try {
        const placeholder = await ctx.call(
          'interface-placeholder.markGap',
          {
            role: 'personal_agent_orchestrator',
            reason:
              reasonCode === 'MANDATORY_HITL_APPROVAL'
                ? 'NEEDS_DECISION'
                : reasonCode === 'MISSING_INPUTS'
                  ? 'NEEDS_EVIDENCE'
                  : 'NEEDS_INTERFACE',
            blockingLevel,
            replacementCriteria: {
              kind: 'process',
              capabilityHint: 'personal-agent.chat',
              deadline: null,
            },
            signalCodes: [reasonCode],
            placeholderGapKey: `personal-agent-step-${blockedStep}`,
          },
          { meta: { ...ctx.meta, $gateway: false } }
        );
        return placeholder;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        this.logger.warn(`personal-agent gap marker unavailable: ${error.message}`);
        return null;
      }
    },

    buildCriticalStepCheckpointKey(plan = {}, plannedStep = {}) {
      return [
        plan?.routeKey || plan?.routeLabel || plan?.primaryIntent || 'unknown-plan',
        plannedStep?.step || 0,
        plannedStep?.action || 'unknown-action',
      ].join('::');
    },

    buildCriticalStepResumeSnapshot(plan = {}, plannedStep = {}) {
      const safeSteps = Array.isArray(plan?.steps)
        ? plan.steps.map((step) => ({
            step: Number.isFinite(Number(step?.step)) ? Number(step.step) : null,
            action: step?.action || null,
            purpose: step?.purpose || null,
            criticalityClass: step?.criticalityClass || null,
            required: Boolean(step?.required),
            paramsTemplate:
              step?.paramsTemplate && typeof step.paramsTemplate === 'object'
                ? step.paramsTemplate
                : {},
            params: step?.params && typeof step.params === 'object' ? step.params : {},
            requiredScopes: Array.isArray(step?.requiredScopes) ? step.requiredScopes : [],
            hitlRequired: Boolean(step?.hitlRequired),
            responsibleRole: step?.responsibleRole || null,
            requiredResolverRoles: Array.isArray(step?.requiredResolverRoles)
              ? step.requiredResolverRoles
              : [],
            personaId: step?.personaId || null,
            personaName: step?.personaName || null,
            personaType: step?.personaType || null,
            personaResolution:
              step?.personaResolution && typeof step.personaResolution === 'object'
                ? step.personaResolution
                : null,
            routingContext: this.normalizeRoutingContext(step?.routingContext),
          }))
        : [];

      return {
        source: plan?.source || 'hitl-resume',
        routeKey: plan?.routeKey || null,
        routeLabel: plan?.routeLabel || null,
        primaryIntent: plan?.primaryIntent || plannedStep?.action || null,
        secondaryIntents: Array.isArray(plan?.secondaryIntents) ? plan.secondaryIntents : [],
        requestedDomains: Array.isArray(plan?.requestedDomains) ? plan.requestedDomains : [],
        unsupportedDomains: Array.isArray(plan?.unsupportedDomains) ? plan.unsupportedDomains : [],
        warnings: Array.isArray(plan?.warnings) ? plan.warnings : [],
        promptHints:
          plan?.promptHints && typeof plan.promptHints === 'object' ? plan.promptHints : {},
        status: plan?.status || 'ready',
        steps: safeSteps,
        blockedAction: plannedStep?.action || null,
        blockedStep: Number.isFinite(Number(plannedStep?.step)) ? Number(plannedStep.step) : null,
        responsibleRole:
          plannedStep?.responsibleRole || plannedStep?.ownerRole || plan?.responsibleRole || null,
        requiredResolverRoles: Array.isArray(plannedStep?.requiredResolverRoles)
          ? plannedStep.requiredResolverRoles
          : Array.isArray(plan?.requiredResolverRoles)
            ? plan.requiredResolverRoles
            : [],
        personaId: plannedStep?.personaId || plan?.personaId || null,
        personaName: plannedStep?.personaName || plan?.personaName || null,
        personaType: plannedStep?.personaType || plan?.personaType || null,
        personaResolution: plannedStep?.personaResolution || plan?.personaResolution || null,
        routingContext:
          this.normalizeRoutingContext(plannedStep?.routingContext) ||
          this.normalizeRoutingContext(plan?.routingContext) ||
          null,
      };
    },

    findCriticalStepCheckpointContext(
      session = {},
      { hitlItemId = null, blockedAction = null, blockedStep = null } = {}
    ) {
      const checkpointStore = this.ensureCriticalStepCheckpointStore(session);
      const entries = Object.entries(checkpointStore)
        .map(([checkpointKey, entry]) => ({ checkpointKey, ...(entry || {}) }))
        .filter((entry) => entry && typeof entry === 'object' && entry.hitlItemId);

      if (entries.length === 0) {
        return null;
      }

      const exactHitlMatches = hitlItemId
        ? entries.filter((entry) => entry.hitlItemId === hitlItemId)
        : [];
      const exactStepMatches =
        exactHitlMatches.length === 0 && blockedAction
          ? entries.filter(
              (entry) =>
                String(entry.action || '').trim() === String(blockedAction || '').trim() &&
                Number(entry.step || 0) === Number(blockedStep || 0)
            )
          : [];

      const matches = exactHitlMatches.length > 0 ? exactHitlMatches : exactStepMatches;
      if (matches.length === 0) {
        return null;
      }

      matches.sort((a, b) => {
        const aTs = Date.parse(a.updatedAt || a.createdAt || a.approvedAt || 0) || 0;
        const bTs = Date.parse(b.updatedAt || b.createdAt || b.approvedAt || 0) || 0;
        return bTs - aTs;
      });

      return matches[0] || null;
    },

    findCriticalStepPlanStackFrame(
      planStack = [],
      { hitlItemId = null, blockedAction = null, blockedStep = null } = {}
    ) {
      const stack = Array.isArray(planStack) ? planStack : [];
      if (stack.length === 0) {
        return null;
      }

      const exactHitlMatches = hitlItemId
        ? stack.filter(
            (frame) => frame && typeof frame === 'object' && frame.hitlItemId === hitlItemId
          )
        : [];
      const exactStepMatches =
        exactHitlMatches.length === 0 && blockedAction
          ? stack.filter(
              (frame) =>
                frame &&
                typeof frame === 'object' &&
                String(frame.blockedAction || '').trim() === String(blockedAction || '').trim() &&
                Number(frame.blockedStep || 0) === Number(blockedStep || 0)
            )
          : [];

      const matches = exactHitlMatches.length > 0 ? exactHitlMatches : exactStepMatches;
      return matches.length > 0 ? matches[matches.length - 1] : null;
    },

    resolveCriticalStepResumePlan(session = {}, hitlRef = {}) {
      const sessionStopPoint =
        session?.l3?.stopPoint && typeof session.l3.stopPoint === 'object'
          ? session.l3.stopPoint
          : null;
      const blockedAction = sessionStopPoint?.blockedAction || null;
      const blockedStep = Number(sessionStopPoint?.blockedStep || 0) || null;
      const checkpointContext = this.findCriticalStepCheckpointContext(session, {
        hitlItemId: hitlRef?.hitlItemId || sessionStopPoint?.hitlItemId || null,
        blockedAction,
        blockedStep,
      });

      const stopPointPlanSnapshot =
        sessionStopPoint?.onboardingQuestion?.planSnapshot &&
        Array.isArray(sessionStopPoint.onboardingQuestion.planSnapshot.steps) &&
        sessionStopPoint.onboardingQuestion.planSnapshot.steps.length > 0
          ? sessionStopPoint.onboardingQuestion.planSnapshot
          : null;
      const checkpointPlanSnapshot =
        checkpointContext?.planSnapshot &&
        Array.isArray(checkpointContext.planSnapshot.steps) &&
        checkpointContext.planSnapshot.steps.length > 0
          ? checkpointContext.planSnapshot
          : null;
      const planStackFrame = this.findCriticalStepPlanStackFrame(session?.planStack || [], {
        hitlItemId:
          hitlRef?.hitlItemId ||
          sessionStopPoint?.hitlItemId ||
          checkpointContext?.hitlItemId ||
          null,
        blockedAction,
        blockedStep,
      });
      const planStackPlanSnapshot =
        planStackFrame?.planSnapshot &&
        Array.isArray(planStackFrame.planSnapshot.steps) &&
        planStackFrame.planSnapshot.steps.length > 0
          ? planStackFrame.planSnapshot
          : null;

      return {
        planSnapshot:
          stopPointPlanSnapshot || checkpointPlanSnapshot || planStackPlanSnapshot || null,
        checkpointContext,
        planStackFrame,
        stopPointPlanSnapshot,
        checkpointPlanSnapshot,
        planStackPlanSnapshot,
      };
    },

    ensureCriticalStepCheckpointStore(session = {}) {
      if (!session.l3 || typeof session.l3 !== 'object') {
        session.l3 = {};
      }
      if (
        !session.l3.criticalStepCheckpoints ||
        typeof session.l3.criticalStepCheckpoints !== 'object'
      ) {
        session.l3.criticalStepCheckpoints = {};
      }
      return session.l3.criticalStepCheckpoints;
    },

    async getHitlItemStatus(ctx, hitlItemId) {
      const item = await this.getHitlItem(ctx, hitlItemId);
      return item?.status || null;
    },

    async getHitlItem(ctx, hitlItemId) {
      if (!hitlItemId) return null;
      try {
        const result = await ctx.call(
          'hitl.get',
          { id: hitlItemId },
          { meta: { ...ctx.meta, $gateway: false } }
        );
        return result?.item || null;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        this.logger?.warn(`hitl.get failed for ${hitlItemId}: ${error.message}`);
        return null;
      }
    },

    async createCriticalStepHitlItem(
      ctx,
      { message, plan = {}, plannedStep = {}, session = {}, knownContext = {} }
    ) {
      try {
        const routingMetadata = this.deriveCriticalStepRoutingMetadata({
          plan,
          plannedStep,
          knownContext,
        });

        const payload = {
          sessionId: session?.id || null,
          routeKey: plan?.routeKey || null,
          routeLabel: plan?.routeLabel || null,
          primaryIntent: plan?.primaryIntent || null,
          step: plannedStep?.step || null,
          action: plannedStep?.action || null,
          purpose: plannedStep?.purpose || null,
          criticalityClass: plannedStep?.criticalityClass || null,
          userMessage: String(message || '').slice(0, 500),
        };

        const result = await ctx.call(
          'hitl.create',
          {
            kind: 'personal-agent-critical-step-approval',
            payload,
            originService: 'personal-agent',
            originAction: plannedStep?.action || 'unknown',
            severity: 'critical',
            requiredScope: 'full-access',
            responsibleRole: routingMetadata.responsibleRole,
            requiredResolverRoles: routingMetadata.requiredResolverRoles,
            personaId: routingMetadata.personaId,
            routingContext: routingMetadata.routingContext || {},
          },
          { meta: { ...ctx.meta, $gateway: false } }
        );

        return result?.item || null;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        this.logger?.warn(`hitl.create failed for critical step checkpoint: ${error.message}`);
        return null;
      }
    },

    async resolveCriticalStepApproval(
      ctx,
      { message, plan = {}, plannedStep = {}, session = {}, knownContext = {} }
    ) {
      const store = this.ensureCriticalStepCheckpointStore(session);
      const checkpointKey = this.buildCriticalStepCheckpointKey(plan, plannedStep);
      const stored =
        store[checkpointKey] && typeof store[checkpointKey] === 'object'
          ? store[checkpointKey]
          : null;

      const providedHitlItemId =
        knownContext?.hitlItemId ||
        knownContext?.hitl?.itemId ||
        knownContext?.hitlItem?.id ||
        null;

      if (providedHitlItemId) {
        const providedItem = await this.getHitlItem(ctx, providedHitlItemId);
        const providedStatus = providedItem?.status || null;
        if (providedStatus === 'approved') {
          store[checkpointKey] = {
            hitlItemId: providedHitlItemId,
            status: 'approved',
            approvedAt: new Date().toISOString(),
            action: plannedStep?.action || null,
            step: plannedStep?.step || null,
            checkpointKey,
            planSnapshot: this.buildCriticalStepResumeSnapshot(plan, plannedStep),
            blockedAction: plannedStep?.action || null,
            blockedStep: Number.isFinite(Number(plannedStep?.step))
              ? Number(plannedStep.step)
              : null,
            responsibleRole:
              plannedStep?.responsibleRole ||
              plannedStep?.ownerRole ||
              plan?.responsibleRole ||
              null,
            requiredResolverRoles: Array.isArray(plannedStep?.requiredResolverRoles)
              ? plannedStep.requiredResolverRoles
              : Array.isArray(plan?.requiredResolverRoles)
                ? plan.requiredResolverRoles
                : [],
            personaId: plannedStep?.personaId || plan?.personaId || null,
            personaName: plannedStep?.personaName || plan?.personaName || null,
            personaType: plannedStep?.personaType || plan?.personaType || null,
            personaResolution: plannedStep?.personaResolution || plan?.personaResolution || null,
            routingContext:
              this.normalizeRoutingContext(plannedStep?.routingContext) ||
              this.normalizeRoutingContext(plan?.routingContext) ||
              null,
          };
          return {
            approved: true,
            hitlItemId: providedHitlItemId,
            status: providedStatus,
            hitlItem: this.toPublicStopPointHitlItem(providedItem) || {
              id: providedHitlItemId,
              status: providedStatus,
            },
          };
        }

        store[checkpointKey] = {
          hitlItemId: providedHitlItemId,
          status: providedStatus || 'pending',
          updatedAt: new Date().toISOString(),
          action: plannedStep?.action || null,
          step: plannedStep?.step || null,
          checkpointKey,
          planSnapshot: this.buildCriticalStepResumeSnapshot(plan, plannedStep),
          blockedAction: plannedStep?.action || null,
          blockedStep: Number.isFinite(Number(plannedStep?.step)) ? Number(plannedStep.step) : null,
          responsibleRole:
            plannedStep?.responsibleRole || plannedStep?.ownerRole || plan?.responsibleRole || null,
          requiredResolverRoles: Array.isArray(plannedStep?.requiredResolverRoles)
            ? plannedStep.requiredResolverRoles
            : Array.isArray(plan?.requiredResolverRoles)
              ? plan.requiredResolverRoles
              : [],
          personaId: plannedStep?.personaId || plan?.personaId || null,
          personaName: plannedStep?.personaName || plan?.personaName || null,
          personaType: plannedStep?.personaType || plan?.personaType || null,
          personaResolution: plannedStep?.personaResolution || plan?.personaResolution || null,
          routingContext:
            this.normalizeRoutingContext(plannedStep?.routingContext) ||
            this.normalizeRoutingContext(plan?.routingContext) ||
            null,
        };
        return {
          approved: false,
          hitlItemId: providedHitlItemId,
          status: providedStatus || 'pending',
          hitlItem: this.toPublicStopPointHitlItem(providedItem) || {
            id: providedHitlItemId,
            status: providedStatus || 'pending',
          },
        };
      }

      const storedHitlItemId = stored?.hitlItemId || null;
      if (storedHitlItemId) {
        const storedItem = await this.getHitlItem(ctx, storedHitlItemId);
        const status = storedItem?.status || null;
        if (status === 'approved') {
          store[checkpointKey] = {
            ...stored,
            status: 'approved',
            approvedAt: new Date().toISOString(),
            planSnapshot:
              stored?.planSnapshot && Array.isArray(stored.planSnapshot.steps)
                ? stored.planSnapshot
                : this.buildCriticalStepResumeSnapshot(plan, plannedStep),
          };
          return {
            approved: true,
            hitlItemId: storedHitlItemId,
            status,
            hitlItem: this.toPublicStopPointHitlItem(storedItem) || {
              id: storedHitlItemId,
              status,
            },
          };
        }

        store[checkpointKey] = {
          ...stored,
          status: status || 'pending',
          updatedAt: new Date().toISOString(),
          planSnapshot:
            stored?.planSnapshot && Array.isArray(stored.planSnapshot.steps)
              ? stored.planSnapshot
              : this.buildCriticalStepResumeSnapshot(plan, plannedStep),
        };
        return {
          approved: false,
          hitlItemId: storedHitlItemId,
          status: status || 'pending',
          hitlItem: this.toPublicStopPointHitlItem(storedItem) || {
            id: storedHitlItemId,
            status: status || 'pending',
          },
        };
      }

      const createdItem = await this.createCriticalStepHitlItem(ctx, {
        message,
        plan,
        plannedStep,
        session,
        knownContext,
      });

      if (createdItem?.id) {
        store[checkpointKey] = {
          hitlItemId: createdItem.id,
          status: createdItem.status || 'pending',
          createdAt: new Date().toISOString(),
          action: plannedStep?.action || null,
          step: plannedStep?.step || null,
          checkpointKey,
          planSnapshot: this.buildCriticalStepResumeSnapshot(plan, plannedStep),
          blockedAction: plannedStep?.action || null,
          blockedStep: Number.isFinite(Number(plannedStep?.step)) ? Number(plannedStep.step) : null,
          responsibleRole:
            plannedStep?.responsibleRole || plannedStep?.ownerRole || plan?.responsibleRole || null,
          requiredResolverRoles: Array.isArray(plannedStep?.requiredResolverRoles)
            ? plannedStep.requiredResolverRoles
            : Array.isArray(plan?.requiredResolverRoles)
              ? plan.requiredResolverRoles
              : [],
          personaId: plannedStep?.personaId || plan?.personaId || null,
          personaName: plannedStep?.personaName || plan?.personaName || null,
          personaType: plannedStep?.personaType || plan?.personaType || null,
          personaResolution: plannedStep?.personaResolution || plan?.personaResolution || null,
          routingContext:
            this.normalizeRoutingContext(plannedStep?.routingContext) ||
            this.normalizeRoutingContext(plan?.routingContext) ||
            null,
        };
        return {
          approved: false,
          hitlItemId: createdItem.id,
          status: createdItem.status || 'pending',
          hitlItem: this.toPublicStopPointHitlItem(createdItem),
        };
      }

      return { approved: false, hitlItemId: null, status: 'pending', hitlItem: null };
    },

    findBestVdmiDecisionTask(matrix = {}) {
      const tasks = Array.isArray(matrix?.tasks) ? matrix.tasks : [];
      if (tasks.length === 0) {
        return {
          task: null,
          reason: 'no_tasks_available',
        };
      }

      const decisionRegex =
        /(decision|entscheidung|netzbetreiberentscheidung|anschluss|kapazit[aä]t|uebergabepunkt|übergabepunkt|governance|formal|antrag|gatekeeper)/i;
      const decisionCandidates = tasks.filter((task) =>
        decisionRegex.test(`${task?.taskId || ''} ${task?.taskName || ''} ${task?.phase || ''}`)
      );

      if (decisionCandidates.length === 1) {
        return {
          task: decisionCandidates[0],
          reason: 'decision_task_match',
        };
      }

      if (decisionCandidates.length > 1) {
        return {
          task: null,
          reason: 'ambiguous_decision_tasks',
          candidates: decisionCandidates.map((task) => task?.taskId).filter(Boolean),
        };
      }

      if (tasks.length === 1) {
        return {
          task: tasks[0],
          reason: 'single_task_fallback',
        };
      }

      return {
        task: null,
        reason: 'task_context_required',
        candidates: tasks.map((task) => task?.taskId).filter(Boolean),
      };
    },

    extractVdmiTaskFromExecutionState(executionState = {}) {
      const stepResults = executionState?.stepResults || {};
      const steps = Object.values(stepResults).map(
        (entry) => entry?.raw || entry?.data || entry || {}
      );

      for (const payload of steps.reverse()) {
        const dossierTask = payload?.dossier?.task;
        if (dossierTask && (dossierTask.taskId || dossierTask.taskName)) {
          return dossierTask;
        }
      }

      return null;
    },

    async loadVdmiMatrixForKnownContext(ctx, knownContext = {}) {
      const matrixId = knownContext?.matrixId || null;
      const processId = knownContext?.processId || knownContext?.jobId || null;

      if (matrixId) {
        try {
          const response = await ctx.call(
            'vdmi.get',
            { id: matrixId },
            { meta: { ...ctx.meta, $gateway: false } }
          );
          return response?.matrix || null;
        } catch (error) {
          if (isActionUnavailable(error) || isNotFound(error)) {
            return null;
          }
          throw error;
        }
      }

      if (processId) {
        try {
          const response = await ctx.call(
            'vdmi.context',
            { jobId: processId },
            { meta: { ...ctx.meta, $gateway: false } }
          );
          return response?.matrix || null;
        } catch (error) {
          if (isActionUnavailable(error) || isNotFound(error)) {
            return null;
          }
          throw error;
        }
      }

      return null;
    },

    async hydrateVdmiStepParams(ctx, { plannedStep, params, knownContext, executionState }) {
      const action = String(plannedStep?.action || '');
      if (!action.startsWith('vdmi.')) {
        return { params, stopPoint: null };
      }

      const hydrated = { ...(params || {}) };

      if (
        (action === 'vdmi.dossier' ||
          action === 'vdmi.negotiationTrace' ||
          action === 'vdmi.agentRole') &&
        !hydrated.taskId
      ) {
        if (knownContext?.taskId) {
          hydrated.taskId = knownContext.taskId;
        } else {
          const inferredTask = this.extractVdmiTaskFromExecutionState(executionState);
          if (inferredTask?.taskId) {
            hydrated.taskId = inferredTask.taskId;
            knownContext.taskId = inferredTask.taskId;
          } else {
            const matrix = await this.loadVdmiMatrixForKnownContext(ctx, knownContext);
            if (matrix) {
              const picked = this.findBestVdmiDecisionTask(matrix);
              if (picked?.task?.taskId) {
                hydrated.taskId = picked.task.taskId;
                knownContext.taskId = picked.task.taskId;
              } else {
                const reasonSuffix = picked?.reason ? ` (${picked.reason})` : '';
                return {
                  params: hydrated,
                  stopPoint: {
                    reasonCode: 'MISSING_VDMI_TASK_CONTEXT',
                    message: `VDMI Task-Kontext ist nicht eindeutig auflösbar${reasonSuffix}.`,
                    blockedStep: plannedStep.step,
                    blockedAction: action,
                    missingParams: ['taskId'],
                    status: 'interface-placeholder',
                  },
                };
              }
            } else {
              return {
                params: hydrated,
                stopPoint: {
                  reasonCode: 'MISSING_VDMI_TASK_CONTEXT',
                  message:
                    'VDMI Task-Kontext fehlt. Bitte taskId, matrixId oder processId angeben.',
                  blockedStep: plannedStep.step,
                  blockedAction: action,
                  missingParams: ['taskId'],
                  status: 'interface-placeholder',
                },
              };
            }
          }
        }
      }

      if (action === 'vdmi.agentRole') {
        if (!hydrated.processType && knownContext?.processType) {
          hydrated.processType = knownContext.processType;
        }

        if (!hydrated.agentId) {
          const taskFromExecution = this.extractVdmiTaskFromExecutionState(executionState);
          const taskActors = Array.isArray(taskFromExecution?.verantwortlich)
            ? taskFromExecution.verantwortlich
            : [];

          let selectedActors = taskActors;

          if (selectedActors.length === 0 && hydrated.taskId) {
            const matrix = await this.loadVdmiMatrixForKnownContext(ctx, knownContext);
            const matchedTask = (matrix?.tasks || []).find(
              (task) => task?.taskId === hydrated.taskId
            );
            selectedActors = Array.isArray(matchedTask?.verantwortlich)
              ? matchedTask.verantwortlich
              : [];
          }

          if (selectedActors.length === 1 && selectedActors[0]?.actorId) {
            hydrated.agentId = selectedActors[0].actorId;
            knownContext.agentId = selectedActors[0].actorId;
          } else if (selectedActors.length > 1) {
            return {
              params: hydrated,
              stopPoint: {
                reasonCode: 'AMBIGUOUS_VDMI_V_ACTOR',
                message:
                  'Mehrere verantwortliche V-Akteure gefunden. Bitte Agenten-ID eindeutig angeben.',
                blockedStep: plannedStep.step,
                blockedAction: action,
                missingParams: ['agentId'],
                status: 'interface-placeholder',
              },
            };
          } else {
            return {
              params: hydrated,
              stopPoint: {
                reasonCode: 'MISSING_VDMI_V_ACTOR',
                message: 'Kein verantwortlicher V-Akteur für die Entscheidungstask gefunden.',
                blockedStep: plannedStep.step,
                blockedAction: action,
                missingParams: ['agentId'],
                status: 'interface-placeholder',
              },
            };
          }
        }
      }

      return { params: hydrated, stopPoint: null };
    },

    async executeDeterministicPlan(
      ctx,
      {
        message,
        plan,
        knownContext,
        executionMode,
        session,
        skipGapForMissingInputs = false,
        existingAssumptions = [],
        executionTrace = null,
        toolCallTracker = null,
      }
    ) {
      const executionState = {
        stepResults: {},
      };
      const steps = [];
      let completedSteps = 0;
      let stopPoint = null;
      let assumptions = [...(existingAssumptions || [])];

      for (const plannedStep of plan.steps) {
        if (plannedStep?.action === ROUTING_CONTROL_ACTIONS.MISSING_CONTEXT) {
          continue;
        }

        if (executionMode === EXECUTION_MODES.AUTO && plannedStep?.hitlRequired === true) {
          const approval = await this.resolveCriticalStepApproval(ctx, {
            message,
            plan,
            plannedStep,
            session,
            knownContext,
          });

          const routingMetadata = this.deriveCriticalStepRoutingMetadata({
            plan,
            plannedStep,
            knownContext,
          });

          if (approval?.approved === true) {
            // Approval exists -> proceed with deterministic execution.
          } else {
            const hitlMessage = `Kritischer Prüfschritt ${plannedStep.step} (${plannedStep.action}) erfordert vor Ausführung eine verpflichtende HITL-Freigabe.`;
            const placeholder = await this.markRoutingGap(ctx, {
              reasonCode: 'MANDATORY_HITL_APPROVAL',
              message: hitlMessage,
              blockedStep: plannedStep.step,
              blockingLevel: 'hard',
            });

            const hitlItem =
              this.toPublicStopPointHitlItem(approval?.hitlItem) ||
              (approval?.hitlItemId
                ? {
                    id: approval.hitlItemId,
                    status: approval.status || 'pending',
                    responsibleRole: routingMetadata.responsibleRole,
                    requiredResolverRoles: routingMetadata.requiredResolverRoles,
                    personaId: routingMetadata.personaId,
                    routingContext: routingMetadata.routingContext,
                  }
                : null);

            stopPoint = this.buildStopPoint({
              reasonCode: 'MANDATORY_HITL_APPROVAL',
              message: hitlMessage,
              blockedStep: plannedStep.step,
              status: placeholder ? 'interface-placeholder' : 'hitl-required',
              placeholder: {
                ...placeholder,
                blockedAction: plannedStep.action,
                missingParams: [],
                responsibleRole:
                  hitlItem?.responsibleRole || routingMetadata.responsibleRole || null,
                requiredResolverRoles: Array.isArray(hitlItem?.requiredResolverRoles)
                  ? hitlItem.requiredResolverRoles
                  : routingMetadata.requiredResolverRoles,
                personaId: hitlItem?.personaId || routingMetadata.personaId || null,
                personaName: hitlItem?.personaName || null,
                personaType: hitlItem?.personaType || null,
                personaResolution: hitlItem?.personaResolution || null,
                routingContext:
                  this.normalizeRoutingContext(hitlItem?.routingContext) ||
                  this.normalizeRoutingContext(routingMetadata.routingContext) ||
                  null,
                hitlItem,
              },
            });
            steps.push({
              step: plannedStep.step,
              action: plannedStep.action,
              status: 'hitl-required',
              params: {},
              missingInputs: [],
              hitlItemId: approval?.hitlItemId || null,
            });
            break;
          }
        }

        let params = pruneUndefinedDeep(
          fillTemplateWithContext(
            plannedStep.paramsTemplate,
            plannedStep.action,
            knownContext,
            plan.promptHints,
            executionState
          )
        );

        const vdmiHydration = await this.hydrateVdmiStepParams(ctx, {
          plannedStep,
          params,
          knownContext,
          executionState,
        });
        params = pruneUndefinedDeep(vdmiHydration.params || params);

        if (vdmiHydration.stopPoint) {
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: vdmiHydration.stopPoint.reasonCode,
            message: vdmiHydration.stopPoint.message,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: vdmiHydration.stopPoint.reasonCode,
            message: vdmiHydration.stopPoint.message,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : vdmiHydration.stopPoint.status,
            placeholder: {
              ...placeholder,
              blockedAction: plannedStep.action,
              missingParams: vdmiHydration.stopPoint.missingParams,
            },
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'blocked',
            params,
            missingInputs: vdmiHydration.stopPoint.missingParams || [],
          });
          break;
        }

        // Central execution preflight — must pass before any ctx.call.
        // Uses runExecutionPreflight for stricter checks (null, empty string, empty array/object)
        // beyond what the legacy getMissingInputs covers.
        const preflight = runExecutionPreflight(plannedStep.action, params, {
          requiredScopes: Array.isArray(plannedStep.requiredScopes)
            ? plannedStep.requiredScopes
            : [],
          contextScopes: knownContext?._scopes || null,
        });
        const missingInputs = preflight.missingParams;

        if (preflight.outcome === 'scope-blocked') {
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: 'SCOPE_BLOCKED',
            message: `Step ${plannedStep.step} (${plannedStep.action}) requires scope evidence: ${missingInputs.join(', ')}`,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: 'SCOPE_BLOCKED',
            message: `Scope-Voraussetzungen nicht erfüllt für ${plannedStep.action}: ${missingInputs.join(', ')}`,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : 'scope-blocked',
            placeholder: {
              ...placeholder,
              blockedAction: plannedStep.action,
              missingParams: missingInputs,
            },
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'scope-blocked',
            params,
            missingInputs,
          });
          break;
        }

        if (preflight.outcome === 'missing-inputs') {
          if (skipGapForMissingInputs) {
            stopPoint = {
              reasonCode: 'MISSING_INPUTS',
              message: `Missing inputs for ${plannedStep.action}: ${missingInputs.join(', ')}`,
              blockedStep: plannedStep.step,
              blockedAction: plannedStep.action,
              missingParams: missingInputs,
              status: 'missing-inputs',
            };
          } else {
            const placeholder = await this.markRoutingGap(ctx, {
              reasonCode: 'MISSING_INPUTS',
              message: `Step ${plannedStep.step} cannot run because required inputs are missing: ${missingInputs.join(', ')}`,
              blockedStep: plannedStep.step,
            });
            stopPoint = this.buildStopPoint({
              reasonCode: 'MISSING_INPUTS',
              message: `Missing inputs for ${plannedStep.action}: ${missingInputs.join(', ')}`,
              blockedStep: plannedStep.step,
              status: placeholder ? 'interface-placeholder' : 'missing-inputs',
              placeholder: {
                ...placeholder,
                blockedAction: plannedStep.action,
                missingParams: missingInputs,
              },
            });
          }
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'blocked',
            params,
            missingInputs,
          });
          break;
        }

        try {
          const startedAt = Date.now();
          const result = await ctx.call(plannedStep.action, params, {
            meta: { ...ctx.meta, $gateway: false },
          });
          if (result && typeof result === 'object' && result.success === false) {
            const toolMessage =
              result?.error?.message ||
              result?.message ||
              `${plannedStep.action} returned success=false`;
            stopPoint = this.buildStopPoint({
              reasonCode: 'ACTION_FAILED',
              message: `${plannedStep.action} konnte nicht abgeschlossen werden: ${toolMessage}`,
              blockedStep: plannedStep.step,
              status: 'action-error',
              placeholder: {
                blockedAction: plannedStep.action,
                missingParams: /bdew/i.test(toolMessage) ? ['bdew'] : [],
              },
            });
            steps.push({
              step: plannedStep.step,
              action: plannedStep.action,
              status: 'failed',
              params,
              result,
              error: toolMessage,
            });
            toolCallTracker?.record({
              phase: 'execution',
              tool: plannedStep.action,
              params,
              success: false,
              retries: 0,
              error: toolMessage,
            });
            executionTrace?.recordToolInvocation({
              phase: 'execution',
              tool: plannedStep.action,
              params,
              success: false,
              latencyMs: Date.now() - startedAt,
              retries: 0,
              error: toolMessage,
            });
            break;
          }
          const normalizedData =
            result && typeof result === 'object' && result.data !== undefined
              ? result.data
              : result;
          executionState.stepResults[plannedStep.step] = {
            data: normalizedData,
            raw: result,
            params,
          };
          completedSteps += 1;
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'completed',
            params,
            result,
          });
          toolCallTracker?.record({
            phase: 'execution',
            tool: plannedStep.action,
            params,
            success: true,
            retries: 0,
            result,
          });
          executionTrace?.recordToolInvocation({
            phase: 'execution',
            tool: plannedStep.action,
            params,
            success: true,
            latencyMs: Date.now() - startedAt,
            retries: 0,
            result,
          });

          if (plannedStep.action === 'grid-operations.marketPartners') {
            const resolvedList = Array.isArray(result?.data?.results)
              ? result.data.results
              : Array.isArray(result?.results)
                ? result.results
                : [];

            if (resolvedList.length === 0) {
              const nextStep = plan.steps.find(
                (candidate) => candidate.step === plannedStep.step + 1
              );
              stopPoint = {
                reasonCode: 'MISSING_INPUTS',
                message: 'Kein eindeutiger Netzbetreiber-Treffer aus den vorhandenen Angaben.',
                blockedStep: nextStep?.step || plannedStep.step + 1,
                blockedAction: nextStep?.action || null,
                missingParams: ['operatorEvidence'],
                status: 'evidence-gap',
              };
              break;
            }
          }

          if (plannedStep.action === 'grid-operations.vnbLookup') {
            const consistency = this.classifyLocationOperatorConsistency({
              knownContext,
              promptHints: plan.promptHints,
              steps,
            });
            if (consistency?.status === 'unverified' || consistency?.status === 'mismatch') {
              // Store unverified location/operator assumption for downstream synthesis
              const existingAssumption = assumptions.find(
                (a) => a.type === 'location_operator_unverified'
              );
              if (!existingAssumption) {
                assumptions.push({
                  type: 'location_operator_unverified',
                  location: consistency.hints?.projectLocation || '',
                  assertedGridOperatorName: consistency.hints?.assertedOperator || '',
                  matchedGridOperatorName: consistency.hints?.matchedOperatorName || '',
                  status: consistency.status,
                  requiredEvidence: [
                    'Netzanschlusszusage/BKZ',
                    'BDEW-Code',
                    'Marktlokation',
                    'Netzanschlusspunkt',
                  ],
                  createdAtStep: plannedStep.step,
                  createdAtTurn: new Date().toISOString(),
                });
              }
              stopPoint = {
                reasonCode: 'MISSING_INPUTS',
                message:
                  'Standort/Netzbetreiber-Zuständigkeit ist noch nicht belastbar verifiziert.',
                blockedStep: plannedStep.step,
                blockedAction: plannedStep.action,
                missingParams: ['operatorEvidence'],
                status: 'evidence-gap',
                locationOperatorConsistency: consistency.status,
                evidenceHints: consistency.hints,
                questionTextOverride: this.buildOperatorEvidenceQuestion(consistency),
              };
              break;
            }
          }
        } catch (error) {
          toolCallTracker?.record({
            phase: 'execution',
            tool: plannedStep.action,
            params,
            success: false,
            retries: 0,
            error: error.message,
          });
          executionTrace?.recordToolInvocation({
            phase: 'execution',
            tool: plannedStep.action,
            params,
            success: false,
            retries: 0,
            error: error.message,
          });
          // Guard: Moleculer Parameters validation error slipped past preflight.
          // Convert to structured PREFLIGHT_MISS — do not expose schema internals to user.
          if (isParametersValidationError(error)) {
            const placeholder = await this.markRoutingGap(ctx, {
              reasonCode: 'PREFLIGHT_MISS',
              message: `Ungültige Parameter für ${plannedStep.action}.`,
              blockedStep: plannedStep.step,
            });
            stopPoint = this.buildStopPoint({
              reasonCode: 'PREFLIGHT_MISS',
              message: `Ungültige oder fehlende Parameter für ${plannedStep.action}. Bitte notwendige Felder prüfen.`,
              blockedStep: plannedStep.step,
              status: placeholder ? 'interface-placeholder' : 'missing-inputs',
              placeholder: {
                ...placeholder,
                blockedAction: plannedStep.action,
                missingParams: [],
                preflightRegression: true,
              },
            });
            steps.push({
              step: plannedStep.step,
              action: plannedStep.action,
              status: 'blocked',
              params,
              error: 'PREFLIGHT_MISS',
              preflightRegression: true,
            });
            break;
          }
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: isActionUnavailable(error) ? 'UNSUPPORTED_CHAIN' : 'ACTION_FAILED',
            message: error.message,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: isActionUnavailable(error) ? 'UNSUPPORTED_CHAIN' : 'ACTION_FAILED',
            message: error.message,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : 'action-error',
            placeholder,
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'failed',
            params,
            error: error.message,
          });
          break;
        }
      }

      if (!stopPoint && plan.status === 'partial') {
        const placeholder = await this.markRoutingGap(ctx, {
          reasonCode: 'UNSUPPORTED_CHAIN',
          message: plan.warnings[0] || 'Unsupported chained domains require manual continuation.',
          blockedStep: completedSteps + 1,
        });
        stopPoint = this.buildStopPoint({
          reasonCode: 'UNSUPPORTED_CHAIN',
          message: plan.warnings[0] || 'Unsupported chained domains require manual continuation.',
          blockedStep: completedSteps + 1,
          status: placeholder ? 'interface-placeholder' : 'unsupported-chain',
          placeholder,
        });
      }

      return {
        status: stopPoint ? 'partial' : 'completed',
        completedSteps,
        steps,
        stopPoint,
        message,
        assumptions,
      };
    },

    normalizeComparableText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, ' ')
        .trim();
    },

    extractLookupResults(step = {}) {
      const result = step?.result;
      if (!result || typeof result !== 'object') {
        return [];
      }
      if (Array.isArray(result?.data?.results)) {
        return result.data.results;
      }
      if (Array.isArray(result?.results)) {
        return result.results;
      }
      if (Array.isArray(result?.data?.data?.results)) {
        return result.data.data.results;
      }
      return [];
    },

    classifyLocationOperatorConsistency({ knownContext = {}, promptHints = {}, steps = [] } = {}) {
      const assertedOperator =
        knownContext?.assertedGridOperatorName ||
        promptHints?.assertedGridOperatorName ||
        promptHints?.gridOperatorName ||
        knownContext?.gridOperatorName ||
        '';
      const projectLocation =
        knownContext?.location || promptHints?.location || promptHints?.city || '';

      if (!assertedOperator || !projectLocation) {
        return null;
      }

      const marketPartnerStep = steps.find(
        (step) => step?.action === 'grid-operations.marketPartners' && step?.status === 'completed'
      );
      const vnbLookupStep = steps.find(
        (step) => step?.action === 'grid-operations.vnbLookup' && step?.status === 'completed'
      );
      const partnerResults = this.extractLookupResults(marketPartnerStep);
      const topHit = partnerResults[0] || null;

      const matchedOperatorName = String(
        topHit?.name || vnbLookupStep?.result?.operator?.name || ''
      ).trim();
      const lookupCity = String(
        topHit?.contacts?.[0]?.city || vnbLookupStep?.result?.operator?.city || ''
      ).trim();

      const normalizedAsserted = this.normalizeComparableText(assertedOperator);
      const normalizedMatched = this.normalizeComparableText(matchedOperatorName);
      const operatorMatches =
        !normalizedMatched ||
        normalizedMatched.includes(normalizedAsserted) ||
        normalizedAsserted.includes(normalizedMatched);

      if (!operatorMatches) {
        return {
          status: 'mismatch',
          hints: {
            assertedOperator,
            matchedOperatorName,
            projectLocation,
            lookupCity,
          },
        };
      }

      const hardMismatch = Boolean(
        vnbLookupStep?.result?.operator?.isResponsible === false ||
        vnbLookupStep?.result?.operator?.zustaendig === false ||
        vnbLookupStep?.result?.responsibilityMatch === false
      );

      if (hardMismatch) {
        return {
          status: 'mismatch',
          hints: {
            assertedOperator,
            matchedOperatorName,
            projectLocation,
            lookupCity,
          },
        };
      }

      const hardVerified = Boolean(
        vnbLookupStep?.result?.operator?.isResponsible === true ||
        vnbLookupStep?.result?.operator?.zustaendig === true ||
        vnbLookupStep?.result?.responsibilityMatch === true ||
        vnbLookupStep?.result?.operator?.evidenceVerified === true ||
        vnbLookupStep?.result?.operator?.verified === true
      );

      const normalizedProjectLocation = this.normalizeComparableText(projectLocation);
      const normalizedLookupCity = this.normalizeComparableText(lookupCity);
      const locationMatches = Boolean(
        normalizedProjectLocation &&
        normalizedLookupCity &&
        (normalizedLookupCity.includes(normalizedProjectLocation) ||
          normalizedProjectLocation.includes(normalizedLookupCity))
      );

      if (hardVerified && locationMatches) {
        return {
          status: 'verified',
          hints: {
            assertedOperator,
            matchedOperatorName,
            projectLocation,
            lookupCity,
          },
        };
      }

      return {
        status: 'unverified',
        hints: {
          assertedOperator,
          matchedOperatorName,
          projectLocation,
          lookupCity,
        },
      };
    },

    buildOperatorEvidenceQuestion(consistency = {}) {
      const hint = consistency?.hints || {};
      const locationText = hint.projectLocation ? ` für den Standort ${hint.projectLocation}` : '';
      return `Ich kann die Zuständigkeit${locationText} noch nicht belastbar bestätigen. Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, Netzanschlusspunkt oder den zuständigen BDEW-Code.`;
    },

    /**
     * Check if execution result contains structured data worth presenting.
     */
    hasStructuredExecutionResult(execution = {}) {
      if (!execution || !Array.isArray(execution.steps)) {
        return false;
      }

      // Check if any step result has structured data
      for (const step of execution.steps) {
        const result = step.result || {};
        if (this.hasStructuredData(result)) {
          return true;
        }

        const dossier = result?.dossier;
        if (
          dossier &&
          typeof dossier === 'object' &&
          ((dossier.task && typeof dossier.task === 'object') ||
            Array.isArray(dossier.evidenceGaps) ||
            Array.isArray(dossier.forbiddenAssumptions) ||
            Array.isArray(dossier.nextActions))
        ) {
          return true;
        }
      }

      return false;
    },

    /**
     * Extract domain result from execution steps (combined result of all steps).
     */
    extractDomainResultFromExecution(execution = {}) {
      if (!Array.isArray(execution.steps) || execution.steps.length === 0) {
        return null;
      }

      const merged = {};
      const vdmiTasksById = new Map();
      const vdmiEvidenceGaps = [];
      const vdmiEvidenceRequirements = [];
      const vdmiForbiddenAssumptions = [];
      const vdmiNextActions = [];
      const vdmiRisks = [];
      let vdmiExpectedStatus;
      let vdmiDecisionStatus;
      let vdmiMatrixId;
      let vdmiMatrixName;
      let vdmiMatrixStatus;

      const allowedScalarKeys = [
        'count',
        'value',
        'metric',
        'unit',
        'answer',
        'source',
        'asOf',
        'expectedStatus',
        'decisionStatus',
        'highestRole',
      ];

      const allowedArrayKeys = [
        'sources',
        'warnings',
        'roles',
        'rolesByTask',
        'peers',
        'items',
        'rows',
        'variants',
        'evidenceGaps',
        'evidenceRequirements',
        'forbiddenAssumptions',
        'nextActions',
        'assetRisks',
        'risks',
        'tasks',
      ];

      const addUnique = (target, values) => {
        if (!Array.isArray(values)) return;
        for (const value of values) {
          const key = JSON.stringify(value);
          if (!target.some((item) => JSON.stringify(item) === key)) {
            target.push(value);
          }
        }
      };

      const mergeSafeResult = (result = {}) => {
        for (const key of allowedScalarKeys) {
          if (result[key] !== undefined && result[key] !== null && result[key] !== '') {
            merged[key] = result[key];
          }
        }

        for (const key of allowedArrayKeys) {
          if (Array.isArray(result[key])) {
            if (!Array.isArray(merged[key])) {
              merged[key] = [];
            }
            addUnique(merged[key], result[key]);
          }
        }

        if (result.matrix && typeof result.matrix === 'object') {
          if (!merged.matrix || typeof merged.matrix !== 'object') {
            merged.matrix = {};
          }
          if (result.matrix.id && !merged.matrix.id) {
            merged.matrix.id = result.matrix.id;
          }
          if (result.matrix.name && !merged.matrix.name) {
            merged.matrix.name = result.matrix.name;
          }
          if (result.matrix.status && !merged.matrix.status) {
            merged.matrix.status = result.matrix.status;
          }
          if (Array.isArray(result.matrix.tasks)) {
            if (!Array.isArray(merged.matrix.tasks)) {
              merged.matrix.tasks = [];
            }
            addUnique(merged.matrix.tasks, result.matrix.tasks);
          }
        }
      };

      for (const step of execution.steps) {
        const result = step.result || {};
        mergeSafeResult(result);

        const dossier = result?.dossier;
        if (!dossier || typeof dossier !== 'object') {
          continue;
        }

        const task = dossier.task && typeof dossier.task === 'object' ? dossier.task : null;
        if (!task) {
          continue;
        }

        const taskId = task.taskId || result.taskId || `vdmi_task_${vdmiTasksById.size + 1}`;
        const existingTask = vdmiTasksById.get(taskId) || {};

        const mappedTask = {
          ...existingTask,
          taskId,
        };

        const maybeAssign = (key, value) => {
          if (value !== undefined && value !== null && value !== '') {
            mappedTask[key] = value;
          }
        };

        maybeAssign('taskName', task.taskName || task.description);
        maybeAssign('phase', task.phase);
        maybeAssign(
          'verantwortlich',
          Array.isArray(task.verantwortlich) ? task.verantwortlich : undefined
        );
        maybeAssign(
          'durchfuehrend',
          Array.isArray(task.durchfuehrend) ? task.durchfuehrend : undefined
        );
        maybeAssign('mitwirkend', Array.isArray(task.mitwirkend) ? task.mitwirkend : undefined);
        maybeAssign('information', Array.isArray(task.information) ? task.information : undefined);
        maybeAssign('expectedStatus', dossier.expectedStatus || task.expectedStatus);
        maybeAssign('decisionStatus', dossier.decisionStatus || task.decisionStatus);
        maybeAssign('roles', Array.isArray(task.roles) ? task.roles : undefined);
        maybeAssign('rolesByTask', Array.isArray(task.rolesByTask) ? task.rolesByTask : undefined);
        maybeAssign('highestRole', task.highestRole);

        const evidenceRequirements = Array.isArray(dossier?.evidence?.requirements)
          ? dossier.evidence.requirements
          : Array.isArray(task.evidenceRequirements)
            ? task.evidenceRequirements
            : undefined;
        maybeAssign('evidenceRequirements', evidenceRequirements);

        const evidenceGaps = Array.isArray(dossier.evidenceGaps)
          ? dossier.evidenceGaps
          : Array.isArray(task.evidenceGaps)
            ? task.evidenceGaps
            : undefined;
        maybeAssign('evidenceGaps', evidenceGaps);

        const forbiddenAssumptions = Array.isArray(dossier.forbiddenAssumptions)
          ? dossier.forbiddenAssumptions
          : Array.isArray(task.forbiddenAssumptions)
            ? task.forbiddenAssumptions
            : undefined;
        maybeAssign('forbiddenAssumptions', forbiddenAssumptions);

        const nextActions = Array.isArray(dossier.nextActions)
          ? dossier.nextActions
          : Array.isArray(task.nextActions)
            ? task.nextActions
            : undefined;
        maybeAssign('nextActions', nextActions);

        const taskRisks = Array.isArray(dossier.assetRisks)
          ? dossier.assetRisks
          : Array.isArray(task.assetRisks)
            ? task.assetRisks
            : undefined;
        maybeAssign('assetRisks', taskRisks);
        maybeAssign('risks', Array.isArray(dossier.risks) ? dossier.risks : task.risks);

        vdmiTasksById.set(taskId, mappedTask);

        addUnique(vdmiEvidenceGaps, evidenceGaps);
        addUnique(vdmiEvidenceRequirements, evidenceRequirements);
        addUnique(vdmiForbiddenAssumptions, forbiddenAssumptions);
        addUnique(vdmiNextActions, nextActions);
        addUnique(vdmiRisks, taskRisks || []);
        addUnique(vdmiRisks, Array.isArray(dossier.risks) ? dossier.risks : []);

        if (vdmiExpectedStatus === undefined && mappedTask.expectedStatus !== undefined) {
          vdmiExpectedStatus = mappedTask.expectedStatus;
        }
        if (vdmiDecisionStatus === undefined && mappedTask.decisionStatus !== undefined) {
          vdmiDecisionStatus = mappedTask.decisionStatus;
        }
        if (!vdmiMatrixId) {
          vdmiMatrixId = result.matrixId || task.matrixId;
        }
        if (!vdmiMatrixName) {
          vdmiMatrixName = result.matrixName || dossier.matrixName || task.matrixName;
        }
        if (!vdmiMatrixStatus) {
          vdmiMatrixStatus = result.matrixStatus || dossier.matrixStatus || task.matrixStatus;
        }
      }

      const vdmiTasks = Array.from(vdmiTasksById.values());
      if (vdmiTasks.length > 0) {
        const matrix = {
          tasks: vdmiTasks,
        };

        if (vdmiMatrixId) matrix.id = vdmiMatrixId;
        if (vdmiMatrixName) matrix.name = vdmiMatrixName;
        if (vdmiMatrixStatus) matrix.status = vdmiMatrixStatus;

        const vdmiDomainResult = {
          ...merged,
          matrix,
        };

        if (vdmiEvidenceGaps.length > 0) {
          vdmiDomainResult.evidenceGaps = vdmiEvidenceGaps;
        }
        if (vdmiEvidenceRequirements.length > 0) {
          vdmiDomainResult.evidenceRequirements = vdmiEvidenceRequirements;
        }
        if (vdmiForbiddenAssumptions.length > 0) {
          vdmiDomainResult.forbiddenAssumptions = vdmiForbiddenAssumptions;
        }
        if (vdmiNextActions.length > 0) {
          vdmiDomainResult.nextActions = vdmiNextActions;
        }
        if (vdmiRisks.length > 0) {
          vdmiDomainResult.risks = vdmiRisks;
        }
        if (vdmiExpectedStatus !== undefined) {
          vdmiDomainResult.expectedStatus = vdmiExpectedStatus;
        }
        if (vdmiDecisionStatus !== undefined) {
          vdmiDomainResult.decisionStatus = vdmiDecisionStatus;
        }

        return vdmiDomainResult;
      }

      return Object.keys(merged).length > 0 ? merged : null;
    },

    /**
     * Check if an object contains structured data fields (not just generic strings).
     */
    hasStructuredData(obj = {}) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return false;
      }

      const dossier = obj?.dossier;
      if (
        dossier &&
        typeof dossier === 'object' &&
        ((dossier.task && typeof dossier.task === 'object') ||
          Array.isArray(dossier.evidenceGaps) ||
          Array.isArray(dossier.forbiddenAssumptions) ||
          Array.isArray(dossier.nextActions))
      ) {
        return true;
      }

      const structuredKeys = [
        'matrix',
        'tasks',
        'roles',
        'rolesByTask',
        'highestRole',
        'evidenceGaps',
        'evidenceRequirements',
        'assetRisks',
        'risks',
        'items',
        'rows',
        'peers',
        'variants',
        'count',
        'value',
        'metric',
        'answer',
        'source',
        'sources',
        'asOf',
        'forbiddenAssumptions',
        'expectedStatus',
        'decisionStatus',
        'nextActions',
        'status',
      ];

      return structuredKeys.some((key) => {
        const val = obj[key];
        return val !== undefined && val !== null && val !== '';
      });
    },

    async loadUserProfile(ctx, tenantId, userId) {
      try {
        const namespace = tenantNamespace(PROFILE_NAMESPACE, tenantId);
        const doc = await ctx.call(
          'object-store.get',
          { namespace, key: userId },
          { meta: ctx.meta }
        );
        return doc?.payload || { userId, preferences: {} };
      } catch (error) {
        if (isNotFound(error)) {
          return { userId, preferences: {} };
        }
        throw error;
      }
    },

    async loadSession(ctx, tenantId, sessionId, userId, options = {}) {
      const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
      const userProfile = await this.loadUserProfile(ctx, tenantId, userId);
      const createIfMissing = Boolean(options.createIfMissing);

      try {
        const doc = await ctx.call(
          'object-store.get',
          { namespace, key: sessionId },
          { meta: ctx.meta }
        );
        const payload = doc?.payload || {};
        assertNoL4RawInPersistedState(payload);
        return {
          id: sessionId,
          tenantId,
          userId,
          chatMode: normalizeChatMode(payload?.l3?.chatMode) || CHAT_MODES.CONSULTATION,
          l1: payload.l1 || { tenantFacts: [] },
          l2: {
            ...(payload?.l2 && typeof payload.l2 === 'object' ? payload.l2 : {}),
            userProfile: {
              ...(payload?.l2?.userProfile && typeof payload.l2.userProfile === 'object'
                ? payload.l2.userProfile
                : userProfile),
              knowledgeScopeDataPoints: sanitizeScopedDatapoints(
                payload?.l2?.userProfile?.knowledgeScopeDataPoints ||
                  userProfile?.knowledgeScopeDataPoints ||
                  []
              ),
            },
          },
          l3: {
            history: Array.isArray(payload?.l3?.history) ? payload.l3.history : [],
            fileAttachments: Array.isArray(payload?.l3?.fileAttachments)
              ? payload.l3.fileAttachments
              : [],
            bootstrapContext: sanitizeBootstrapContext(payload?.l3?.bootstrapContext || null),
            knowledgeScopeDataPoints: sanitizeScopedDatapoints(
              payload?.l3?.knowledgeScopeDataPoints || []
            ),
            summary: payload?.l3?.summary || null,
            compressed: Boolean(payload?.l3?.compressed),
            chatMode: normalizeChatMode(payload?.l3?.chatMode) || CHAT_MODES.CONSULTATION,
            chatModeSource: payload?.l3?.chatModeSource || null,
            lastClassification:
              payload?.l3?.lastClassification && typeof payload.l3.lastClassification === 'object'
                ? payload.l3.lastClassification
                : null,
            consultationContext:
              payload?.l3?.consultationContext && typeof payload.l3.consultationContext === 'object'
                ? payload.l3.consultationContext
                : null,
            onboardingQuestions: Array.isArray(payload?.l3?.onboardingQuestions)
              ? payload.l3.onboardingQuestions
              : [],
            assumptions: Array.isArray(payload?.l3?.assumptions) ? payload.l3.assumptions : [],
            planStack: Array.isArray(payload?.l3?.planStack) ? payload.l3.planStack : [],
            resolvedParams:
              payload?.l3?.resolvedParams && typeof payload.l3.resolvedParams === 'object'
                ? payload.l3.resolvedParams
                : {},
            lastCompletedPlan:
              payload?.l3?.lastCompletedPlan && typeof payload.l3.lastCompletedPlan === 'object'
                ? payload.l3.lastCompletedPlan
                : null,
            stopPoint:
              payload?.l3?.stopPoint && typeof payload.l3.stopPoint === 'object'
                ? payload.l3.stopPoint
                : null,
            stateMachine:
              payload?.l3?.stateMachine && typeof payload.l3.stateMachine === 'object'
                ? payload.l3.stateMachine
                : null,
            executionStateGraph:
              payload?.l3?.executionStateGraph && typeof payload.l3.executionStateGraph === 'object'
                ? payload.l3.executionStateGraph
                : null,
            turnGraph:
              payload?.l3?.turnGraph && typeof payload.l3.turnGraph === 'object'
                ? payload.l3.turnGraph
                : null,
            activeRoutingPolicy:
              payload?.l3?.activeRoutingPolicy && typeof payload.l3.activeRoutingPolicy === 'object'
                ? payload.l3.activeRoutingPolicy
                : null,
            activeSynthesisPolicy:
              payload?.l3?.activeSynthesisPolicy &&
              typeof payload.l3.activeSynthesisPolicy === 'object'
                ? payload.l3.activeSynthesisPolicy
                : null,
            activeStickinessStartTurn:
              typeof payload?.l3?.activeStickinessStartTurn === 'number'
                ? payload.l3.activeStickinessStartTurn
                : null,
            criticalStepCheckpoints:
              payload?.l3?.criticalStepCheckpoints &&
              typeof payload.l3.criticalStepCheckpoints === 'object'
                ? payload.l3.criticalStepCheckpoints
                : {},
          },
          createdAt: payload.createdAt || new Date().toISOString(),
          updatedAt: payload.updatedAt || null,
        };
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }

        if (!createIfMissing) {
          throw new MoleculerClientError(
            `Personal-Agent session not found: ${sessionId}`,
            404,
            'OBJECT_NOT_FOUND',
            { sessionId }
          );
        }

        return {
          id: sessionId,
          tenantId,
          userId,
          chatMode: CHAT_MODES.CONSULTATION,
          l1: { tenantFacts: [] },
          l2: {
            userProfile: {
              ...userProfile,
              knowledgeScopeDataPoints: sanitizeScopedDatapoints(
                userProfile?.knowledgeScopeDataPoints || []
              ),
            },
          },
          l3: {
            history: [],
            fileAttachments: [],
            bootstrapContext: sanitizeBootstrapContext(null),
            knowledgeScopeDataPoints: sanitizeScopedDatapoints([]),
            summary: null,
            compressed: false,
            chatMode: CHAT_MODES.CONSULTATION,
            chatModeSource: null,
            lastClassification: null,
            consultationContext: null,
            onboardingQuestions: [],
            assumptions: [],
            planStack: [],
            resolvedParams: {},
            lastCompletedPlan: null,
            stopPoint: null,
            stateMachine: null,
            executionStateGraph: null,
            turnGraph: null,
            activeRoutingPolicy: null,
            activeSynthesisPolicy: null,
            activeStickinessStartTurn: null,
            criticalStepCheckpoints: {},
          },
          createdAt: new Date().toISOString(),
          updatedAt: null,
        };
      }
    },

    toPublicProactiveMessage(item = {}) {
      return {
        id: item.id || null,
        type: item.type || null,
        hitlItemId: item.hitlItemId || null,
        embedRef: item.embedRef || null,
        title: item.title || null,
        summary: item.summary || null,
        status: item.status || null,
        createdAt: item.createdAt || null,
      };
    },

    async resolvePersonaForSession(ctx, { tenantId, sessionId, personaId }) {
      if (personaId) {
        try {
          const byId = await ctx.call(
            'agent-persona.get',
            {
              tenantId,
              id: personaId,
            },
            { meta: { ...ctx.meta, tenantId, $gateway: false } }
          );
          return byId?.item || null;
        } catch (error) {
          if (
            isActionUnavailable(error) ||
            isNotFound(error) ||
            error?.type === 'PERSONA_NOT_FOUND' ||
            error?.type === 'PERSONA_TENANT_FORBIDDEN'
          ) {
            return null;
          }
          throw error;
        }
      }

      try {
        const list = await ctx.call(
          'agent-persona.list',
          { tenantId },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );
        const items = Array.isArray(list?.items) ? list.items : [];
        const match = items
          .filter((item) => item?.status === 'active')
          .find((item) => String(item?.defaultPersonalAgentSessionId || '').trim() === sessionId);
        return match || null;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async fetchPendingPersonaInboxMessages(ctx, { tenantId, personaId, sessionId, limit = 20 }) {
      let pending = [];
      try {
        const list = await ctx.call(
          'persona-inbox.listPendingForPersona',
          {
            tenantId,
            personaId,
            sessionId,
            limit,
            offset: 0,
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );
        pending = Array.isArray(list?.items) ? list.items : [];
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return [];
        }
        throw error;
      }

      const ids = pending.map((item) => item?.id).filter(Boolean);
      if (ids.length === 0) return [];

      try {
        const visible = await ctx.call(
          'persona-inbox.markVisible',
          {
            tenantId,
            ids,
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );
        const updated = Array.isArray(visible?.items) ? visible.items : [];
        return updated.length > 0 ? updated : pending;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return pending;
        }
        throw error;
      }
    },

    async persistSession(ctx, tenantId, sessionId, payload) {
      const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
      try {
        await ctx.call(
          'object-store.put',
          { namespace, key: sessionId, payload },
          { meta: ctx.meta }
        );
      } catch (error) {
        throw new MoleculerClientError(
          `Unable to persist personal-agent session: ${error.message}`,
          500,
          'PERSONAL_AGENT_PERSIST_FAILED'
        );
      }
    },
  },
};
