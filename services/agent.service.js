/**
 * AI Agent Orchestration Service
 *
 * Provides the backend for the Cernion Sample Application.
 * Uses Gemini LLM for deep-thinking strategy planning and multi-step
 * microservice orchestration to solve user-defined energy research problems.
 *
 * Flow:
 *  1. POST /agent/analyze    – Deep-think: turn free-text problem into a plan
 *  2. POST /agent/execute    – Execute the plan (multi-step service calls)
 *  3. GET  /agent/session/:id – Retrieve a persisted session (shareable URL)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// In-process session store (file-backed for persistence across restarts)
// ---------------------------------------------------------------------------
const SESSION_DIR = path.join(__dirname, '..', '.sessions');

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function saveSession(session) {
  ensureSessionDir();
  let payload;
  try {
    payload = JSON.stringify(session, null, 2);
  } catch (e) {
    if (e instanceof RangeError) {
      // Session is too large to serialize (e.g. accidental unfiltered installation query).
      // Strip step results and keep interpretation so the session record is still useful.
      const slim = {
        ...session,
        results: session.results
          ? { interpretation: session.results.interpretation, stepResults: [] }
          : null,
        _saveWarning: 'stepResults omitted — payload exceeded V8 string-size limit',
      };
      payload = JSON.stringify(slim, null, 2);
    } else {
      throw e;
    }
  }
  fs.writeFileSync(path.join(SESSION_DIR, `${session.id}.json`), payload);
}

function loadSession(id) {
  const file = path.join(SESSION_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build a compact service catalogue from a Moleculer service list
// ---------------------------------------------------------------------------
function buildServiceCatalogue(services) {
  const catalogue = [];
  const skipServices = new Set(['api', '$node', 'agent']);

  for (const svc of services) {
    if (svc.name.startsWith('$') || skipServices.has(svc.name)) continue;
    if (!svc.actions) continue;

    for (const actionName of Object.keys(svc.actions)) {
      const action = svc.actions[actionName];
      const shortName = actionName.includes('.') ? actionName.split('.').pop() : actionName;
      const restPath = action.rest
        ? typeof action.rest === 'string'
          ? action.rest
          : `${action.rest.method} ${action.rest.path}`
        : null;

      if (!restPath) continue;

      const paramDefs = action.params
        ? Object.entries(action.params).map(([k, v]) => {
            // Multi-type param: v is an array of rule objects (e.g. [{type:'array'},{type:'string'}])
            if (Array.isArray(v)) {
              const types = v
                .map((r) => (typeof r === 'object' && r.type ? r.type : 'any'))
                .join('|');
              return `${k}?: ${types}`;
            }
            const t = typeof v === 'string' ? v : v.type || 'string';
            const opt = typeof v === 'object' && v.optional ? '?' : '';
            const enumVals =
              typeof v === 'object' && Array.isArray(v.values) ? `[${v.values.join('|')}]` : '';
            const dflt = typeof v === 'object' && v.default !== undefined ? `=${v.default}` : '';
            return `${k}${opt}: ${t}${enumVals}${dflt}`;
          })
        : [];

      // First sentence of the openapi description provides crucial context
      const rawDesc = action.openapi?.description || '';
      const descDetail = rawDesc.split(/\n/)[0].replace(/\*\*/g, '').slice(0, 160);

      catalogue.push({
        serviceName: svc.name,
        actionName: `${svc.name}.${shortName}`,
        rest: restPath,
        description: action.openapi?.summary || action.description || shortName,
        descriptionDetail: descDetail,
        params: paramDefs,
      });
    }
  }
  return catalogue;
}

// ---------------------------------------------------------------------------
// Resolve "__step_N.fieldPath" chaining references from completed step results
// ---------------------------------------------------------------------------
function resolveChainedRef(value, completedSteps) {
  if (typeof value !== 'string') return value;
  // Strip optional {{ }} mustache wrappers that Gemini sometimes generates
  const stripped = value.replace(/^\{\{(.+)\}\}$/, '$1').trim();
  if (!stripped.startsWith('__step_')) return value;
  const match = stripped.match(/^__step_(\d+)\.(.+)$/);
  if (!match) return value;
  const stepNum = parseInt(match[1], 10);
  const fieldPath = match[2];
  const stepRecord = completedSteps.find((s) => s.step === stepNum);
  if (!stepRecord || stepRecord.error || stepRecord.result == null) return null;
  return getNestedValue(stepRecord.result, fieldPath);
}

function getNestedValue(obj, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return null;
    cur = cur[part];
  }
  return cur !== undefined ? cur : null;
}

// ---------------------------------------------------------------------------
// Normalise a Gemini plan so steps always use {action, params, description}
// regardless of what key names Gemini chose (useTool/args/label/tool/inputs…)
// ---------------------------------------------------------------------------
function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) return plan;
  plan.steps = plan.steps.map((step) => ({
    ...step,
    action: step.action || step.useTool || step.tool || step.service || '',
    params: step.params || step.args || step.inputs || step.input || {},
    description: step.description || step.label || step.name || '',
  }));
  return plan;
}

// ---------------------------------------------------------------------------
// Type coercion helpers — prevent Moleculer validation errors when HTML form
// inputs (always strings) are used to fill number/boolean service params.
// ---------------------------------------------------------------------------

/**
 * Build a map of paramName → expected JS type by scanning:
 *  1. requiredInputs[].type declarations (explicit)
 *  2. Non-null step param VALUES whose typeof is 'number' or 'boolean' (inferred)
 * This lets us coerce "365" → 365 even when requiredInputs is empty, as long as
 * the plan had a numeric literal for that param somewhere.
 */
function buildTypeHints(plan) {
  const hints = {};
  for (const ri of plan.requiredInputs || []) {
    if (ri.type === 'number' || ri.type === 'boolean' || ri.type === 'string') {
      hints[ri.name] = ri.type;
    }
  }
  for (const step of plan.steps || []) {
    for (const [k, v] of Object.entries(step.params || {})) {
      if (v !== null && v !== undefined && !(k in hints)) {
        if (typeof v === 'number') hints[k] = 'number';
        else if (typeof v === 'boolean') hints[k] = 'boolean';
      }
    }
  }
  return hints;
}

/**
 * Coerce a string value to the hinted type.
 * Returns the original value unchanged when no hint exists or value is already correct.
 */
function coerceValue(value, paramName, typeHints) {
  if (typeof value !== 'string' || !(paramName in typeHints)) return value;
  const hint = typeHints[paramName];
  if (hint === 'number') {
    const n = Number(value);
    return isNaN(n) ? value : n;
  }
  if (hint === 'boolean') return value === 'true';
  return value;
}

// ---------------------------------------------------------------------------
// Schema-based proactive plan self-repair
// ---------------------------------------------------------------------------

/** Levenshtein edit distance between two lowercase strings. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Static alias table: well-known wrong param names the LLM generates → correct canonical name.
 * Key is lower-cased. Applied only when the target exists in the action's actual schema.
 */
const PARAM_ALIASES = {
  gemeinde: 'region', // residual-load: gemeinde ≠ region (SMARD scaling)
  city: 'region',
  location_string: 'region',
  gridoperator: 'gridOperatorMastrId',
  gridoperatorid: 'gridOperatorMastrId',
  mastrid: 'gridOperatorMastrId',
  vnbid: 'gridOperatorMastrId',
  operatorid: 'gridOperatorMastrId',
  gridoperatormastr: 'gridOperatorMastrId',
  date: 'startDate',
  startdate: 'startDate',
  enddate: 'endDate',
  zip: 'postleitzahl',
  plz: 'postleitzahl',
  postalcode: 'postleitzahl',
  postal_code: 'postleitzahl',
  bundesstate: 'bundesland',
  state: 'bundesland',
  type: 'installationType',
  installationtype: 'installationType',
  forecast_days: 'forecastDays',
  forecastdays: 'forecastDays',
  days: 'forecastDays',
  bdew: 'bdewCode',
  bdewcode: 'bdewCode',
  country_code: 'country',
  countrycode: 'country',
  eic_code: 'eicCode',
  eiccode: 'eicCode',
};

/**
 * Find the best matching known param name for an unknown one.
 * Priority: static alias → case-insensitive exact → unique substring → unique edit-distance ≤ 2.
 * Returns null when no safe candidate is found (ambiguous or too distant).
 *
 * @param {string} unknown - The param name used in the plan
 * @param {Set<string>} knownSet - The action's real param names from Moleculer schema
 * @returns {string|null}
 */
