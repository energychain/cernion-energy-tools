'use strict';

/**
 * Location Resolution Module
 *
 * Extracts and normalises location references from free text and structured
 * context. Consumed by Personal Agent, L3 Broker, the Consultation-to-Execution
 * Bridge, and future OSM/MaStR prechecks.
 *
 * Precision ladder:
 *   SITE           — exact coordinates / street address
 *   MUNICIPALITY   — PLZ / Gemeinde → sufficient for communal pre-check
 *   REGION         — Bundesland / Region → only regional analysis possible
 *   UNKNOWN        — no usable location information
 *
 * Market-partner role classification separates:
 *   VNB (Netzbetreiber) ≠ Stadtwerk ≠ Lieferant ≠ MSB ≠ Direktvermarkter
 *
 * Domain rules:
 *   - A Gemeinde/PLZ is enough for a communal pre-check but NOT for a
 *     binding Netzanschlusszusage or site-specific OSM/MaStR analysis.
 *   - A Stadtwerk is not automatically a VNB (may have a separate subsidiary).
 *   - A Grundversorger/Lieferant is explicitly NOT a VNB.
 *   - VNB candidates from location lookup must be shown with uncertainty
 *     when no authoritative data source is available.
 */

// ─── Precision Levels ────────────────────────────────────────────────────────

const LOCATION_PRECISION = Object.freeze({
  SITE: 'site_resolved',
  MUNICIPALITY: 'municipality_resolved',
  REGION: 'region_resolved',
  UNKNOWN: 'unknown',
});

// ─── Market-Partner Role Hints ────────────────────────────────────────────────

const MARKET_PARTNER_ROLE = Object.freeze({
  VNB: 'vnb',
  STADTWERK: 'stadtwerk',
  LIEFERANT: 'lieferant',
  MESSSTELLENBETREIBER: 'messstellenbetreiber',
  DIREKTVERMARKTER: 'direktvermarkter',
  UNKNOWN: 'unknown',
});

// ─── Extraction Patterns ──────────────────────────────────────────────────────

const POSTAL_CODE_PATTERN = /\b(\d{5})\b/;

// "74889 Sinsheim", "12345 Berlin-Mitte"
const CITY_AFTER_POSTAL_PATTERN =
  /\b\d{5}\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß](?:[A-Za-zÄÖÜäöüß-]*(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*){0,2}))\b/;

// "Bürgermeister von Sinsheim", "Stadt Sinsheim", "in Sinsheim", etc.
// The matched city value is validated post-match to start with an uppercase letter,
// preventing common German words like "genannt", "gemeint", etc. from being accepted.
const CITY_WITH_KEYWORD_PATTERN =
  /(?:(?:b[üu]rgermeister(?:in)?|buergermeister(?:in)?|gemeinde(?:rat)?|stadtrat|oberb[üu]rgermeister(?:in)?|obt|ob|bg(?:m)?)\s+(?:von\s+|der\s+(?:stadt|gemeinde\s+))?|(?:in|bei|f[üu]r|fuer|aus|von|ab|stadtgebiet\s+|gemeinde\s+|ort(?:schaft)?\s+|standort\s+|gemarkung\s+)(?:der\s+(?:stadt|gemeinde)\s+)?)([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+){0,2})\b/i;

const COORDINATE_PATTERN = /(-?\d{1,3}\.\d{4,})[,\s;]+(-?\d{1,3}\.\d{4,})/;
const STREET_ADDRESS_PATTERN =
  /\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+(?:str(?:a[sß]e)?|weg|gasse|allee|platz|ring|damm|ufer|chaussee)\s*\d{1,4}\b/i;
const GEWERBEGEBIET_PATTERN =
  /\b(gewerbegebiet|industriegebiet|industriepark|logistikpark|technologiepark|gewerbepark|gewerbehof|campus)\b/i;
const AUTOBAHN_PROXIMITY_PATTERN = /\bnahe\s+(?:der\s+)?(?:A|BAB)\s*\d{1,3}\b/i;

