'use strict';

// Phase-specific models (operator decision of 2026-11-08): fast models where an answer waits,
// a premium reasoning model for background reflection. A call names its phase; an explicit
// options.model always wins. LLM_PHASE_MODELS overrides the defaults:
//   LLM_PHASE_MODELS=case_update=gemini-3.5-flash-lite:minimal,case_reflection=gemini-4-argon:high
// An empty model keeps the provider default for that phase ("case_review=:low").

const DEFAULTS = Object.freeze({
  gemini: Object.freeze({
    // In-turn: work model, evidence kinds and route fit (benchmark: ~3 s vs ~21 s).
    case_update: { model: 'gemini-3.5-flash-lite', thinking: 'minimal' },
    // In-turn: pre-output check of the drafted answer against the case state.
    case_review: { model: 'gemini-3.5-flash-lite', thinking: 'minimal' },
    // Background, after the turn: hypothesis lifecycle, source comparison, closure.
    case_reflection: { model: 'gemini-4-argon', thinking: 'high' },
    // In-turn: how material from other conversations or cases may be used (CTX-01).
    context_gate: { model: 'gemini-3.5-flash-lite', thinking: 'minimal' },
  }),
});

function parse(value) {
  const phases = {};
  for (const entry of String(value || '').split(',')) {
    const [name, spec = ''] = entry.split('=').map((part) => part.trim());
    if (!name) continue;
    const [model, thinking] = spec.split(':').map((part) => part.trim());
    phases[name] = { model: model || undefined, thinking: thinking || undefined };
  }
  return phases;
}

function phaseSettings(phase, env = process.env) {
  if (!phase) return {};
  const provider = String(env.LLM_PROVIDER || 'gemini').toLowerCase();
  const configured = parse(env.LLM_PHASE_MODELS)[phase];
  const fallback = DEFAULTS[provider]?.[phase] || {};
  return {
    model: configured ? configured.model : fallback.model,
    thinking: configured ? configured.thinking : fallback.thinking,
  };
}

// Options for one call: explicit model/thinking stay, the phase fills what is missing.
function withPhase(options = {}, env = process.env) {
  if (!options?.phase) return options;
  const settings = phaseSettings(options.phase, env);
  return {
    ...options,
    ...(options.model || !settings.model ? {} : { model: settings.model }),
    ...(options.thinking != null || !settings.thinking ? {} : { thinking: settings.thinking }),
  };
}

module.exports = { DEFAULTS, phaseSettings, withPhase };
