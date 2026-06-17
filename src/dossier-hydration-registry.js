'use strict';

const path = require('path');

const STATIC_RULES_PATH = path.join(__dirname, 'answer-dossier-hydration-rules.json');

// ── Path resolution ──────────────────────────────────────────────────────────

function resolvePath(obj, dotPath) {
  if (obj == null || typeof dotPath !== 'string' || dotPath === '') return obj;
  const parts = dotPath.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[part];
  }
  return cur ?? null;
}

function resolveFirstPath(obj, paths) {
  if (!Array.isArray(paths)) return null;
  for (const p of paths) {
    const v = resolvePath(obj, p);
    if (v != null) return v;
  }
  return null;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toIsoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function extractDateRange(question) {
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

// ── Built-in extractors ──────────────────────────────────────────────────────
// Each extractor: (userProvidedFacts, question, config?) → value | null

const EXTRACTORS = {
  constant(_facts, _question, config = {}) {
    return config.value ?? null;
  },

  dateRangeFromPrompt(_facts, question, config = {}) {
    const range = extractDateRange(question);
    const keyMap = config.keyMap || {};
    const result = {};
    for (const [k, v] of Object.entries(range)) {
      result[keyMap[k] || k] = v;
    }
    return result;
  },

  locationFromPromptOrFacts(facts, question, _config = {}) {
    const q = String(question || '');
    const plzCityMatch = q.match(/\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zäöüßÄÖÜ](?:[A-Za-zäöüßÄÖÜ\-]{0,40})?)/);
    const cityFromPrompt = plzCityMatch?.[2]?.trim() || null;
    const locationFact = (facts || []).find(
      (f) => (f.factType === 'location' || f.factType === 'postal_code') && f.projectScope?.postalCode
    );
    const postalCode =
      locationFact?.projectScope?.postalCode ||
      plzCityMatch?.[1] ||
      (q.match(/\b(\d{5})\b/) || [])[1] ||
      null;
    return cityFromPrompt || postalCode || null;
  },

  cityFromPromptOrFacts(facts, question, _config = {}) {
    const q = String(question || '');
    const plzCityMatch = q.match(/\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zäöüßÄÖÜ](?:[A-Za-zäöüßÄÖÜ\-]{0,40})?)/);
    const cityFromPrompt = plzCityMatch?.[2]?.trim() || null;
    const locationFact = (facts || []).find(
      (f) => (f.factType === 'location' || f.factType === 'city') && (f.value || f.projectScope?.city)
    );
    return cityFromPrompt || locationFact?.value || locationFact?.projectScope?.city || null;
  },

  postalCodeFromPromptOrFacts(facts, question, _config = {}) {
    const q = String(question || '');
    const plzMatch = q.match(/\b(\d{5})\b/);
    const locationFact = (facts || []).find(
      (f) => (f.factType === 'location' || f.factType === 'postal_code') && f.projectScope?.postalCode
    );
    return locationFact?.projectScope?.postalCode || plzMatch?.[1] || null;
  },

  postalCodeFromPromptOrDefault(facts, question, config = {}) {
    const found = EXTRACTORS.postalCodeFromPromptOrFacts(facts, question);
    return found || config.default || null;
  },

  regionFromPromptOrDefault(_facts, question, config = {}) {
    const q = String(question || '').toLowerCase();
    const regions = ['germany', 'deutschland', 'austria', 'oesterreich', 'switzerland', 'schweiz'];
    for (const r of regions) {
      if (q.includes(r)) return config.regionMap?.[r] || r;
    }
    return config.default || null;
  },

  knownContextPath(facts, _question, config = {}) {
    const targetPath = config.path;
    if (!targetPath) return null;
    for (const fact of (facts || [])) {
      const v = resolvePath(fact, targetPath);
      if (v != null) return v;
    }
    return null;
  },

  userFactByType(facts, _question, config = {}) {
    const targetType = config.factType;
    if (!targetType) return null;
    const fact = (facts || []).find((f) => f.factType === targetType);
    if (!fact) return null;
    return config.valuePath ? resolvePath(fact, config.valuePath) : fact.value || null;
  },

  regexCaptureSafe(_facts, question, config = {}) {
    const pattern = config.pattern;
    if (!pattern || typeof pattern !== 'string') return null;
    // Safety guard: reject overly broad patterns
    if (pattern.length < 3) return null;
    if (/^\.\*|\.\+|\.\?$/.test(pattern)) return null;
    try {
      const rx = new RegExp(pattern, config.flags || 'i');
      const match = String(question || '').match(rx);
      if (!match) return null;
      const groupIndex = config.group ?? 1;
      return match[groupIndex] ?? match[0] ?? null;
    } catch (_e) {
      return null;
    }
  },
};