// German state name → canonical form
const STATE_MAP = new Map([
  ['thüringen', 'Thüringen'], ['thueringen', 'Thüringen'], ['thuringen', 'Thüringen'],
  ['bayern', 'Bayern'], ['bavaria', 'Bayern'],
  ['nrw', 'Nordrhein-Westfalen'], ['nordrhein-westfalen', 'Nordrhein-Westfalen'],
  ['nordrhein westfalen', 'Nordrhein-Westfalen'],
  ['bw', 'Baden-Württemberg'], ['bawü', 'Baden-Württemberg'],
  ['bad.-württ.', 'Baden-Württemberg'], ['bad.-wuertt.', 'Baden-Württemberg'],
  ['baden-württemberg', 'Baden-Württemberg'], ['baden-wuerttemberg', 'Baden-Württemberg'],
  // City-states are excluded here: "Berlin", "Hamburg", "Bremen" are also city names.
  // Use keyword-qualified forms like "Bundesland Hamburg" if state detection is needed.
  ['schleswig-holstein', 'Schleswig-Holstein'], ['sh', 'Schleswig-Holstein'],
  ['mecklenburg-vorpommern', 'Mecklenburg-Vorpommern'], ['mv', 'Mecklenburg-Vorpommern'],
  ['sachsen-anhalt', 'Sachsen-Anhalt'], ['st', 'Sachsen-Anhalt'],
  ['sachsen', 'Sachsen'], ['sn', 'Sachsen'],
  ['brandenb', 'Brandenburg'], ['bb', 'Brandenburg'], ['brandenburg', 'Brandenburg'],
  ['hessen', 'Hessen'], ['he', 'Hessen'],
  ['rheinland-pfalz', 'Rheinland-Pfalz'], ['rp', 'Rheinland-Pfalz'],
  ['saarland', 'Saarland'], ['sl', 'Saarland'],
  ['niedersachsen', 'Niedersachsen'], ['ni', 'Niedersachsen'],
  ['sachsen-anhalt', 'Sachsen-Anhalt'],
]);

// ─── Market-Partner Role Signals ─────────────────────────────────────────────

// Authoritative VNB names / suffixes (distribution grid operators)
const VNB_NAME_PATTERN =
  /\b(netze\s+bw|bayernwerk\s+netz|e\.dis\s+netz|shng|mitnetz\s+strom|westnetz|netz\s+hamburg|stromnetz\s+hamburg|swd\s+netz|lew\s+verteilnetz|e\.on\s+netz|rheinische\s+netzgesellschaft|rhein-ruhr\s+netz|netz\s+niederrhein)\b/i;
const VNB_SUFFIX_PATTERN = /\b(verteilnetz|netz(?:gesellschaft|betrieb)?|netze)\b/i;
const STADTWERK_PREFIX_PATTERN = /\b(stadtwerke?|stadtwerk|sw[a-z]{1,6}|sw\s+[a-z]+|stadtbetriebe?)\b/i;
const LIEFERANT_PATTERN =
  /\b(lieferant|vertrieb|grundversorger|strom(?:lieferant|anbieter|versorger)|energiehandel|e-werk(?!\s*netz)|energievertrieb)\b/i;
const MSB_PATTERN = /\b(messstellenbetreiber|msb|grundzust[aä]ndiger\s+msb|mes(?:ss)?techniker)\b/i;
const DV_PATTERN = /\b(direktvermarkter|direktvermarktung|direktvermarktungsunternehmen|dv\b)/i;

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

function extractState(text = '') {
  const lower = String(text || '').toLowerCase();
  for (const [pattern, canonical] of STATE_MAP) {
    if (lower.includes(pattern)) return canonical;
  }
  return null;
}

function classifyLocationPrecision(fields = {}) {
  if (fields.latitude != null && fields.longitude != null) return LOCATION_PRECISION.SITE;
  if (fields.address) return LOCATION_PRECISION.SITE;
  if (fields.postalCode || fields.municipality) return LOCATION_PRECISION.MUNICIPALITY;
  if (fields.state) return LOCATION_PRECISION.REGION;
  return LOCATION_PRECISION.UNKNOWN;
}

// ─── Market-Partner Role Classifier ──────────────────────────────────────────

