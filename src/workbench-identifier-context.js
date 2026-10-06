'use strict';

const { scrubForLLM } = require('./prompt-scrubber');

// Keep local reference values reversible while the shared facade still scrubs
// email, account and telephone patterns. Never send the local reidentification map.
function opaqueContext(value) {
  const encoded = JSON.stringify(value);
  const candidates = [
    ...new Set(
      [...encoded.matchAll(/\b[A-Za-z\d_-]*\d[A-Za-z\d_-]{4,}\b/g)]
        .filter(
          (match) =>
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
  return { value: JSON.parse(masked), reidentMap };
}

function restoreContext(value, reidentMap) {
  // Replace JSON string values, never raw JSON syntax or property names.
  if (typeof value === 'string') {
    let result = value;
    for (const [placeholder, original] of reidentMap)
      result = result.split(placeholder).join(original);
    return result;
  }
  if (Array.isArray(value)) return value.map((entry) => restoreContext(entry, reidentMap));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, restoreContext(entry, reidentMap)])
    );
  return value;
}
module.exports = { opaqueContext, restoreContext };
