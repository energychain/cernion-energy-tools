'use strict';

const crypto = require('crypto');

const DEFAULT_SESSION_TTL_MS = Number(process.env.PERSONAL_AGENT_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);

const SAFE_RESOLVED_PARAM_KEYS = new Set([
  'gridOperatorId',
  'gridOperatorName',
  'gridOperatorBdew',
  'bdew',
  'query',
  'city',
  'location',
  'postleitzahl',
  'postalCode',
  'projectId',
  'taskId',
  'processId',
  'matrixId',
  'agentId',
  'voltageLevel',
  'fnavProfile',
  'ownerContact',
  'communityName',
  'communityId',
  'dateFrom',
  'dateTo',
  'gridCapacityKw',
  'requestedCapacityKW',
]);

const SAFE_ACKNOWLEDGED_KEYS = new Set([
  ...SAFE_RESOLVED_PARAM_KEYS,
  'bkz',
  'marktlokation',
  'netzanschlusspunkt',
]);

const MAX_RESOLVED_CAPABILITIES = 32;
const MAX_PLAN_STACK_DEPTH = 5;
const PLAN_FRAME_STATUSES = new Set(['suspended', 'completed', 'resumed', 'abandoned']);

const RESULT_KEY_TO_CONTEXT_KEYS = Object.freeze({
  mastrId: ['gridOperatorId'],
  companyName: ['gridOperatorName', 'query'],
  name: ['gridOperatorName', 'query'],
  operator: ['gridOperatorName', 'query'],
  bdewCode: ['gridOperatorBdew', 'bdew'],
  bdew: ['gridOperatorBdew', 'bdew'],
  code: ['gridOperatorBdew', 'bdew'],
  city: ['city', 'location'],
  postleitzahl: ['postleitzahl', 'postalCode'],
  postalCode: ['postalCode', 'postleitzahl'],
  location: ['location', 'city'],
  projectId: ['projectId'],
  matrixId: ['matrixId'],
  processId: ['processId'],
  taskId: ['taskId'],
  agentId: ['agentId'],
  voltageLevel: ['voltageLevel'],
  ownerContact: ['ownerContact'],
});

function toTrimmedScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 200) : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function isSessionExpired(payload = {}, ttlMs = DEFAULT_SESSION_TTL_MS) {
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) return false;
  const ts = Date.parse(payload?.updatedAt || payload?.createdAt || '');
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > ttl;
}

function sanitizeResolvedParams(input = {}) {
  if (!input || typeof input !== 'object') return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_RESOLVED_PARAM_KEYS.has(key)) continue;
    const nextValue = toTrimmedScalar(value);
    if (nextValue === null) continue;
    sanitized[key] = nextValue;
  }
  return sanitized;
}

function mergeResolvedParams(...parts) {
  const merged = {};
  for (const part of parts) {
    const clean = sanitizeResolvedParams(part);
    for (const [key, value] of Object.entries(clean)) {
      merged[key] = value;
    }
  }
  return merged;
}

function sanitizeResolvedCapabilities(input = []) {
  if (!Array.isArray(input)) return [];
  const dedup = [];
  const seen = new Set();
  for (const raw of input) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || value.length > 120) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    dedup.push(value);
    if (dedup.length >= MAX_RESOLVED_CAPABILITIES) break;
  }
  return dedup;
}

function mergeResolvedCapabilities(...parts) {
  const merged = [];
  for (const part of parts) {
    merged.push(...sanitizeResolvedCapabilities(part));
  }
  return sanitizeResolvedCapabilities(merged);
}