function findBestParamAlias(unknown, knownSet) {
  const u = unknown.toLowerCase();
  const known = [...knownSet];

  // 1. Static alias — only apply when the alias target actually exists in this schema
  const aliasTarget = PARAM_ALIASES[u];
  if (aliasTarget && knownSet.has(aliasTarget)) return aliasTarget;

  // 2. Case-insensitive exact match (handles camelCase drift, e.g. Forecastdays → forecastDays)
  const caseMatch = known.find((k) => k.toLowerCase() === u);
  if (caseMatch && caseMatch !== unknown) return caseMatch;

  // 3. Unique substring match (e.g. 'operatorId' matches 'gridOperatorMastrId' iff only one)
  const subMatches = known.filter(
    (k) => k.toLowerCase().includes(u) || u.includes(k.toLowerCase())
  );
  if (subMatches.length === 1) return subMatches[0];

  // 4. Unique Levenshtein ≤ 2 (typo correction only when exactly one candidate)
  const closeMatches = known.filter((k) => levenshtein(u, k.toLowerCase()) <= 2);
  if (closeMatches.length === 1) return closeMatches[0];

  return null;
}

/**
 * Build a param schema index from the live Moleculer service registry.
 * Returns a Map keyed by full action name (e.g. "residual-load.netResidualLoad")
 * with the value being the Set of valid param names for that action.
 *
 * @param {Array} services - broker.registry.getServiceList({ withActions: true })
 * @returns {Map<string, Set<string>>}
 */
function buildParamSchemaIndex(services) {
  const index = new Map();
  const skipServices = new Set(['api', '$node', 'agent']);
  for (const svc of services) {
    if (!svc.name || svc.name.startsWith('$') || skipServices.has(svc.name)) continue;
    if (!svc.actions) continue;
    for (const [actionName, action] of Object.entries(svc.actions)) {
      const shortName = actionName.includes('.') ? actionName.split('.').pop() : actionName;
      const fullName = `${svc.name}.${shortName}`;
      const params = action.params || {};
      const keys = Object.keys(params);
      if (keys.length > 0) {
        index.set(fullName, new Set(keys));
      }
    }
  }
  return index;
}

/**
 * Repair a plan's step params by correcting unknown param names against the live
 * Moleculer schema index. Mutates plan.steps[].params in place.
 *
 * Chained refs (__step_N…) and null values are never renamed — they resolve at runtime.
 *
 * @param {object} plan - The plan object (mutated in place)
 * @param {Map<string, Set<string>>} schemaIndex - From buildParamSchemaIndex()
 * @returns {Array<{step, action, original, corrected}>} List of corrections made
 */
function repairPlanParams(plan, schemaIndex) {
  const repairs = [];
  for (const step of plan.steps || []) {
    const knownParams = schemaIndex.get(step.action);
    if (!knownParams || knownParams.size === 0) continue; // unknown action — leave untouched
    const fixed = {};
    for (const [key, val] of Object.entries(step.params || {})) {
      // Never rename chained refs or nulls — they resolve (or get filled) at runtime
      if (val === null || (typeof val === 'string' && val.startsWith('__step_'))) {
        fixed[key] = val;
        continue;
      }
      if (knownParams.has(key)) {
        fixed[key] = val;
        continue;
      }
      const candidate = findBestParamAlias(key, knownParams);
      if (candidate) {
        repairs.push({ step: step.step, action: step.action, original: key, corrected: candidate });
        fixed[candidate] = val;
      } else {
        fixed[key] = val; // keep unknown param — may be a valid passthrough
      }
    }
    step.params = fixed;
  }
  return repairs;
}

// ---------------------------------------------------------------------------
// Gemini helper
// ---------------------------------------------------------------------------
function getGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set');
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  });
}

async function callGemini(prompt) {
  const model = getGeminiModel();
  const result = await model.generateContent(prompt);
  const response = result.response;
  return response.text();
}

// ---------------------------------------------------------------------------
// Installation result compaction for Gemini summary prompts
// ---------------------------------------------------------------------------

/**
 * Maximum number of installation rows forwarded to Gemini in the summary prompt.
 * Keeps prompt size manageable and prevents token-limit failures.
 */
const PROMPT_MAX_ROWS = 50;

/**
 * Flatten a single MaStR installation object so every field is a scalar.
 * Expands napData sub-fields and drops any remaining nested objects.
 *
 * @param {object} inst - Raw installation record
 * @returns {object} - Flat record safe for JSON-serialisation in a prompt
 */
function flattenInstallation(inst) {
  if (!inst || typeof inst !== 'object') return inst;
  const { napData, ...rest } = inst;
  const flat = { ...rest };
  if (napData && typeof napData === 'object') {
    flat.napMastrNummer = napData.napMastrNummer || '';
    flat.messlokation = napData.messlokation || '';
    flat.spannungsebene = napData.spannungsebeneLabel || String(napData.spannungsebene || '');
    flat.netzMastrNummer = napData.netzMastrNummer || '';
  }
  return flat;
}

/**
 * Compact a step result so it is safe to embed in the Gemini summary prompt.
 *
 * When a step returned data.installations[], the array is:
 *  - truncated to PROMPT_MAX_ROWS (prevents massive prompts / token overflow)
 *  - flattened (napData expanded, no nested objects)
 *
 * All other results are returned unchanged.
 *
 * @param {*} result - Raw step result
 * @returns {*} - Prompt-safe result
 */
