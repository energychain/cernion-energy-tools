'use strict';

const rateQuotaStore = require('./rate-quota-store');

const DEFAULT_MAX_CONTEXT_TOKENS = 128_000;
const DEFAULT_RESERVATIONS = {
  l0: 2_000,
  l1: 8_000,
  l2: 4_000,
  l3: 10_000,
  l4: 20_000,
};

const FORBIDDEN_L4_KEYS = new Set([
  'layer4',
  'toolContext',
  'knowledgeContext',
  'inhouseData',
  'rawJson',
  'rawResponse',
  'responseRaw',
]);

function estimateTokens(value) {
  return rateQuotaStore.estimateTextTokens(value);
}

function normaliseReservations(reservations = {}) {
  return {
    ...DEFAULT_RESERVATIONS,
    ...(reservations || {}),
  };
}

function assertSingleActiveLayer4Tool(layer4) {
  if (!layer4) return true;
  const tools = Array.isArray(layer4.tools) ? layer4.tools : [];
  if (tools.length > 1) {
    const err = new Error(
      'L4_SINGLE_TOOL_VIOLATION: Layer 4 darf maximal ein aktives Tool halten.'
    );
    err.code = 'L4_SINGLE_TOOL_VIOLATION';
    throw err;
  }
  if (layer4.activeTool && tools.length === 0) {
    const err = new Error('L4_SINGLE_TOOL_VIOLATION: activeTool ohne tools[0] ist ungueltig.');
    err.code = 'L4_SINGLE_TOOL_VIOLATION';
    throw err;
  }
  return true;
}

function buildSlidingSummary(history = [], keepFromIndex = 0) {
  const head = history.slice(0, keepFromIndex);
  if (head.length === 0) return null;
  const compact = head
    .map((entry) => {
      const role = String(entry?.role || 'unknown').toUpperCase();
      const text = String(entry?.text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      return `${role}: ${text}`;
    })
    .join(' | ');
  return `L3-Summary (${head.length} Turns): ${compact}`;
}

function compressLayer3History(history = [], targetTokens = DEFAULT_RESERVATIONS.l3) {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      history: [],
      summary: null,
      tokens: 0,
      compressed: false,
    };
  }

  const cloned = history.map((entry) => ({
    role: String(entry?.role || 'user'),
    text: String(entry?.text || ''),
    ts: entry?.ts || null,
  }));

  if (estimateTokens(cloned) <= targetTokens) {
    return {
      history: cloned,
      summary: null,
      tokens: estimateTokens(cloned),
      compressed: false,
    };
  }

  let start = cloned.length;
  let kept = [];
  while (start > 0) {
    const candidate = cloned.slice(start - 1);
    if (estimateTokens(candidate) > targetTokens) {
      break;
    }
    kept = candidate;
    start -= 1;
  }

  const keepFromIndex = Math.max(0, start);
  const summary = buildSlidingSummary(cloned, keepFromIndex);
  const withSummary = summary ? [{ role: 'system', text: summary, ts: null }, ...kept] : kept;

  return {
    history: withSummary,
    summary,
    tokens: estimateTokens(withSummary),
    compressed: true,
  };
}

function buildLayer4(toolContext) {
  if (!toolContext) return null;
  const activeTool = {
    name: String(toolContext?.tool || toolContext?.name || 'tool'),
    input: toolContext?.input || toolContext?.request || {},
    responseRaw: toolContext?.responseRaw || toolContext?.result || {},
  };
  const layer4 = {
    activeTool: activeTool.name,
    tools: [activeTool],
  };
  assertSingleActiveLayer4Tool(layer4);
  return layer4;
}

function enforceLayerBudgets(stack, options = {}) {
  const maxContextTokens = Number(options.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS);
  const reservations = normaliseReservations(options.reservations);
  const l3Budget = reservations.l3;

  const compressedL3 = compressLayer3History(stack.l3?.history || [], l3Budget);
  const l4 = stack.l4 || null;
  if (l4) assertSingleActiveLayer4Tool(l4);

  const next = {
    ...stack,
    l3: {
      history: compressedL3.history,
      fileAttachments: Array.isArray(stack?.l3?.fileAttachments) ? stack.l3.fileAttachments : [],
      summary: compressedL3.summary,
      compressed: compressedL3.compressed,
    },
  };

  const usage = {
    l0: estimateTokens(next.l0),
    l1: estimateTokens(next.l1),
    l2: estimateTokens(next.l2),
    l3: estimateTokens(next.l3),
    l4: estimateTokens(next.l4),
  };

  const total = usage.l0 + usage.l1 + usage.l2 + usage.l3 + usage.l4;
  if (total > maxContextTokens) {
    const err = new Error(
      `CONTEXT_BUDGET_EXCEEDED: ${total} > ${maxContextTokens}. Weitere Kompression erforderlich.`
    );
    err.code = 'CONTEXT_BUDGET_EXCEEDED';
    err.data = { total, maxContextTokens, usage };
    throw err;
  }

  return {
    stack: next,
    usage: {
      ...usage,
      total,
      maxContextTokens,
      reservations,
    },
  };
}