function sanitizeAcknowledgedParams(input = {}) {
  if (!isPlainObject(input)) return {};
  const sanitized = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!SAFE_ACKNOWLEDGED_KEYS.has(key)) continue;

    if (isPlainObject(raw)) {
      const value = toTrimmedScalar(raw.value);
      if (value === null) continue;
      sanitized[key] = {
        value,
        source: toTrimmedScalar(raw.source) || 'implicit_ack',
        acknowledgedAt: toTrimmedScalar(raw.acknowledgedAt) || new Date().toISOString(),
      };
      continue;
    }

    const value = toTrimmedScalar(raw);
    if (value === null) continue;
    sanitized[key] = {
      value,
      source: 'implicit_ack',
      acknowledgedAt: new Date().toISOString(),
    };
  }
  return sanitized;
}

function mergeAcknowledgedParams(...parts) {
  const merged = {};
  for (const part of parts) {
    const clean = sanitizeAcknowledgedParams(part);
    for (const [key, value] of Object.entries(clean)) {
      merged[key] = value;
    }
  }
  return merged;
}

function acknowledgedKeys(acknowledged = {}) {
  return Object.keys(sanitizeAcknowledgedParams(acknowledged));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePlanFrame(frame = {}) {
  const safe = isPlainObject(frame) ? frame : {};
  const rawStatus = String(safe.status || 'suspended').trim();
  return {
    frameId: typeof safe.frameId === 'string' && safe.frameId.trim()
      ? safe.frameId.trim()
      : `pf_${crypto.randomUUID()}`,
    turnIndex: Number.isFinite(Number(safe.turnIndex)) ? Number(safe.turnIndex) : 1,
    parentFrameId: typeof safe.parentFrameId === 'string' && safe.parentFrameId.trim()
      ? safe.parentFrameId.trim()
      : null,
    intent: typeof safe.intent === 'string' && safe.intent.trim() ? safe.intent.trim() : null,
    routing: isPlainObject(safe.routing) ? safe.routing : {},
    plan: isPlainObject(safe.plan)
      ? {
          ...safe.plan,
          steps: Array.isArray(safe.plan.steps) ? safe.plan.steps : [],
        }
      : { steps: [], status: 'ready' },
    awaitingParams: Array.isArray(safe.awaitingParams)
      ? [...new Set(safe.awaitingParams.filter(Boolean).map((item) => String(item).trim()))]
      : [],
    resolvedParamsSnapshot: sanitizeResolvedParams(safe.resolvedParamsSnapshot || {}),
    status: PLAN_FRAME_STATUSES.has(rawStatus) ? rawStatus : 'suspended',
  };
}

function sanitizePlanStack(input = []) {
  if (!Array.isArray(input)) return [];
  return input
    .map((frame) => sanitizePlanFrame(frame))
    .slice(-MAX_PLAN_STACK_DEPTH);
}

function isIntermediateStackIntent(intent = '') {
  return /^(resolve_|await_|lookup_|verify_)/i.test(String(intent || '').trim());
}

function hasRecentIntentLoop(planStack = [], intent = '') {
  const target = String(intent || '').trim().toLowerCase();
  if (!target) return false;
  const recent = sanitizePlanStack(planStack).slice(-3);
  return recent.some((frame) => String(frame.intent || '').trim().toLowerCase() === target);
}

function assertNoRecentIntentLoop(planStack = [], intent = '') {
  if (!hasRecentIntentLoop(planStack, intent)) {
    return;
  }
  const error = new Error(`Plan stack loop detected for intent: ${intent}`);
  error.code = 'PLAN_STACK_LOOP_DETECTED';
  throw error;
}

function pushPlanFrame(planStack = [], frameInput = {}, options = {}) {
  const stack = sanitizePlanStack(planStack);
  const frame = sanitizePlanFrame(frameInput);
  if (options?.enforceLoopGuard && frame.intent) {
    assertNoRecentIntentLoop(stack, frame.intent);
  }

  if (!frame.parentFrameId && stack.length > 0) {
    frame.parentFrameId = stack[stack.length - 1].frameId;
  }

  return [...stack, frame].slice(-MAX_PLAN_STACK_DEPTH);
}

function markTopFrameCompleted(planStack = [], intent = null) {
  const stack = sanitizePlanStack(planStack);
  if (stack.length === 0) return stack;
  const topIndex = stack.length - 1;
  const top = stack[topIndex];
  if (intent && String(top.intent || '') !== String(intent || '')) {
    return stack;
  }
  stack[topIndex] = {
    ...top,
    status: 'completed',
  };
  return stack;
}

function setPlanFrameStatus(planStack = [], frameId = '', status = 'suspended') {
  const stack = sanitizePlanStack(planStack);
  if (!frameId) return stack;
  return stack.map((frame) => (
    frame.frameId === frameId
      ? {
          ...frame,
          status: PLAN_FRAME_STATUSES.has(status) ? status : frame.status,
        }
      : frame
  ));
}

function findResumableParentFrame(planStack = []) {
  const stack = sanitizePlanStack(planStack);
  if (stack.length < 2) return null;
  const top = stack[stack.length - 1];
  if (top.status !== 'completed' || !isIntermediateStackIntent(top.intent)) {
    return null;
  }
  for (let i = stack.length - 2; i >= 0; i -= 1) {
    if (stack[i].status === 'suspended') {
      return {
        topFrame: top,
        topIndex: stack.length - 1,
        parentFrame: stack[i],
        parentIndex: i,
      };
    }
  }
  return null;
}

function resolvePlanValue(value, resolvedParams = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => resolvePlanValue(item, resolvedParams));
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const [key, raw] of Object.entries(value)) {
      next[key] = resolvePlanValue(raw, resolvedParams);
    }
    return next;
  }
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  const fullResolvedMatch = trimmed.match(/^__resolved\.([A-Za-z0-9_]+)$/);
  if (fullResolvedMatch) {
    const key = fullResolvedMatch[1];
    return resolvedParams[key] !== undefined ? resolvedParams[key] : value;
  }

  const fullHandlebarsMatch = trimmed.match(/^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/);
  if (fullHandlebarsMatch) {
    const key = fullHandlebarsMatch[1];
    return resolvedParams[key] !== undefined ? resolvedParams[key] : value;
  }

  return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => (
    resolvedParams[key] !== undefined ? String(resolvedParams[key]) : match
  ));
}

