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
      fileAttachments: Array.isArray(stack?.l3?.fileAttachments)
        ? stack.l3.fileAttachments
        : [],
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
  const fileAttachments = Array.isArray(input.fileAttachments)
    ? input.fileAttachments
    : [];
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
      fileAttachments: Array.isArray(input?.l3?.fileAttachments)
        ? input.l3.fileAttachments
        : [],
      summary: input?.l3?.summary || null,
      compressed: Boolean(input?.l3?.compressed),
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  assertNoL4RawInPersistedState(payload);
  return payload;
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
};
