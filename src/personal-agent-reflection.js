'use strict';

/**
 * personal-agent-reflection.js — v0.57.5
 *
 * Pure builder and validator helpers for the one-shot Receipt Reflection /
 * Context-Hydration Loop (GitHub Issue #158).
 *
 * This module MUST NOT call llm-client, broker, or any async APIs.
 * The LLM call is performed by the service via this.callLlmGenerate().
 * Sources for the reflection prompt are bounded to the current user message
 * and same-session consultation history only — no cross-tenant or cross-session data.
 */

const { DECISIVE_PARAMS } = require('./personal-agent-context');

/**
 * JSON schema for the structured LLM output of the reflection step.
 * The LLM must return only fields that were already whitelisted at call time.
 */
const REFLECTION_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['resolvedContextPatch', 'confidence', 'evidence', 'unresolvedScopes'],
  additionalProperties: false,
  properties: {
    resolvedContextPatch: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'string', maxLength: 400 },
    unresolvedScopes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

/**
 * Derives the allowed field set for a reflection patch.
 * Whitelist = DECISIVE_PARAMS ∪ missingRequiredInputs ∪ scope-implied fields.
 *
 * @param {string[]} missingRequiredInputs - Fields declared as required by the receipt.
 * @param {Array<{scope: string}>} scopeViolations - Scope violations from evaluation.
 * @returns {Set<string>}
 */
function buildReflectionAllowedFields(missingRequiredInputs = [], scopeViolations = []) {
  const allowed = new Set(DECISIVE_PARAMS);

  for (const field of missingRequiredInputs) {
    if (typeof field === 'string' && field.trim()) {
      allowed.add(field.trim());
    }
  }

  for (const violation of scopeViolations) {
    if (!violation || typeof violation.scope !== 'string') continue;
    // Map known scope names to their implied context fields
    if (violation.scope === 'locationScope') {
      allowed.add('city');
      allowed.add('postalCode');
      allowed.add('municipality');
      allowed.add('location');
    } else if (violation.scope === 'operatorScope') {
      allowed.add('gridOperatorName');
      allowed.add('bdewCode');
      allowed.add('bdew');
      allowed.add('gridOperatorId');
    }
  }

  return allowed;
}

/**
 * Builds the system + user prompt for the one-shot reflection LLM call.
 *
 * Sources are bounded to:
 * - current user message (already scrubbed by caller)
 * - bounded same-session consultation history from #149 (already sanitized)
 * - current knownContext keys/values (no raw inhouse data, no tool output)
 *
 * The prompt instructs the LLM to extract ONLY fields from missingRequiredInputs
 * and scopeViolations, and to invent nothing.
 *
 * @param {object} params
 * @param {string} params.userMessage - Current user message.
 * @param {Array<{role: string, text: string}>} params.consultationHistory - Bounded same-session window.
 * @param {object} params.knownContext - Current resolved context (keys/values only).
 * @param {string[]} params.missingRequiredInputs - Fields the receipt requires but are missing.
 * @param {Array<{scope: string, message?: string}>} params.scopeViolations - Scope violations.
 * @param {string|null} params.receiptId - Receipt ID for tracing only (not a decision signal).
 * @returns {{ system: string, user: string }}
 */