const KNOWN_EXTRACTORS = new Set(Object.keys(EXTRACTORS));

// ── Built-in formatters ──────────────────────────────────────────────────────

function formatField(value, fieldSpec) {
  if (value == null) return null;
  let formatted;
  if (fieldSpec.format === 'percent') {
    formatted = `${Math.round(Number(value) * 100)}%`;
  } else if (fieldSpec.precision != null && !isNaN(Number(value))) {
    formatted = Number(value).toFixed(fieldSpec.precision);
    if (fieldSpec.suffix) formatted += ` ${fieldSpec.suffix}`;
  } else if (fieldSpec.suffix) {
    formatted = `${value} ${fieldSpec.suffix}`;
  } else {
    formatted = String(value);
  }
  if (fieldSpec.maxLen && formatted.length > fieldSpec.maxLen) {
    formatted = formatted.slice(0, fieldSpec.maxLen);
  }
  if (fieldSpec.label) return `${fieldSpec.label}: ${formatted}`;
  return formatted;
}

function fieldSummaryFormatter(result, spec) {
  if (!result || typeof result !== 'object') return null;
  const parts = [];
  let firstFieldHit = false;

  for (const fieldSpec of (spec.fields || [])) {
    const value = resolveFirstPath(result, fieldSpec.paths);
    if (value == null) continue;
    const formatted = formatField(value, fieldSpec);
    if (formatted) {
      parts.push(formatted);
      firstFieldHit = true;
    }
  }

  // arrayFallback: compute stat from array when first field matched nothing
  const af = spec.arrayFallback;
  if (af && (af.condition === 'firstFieldNull' ? !firstFieldHit : parts.length === 0)) {
    const arr = resolvePath(result, af.arrayPath);
    if (Array.isArray(arr) && arr.length > 0) {
      const vals = arr
        .map((item) => resolvePath(item, af.itemValuePath))
        .filter((n) => n != null && !isNaN(Number(n)))
        .map(Number);
      if (vals.length > 0) {
        const statVal = af.stat === 'avg'
          ? vals.reduce((a, b) => a + b, 0) / vals.length
          : af.stat === 'max'
          ? Math.max(...vals)
          : af.stat === 'min'
          ? Math.min(...vals)
          : vals[0];
        const formatted = formatField(statVal, af);
        if (formatted) parts.push(formatted);
      }
    }
  }

  // errorFallback: use a fallback path when all fields null
  const ef = spec.errorFallback;
  if (ef && parts.length === 0) {
    const v = resolveFirstPath(result, ef.paths);
    if (v) {
      const s = String(v).slice(0, ef.maxLen || 200);
      parts.push(s);
    }
  }

  // fallbackPaths at root level
  if (parts.length === 0 && Array.isArray(spec.fallbackPaths)) {
    const v = resolveFirstPath(result, spec.fallbackPaths);
    if (v != null) parts.push(String(v).slice(0, 200));
  }

  return parts.length ? parts.join(' · ') : null;
}