/**
 * Classify the market role of a named entity (VNB, Stadtwerk, Lieferant, etc.)
 *
 * Domain rule: Stadtwerk ≠ VNB. A Stadtwerk may own a VNB subsidiary (e.g. Stadtwerke X
 * Netz GmbH), but the parent entity is a Stadtwerk. Never equate Grundversorger with VNB.
 *
 * @param {string} name
 * @returns {{ role: string, confidence: number, signals: string[], note: string|null }}
 */
function classifyMarketPartnerRole(name = '') {
  const text = String(name || '').trim();
  if (!text) {
    return { role: MARKET_PARTNER_ROLE.UNKNOWN, confidence: 0, signals: [], note: null };
  }

  const signals = [];
  const lower = text.toLowerCase();

  if (MSB_PATTERN.test(lower)) signals.push('msb_keyword');
  if (DV_PATTERN.test(lower)) signals.push('dv_keyword');
  if (LIEFERANT_PATTERN.test(lower)) signals.push('lieferant_keyword');
  if (VNB_NAME_PATTERN.test(lower)) signals.push('vnb_name_authoritative');
  if (VNB_SUFFIX_PATTERN.test(lower)) signals.push('vnb_suffix');
  if (STADTWERK_PREFIX_PATTERN.test(lower)) signals.push('stadtwerk_prefix');

  if (signals.includes('vnb_name_authoritative')) {
    return {
      role: MARKET_PARTNER_ROLE.VNB,
      confidence: 0.9,
      signals,
      note: null,
    };
  }
  if (signals.includes('msb_keyword')) {
    return {
      role: MARKET_PARTNER_ROLE.MESSSTELLENBETREIBER,
      confidence: 0.85,
      signals,
      note: 'Messstellenbetreiber ≠ VNB',
    };
  }
  if (signals.includes('dv_keyword')) {
    return {
      role: MARKET_PARTNER_ROLE.DIREKTVERMARKTER,
      confidence: 0.8,
      signals,
      note: 'Direktvermarkter ≠ VNB',
    };
  }
  if (signals.includes('lieferant_keyword')) {
    return {
      role: MARKET_PARTNER_ROLE.LIEFERANT,
      confidence: 0.8,
      signals,
      note: 'Grundversorger/Lieferant ist kein Netzbetreiber',
    };
  }
  if (signals.includes('stadtwerk_prefix') && signals.includes('vnb_suffix')) {
    // "Stadtwerke X Netz GmbH" — the netz subsidiary may be a VNB; the parent is a Stadtwerk
    return {
      role: MARKET_PARTNER_ROLE.STADTWERK,
      confidence: 0.7,
      signals,
      note: 'Stadtwerk mit Netz-Tochter — VNB-Status des Stadtwerks selbst unklar; Netz-GmbH separat prüfen',
    };
  }
  if (signals.includes('stadtwerk_prefix')) {
    return {
      role: MARKET_PARTNER_ROLE.STADTWERK,
      confidence: 0.75,
      signals,
      note: 'Stadtwerk ≠ Netzbetreiber — VNB-Status separat verifizieren',
    };
  }
  if (signals.includes('vnb_suffix')) {
    return {
      role: MARKET_PARTNER_ROLE.VNB,
      confidence: 0.55,
      signals,
      note: 'VNB-Kandidat nach Namensstruktur; ohne autoritative Quelle nicht gesichert',
    };
  }

  return { role: MARKET_PARTNER_ROLE.UNKNOWN, confidence: 0.1, signals, note: null };
}

// ─── Core Location Resolver ───────────────────────────────────────────────────

/**
 * Resolve a location from a free-text message and/or structured context.
 *
 * Extraction priority:
 *   1. Coordinates (highest precision)
 *   2. Street address
 *   3. PLZ + city name
 *   4. City name from keyword context
 *   5. State/Bundesland
 *   Structured context keys override extracted values.
 *
 * @param {string} text          Free-text user message
 * @param {object} [ctx={}]      Structured context (postalCode, municipality, etc.)
 * @returns {ResolvedLocation}
 */
