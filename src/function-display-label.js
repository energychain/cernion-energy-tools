'use strict';
const vocabulary = require('./function-display-vocabulary.json');

// Deterministic localization of catalog terms. Unknown internal tokens never reach labels.
function functionDisplayLabel(fn) {
  const tokens = String(fn.label || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  const words = [...new Set(tokens.map((token) => vocabulary[token]).filter(Boolean))];
  return words.join(' · ') || 'Fachliche Unterstützung';
}
module.exports = { functionDisplayLabel };