function timeseriesStatsFormatter(result, spec) {
  if (!result || typeof result !== 'object') return null;
  const label = spec.label || 'Daten';
  const data = result.data || result;
  const stats = resolveFirstPath(result, spec.statsPaths) || {};
  const points = resolveFirstPath(result, spec.dataPaths) || [];
  const first = Array.isArray(points) ? points[0] : null;
  const parts = [];

  const region = resolveFirstPath(result, spec.regionPaths);
  const eic = resolveFirstPath(result, spec.eicPaths);
  const avg =
    stats.average ?? stats.avg ?? stats.avgLoadMW ?? stats.avgForecastMW ??
    stats.avgPriceEURperMWh ?? stats.averagePriceEURperMWh ?? null;
  const max =
    stats.max ?? stats.maxLoadMW ?? stats.maxForecastMW ?? stats.maxPriceEURperMWh ?? null;
  const min =
    stats.min ?? stats.minLoadMW ?? stats.minForecastMW ?? stats.minPriceEURperMWh ?? null;
  const firstValue =
    first?.value ?? first?.load ?? first?.loadMW ?? first?.total ??
    first?.priceEURperMWh ?? first?.price ?? null;
  const source = resolveFirstPath(result, spec.sourcePaths || []);

  if (region) parts.push(`Region: ${String(region).slice(0, 80)}`);
  if (eic) parts.push(`EIC: ${String(eic).slice(0, 40)}`);
  if (avg != null) parts.push(`${label} Durchschnitt: ${Number(avg).toFixed(1)}`);
  if (max != null) parts.push(`${label} Max: ${Number(max).toFixed(1)}`);
  if (min != null) parts.push(`${label} Min: ${Number(min).toFixed(1)}`);
  if (firstValue != null) parts.push(`${label} erster Wert: ${Number(firstValue).toFixed(1)}`);
  if (Array.isArray(points)) parts.push(`Datenpunkte: ${points.length}`);
  if (source) parts.push(`Quelle: ${String(source).slice(0, 100)}`);

  return parts.length ? parts.join(' · ') : null;
}

function priceArrayStatsFormatter(result, spec) {
  if (!result || typeof result !== 'object') return null;
  const data = result.data || result;
  const parts = [];
  const unit = resolveFirstPath(result, spec.unitPaths) || 'EUR/MWh';

  const rawPriceArray = resolveFirstPath(result, spec.priceArrayPaths);
  const priceValueFields = spec.priceValueFields || ['price', 'value'];
  const priceValues = Array.isArray(rawPriceArray)
    ? rawPriceArray
        .map((p) => {
          for (const f of priceValueFields) {
            if (p[f] != null) return p[f];
          }
          return null;
        })
        .filter((n) => n != null && !isNaN(Number(n)))
        .map(Number)
    : [];

  if (priceValues.length > 0) {
    const avg = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;
    parts.push(`Mittel: ${avg.toFixed(2)} ${unit}`);
    parts.push(
      `Bandbreite: ${Math.min(...priceValues).toFixed(2)}–${Math.max(...priceValues).toFixed(2)} ${unit}`
    );
    parts.push(`${priceValues.length} Stunden`);
  }

  const market = resolveFirstPath(result, spec.marketPaths);
  if (market) parts.push(`Markt: ${String(market).slice(0, 40)}`);

  if (!parts.length) {
    const scalar = resolveFirstPath(result, spec.scalarPaths);
    if (scalar != null) parts.push(`Preis: ${Number(scalar).toFixed(2)} ${unit}`);
  }

  // Unconditional fallback — service responded but no prices were extractable
  if (!parts.length) {
    const marketLabel = String(market || data.market || 'day-ahead').slice(0, 30);
    const region = resolveFirstPath(result, spec.regionPaths);
    const regionLabel = String(region || data.region || 'Deutschland').slice(0, 40);
    parts.push(
      `Keine Preisdaten fuer angefragten Zeitraum (${regionLabel}, Markt: ${marketLabel})`
    );
  }

  return parts.join(' · ');
}

function scalarValueFormatter(result, spec) {
  if (!result || typeof result !== 'object') return null;
  const value = resolveFirstPath(result, spec.valuePaths || []);
  if (value == null) return null;
  const label = spec.label || '';
  const suffix = spec.suffix || '';
  const precision = spec.precision;
  const formatted =
    precision != null && !isNaN(Number(value))
      ? Number(value).toFixed(precision)
      : String(value).slice(0, spec.maxLen || 200);
  const withSuffix = suffix ? `${formatted} ${suffix}` : formatted;
  return label ? `${label}: ${withSuffix}` : withSuffix;
}

