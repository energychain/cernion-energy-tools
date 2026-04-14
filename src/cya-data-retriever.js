'use strict';

const DEFAULT_QUERY_TIMEOUT_MS = 45000;

const FOCUS_AREA_QUERY_BUILDERS = {
  capacity: ({ location }) =>
    `Wie ist die aktuelle Netzkapazitätslage${location ? ` in ${location}` : ''} für Verteilnetze? Bitte kompakt mit Engpässen.`,
  renewables: ({ location }) =>
    `Wie entwickelt sich der Anteil erneuerbarer Erzeugung${location ? ` in ${location}` : ''}? Bitte nenne die wichtigsten Treiber.`,
  grid_expansion: ({ location }) =>
    `Welche Prioritäten beim Netzausbau sind${location ? ` in ${location}` : ''} aktuell besonders relevant?`,
  redispatch: ({ location }) =>
    `Welche Redispatch- oder Abregelungsrisiken bestehen${location ? ` in ${location}` : ''} aktuell?`,
  energy_sharing: ({ location }) =>
    `Welche Risiken und Fristen gelten für Energy Sharing (§42c EnWG)${location ? ` in ${location}` : ''}?`,
  digitalization: ({ location }) =>
    `Wie ist der Stand der Netz-Digitalisierung${location ? ` in ${location}` : ''} und wo bestehen Lücken?`,
  compliance: ({ location }) =>
    `Welche regulatorischen Compliance-Risiken sind${location ? ` in ${location}` : ''} aktuell zu beachten?`,
  customer: ({ location }) =>
    `Welche Kundenerwartungen und Konfliktfelder sind${location ? ` in ${location}` : ''} aktuell relevant?`,
  investment: ({ location }) =>
    `Welche Investitionsrisiken und Argumentationslinien sind${location ? ` in ${location}` : ''} derzeit zentral?`,
  section14a: ({ location }) =>
    `Wie ist der Umsetzungsstand zu §14a EnWG${location ? ` in ${location}` : ''} und welche Auswirkungen sind erkennbar?`,
  nova: ({ location }) =>
    `Welche NOVA-relevanten Entscheidungen (Netzorientierung, Priorisierung) sind${location ? ` in ${location}` : ''} plausibel?`,
};

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildFocusQuery(focusArea, context, actorRole, targetAudience) {
  const build = FOCUS_AREA_QUERY_BUILDERS[focusArea];
  const location = context?.location;
  const trigger = context?.trigger || 'Unbekannter Anlass';
  if (!build) {
    return `Gib eine kurze Lageeinschätzung zum Themenfeld ${focusArea}${location ? ` in ${location}` : ''}. Anlass: ${trigger}.`;
  }

  const base = build({ location });
  return `${base} Kontext: Rolle=${actorRole || 'unbekannt'}, Zielgruppe=${targetAudience || 'allgemein'}, Anlass=${trigger}.`;
}

async function runSingleFocusQuery(ctx, focusArea, query) {
  const started = Date.now();
  try {
    const response = await ctx.call('query.ask', {
      query,
      explain: false,
      timeout: DEFAULT_QUERY_TIMEOUT_MS,
    });

    return {
      focusArea,
      query,
      ok: true,
      durationMs: Date.now() - started,
      answer: String(response?.answer || '').trim(),
      data: response?.data || null,
      sources: toArray(response?.sources),
      metadata: response?.metadata || null,
    };
  } catch (err) {
    return {
      focusArea,
      query,
      ok: false,
      durationMs: Date.now() - started,
      answer: '',
      data: null,
      sources: [],
      metadata: null,
      error: err?.message || 'Query failed',
    };
  }
}

function buildSummary(items) {
  const success = items.filter((item) => item.ok).length;
  const failed = items.length - success;
  const sourceSet = new Set();

  for (const item of items) {
    for (const source of toArray(item.sources)) sourceSet.add(String(source));
  }

  return {
    requested: items.length,
    success,
    failed,
    sources: Array.from(sourceSet),
  };
}

async function retrieveContextData(ctx, input) {
  const focusAreas = toArray(input?.context?.focus_areas);
  const actorRole = input?.profile?.actor?.role;
  const targetAudience = input?.target_audience;
  const context = input?.context || {};

  const items = [];
  for (const focusArea of focusAreas) {
    const query = buildFocusQuery(focusArea, context, actorRole, targetAudience);
    // Sequential by design: avoids bursty MCP usage for high-cardinality focus lists.
    // Can be parallelized later with bounded concurrency if needed.
    // eslint-disable-next-line no-await-in-loop
    const result = await runSingleFocusQuery(ctx, focusArea, query);
    items.push(result);
  }

  return {
    retrievedAt: new Date().toISOString(),
    location: context.location || null,
    trigger: context.trigger || null,
    items,
    summary: buildSummary(items),
  };
}

module.exports = {
  buildFocusQuery,
  runSingleFocusQuery,
  retrieveContextData,
};
