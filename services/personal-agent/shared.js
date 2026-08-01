'use strict';

// Shared requires/constants/helpers used across personal-agent's action/method chunk files.
// Extracted verbatim from the original services/personal-agent.service.js preamble as part
// of the v0.99 file-size modularization (same moleculer service name/action namespace).
// This is itself large (mirrors the original file's own large preamble) because personal-agent
// is a big, deterministic consultation/routing engine with many small pure helper functions;
// splitting further would require call-graph analysis between these helpers, which was judged
// too risky to attempt mechanically for this safety-critical service.

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const jobStore = require('../../src/job-store');
const { getTenantId, tenantNamespace } = require('../../src/tenant-context');
const { hasMakoEdifactCodeContextSignal } = require('../../src/mako-edifact-signal');
const {
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
  assertNoL4RawInPersistedState,
  resolveContextMutation,
  buildDecisionFrameDirectives,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
} = require('../../src/personal-agent-context');
const {
  PERSONAL_AGENT_STATES,
  createStateMachine,
  transitionStateMachine,
  deriveTerminalState,
  summarizeStateMachine,
} = require('../../src/personal-agent-state-machine');
const {
  createExecutionStateGraph,
  advanceExecutionStateGraph,
  summarizeExecutionStateGraph,
  createMessageFingerprint,
} = require('../../src/personal-agent-execution-state-graph');
const {
  createTurnGraph,
  addNode,
  addEdge,
  finalizeTurnGraph,
  summarizeTurnGraph,
  addWorkflowPlanNode,
} = require('../../src/personal-agent-turn-graph');
const {
  buildConsultationExecutionPlan,
  executeWithReceipt,
  EXECUTION_READINESS,
} = require('../../src/consultation-execution-bridge');
const {
  extractAvailableInputs,
  isInputAlreadyProvided,
} = require('../../src/consultation-input-extractor');
const { validateRoutingIntent } = require('../../src/consultation-routing-guardrails');
const { decideRoutingTarget } = require('../../src/personal-agent-routing-graph');
const { buildExecutionGapResponse } = require('../../src/mark-execution-gap');
const { createExecutionTrace } = require('../../src/execution-trace');
const { createToolCallTracker } = require('../../src/tool-call-tracker');
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
} = require('../../src/personal-agent-routing');
const {
  shouldBlockSynthesisOnGaps,
  buildEvidenceGapPresentation,
} = require('../../src/evidence-planner');
const {
  extractSourceActions,
  evaluatePresentationGrounding,
} = require('../../src/receipt-grounded-presentation-contract');
const {
  queryKnowledgeOrientation: queryKnowledgeOrientationAdapter,
  queryKnowledgeEvidence: queryKnowledgeEvidenceAdapter,
} = require('../../src/personal-agent-knowledge-rag');
const {
  scheduleDream,
  cancelDream,
  isDreamPending,
  runDreamPipeline,
  DREAM_AUDIT_NAMESPACE,
} = require('../../src/personal-agent-dreamer');
const {
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
  ONBOARDING_PARAM_ALTERNATIVES,
} = require('../../src/personal-agent-onboarding');
const {
  buildResponseStrategy: buildPersonalAgentResponseStrategy,
  buildStrategyLead: buildPersonalAgentStrategyLead,
} = require('../../src/personal-agent-response-strategy');
const {
  buildGroundedReceiptReply: buildGroundedReceiptReplyAdapter,
} = require('../../src/ev-co2-synthesis');
const { GRID_CONCEPTS, ENERGY_CONCEPTS, UNITS } = require('../../src/oeo-mappings');
const {
  extractBlueprintPolicy,
  checkStickinessRetain,
  buildSynthesisPolicyDirectives,
} = require('../../src/blueprint-policy-interpreter');
const { detectBlueprintIntent, findBlueprintByPrimaryIntent } = require('../../src/l3-broker');
const { loadBlueprint } = require('../../src/blueprint-registry');
const {
  compileReadOnlyExecutionPlan,
  describeNoPlanReason,
  buildAskBlueprintAnswer,
} = require('../../src/blueprint-rest-plan-compiler');
const { findClarificationPolicyMatch } = require('../../src/clarification-policy-registry');
const {
  resolveLocationFromText,
  buildLocationContextPatch,
  buildLocationResolutionTrace,
  classifyMarketPartnerRole,
} = require('../../src/location-resolution');
const {
  generateText: llmGenerateText,
  generateStructured: llmGenerateStructured,
} = require('../../src/llm-client');
const {
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  ocrExtractImage,
  extractDocumentText,
  readTextContent,
  injectFileIntoL3,
} = require('../../src/personal-agent-file-handler');
const { executeToolWithRetry } = require('../../src/consultation-tool-resolver');
const {
  pushPlanFrame,
  markTopFrameCompleted,
  findResumableParentFrame,
  resumeParentPlanFrame,
  mergeResolvedParamsIntoPlan,
  hasRecentIntentLoop,
  assertNoRecentIntentLoop,
} = require('../../src/session-manager');
const { buildZnpContextSnapshot } = require('../../src/znp-context-snapshot'); // v0.56.3
const {
  WORK_LOG_ACTIONS,
  createTurnWorkLog,
  getSafePersonaLabel,
} = require('../../src/personal-agent-work-log'); // v0.57.3
const {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildContextFieldWorkOutLoudPayload,
} = require('../../src/personal-agent-work-out-loud');
const {
  REFLECTION_OUTPUT_SCHEMA,
  buildReflectionPrompt,
  validateReflectionPatch,
  hasScopeBlockedOrMissingSteps,
} = require('../../src/personal-agent-reflection'); // v0.57.5 #158
const {
  DOSSIER_USER_CONTEXT,
  DOSSIER_PROCESS_STAGE,
  DOSSIER_ANSWER_MODE,
  DOSSIER_CONFIDENCE,
  DOSSIER_COMPLETION_STATE,
  computeTimeBudget,
  classifyDossierContext,
  buildDossierMarkdown,
  buildRendererSystemHint,
  normalizeKnowledgeSpaceContext,
  buildReasoningSummary,
  buildFollowUpMetadata,
  generateDossierId,
  resolveDossierSubstantiveAnswer,
  resolveDossierContract,
  describeDossierContract,
  buildSlimDossierMarkdown,
} = require('../../src/answer-dossier-builder'); // v0.63.0 #220
const {
  getRule: getDossierHydrationRule,
  isSafetyRejectedAction: isDossierRuleSafetyRejected,
} = require('../../src/dossier-hydration-registry'); // v0.63.x #234

const OPENAPI_TAG = 'Personal Agent';
const SESSION_NAMESPACE = process.env.PERSONAL_AGENT_SESSION_NAMESPACE || 'personal_agent_sessions';
const DOSSIER_LOW_EVIDENCE_NAMESPACE = 'answer_dossier_low_evidence';
const PROFILE_NAMESPACE =
  process.env.PERSONAL_AGENT_PROFILE_NAMESPACE || 'personal_agent_user_profiles';
const DEFAULT_SYSTEM_PROMPT =
  process.env.PERSONAL_AGENT_SYSTEM_PROMPT ||
  'Du bist der Cernion Personal Agent. Arbeite deterministisch, knapp und fachlich korrekt.';

function uniqueStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter((v) => typeof v === 'string' && v.trim())
        .map((v) => v.trim())
    ),
  ];
}

function normalizeBrokerCapabilityNames(recommendedCapabilities = []) {
  if (!Array.isArray(recommendedCapabilities)) return [];
  return recommendedCapabilities
    .map((capability) => {
      if (typeof capability === 'string') return capability;
      return capability?.capability || capability?.id || capability?.name || null;
    })
    .filter(Boolean);
}

function buildDossierPlanningFollowUps(missingInputs = []) {
  return uniqueStrings(missingInputs).map((input) => ({
    missingDataPoint: input,
    question: `Welchen Wert oder Beleg können Sie für "${input}" liefern?`,
    enablesDossierAddition: `Mit "${input}" kann das Dossier die broker-empfohlene Planung fachlich präziser einordnen.`,
    source: 'capability_broker_missing_input',
  }));
}