function listSummaryFormatter(result, spec) {
  if (!result || typeof result !== 'object') return null;
  const arr = resolveFirstPath(result, spec.arrayPaths || []);
  if (!Array.isArray(arr)) return null;
  const labelField = spec.itemLabelField || 'name';
  const countLabel = spec.countLabel || 'Eintraege';
  if (arr.length === 0) {
    return spec.emptyMessage || `${countLabel}: 0`;
  }
  const sample = arr
    .slice(0, spec.sampleCount || 3)
    .map((item) => resolvePath(item, labelField) || '?')
    .join(', ');
  return `${countLabel}: ${arr.length} (${sample}${arr.length > (spec.sampleCount || 3) ? ', ...' : ''})`;
}

function statusSummaryFormatter(result, spec) {
  if (!result || typeof result !== 'object') return null;
  const status = resolveFirstPath(result, spec.statusPaths || []);
  if (status == null) return null;
  const label = spec.label || 'Status';
  const parts = [`${label}: ${String(status).slice(0, 80)}`];
  if (Array.isArray(spec.extraFields)) {
    for (const ef of spec.extraFields) {
      const v = resolveFirstPath(result, ef.paths || []);
      if (v != null) {
        const s = String(v).slice(0, ef.maxLen || 120);
        parts.push(ef.label ? `${ef.label}: ${s}` : s);
      }
    }
  }
  return parts.join(' · ');
}

function noDataMessageFormatter(_result, spec) {
  return spec.message || 'Keine Daten verfuegbar';
}

const FORMATTERS = {
  fieldSummary: fieldSummaryFormatter,
  timeseriesStats: timeseriesStatsFormatter,
  priceArrayStats: priceArrayStatsFormatter,
  scalarValue: scalarValueFormatter,
  listSummary: listSummaryFormatter,
  statusSummary: statusSummaryFormatter,
  noDataMessage: noDataMessageFormatter,
};

const KNOWN_FORMATTERS = new Set(Object.keys(FORMATTERS));

// ── Blocked action prefixes ───────────────────────────────────────────────────

const BLOCKED_ACTION_VERBS = [
  '.create', '.update', '.delete', '.remove', '.save', '.promote', '.rollback',
  '.deactivate', '.reload', '.reset', '.clear', '.purge', '.import',
  '.approve', '.reject', '.escalate', '.send', '.notify', '.dispatch', '.trigger',
  '.execute', '.run', '.invoke', '.emit', '.publish', '.subscribe', '.unsubscribe',
  '.authenticate', '.logout', '.revoke', '.override', '.restore',
];

const BLOCKED_SERVICE_PREFIXES = [
  'hitl', 'webhooks', 'backup-orchestrator', 'token-manager', 'auth',
  'nova', 'domain-routes', 'dossier-hydration', 'blueprint-management',
  'personal-agent', 'capability-broker',
];

function isBlockedAction(actionName) {
  const lower = String(actionName || '').toLowerCase();
  const servicePrefix = lower.split('.')[0];
  if (BLOCKED_SERVICE_PREFIXES.includes(servicePrefix)) return true;
  return BLOCKED_ACTION_VERBS.some((verb) => lower.endsWith(verb) || lower.includes(verb + '.'));
}

// ── Compile param extractor ───────────────────────────────────────────────────

function compileParamExtractor(paramTemplate) {
  if (!paramTemplate || typeof paramTemplate !== 'object') {
    return () => ({}); // no-param actions (constant empty params)
  }

  return function extractParams(userProvidedFacts, question) {
    const result = {};
    for (const [key, spec] of Object.entries(paramTemplate)) {
      if (spec === null || spec === undefined) continue;

      // Extractor spec
      if (typeof spec === 'object' && spec.extractor) {
        const extractorFn = EXTRACTORS[spec.extractor];
        if (!extractorFn) throw new Error(`Unknown extractor: ${spec.extractor}`);

        const value = extractorFn(userProvidedFacts, question, spec.config || {});

        if (value === null || value === undefined) {
          if (spec.required) return null; // required extractor returned nothing — skip action
          // non-required: omit key
        } else if (spec.spread === true && typeof value === 'object') {
          // spread object into params (e.g. dateRange → { dateFrom, dateTo })
          Object.assign(result, value);
        } else {
          result[key] = value;
        }
      } else {
        // Constant value
        result[key] = spec;
      }
    }
    return result;
  };
}

