'use strict';

const { scrubForLLM, mapStringValues, scrubPromptValues } = require('./prompt-scrubber');

// Keep local reference values reversible while the shared facade still scrubs
// email, account and telephone patterns. Never send the local reidentification map.
function opaqueContext(value) {
  const tokens = /[\p{L}\p{N}_-]{5,}/gu;
  const boundary = /[\p{L}\p{N}_@.]/u;
  const candidates = new Set();
  mapStringValues(value, (text) => {
    for (const match of text.matchAll(tokens)) {
      if (
        /\d/.test(match[0]) &&
        !/^\d{4}-\d{2}-\d{2}$/.test(match[0]) &&
        !boundary.test(text[match.index - 1] || '') &&
        !boundary.test(text[match.index + match[0].length] || '')
      )
        candidates.add(match[0]);
    }
    return text;
  });
  const references = [...candidates];
  const { scrubbed, reidentMap } = scrubForLLM(
    references.map((candidate) => ({ value: candidate })),
    {
      additionalBlocklist: ['value'],
      maxRows: references.length,
    }
  );
  const substitutions = new Map(
    references.map((candidate, index) => [candidate, scrubbed[index].value])
  );
  const masked = mapStringValues(value, (text) =>
    text.replace(tokens, (token, offset) => {
      if (boundary.test(text[offset - 1] || '') || boundary.test(text[offset + token.length] || ''))
        return token;
      return substitutions.get(token) || token;
    })
  );
  return { value: scrubPromptValues(masked, { reidentMap }), reidentMap };
}

function restoreContext(value, reidentMap) {
  // Replace JSON string values, never raw JSON syntax or property names.
  if (typeof value === 'string') {
    let result = value;
    for (const [placeholder, original] of reidentMap) {
      result = result.split(placeholder).join(original);
      // Models sometimes omit brackets. Restore only an exact known token,
      // never a prefix of another token and never JSON keys or unknown values.
      const bare = placeholder.slice(1, -1);
      result = result.replaceAll(bare, (match, offset, input) => {
        const before = input[offset - 1] || '';
        const after = input[offset + match.length] || '';
        return /[\w-]/.test(before) || /[\w-]/.test(after) ? match : original;
      });
    }
    return result.replace(/\[?(?:[A-Z]+-MASKED|MASKED-[\w-]+)\]?/g, '[Angabe]');
  }
  if (Array.isArray(value)) return value.map((entry) => restoreContext(entry, reidentMap));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, restoreContext(entry, reidentMap)])
    );
  return value;
}
module.exports = { opaqueContext, restoreContext };