function mergeResolvedParamsIntoPlan(plan = {}, resolvedParams = {}) {
  const cleanResolved = {};
  for (const [key, value] of Object.entries(isPlainObject(resolvedParams) ? resolvedParams : {})) {
    const normalized = toTrimmedScalar(value);
    if (normalized !== null) {
      cleanResolved[key] = normalized;
    }
  }
  const persistedAlias = mergeResolvedParams(resolvedParams || {});
  for (const [key, value] of Object.entries(persistedAlias)) {
    if (cleanResolved[key] === undefined) {
      cleanResolved[key] = value;
    }
  }
  const mergedPlan = {
    ...(isPlainObject(plan) ? plan : {}),
    steps: Array.isArray(plan?.steps) ? plan.steps.map((step) => {
      const paramsTemplateBase = isPlainObject(step?.paramsTemplate) ? step.paramsTemplate : {};
      const paramsTemplate = resolvePlanValue(paramsTemplateBase, cleanResolved);

      if (paramsTemplate.bdew == null) {
        paramsTemplate.bdew = cleanResolved.gridOperatorBdew || cleanResolved.bdew || null;
      }
      if (paramsTemplate.gridOperatorName == null) {
        paramsTemplate.gridOperatorName = cleanResolved.gridOperatorName || null;
      }
      if (paramsTemplate.query == null && cleanResolved.query != null) {
        paramsTemplate.query = cleanResolved.query;
      }

      const directParams = {
        ...(isPlainObject(step?.params) ? step.params : {}),
      };
      for (const key of Object.keys(directParams)) {
        if (directParams[key] == null && cleanResolved[key] !== undefined) {
          directParams[key] = cleanResolved[key];
        }
      }
      if (directParams.bdew == null && (cleanResolved.gridOperatorBdew || cleanResolved.bdew)) {
        directParams.bdew = cleanResolved.gridOperatorBdew || cleanResolved.bdew;
      }
      if (directParams.gridOperatorName == null && cleanResolved.gridOperatorName) {
        directParams.gridOperatorName = cleanResolved.gridOperatorName;
      }

      return {
        ...(isPlainObject(step) ? step : {}),
        paramsTemplate,
        params: directParams,
      };
    }) : [],
  };

  return mergedPlan;
}

