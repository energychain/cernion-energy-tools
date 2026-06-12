'use strict';

/**
 * Energy ID Extractor
 *
 * Centralized, strict extraction of German energy market identifiers from
 * unstructured text. All patterns use word boundaries (\b) to prevent
 * partial matches (e.g., "Hier" is NOT a BDEW code, a 6-digit number is
 * NOT a PLZ).
 *
 * Reusable across all Moleculer services — no service-specific dependencies.
 *
 * Supported identifier types:
 *   meloId     — Messlokation: DE + 31 digits (33 chars total)
 *   maloId     — Marktlokation: exactly 11 digits
 *   mastrId    — Marktstammdatenregister ID: prefix + 11 digits
 *   bdewCode   — BDEW / GLN: exactly 13 digits
 *   eicCode    — Energy Identification Code: 16-char alphanumeric (e.g. 11X...)
 *   obisCode   — OBIS meter reading code (e.g. 1-0:1.8.0)
 *   postalCode — German PLZ: exactly 5 digits
 */

/**
 * Ordered extraction rules. Each rule is checked in order; a longer/more
 * specific match on the same text wins because we consume longest-first.
 *
 * NOTE on ordering: MeLo (33 chars) must come before MaLo (11 digits) and
 * BDEW/GLN (13 digits) must come before PLZ (5 digits) to ensure the more
 * specific rule gets the first shot.
 */
const ENERGY_ID_RULES = Object.freeze([
  {
    type: 'meloId',
    // Messlokation: exactly "DE" + 31 decimal digits (= 33 chars total)
    // Case-insensitive prefix; \b anchors prevent embedding inside longer tokens.
    pattern: /\bDE\d{31}\b/i,
    description: 'Messlokations-ID (MeLo)',
  },
  {
    type: 'mastrId',
    // MaStR prefixes as defined in the Marktstammdatenregister export spec.
    // Real MaStR IDs are 3-letter prefix + 12 decimal digits (15 chars total,
    // e.g. SEE900123456789, SNB900000012345).
    pattern: /\b(?:SEE|EEG|SNR|SDE|SPE|SGN|SEU|SER|SAL|SWA|SBE|SBJ|SNB|GNB|ABN|VNB)\d{12}\b/i,
    description: 'Marktstammdatenregister-ID (MaStR)',
  },
  {
    type: 'eicCode',
    // EIC: 2 digits + 1 letter + 12 alphanumeric-or-dash chars + 1 alphanumeric/dash
    // Total 16 characters. Covers formats like "11X-----------L", "11XBAYERNWERK--N"
    pattern: /\b\d{2}[A-Z][A-Z0-9\-]{12}[A-Z0-9]\b/i,
    description: 'Energy Identification Code (EIC)',
  },
  {
    type: 'bdewCode',
    // GLN / BDEW code: exactly 13 decimal digits (GS1 Global Location Number)
    // Must come before maloId (11 digits) and postalCode (5 digits).
    pattern: /\b\d{13}\b/,
    description: 'BDEW-Code / GLN (13 Stellen)',
  },
  {
    type: 'maloId',
    // Marktlokation: exactly 11 decimal digits
    // Must come before postalCode (5 digits).
    pattern: /\b\d{11}\b/,
    description: 'Marktlokations-ID (MaLo)',
  },
  {
    type: 'obisCode',
    // OBIS: e.g. "1-0:1.8.0" or "1-0:1.8.1*255"
    pattern: /\b\d{1,3}-\d{1,3}:\d{1,3}\.\d{1,3}\.\d{1,3}(?:\*\d{1,3})?\b/,
    description: 'OBIS-Kennzahl',
  },
  {
    type: 'postalCode',
    // German PLZ: exactly 5 decimal digits — \b prevents matching inside longer numbers
    pattern: /\b\d{5}\b/,
    description: 'Postleitzahl (PLZ)',
  },
]);

/**
 * Extract all energy-domain identifiers from a text string.
 *
 * Returns an array of match objects. Each object contains:
 *   - type    {string}  — identifier type key (e.g. 'meloId', 'postalCode')
 *   - value   {string}  — the matched string as found in the text
 *   - description {string} — human-readable label (German)
 *
 * Matches are de-duplicated: the same (type, value) pair only appears once.
 * Order follows ENERGY_ID_RULES (most specific first).
 *
 * @param {string} text — Free-form input (user message, clipboard paste, etc.)
 * @returns {Array<{type: string, value: string, description: string}>}
 */
function extractEnergyIds(text) {
  if (!text || typeof text !== 'string') return [];

  const results = [];
  const seen = new Set(); // de-duplicate (type + ':' + value)

  for (const rule of ENERGY_ID_RULES) {
    const globalPattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g'
    );
    let match;
    while ((match = globalPattern.exec(text)) !== null) {
      const value = match[0];
      const key = `${rule.type}:${value.toUpperCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ type: rule.type, value, description: rule.description });
      }
    }
  }

  return results;
}

/**
 * Extract the first match of a specific type from text, or null.
 *
 * @param {string} text
 * @param {string} type — one of the ENERGY_ID_RULES type keys
 * @returns {string|null}
 */
function extractFirstOfType(text, type) {
  const all = extractEnergyIds(text);
  const hit = all.find((m) => m.type === type);
  return hit ? hit.value : null;
}

/**
 * Returns true if the text contains at least one energy identifier of the given type.
 *
 * @param {string} text
 * @param {string} type
 * @returns {boolean}
 */
function hasEnergyIdOfType(text, type) {
  return extractFirstOfType(text, type) !== null;
}

module.exports = {
  extractEnergyIds,
  extractFirstOfType,
  hasEnergyIdOfType,
  ENERGY_ID_RULES,
};
