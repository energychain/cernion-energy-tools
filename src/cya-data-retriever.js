'use strict';

const { assessTopologyHop } = require('./cya-topology-hop');
const { resolveToolSet, isToolAllowed } = require('./cya-tool-registry');


const DEFAULT_QUERY_TIMEOUT_MS = 45000;
const MASTR_FACT_FOCUS_AREAS = new Set(['capacity', 'renewables']);
const LOCATION_POSTAL_CODE_ALIASES = {
  'höheinöd': '66989',
  'hoheinod': '66989',
};

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

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLocationKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9äöüß\-\s]/g, '')
    .trim();
}

function extractPostalCode(location) {
  const text = normalizeText(location);
  const directMatch = text.match(/\b\d{5}\b/);
  if (directMatch) return directMatch[0];

  const alias = LOCATION_POSTAL_CODE_ALIASES[normalizeLocationKey(text)];
  return alias || null;
}

function pickNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickDateText(value) {
  const text = normalizeText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function normalizeInstallation(raw) {
  return {
    mastrNummer: raw?.mastrNummer || raw?.mastrNumber || raw?.einheitMastrNummer || null,
    bruttoleistung: pickNumber(raw?.bruttoleistung ?? raw?.capacityKW ?? raw?.installedCapacityKW),
    inbetriebnahmeDatum: pickDateText(
      raw?.inbetriebnahmeDatum
      || raw?.commissioningDate
      || raw?.inbetriebnahmedatum
      || raw?.datumInbetriebnahme
    ),
    postleitzahl: normalizeText(raw?.postleitzahl || raw?.postalCode || raw?.plz) || null,
    ort: normalizeText(raw?.ort || raw?.location || raw?.gemeinde || raw?.stadt) || null,
  };
}

function byOldestFirst(a, b) {
  const aDate = a?.inbetriebnahmeDatum || '9999-12-31';
  const bDate = b?.inbetriebnahmeDatum || '9999-12-31';
  return aDate.localeCompare(bDate);
}

function formatCapacityKw(value) {
  if (!Number.isFinite(value)) return 'unbekannt';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} kW`;
}

function formatLegacyAsset(typeLabel, asset) {
  const id = asset?.mastrNummer || 'unbekannt';
  const commissioning = asset?.inbetriebnahmeDatum || 'Datum unbekannt';
  const capacity = formatCapacityKw(asset?.bruttoleistung);
  return `${typeLabel} ${id} (${capacity}, Inbetriebnahme ${commissioning})`;
}

async function fetchInstallations(ctx, params) {
  try {
    const result = await ctx.call('energy-market.installations', params, {
      meta: { cernionToken: ctx.meta.cernionToken },
    });
    return toArray(result?.data?.installations).map(normalizeInstallation);
  } catch {
    return [];
  }
}

async function retrieveMastrSituation(ctx, context) {
  const location = normalizeText(context?.location);
  if (!location) return null;

  const postleitzahl = extractPostalCode(location);
  const shared = {
    limit: 500,
    operationalStatus: '35',
  };

  const locationFilter = postleitzahl ? { postleitzahl } : { location };

  const [solarRaw, windRaw, storageRaw] = await Promise.all([
    fetchInstallations(ctx, {
      installationType: 'solar',
      ...shared,
      ...locationFilter,
      includeNapData: false,
    }),
    fetchInstallations(ctx, {
      installationType: 'wind',
      ...shared,
      ...locationFilter,
      includeNapData: false,
    }),
    fetchInstallations(ctx, {
      installationType: 'storage',
      ...shared,
      ...locationFilter,
      minCapacityKW: 50,
      includeNapData: false,
    }),
  ]);

  const solar = solarRaw.sort(byOldestFirst);
  const wind = windRaw.sort(byOldestFirst);
  const storageUtilityScale = storageRaw;

  if (solar.length === 0 && wind.length === 0) return null;

  const legacySolar = solar[0] || null;
  const legacyWind = wind[0] || null;
  const storageDeficit = storageUtilityScale.length === 0;
  const effectivePostalCode = postleitzahl || solar[0]?.postleitzahl || wind[0]?.postleitzahl || null;
  const effectiveLocation = location || solar[0]?.ort || wind[0]?.ort || null;

  const legacyParts = [];
  if (legacySolar) legacyParts.push(formatLegacyAsset('PV', legacySolar));
  if (legacyWind) legacyParts.push(formatLegacyAsset('Wind', legacyWind));

  const storageSentence = storageDeficit
    ? 'Es wurden keine Großspeicher > 50 kW gefunden (Speicherdefizit).'
    : `Es bestehen ${storageUtilityScale.length} Großspeicher > 50 kW.`;

  const locationText = [effectivePostalCode, effectiveLocation].filter(Boolean).join(' ') || effectiveLocation || effectivePostalCode || location;

  const summary = `${locationText}: Altanlagen-Bestand mit ${legacyParts.join(' und ')}. ${storageSentence}`;

  return {
    location: effectiveLocation,
    postleitzahl: effectivePostalCode,
    summary,
    hasActionableFacts: true,
    sources: ['cernion_installations_local'],
    dataProvenance: 'mastr_machine_verified',
    legacy: {
      solar: legacySolar,
      wind: legacyWind,
    },
    storageCheck: {
      thresholdKW: 50,
      utilityScaleStorageCount: storageUtilityScale.length,
      deficit: storageDeficit,
    },
    counts: {
      pvTotal: solar.length,
      windTotal: wind.length,
      storageTotal: storageUtilityScale.length,
    },
  };
}

function buildMastrFocusItem(focusArea, mastrSituation) {
  const answerByFocusArea = {
    capacity: `${mastrSituation.summary} Für die Kapazitätsargumentation ist insbesondere das fehlende Utility-Scale-Storage relevant.`,
    renewables: `${mastrSituation.summary} Der erneuerbare Bestand ist durch Altanlagen geprägt, ohne große Speicherpuffer.`,
  };

  return {
    focusArea,
    query: 'deterministic_mastr_situation_report',
    ok: true,
    durationMs: 0,
    answer: answerByFocusArea[focusArea] || mastrSituation.summary,
    data: {
      location: mastrSituation.location,
      postleitzahl: mastrSituation.postleitzahl,
      legacy: mastrSituation.legacy,
      storageCheck: mastrSituation.storageCheck,
      counts: mastrSituation.counts,
    },
    sources: mastrSituation.sources,
    metadata: {
      mode: 'deterministic_mastr',
    },
    trusted: false,
    dataProvenance: mastrSituation.dataProvenance,
  };
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
    }, { meta: { cernionToken: ctx.meta.cernionToken } });

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
  const trusted = items.filter((item) => item.ok && item.trusted === true).length;
  const sourceSet = new Set();

  for (const item of items) {
    for (const source of toArray(item.sources)) sourceSet.add(String(source));
  }

  return {
    requested: items.length,
    success,
    failed,
    trusted,
    sources: Array.from(sourceSet),
  };
}

/**
 * Build MCP tool call params from context for a given tool name.
 * @param {string} toolName
 * @param {{ location?: string, operator?: string, capacity_mw?: number, postleitzahl?: string }} params
 * @returns {Object}
 */
function _buildToolParams(toolName, params) {
  const location = params.location || null;
  const operator = params.operator || null;
  const capacityMw = params.capacity_mw != null ? params.capacity_mw : null;
  const postleitzahl = params.postleitzahl || null;

  switch (toolName) {
    case 'cernion_installations_local':
      return {
        ...(location ? { gemeinde: location } : {}),
        ...(postleitzahl ? { postleitzahl } : {}),
        ...(capacityMw ? { minCapacity: Math.round(capacityMw * 1000) } : {}),
        format: 'summary',
      };
    case 'cernion_grid_data':
      return { location: location || operator || 'unbekannt' };
    case 'osm_grid_topology':
      return { location: location || 'unbekannt', includeSubstations: true };
    case 'cernion_energy_production':
      return { region: location || 'Deutschland', type: 'all' };
    case 'entsoe_day_ahead_prices':
      return { region: location || 'Deutschland', dateFrom: new Date().toISOString().slice(0, 10) };
    case 'entsoe_wind_solar_forecast':
      return { region: location || 'Deutschland', dateFrom: new Date().toISOString().slice(0, 10), dateTo: new Date(Date.now() + 86400000).toISOString().slice(0, 10) };
    case 'cernion_redispatch_export':
      return { gridOperator: operator || location || 'unbekannt', minCapacity: 100 };
    case 'osm_substation_finder':
      return { location: location || 'unbekannt', voltageLevel: capacityMw && capacityMw >= 150 ? 'HöS' : 'HS', maxResults: 5 };
    default:
      return { location };
  }
}

/**
 * Execute MCP direct tool calls for a resolved tool set.
 * Each call is independent — one failure does not block others.
 *
 * @param {import('moleculer').Context} ctx
 * @param {{ mcpTools: string[] }} toolSet
 * @param {Object} params
 * @returns {Promise<Object<string, Object>>}
 */
async function _resolveAndFetchMcpDirect(ctx, toolSet, params) {
  const results = {};
  for (const tool of toolSet.mcpTools) {
    try {
      results[tool] = await ctx.call('mcp-cernion.callTool', {
        toolName: tool,
        params: _buildToolParams(tool, params),
      }, { meta: { cernionToken: ctx.meta?.cernionToken } });
    } catch (err) {
      results[tool] = { error: err.message, fallback: true };
    }
  }
  return results;
}

async function retrieveContextData(ctx, input) {
  const focusAreas = toArray(input?.context?.focus_areas);
  const actorRole = input?.profile?.actor?.role;
  const targetAudience = input?.target_audience;
  const context = input?.context || {};
  const mastrSituation = await retrieveMastrSituation(ctx, context);

  const items = [];
  for (const focusArea of focusAreas) {
    if (mastrSituation?.hasActionableFacts && MASTR_FACT_FOCUS_AREAS.has(focusArea)) {
      items.push(buildMastrFocusItem(focusArea, mastrSituation));
      continue;
    }

    const query = buildFocusQuery(focusArea, context, actorRole, targetAudience);
    // Sequential by design: avoids bursty MCP usage for high-cardinality focus lists.
    // Can be parallelized later with bounded concurrency if needed.
    // eslint-disable-next-line no-await-in-loop
    const result = await runSingleFocusQuery(ctx, focusArea, query);
    items.push(result);
  }

  const retrieval = {
    retrievedAt: new Date().toISOString(),
    location: context.location || null,
    trigger: context.trigger || null,
    items,
    summary: buildSummary(items),
  };

  // Best-effort topology hop detection — non-blocking, silent on OSM failure.
  if (context.location && context.capacity_mw !== undefined && context.capacity_mw !== null) {
    retrieval.topologyHop = await assessTopologyHop(ctx, {
      location: context.location,
      capacityMw: context.capacity_mw,
    });
  } else {
    retrieval.topologyHop = null;
  }

  // Dynamic Tool Router (v0.33.0) — role-aware MCP direct calls, non-blocking.
  const _routerRole = input?.actorRole || actorRole || null;
  const _routerSignals = input?.ontologySignals || null;
  if (_routerRole && (_routerSignals || focusAreas.length > 0)) {
    try {
      const toolSet = resolveToolSet(_routerRole, focusAreas, _routerSignals);
      if (toolSet.mcpTools.length > 0) {
        retrieval.mcpDirect = await _resolveAndFetchMcpDirect(ctx, toolSet, {
          location: context.location || null,
          operator: input?.profile?.actor?.organization || null,
          capacity_mw: context.capacity_mw || null,
          postleitzahl: extractPostalCode(context.location || '') || null,
        });
        retrieval.toolSetRationale = toolSet.rationale;
        retrieval.signalOverrides = toolSet.signalOverrides;
      }
    } catch (_routerErr) {
      // Non-blocking — router failure never breaks retrieval
    }
  }

  return retrieval;
}

/**
 * Merge manually provided HITL data into an existing retrieval object.
 *
 * Each entry in providedData maps a focusArea string to a user-supplied text.
 * The item is created (or replaces the existing item) with:
 *   - ok: true           (no longer a data gap)
 *   - trusted: true      (EU AI Act Art. 12 — user-asserted, not machine-verified)
 *   - dataProvenance: 'user_asserted'
 *   - confidence: 'medium' (enforced downstream in cya-grounding.js)
 *   - sources: []        (no machine source — user provided)
 *
 * Returns a new retrieval object — the original is NOT mutated.
 *
 * @param {object} retrieval  - Existing retrieval from retrieveContextData
 * @param {Record<string, string>} providedData - { focusArea: "user text", … }
 * @returns {object} Enriched retrieval object
 */
function mergeProvidedData(retrieval, providedData) {
  if (!providedData || typeof providedData !== 'object') return retrieval;

  const mergedItems = toArray(retrieval?.items).map((item) => ({ ...item }));

  for (const [focusArea, userText] of Object.entries(providedData)) {
    if (!userText || !String(userText).trim()) continue;
    const existingIndex = mergedItems.findIndex((item) => item.focusArea === focusArea);
    const merged = {
      focusArea,
      query: null,
      ok: true,
      trusted: true,
      dataProvenance: 'user_asserted',
      durationMs: 0,
      answer: String(userText).trim(),
      data: null,
      sources: [],
      metadata: null,
      error: undefined,
    };
    if (existingIndex >= 0) {
      mergedItems[existingIndex] = merged;
    } else {
      mergedItems.push(merged);
    }
  }

  return {
    ...retrieval,
    items: mergedItems,
    summary: buildSummary(mergedItems),
    mergedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildFocusQuery,
  runSingleFocusQuery,
  retrieveContextData,
  mergeProvidedData,
};