function buildContextStack(input = {}) {
  const layer4 = buildLayer4(input.toolContext || null);
  const fileAttachments = Array.isArray(input.fileAttachments) ? input.fileAttachments : [];
  const initial = {
    l0: {
      systemPrompt: String(input.systemPrompt || ''),
    },
    l1: {
      tenantFacts: Array.isArray(input.tenantFacts) ? input.tenantFacts : [],
    },
    l2: {
      userProfile: input.userProfile || {},
    },
    l3: {
      history: Array.isArray(input.sessionHistory) ? input.sessionHistory : [],
      fileAttachments,
      summary: null,
      compressed: false,
    },
    l4: layer4,
  };

  return enforceLayerBudgets(initial, {
    maxContextTokens: input.maxContextTokens,
    reservations: input.reservations,
  });
}

function synthesizeAndPurgeLayer4(stack, synthesisText) {
  const nextHistory = [
    ...(stack?.l3?.history || []),
    {
      role: 'assistant',
      text: String(synthesisText || '').trim(),
      ts: new Date().toISOString(),
    },
  ];

  return {
    stack: {
      ...stack,
      l3: {
        ...(stack?.l3 || {}),
        history: nextHistory,
      },
      l4: null,
    },
    layer4Purged: true,
  };
}

function hasForbiddenKeys(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKeys(item));

  return Object.entries(value).some(([key, child]) => {
    if (FORBIDDEN_L4_KEYS.has(key)) return true;
    return hasForbiddenKeys(child);
  });
}

function assertNoL4RawInPersistedState(state) {
  if (hasForbiddenKeys(state)) {
    const err = new Error(
      'L4_PERSISTENCE_VIOLATION: Layer-4 Rohdaten duerfen nicht persistiert werden.'
    );
    err.code = 'L4_PERSISTENCE_VIOLATION';
    throw err;
  }
  return true;
}