function resumeParentPlanFrame(planStack = [], resolvedParams = {}) {
  const stack = sanitizePlanStack(planStack);
  const resumable = findResumableParentFrame(stack);
  if (!resumable) {
    return {
      resumed: false,
      planStack: stack,
      plan: null,
      parentFrame: null,
      topFrame: null,
    };
  }

  const nextStack = stack.map((frame, index) => (
    index === resumable.parentIndex
      ? {
          ...frame,
          status: 'resumed',
        }
      : frame
  ));

  const resumedPlan = mergeResolvedParamsIntoPlan(resumable.parentFrame.plan, resolvedParams);

  return {
    resumed: true,
    planStack: nextStack,
    plan: resumedPlan,
    parentFrame: {
      ...resumable.parentFrame,
      status: 'resumed',
    },
    topFrame: resumable.topFrame,
  };
}

function extractResolvedParamsFromOnboarding(questions = []) {
  const next = {};
  const list = Array.isArray(questions) ? questions : [];
  for (const question of list) {
    if (!question || question.status !== 'answered') continue;
    if (!question.paramKey) continue;
    const value = toTrimmedScalar(question.answer);
    if (value === null) continue;
    next[question.paramKey] = value;
  }
  return sanitizeResolvedParams(next);
}

function extractResolvedParamsFromExecution(execution = {}) {
  const resolved = {};
  const steps = Array.isArray(execution?.steps) ? execution.steps : [];

  const collect = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return;
    for (const [key, raw] of Object.entries(obj)) {
      if (raw === null || raw === undefined) continue;
      if (typeof raw === 'object') {
        if (Array.isArray(raw)) {
          for (const item of raw) {
            collect(item, depth + 1);
          }
        } else {
          collect(raw, depth + 1);
        }
        continue;
      }

      const mappedKeys = RESULT_KEY_TO_CONTEXT_KEYS[key] || null;
      if (!mappedKeys) continue;
      const value = toTrimmedScalar(raw);
      if (value === null) continue;
      for (const ctxKey of mappedKeys) {
        if (resolved[ctxKey] === undefined) {
          resolved[ctxKey] = value;
        }
      }
    }
  };

  for (const step of steps) {
    if (step?.status !== 'completed') continue;
    if (step?.params && typeof step.params === 'object') {
      for (const [key, value] of Object.entries(sanitizeResolvedParams(step.params))) {
        if (resolved[key] === undefined) {
          resolved[key] = value;
        }
      }
    }
    if (step?.result && typeof step.result === 'object') {
      collect(step.result.data && typeof step.result.data === 'object' ? step.result.data : step.result, 0);
    }
  }

  return sanitizeResolvedParams(resolved);
}

module.exports = {
  DEFAULT_SESSION_TTL_MS,
  MAX_PLAN_STACK_DEPTH,
  isSessionExpired,
  sanitizeResolvedParams,
  mergeResolvedParams,
  sanitizeResolvedCapabilities,
  mergeResolvedCapabilities,
  sanitizeAcknowledgedParams,
  mergeAcknowledgedParams,
  acknowledgedKeys,
  sanitizePlanStack,
  isIntermediateStackIntent,
  hasRecentIntentLoop,
  assertNoRecentIntentLoop,
  pushPlanFrame,
  markTopFrameCompleted,
  setPlanFrameStatus,
  findResumableParentFrame,
  mergeResolvedParamsIntoPlan,
  resumeParentPlanFrame,
  extractResolvedParamsFromOnboarding,
  extractResolvedParamsFromExecution,
};
