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
  fs.writeFileSync(path.join(SESSION_DIR, `${session.id}.json`), JSON.stringify(session, null, 2));
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
            const t = typeof v === 'string' ? v : v.type || 'string';
            const opt = typeof v === 'object' && v.optional ? '?' : '';
            const enumVals =
              typeof v === 'object' && v.values ? `[${v.values.join('|')}]` : '';
            const dflt =
              typeof v === 'object' && v.default !== undefined ? `=${v.default}` : '';
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
    action:      step.action      || step.useTool   || step.tool    || step.service || '',
    params:      step.params      || step.args      || step.inputs  || step.input   || {},
    description: step.description || step.label     || step.name    || '',
  }));
  return plan;
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
  includeStats, includeValidation, operationalStatus, verbose, language,
  outputFormat, resolution, forecastDays, topN, includeTrend, includeDetails

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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Respond ONLY with valid JSON (no markdown, no explanation outside the JSON) in this exact structure.
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

        const sessionId = crypto.randomUUID();
        const session = {
          id: sessionId,
          createdAt: new Date().toISOString(),
          problem,
          plan,
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
                  },
                  userInputs: {
                    type: 'object',
                    description: 'Key-value map of required input values',
                    example: { country: 'de', date: '2026-02-01' },
                  },
                  refinement: {
                    type: 'string',
                    description: 'Optional free-text refinement or follow-up question',
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
        for (const ri of (session.plan.requiredInputs || [])) {
          if (ri.default !== undefined && ri.default !== '') {
            effectiveInputs[ri.name] = ri.default;
          }
        }
        Object.assign(effectiveInputs, userInputs); // user-supplied values win

        // Build a set of all declared requiredInput names so we can override
        // even when Gemini hardcoded the value instead of setting it to null
        const requiredInputNames = new Set((session.plan.requiredInputs || []).map(ri => ri.name));

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
          try {
            result = await ctx.broker.call(step.action, callParams, {
              meta: ctx.meta,
              timeout: this.settings.defaultTimeout,
            });
          } catch (err) {
            error = err.message;
            result = null;
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
              this.logger.warn('[Agent] Self-healing plan parse failed, continuing with original results');
            }

            if (repairedPlan && repairedPlan.steps && repairedPlan.steps.length > 0) {
              this.logger.info('[Agent] Self-healing: executing repaired plan');
              session.plan = repairedPlan;
              saveSession(session);

              // Re-execute the repaired plan (use same effectiveInputs + requiredInputNames override)
              const repairedSteps = (repairedPlan.steps || []).map((step) => {
                const rp = {};
                for (const [k, v] of Object.entries(step.params || {})) {
                  if ((v === null || requiredInputNames.has(k)) && effectiveInputs[k] !== undefined) {
                    rp[k] = effectiveInputs[k];
                  } else {
                    rp[k] = v;
                  }
                }
                for (const [k, v] of Object.entries(effectiveInputs)) {
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
                    if (city) { callP.city = city; break; }
                  }
                }
                let res2 = null;
                let err2 = null;
                try {
                  res2 = await ctx.broker.call(step.action, callP, {
                    meta: ctx.meta,
                    timeout: this.settings.defaultTimeout,
                  });
                } catch (e) {
                  err2 = e.message;
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
          result: s.result,
        }));

        const summaryPrompt = `You are an expert energy analyst. The user asked: "${session.problem}"

The following microservice calls were made and returned these results:
${JSON.stringify(allResults, null, 2)}

Provide:
1. A concise human-readable summary (3-5 sentences) of the findings.
2. An array called "tableColumns" listing the most useful column names to display in a results table.
3. An array called "tableRows" where each row is an object whose keys match tableColumns, derived from the results above. Include as many rows as appropriate.
4. Whether more user input is needed ("needsMoreInput": true/false).
5. If needsMoreInput is true, provide a "followUpQuestion" string.
6. IMPORTANT: If results are empty or null, set needsMoreInput to FALSE and explain in the summary WHY the query returned no data (e.g. operator not in local database, timeout) — do NOT ask the user for a MaStR number or technical ID.

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

        session.userInputs = userInputs;
        session.results = { stepResults, interpretation };
        session.status = 'completed';
        saveSession(session);

        return {
          sessionId,
          status: 'completed',
          summary: interpretation.summary,
          tableColumns: interpretation.tableColumns || [],
          tableRows: interpretation.tableRows || [],
          needsMoreInput: interpretation.needsMoreInput || false,
          followUpQuestion: interpretation.followUpQuestion || null,
          stepResults,
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
            schema: { type: 'string' },
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
            schema: { type: 'string' },
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
        for (const ri of (session.plan.requiredInputs || [])) {
          if (ri.default !== undefined && ri.default !== '') effectiveInputsCSV[ri.name] = ri.default;
        }
        Object.assign(effectiveInputsCSV, session.userInputs || {});
        // Overlay GET query params (everything in ctx.params except 'id')
        for (const [k, v] of Object.entries(ctx.params)) {
          if (k !== 'id' && v !== undefined && v !== '') effectiveInputsCSV[k] = v;
        }
        const userInputs = effectiveInputsCSV;

        // Any declared requiredInput name gets overridden even if Gemini hardcoded it
        const requiredInputNamesCSV = new Set((session.plan.requiredInputs || []).map(ri => ri.name));
        const stepResults = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const isLastStep = i === steps.length - 1;

          // Resolve chained params + user inputs
          const callParams = {};
          for (const [k, v] of Object.entries(step.params || {})) {
            let resolved = resolveChainedRef(v, stepResults);
            // Override when: resolved is null OR param is a declared requiredInput
            if ((resolved === null || requiredInputNamesCSV.has(k)) && userInputs[k] !== undefined) {
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
              if (city) { callParams.city = city; break; }
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
          stepResults.push({ step: step.step, action: step.action, params: callParams, result, error });
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
                  sessionId: { type: 'string' },
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