function buildReflectionPrompt({
  userMessage = '',
  consultationHistory = [],
  knownContext = {},
  missingRequiredInputs = [],
  scopeViolations = [],
  receiptId = null,
} = {}) {
  const missingList =
    missingRequiredInputs.length > 0 ? missingRequiredInputs.join(', ') : '(keine)';

  const scopeList =
    scopeViolations.length > 0
      ? scopeViolations
          .map((v) => `${String(v.scope || '')}: ${String(v.message || '')}`.trim())
          .join('; ')
      : '(keine)';

  const historyLines =
    Array.isArray(consultationHistory) && consultationHistory.length > 0
      ? consultationHistory
          .map((e) => `${e.role === 'user' ? 'User' : 'Agent'}: ${String(e.text || '').trim()}`)
          .join('\n')
      : '(keine vorherigen Nachrichten)';

  const contextKeys = Object.keys(knownContext || {}).filter((k) => {
    const v = knownContext[k];
    return v !== undefined && v !== null && v !== '';
  });
  const contextSummary =
    contextKeys.length > 0
      ? contextKeys.map((k) => `${k}: ${String(knownContext[k]).slice(0, 80)}`).join(', ')
      : '(kein Kontext vorhanden)';

  const systemPrompt = [
    'Du bist ein Kontext-Extraktions-Assistent für einen deterministischen Energie-Agenten.',
    '',
    'Deine Aufgabe: Extrahiere aus der aktuellen Nutzeranfrage und der bereitgestellten',
    'Sitzungshistorie ausschließlich die fehlenden strukturierten Felder.',
    '',
    'REGELN:',
    '- Extrahiere NUR Felder, die explizit in der Nachricht oder in der Sitzungshistorie stehen.',
    '- Erfinde keine Werte. Bei Unsicherheit lasse das Feld weg.',
    '- Gib AUSSCHLIESSLICH Felder zurück, die in den unten genannten fehlenden Eingaben oder',
    '  Scope-Verletzungen aufgeführt sind.',
    '- Kein Markdown, keine Erklärung außerhalb des JSON.',
    `- Fehlende Pflichtfelder: ${missingList}`,
    `- Scope-Verletzungen: ${scopeList}`,
    ...(receiptId ? [`- (Trace-Kennung: ${receiptId})`] : []),
  ].join('\n');

  const userPrompt = [
    `Aktuelle Nutzeranfrage: "${String(userMessage).slice(0, 800).trim()}"`,
    '',
    `Bekannter Kontext: ${contextSummary}`,
    '',
    'Sitzungshistorie (älteste zuerst):',
    historyLines,
    '',
    'Extrahiere die fehlenden Felder als resolvedContextPatch.',
    'Gib confidence (high/medium/low), evidence (Textzitat) und',
    'unresolvedScopes (nicht auflösbare Scopes) an.',
  ].join('\n');

  return { system: systemPrompt, user: userPrompt };
}

/**
 * Validates and sanitizes a reflection patch against the allowed field whitelist.
 *
 * Any key not in DECISIVE_PARAMS ∪ missingRequiredInputs ∪ scope-implied fields,
 * and any non-string or blank value, is rejected.
 *
 * Cross-tenant / cross-session leakage cannot be detected from values; protection
 * is provided by input-source bounding at the call site (only current session and
 * current request data is passed to buildReflectionPrompt).
 *
 * @param {object} params
 * @param {object} params.patch - Raw resolvedContextPatch from the LLM.
 * @param {string[]} params.missingRequiredInputs - Receipt-required missing fields.
 * @param {Array<{scope: string}>} params.scopeViolations - Scope violations from evaluation.
 * @returns {{ sanitizedPatch: object, rejectedKeys: string[] }}
 */
function validateReflectionPatch({
  patch = {},
  missingRequiredInputs = [],
  scopeViolations = [],
} = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { sanitizedPatch: {}, rejectedKeys: [] };
  }

  const allowedFields = buildReflectionAllowedFields(missingRequiredInputs, scopeViolations);
  const sanitizedPatch = {};
  const rejectedKeys = [];

  for (const [key, value] of Object.entries(patch)) {
    if (!allowedFields.has(key)) {
      rejectedKeys.push(key);
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      rejectedKeys.push(key);
      continue;
    }
    sanitizedPatch[key] = value.trim();
  }

  return { sanitizedPatch, rejectedKeys };
}

/**
 * Returns true if the receipt evaluation has at least one step that is
 * scope-blocked or missing-input — i.e., reflection might help resolve it.
 *
 * @param {object|null} evaluation - Receipt evaluation from agent-receipts.select.
 * @returns {boolean}
 */
function hasScopeBlockedOrMissingSteps(evaluation = null) {
  if (!evaluation) return false;
  if (
    Array.isArray(evaluation.missingRequiredInputs) &&
    evaluation.missingRequiredInputs.length > 0
  ) {
    return true;
  }
  if (Array.isArray(evaluation.plannedToolCalls)) {
    return evaluation.plannedToolCalls.some(
      (step) => step?.status === 'scope-blocked' || step?.status === 'missing-input'
    );
  }
  return false;
}

module.exports = {
  REFLECTION_OUTPUT_SCHEMA,
  buildReflectionPrompt,
  validateReflectionPatch,
  hasScopeBlockedOrMissingSteps,
  buildReflectionAllowedFields, // exported for tests
};
