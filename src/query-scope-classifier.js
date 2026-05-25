'use strict';

/**
 * Query Scope Classifier
 *
 * Separates geographic scope (locationScope) from operator identity scope (operatorScope).
 *
 * Domain rules:
 *   - city / postalCode / region is a geographic reference, NOT an operator identity.
 *   - Operator identity requires bdew / vnbName / gridOperatorName / gridOperatorMastrId.
 *   - "Wer ist der VNB für Wiesloch?" is a VNB_RESOLUTION workflow with uncertainty,
 *     NOT a direct vnbLookup(city=Wiesloch).
 *   - A tool requiring operatorScope MUST NOT be considered ready from locationScope alone.
 *   - A tool requiring only locationScope MUST NOT be blocked by missing operatorScope.
 *
 * Scope kinds:
 *   LOCATION_SCOPE    — geographic context: city, postalCode, region, municipality
 *   OPERATOR_SCOPE    — operator identity: bdew, vnbName, gridOperatorMastrId
 *   ASSET_BY_LOCATION — asset query scoped to a geographic area
 *   ASSET_BY_OPERATOR — asset query scoped to a specific operator
 *   VNB_RESOLUTION    — explicit "find the responsible VNB for location X" intent
 *   MARKET_ROLE_VNB   — role hint: subject is a distribution grid operator
 *   MARKET_ROLE_LIEFERANT — role hint: subject is an energy supplier
 *   MARKET_ROLE_DV    — role hint: subject is a Direktvermarkter
 */

const QUERY_SCOPE = Object.freeze({
  LOCATION_SCOPE: 'locationScope',
  OPERATOR_SCOPE: 'operatorScope',
  ASSET_BY_LOCATION: 'assetByLocation',
  ASSET_BY_OPERATOR: 'assetByOperator',
  VNB_RESOLUTION: 'vnbResolution',
  MARKET_ROLE_VNB: 'marketRole:VNB',
  MARKET_ROLE_LIEFERANT: 'marketRole:Lieferant',
  MARKET_ROLE_DV: 'marketRole:Direktvermarkter',
});

// ─────────────────────────────────────────────────────────────────────────────
// Intent signal patterns
// ─────────────────────────────────────────────────────────────────────────────

/** User asks "who is the VNB responsible for location X" */
const VNB_RESOLUTION_SIGNALS =
  /wer\s+(ist|sind|war)\s+(der|die|das)?\s*(zust[äa]ndige?r?)?\s*(netzbetreiber|vnb|[üu]nb|netzanbieter)|zust[äa]ndige?r?\s*(netzbetreiber|vnb|[üu]nb)\s*(f[üu]r|in|bei|von)|welche?r?\s*(netzbetreiber|vnb|[üu]nb)\s*(ist)?\s*(zust[äa]ndig|verantwortlich|bedient|betreibt)|(netzbetreiber|vnb)\s*(in|f[üu]r|bei)\s/i;

/** User asks for assets/installations AT a specific location */
const ASSET_BY_LOCATION_SIGNALS =
  /anlagen\s*(in|bei|f[üu]r|im\s+ort|im\s+plz)\s|solar(anlagen)?\s*(in|bei|f[üu]r)\s|wind(anlagen)?\s*(in|bei|f[üu]r)\s|mastr\s*(in|bei|f[üu]r)\s|installationen?\s*(in|bei|f[üu]r)\s|erzeugungsanlagen?\s*(in|bei)\s|plz\s*\d{5}|gr[üu]nstromindex|co2.intensit[äa]t|wetter.*prognose/i;

/** User asks for assets/installations OF a specific operator */
const ASSET_BY_OPERATOR_SIGNALS =
  /anlagen\s+(von|der|des)\s+(netze|stadtwerke|e\.on|eon|bayernwerk|e\.dis|shng|mitnetz|westnetz)|portfolio\s+(von|der|des)\s|netzgebiet\s+(von|der|des)\s|assets?\s+(of|from)\s+\w+\s+netz/i;

/** Explicit well-known operator names used as primary subject */
const KNOWN_OPERATOR_NAMES =
  /netze\s+bw|e\.on\s+netz|bayernwerk|e\.dis\s+netz|shng|mitnetz\s+strom|westnetz|netz\s+hamburg|stromnetz\s+hamburg|swd\s+netz|lew\s+verteilnetz/i;

// ─────────────────────────────────────────────────────────────────────────────
// Context helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the context contains geographic location information.
 * Does NOT imply operator identity.
 */
function hasLocationScope(context = {}) {
  return Boolean(
    context.city ||
      context.municipality ||
      context.location ||
      context.postalCode ||
      context.postleitzahl ||
      context.region ||
      context.bundesland ||
      context.gemeinde
  );
}

/**
 * Returns true if the context contains operator identity information.
 * Only BDEW codes (5–13 digits), vnbName, gridOperatorName, or gridOperatorMastrId qualify.
 * city / postalCode / region are NOT operator identity — they are location only.
 */
function isOperatorScopeResolved(context = {}) {
  const bdew =
    context.bdew ||
    context.bdewCode ||
    context.gridOperatorBdewCode ||
    context.gridOperatorBdewCode;
  const isPlausibleBdew =
    typeof bdew === 'string' && /^\d{5,13}$/.test(bdew.trim());
  const hasVnbName = Boolean(
    context.vnbName ||
      context.gridOperatorName ||
      context.assertedGridOperatorName
  );
  const hasMastrId = Boolean(context.gridOperatorMastrId || context.snbMastrId);
  return isPlausibleBdew || hasVnbName || hasMastrId;
}

/**
 * Extract available location scope fields from context.
 */