function buildPersistableSessionState(input = {}) {
  const resolvedParams =
    input?.l3?.resolvedParams && typeof input.l3.resolvedParams === 'object'
      ? input.l3.resolvedParams
      : {};
  const lastCompletedPlan =
    input?.l3?.lastCompletedPlan && typeof input.l3.lastCompletedPlan === 'object'
      ? input.l3.lastCompletedPlan
      : null;

  const rawCriticalStepCheckpoints =
    input?.l3?.criticalStepCheckpoints && typeof input.l3.criticalStepCheckpoints === 'object'
      ? input.l3.criticalStepCheckpoints
      : {};

  const criticalStepCheckpoints = Object.entries(rawCriticalStepCheckpoints).reduce(
    (acc, [key, value]) => {
      if (!value || typeof value !== 'object') {
        return acc;
      }
      acc[key] = {
        hitlItemId: value.hitlItemId || null,
        status: value.status || null,
        action: value.action || null,
        step: typeof value.step === 'number' ? value.step : null,
        createdAt: value.createdAt || null,
        updatedAt: value.updatedAt || null,
        approvedAt: value.approvedAt || null,
      };
      return acc;
    },
    {}
  );

  const lastClassification =
    input?.l3?.lastClassification && typeof input.l3.lastClassification === 'object'
      ? {
          messageHash: input.l3.lastClassification.messageHash || null,
          fingerprint: input.l3.lastClassification.fingerprint || null,
          chatMode: input.l3.lastClassification.chatMode || null,
          source: input.l3.lastClassification.source || null,
          confidence:
            typeof input.l3.lastClassification.confidence === 'number'
              ? input.l3.lastClassification.confidence
              : null,
          timestamp: input.l3.lastClassification.timestamp || null,
        }
      : null;

  const payload = {
    id: String(input.id || ''),
    tenantId: String(input.tenantId || 'default'),
    userId: String(input.userId || 'anonymous'),
    l1: {
      tenantFacts: Array.isArray(input?.l1?.tenantFacts) ? input.l1.tenantFacts : [],
    },
    l2: {
      userProfile: input?.l2?.userProfile || {},
    },
    l3: {
      history: Array.isArray(input?.l3?.history) ? input.l3.history : [],
      fileAttachments: Array.isArray(input?.l3?.fileAttachments) ? input.l3.fileAttachments : [],
      summary: input?.l3?.summary || null,
      compressed: Boolean(input?.l3?.compressed),
      chatMode: String(input?.l3?.chatMode || input?.chatMode || 'consultation'),
      chatModeSource: input?.l3?.chatModeSource || null,
      lastClassification,
      consultationContext:
        input?.l3?.consultationContext && typeof input.l3.consultationContext === 'object'
          ? input.l3.consultationContext
          : null,
      planStack: Array.isArray(input?.l3?.planStack) ? input.l3.planStack : [],
      resolvedParams,
      resolvedCapabilities: Array.isArray(input?.l3?.resolvedCapabilities)
        ? input.l3.resolvedCapabilities
        : [],
      lastCompletedPlan,
      stateMachine:
        input?.l3?.stateMachine && typeof input.l3.stateMachine === 'object'
          ? input.l3.stateMachine
          : null,
      executionStateGraph:
        input?.l3?.executionStateGraph && typeof input.l3.executionStateGraph === 'object'
          ? input.l3.executionStateGraph
          : null,
      turnGraph:
        input?.l3?.turnGraph && typeof input.l3.turnGraph === 'object'
          ? input.l3.turnGraph
          : null,
      criticalStepCheckpoints,
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  assertNoL4RawInPersistedState(payload);
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Mutation: append vs. replace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decisive scenario parameters.
 * When ANY of these change between turns the context must be REPLACED, not
 * appended, to prevent stale location/operator context from bleeding into the
 * new scenario.
 */
const DECISIVE_PARAMS = new Set([
  'location',
  'municipality',
  'city',
  'postalCode',
  'state',
  'bundesland',
  'latitude',
  'longitude',
  'gridOperatorName',
  'bdewCode',
  'bdew',
  'gridOperatorId',
  'projectId',
  'scenarioId',
  'tenantProjectId',
]);

/**
 * Determines whether incoming knownContext constitutes an append or a full
 * replace of the current resolvedParams, and returns the merged result.
 *
 * Replace is triggered when:
 *   - Any DECISIVE_PARAM key is present in the incoming params AND its value
 *     differs from the corresponding value already stored in prevParams.
 *
 * Append is used when:
 *   - Only non-decisive keys are new/changed, OR
 *   - Decisive keys match what was already known (refinement of the same scenario).
 *
 * @param {object} prevParams   - Current session resolvedParams (L3)
 * @param {object} incomingParams - Incoming knownContext for this turn
 * @returns {{ mode: 'append'|'replace', mergedParams: object, replacedKeys: string[] }}
 */
function resolveContextMutation(prevParams = {}, incomingParams = {}) {
  const prev = prevParams && typeof prevParams === 'object' ? prevParams : {};
  const incoming = incomingParams && typeof incomingParams === 'object' ? incomingParams : {};

  const replacedKeys = [];

  for (const key of Object.keys(incoming)) {
    if (!DECISIVE_PARAMS.has(key)) continue;
    const prevVal = prev[key];
    const newVal = incoming[key];
    // Only flag as replace if the key is explicitly set in incoming and differs
    if (newVal !== undefined && newVal !== null && newVal !== '') {
      const normalizedPrev = prevVal !== undefined && prevVal !== null
        ? String(prevVal).trim().toLowerCase()
        : null;
      const normalizedNew = String(newVal).trim().toLowerCase();
      if (normalizedPrev !== null && normalizedPrev !== normalizedNew) {
        replacedKeys.push(key);
      }
    }
  }

  const mode = replacedKeys.length > 0 ? 'replace' : 'append';

  let mergedParams;
  if (mode === 'replace') {
    // Discard all previous decisive params; keep non-decisive prev params and
    // overlay with all incoming params.
    const prevNonDecisive = Object.fromEntries(
      Object.entries(prev).filter(([k]) => !DECISIVE_PARAMS.has(k))
    );
    mergedParams = { ...prevNonDecisive, ...incoming };
  } else {
    // Append: incoming values override matching keys but retain everything else.
    mergedParams = { ...prev, ...incoming };
  }

  return { mode, mergedParams, replacedKeys };
}

module.exports = {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_RESERVATIONS,
  assertSingleActiveLayer4Tool,
  compressLayer3History,
  buildContextStack,
  enforceLayerBudgets,
  synthesizeAndPurgeLayer4,
  estimateTokens,
  assertNoL4RawInPersistedState,
  buildPersistableSessionState,
  resolveContextMutation,
  DECISIVE_PARAMS,
};
