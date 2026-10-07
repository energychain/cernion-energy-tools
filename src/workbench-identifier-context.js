'use strict';

const { scrubForLLM, scrubPromptText } = require('./prompt-scrubber');

// Keep local reference values reversible while the shared facade still scrubs
// email, account and telephone patterns. Never send the local reidentification map.
function opaqueContext(value) {
  const encoded = JSON.stringify(value);
  const candidates = [
    ...new Set(
      [...encoded.matchAll(/\b[A-Za-z\d_-]*\d[A-Za-z\d_-]{4,}\b/g)]
        .filter(
          (match) =>
            !/^\d{4}-\d{2}-\d{2}$/.test(match[0]) &&
            !/[\w@.]/.test(encoded[match.index - 1] || '') &&
            !/[\w@.]/.test(encoded[match.index + match[0].length] || '')
        )
        .map((match) => match[0])
    ),
  ];
  const { scrubbed, reidentMap } = scrubForLLM(
    candidates.map((candidate) => ({ value: candidate })),
    {
      additionalBlocklist: ['value'],
      maxRows: candidates.length,
    }
  );
  const substitutions = new Map(
    candidates.map((candidate, index) => [candidate, scrubbed[index].value])
  );
  const masked = encoded.replace(/\b[A-Za-z\d_-]*\d[A-Za-z\d_-]{4,}\b/g, (token, offset) => {
    if (
      /[\w@.]/.test(encoded[offset - 1] || '') ||
      /[\w@.]/.test(encoded[offset + token.length] || '')
    )
      return token;
    return substitutions.get(token) || token;
  });
  return { value: JSON.parse(scrubPromptText(masked, { reidentMap })), reidentMap };
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