function resolveLocationFromText(text = '', ctx = {}) {
  const haystack = String(text || '');
  const evidence = [];
  const candidates = [];

  // ── Coordinates ──
  let latitude = null;
  let longitude = null;
  const coordMatch = COORDINATE_PATTERN.exec(haystack);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    // Rough sanity check for Germany (lat ~47–55, lon ~6–15)
    if (lat >= 47 && lat <= 56 && lon >= 5 && lon <= 16) {
      latitude = lat;
      longitude = lon;
      evidence.push({ field: 'coordinates', value: `${lat},${lon}`, source: 'text_coord_pattern', confidence: 0.99 });
      candidates.push({ latitude, longitude, source: 'text_coord' });
    }
  }

  // ── Street address ──
  let address = null;
  const addrMatch = STREET_ADDRESS_PATTERN.exec(haystack);
  if (addrMatch) {
    address = addrMatch[0].trim();
    evidence.push({ field: 'address', value: address, source: 'text_address_pattern', confidence: 0.82 });
    candidates.push({ address, source: 'text_address' });
  }

  // ── PLZ + city ──
  let postalCode = null;
  let municipality = null;

  const plzMatch = POSTAL_CODE_PATTERN.exec(haystack);
  if (plzMatch) {
    postalCode = plzMatch[1];
    evidence.push({ field: 'postalCode', value: postalCode, source: 'text_plz_pattern', confidence: 0.95 });
  }

  const cityAfterPlzMatch = CITY_AFTER_POSTAL_PATTERN.exec(haystack);
  if (cityAfterPlzMatch) {
    municipality = cityAfterPlzMatch[1].trim();
    evidence.push({ field: 'municipality', value: municipality, source: 'text_plz_city_pattern', confidence: 0.92 });
    candidates.push({ postalCode, municipality, source: 'text_plz_city' });
  }

  // ── City from keyword context ──
  if (!municipality) {
    const kwMatch = CITY_WITH_KEYWORD_PATTERN.exec(haystack);
    if (kwMatch) {
      const raw = kwMatch[1].trim();
      // Reject common stop words, short strings, or values that don't start with an uppercase letter.
      // The uppercase check prevents common German words ("genannt", "gemeint", "hier") from
      // being accepted as city names when the keyword pattern over-matches.
      const isStopWord = /^(ein|die|der|das|ich|wir|sie|ihr|uns|und|auf|bei|von|dem|den|des|mit|aus)\b/i.test(raw);
      const startsUppercase = /^[A-ZÄÖÜ]/.test(raw);
      if (!isStopWord && startsUppercase && raw.length >= 3) {
        municipality = raw;
        evidence.push({ field: 'municipality', value: municipality, source: 'text_keyword_pattern', confidence: 0.78 });
        candidates.push({ municipality, source: 'text_keyword' });
      }
    }
  }

  // ── State ──
  const state = extractState(haystack);
  if (state) {
    evidence.push({ field: 'state', value: state, source: 'text_state_pattern', confidence: 0.9 });
  }

  // ── Approximate location hints ──
  let approximateHint = null;
  const gewMatch = GEWERBEGEBIET_PATTERN.exec(haystack);
  if (gewMatch) {
    approximateHint = gewMatch[0].trim();
    evidence.push({ field: 'approximateHint', value: approximateHint, source: 'text_area_keyword', confidence: 0.5 });
  }
  if (!approximateHint && AUTOBAHN_PROXIMITY_PATTERN.test(haystack)) {
    const abMatch = AUTOBAHN_PROXIMITY_PATTERN.exec(haystack);
    approximateHint = abMatch ? abMatch[0].trim() : 'Autobahn-Nähe';
    evidence.push({ field: 'approximateHint', value: approximateHint, source: 'text_autobahn_proximity', confidence: 0.4 });
  }

  // ── Merge: structured context wins over extracted values ──
  const resolved = {
    postalCode: ctx.postalCode || ctx.postleitzahl || postalCode || null,
    municipality: ctx.municipality || ctx.city || ctx.location || municipality || null,
    state: ctx.state || ctx.bundesland || ctx.region || state || null,
    latitude: ctx.latitude ?? latitude,
    longitude: ctx.longitude ?? longitude,
    address: ctx.address || address || null,
    approximateHint: approximateHint || null,
  };

  const precision = classifyLocationPrecision(resolved);
  const municipalityResolved = Boolean(resolved.postalCode || resolved.municipality);
  const siteCoordinatesMissing = precision !== LOCATION_PRECISION.SITE;

  // ── Confidence ──
  let locationConfidence = 0;
  if (evidence.length > 0) {
    locationConfidence = Math.max(...evidence.map((e) => e.confidence));
    // Corroboration boost: both PLZ and municipality → higher confidence
    if (resolved.postalCode && resolved.municipality) {
      locationConfidence = Math.min(1.0, locationConfidence + 0.03);
    }
  } else if (Object.values(resolved).some(Boolean)) {
    locationConfidence = 0.6; // context-only, no text extraction
  }

  return {
    postalCode: resolved.postalCode,
    municipality: resolved.municipality,
    state: resolved.state,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    address: resolved.address,
    approximateHint: resolved.approximateHint,

    precision,
    locationConfidence: parseFloat(locationConfidence.toFixed(2)),
    municipalityResolved,
    siteCoordinatesMissing,

    evidence,
    candidates,
    source: evidence.length > 0 ? 'text_extraction' : 'context_only',
  };
}