function buildDossierSafePlanningView({
  capabilityRouting = null,
  userProvidedFacts = [],
  dossierTask = '',
} = {}) {
  if (capabilityRouting?.status !== 'success' || !capabilityRouting.result) {
    return {
      status: capabilityRouting?.status || 'unavailable',
      route: null,
      actions: [],
      hydrationCandidates: [],
      requiredInputs: [],
      optionalInputs: [],
      missingInputs: [],
      followUps: [],
      executionPolicy: {
        mode: 'planning_only',
        noExecution: true,
        consequentialActionsBlocked: true,
      },
    };
  }

  const result = capabilityRouting.result;
  const planActions = Array.isArray(result.recommendedPlan)
    ? result.recommendedPlan
        .map((step, index) => ({
          action: step?.action,
          step: step?.step || index + 1,
          purpose: step?.purpose || null,
          source: 'recommendedPlan',
        }))
        .filter((entry) => typeof entry.action === 'string' && entry.action.trim())
    : [];
  const capabilityActions = Array.isArray(result.recommendedCapabilities)
    ? result.recommendedCapabilities.flatMap((capability) =>
        Array.isArray(capability?.actions)
          ? capability.actions.map((action) => ({
              action,
              source: 'recommendedCapabilities',
              capability: capability.capability || capability.id || null,
            }))
          : []
      )
    : [];
  const preferredActions = Array.isArray(result.preferredActions)
    ? result.preferredActions.map((action) => ({ action, source: 'preferredActions' }))
    : [];
  const fallbackActions = Array.isArray(result.fallbackActions)
    ? result.fallbackActions.map((action) => ({ action, source: 'fallbackActions' }))
    : [];

  const actionsByName = new Map();
  [...planActions, ...capabilityActions, ...preferredActions, ...fallbackActions].forEach(
    (entry) => {
      if (typeof entry.action !== 'string' || !entry.action.trim()) return;
      const action = entry.action.trim();
      const existing = actionsByName.get(action) || {
        action,
        sources: [],
        step: entry.step || null,
        purpose: entry.purpose || null,
        capability: entry.capability || null,
      };
      if (!existing.sources.includes(entry.source)) existing.sources.push(entry.source);
      if (!existing.step && entry.step) existing.step = entry.step;
      if (!existing.purpose && entry.purpose) existing.purpose = entry.purpose;
      if (!existing.capability && entry.capability) existing.capability = entry.capability;
      actionsByName.set(action, existing);
    }
  );

  const actions = Array.from(actionsByName.values()).map((entry) => {
    const hydrationRule = getDossierHydrationRule(entry.action);
    const unsafe = isDossierRuleSafetyRejected(entry.action);
    const params = hydrationRule
      ? hydrationRule.extractParams(userProvidedFacts, dossierTask)
      : null;
    return {
      ...entry,
      safety: hydrationRule
        ? {
            readOnly: true,
            nonConsequential: true,
            hitlRequired: false,
            allowsMutation: false,
          }
        : {
            readOnly: false,
            nonConsequential: false,
            hitlRequired: null,
            allowsMutation: null,
          },
      hydration: {
        allowed: Boolean(hydrationRule),
        status: hydrationRule
          ? params
            ? 'ready'
            : 'missing_params'
          : unsafe
            ? 'unsafe'
            : 'no_rule',
        ruleId: hydrationRule?.id || null,
        evidenceQuality: hydrationRule?.evidenceQuality || null,
        paramsReady: Boolean(params),
      },
    };
  });

  const requiredInputs = uniqueStrings(result.requiredInputs || []);
  const missingInputs = uniqueStrings(result.missingInputs || []);
  const optionalInputs = uniqueStrings(result.optionalInputs || result.suggestedInputs || []);

  return {
    status: 'success',
    route: {
      intent: result.intent || null,
      capability: result.capability || null,
      domain: result.domain || null,
      confidence: typeof result.confidence === 'number' ? result.confidence : null,
      recommendedCapabilities: normalizeBrokerCapabilityNames(result.recommendedCapabilities),
    },
    actions,
    hydrationCandidates: actions.filter((action) => action.hydration.allowed),
    requiredInputs,
    optionalInputs,
    missingInputs,
    followUps: buildDossierPlanningFollowUps(missingInputs),
    executionPolicy: {
      mode: 'planning_only',
      noExecution: true,
      consequentialActionsBlocked: true,
    },
  };
}

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
const COPILOT_KNOWLEDGE_TIMEOUT_MS = Number(process.env.COPILOT_KNOWLEDGE_TIMEOUT_MS || 8000);
const COPILOT_DATAPOINT_TIMEOUT_MS = Number(process.env.COPILOT_DATAPOINT_TIMEOUT_MS || 2500);
const COPILOT_OBJECT_STORE_TIMEOUT_MS = Number(process.env.COPILOT_OBJECT_STORE_TIMEOUT_MS || 2500);
const COPILOT_CONSULTING_BRIEF_TIMEOUT_MS = Number(
  process.env.COPILOT_CONSULTING_BRIEF_TIMEOUT_MS || 6000
);
const COPILOT_OBJECT_STORE_MAX_NAMESPACES = Number(
  process.env.COPILOT_OBJECT_STORE_MAX_NAMESPACES || 10
);
const COPILOT_DEFAULT_OBJECT_NAMESPACES = Object.freeze([
  'cya_sessions',
  'cya_profiles',
  'finance_agent_memory',
  'copilot_context',
  'process_context',
  'evidence',
  'znp_projects',
  'vdmi_context',
]);
const DOSSIER_TIMEOUT_WARNING_THRESHOLD_MS = 25000; // v0.63.0 #220
const DOSSIER_SESSION_NAMESPACE = 'dossier'; // v0.63.0 #220

function toIsoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function extractDossierHydrationDateRange(question = '') {
  const text = String(question || '').toLowerCase();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/mittwoch.*freitag|wednesday.*friday/.test(text)) {
    const day = start.getUTCDay();
    const daysUntilWednesday = (3 - day + 7) % 7 || 7;
    const from = new Date(start);
    from.setUTCDate(start.getUTCDate() + daysUntilWednesday);
    const to = new Date(from);
    to.setUTCDate(from.getUTCDate() + 2);
    return { dateFrom: toIsoDateOnly(from), dateTo: toIsoDateOnly(to) };
  }
  const to = new Date(start);
  to.setUTCDate(start.getUTCDate() + (/72h|72 h|72-hour|72 hour/.test(text) ? 2 : 1));
  return { dateFrom: toIsoDateOnly(start), dateTo: toIsoDateOnly(to) };
}

function formatEntsoeEvidence(result, label) {
  if (!result || typeof result !== 'object') return null;
  const data = result.data || result;
  const stats = data.statistics || result.statistics || {};
  const points =
    data.dataPoints ||
    result.dataPoints ||
    data.forecasts ||
    result.forecasts ||
    data.loadForecast ||
    result.loadForecast ||
    data.prices ||
    result.prices ||
    [];
  const first = Array.isArray(points) ? points[0] : null;
  const parts = [];
  const region = data.region || result.region;
  const eic = data.eicCode || result.eicCode;
  const avg =
    stats.average ??
    stats.avg ??
    stats.avgLoadMW ??
    stats.avgForecastMW ??
    stats.avgPriceEURperMWh ??
    stats.averagePriceEURperMWh;
  const max = stats.max ?? stats.maxLoadMW ?? stats.maxForecastMW ?? stats.maxPriceEURperMWh;
  const min = stats.min ?? stats.minLoadMW ?? stats.minForecastMW ?? stats.minPriceEURperMWh;
  const firstValue =
    first?.value ??
    first?.load ??
    first?.loadMW ??
    first?.total ??
    first?.priceEURperMWh ??
    first?.price;
  if (region) parts.push(`Region: ${String(region).slice(0, 80)}`);
  if (eic) parts.push(`EIC: ${String(eic).slice(0, 40)}`);
  if (avg != null) parts.push(`${label} Durchschnitt: ${Number(avg).toFixed(1)}`);
  if (max != null) parts.push(`${label} Max: ${Number(max).toFixed(1)}`);
  if (min != null) parts.push(`${label} Min: ${Number(min).toFixed(1)}`);
  if (firstValue != null) parts.push(`${label} erster Wert: ${Number(firstValue).toFixed(1)}`);
  if (Array.isArray(points)) parts.push(`Datenpunkte: ${points.length}`);
  const source = data.metadata?.source || result.metadata?.source;
  if (source) parts.push(`Quelle: ${String(source).slice(0, 100)}`);
  return parts.length ? parts.join(' · ') : null;
}

function isNotFound(error) {
  return error?.code === 404 || error?.type === 'OBJECT_NOT_FOUND';
}

function buildSessionNotFoundError(sessionId) {
  return new MoleculerClientError(
    `Personal-Agent session not found: ${sessionId}`,
    404,
    'OBJECT_NOT_FOUND',
    { sessionId }
  );
}

