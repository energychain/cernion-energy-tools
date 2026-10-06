'use strict';

const FACADE_MODEL = 'cernion-agent-mvp';
const GOVERNANCE_MODEL = 'cernion-governance-assistant';
// Preserve accepted compatibility aliases; discovery and validation share this source.
const SUPPORTED_MODELS = new Set([
  FACADE_MODEL,
  GOVERNANCE_MODEL,
  'cernion-agent',
  'gpt-4o-mini',
  'gpt-4o',
]);
module.exports = { FACADE_MODEL, GOVERNANCE_MODEL, SUPPORTED_MODELS };