function compactStepResult(result) {
  // Direct array result (e.g. assets.solar / assets.all return a plain array)
  if (Array.isArray(result)) {
    if (result.length <= PROMPT_MAX_ROWS) return result;
    return result.slice(0, PROMPT_MAX_ROWS);
  }

  // Nested installations array (cernion_installations_local MCP shape)
  const installations = result?.data?.installations;
  if (Array.isArray(installations)) {
    const preview = installations.slice(0, PROMPT_MAX_ROWS).map(flattenInstallation);
    return {
      ...result,
      data: {
        ...result.data,
        installations: preview,
        ...(installations.length > PROMPT_MAX_ROWS
          ? {
              _totalCount: installations.length,
              _previewNote: `First ${PROMPT_MAX_ROWS} of ${installations.length} installations shown`,
            }
          : {}),
      },
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'agent',

  settings: {
    defaultTimeout: 5 * 60 * 1000,
  },

  actions: {
    // ------------------------------------------------------------------
    // 1. Analyze – Deep-think step: produce a structured execution plan
    // ------------------------------------------------------------------
    analyze: {
      rest: 'POST /analyze',
      params: {
        problem: { type: 'string', min: 5 },
      },
      openapi: {
        summary: 'Analyze a natural-language energy problem and return an execution plan',
        tags: ['AI Agent'],
        description:
          'Uses Gemini to reason about the user problem and select which microservices to call, in which order, and which parameters are needed from the user.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['problem'],
                properties: {
                  problem: {
                    type: 'string',
                    description: 'Free-text energy research problem or question',
                    example:
                      'What is the current gas storage level in Germany and is it sufficient for winter?',
                  },
                },
              },
              examples: {
                storageSufficiency: {
                  summary: 'Analyze a storage sufficiency question',
                  value: {
                    problem:
                      'What is the current gas storage level in Germany and is it sufficient for winter?',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Execution plan with required user parameters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    summary: { type: 'string' },
                    steps: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          step: { type: 'number' },
                          service: { type: 'string' },
                          action: { type: 'string' },
                          description: { type: 'string' },
                          params: { type: 'object' },
                        },
                      },
                    },
                    requiredInputs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          label: { type: 'string' },
                          type: { type: 'string' },
                          description: { type: 'string' },
                          example: { type: 'string' },
                          required: { type: 'boolean' },
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
        const { problem } = ctx.params;

        // Collect service catalogue
        const services = ctx.broker.registry.getServiceList({ withActions: true });
        const catalogue = buildServiceCatalogue(services);

        const catalogueText = catalogue
          .map(
            (c) =>
              `- **${c.actionName}** (${c.rest}): ${c.description}${
                c.descriptionDetail ? ' — ' + c.descriptionDetail : ''
              }${c.params.length ? '\n  Params: ' + c.params.join(', ') : ''}`
          )
          .join('\n');

        const today = new Date().toISOString().slice(0, 10);

        const prompt = `You are an expert energy-data analyst AI. Today's date is ${today}.
You have access to the following microservice actions:

${catalogueText}

The user has the following problem or research request:
"${problem}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL RULES — you MUST follow every rule below:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — DSO/Grid operator name resolution (MANDATORY 3-STEP PIPELINE):
Whenever the user mentions a grid operator, DSO, utility, or energy company by
NAME (e.g. "Enercity", "Stadtwerke München", "TWL Netze", "E.ON", "Bayernwerk"),
you MUST use this EXACT three-step pipeline — no shortcuts:

  STEP 1  grid-operations.marketPartners
          params: { "query": "<full company name>", "limit": 3 }
          → resolves BDEW code, city, and (sometimes) MaStR SNB ID

  STEP 2  grid-operations.vnbLookup
          params: {
            "bdew": "__step_1.data.results[0].bdewCode",
            "city": "__step_1.data.results[0].contacts[0].city"
          }
          → resolves MaStR SNB ID from BDEW code
          → if cernion_vnb_lookup fails, the city param triggers an automatic
            fallback that extracts the SNB from a sample installation in that city

  STEP 3  assets.solar / assets.wind / assets.storage / etc.
          ALWAYS include ALL THREE fallback params so the service tries each:
          {
            "gridOperatorId": "__step_2.data.mastrId",
            "bdewCode":       "__step_1.data.results[0].bdewCode",
            "vnbName":        "__step_1.data.results[0].companyName"
          }

Do NOT skip steps 1 or 2. Do NOT call assets/installations with only a name string.

RULE 2 — requiredInputs (ask the user):
Add an entry to "requiredInputs" ONLY for values the user must supply themselves
(e.g. a date range, a region they haven't mentioned, a specific MaStR number).
Do NOT add requiredInputs for BDEW codes, MaStR IDs, or company details that the
3-step pipeline in RULE 1 will automatically resolve.

RULE 3 — Step-result chaining (EXACT paths — MUST include "data." wrapper):
Service responses are always wrapped: { success, data: { ... }, metadata }.
To pass a value from step N into step M use  "__step_N.fieldPath".
FieldPath MUST start with "data." — NEVER use bare field names at root level.

CORRECT examples (copy these paths exactly):
  "bdew":             "__step_1.data.results[0].bdewCode"
  "bdewCode":         "__step_1.data.results[0].bdewCode"
  "city":             "__step_1.data.results[0].contacts[0].city"
  "vnbName":          "__step_1.data.results[0].companyName"
  "gridOperatorId":   "__step_2.data.mastrId"
  "country":          "__step_1.data.country"

WRONG (never generate these):
  "{{__step_1.data.results[0].bdewCode}}"  ← NO {{}} mustache wrappers EVER
  "__step_1[0].bdewCode"                   ← bracket on root is wrong
  "__step_1.results[0].bdewCode"           ← missing "data." wrapper
  "__step_1.bdewCode"                      ← missing "data.results[0]"

RULE 4 — Use today's date (${today}) as the default for any unspecified "date" or
"dateFrom" parameter when the data is clearly for the current period.

RULE 5 — Universal parameter extraction (re-runnable templates):
Every concrete value you place in a step param — UNLESS it is a structural/system
parameter — MUST be surfaced as a requiredInput with that value as "default",
and the step param itself set to null.

Structural params that are EXEMPT (keep hardcoded, do NOT extract):
  format, limit, type, installationType, includeNapData, includeFacilities,
  includeStats, includeValidation, operationalStatus, netzbetreiberPruefungStatus,
  verbose, language, outputFormat, resolution, forecastDays, topN,
  includeTrend, includeDetails

Everything else is a USER DATA param and MUST be extracted:
  - Names: companies, cities, regions, operators, countries, persons
  - Dates and date ranges (convert to YYYY-MM-DD for the "default" value)
  - Any identifier: MeLo (DE... 33 chars), MaStR (SEE/SWE/SAN/SNB...), BDEW,
    EIC, postal codes (5 digits), ENTSO-E area codes, etc.
  - Numbers representing real-world values (capacities kW, thresholds, amounts)
  - Search terms / query strings the user stated in their message
  - Country codes and area names

Example — user says: "Alle Windanlagen bei Stadtwerke München PLZ 80331 seit 2020-01-01"
  CORRECT:
    step param "query": null,
    requiredInput { "name": "query", "label": "Betreiber / Suchbegriff",
                    "type": "string", "default": "Stadtwerke München", "required": true }
    step param "postleitzahl": null,
    requiredInput { "name": "postleitzahl", "label": "Postleitzahl",
                    "type": "string", "default": "80331", "required": true }
    step param "startDate": null,
    requiredInput { "name": "startDate", "label": "Datum ab",
                    "type": "date", "default": "2020-01-01", "required": true }
  WRONG: step param "query": "Stadtwerke München"  ← hardcoded, user cannot change it

This makes EVERY generated query a reusable template: the user can change any
value in Step 2 and re-run without re-analyzing from scratch.

RULE 6 — EEG regulatory compliance (§ 51 EEG cutoff):
Whenever the question involves § 51 EEG risk (negative price compensation loss)
for a list of PV/wind/storage installations:
- Only installations with commissioning date (Datum Netzzugang) ≥ 2016-01-01
  are subject to § 51 EEG. Older installations are NOT affected.
- Include a note in the plan summary that the results will be filtered to
  installations commissioned on or after 01.01.2016.
- When using german-grid.negativePrices for a full-year historical period,
  note in the description that data availability may be limited and a
  "dataReliabilityWarning" in the response indicates unreliable zero counts.

RULE 7 — netzbetreiberPruefungStatus vs operationalStatus (CRITICAL distinction):
These are TWO SEPARATE, INDEPENDENT fields. Never confuse them:

  operationalStatus (Betriebsstatus der Einheit — is the unit grid-connected?):
    "31" = In Planung (planned — NOT yet connected)
    "35" = In Betrieb (active — default, currently connected to grid)
    "37" = Vorübergehend stillgelegt
    "38" = Dauerhaft stillgelegt

  netzbetreiberPruefungStatus (Netzbetreiberprüfung — grid operator review status):
    "2955" = In Prüfung (under grid operator review — still being processed)
    "2954" = Geprüft (review completed by grid operator)
    "3075" = Nicht vorgesehen (review not applicable)

  ► If the user asks for "aktive Anlagen in Prüfung durch Netzbetreiber" (or similar),
    the CORRECT plan is:
      operationalStatus = "35"            ← active / grid-connected
      netzbetreiberPruefungStatus = "2955" ← grid operator review still open
    These two filters COMBINE. Do NOT use operationalStatus="30" for this use case —
    that code does not exist. "In Prüfung durch Netzbetreiber" = netzbetreiberPruefungStatus,
    NOT operationalStatus.

RULE 8 — Residual load + CO2 intensity (Stadtwerk forecast queries):
For any query about Residuallast, Beschaffungsplanung, CO2-Intensität, or
Lastverschiebefenster for a named Stadtwerk or DSO:

1. Run a 4-step plan: VNB pipeline (steps 1–2) + residual load (step 3) + CO2 (step 4):
     step 1: grid-operations.marketPartners  ← resolve city + operator contacts
     step 2: grid-operations.vnbLookup       ← resolve mastrId
     step 3: residual-load.netResidualLoad   ← time-series load forecast
     step 4: energy-market.co2Intensity      ← CO2 intensity forecast

2. "region" in residual-load.netResidualLoad is STRUCTURAL — derive it from step 1:
     "region": "__step_1.data.results[0].contacts[0].city"
   Do NOT put "region" in requiredInputs when the city is resolved in step 1.
   ⚠️ CRITICAL: "region" is the city name string for SMARD population scaling.
   It is NOT the same as "gemeinde" (a geographic filter inside location.gemeinde).
   NEVER use "gemeinde" as a substitute for "region". These are two different params:
     "region": "Kiel"                     ← CORRECT (SMARD population scaling)
     "gemeinde": "Kiel"                   ← WRONG for this purpose (ignored by SMARD)

3. Wire step 2's mastrId into step 3:
     "gridOperatorMastrId": "__step_2.data.mastrId"

4. Wire step 1's city into step 4's location:
     "location": "__step_1.data.results[0].contacts[0].city"

5. Derive forecastDays from the user message ("48h" → 2, "3 Tage" → 3).
   Set "forecast": true on co2Intensity. Default resolution is "hourly".

6. Never use query.ask or cernion_ask_learned for load/Residuallast/CO2 forecast
   queries. residual-load.netResidualLoad uses real SMARD + MaStR + weather — always
   prefer it over LLM estimation or static SQL for time-series load questions.

7. Always add step 5: energy-market.prices for EPEX Day-Ahead prices (monetary context):
     "market": "day-ahead",    ← structural, keep hardcoded
     "region": "Deutschland",  ← structural, keep hardcoded as the EXACT string "Deutschland"
                                   NEVER use ENTSO-E bidding zone codes here (not "DE-LU",
                                   not "DE-AT-LU", not "10Y1001A1001A63L"). Only "Deutschland".
     "startDate": null,        ← extract as requiredInput (default = analysis startDate or today)
     "endDate": null           ← extract as requiredInput (default = startDate + forecastDays - 1)
   This enables hourly price correlation: the interpretation will calculate the
   exact €/MWh difference between optimal and peak windows and express the
   monetäre Hebelwirkung for flexible load scheduling (heat pumps, EV, storage).
   Treat "startDate" and "endDate" here as USER DATA params per RULE 5 — both
   MUST be null in the step params and declared in requiredInputs with computed defaults.
   Note: if the prices step returns an error (success:false), proceed with EE+CO2 analysis
   only and clearly note "EPEX-Preisdaten nicht verfügbar" in the interpretation.
RULE 9 — Single-installation forecasts (MeLo, MaStR-Nummer, SEE…/SWE…):
When the user provides a specific MeLo (Messlokations-ID, starts with "DE", 33 chars),
a MaStR unit ID (SEE…=solar, SWE…=wind, SAN…=storage), or asks about a single
named installation (e.g. "meine Anlage", "Solaranlage PLZ 47169", serial number):

1. ALWAYS use forecast.generationForecast with:
     "installationMastrNummer": "<SEE/SWE…>"   ← when a MaStR unit ID is known
     "messlokationId":          "<DE…33chars>" ← when only MeLo is known
     "resolution":              "hourly"        ← structural param; keep hardcoded
     "forecastDays":            <from user msg> ← structural param; keep hardcoded

2. NEVER call residual-load.netResidualLoad for single-installation queries.
   That service operates at grid-area (Netzgebiet) level — it requires a region
   or gridOperatorMastrId, NOT a MeLo or a single MaStR unit ID.
   Calling it without a region causes the MCP tool to crash.

3. MeLo and MaStR unit IDs are USER DATA params (RULE 5): extract them as
   requiredInputs with the values from the user message as defaults.

4. §14a / Redispatch eligibility assessment:
   If the user asks about §14a-Dimmen or Redispatch, add a second step using
   residual-load.netResidualLoad ONLY if a named Stadtwerk or DSO (RULE 8
   pipeline) is also part of the query. For single-installation §14a questions,
   include the assessment inline in the interpretation (no extra step needed) —
   a <100 kW residential installation triggers §14a, ≥100 kW may trigger RD 2.0.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: The keys in each step MUST be exactly "action", "params", and "description" — do NOT use "useTool", "args", "inputs", "label", "tool", or any other synonym.
{
  "summary": "<2-3 sentence explanation of your strategy>",
  "steps": [
    {
      "step": 1,
      "action": "<full action name, e.g. gas-storage.countryStorage>",
      "description": "<what this step does>",
      "params": {
        "<paramName>": "<value, null if user must provide or extracted via RULE 5, or __step_N.fieldPath>"
      }
    }
  ],
  "requiredInputs": [
    {
      "name": "<param name that is null in a step above>",
      "label": "<human friendly label>",
      "type": "<string|number|date|select>",
      "options": ["<only for select type>"],
      "default": "<pre-filled value extracted from user message, or omit if unknown>",
      "description": "<help text>",
      "example": "<example value>",
      "required": true
    }
  ]
}`;

        let rawText = '';
        try {
          rawText = await callGemini(prompt);
        } catch (err) {
          throw new Error(`Gemini API error: ${err.message}`);
        }

        // Strip potential markdown fences
        const jsonStr = rawText
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        let plan;
        try {
          plan = JSON.parse(jsonStr);
        } catch {
          throw new Error(`Failed to parse Gemini plan response: ${rawText.substring(0, 300)}`);
        }
        plan = normalizePlan(plan);

        // ── Proactive schema-based param repair ─────────────────────────────
        // Validate every step's param names against the live Moleculer schema.
        // Corrects common LLM mistakes (e.g. gemeinde→region, bdew→bdewCode)
        // before any service call is attempted — no extra LLM round-trip needed.
        const schemaIndex = buildParamSchemaIndex(
          ctx.broker.registry.getServiceList({ withActions: true })
        );
        const planRepairs = repairPlanParams(plan, schemaIndex);
        if (planRepairs.length > 0) {
          this.logger.warn('[Agent] Plan auto-repair: corrected param names', planRepairs);
        }
        // ────────────────────────────────────────────────────────────────────

        const sessionId = crypto.randomUUID();
        const session = {
          id: sessionId,
          createdAt: new Date().toISOString(),
          problem,
          plan,
          planRepairs: planRepairs.length > 0 ? planRepairs : undefined,
          userInputs: null,
          results: null,
          status: 'awaiting_inputs',
        };
        saveSession(session);

        return {
          sessionId,
          summary: plan.summary,
          steps: plan.steps,
          requiredInputs: plan.requiredInputs || [],
        };
      },
    },

    // ------------------------------------------------------------------
    // 2. Execute – Run the plan with user-supplied inputs
    // ------------------------------------------------------------------
    execute: {
      rest: 'POST /execute',
      params: {
        sessionId: { type: 'string', min: 1 },
        userInputs: { type: 'object', optional: true, default: {} },
        refinement: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Execute the planned steps with user-provided parameter values',
        tags: ['AI Agent'],
        description:
          'Runs the execution plan produced by /agent/analyze, substituting user inputs into step params and calling each microservice in sequence. Optionally accepts a free-text refinement which triggers a re-plan.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                  sessionId: {
                    type: 'string',
                    description: 'Session ID returned by /agent/analyze',
                    example: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
                  },
                  userInputs: {
                    type: 'object',
                    description: 'Key-value map of required input values',
                    example: { country: 'de', date: '2026-02-01' },
                  },
                  refinement: {
                    type: 'string',
                    description: 'Optional free-text refinement or follow-up question',
                    example: 'Focus on Bavaria and include the next 7 days',
                  },
                },
              },
              examples: {
                executePlan: {
                  summary: 'Execute an analyzed plan',
                  value: {
                    sessionId: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
                    userInputs: { country: 'de', date: '2026-02-01' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Execution results or re-plan if refinement provided',
          },
        },
      },
      async handler(ctx) {
        const { sessionId, userInputs = {}, refinement } = ctx.params;

        const session = loadSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        // If user provided a refinement text, re-plan before executing
        if (refinement && refinement.trim().length > 0) {
          const services = ctx.broker.registry.getServiceList({ withActions: true });
          const catalogue = buildServiceCatalogue(services);
          const catalogueText = catalogue
            .map(
              (c) =>
                `- **${c.actionName}** (${c.rest}): ${c.description}${c.params.length ? '\n  Params: ' + c.params.join(', ') : ''}`
            )
            .join('\n');

          const today2 = new Date().toISOString().slice(0, 10);
          const refinePrompt = `You are an expert energy-data analyst AI. Today's date is ${today2}.
You have access to the following microservice actions:

${catalogueText}

CRITICAL RULES:
1. If the user mentions a grid operator/DSO by name, add grid-operations.marketPartners as step 1 to resolve it.
2. Use "__step_N.fieldPath" chaining syntax to pass values between steps.
3. Add requiredInputs for any entity identifier not supplied by the user or resolved by a lookup step.
4. For residual load + CO2 queries (RULE 8): always run the 5-step pipeline:
   step 1 grid-operations.marketPartners, step 2 grid-operations.vnbLookup,
   step 3 residual-load.netResidualLoad, step 4 energy-market.co2Intensity,
   step 5 energy-market.prices (market: "day-ahead", region: "Deutschland",
   startDate: null, endDate: null extracted as requiredInputs with computed defaults).
5. NEVER use "gemeinde" as a substitute for "region" in residual-load.netResidualLoad.
   "region" is the city name for SMARD population scaling. Always wire it from
   "__step_1.data.results[0].contacts[0].city".

The user originally asked: "${session.problem}"
Your previous plan was: ${JSON.stringify(session.plan, null, 2)}
The user now says: "${refinement}"

Update the execution plan accordingly. Respond ONLY with valid JSON in the same structure as before:
{
  "summary": "...",
  "steps": [...],
  "requiredInputs": [...]
}`;

          let rawText = '';
          try {
            rawText = await callGemini(refinePrompt);
          } catch (err) {
            throw new Error(`Gemini API error: ${err.message}`);
          }
          const jsonStr = rawText
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/gi, '')
            .trim();
          try {
            session.plan = JSON.parse(jsonStr);
          } catch {
            throw new Error(`Failed to parse refined plan: ${rawText.substring(0, 300)}`);
          }
          session.plan = normalizePlan(session.plan);

          // Proactive param repair on the refined plan too
          const siRef = buildParamSchemaIndex(
            ctx.broker.registry.getServiceList({ withActions: true })
          );
          const refRepairs = repairPlanParams(session.plan, siRef);
          if (refRepairs.length > 0) {
            this.logger.warn('[Agent] Refinement plan auto-repair:', refRepairs);
            session.planRepairs = refRepairs;
          }

          session.status = 'awaiting_inputs';
          session.userInputs = null;
          session.results = null;
          saveSession(session);

          return {
            sessionId,
            status: 'refined',
            summary: session.plan.summary,
            steps: session.plan.steps,
            requiredInputs: session.plan.requiredInputs || [],
          };
        }

        // Merge user inputs into step params (replace nulls)
        // Seed defaults from requiredInputs for any field the user left unchanged
        const effectiveInputs = {};
        for (const ri of session.plan.requiredInputs || []) {
          if (ri.default !== undefined && ri.default !== '') {
            effectiveInputs[ri.name] = ri.default;
          }
        }
        Object.assign(effectiveInputs, userInputs); // user-supplied values win

        // Coerce string values to number/boolean where the plan's type hints say so.
        // HTML form inputs always return strings; Moleculer validators enforce strict types.
        const typeHints = buildTypeHints(session.plan);
        for (const [k, v] of Object.entries(effectiveInputs)) {
          effectiveInputs[k] = coerceValue(v, k, typeHints);
        }

        // Build a set of all declared requiredInput names so we can override
        // even when Gemini hardcoded the value instead of setting it to null
        const requiredInputNames = new Set(
          (session.plan.requiredInputs || []).map((ri) => ri.name)
        );

        const steps = (session.plan.steps || []).map((step) => {
          const resolvedParams = {};
          for (const [k, v] of Object.entries(step.params || {})) {
            // Override when: value is null OR the param is a declared requiredInput
            if ((v === null || requiredInputNames.has(k)) && effectiveInputs[k] !== undefined) {
              resolvedParams[k] = effectiveInputs[k];
            } else {
              resolvedParams[k] = v;
            }
          }
          // Also inject any extra effectiveInputs that match param names
          for (const [k, v] of Object.entries(effectiveInputs)) {
            if (!(k in resolvedParams)) resolvedParams[k] = v;
          }
          return { ...step, params: resolvedParams };
        });

        // Execute each step in sequence
        const stepResults = [];

        for (const step of steps) {
          this.logger.info(`[Agent] Executing step ${step.step}: ${step.action}`);

          // Resolve __step_N.fieldPath chaining references from earlier step results
          const callParams = {};
          for (const [k, v] of Object.entries(step.params || {})) {
            callParams[k] = resolveChainedRef(v, stepResults);
          }

          // Log any unresolved chains (null means lookup returned nothing)
          for (const [k, v] of Object.entries(callParams)) {
            if (v === null) {
              this.logger.warn(
                `[Agent] Step ${step.step} param "${k}" resolved to null — check previous step result`
              );
            }
          }

          // Smart injection for vnbLookup: if city was not chained by Gemini,
          // auto-extract it from any prior marketPartners result so the city
          // fallback in vnbLookup can resolve the SNB from sample installations.
          if (step.action === 'grid-operations.vnbLookup' && !callParams.city) {
            for (const prev of stepResults) {
              const city =
                prev.result?.data?.results?.[0]?.contacts?.[0]?.city ||
                prev.result?.data?.results?.[0]?.city;
              if (city) {
                callParams.city = city;
                this.logger.info(
                  `[Agent] Auto-injected city="${city}" into vnbLookup from step ${prev.step}`
                );
                break;
              }
            }
          }

          let result;
          let error = null;
          if (!step.action) {
            error = `Step ${step.step} has no action defined (plan generation error)`;
            this.logger.error(`[Agent] ${error}`);
          } else {
            try {
              result = await ctx.broker.call(step.action, callParams, {
                meta: ctx.meta,
                timeout: this.settings.defaultTimeout,
              });
            } catch (err) {
              error = err.message;
              result = null;
            }
          }

          stepResults.push({
            step: step.step,
            action: step.action,
            description: step.description,
            params: callParams,
            result,
            error,
          });
        }

        // ----------------------------------------------------------------
        // Self-healing: if chaining produced null params OR the final step
        // returned empty/null, attempt ONE automatic re-plan before giving up.
        // ----------------------------------------------------------------
        const hasNullChain = stepResults.some((s) =>
          Object.values(s.params || {}).some((v) => v === null)
        );
        const lastResult = stepResults[stepResults.length - 1]?.result;
        const isFinalEmpty =
          lastResult == null ||
          (Array.isArray(lastResult) && lastResult.length === 0) ||
          (lastResult?.installations && lastResult.installations.length === 0) ||
          (lastResult?.data?.installations && lastResult.data.installations.length === 0);

        if ((hasNullChain || isFinalEmpty) && !session.repairAttempt) {
          session.repairAttempt = true;

          const services2 = ctx.broker.registry.getServiceList({ withActions: true });
          const cat2 = buildServiceCatalogue(services2);
          const catText2 = cat2
            .map(
              (c) =>
                `- **${c.actionName}** (${c.rest}): ${c.description}${c.params.length ? '\n  Params: ' + c.params.join(', ') : ''}`
            )
            .join('\n');

          const repairPrompt = `You are an expert energy analyst. Today is ${new Date().toISOString().slice(0, 10)}.
You have access to these services:
${catText2}

The user asked: "${session.problem}"

The previous execution plan FAILED. Here are the step results including errors:
${JSON.stringify(
  stepResults.map((s) => ({
    step: s.step,
    action: s.action,
    params: s.params,
    error: s.error,
    resultSummary:
      s.result == null
        ? 'NULL'
        : Array.isArray(s.result)
          ? s.result.length === 0
            ? 'EMPTY ARRAY'
            : s.result.length + ' items'
          : typeof s.result === 'object'
            ? JSON.stringify(s.result).substring(0, 300)
            : String(s.result),
  })),
  null,
  2
)}

CRITICAL:
- DO NOT ask the user for more information. Design a self-contained plan.
- If a parameter resolved to null via chaining, pick a DIFFERENT parameter or service.
- Service response paths MUST include the "data." wrapper (e.g. "__step_1.data.results[0].bdewCode").
- For DSO queries, include ALL three fallbacks: gridOperatorId, bdewCode, vnbName.
- Prefer assets.solar/assets.wind/assets.all over energy-market.installations for VNB-filtered queries.

Respond ONLY with valid JSON:
{
  "summary": "<repaired strategy>",
  "steps": [...],
  "requiredInputs": []
}`;

          let repairRaw = '';
          try {
            repairRaw = await callGemini(repairPrompt);
          } catch (repairErr) {
            this.logger.warn(`[Agent] Self-healing Gemini call failed: ${repairErr.message}`);
          }

          if (repairRaw) {
            const repairJson = repairRaw
              .replace(/```json\s*/gi, '')
              .replace(/```\s*/gi, '')
              .trim();
            let repairedPlan;
            try {
              repairedPlan = JSON.parse(repairJson);
            } catch {
              this.logger.warn(
                '[Agent] Self-healing plan parse failed, continuing with original results'
              );
            }

            if (repairedPlan && repairedPlan.steps && repairedPlan.steps.length > 0) {
              this.logger.info('[Agent] Self-healing: executing repaired plan');
              repairedPlan = normalizePlan(repairedPlan);
              session.plan = repairedPlan;
              saveSession(session);

              // Re-execute the repaired plan (use same effectiveInputs + requiredInputNames override)
              // Extend type hints with the repaired plan so newly typed params are also coerced.
              const repairedTypeHints = buildTypeHints(repairedPlan);
              const mergedTypeHints = { ...typeHints, ...repairedTypeHints };
              const coercedEffective = {};
              for (const [k, v] of Object.entries(effectiveInputs)) {
                coercedEffective[k] = coerceValue(v, k, mergedTypeHints);
              }
              const repairedSteps = (repairedPlan.steps || []).map((step) => {
                const rp = {};
                for (const [k, v] of Object.entries(step.params || {})) {
                  if (
                    (v === null || requiredInputNames.has(k)) &&
                    coercedEffective[k] !== undefined
                  ) {
                    rp[k] = coercedEffective[k];
                  } else {
                    rp[k] = v;
                  }
                }
                for (const [k, v] of Object.entries(coercedEffective)) {
                  if (!(k in rp)) rp[k] = v;
                }
                return { ...step, params: rp };
              });

              stepResults.length = 0; // clear and re-run
              for (const step of repairedSteps) {
                this.logger.info(`[Agent] Repair step ${step.step}: ${step.action}`);
                const callP = {};
                for (const [k, v] of Object.entries(step.params || {})) {
                  callP[k] = resolveChainedRef(v, stepResults);
                }
                // Same smart city injection for vnbLookup in the repair loop
                if (step.action === 'grid-operations.vnbLookup' && !callP.city) {
                  for (const prev of stepResults) {
                    const city =
                      prev.result?.data?.results?.[0]?.contacts?.[0]?.city ||
                      prev.result?.data?.results?.[0]?.city;
                    if (city) {
                      callP.city = city;
                      break;
                    }
                  }
                }
                let res2 = null;
                let err2 = null;
                if (!step.action) {
                  err2 = `Repair step ${step.step} has no action defined (plan generation error)`;
                  this.logger.error(`[Agent] ${err2}`);
                } else {
                  try {
                    res2 = await ctx.broker.call(step.action, callP, {
                      meta: ctx.meta,
                      timeout: this.settings.defaultTimeout,
                    });
                  } catch (e) {
                    err2 = e.message;
                  }
                }
                stepResults.push({
                  step: step.step,
                  action: step.action,
                  description: step.description,
                  params: callP,
                  result: res2,
                  error: err2,
                });
              }
            }
          }
        }

        // Ask Gemini to summarise the combined results
        const allResults = stepResults.map((s) => ({
          step: s.step,
          action: s.action,
          error: s.error,
          // Compact installation arrays: truncate to PROMPT_MAX_ROWS and flatten
          // napData so Gemini never receives nested objects → prevents JSON blobs
          // appearing as tableRow cell values in the interpretation output.
          result: compactStepResult(s.result),
        }));

        const summaryPrompt = `You are an expert energy analyst. The user asked: "${session.problem}"

The following microservice calls were made and returned these results:
${JSON.stringify(allResults, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGULATORY DOMAIN KNOWLEDGE — apply these rules unconditionally:

§ 51 EEG (Vergütungsausfall bei negativen Strompreisen):
- This regulation applies ONLY to EEG-supported installations commissioned
  on or after 01.01.2016 ("Datum Netzzugang" ≥ 2016-01-01).
- Installations commissioned BEFORE 01.01.2016 are NOT subject to § 51 EEG
  and MUST NOT be listed as "at risk" or included in a § 51 risk ranking.
- When showing a table of installations for § 51 risk, include a column
  "§51 betroffen" ("Ja" if commissioned ≥ 2016-01-01, "Nein" otherwise)
  and add a note in the summary explaining this cutoff.

Negative price data reliability:
- If any step result contains "Plausibilitäts-Hinweis (Datenqualität)" or
  "dataReliabilityWarning": true, the negative price count is unreliable.
  MUST mention this prominently in the summary and NOT present 0 as a
  confirmed fact. Explain it as a data availability issue.

Netzbetreiberprüfung vs. Betriebsstatus (CRITICAL distinction — never confuse):
- "Betriebsstatus" (operationalStatus) = connection status of the installation:
    35 = In Betrieb (active, grid-connected)
    31 = In Planung (planned, NOT yet connected)
- "Netzbetreiberprüfung Status" (netzbetreiberPruefungStatus) = review by grid operator:
    2955 = In Prüfung (review still open/in progress)
    2954 = Geprüft (review completed)
    3075 = Nicht vorgesehen
- These are INDEPENDENT. An installation can be "In Betrieb" (Betriebsstatus 35)
  AND simultaneously "In Prüfung" (Netzbetreiberprüfung 2955).
- When displaying results filtered by netzbetreiberPruefungStatus=2955, clearly
  label this column as "Netzbetreiberprüfung" and explain it means the grid
  operator's review is still ongoing — NOT that the unit is unconnected.

Residuallast + CO2-Intensität + EPEX-Preise (Lastmanagement-Synthese):
- When results include a residual load time series, a CO2 intensity forecast,
  AND EPEX day-ahead prices, synthesize all three across the FULL forecast horizon
  (all timestamps returned — 48 data points for 2 days, NOT just 24 for 1 day):

  TIMESTAMPS: Convert ALL UTC timestamps to MEZ/MESZ (UTC+1/UTC+2) before displaying.
  For dates in winter (October–March) use UTC+1 (MEZ).
  For dates in summer (April–September) use UTC+2 (MESZ).
  Label columns as "Zeitpunkt (MEZ)" or "Zeitpunkt (MESZ)" accordingly.
  NEVER show bare UTC timestamps to the user.

  COVERING BOTH DAYS: The forecast covers multiple days as specified by the user.
  The table MUST cover ALL days in the returned forecast data — do not truncate to
  only day 1 even if CO2 data has fewer points than EE data.
  When CO2 data is available for fewer hours than EE data, note this gap but still
  include all EE and load rows in the table.

  DATA QUALITY GATE — check before any synthesis:
  - If any step result contains "dataQualityWarning": true on residual-load.netResidualLoad,
    the loadMW series is ALL ZEROS and MUST NOT be used for Residuallast calculations.
    In this case set needsMoreInput: true and ask the user for "populationOverride".
    The summary MUST start with:
      "⚠️ DATENFEHLER: Die Residuallastberechnung ist nicht möglich, weil die
       SMARD-Lastskalierung 0 MW ergab. Die folgenden Ergebnisse basieren NUR auf
       EE-Erzeugungsdaten und CO2-Intensität — KEINE echte Residuallastanalyse.
       Bitte 'Einwohnerzahl (Population Override)' mit dem Wert für die Stadt
       angeben (z.B. 245.000 für Kiel) und die Analyse neu starten."
    Then proceed with EE-only analysis, clearly labelling every number.

  OPTIMAL WINDOWS (when loadMW > 0 for all points):
  ★ Ideal window = timestamps where BOTH CO2 intensity AND residual load are LOW
    → grid is cheap and clean → ideal for flexible loads (heat pumps, EV, storage)
  ★ Spitzenlast = timestamps where residualLoadMW is highest →
    Beschaffungskosten peak; avoid flexible loads here
  ★ CO2-Spitzen = timestamps where gCO2eqPerKWh is highest → environmentally critical

  OPTIMAL WINDOWS (EE-only, when dataQualityWarning):
  ★ Rank by PV + Wind generation (eeGenerationMW) descending → highest local
    renewable generation = maximum self-coverage potential
  ★ Report EE peak hours in MEZ as the "Grünstromfenster"

  MONETARY ASSESSMENT (always, even in EE-only mode):
  - If EPEX day-ahead prices are available, correlate them with the CO2/EE windows:
    • Find the price spread: cheapest hour vs. most expensive hour (€/MWh).
    • Compute the load-shift saving: (peak_price − optimal_price) × estimatedLoadMW × hours
    • If loadMW = 0, use an explicit placeholder assumption:
        "Bei einer angenommenen Stadtwerk-Grundlast von ca. 30 MW (Platzhalter —
         genaue Berechnung erst nach Eingabe der Einwohnerzahl möglich)"
      and calculate savings with that figure, marked clearly as estimate.
    • Show the monetary lever as "Monetärer Hebel (Lastverschiebung)" in €/day.
  - If EPEX prices are NOT available, explicitly note: "EPEX-Preisdaten nicht verfügbar —
    monetäre Bewertung nicht möglich."

  TABLE STRUCTURE (requiredColumns):
  "Zeitpunkt (MEZ)", "CO2 (g/kWh)", "EE-Erzeugung (MW)", "Residuallast (MW)" or "Last (MW)",
  "EPEX Day-Ahead (€/MWh)", "Bewertung"

  Bewertung column values (choose one):
    "✅ Optimal (Lastverschiebung)"   ← low CO2 + low residual + low price
    "🟡 Gut"                          ← low CO2 OR low price, not both
    "🔴 Vermeiden (CO2-Peak)"         ← CO2 > 250 g/kWh
    "⛔ Teuer + CO2-Reich"            ← high price AND high CO2

  TOP-3 WINDOWS: List the 3 best consecutive 2-hour windows sorted by:
    (1) CO2 g/kWh ascending, then (2) EPEX price ascending, then (3) EE generation descending.
  Show: Start (MEZ), End (MEZ), avg CO2, avg EPEX price, total EE generation, estimated saving €.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Provide:
1. A concise human-readable summary (3-5 sentences) of the findings.
2. An array called "tableColumns" listing the most useful column names to display in a results table.
3. An array called "tableRows" where each row is an object whose keys match tableColumns, derived from the results above. Include as many rows as appropriate.
4. Whether more user input is needed ("needsMoreInput": true/false).
5. If needsMoreInput is true, provide a "followUpQuestion" string.
6. IMPORTANT: If results are empty or null, set needsMoreInput to FALSE and explain in the summary WHY the query returned no data (e.g. operator not in local database, timeout) — do NOT ask the user for a MaStR number or technical ID.

CRITICAL TABLE RULES — violating these prevents automated CSV processing:
- Every cell value in tableRows MUST be a primitive: string, number, boolean, or null.
- NEVER put a JSON object or array as a cell value — this breaks CSV export.
- If a field is a nested object (e.g. napData), add separate flat columns for its
  sub-fields (e.g. "Messlokation", "Spannungsebene") — do NOT JSON-serialize it.
- If a field is an array, join its values as a comma-separated string.
- If data.installations[] is present, map EACH installation to ONE row with flat
  scalar columns — do NOT put the whole array or a sub-object into one cell.

Respond ONLY with valid JSON:
{
  "summary": "...",
  "tableColumns": ["col1", "col2"],
  "tableRows": [{"col1": "...", "col2": "..."}],
  "needsMoreInput": false,
  "followUpQuestion": null
}`;

        let interpretedText = '';
        try {
          interpretedText = await callGemini(summaryPrompt);
        } catch {
          // If Gemini fails for summary, return raw results
          interpretedText = JSON.stringify({
            summary: 'Analysis complete. See raw results below.',
            tableColumns: ['step', 'action', 'result'],
            tableRows: stepResults.map((s) => ({
              step: s.step,
              action: s.action,
              result: JSON.stringify(s.result),
            })),
            needsMoreInput: false,
            followUpQuestion: null,
          });
        }

        const jsonStr2 = interpretedText
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        let interpretation;
        try {
          interpretation = JSON.parse(jsonStr2);
        } catch {
          interpretation = {
            summary: 'Analysis complete.',
            tableColumns: ['step', 'action', 'result'],
            tableRows: stepResults.map((s) => ({
              step: s.step,
              action: s.action,
              result: JSON.stringify(s.result).substring(0, 200),
            })),
            needsMoreInput: false,
            followUpQuestion: null,
          };
        }

        // Safety net: ensure every tableRow cell is a primitive.
        // Despite the prompt instruction, Gemini may occasionally emit nested
        // objects (e.g. napData) — these would show as [object Object] in the
        // UI table and break the CSV export / Live CSV endpoint.
        if (Array.isArray(interpretation.tableRows)) {
          interpretation.tableRows = interpretation.tableRows.map((row) => {
            const flat = {};
            for (const [k, v] of Object.entries(row)) {
              if (Array.isArray(v)) {
                flat[k] = v.join(', ');
              } else if (v !== null && typeof v === 'object') {
                flat[k] = JSON.stringify(v);
              } else {
                flat[k] = v;
              }
            }
            return flat;
          });
        }

        session.userInputs = userInputs;
        // Compact step results before storing to prevent session-oversize crashes.
        // Large result sets (e.g. unfiltered installation queries) can push the
        // serialized session past V8's string-size limit causing RangeError in
        // JSON.stringify. compactStepResult caps arrays at 50 rows — sufficient
        // for interpretation but safe for persistence.
        const storableStepResults = stepResults.map((s) => ({
          ...s,
          result: compactStepResult(s.result),
        }));
        session.results = { stepResults: storableStepResults, interpretation };
        session.status = 'completed';

        // ── Data-quality driven requiredInputs injection ───────────────
        // If any residual-load step returned dataQualityWarning (loadMW=0),
        // inject populationOverride into requiredInputs so the UI renders a
        // form field allowing the user to correct and re-run immediately.
        const populationAlreadyDeclared = (session.plan.requiredInputs || []).some(
          (ri) => ri.name === 'populationOverride'
        );
        if (!populationAlreadyDeclared) {
          for (const sr of stepResults) {
            if (
              sr.result?.dataQualityWarning === true &&
              sr.action === 'residual-load.netResidualLoad'
            ) {
              // Use the population SMARD actually tried (from loadScaling.populationUsed),
              // stripping locale dots so '245.000' becomes the number 245000.
              const smardPop = sr.result?.summary?.loadScaling?.populationUsed;
              const defaultPop = smardPop
                ? parseInt(String(smardPop).replace(/[^0-9]/g, ''), 10) || undefined
                : undefined;

              if (!session.plan.requiredInputs) session.plan.requiredInputs = [];
              session.plan.requiredInputs.push({
                name: 'populationOverride',
                label: 'Einwohnerzahl (Population Override)',
                type: 'number',
                default: defaultPop,
                description:
                  'Die Einwohnerzahl des Netzgebiets für die SMARD-Lastskalierung. ' +
                  'Wird benötigt, weil die automatische Skalierung 0 MW ergab. ' +
                  'Beispiel: 247000 für Kiel.',
                example: 247000,
                required: true,
              });
              this.logger.warn(
                `[Agent] Injected populationOverride requiredInput (default: ${defaultPop}) ` +
                  `after dataQualityWarning in step ${sr.step}`
              );
              saveSession(session); // persist updated plan with new requiredInput
              break;
            }
          }
        }
        // ─────────────────────────────────────────────────────────────────
        // Extract the parameters actually used so Gemini can propose related queries.
        const usedParams = {};
        for (const sr of stepResults) {
          for (const [k, v] of Object.entries(sr.params || {})) {
            if (v !== null && v !== undefined && typeof v !== 'object') usedParams[k] = v;
          }
        }
        const suggestPrompt = `You are an expert energy analyst assistant.

The user just completed this analysis:
Original question: "${session.problem}"
Parameters used: ${JSON.stringify(usedParams)}
Result summary: ${interpretation.summary}

Suggest exactly 3 follow-up research questions that:
- Are meaningfully different from the original question (new angle, deeper dive, comparison, trend, etc.)
- REUSE the same specific parameter values where appropriate (same PLZ, region, operator, date, etc.)
- Would be actionable with the same set of microservices
- Are concise (max 15 words each), in the same language as the original question

Examples of good suggestions when PLZ "69" and type "solar" were used:
- "Entwicklung neuer PV-Anlagen in PLZ 69xxx nach Jahr (2020-2025)"
- "Windkraftanlagen im gleichen PLZ-Bereich 69xxx"
- "Vergleich: PV-Leistung PLZ 69xxx vs. PLZ 68xxx"

Respond ONLY with a JSON array of exactly 3 strings:
["suggestion 1", "suggestion 2", "suggestion 3"]`;

        let suggestions = [];
        try {
          const suggestRaw = await callGemini(suggestPrompt);
          const suggestJson = suggestRaw
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/gi, '')
            .trim();
          const parsed = JSON.parse(suggestJson);
          if (Array.isArray(parsed))
            suggestions = parsed.slice(0, 3).filter((s) => typeof s === 'string');
        } catch {
          // Suggestions are best-effort — never block the response
        }

        session.results.suggestions = suggestions;

        // ── Suggest charts ─────────────────────────────────────────
        // Only meaningful when there are rows and at least 2 columns.
        let chartSuggestions = [];
        if (interpretation.tableColumns?.length >= 2 && interpretation.tableRows?.length >= 1) {
          const sampleRows = interpretation.tableRows.slice(0, 5);
          const chartPrompt = `You are a data visualisation expert.

A data table has these columns: ${JSON.stringify(interpretation.tableColumns)}
Sample rows (up to 5): ${JSON.stringify(sampleRows)}
Context: the user asked "${session.problem}"

Suggest up to 3 charts that would be most insightful for this data.
For each chart, choose the BEST available chart type for the data:
- "bar"  — comparing discrete categories
- "line" — trends over time or ordered values
- "pie"  — part-of-whole, use only when there are <= 8 distinct categories
- "scatter" — correlation between two numeric fields

Rules:
- xField and yField MUST be exact column names from the list above
- colorField is optional; use it only when a categorical grouping adds value
- yField must reference a column that contains numeric data (capacity, count, percentage, MW, kW, etc.)
- xField should be a label or category (name, year, region, type, date, etc.)
- Do not suggest a chart if there are no numeric columns
- Titles must be concise (max 8 words), in the same language as the original question

Respond ONLY with a JSON array (empty array [] if no good chart is possible):
[
  {
    "type": "bar",
    "title": "Installed capacity by operator",
    "xField": "Betreiber",
    "yField": "Leistung kWp",
    "colorField": null
  }
]`;
          try {
            const chartRaw = await callGemini(chartPrompt);
            const chartJson = chartRaw
              .replace(/```json\s*/gi, '')
              .replace(/```\s*/gi, '')
              .trim();
            const parsed = JSON.parse(chartJson);
            if (Array.isArray(parsed)) {
              chartSuggestions = parsed.filter((c) => c.type && c.xField && c.yField).slice(0, 3);
            }
          } catch {
            // Chart suggestions are best-effort — never block the response
          }
        }

        session.results.chartSuggestions = chartSuggestions;
        saveSession(session);

        return {
          sessionId,
          status: 'completed',
          summary: interpretation.summary,
          tableColumns: interpretation.tableColumns || [],
          tableRows: interpretation.tableRows || [],
          needsMoreInput: interpretation.needsMoreInput || false,
          followUpQuestion: interpretation.followUpQuestion || null,
          suggestions,
          chartSuggestions,
          stepResults,
          requiredInputs: session.plan.requiredInputs || [],
          shareUrl: `${process.env.API_URL || 'http://localhost:3000'}/app?session=${sessionId}`,
        };
      },
    },

    // ------------------------------------------------------------------
    // 3. Get session – Load a persisted session by ID
    // ------------------------------------------------------------------
    getSession: {
      rest: 'GET /session/:id',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Retrieve a persisted agent session by ID',
        tags: ['AI Agent'],
        description:
          'Load a previously executed session so the user can revisit results or re-run.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              example: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
            },
            description: 'Session UUID returned by /agent/analyze',
          },
        ],
      },
      async handler(ctx) {
        const session = loadSession(ctx.params.id);
        if (!session) {
          const err = new Error(`Session not found: ${ctx.params.id}`);
          err.code = 404;
          throw err;
        }
        return session;
      },
    },

    // ------------------------------------------------------------------
    // 4. CSV Export – Re-run the plan fresh and return last step as CSV
    // ------------------------------------------------------------------
    csvExport: {
      rest: 'GET /session/:id/csv',
      params: {
        id: { type: 'string', min: 1 },
        $$strict: false, // allow arbitrary GET query params to override inputs
      },
      openapi: {
        summary: 'Re-run the session plan and export results as CSV',
        tags: ['AI Agent'],
        description:
          'Re-executes the full plan with the saved user inputs, injects format=csv into the last data step, and returns a fresh CSV file. The data is always fetched live from the source.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              example: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
            },
            description: 'Session UUID',
          },
        ],
        responses: {
          200: {
            description: 'CSV file',
            content: { 'text/csv': { schema: { type: 'string' } } },
          },
        },
      },
      async handler(ctx) {
        const session = loadSession(ctx.params.id);
        if (!session) {
          const err = new Error(`Session not found: ${ctx.params.id}`);
          err.code = 404;
          throw err;
        }

        const steps = normalizePlan(session.plan)?.steps || [];
        // Seed defaults from requiredInputs, then overlay saved userInputs,
        // then overlay any GET query params passed in the URL (they take highest priority)
        const effectiveInputsCSV = {};
        for (const ri of session.plan.requiredInputs || []) {
          if (ri.default !== undefined && ri.default !== '')
            effectiveInputsCSV[ri.name] = ri.default;
        }
        Object.assign(effectiveInputsCSV, session.userInputs || {});
        // Overlay GET query params (everything in ctx.params except 'id')
        for (const [k, v] of Object.entries(ctx.params)) {
          if (k !== 'id' && v !== undefined && v !== '') effectiveInputsCSV[k] = v;
        }
        // Coerce string values (form inputs / URL params) to number/boolean as needed
        const typeHintsCSV = buildTypeHints(session.plan);
        for (const [k, v] of Object.entries(effectiveInputsCSV)) {
          effectiveInputsCSV[k] = coerceValue(v, k, typeHintsCSV);
        }
        const userInputs = effectiveInputsCSV;

        // Any declared requiredInput name gets overridden even if Gemini hardcoded it
        const requiredInputNamesCSV = new Set(
          (session.plan.requiredInputs || []).map((ri) => ri.name)
        );
        const stepResults = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const isLastStep = i === steps.length - 1;

          // Resolve chained params + user inputs
          const callParams = {};
          for (const [k, v] of Object.entries(step.params || {})) {
            let resolved = resolveChainedRef(v, stepResults);
            // Override when: resolved is null OR param is a declared requiredInput
            if (
              (resolved === null || requiredInputNamesCSV.has(k)) &&
              userInputs[k] !== undefined
            ) {
              resolved = userInputs[k];
            }
            callParams[k] = resolved;
          }
          for (const [k, v] of Object.entries(userInputs)) {
            if (!(k in callParams)) callParams[k] = v;
          }

          // Smart city injection for vnbLookup
          if (step.action === 'grid-operations.vnbLookup' && !callParams.city) {
            for (const prev of stepResults) {
              const city =
                prev.result?.data?.results?.[0]?.contacts?.[0]?.city ||
                prev.result?.data?.results?.[0]?.city;
              if (city) {
                callParams.city = city;
                break;
              }
            }
          }

          // Inject CSV format into the last step
          if (isLastStep) callParams.format = 'csv';

          let result = null;
          let error = null;
          try {
            result = await ctx.broker.call(step.action, callParams, {
              meta: ctx.meta,
              timeout: this.settings.defaultTimeout,
            });
          } catch (err) {
            error = err.message;
          }
          stepResults.push({
            step: step.step,
            action: step.action,
            params: callParams,
            result,
            error,
          });
        }

        const lastResult = stepResults[stepResults.length - 1]?.result;
        const filename = `cernion-${ctx.params.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;

        // If the last step returned a CSV string directly (assets service format='csv')
        if (typeof lastResult === 'string' && lastResult.length > 0) {
          ctx.meta.$responseHeaders = {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          };
          return lastResult;
        }

        // Fallback: build CSV from saved interpretation tableRows
        const { tableColumns, tableRows } = session.results?.interpretation || {};
        if (tableColumns?.length && tableRows?.length) {
          const escape = (v) => {
            const s = String(v ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          };
          const lines = [
            tableColumns.join(','),
            ...tableRows.map((row) => tableColumns.map((c) => escape(row[c])).join(',')),
          ];
          ctx.meta.$responseHeaders = {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
          };
          return lines.join('\n');
        }

        throw new Error('No exportable data found in this session');
      },
    },

    // ------------------------------------------------------------------
    // 5. Rerun – Re-execute a completed session (same plan + same inputs)
    // ------------------------------------------------------------------
    rerun: {
      rest: 'POST /rerun',
      params: {
        sessionId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Re-run a completed session with the same plan and inputs',
        tags: ['AI Agent'],
        description: 'Useful for the shareable-URL feature: load a session and re-execute it.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                  sessionId: {
                    type: 'string',
                    example: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
                  },
                },
              },
              examples: {
                rerunSession: {
                  summary: 'Re-run a previous session',
                  value: {
                    sessionId: '2a70e478-90ce-4fa5-b996-6f98efdba7cf',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const session = loadSession(ctx.params.sessionId);
        if (!session) {
          const err = new Error(`Session not found: ${ctx.params.sessionId}`);
          err.code = 404;
          throw err;
        }
        // Re-execute with saved inputs
        return ctx.call('agent.execute', {
          sessionId: ctx.params.sessionId,
          userInputs: session.userInputs || {},
        });
      },
    },
  },

  created() {
    this.logger.info('AI Agent service created');
    ensureSessionDir();
  },
};