function listAuthValues(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function hasFullAccessPrincipal(ctx) {
  const meta = ctx?.meta || {};
  const authUser = meta.authUser && typeof meta.authUser === 'object' ? meta.authUser : {};
  const apiToken = meta.apiToken && typeof meta.apiToken === 'object' ? meta.apiToken : {};
  const values = listAuthValues(
    authUser.roles,
    meta.roles,
    apiToken.scopes,
    apiToken.scope,
    meta.scopes
  );
  return values.includes('full-access') || values.includes('cross-tenant-admin');
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

function compactString(value, maxLength = 800) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function toCopilotList(value, mapper = (entry) => entry, maxItems = 8) {
  if (!Array.isArray(value)) return [];
  return value.map(mapper).filter(Boolean).slice(0, maxItems);
}

function normalizeCopilotArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function isCopilotEnergySharingQuestion(question) {
  const text = String(question || '').toLowerCase();
  return (
    /energy\s*sharing|energiesharing|mieterstrom|gemeinschaftliche\s+geb[aä]udeversorgung|gemeinschaftliche\s+erzeugung/.test(
      text
    ) ||
    /strom.*(?:nachbar|teilen|weitergeben|liefern)|(?:nachbar|teilen|weitergeben|liefern).*strom/.test(
      text
    ) ||
    /pv.*(?:nachbar|teilen|weitergeben|liefern)|(?:nachbar|teilen|weitergeben|liefern).*pv/.test(
      text
    )
  );
}

/**
 * Generic MaKo/EDIFACT code-context signal (energychain/cernion-energy-tools#498).
 * Deliberately generic — no Z17-only special case; Z17 is used only as an
 * acceptance-test example for this generic routing.
 */
function isCopilotMakoEdifactQuestion(question) {
  return hasMakoEdifactCodeContextSignal(question);
}

function extractCopilotAnalysisSignals(question) {
  const text = String(question || '');
  const lower = text.toLowerCase();
  const postalCode = text.match(/\b\d{5}\b/)?.[0] || null;
  const powerMatch = text.match(/\b(\d+(?:[,.]\d+)?)\s*(mw|megawatt|kw|kilowatt)\b/i);
  const power = powerMatch
    ? {
        value: Number(String(powerMatch[1]).replace(',', '.')),
        unit: powerMatch[2].toLowerCase().startsWith('k') ? 'kW' : 'MW',
      }
    : null;
  const assetClass = /rechenzentrum|data\s*center|datacenter/i.test(lower)
    ? 'data_center'
    : /speicher|bess|batterie/i.test(lower)
      ? 'battery_storage'
      : /pv|photovoltaik|solar/i.test(lower)
        ? 'solar'
        : null;

  const perspectives = [];
  if (postalCode) perspectives.push('Standort-/PLZ-Auflösung');
  if (assetClass === 'data_center' || power)
    perspectives.push('Netzanschluss und Anschlussleistung');
  if (assetClass) perspectives.push('Asset-spezifische Genehmigungs- und Prozesssicht');
  if (assetClass === 'data_center') {
    perspectives.push(
      'VNB-Zuständigkeit, Netzkapazität, Lastprofil und ggf. Abwärme/Planungsrecht'
    );
  }

  return {
    postalCode,
    power,
    assetClass,
    perspectives,
    active: Boolean(postalCode || power || assetClass),
  };
}

function extractCopilotLocationLabelFromText(value, postalCode) {
  const text = compactString(value, 260);
  if (!text || !postalCode || !text.includes(postalCode)) return null;
  const afterPostal = text.match(
    new RegExp(
      `\\b${postalCode}\\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+(?:\\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+){0,2})`
    )
  );
  if (afterPostal) return `${postalCode} ${afterPostal[1].trim()}`;
  return null;
}

function extractCopilotLocationLabelFromObject(entry, postalCode) {
  if (!entry || typeof entry !== 'object') return null;
  const directCity =
    entry.gemeinde ||
    entry.Gemeinde ||
    entry.ort ||
    entry.Ort ||
    entry.city ||
    entry.municipality ||
    entry.locationName;
  if (postalCode && directCity) return `${postalCode} ${compactString(directCity, 80)}`;
  return extractCopilotLocationLabelFromText(
    [entry.title, entry.subtitle, entry.name, entry.location].filter(Boolean).join(' · '),
    postalCode
  );
}

function deriveCopilotSearchTerm(question) {
  const text = compactString(question, 200);
  if (isCopilotEnergySharingQuestion(text)) {
    return 'Energy Sharing §42c EnWG Mieterstrom gemeinschaftliche Gebäudeversorgung Stromlieferung an Dritte PV Nachbar';
  }
  const signals = extractCopilotAnalysisSignals(text);
  if (signals.assetClass === 'data_center') {
    return compactString(
      [
        'Rechenzentrum Netzanschluss Anschlussleistung Netzkapazität VNB Genehmigung Planung',
        signals.power ? `${signals.power.value} ${signals.power.unit}` : null,
        signals.postalCode ? `PLZ ${signals.postalCode}` : null,
      ]
        .filter(Boolean)
        .join(' '),
      260
    );
  }
  const locationMatch = text.match(
    /\b(?:in|für|fuer|bei)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}){0,2})/
  );
  if (locationMatch) return locationMatch[1].trim();
  return text;
}

function mapCopilotDomainToSearchDomain(domain) {
  const normalized = String(domain || 'auto');
  if (normalized === 'auto' || normalized === 'process' || normalized === 'finance') return 'all';
  if (normalized === 'grid-connection') return 'grid_connection';
  return normalized;
}

function buildCopilotContextQueries({ question, searchTerm, context = {}, maxItems = 5 }) {
  const explicit = normalizeCopilotArray(context.datapointTags || context.tags);
  const domainHints = normalizeCopilotArray(context.domains);
  const baseTerms = [searchTerm, question, ...explicit, ...domainHints]
    .map((entry) => compactString(entry, 160))
    .filter(Boolean);
  const tokens = baseTerms
    .flatMap((entry) => String(entry).split(/[^A-Za-zÄÖÜäöüß0-9_-]+/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 4);
  return Array.from(new Set([...baseTerms, ...tokens])).slice(
    0,
    Math.max(1, Math.min(maxItems * 3, 16))
  );
}

function objectLooksRelevantToCopilot(doc, queryTerms = []) {
  const haystack = compactString(JSON.stringify(doc || {}), 3000).toLowerCase();
  if (!haystack) return false;
  return queryTerms.some((term) => {
    const normalized = String(term || '')
      .toLowerCase()
      .trim();
    return normalized.length >= 3 && haystack.includes(normalized);
  });
}

function datapointLooksRelevantToCopilot(datapoint, queryTerms = []) {
  const haystack = [
    datapoint?.name,
    datapoint?.description,
    ...(Array.isArray(datapoint?.tags) ? datapoint.tags : []),
    datapoint?.sourceType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!haystack) return false;
  return queryTerms.some((term) => {
    const normalized = String(term || '')
      .toLowerCase()
      .trim();
    return normalized.length >= 3 && haystack.includes(normalized);
  });
}

function normalizeCopilotObjectNamespaces(context = {}) {
  const configured = normalizeCopilotArray(
    context.objectNamespaces || context.objectStoreNamespaces
  );
  const namespaces = configured.length > 0 ? configured : COPILOT_DEFAULT_OBJECT_NAMESPACES;
  return Array.from(new Set(namespaces))
    .filter((ns) => /^[a-z][a-z0-9_]*(:[a-z0-9_-]+)*$/.test(ns))
    .slice(0, Math.max(1, COPILOT_OBJECT_STORE_MAX_NAMESPACES));
}

function cleanCopilotEvidenceValue(value) {
  return compactString(value, 500)
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^Score:\s*\d/i.test(part))
    .filter((part) => !/^Knowledge hit$/i.test(part))
    .join(' · ');
}