// ── Compile formatter ─────────────────────────────────────────────────────────

function compileFormatter(formatterSpec) {
  if (!formatterSpec || typeof formatterSpec !== 'object') return () => null;
  const fn = FORMATTERS[formatterSpec.type];
  if (!fn) return () => null;
  return (result) => fn(result, formatterSpec);
}

// ── Rule validation ───────────────────────────────────────────────────────────

function validateRule(rule) {
  const errors = [];
  const warnings = [];

  if (!rule || typeof rule !== 'object') {
    return { valid: false, errors: [{ field: 'rule', message: 'rule must be an object' }], warnings: [] };
  }

  if (!rule.id || typeof rule.id !== 'string') {
    errors.push({ field: 'id', message: 'id is required' });
  }

  if (!rule.action || typeof rule.action !== 'string') {
    errors.push({ field: 'action', message: 'action is required' });
  } else if (isBlockedAction(rule.action)) {
    errors.push({ field: 'action', message: `action "${rule.action}" matches a blocked prefix or service` });
  }

  if (rule.safety?.readOnly !== true) {
    errors.push({ field: 'safety.readOnly', message: 'safety.readOnly must be true' });
  }
  if (rule.safety?.allowsMutation === true) {
    errors.push({ field: 'safety.allowsMutation', message: 'safety.allowsMutation must not be true' });
  }
  if (rule.safety?.hitlRequired === true) {
    errors.push({ field: 'safety.hitlRequired', message: 'safety.hitlRequired must not be true' });
  }

  if (rule.formatter?.type && !KNOWN_FORMATTERS.has(rule.formatter.type)) {
    errors.push({ field: 'formatter.type', message: `unknown formatter type: ${rule.formatter.type}` });
  }

  if (rule.paramTemplate && typeof rule.paramTemplate === 'object') {
    for (const [key, spec] of Object.entries(rule.paramTemplate)) {
      if (spec && typeof spec === 'object' && spec.extractor) {
        if (!KNOWN_EXTRACTORS.has(spec.extractor)) {
          errors.push({ field: `paramTemplate.${key}`, message: `unknown extractor: ${spec.extractor}` });
        }
        if (spec.extractor === 'regexCaptureSafe' && spec.config?.pattern) {
          const p = spec.config.pattern;
          if (typeof p !== 'string' || p.length < 3 || /^\.\*|\.\+|\.\?$/.test(p)) {
            errors.push({ field: `paramTemplate.${key}.config.pattern`, message: `unsafe or too-broad regex: ${p}` });
          }
        }
      }
    }
  }

  const maxTimeout = 30000;
  if (rule.timeoutMs != null && (typeof rule.timeoutMs !== 'number' || rule.timeoutMs > maxTimeout)) {
    errors.push({ field: 'timeoutMs', message: `timeoutMs must be a number ≤ ${maxTimeout}` });
  }

  if (!rule.formatter || !rule.formatter.type) {
    warnings.push({ field: 'formatter', message: 'no formatter type specified; results will always be null' });
  }
  if (!rule.label) {
    warnings.push({ field: 'label', message: 'no label; evidence entries will have no display name' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Safety predicate (shared by compileRule and _buildCompiledRules) ─────────

function _isSafetyRejected(rule) {
  if (!rule || !rule.action) return false;
  return (
    rule.safety?.readOnly !== true ||
    rule.safety?.allowsMutation === true ||
    rule.safety?.hitlRequired === true ||
    isBlockedAction(rule.action)
  );
}

// ── Compile rule ──────────────────────────────────────────────────────────────

function compileRule(rawRule) {
  if (!rawRule || rawRule.enabled === false) return null;
  if (_isSafetyRejected(rawRule)) return null;

  try {
    const extractParams = compileParamExtractor(rawRule.paramTemplate);
    const formatEvidence = compileFormatter(rawRule.formatter);
    return {
      id: rawRule.id || rawRule.action,
      action: rawRule.action,
      label: rawRule.label || rawRule.action,
      evidenceQuality: rawRule.evidenceQuality || 'validated',
      timeoutMs: rawRule.timeoutMs || 7000,
      version: rawRule.version || '1.0.0',
      extractParams,
      formatEvidence,
    };
  } catch (_err) {
    return null; // fail closed
  }
}

// ── In-memory stores ──────────────────────────────────────────────────────────

let _staticRulesCache = null;
const _runtimeRuleOverlay = new Map(); // action/id → raw rule
let _compiledRulesCache = null; // action → compiled rule
const _safetyRejectedSet = new Set(); // actions that are enabled but blocked by safety gate

// ── Static rule loader ────────────────────────────────────────────────────────

function _loadStaticRules() {
  if (_staticRulesCache !== null) return _staticRulesCache;
  try {
    // eslint-disable-next-line global-require
    _staticRulesCache = require(STATIC_RULES_PATH);
  } catch (_err) {
    _staticRulesCache = [];
  }
  return _staticRulesCache;
}

// ── Compiled-rules builder ────────────────────────────────────────────────────

function _buildCompiledRules() {
  const staticRules = _loadStaticRules();
  const merged = new Map();

  for (const rule of staticRules) {
    if (rule && rule.action) merged.set(rule.action, rule);
  }
  for (const [action, rule] of _runtimeRuleOverlay) {
    merged.set(action, rule);
  }

  _safetyRejectedSet.clear();
  const compiled = new Map();
  for (const [action, rule] of merged) {
    if (!rule || rule.enabled === false) continue;
    if (_isSafetyRejected(rule)) {
      _safetyRejectedSet.add(action);
      continue;
    }
    const c = compileRule(rule);
    if (c) compiled.set(action, c);
  }
  return compiled;
}

// ── Public API ────────────────────────────────────────────────────────────────

function getRule(actionName) {
  if (_compiledRulesCache === null) {
    _compiledRulesCache = _buildCompiledRules();
  }
  return _compiledRulesCache.get(actionName) || null;
}

function listRules() {
  if (_compiledRulesCache === null) {
    _compiledRulesCache = _buildCompiledRules();
  }
  return Array.from(_compiledRulesCache.values());
}

function reloadRegistry() {
  _compiledRulesCache = _buildCompiledRules();
  return Array.from(_compiledRulesCache.values());
}

function setRuntimeRule(action, rawRule) {
  _runtimeRuleOverlay.set(action, rawRule);
  _compiledRulesCache = null;
}

function removeRuntimeRule(action) {
  const had = _runtimeRuleOverlay.has(action);
  _runtimeRuleOverlay.delete(action);
  if (had) _compiledRulesCache = null;
  return had;
}

function getRuntimeRule(action) {
  return _runtimeRuleOverlay.get(action) || null;
}

function getStaticRules() {
  return _loadStaticRules();
}

function getRuntimeRules() {
  return Array.from(_runtimeRuleOverlay.values());
}

function isSafetyRejectedAction(actionName) {
  if (_compiledRulesCache === null) _compiledRulesCache = _buildCompiledRules();
  return _safetyRejectedSet.has(actionName);
}

// Clears all in-memory state. Intended for test isolation only.
function _resetRegistry() {
  _staticRulesCache = null;
  _compiledRulesCache = null;
  _runtimeRuleOverlay.clear();
  _safetyRejectedSet.clear();
}

module.exports = {
  getRule,
  listRules,
  reloadRegistry,
  setRuntimeRule,
  removeRuntimeRule,
  getRuntimeRule,
  getStaticRules,
  getRuntimeRules,
  validateRule,
  compileRule,
  isBlockedAction,
  isSafetyRejectedAction,
  KNOWN_EXTRACTORS,
  KNOWN_FORMATTERS,
  _resetRegistry,
};
