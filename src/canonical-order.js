'use strict';

/**
 * Explicit UTF-16 lexical order, matching Array#sort() for string values.
 * Hashes, cursors, schema keys and ISO dates must not depend on locale/ICU.
 */
function compareCanonicalStrings(a, b) {
  const left = String(a);
  const right = String(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

module.exports = { compareCanonicalStrings };