function copilotKnowledgeHitIsAllowedForQuery(hit = {}, query = '') {
  const haystack = [hit.source, hit.summary, hit.retrievalHint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const normalizedQuery = String(query || '').toLowerCase();

  const containsStromdaoContext = /\bstromdao\b|stromdao\s+netze/.test(haystack);
  if (containsStromdaoContext && !/\bstromdao\b|stromdao\s+netze/.test(normalizedQuery))
    return false;

  const containsLocalCapacityAnchor = /\b81\s*mva\b/.test(haystack);
  if (containsLocalCapacityAnchor && !/\b81\s*mva\b/.test(normalizedQuery)) return false;

  const containsCouplingPoint =
    /kopplungspunkt/.test(haystack) && (containsLocalCapacityAnchor || containsStromdaoContext);
  if (containsCouplingPoint && !/kopplungspunkt/.test(normalizedQuery)) return false;

  return true;
}

const COPILOT_RELEVANCE_STOPWORDS = new Set([
  'anschlussleistung',
  'asset',
  'built',
  'cernion',
  'daten',
  'evidence',
  'genehmigung',
  'kontext',
  'leistung',
  'netzkapazität',
  'netzkapazitaet',
  'planung',
  'prozess',
  'pruefung',
  'prüfung',
  'relevante',
  'search',
  'standort',
  'treffer',
]);

function copilotQueryRequiresStrictEvidenceRelevance(query = '') {
  const text = String(query || '').toLowerCase();
  return (
    /\b\d{5}\b/.test(text) ||
    /\b\d+(?:[,.]\d+)?\s*(?:mw|megawatt)\b/.test(text) ||
    /rechenzentrum|data\s*center|datacenter/.test(text)
  );
}

function normalizeCopilotRelevanceTerm(term) {
  const normalized = String(term || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .trim();
  if (normalized.startsWith('rechenzentrum') || normalized.startsWith('rechenzentren')) {
    return 'rechenzentr';
  }
  if (normalized.startsWith('netzanschluss')) return 'netzanschluss';
  return normalized.replace(/(?:innen|ungen|keit|heiten|en|er|e|s)$/i, '');
}

function buildCopilotStrictEvidenceTerms(query = '') {
  const rawTerms = compactString(query, 700)
    .split(/[^A-Za-zÄÖÜäöüß0-9_-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 5)
    .filter((term) => !COPILOT_RELEVANCE_STOPWORDS.has(term.toLowerCase()));
  const normalizedTerms = rawTerms
    .map(normalizeCopilotRelevanceTerm)
    .filter((term) => term.length >= 5)
    .filter((term) => !COPILOT_RELEVANCE_STOPWORDS.has(term));
  return Array.from(new Set(normalizedTerms)).slice(0, 10);
}

function normalizeCopilotSearchableText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function copilotKnowledgeHitHasStrictQueryRelevance(hit = {}, query = '') {
  if (!copilotQueryRequiresStrictEvidenceRelevance(query)) return true;
  const terms = buildCopilotStrictEvidenceTerms(query);
  if (terms.length === 0) return true;
  const haystack = normalizeCopilotSearchableText(
    [hit.summary, hit.retrievalHint, hit.source, hit.documentType].filter(Boolean).join(' ')
  );
  const queryAsksForDataCenter = /rechenzentrum|rechenzentren|data\s*center|datacenter/i.test(
    query
  );
  if (queryAsksForDataCenter && !/rechenzentr|data\s*center|datacenter/i.test(haystack)) {
    return false;
  }
  return terms.some((term) => haystack.includes(term));
}

function copilotDossierEvidenceHasStrictQueryRelevance(entry = {}, query = '') {
  const evidenceText = normalizeCopilotSearchableText(
    [entry.source, entry.value, entry.retrievalHint, entry.metadata?.documentType]
      .filter(Boolean)
      .join(' ')
  );
  if (
    /anonymisierte\s+ableitung/.test(evidenceText) &&
    /llm\s+generator|steuerimpuls/.test(evidenceText)
  ) {
    return false;
  }
  if (String(entry?.metadata?.kind || '').startsWith('user_provided_')) {
    return dossierLowEvidenceMatchesProjectScope(entry, query);
  }
  if (!copilotQueryRequiresStrictEvidenceRelevance(query)) return true;
  return copilotKnowledgeHitHasStrictQueryRelevance(
    {
      source: entry.source,
      summary: entry.value,
      retrievalHint: entry.retrievalHint,
      documentType: entry.metadata?.documentType,
    },
    query
  );
}

function hashDossierLowEvidence(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

function buildDossierLowEvidenceKey(fact = {}) {
  return `dossier-low:${hashDossierLowEvidence([fact.projectScope?.scopeKey, fact.factType, fact.normalizedValue || fact.value].filter(Boolean).join('|'))}`;
}

function detectDossierPreliminaryAnswerRequest(question = '') {
  const text = normalizeCopilotSearchableText(question);
  return (
    /(?:trotz|auch wenn|obwohl).{0,80}(?:low evidence|niedriger evidence|geringer evidence|fehlender evidence|unvalidiert|nicht validiert)/.test(
      text
    ) ||
    /(?:vorlaeufige|vorlaeufigen|vorläufige|vorläufigen|indikative|indikativ|hypothetische|hypothetisch).{0,80}(?:aussage|einschaetzung|einschätzung|bewertung|einordnung)/.test(
      text
    ) ||
    /(?:arbeite|bewerte|schaetze|schätze).{0,80}(?:mit|auf basis).{0,80}(?:low evidence|nutzerangaben|annahmen|arbeitshypothese)/.test(
      text
    )
  );
}

function detectDossierFinalAnswerRequest(question = '') {
  const text = normalizeCopilotSearchableText(question);
  return (
    /finale[ns]?\s+dossier/.test(text) ||
    /abschliessende[n]?\s+fassung/.test(text) ||
    /ohne\s+rueckfragen?/.test(text) ||
    /bestmoeglich\w*\s+finale[n]?\s+(?:einschaetzung|bewertung|antwort)/.test(text) ||
    /formuliere\s+final\b.{0,80}vorhandenen\s+informationen/.test(text)
  );
}

function buildDossierTurnSummary({
  question = '',
  dossierContext = {},
  evidence = [],
  missingEvidence = [],
  reasoningSummary = '',
  capabilityRouting = null,
} = {}) {
  const parts = [];
  const state = [
    dossierContext.userContext,
    dossierContext.processStage,
    dossierContext.answerMode,
    dossierContext.confidence ? `confidence=${dossierContext.confidence}` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  if (state) parts.push(`State: ${state}.`);
  if (reasoningSummary) parts.push(`Reasoning: ${compactString(reasoningSummary, 320)}.`);

  const evidencePreview = evidence
    .slice(0, 3)
    .map((entry) => compactString([entry?.source, entry?.value].filter(Boolean).join(': '), 220))
    .filter(Boolean);
  if (evidencePreview.length > 0) {
    parts.push(`Known evidence: ${evidencePreview.join(' | ')}.`);
  }

  const missingPreview = missingEvidence
    .slice(0, 3)
    .map((entry) => compactString(entry, 220))
    .filter(Boolean);
  if (missingPreview.length > 0) {
    parts.push(`Missing evidence / Rueckfragebedarf: ${missingPreview.join(' | ')}.`);
  }

  const brokerIntent =
    capabilityRouting?.result?.intent || capabilityRouting?.result?.capability || null;
  if (capabilityRouting?.status === 'success' && brokerIntent) {
    parts.push(`Broker: ${brokerIntent}.`);
  }

  if (parts.length === 0 && question) {
    parts.push(`Nutzerfrage: ${compactString(question, 300)}.`);
  }

  return compactString(parts.join(' '), 1200);
}

function buildDossierPriorConversationContext(priorTurns = [], priorDossierState = {}) {
  const turns = (Array.isArray(priorTurns) ? priorTurns : [])
    .slice(-5)
    .map((turn) => ({
      dossierVersion: turn?.dossierVersion || null,
      question: compactString(turn?.question || '', 350),
      dossierSummary: compactString(turn?.dossierSummary || '', 700),
      userContext: turn?.userContext || null,
      processStage: turn?.processStage || null,
      answerMode: turn?.answerMode || null,
    }))
    .filter((turn) => turn.question || turn.dossierSummary);

  const knownEvidence = Array.isArray(priorDossierState?.knownEvidence)
    ? priorDossierState.knownEvidence
        .map((entry) =>
          compactString([entry?.source, entry?.value].filter(Boolean).join(': '), 300)
        )
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const missingEvidence = Array.isArray(priorDossierState?.missingEvidence)
    ? priorDossierState.missingEvidence
        .map((entry) => compactString(entry, 260))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const latestTurn = turns[turns.length - 1] || null;
  const summaryParts = [];
  if (latestTurn?.question) summaryParts.push(`Letzte Nutzerfrage: ${latestTurn.question}.`);
  if (latestTurn?.dossierSummary)
    summaryParts.push(`Letzter Dossier-Kontext: ${latestTurn.dossierSummary}.`);
  if (missingEvidence.length > 0)
    summaryParts.push(`Offene Rueckfragen/Evidence: ${missingEvidence.join(' | ')}.`);

  return {
    summary: compactString(summaryParts.join(' '), 1000),
    turns,
    knownEvidence,
    missingEvidence,
  };
}

function detectDossierEvCo2ChargingRequest(text = '') {
  const haystack = String(text || '').toLowerCase();
  const hasChargingIntent =
    /\b(?:ev|e-?auto|elektroauto|wallbox|laden|ladezeit|ladung|charging)\b/i.test(haystack);
  const hasCarbonIntent =
    /(?:\b(?:co2|kohlenstoff|emission|emissions|grünstrom|gruenstrom|gsi|strommix|klima)\b|co₂)/i.test(
      haystack
    );
  return hasChargingIntent && hasCarbonIntent;
}

function parseDossierRequestedChargingHours(text = '') {
  const match =
    String(text || '').match(
      /\b(?:beste[nr]?|optimal(?:e|en)?)\s+(\d{1,2})\s*(?:h|std\.?|stunden?)\b/i
    ) || String(text || '').match(/\b(\d{1,2})\s*(?:h|std\.?|stunden?)\b/i);
  const hours = Number(match?.[1] || 0);
  if (Number.isFinite(hours) && hours >= 1 && hours <= 12) return hours;
  return 3;
}

function extractDossierCo2ForecastPoints(result = {}) {
  const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const extractValue = (item) => {
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object') return null;
    const value =
      item.gCO2eqPerKWh ??
      item.gco2eqPerKWh ??
      item.gco2eq_kwh ??
      item.gCO2eq_kWh ??
      item.co2_intensity_gco2eq_kwh ??
      item.co2gPerKWh ??
      item.avgCo2gPerKWh ??
      item.value ??
      null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const baseTimestamp = result?.data?.timestamp || result?.timestamp || result?.generatedAt || null;
  const baseDate = parseDate(baseTimestamp);
  const forecasts = [
    result?.data?.forecast,
    result?.forecast,
    result?.data?.forecast_next_24h_gco2eq_kwh,
    result?.forecast_next_24h_gco2eq_kwh,
    result?.data?.forecastNext24h,
    result?.forecastNext24h,
  ].filter(Array.isArray);
  const points = [];
  forecasts.forEach((forecast) => {
    forecast.forEach((item, index) => {
      const value = extractValue(item);
      if (value == null) return;
      const timestamp =
        item && typeof item === 'object'
          ? item.timestamp || item.time || item.validFrom || item.from || item.start || null
          : null;
      const start =
        parseDate(timestamp) ||
        (baseDate ? new Date(baseDate.getTime() + index * 60 * 60 * 1000) : null);
      if (!start) return;
      points.push({ start, value });
    });
  });
  return points.sort((left, right) => left.start.getTime() - right.start.getTime());
}

function formatDossierBerlinWindow(start, end) {
  const format = (date) => {
    const parts = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    return {
      date: `${parts.day}.${parts.month}.${parts.year}`,
      time: `${parts.hour}:${parts.minute}`,
    };
  };
  const startParts = format(start);
  const endParts = format(end);
  const dateSuffix =
    startParts.date === endParts.date
      ? ` (${startParts.date})`
      : ` (${startParts.date}-${endParts.date})`;
  return `${startParts.time}-${endParts.time} Europe/Berlin${dateSuffix}`;
}

function formatDossierBerlinDateKey(date) {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function filterDossierChargingPointsByRequestedDay(
  points = [],
  rawResult = {},
  text = '',
  hours = 3
) {
  const normalized = normalizeCopilotSearchableText(text);
  const dayOffset = /\bmorgen\b/.test(normalized) ? 1 : /\bheute\b/.test(normalized) ? 0 : null;
  if (dayOffset == null) return points;
  const referenceValue =
    rawResult?.data?.timestamp || rawResult?.timestamp || rawResult?.generatedAt || null;
  const referenceDate = referenceValue ? new Date(referenceValue) : new Date();
  if (Number.isNaN(referenceDate.getTime())) return points;
  const targetKey = formatDossierBerlinDateKey(
    new Date(referenceDate.getTime() + dayOffset * 24 * 60 * 60 * 1000)
  );
  const filtered = points.filter((point) => formatDossierBerlinDateKey(point.start) === targetKey);
  return filtered.length >= hours ? filtered : points;
}

function buildDossierCo2ChargingWindowEvidence(rawResult = {}, text = '') {
  if (!detectDossierEvCo2ChargingRequest(text)) return null;
  const hours = parseDossierRequestedChargingHours(text);
  const points = filterDossierChargingPointsByRequestedDay(
    extractDossierCo2ForecastPoints(rawResult),
    rawResult,
    text,
    hours
  );
  if (points.length < hours) return null;
  let best = null;
  for (let index = 0; index <= points.length - hours; index += 1) {
    const window = points.slice(index, index + hours);
    const avg = window.reduce((sum, point) => sum + point.value, 0) / hours;
    if (!best || avg < best.avg) {
      best = {
        start: window[0].start,
        end: new Date(window[hours - 1].start.getTime() + 60 * 60 * 1000),
        avg,
      };
    }
  }
  if (!best) return null;
  return `Bestes ${hours}h-Ladefenster: ${formatDossierBerlinWindow(best.start, best.end)} · Durchschnitt: ${best.avg.toFixed(1)} g CO2/kWh`;
}

/**
 * Detect role-based open-requirements queries (v0.63.2 #220).
 * Returns { isQuery, role } or { isQuery: false }.
 */
function detectOpenEvidenceRequirementsQuery(text = '') {
  const normalized = normalizeCopilotSearchableText(text);
  const isQuery =
    /was\s+(?:braucht|ben[öo]tigt|erwartet|fehlt).{0,40}(?:von mir|von uns|euch|sie)/i.test(
      normalized
    ) ||
    /welche\s+(?:offenen|ausstehenden|fehlenden)\s+(?:entscheidungen|anforderungen|informationen|daten|unterlagen)/i.test(
      normalized
    ) ||
    /(?:offene|ausstehende|fehlende)\s+(?:evidence|anforderungen|entscheidungen)\s+(?:f[üu]r|meiner\s+rolle)/i.test(
      normalized
    ) ||
    /was\s+muss\s+(?:ich|meine\s+abteilung)\s+(?:liefern|beibringen|einreichen|kl[äa]ren)/i.test(
      normalized
    );

  if (!isQuery) return { isQuery: false };

  let role = null;
  if (/netzplanung|netzbetreiber|netzanschluss|netzebene/i.test(normalized)) role = 'netzplanung';
  else if (/messwesen|lastprofil|zeitreihe|smartmeter/i.test(normalized)) role = 'messwesen';
  else if (/regulatory|genehmigung|recht|zulassung/i.test(normalized)) role = 'regulatory';

  return { isQuery: true, role };
}

function dossierLowEvidenceMatchesProjectScope(entry = {}, query = '') {
  const queryScope = extractDossierProjectScope(query);
  const entryScope = entry?.metadata?.projectScope || {};
  if (!queryScope.scopeKey) {
    // Prior user-provided facts with a concrete project scope must not bleed into
    // unrelated strategic questions such as a grid-operator-wide Tuebingen brief.
    return !entryScope.scopeKey;
  }

  if (entryScope.scopeKey) {
    const locationMatches =
      !queryScope.normalizedLocation ||
      !entryScope.normalizedLocation ||
      entryScope.normalizedLocation === queryScope.normalizedLocation;
    const powerMatches =
      !queryScope.normalizedPower ||
      !entryScope.normalizedPower ||
      entryScope.normalizedPower === queryScope.normalizedPower;
    return locationMatches && powerMatches;
  }

  const factType = entry?.metadata?.factType || null;
  const haystack = normalizeCopilotSearchableText(
    [entry.value, entry.retrievalHint].filter(Boolean).join(' ')
  );
  if (factType === 'location') {
    return Boolean(
      (queryScope.normalizedLocation && haystack.includes(queryScope.normalizedLocation)) ||
      (queryScope.postalCode && haystack.includes(queryScope.postalCode))
    );
  }
  if (factType === 'requested_power') {
    return Boolean(queryScope.normalizedPower && haystack.includes(queryScope.normalizedPower));
  }

  return false;
}

function findOeoMapping(list = [], id) {
  return list.find((entry) => entry.id === id) || null;
}

function toOeoClass(id, entry) {
  if (!entry?.iri) return null;
  return {
    id,
    iri: entry.iri,
    label: entry.label || id,
    labelDe: entry.labelDe || entry.label || id,
  };
}

function buildDossierFactOeoAnnotations(factType, value) {
  const classes = [];
  const semanticTags = [];
  const add = (id, entry) => {
    const mapped = toOeoClass(id, entry);
    if (mapped && !classes.some((item) => item.iri === mapped.iri)) classes.push(mapped);
  };
  const addGrid = (id) => add(id, findOeoMapping(GRID_CONCEPTS, id));
  const addEnergy = (id) => add(id, findOeoMapping(ENERGY_CONCEPTS, id));

  if (factType === 'requested_power') {
    addEnergy('electricity-demand');
    addEnergy('electrical-energy');
    if (/\bmw\b/i.test(value)) add('unit-megawatt', UNITS.MW);
    if (/\bkw\b/i.test(value)) add('unit-kilowatt', UNITS.kW);
    semanticTags.push('oeo:electricity-demand', 'oeo:power-unit');
  } else if (factType === 'asset_class') {
    addEnergy('electricity-demand');
    semanticTags.push('cernion:asset:data-center');
  } else if (factType === 'load_profile') {
    addEnergy('time-series');
    addEnergy('electricity-demand');
    semanticTags.push('oeo:time-series', 'cernion:load-profile');
  } else if (factType === 'requested_check_scope') {
    addGrid('electricity-grid');
    addGrid('distribution-grid');
    addGrid('grid-component');
    addGrid('voltage-level');
    semanticTags.push('oeo:electricity-grid', 'cernion:grid-connection-check');
  } else if (factType === 'available_document') {
    if (/lastprofil|zeitreihe|viertelstunden/i.test(value)) addEnergy('time-series');
    if (/single[-\s]?line|netz|anschluss/i.test(value)) addGrid('grid-component');
    semanticTags.push('cernion:evidence-document');
  } else if (factType === 'missing_evidence_requirement') {
    if (/netz|umspann|spannung|anschluss|tab/i.test(value)) {
      addGrid('electricity-grid');
      addGrid('grid-component');
    }
    semanticTags.push('cernion:evidence-requirement');
  } else if (factType === 'metering_concept') {
    semanticTags.push('cernion:metering-concept');
  } else if (factType === 'asset_component') {
    if (/speicher|pv|waermepumpe|wärmepumpe/i.test(value)) addEnergy('electricity-demand');
    semanticTags.push('cernion:asset-component');
  } else if (factType === 'asset_status') {
    semanticTags.push('cernion:asset-status');
  } else if (factType === 'project_timeline') {
    semanticTags.push('cernion:project-timeline');
  } else if (factType === 'location' || factType === 'postal_code' || factType === 'city') {
    semanticTags.push('cernion:location', 'cernion:postal-code');
  }

  return {
    oeoClasses: classes,
    semanticTags: Array.from(new Set(semanticTags)),
  };
}

function isDossierCandidateListHeading(line = '') {
  const normalized = normalizeCopilotSearchableText(line);
  if (!/:\s*$/.test(String(line || ''))) return false;
  return (
    /\b(?:mastr|marktstammdatenregister)\b/.test(normalized) &&
    /\b(?:auszug|liste|kandidat|einheit|anlage|anlagen)\b/.test(normalized)
  );
}

function isDossierSectionHeading(line = '') {
  return /^\s*[A-Za-zÄÖÜäöüß][^:\n]{0,100}:\s*$/.test(String(line || ''));
}

function stripDossierCandidateListSections(text = '') {
  const lines = String(text || '').split(/\r?\n/);
  const kept = [];
  let skippingCandidateSection = false;

  for (const line of lines) {
    if (isDossierCandidateListHeading(line)) {
      skippingCandidateSection = true;
      continue;
    }

    if (skippingCandidateSection && isDossierSectionHeading(line)) {
      skippingCandidateSection = false;
    }

    if (!skippingCandidateSection) kept.push(line);
  }

  return kept.join('\n');
}

function extractDossierProjectPowerSignal(text = '', fallbackPower = null) {
  const capacityMatch = String(text || '').match(
    /\b(?:kapazit[aä]t|kapazitaet|anschlussleistung|leistung|capacity)(?:[_\s-]*(kwp|kw|mw|megawatt|kilowatt))?\s*[:=]\s*(\d+(?:[,.]\d+)?)(?:\s*(kwp|kw|mw|megawatt|kilowatt))?\b/i
  );
  if (capacityMatch) {
    const rawUnit = (capacityMatch[1] || capacityMatch[3] || 'kW').toLowerCase();
    const unit = rawUnit.startsWith('m') ? 'MW' : rawUnit === 'kwp' ? 'kWp' : 'kW';
    return {
      value: Number(String(capacityMatch[2]).replace(',', '.')),
      unit,
    };
  }
  return fallbackPower || null;
}

function extractDossierCitySignal(text = '') {
  const safeText = stripDossierCandidateListSections(text);
  const match = safeText.match(
    /\b(?:ich\s+wohne\s+in|wohne\s+in|wohnort\s+ist|standort\s+ist|ort\s+ist|lade\s+in|laden\s+in|in|bei|f[üu]r|fuer)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}){0,2})\b/
  );
  const value = match?.[1]?.trim() || null;
  if (!value) return null;
  const normalized = normalizeCopilotSearchableText(value);
  if (
    /^(morgen|heute|nacht|stunden|stunde|co2|neutral|möglichst|moeglichst|auto|e-auto|elektroauto)$/.test(
      normalized
    )
  ) {
    return null;
  }
  return value;
}

function extractDossierProjectScope(text = '') {
  const safeText = compactString(stripDossierCandidateListSections(text), 1200);
  const signals = extractCopilotAnalysisSignals(safeText);
  const projectPower = extractDossierProjectPowerSignal(safeText, signals.power);
  const locationMatch = safeText.match(
    /\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}){0,2})/
  );
  const citySignal = locationMatch ? null : extractDossierCitySignal(safeText);
  const location = locationMatch ? `${locationMatch[1]} ${locationMatch[2].trim()}` : citySignal;
  const postalCode = locationMatch?.[1] || signals.postalCode || null;
  const power = projectPower ? `${projectPower.value} ${projectPower.unit}` : null;
  const normalizedLocation = location ? normalizeCopilotSearchableText(location) : null;
  const normalizedPower = power ? normalizeCopilotSearchableText(power) : null;
  const scopeParts = [normalizedLocation || postalCode, normalizedPower].filter(Boolean);
  return {
    location,
    postalCode,
    power,
    normalizedLocation,
    normalizedPower,
    scopeKey: scopeParts.length > 0 ? scopeParts.join('|') : null,
  };
}

function buildDossierProjectFactEntries(
  question = '',
  { sessionId = null, now = new Date().toISOString() } = {}
) {
  const text = compactString(stripDossierCandidateListSections(question), 1200);
  const signals = extractCopilotAnalysisSignals(text);
  const projectPower = extractDossierProjectPowerSignal(text, signals.power);
  const projectScope = extractDossierProjectScope(text);
  const facts = [];
  const seen = new Set();
  const addFact = (factType, label, value) => {
    const safeValue = compactString(value, 220);
    if (!safeValue) return;
    const normalizedValue = normalizeCopilotSearchableText(safeValue);
    const key = `${factType}:${normalizedValue}`;
    if (seen.has(key)) return;
    seen.add(key);
    const semantic = buildDossierFactOeoAnnotations(factType, safeValue);
    facts.push({
      type: 'answer-dossier-user-fact',
      factType,
      label,
      value: safeValue,
      normalizedValue,
      projectScope,
      oeoClasses: semantic.oeoClasses,
      semanticTags: semantic.semanticTags,
      evidenceQuality: 'low',
      source: 'user_chat',
      sourceSessionId: sessionId || null,
      observedAt: now,
    });
  };

  const locationMatch = text.match(
    /\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{2,}){0,2})/
  );
  if (locationMatch)
    addFact('location', 'Standort', `${locationMatch[1]} ${locationMatch[2].trim()}`);
  else if (signals.postalCode) addFact('postal_code', 'Postleitzahl', signals.postalCode);
  else {
    const citySignal = extractDossierCitySignal(text);
    if (citySignal) addFact('city', 'Standort', citySignal);
  }

  if (projectPower)
    addFact(
      'requested_power',
      'Geplante Anschlussleistung',
      `${projectPower.value} ${projectPower.unit}`
    );
  if (signals.assetClass === 'data_center')
    addFact('asset_class', 'Nutzung/Asset', 'Rechenzentrum');
  const meteringConcepts = text.match(/\bMK\s*(?:10|40)\b/gi) || [];
  for (const concept of meteringConcepts) {
    addFact('metering_concept', 'Messkonzept', concept.replace(/\s+/g, '').toUpperCase());
  }
  const storageMatch = text.match(/(?:speicher|batteriespeicher)\D{0,30}(\d+(?:[,.]\d+)?)\s*kW\b/i);
  if (storageMatch) {
    addFact('asset_component', 'Speicher', `${storageMatch[1].replace(',', '.')} kW`);
  }
  const heatPumpMatch = text.match(
    /(?:w[äa]rmepumpe|waermepumpe|heat\s*pump)\D{0,30}(\d+(?:[,.]\d+)?)\s*kW\b/i
  );
  if (heatPumpMatch) {
    addFact('asset_component', 'Wärmepumpe', `${heatPumpMatch[1].replace(',', '.')} kW`);
  }
  const newPvMatch = text.match(
    /(?:neue|neuer|geplante|geplanter|zus[aä]tzliche|zusaetzliche)\s+pv(?:[-\s]?anlage)?\D{0,40}(\d+(?:[,.]\d+)?)\s*kWp\b/i
  );
  if (newPvMatch) {
    addFact('asset_component', 'Neue PV-Anlage', `${newPvMatch[1].replace(',', '.')} kWp`);
  }
  if (/alte\s+pv(?:[-\s]?anlage)?.{0,40}demontiert|demontierte\s+alte\s+pv/i.test(text)) {
    addFact('asset_status', 'PV-Altanlage', 'demontiert');
  }
  if (/24\s*\/\s*7|kontinuierlich|dauerlast|lastgang/i.test(text)) {
    addFact(
      'load_profile',
      'Lastprofil',
      /24\s*\/\s*7/.test(text) ? 'kontinuierlicher Lastgang 24/7' : 'kontinuierlicher Lastgang'
    );
  }

  const commissioningMatch = text.match(
    /\b(?:inbetriebnahme|go[-\s]?live|betrieb(?:s)?start)\D{0,30}((?:20)\d{2})\b/i
  );
  if (commissioningMatch) {
    addFact('project_timeline', 'Geplante Inbetriebnahme', commissioningMatch[1]);
  }

  const availableDocuments = [
    ['Lageplan', /lageplan/i],
    ['vorläufiges Single-Line-Diagramm', /single[-\s]?line[-\s]?diagramm|einlinienschaltbild/i],
    [
      'Lastprofil als Viertelstundenzeitreihe',
      /viertelstunden(?:zeitreihe|werte|lastprofil)|lastprofil.*viertelstunden|viertelstunden.*lastprofil/i,
    ],
    ['Netzanschlussdokumente', /netzanschluss(?:anfrage|begehren|dokument|unterlage|daten)/i],
    ['technisches Gutachten', /gutachten|machbarkeitsstudie|netzstudie/i],
  ];
  for (const [label, pattern] of availableDocuments) {
    if (
      pattern.test(text) &&
      /(?:vorhanden|liegt vor|kann.*nachreich|nachreichen|verf[üu]gbar|liefere|unterlage)/i.test(
        text
      )
    ) {
      addFact('available_document', 'Verfügbare Unterlage', label);
    }
  }

  const missingRequirements = [
    [
      'zuständiger Netzbetreiber',
      /zust[äa]ndiger\s+netzbetreiber|netzbetreiber\s+(?:unbekannt|fehlt|offen)/i,
    ],
    ['verfügbarer Netzverknüpfungspunkt', /netzverkn[üu]pfungspunkt|anschlusspunkt/i],
    [
      'Reserven im Umspannwerk',
      /(?:reserven|reserve|kapazit[äa]t).{0,40}umspannwerk|umspannwerk.{0,40}(?:reserven|reserve|kapazit[äa]t)/i,
    ],
    ['verbindliche TAB', /\btab\b|technische anschlussbedingungen/i],
    ['validierte Netzkapazität', /netzkapazit[äa]t|verf[üu]gbare anschlussleistung/i],
    ['Spannungsebene', /spannungsebene|netzebene/i],
  ];
  const missingContext =
    /(?:unbekannt|offen|fehlt|fehlen|benötigt|benoetigt|noch zu kl[äa]ren|nicht bekannt|keine angaben)/i.test(
      text
    );
  for (const [label, pattern] of missingRequirements) {
    if (pattern.test(text) && missingContext) {
      addFact('missing_evidence_requirement', 'Fehlende Evidence-Anforderung', label);
    }
  }

  const requestedChecks = [];
  const checkPatterns = [
    ['Netzebene', /netzebene/i],
    ['verfügbare Anschlussleistung', /verf[üu]gbare\s+anschlussleistung|maximal\s+verf[üu]gbar/i],
    ['Transformatorreserve', /transformator(?:reserve|auslegung)?/i],
    ['N-1-Betrachtung', /\bn\s*-\s*1\b|n-1/i],
    ['Zeitplan für Netzausbau', /zeitplan.*netzausbau|netzausbau.*zeitplan/i],
    ['Netzanschlussprüfung', /netzanschlusspr[üu]fung/i],
  ];
  for (const [label, pattern] of checkPatterns) {
    if (pattern.test(text)) requestedChecks.push(label);
  }
  if (requestedChecks.length > 0) {
    addFact('requested_check_scope', 'Gewünschter Prüfumfang', requestedChecks.join(', '));
  }

  return facts;
}