function extractLocationScope(context = {}) {
  return {
    city: context.city || context.municipality || context.location || null,
    postalCode: context.postalCode || context.postleitzahl || null,
    region: context.region || context.bundesland || null,
    gemeinde: context.gemeinde || null,
  };
}

/**
 * Extract available operator scope fields from context.
 */
function extractOperatorScope(context = {}) {
  return {
    bdew: context.bdew || context.bdewCode || context.gridOperatorBdewCode || null,
    vnbName:
      context.vnbName ||
      context.gridOperatorName ||
      context.assertedGridOperatorName ||
      null,
    gridOperatorMastrId: context.gridOperatorMastrId || context.snbMastrId || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main classifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify the primary query scope from user message + known context.
 *
 * @param {string} message - User message
 * @param {object} knownContext - Resolved context (city, bdewCode, vnbName, etc.)
 * @returns {object} Scope classification result:
 *   {
 *     primaryScope: string|null,           // dominant intent
 *     scopes: string[],                    // all detected scopes
 *     locationScope: object,               // { city, postalCode, region, gemeinde }
 *     operatorScope: object,               // { bdew, vnbName, gridOperatorMastrId }
 *     operatorScopeResolved: boolean,      // operator identity available
 *     locationScopeAvailable: boolean,     // location context available
 *     marketRoleScope: string|null,        // detected market role hint
 *     scopeTrace: string[]                 // human-readable derivation log
 *   }
 */
function classifyQueryScope(message = '', knownContext = {}) {
  const text = String(message || '');
  const scopes = [];
  const scopeTrace = [];

  const locationAvailable = hasLocationScope(knownContext);
  const operatorResolved = isOperatorScopeResolved(knownContext);

  const locationScope = extractLocationScope(knownContext);
  const operatorScope = extractOperatorScope(knownContext);

  if (locationAvailable) {
    scopes.push(QUERY_SCOPE.LOCATION_SCOPE);
    const locLabel =
      locationScope.city || locationScope.postalCode || locationScope.region || '?';
    scopeTrace.push(`locationScope available: ${locLabel}`);
  }

  if (operatorResolved) {
    scopes.push(QUERY_SCOPE.OPERATOR_SCOPE);
    const opLabel =
      operatorScope.bdew || operatorScope.vnbName || operatorScope.gridOperatorMastrId || '?';
    scopeTrace.push(`operatorScope resolved: ${opLabel}`);
  }

  // Detect market role hint from operator scope or message
  let marketRoleScope = null;
  if (KNOWN_OPERATOR_NAMES.test(text) || (operatorResolved && !ASSET_BY_OPERATOR_SIGNALS.test(text))) {
    marketRoleScope = QUERY_SCOPE.MARKET_ROLE_VNB;
    scopes.push(QUERY_SCOPE.MARKET_ROLE_VNB);
    scopeTrace.push('marketRoleScope: VNB (known operator name or explicit operator identity)');
  }

  // Determine primary intent
  let primaryScope = null;

  if (VNB_RESOLUTION_SIGNALS.test(text)) {
    primaryScope = QUERY_SCOPE.VNB_RESOLUTION;
    if (!scopes.includes(QUERY_SCOPE.VNB_RESOLUTION)) {
      scopes.push(QUERY_SCOPE.VNB_RESOLUTION);
    }
    scopeTrace.push(
      'primaryScope: vnbResolution — explicit "who is the responsible VNB?" signal detected'
    );
  } else if (ASSET_BY_OPERATOR_SIGNALS.test(text) || KNOWN_OPERATOR_NAMES.test(text)) {
    primaryScope = QUERY_SCOPE.ASSET_BY_OPERATOR;
    if (!scopes.includes(QUERY_SCOPE.ASSET_BY_OPERATOR)) {
      scopes.push(QUERY_SCOPE.ASSET_BY_OPERATOR);
    }
    scopeTrace.push(
      'primaryScope: assetByOperator — named operator as query subject'
    );
  } else if (ASSET_BY_LOCATION_SIGNALS.test(text)) {
    primaryScope = QUERY_SCOPE.ASSET_BY_LOCATION;
    if (!scopes.includes(QUERY_SCOPE.ASSET_BY_LOCATION)) {
      scopes.push(QUERY_SCOPE.ASSET_BY_LOCATION);
    }
    scopeTrace.push(
      'primaryScope: assetByLocation — assets/data requested for a geographic area'
    );
  } else if (operatorResolved && locationAvailable) {
    // Both scopes present: operator wins for operator-targeted queries
    primaryScope = QUERY_SCOPE.OPERATOR_SCOPE;
    scopeTrace.push(
      'primaryScope: operatorScope — both location and operator available; operator takes precedence'
    );
  } else if (operatorResolved) {
    primaryScope = QUERY_SCOPE.OPERATOR_SCOPE;
    scopeTrace.push('primaryScope: operatorScope — only operator identity available');
  } else if (locationAvailable) {
    primaryScope = QUERY_SCOPE.LOCATION_SCOPE;
    scopeTrace.push(
      'primaryScope: locationScope — only geographic context available (no operator identity)'
    );
  } else {
    scopeTrace.push('primaryScope: null — neither location nor operator scope resolved');
  }

  return {
    primaryScope,
    scopes: [...new Set(scopes)],
    locationScope,
    operatorScope,
    operatorScopeResolved: operatorResolved,
    locationScopeAvailable: locationAvailable,
    marketRoleScope,
    scopeTrace,
  };
}

module.exports = {
  QUERY_SCOPE,
  classifyQueryScope,
  isOperatorScopeResolved,
  hasLocationScope,
  extractLocationScope,
  extractOperatorScope,
};
