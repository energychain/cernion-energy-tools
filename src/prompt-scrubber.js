'use strict';

/**
 * Prompt Scrubber — Data Masking for External LLM Prompts (Issue #31)
 *
 * Scrubs sensitive fields from data payloads before they enter external LLM
 * context windows. Ensures KRITIS compliance by never sending PII, precise
 * geolocations, raw sensor values, or topology details to cloud LLM providers.
 *
 * Strategy:
 *  - Field-level allowlist/blocklist driven by patterns
 *  - Structural masking: replaces blocked values with anonymised placeholders
 *  - Re-identification map returned so local code can map LLM reasoning back
 *    to real data
 *
 * @see https://github.com/energychain/cernion-energy-tools/issues/31
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Sensitive field patterns (blocklist) — matched case-insensitively
// ---------------------------------------------------------------------------
const SENSITIVE_PATTERNS = [
  // PII
  /e[-_]?mail/i,
  /telefon|phone|fax/i,
  /^name$|kundenname|personname|ansprechpartner|kontakt/i,
  /adresse|address|straße|strasse|hausnummer/i,
  /iban|konto|bankverbindung|bic|swift/i,

  // Precise geolocation (lat/lon at high precision are sensitive for KRITIS)
  /^(lat|lng|lon|latitude|longitude)$/i,
  /breitengrad|laengengrad|längengrad/i,
  /koordinat/i,

  // Topology / SCADA / sensor
  /scada|sensor|messwert|spannung_aktuell|strom_aktuell/i,
  /node_?voltage|transformer_load|leitungs(belastung|auslastung)/i,
  /password|passwort|secret|token|api[-_]?key/i,
];

// ---------------------------------------------------------------------------
// Safe field patterns (allowlist) — these are NEVER masked even if they
// partially match a sensitive pattern. Evaluated BEFORE blocklist.
// ---------------------------------------------------------------------------
const SAFE_PATTERNS = [
  // Energy domain identifiers (public registry data)
  /^(mastr|eic|bdew|bnr)/i,
  /^(plz|postleitzahl|zip)/i,
  /^(bundesland|landkreis|gemeinde|ort|city|region)/i,

  // Technical specs (publicly available from MaStR)
  /kapazit|capacity|leistung|kw|mw|kwp|mwh|gwh/i,
  /typ|type|technologie|technology|energietraeger/i,
  /status|betriebsstatus|pruefung/i,
  /inbetriebnahme|commissioning|datum|date|year|jahr/i,
  /spannungsebene|voltage.?level/i,
  /anlagenschluessel|anlagennummer/i,

  // Aggregated / statistical fields
  /count|anzahl|summe|sum|average|avg|median|total/i,
  /rank|rang|quote|score|index/i,

  // Market data (public)
  /preis|price|tarif|tariff|kosten|cost|revenue|erlös/i,
  /co2|emission|intensity/i,
  /forecast|prognose/i,

  // OEO / semantic
  /oeo|ontology|iri|domain/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a field name matches any pattern in a list.
 */
function matchesAny(fieldName, patterns) {
  return patterns.some((rx) => rx.test(fieldName));
}

/**
 * Determine if a field should be masked.
 * Safe patterns take precedence over sensitive patterns.
 */
function isSensitiveField(fieldName) {
  if (matchesAny(fieldName, SAFE_PATTERNS)) return false;
  return matchesAny(fieldName, SENSITIVE_PATTERNS);
}

/**
 * Generate a stable pseudonym for a value (deterministic per scrub session).
 * Uses a short hash so the LLM sees consistent placeholders across rows.
 */