function mapDossierLowEvidenceToEntry(fact = {}) {
  const label = compactString(fact.label || fact.factType || 'Nutzerangabe', 80);
  const value = compactString(fact.value || '', 240);
  if (!value) return null;
  const factType = fact.factType || null;
  const oeoLabels = Array.isArray(fact.oeoClasses)
    ? fact.oeoClasses
        .map((entry) => entry.label || entry.id)
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const kind =
    factType === 'available_document'
      ? 'user_provided_evidence_availability'
      : factType === 'missing_evidence_requirement'
        ? 'user_provided_evidence_requirement'
        : 'user_provided_project_fact';
  const source =
    factType === 'available_document'
      ? 'user-provided evidence availability (low)'
      : factType === 'missing_evidence_requirement'
        ? 'user-provided evidence requirement (low)'
        : 'user-provided project fact (low)';
  return {
    source,
    value: `${label}: ${value} · Evidence-Qualität: low · Quelle: Nutzerangabe${oeoLabels.length ? ` · OEO: ${oeoLabels.join(', ')}` : ''}`,
    retrievalHint: [
      fact.projectScope?.normalizedLocation,
      fact.projectScope?.normalizedPower,
      fact.normalizedValue,
      fact.factType,
      ...(Array.isArray(fact.semanticTags) ? fact.semanticTags : []),
      ...(Array.isArray(fact.oeoClasses)
        ? fact.oeoClasses.map((entry) => entry.label).filter(Boolean)
        : []),
    ]
      .filter(Boolean)
      .join(' '),
    metadata: {
      kind,
      evidenceQuality: 'low',
      factType,
      projectScope: fact.projectScope || null,
      semanticTags: Array.isArray(fact.semanticTags) ? fact.semanticTags : [],
      oeoClasses: Array.isArray(fact.oeoClasses) ? fact.oeoClasses : [],
      sourceSessionId: fact.sourceSessionId || null,
      observedAt: fact.observedAt || null,
    },
  };
}