// ─── Context Patch Builder ────────────────────────────────────────────────────

/**
 * Build a flat context patch from a resolved location.
 * Only includes fields with non-null values.
 * Safe to merge into brokerKnownContext (never overwrites existing values).
 *
 * @param {object} resolved  From resolveLocationFromText()
 * @returns {object}
 */
function buildLocationContextPatch(resolved = {}) {
  const patch = {};
  if (resolved.postalCode) {
    patch.postalCode = resolved.postalCode;
    patch.postleitzahl = resolved.postalCode;
  }
  if (resolved.municipality) {
    patch.municipality = resolved.municipality;
    patch.city = resolved.municipality;
    patch.location = resolved.municipality;
  }
  if (resolved.state) {
    patch.state = resolved.state;
    patch.bundesland = resolved.state;
  }
  if (resolved.latitude != null && resolved.longitude != null) {
    patch.latitude = resolved.latitude;
    patch.longitude = resolved.longitude;
  }
  if (resolved.address) {
    patch.address = resolved.address;
  }
  return patch;
}

// ─── Precision Checks ────────────────────────────────────────────────────────

/**
 * True when PLZ or Gemeinde is resolved — sufficient for communal pre-check,
 * VNB candidate lookup, and grid operator attribution queries.
 */
function isSufficientForMunicipalPrecheck(resolved = {}) {
  return (
    resolved.precision === LOCATION_PRECISION.MUNICIPALITY ||
    resolved.precision === LOCATION_PRECISION.SITE
  );
}

// ─── Trace Builder ───────────────────────────────────────────────────────────

/**
 * Build a structured trace record for agentTrace / dataLineage.
 *
 * @param {object} resolved        From resolveLocationFromText()
 * @param {object|null} [roleHint] From classifyMarketPartnerRole(), optional
 * @returns {object}
 */
function buildLocationResolutionTrace(resolved = {}, roleHint = null) {
  return {
    type: 'location_resolution',
    precision: resolved.precision || LOCATION_PRECISION.UNKNOWN,
    postalCode: resolved.postalCode || null,
    municipality: resolved.municipality || null,
    state: resolved.state || null,
    hasCoordinates: resolved.latitude != null && resolved.longitude != null,
    municipalityResolved: Boolean(resolved.municipalityResolved),
    siteCoordinatesMissing: Boolean(resolved.siteCoordinatesMissing),
    locationConfidence: resolved.locationConfidence ?? 0,
    approximateHint: resolved.approximateHint || null,
    marketRoleHint: roleHint
      ? {
          role: roleHint.role,
          confidence: roleHint.confidence,
          note: roleHint.note || null,
        }
      : null,
    evidenceFields: (resolved.evidence || []).map((e) => ({
      field: e.field,
      source: e.source,
      confidence: e.confidence,
    })),
    source: resolved.source || 'unknown',
  };
}

module.exports = {
  LOCATION_PRECISION,
  MARKET_PARTNER_ROLE,
  resolveLocationFromText,
  buildLocationContextPatch,
  isSufficientForMunicipalPrecheck,
  buildLocationResolutionTrace,
  classifyMarketPartnerRole,
  classifyLocationPrecision,
  extractState,
};