function pseudonymise(value, salt) {
  const raw = String(value);
  const hash = crypto
    .createHash('sha256')
    .update(salt + raw)
    .digest('hex')
    .slice(0, 8);
  return `[MASKED-${hash}]`;
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Scrub a data payload (object or array of objects) for LLM prompt inclusion.
 *
 * @param {Object|Array} data - The data to scrub
 * @param {Object} [options]
 * @param {string[]} [options.additionalBlocklist] - Extra field names to block
 * @param {string[]} [options.additionalAllowlist] - Extra field names to allow
 * @param {number}   [options.maxRows=50]          - Truncate arrays to this length
 * @param {number}   [options.maxStringLength=500] - Truncate long string values
 * @returns {{ scrubbed: Object|Array, reidentMap: Map<string,string>, stats: Object }}
 */
function scrubForLLM(data, options = {}) {
  const salt = crypto.randomBytes(8).toString('hex');
  const reidentMap = new Map();
  const stats = { fieldsScanned: 0, fieldsMasked: 0, rowsTruncated: 0 };

  const extraBlock = new Set((options.additionalBlocklist || []).map((f) => f.toLowerCase()));
  const extraAllow = new Set((options.additionalAllowlist || []).map((f) => f.toLowerCase()));
  const maxRows = options.maxRows ?? 50;
  const maxStringLength = options.maxStringLength ?? 500;

  function shouldMask(fieldName) {
    const lower = fieldName.toLowerCase();
    if (extraAllow.has(lower)) return false;
    if (extraBlock.has(lower)) return true;
    return isSensitiveField(fieldName);
  }

  function scrubValue(key, value) {
    stats.fieldsScanned++;
    if (value === null || value === undefined) return value;

    if (shouldMask(key)) {
      stats.fieldsMasked++;
      const placeholder = pseudonymise(value, salt);
      reidentMap.set(placeholder, String(value));
      return placeholder;
    }

    // Truncate long strings (e.g. base64 blobs, raw XML)
    if (typeof value === 'string' && value.length > maxStringLength) {
      return value.slice(0, maxStringLength) + '…[truncated]';
    }

    return value;
  }

  function scrubObject(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      const truncated = obj.length > maxRows;
      const arr = truncated ? obj.slice(0, maxRows) : obj;
      if (truncated) stats.rowsTruncated = obj.length - maxRows;
      return arr.map((item) =>
        typeof item === 'object' && item !== null ? scrubObject(item) : item
      );
    }

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = scrubObject(value);
      } else if (Array.isArray(value)) {
        result[key] = scrubObject(value);
      } else {
        result[key] = scrubValue(key, value);
      }
    }
    return result;
  }

  const scrubbed = scrubObject(data);
  return { scrubbed, reidentMap, stats };
}

/**
 * Scrub a full prompt string by replacing known PII patterns inline.
 * This is a best-effort secondary pass for free-text prompts where
 * structured field-level scrubbing isn't possible.
 *
 * Targets: email addresses, IBANs, phone numbers.
 */
function scrubPromptText(text, options = {}) {
  if (typeof text !== 'string') return text;

  const salt = options.salt || crypto.randomBytes(8).toString('hex');
  const mask = (value, kind) => {
    const placeholder = options.reidentMap ? pseudonymise(value, salt) : `[${kind}-MASKED]`;
    options.reidentMap?.set(placeholder, value);
    return placeholder;
  };
  let scrubbed = text;
  // Email addresses
  scrubbed = scrubbed.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (value) =>
    mask(value, 'EMAIL')
  );
  // German IBANs
  scrubbed = scrubbed.replace(/\bDE\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/g, (value) =>
    mask(value, 'IBAN')
  );
  // Protect complete dates before scanning phones, including dates adjacent to times.
  const dates = [];
  scrubbed = scrubbed.replace(/\b(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\b/g, (date) => {
    dates.push(date);
    return `DATEPLACEHOLDER${(dates.length - 1).toString(36).replace(/\d/g, (digit) => String.fromCharCode(65 + Number(digit)))}END`;
  });
  scrubbed = scrubbed.replace(/(?<![\d.-])(\+49|0049|0)\s?[\d\s/.-]{8,15}/g, (value) =>
    mask(value, 'PHONE')
  );
  scrubbed = scrubbed.replace(/DATEPLACEHOLDER([A-Za-z]+)END/g, (token) => {
    const index = token
      .slice('DATEPLACEHOLDER'.length, -3)
      .replace(/[A-J]/g, (letter) => String(letter.charCodeAt(0) - 65));
    return dates[parseInt(index, 36)];
  });

  return scrubbed;
}

// Traverse content values only; property names are application/schema metadata.
function mapStringValues(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((entry) => mapStringValues(entry, transform));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapStringValues(entry, transform)])
    );
  return value;
}

function scrubPromptValues(value, options = {}) {
  const sharedOptions = { ...options, salt: options.salt || crypto.randomBytes(8).toString('hex') };
  return mapStringValues(value, (text) => scrubPromptText(text, sharedOptions));
}

function scrubPrompt(prompt, options = {}) {
  if (typeof prompt !== 'string') return prompt;
  let value;
  // This catch classifies free text only. Scrubbing and serialization occur
  // outside it, so masking errors always propagate to the caller.
  try {
    value = JSON.parse(prompt);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return scrubPromptText(prompt, options);
  }
  return JSON.stringify(scrubPromptValues(value, options));
}

module.exports = {
  scrubForLLM,
  scrubPromptText,
  mapStringValues,
  scrubPromptValues,
  scrubPrompt,
  isSensitiveField,
  SENSITIVE_PATTERNS,
  SAFE_PATTERNS,
};