function dedupeDossierEvidence(entries = []) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (!entry?.value) continue;
    const key = normalizeCopilotSearchableText(`${entry.source || ''}|${entry.value}`);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

const COPILOT_SHORT_ANSWER_STOPWORDS = new Set([
  'bitte',
  'dazu',
  'definiert',
  'eine',
  'einer',
  'eines',
  'fuer',
  'gibt',
  'geregelt',
  'gelten',
  'haben',
  'information',
  'informationen',
  'kontext',
  'regelt',
  'welche',
  'welcher',
  'welches',
  'wird',
]);

function buildCopilotShortAnswerTerms(searchTerm) {
  return compactString(searchTerm, 300)
    .toLowerCase()
    .split(/[^a-zäöüß0-9_-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4)
    .filter((term) => !COPILOT_SHORT_ANSWER_STOPWORDS.has(term))
    .slice(0, 8);
}

function copilotEvidenceMatchesShortAnswerQuery(entry, queryTerms = []) {
  if (entry?.metadata?.kind === 'signals') return false;
  if (entry?.metadata?.status === 'unavailable') return false;
  if (queryTerms.length === 0) return true;
  const haystack = [entry?.source, entry?.value].filter(Boolean).join(' ').toLowerCase();
  return queryTerms.some((term) => haystack.includes(term));
}

function collectCopilotShortAnswerEvidence(searchTerm, evidence = []) {
  const queryTerms = buildCopilotShortAnswerTerms(searchTerm);
  return evidence
    .filter((entry) => copilotEvidenceMatchesShortAnswerQuery(entry, queryTerms))
    .map((entry) => {
      const source = compactString(entry?.source || 'Cernion', 80);
      const value = cleanCopilotEvidenceValue(entry?.value);
      if (!value) return null;
      return `${source}: ${value}`;
    })
    .filter(Boolean)
    .slice(0, 3);
}

function buildCopilotEvidenceShortAnswer({
  searchTerm,
  evidence = [],
  confidence = 'low',
  usableEvidence = null,
} = {}) {
  const answerEvidence = Array.isArray(usableEvidence)
    ? usableEvidence
    : collectCopilotShortAnswerEvidence(searchTerm, evidence);

  if (answerEvidence.length === 0) {
    if (evidence.length > 0) {
      return `Cernion hat zu "${searchTerm}" Treffer gefunden, aber daraus lässt sich keine belastbare Kurzantwort ableiten. Copilot sollte die Treffer als unscharf behandeln und nach einer präziseren Fundstelle oder Domäne fragen.`;
    }
    return `Cernion hat zu "${searchTerm}" keine eindeutigen Evidenztreffer gefunden.`;
  }

  const answer =
    answerEvidence.length === 1
      ? `Zu "${searchTerm}" liegt folgender Cernion-Hinweis vor: ${answerEvidence[0]}.`
      : `Zu "${searchTerm}" verweisen die besten Cernion-Hinweise auf ${answerEvidence.join('; ')}.`;

  const caution =
    confidence === 'high'
      ? ''
      : ' Die Einordnung ist als evidenzbasierter Kurzbefund zu verstehen; bei unklaren Treffern sollte Copilot Unsicherheit benennen.';

  return compactString(`${answer}${caution}`, 900);
}

function buildCopilotGroundingAnswer({
  question,
  searchTerm,
  shortAnswer,
  confidence,
  evidence = [],
  processContext = [],
  guardrails = [],
  risks = [],
  openQuestions = [],
  recommendedNextSteps = [],
} = {}) {
  const evidenceLines = (Array.isArray(evidence) ? evidence : [])
    .map((entry, index) => {
      const source = compactString(entry?.source || 'Cernion', 120);
      const value = compactString(entry?.value || '', 700);
      if (!value) return null;
      return `${index + 1}. ${source}: ${value}`;
    })
    .filter(Boolean);
  const retrievalHintLines = (Array.isArray(evidence) ? evidence : [])
    .map((entry, index) => {
      const source = compactString(entry?.source || 'Cernion', 120);
      const hint = compactString(entry?.retrievalHint || '', 500);
      if (!hint) return null;
      return `${index + 1}. ${source}: ${hint}`;
    })
    .filter(Boolean);

  const section = (title, lines, fallback = 'Keine Angabe.') => {
    const safeLines = Array.isArray(lines)
      ? lines.map((line) => compactString(line, 900)).filter(Boolean)
      : [];
    return [`${title}:`, safeLines.length > 0 ? safeLines.join('\n') : fallback].join('\n');
  };

  return compactString(
    [
      'GROUNDING ANSWER FUER COPILOT',
      'Verwende diesen Cernion-Kontext und die Evidence-Snippets als fachliche Grundlage fuer die Antwort.',
      'Du darfst aus den Snippets eine nutzernahe Antwort formulieren und Zusammenhaenge erklaeren.',
      'Du darfst keine Rechtsquellen, Termine, Prozessregeln oder Fakten ergaenzen, die weder in den Snippets noch im Cernion-Kontext enthalten sind.',
      'Wenn die Evidenz nur indirekt passt, nutze sie als Kontext und kennzeichne die Unsicherheit statt nur nach Praezisierung zu fragen.',
      'Wenn eine Standortaufloesung enthalten ist, nenne den aufgeloesten Standort ausdruecklich.',
      'Bei Planner- oder Schnellcheck-Evidence formuliere als Vorpruefung, nicht als abschliessende Machbarkeitsbewertung.',
      '',
      section('BENUTZERFRAGE', [question || searchTerm]),
      '',
      section('KERNANTWORT AUS CERNION', [shortAnswer]),
      '',
      section('CONFIDENCE', [confidence]),
      '',
      section('EVIDENZ', evidenceLines, 'Keine belastbare Evidenz im Rueckgabeobjekt.'),
      '',
      section(
        'RETRIEVAL-HINWEISE',
        retrievalHintLines,
        'Keine separaten Retrieval-Hinweise im Rueckgabeobjekt.'
      ),
      '',
      section('PROZESSKONTEXT', processContext),
      '',
      section('GUARDRAILS', guardrails),
      '',
      section('RISIKEN / UNSICHERHEITEN', risks, 'Keine zusaetzlichen Risiken gemeldet.'),
      '',
      section('OFFENE FRAGEN', openQuestions, 'Keine offenen Fragen gemeldet.'),
      '',
      section('EMPFOHLENE NAECHSTE SCHRITTE', recommendedNextSteps),
      '',
      'ANTWORTREGEL:',
      'Formuliere eine hilfreiche Antwort aus den vorhandenen Snippets. Retrieval-Hinweise duerfen zur Themenorientierung genutzt werden, aber nicht als alleinige Quelle fuer fachliche Aussagen. Standortaufloesungen aus der Evidence sollen in der Antwort genannt werden. Bei niedriger Confidence oder unscharfer Evidenz: Unsicherheit sichtbar machen, aber verwertbare Snippet-Inhalte trotzdem zusammenfassen. Nicht aus Modellwissen auffuellen.',
      'Bei konkreten Standort-/Leistungsfragen darf Copilot aus Planner-Signalen, Tool-Ausfaellen oder unspezifischen Retrieval-Treffern keine Machbarkeit, Netzkapazitaet, VNB-Zustaendigkeit oder Genehmigungsfaehigkeit ableiten.',
    ].join('\n'),
    6000
  );
}

function shouldBuildCopilotConsultingBrief(context = {}) {
  if (process.env.NODE_ENV === 'test') return false;
  if (context?.disableCernionConsultingBrief === true) return false;
  if (process.env.COPILOT_CONSULTING_BRIEF_ENABLED === 'false') return false;
  return true;
}

function formatCopilotConsultingBrief(brief = {}) {
  const lines = [
    brief.assessment ? `Einordnung: ${compactString(brief.assessment, 900)}` : null,
    Array.isArray(brief.usableEvidence) && brief.usableEvidence.length > 0
      ? `Nutzbare Evidenz: ${brief.usableEvidence.map((item) => compactString(item, 260)).join(' | ')}`
      : null,
    Array.isArray(brief.cautions) && brief.cautions.length > 0
      ? `Unsicherheiten: ${brief.cautions.map((item) => compactString(item, 260)).join(' | ')}`
      : null,
    Array.isArray(brief.followUpQuestions) && brief.followUpQuestions.length > 0
      ? `Beratungsfragen: ${brief.followUpQuestions
          .map((item) => compactString(item, 260))
          .join(' | ')}`
      : null,
  ].filter(Boolean);
  return lines.join('\n');
}

const COPILOT_CONSULTING_BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    assessment: { type: 'string' },
    usableEvidence: { type: 'array', items: { type: 'string' } },
    cautions: { type: 'array', items: { type: 'string' } },
    followUpQuestions: { type: 'array', items: { type: 'string' } },
  },
};

