'use strict';

const { phaseSettings, withPhase } = require('../src/llm-phases');

test('phases default to fast in-turn models and a premium reflection model', () => {
  const env = { LLM_PROVIDER: 'gemini' };
  expect(phaseSettings('case_update', env)).toEqual({
    model: 'gemini-3.5-flash-lite',
    thinking: 'minimal',
  });
  expect(phaseSettings('case_reflection', env)).toEqual({
    model: 'gemini-4-argon',
    thinking: 'high',
  });
  expect(phaseSettings('unknown', env)).toEqual({ model: undefined, thinking: undefined });
  expect(phaseSettings('case_update', { LLM_PROVIDER: 'ollama' })).toEqual({
    model: undefined,
    thinking: undefined,
  });
});

test('LLM_PHASE_MODELS overrides per phase; an empty model keeps the provider default', () => {
  const env = {
    LLM_PROVIDER: 'gemini',
    LLM_PHASE_MODELS: 'case_reflection=gemini-3.1-pro-preview:low, case_review=:low',
  };
  expect(phaseSettings('case_reflection', env)).toEqual({
    model: 'gemini-3.1-pro-preview',
    thinking: 'low',
  });
  expect(phaseSettings('case_review', env)).toEqual({ model: undefined, thinking: 'low' });
  expect(phaseSettings('case_update', env)).toEqual({
    model: 'gemini-3.5-flash-lite',
    thinking: 'minimal',
  });
});

test('explicit options win over the phase; calls without a phase are unchanged', () => {
  const env = { LLM_PROVIDER: 'gemini' };
  expect(withPhase({ phase: 'case_update', tenantId: 't' }, env)).toEqual({
    phase: 'case_update',
    tenantId: 't',
    model: 'gemini-3.5-flash-lite',
    thinking: 'minimal',
  });
  expect(withPhase({ phase: 'case_update', model: 'x', thinking: 'low' }, env)).toEqual({
    phase: 'case_update',
    model: 'x',
    thinking: 'low',
  });
  const plain = { tenantId: 't' };
  expect(withPhase(plain, env)).toBe(plain);
});