module.exports = {
  crypto,
  MoleculerClientError,
  jobStore,
  getTenantId,
  tenantNamespace,
  hasMakoEdifactCodeContextSignal,
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
  assertNoL4RawInPersistedState,
  resolveContextMutation,
  buildDecisionFrameDirectives,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
  PERSONAL_AGENT_STATES,
  createStateMachine,
  transitionStateMachine,
  deriveTerminalState,
  summarizeStateMachine,
  createExecutionStateGraph,
  advanceExecutionStateGraph,
  summarizeExecutionStateGraph,
  createMessageFingerprint,
  createTurnGraph,
  addNode,
  addEdge,
  finalizeTurnGraph,
  summarizeTurnGraph,
  addWorkflowPlanNode,
  buildConsultationExecutionPlan,
  executeWithReceipt,
  EXECUTION_READINESS,
  extractAvailableInputs,
  isInputAlreadyProvided,
  validateRoutingIntent,
  decideRoutingTarget,
  buildExecutionGapResponse,
  createExecutionTrace,
  createToolCallTracker,
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
  shouldBlockSynthesisOnGaps,
  buildEvidenceGapPresentation,
  extractSourceActions,
  evaluatePresentationGrounding,
  queryKnowledgeOrientationAdapter,
  queryKnowledgeEvidenceAdapter,
  scheduleDream,
  cancelDream,
  isDreamPending,
  runDreamPipeline,
  DREAM_AUDIT_NAMESPACE,
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
  ONBOARDING_PARAM_ALTERNATIVES,
  buildPersonalAgentResponseStrategy,
  buildPersonalAgentStrategyLead,
  buildGroundedReceiptReplyAdapter,
  GRID_CONCEPTS,
  ENERGY_CONCEPTS,
  UNITS,
  extractBlueprintPolicy,
  checkStickinessRetain,
  buildSynthesisPolicyDirectives,
  detectBlueprintIntent,
  findBlueprintByPrimaryIntent,
  loadBlueprint,
  compileReadOnlyExecutionPlan,
  describeNoPlanReason,
  buildAskBlueprintAnswer,
  findClarificationPolicyMatch,
  resolveLocationFromText,
  buildLocationContextPatch,
  buildLocationResolutionTrace,
  classifyMarketPartnerRole,
  llmGenerateText,
  llmGenerateStructured,
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  ocrExtractImage,
  extractDocumentText,
  readTextContent,
  injectFileIntoL3,
  executeToolWithRetry,
  pushPlanFrame,
  markTopFrameCompleted,
  findResumableParentFrame,
  resumeParentPlanFrame,
  mergeResolvedParamsIntoPlan,
  hasRecentIntentLoop,
  assertNoRecentIntentLoop,
  buildZnpContextSnapshot,
  WORK_LOG_ACTIONS,
  createTurnWorkLog,
  getSafePersonaLabel,
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildContextFieldWorkOutLoudPayload,
  REFLECTION_OUTPUT_SCHEMA,
  buildReflectionPrompt,
  validateReflectionPatch,
  hasScopeBlockedOrMissingSteps,
  DOSSIER_USER_CONTEXT,
  DOSSIER_PROCESS_STAGE,
  DOSSIER_ANSWER_MODE,
  DOSSIER_CONFIDENCE,
  DOSSIER_COMPLETION_STATE,
  computeTimeBudget,
  classifyDossierContext,
  buildDossierMarkdown,
  buildRendererSystemHint,
  normalizeKnowledgeSpaceContext,
  buildReasoningSummary,
  buildFollowUpMetadata,
  generateDossierId,
  resolveDossierSubstantiveAnswer,
  resolveDossierContract,
  describeDossierContract,
  buildSlimDossierMarkdown,
  getDossierHydrationRule,
  isDossierRuleSafetyRejected,
  OPENAPI_TAG,
  SESSION_NAMESPACE,
  DOSSIER_LOW_EVIDENCE_NAMESPACE,
  PROFILE_NAMESPACE,
  DEFAULT_SYSTEM_PROMPT,
  uniqueStrings,
  normalizeBrokerCapabilityNames,
  buildDossierPlanningFollowUps,
  buildDossierSafePlanningView,
  CONSULTATION_OUTPUT_SCHEMA,
  CONSULTATION_REACT_MAX_ITERATIONS,
  CONSULTATION_REACT_MAX_MS,
  PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS_DEFAULT,
  CONSULTATION_SYNTHESIS_MIN_MS,
  CONSULTATION_TOOL_MAX_ATTEMPTS,
  CONSULTATION_TOOL_TIMEOUT_MS,
  CONSULTATION_MIN_EFFECTIVE_TOOL_TIMEOUT_MS,
  CONSULTATION_HISTORY_MAX_ENTRIES,
  CONSULTATION_HISTORY_MAX_CHARS,
  CONSULTATION_HISTORY_ENTRY_MAX_CHARS,
  CONSULTATION_HISTORY_REDACTION_PLACEHOLDER,
  COPILOT_KNOWLEDGE_TIMEOUT_MS,
  COPILOT_DATAPOINT_TIMEOUT_MS,
  COPILOT_OBJECT_STORE_TIMEOUT_MS,
  COPILOT_CONSULTING_BRIEF_TIMEOUT_MS,
  COPILOT_OBJECT_STORE_MAX_NAMESPACES,
  COPILOT_DEFAULT_OBJECT_NAMESPACES,
  DOSSIER_TIMEOUT_WARNING_THRESHOLD_MS,
  DOSSIER_SESSION_NAMESPACE,
  toIsoDateOnly,
  extractDossierHydrationDateRange,
  formatEntsoeEvidence,
  isNotFound,
  buildSessionNotFoundError,
  listAuthValues,
  hasFullAccessPrincipal,
  isActionUnavailable,
  sanitizeReflectionContextValue,
  isReflectionContextSuspiciousKey,
  isReflectionContextSuspiciousValue,
  sanitizeKnownContextForReflectionPrompt,
  flattenScopeViolations,
  buildReceiptReflectionSummary,
  buildReceiptReflectionAuditSeed,
  isParametersValidationError,
  normalizeHitlStatus,
  isHitlApprovedStatus,
  isHitlTerminalStatus,
  buildConsultationToolExecutionContext,
  isConsultationDebugEnabled,
  sanitizeConsultationDebugText,
  sanitizeConsultationDebugError,
  buildConsultationDebugLogMessage,
  buildConsultationDebugProgress,
  createConsultationDebugRecorder,
  isPlausibleBdewCode,
  compactString,
  toCopilotList,
  normalizeCopilotArray,
  isCopilotEnergySharingQuestion,
  isCopilotMakoEdifactQuestion,
  extractCopilotAnalysisSignals,
  extractCopilotLocationLabelFromText,
  extractCopilotLocationLabelFromObject,
  deriveCopilotSearchTerm,
  mapCopilotDomainToSearchDomain,
  buildCopilotContextQueries,
  objectLooksRelevantToCopilot,
  datapointLooksRelevantToCopilot,
  normalizeCopilotObjectNamespaces,
  cleanCopilotEvidenceValue,
  copilotKnowledgeHitIsAllowedForQuery,
  COPILOT_RELEVANCE_STOPWORDS,
  copilotQueryRequiresStrictEvidenceRelevance,
  normalizeCopilotRelevanceTerm,
  buildCopilotStrictEvidenceTerms,
  normalizeCopilotSearchableText,
  copilotKnowledgeHitHasStrictQueryRelevance,
  copilotDossierEvidenceHasStrictQueryRelevance,
  hashDossierLowEvidence,
  buildDossierLowEvidenceKey,
  detectDossierPreliminaryAnswerRequest,
  detectDossierFinalAnswerRequest,
  buildDossierTurnSummary,
  buildDossierPriorConversationContext,
  detectDossierEvCo2ChargingRequest,
  parseDossierRequestedChargingHours,
  extractDossierCo2ForecastPoints,
  formatDossierBerlinWindow,
  formatDossierBerlinDateKey,
  filterDossierChargingPointsByRequestedDay,
  buildDossierCo2ChargingWindowEvidence,
  detectOpenEvidenceRequirementsQuery,
  dossierLowEvidenceMatchesProjectScope,
  findOeoMapping,
  toOeoClass,
  buildDossierFactOeoAnnotations,
  isDossierCandidateListHeading,
  isDossierSectionHeading,
  stripDossierCandidateListSections,
  extractDossierProjectPowerSignal,
  extractDossierCitySignal,
  extractDossierProjectScope,
  buildDossierProjectFactEntries,
  mapDossierLowEvidenceToEntry,
  dedupeDossierEvidence,
  COPILOT_SHORT_ANSWER_STOPWORDS,
  buildCopilotShortAnswerTerms,
  copilotEvidenceMatchesShortAnswerQuery,
  collectCopilotShortAnswerEvidence,
  buildCopilotEvidenceShortAnswer,
  buildCopilotGroundingAnswer,
  shouldBuildCopilotConsultingBrief,
  formatCopilotConsultingBrief,
  COPILOT_CONSULTING_BRIEF_SCHEMA,
};
