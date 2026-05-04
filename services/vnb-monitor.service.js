/**
 * VNB Monitor Service
 *
 * Aggregates KPIs for German grid operators (VNBs) from multiple MCP tools
 * and exposes stable, schema-versioned JSON endpoints for Power Automate
 * and Power BI integration.
 *
 * Caches results with configurable TTL. Gracefully degrades if individual
 * sources become unavailable.
 */

'use strict';

const { getTenantId, tenantNamespace } = require('../src/tenant-context');

const VNB_MONITOR_DEFAULTS = require('../src/vnb-monitor-defaults');

const CACHE_TTL_SECONDS = parseInt(process.env.VNB_MONITOR_CACHE_TTL_SECONDS || '3600', 10);
const SCHEMA_VERSION = '1.0';
const THRESHOLD_NAMESPACE = 'vnb_monitor';
const THRESHOLD_KEY = 'thresholds';

function mergeThresholds(defaults, overrides) {
  const merged = { ...defaults };
  Object.assign(merged, overrides);
  return merged;
}

function parseStructuredToolResult(result) {
  if (!result) {
    return null;
  }

  if (result.json && typeof result.json === 'object') {
    return result.json;
  }

  if (Array.isArray(result.data)) {
    const jsonItem = result.data.find((item) => item && item.json && typeof item.json === 'object');
    if (jsonItem?.json) {
      return jsonItem.json;
    }
  }

  if (Array.isArray(result) && result.length > 0) {
    const jsonItem = result.find((item) => item && item.json && typeof item.json === 'object');
    if (jsonItem?.json) {
      return jsonItem.json;
    }
  }

  return null;
}

function parseRank(rankValue) {
  if (!rankValue || typeof rankValue !== 'string') {
    return { rank: null, total: null };
  }

  const match = rankValue.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) {
    return { rank: null, total: null };
  }

  return {
    rank: Number(match[1]),
    total: Number(match[2]),
  };
}

function stripAnnotatedMastrId(value) {
  if (!value || typeof value !== 'string') {
    return value || null;
  }

  return value.split(' ')[0].trim();
}

function sumBy(items, selector) {
  return items.reduce((sum, item) => sum + (Number(selector(item)) || 0), 0);
}

function countByType(items, type) {
  return items.filter((item) => String(item['Anlagentyp'] || '').toLowerCase() === type).length;
}

function sumCapacityByType(items, type) {
  return items
    .filter((item) => String(item['Anlagentyp'] || '').toLowerCase() === type)
    .reduce((sum, item) => sum + (Number(item['Leistung MW']) || 0), 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableError(message) {
  if (!message || typeof message !== 'string') {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes('session not found') ||
    normalized.includes('request is timed out') ||
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('http 503') ||
    normalized.includes('service unavailable') ||
    normalized.includes('upstream tool returned an error with no details')
  );
}

/**
 * Returns true when an EWK metric error is the generic "tool returned isError"
 * pattern — meaning the upstream EWK tool signalled "no data for this query".
 * When anschlussdauer already proved the operator IS in EWK (sourceAvailable),
 * these secondary-metric errors represent data gaps (VNB absent from that
 * dataset), not service failures, and should be suppressed from sourceErrors.
 * Real transient errors (timeout, session-not-found) are NOT matched here.
 */
function isEwkDataGapError(message) {
  if (!message || typeof message !== 'string') return false;
  return message.toLowerCase().includes('upstream tool returned an error with no details');
}

async function callActionWithRetry(ctx, actionName, params, options = {}) {
  const {
    attempts = 2,
    backoffMs = 300,
    timeoutMs = 45000,
    logger = null,
    actionLabel = null,
  } = options;

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await ctx.call(actionName, params, { timeout: timeoutMs });
    } catch (err) {
      lastError = err;
      const isRetriable = isRetriableError(err.message);
      if (!isRetriable || attempt >= attempts) {
        throw err;
      }

      logger?.warn(
        `${actionLabel || actionName} attempt ${attempt}/${attempts} failed (${err.message}). Retrying...`
      );
      await sleep(backoffMs * attempt);
    }
  }

  throw lastError || new Error(`Unknown error while calling ${actionName}`);
}

function normalizeOperatorName(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  // Static literal — derived from the LEGAL_SUFFIXES list (all safe, no user input)
  const LEGAL_SUFFIXES_RE = /\b(gmbh|ag|mbh|kg|e\.v|ev|gbr|ug|ohg|kgaa|se|co|holding|gruppe)\b/g;

  return value
    .toLowerCase()
    .replace(/[.,/\\()\-]/g, ' ')
    .replace(LEGAL_SUFFIXES_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true only when a code is plausibly a BNetzA BNR
 * (Netzbetreibernummer) — the identifier the EWK tools use.
 *
 * BNRs are short numeric codes (observed range: 5–10 digits, e.g.
 * 10002977 for TWL Netze GmbH).  They are completely different from
 * 13-digit BDEW market-partner codes (9904350000002, 9907473000008, …).
 *
 * Passing a 13-digit BDEW code as `bnr` to ewk_anschlussdauer /
 * ewk_umsetzungsquote / ewk_digitalisierungsindex silently returns the
 * full unfiltered result set (CR-MCP-02) — so we must guard against it.
 */
function isBnrFormat(code) {
  const s = String(code || '').trim();
  return /^\d{5,10}$/.test(s);
}

function isLikelySameOperator(sourceName, targetName) {
  if (!sourceName || !targetName) {
    return true;
  }

  const normalizedSource = normalizeOperatorName(sourceName);
  const normalizedTarget = normalizeOperatorName(targetName);

  if (!normalizedSource || !normalizedTarget) {
    return true;
  }

  if (normalizedSource === normalizedTarget) {
    return true;
  }

  const sourceTokens = new Set(normalizedSource.split(' ').filter((token) => token.length >= 3));
  const targetTokens = new Set(normalizedTarget.split(' ').filter((token) => token.length >= 3));

  if (sourceTokens.size === 0 || targetTokens.size === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of sourceTokens) {
    if (targetTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap >= 1;
}

function extractBdewCode(partner) {
  if (!partner || typeof partner !== 'object') {
    return null;
  }

  const rawCode =
    partner.bdewCode || partner.bdew || partner.code || partner.marketPartnerBdewCode || null;

  const code = rawCode ? String(rawCode).trim() : null;
  if (!code || !/^\d{13}$/.test(code)) {
    return null;
  }

  return code;
}

function extractCanonicalLookupPayload(lookupResult) {
  if (!lookupResult || typeof lookupResult !== 'object') {
    return null;
  }

  if (lookupResult.data && typeof lookupResult.data === 'object') {
    return lookupResult.data;
  }

  return lookupResult;
}

function isAliasConfidenceUsable(confidenceValue) {
  if (!confidenceValue) {
    return true;
  }

  const normalized = String(confidenceValue).toLowerCase();
  return normalized === 'high' || normalized === 'medium';
}

function extractLookupBdewCodes(lookupPayload, primaryBdewCode) {
  if (!lookupPayload || typeof lookupPayload !== 'object') {
    return [];
  }

  const codes = new Set();

  const addCode = (value) => {
    const code = value ? String(value).trim() : null;
    if (!code || !/^\d{13}$/.test(code) || code === primaryBdewCode) {
      return;
    }
    codes.add(code);
  };

  addCode(lookupPayload?.canonical?.bdewCodePrimary);

  const aliases = Array.isArray(lookupPayload.aliases) ? lookupPayload.aliases : [];
  for (const alias of aliases) {
    if (!alias || typeof alias !== 'object') {
      continue;
    }

    const type = String(alias.type || '').toLowerCase();
    if (type !== 'bdew') {
      continue;
    }

    if (!isAliasConfidenceUsable(alias.confidence)) {
      continue;
    }

    addCode(alias.code);
  }

  return Array.from(codes);
}

async function findAlternateBdewCodes(ctx, identity, primaryBdewCode) {
  // canonicalBnrCodes is populated inside the try block below and used as a
  // base for all return paths so the BNr is always passed to fetchEwkData.
  // The EWK tools (ewk_anschlussdauer, ewk_umsetzungsquote, ewk_digitalisierungsindex)
  // require the BNr (BNetzA Netzbetreibernummer, 5–10 digits) as their lookup key —
  // they do NOT accept 13-digit BDEW market-partner codes.  The BNr is returned by
  // vnb_lookup_codes as canonical.bnr and must be explicitly extracted here because
  // extractLookupBdewCodes only accepts 13-digit codes.
  let canonicalBnrCodes = [];

  try {
    const lookupResult = await ctx.call('grid-operations.vnbLookupCodes', {
      bdewCode: primaryBdewCode,
      vnbName: identity?.name || undefined,
      includeAliases: true,
      includeTrace: false,
      limitCandidates: 5,
    });

    const lookupPayload = extractCanonicalLookupPayload(lookupResult);
    const sourceConfidence = String(lookupPayload?.sourceConfidence || '').toLowerCase();
    const conflictFlags = Array.isArray(lookupPayload?.conflictFlags)
      ? lookupPayload.conflictFlags
      : [];
    const lookupCodes = extractLookupBdewCodes(lookupPayload, primaryBdewCode);

    // Extract the canonical BNr (e.g. "10002977" for TWL Netze GmbH).
    // It is a direct, unambiguous identifier — safe to use regardless of
    // conflict flags.  Place it first in the returned array so fetchEwkData
    // tries { bnr: "10002977" } before { vnbName: "TWL Netze GmbH" }.
    const rawBnr = lookupPayload?.canonical?.bnr;
    if (rawBnr && isBnrFormat(rawBnr)) {
      canonicalBnrCodes = [String(rawBnr).trim()];
    }

    // Conservative behavior on ambiguous lookups:
    // only trust BDEW alias codes from high/medium confidence lookups without conflict flags.
    if (lookupCodes.length > 0 && (sourceConfidence === 'high' || sourceConfidence === 'medium')) {
      if (conflictFlags.length === 0) {
        // BNr first, then BDEW aliases (BNr is more precise for EWK tool lookups)
        return [...canonicalBnrCodes, ...lookupCodes.filter((c) => !canonicalBnrCodes.includes(c))];
      }

      this.logger?.warn(
        `vnb_lookup_codes returned conflict flags for ${primaryBdewCode}; falling back to marketPartners aliases (${conflictFlags.join(', ')})`
      );
    }
  } catch (err) {
    this.logger?.warn(
      `vnb_lookup_codes lookup failed for ${primaryBdewCode}; falling back to marketPartners: ${err.message}`
    );
  }

  if (!identity?.name) {
    return canonicalBnrCodes;
  }

  try {
    const partnerResult = await ctx.call('grid-operations.marketPartners', {
      query: identity.name,
      limit: 20,
    });

    const partners = partnerResult?.data?.results || partnerResult?.results || [];
    const codes = new Set(canonicalBnrCodes);

    for (const partner of partners) {
      const code = extractBdewCode(partner);
      if (!code || code === primaryBdewCode) {
        continue;
      }

      const companyName = partner.companyName || partner.name || null;
      if (!isLikelySameOperator(companyName, identity.name)) {
        continue;
      }

      codes.add(code);
    }

    return Array.from(codes);
  } catch (err) {
    this.logger?.warn(
      `Failed to resolve alternate BDEW codes for ${identity.name} (${primaryBdewCode}):`,
      err.message
    );
    return canonicalBnrCodes;
  }
}

/**
 * Resolves VNB identity (name, MaStR ID) from BDEW code
 *
 * Primary: grid-operations.vnbLookup (cernion_vnb_lookup MCP tool)
 * Fallback 1: grid-operations.vnbLookupCodes (vnb_lookup_codes MCP tool) — resolves stale/alias codes
 * Fallback 2: grid-operations.marketPartners (if hintName provided)
 * Final: return "Unknown"
 */
async function resolveVnbIdentity(ctx, bdewCode, hintName = null) {
  // Attempt 1: Try vnbLookup (primary, fast lookup)
  try {
    const lookupResult = await ctx.call('grid-operations.vnbLookup', { bdew: bdewCode });
    const lookupData = lookupResult?.data || {};

    if (lookupData.mastrId || lookupData.companyName) {
      return {
        name: lookupData.companyName || hintName || 'Unknown',
        mastrId: lookupData.mastrId || null,
        bdewCode,
        location: null,
        marketPartnerBdewCode: lookupData.bdew || null,
        resolvedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    this.logger?.warn(`Failed to resolve VNB identity for ${bdewCode} via vnbLookup:`, err.message);
  }

  // Attempt 2: Try vnb_lookup_codes MCP tool to resolve stale/alias codes to canonical operator
  try {
    const canonicalResult = await ctx.call('grid-operations.vnbLookupCodes', {
      bdewCode,
      includeAliases: false,
      includeTrace: false,
    });

    // Check if the MCP call succeeded and returned canonical data
    if (canonicalResult?.success !== false && canonicalResult?.canonical) {
      const canonical = canonicalResult.canonical;
      const operatorName = canonical.name || hintName || 'Unknown';

      this.logger?.debug(`Resolved ${bdewCode} via vnbLookupCodes to "${operatorName}"`);
      return {
        name: operatorName,
        mastrId: canonical.mastrId || null,
        // BNr (BNetzA Netzbetreibernummer) — the identifier the EWK tools use.
        // Distinct from the 13-digit BDEW market-partner code.
        bnr: canonical.bnr || null,
        bdewCode,
        location: null,
        marketPartnerBdewCode: canonical.bdewCodePrimary || null,
        resolvedAt: new Date().toISOString(),
      };
    }

    // If MCP call failed or returned null canonical, log and continue to next fallback
    if (canonicalResult?.success === false) {
      this.logger?.warn(
        `vnbLookupCodes returned error for ${bdewCode}: ${canonicalResult?.error?.message || 'unknown error'}`
      );
    }
  } catch (err) {
    this.logger?.warn(
      `Failed to resolve VNB identity for ${bdewCode} via vnbLookupCodes:`,
      err.message
    );
  }

  // Attempt 3: Try marketPartners with hint name
  if (hintName) {
    try {
      const partnerResult = await ctx.call('grid-operations.marketPartners', {
        query: hintName,
        limit: 5,
      });
      const firstMatch = partnerResult?.data?.results?.[0] || null;

      if (firstMatch) {
        return {
          name: firstMatch.companyName || hintName,
          mastrId: stripAnnotatedMastrId(firstMatch.mastrNetzbetreiberId),
          bdewCode,
          location: firstMatch.contacts?.[0]?.city || null,
          marketPartnerBdewCode: firstMatch.bdewCode || null,
          resolvedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      this.logger?.warn(`Failed to resolve market partner for ${hintName}:`, err.message);
    }
  }

  return {
    name: hintName || 'Unknown',
    mastrId: null,
    bdewCode,
    location: null,
    marketPartnerBdewCode: null,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Fetches EWK benchmarks with BDEW and provider-name fallback
 */
async function fetchEwkData(ctx, bdewCode, options = {}) {
  const { providerName = null, alternateBdewCodes = [] } = options;
  const results = {
    sourceAvailable: false,
    reportYear: 2024,
    operatorName: null,
    anschlussdauer: null,
    umsetzungsquote: null,
    digitalisierungsindex: null,
    sourceError: null,
  };

  const metricErrors = {
    anschlussdauer: [],
    umsetzungsquote: [],
    digitalisierungsindex: [],
  };

  const ewkQueries = [
    // Only pass a code as `bnr` when it is in BNR format (5–10 digits).
    // 13-digit BDEW market-partner codes (9904350000002, 9907473000008 …)
    // are NOT valid BNRs.  Passing them to the EWK tools triggers a silent
    // fallback that returns all ~789 VNBs in default sort order (CR-MCP-02).
    ...(isBnrFormat(bdewCode) ? [{ bnr: bdewCode }] : []),
    ...alternateBdewCodes.filter(isBnrFormat).map((code) => ({ bnr: code })),
    ...(providerName ? [{ vnbName: providerName }] : []),
  ];

  try {
    for (const ewkQuery of ewkQueries) {
      const queryLabel = ewkQuery.bnr || ewkQuery.vnbName || bdewCode;

      // Sequential calls – the Cernion MCP server enforces a ~3-session-per-token
      // concurrency limit. Firing all three EWK tools in parallel risks a
      // "-32001 Session not found" error when another concurrent request opens
      // sessions at the same time.

      // ── Step 1: anschlussdauer probe ────────────────────────────────────────
      // Call anschlussdauer first so cross-provider mismatches (e.g. a stale
      // market-partner DB entry that maps a foreign BDEW code to our operator's
      // name) are detected before spending two more round-trips on
      // umsetzungsquote and digitalisierungsindex.  When the probe row names a
      // different operator we skip the remaining calls immediately (saves 2 EWK
      // round-trips per stale alternate code in the fallback chain).
      const anschlussdauer = await callActionWithRetry(
        ctx,
        'ewk-monitoring.anschlussdauer',
        ewkQuery,
        {
          attempts: 2,
          backoffMs: 300,
          timeoutMs: 45000,
          logger: this.logger,
          actionLabel: `EWK anschlussdauer (${queryLabel})`,
        }
      ).catch((err) => {
        metricErrors.anschlussdauer.push(`anschlussdauer (${queryLabel}): ${err.message}`);
        this.logger?.warn(`EWK anschlussdauer failed for ${queryLabel}:`, err.message);
        return null;
      });

      const anschlussdauerJson = parseStructuredToolResult(anschlussdauer);
      const anschlussRow = anschlussdauerJson?.rows?.[0] || null;

      if (anschlussRow) {
        const probeOperatorName = anschlussRow.firmenname || null;
        if (
          probeOperatorName &&
          providerName &&
          !isLikelySameOperator(probeOperatorName, providerName)
        ) {
          this.logger?.warn(
            `EWK provider mismatch for ${bdewCode}: got "${probeOperatorName}" for query ` +
              `${JSON.stringify(ewkQuery)}, expected "${providerName}" – skipping remaining EWK calls`
          );
          continue;
        }
      }

      // ── Step 2: remaining tools (only reached when probe is clean) ───────────
      const umsetzungsquote = await callActionWithRetry(
        ctx,
        'ewk-monitoring.umsetzungsquote',
        ewkQuery,
        {
          attempts: 2,
          backoffMs: 300,
          timeoutMs: 45000,
          logger: this.logger,
          actionLabel: `EWK umsetzungsquote (${queryLabel})`,
        }
      ).catch((err) => {
        metricErrors.umsetzungsquote.push(`umsetzungsquote (${queryLabel}): ${err.message}`);
        this.logger?.warn(`EWK umsetzungsquote failed for ${queryLabel}:`, err.message);
        return null;
      });

      const digitalisierungsindex = await callActionWithRetry(
        ctx,
        'ewk-monitoring.digitalisierungsindex',
        ewkQuery,
        {
          attempts: 2,
          backoffMs: 300,
          timeoutMs: 45000,
          logger: this.logger,
          actionLabel: `EWK digitalisierungsindex (${queryLabel})`,
        }
      ).catch((err) => {
        metricErrors.digitalisierungsindex.push(
          `digitalisierungsindex (${queryLabel}): ${err.message}`
        );
        this.logger?.warn(`EWK digitalisierungsindex failed for ${queryLabel}:`, err.message);
        return null;
      });

      const umsetzungsquoteJson = parseStructuredToolResult(umsetzungsquote);
      const digitalisierungsindexJson = parseStructuredToolResult(digitalisierungsindex);

      const umsetzungsquoteRow = umsetzungsquoteJson?.rows?.[0] || null;
      const digitalisierungsindexRow = digitalisierungsindexJson?.rows?.[0] || null;

      if (!(anschlussRow || umsetzungsquoteRow || digitalisierungsindexRow)) {
        continue;
      }

      const candidateOperatorName =
        anschlussRow?.firmenname ||
        umsetzungsquoteRow?.firmenname ||
        digitalisierungsindexRow?.firmenname ||
        null;

      // Final mismatch guard: covers the edge case where the probe returned no
      // rows (operator has no anschlussdauer data) but a later call returned
      // data for a different operator.
      if (
        candidateOperatorName &&
        providerName &&
        !isLikelySameOperator(candidateOperatorName, providerName)
      ) {
        this.logger?.warn(
          `EWK provider mismatch for ${bdewCode}: got "${candidateOperatorName}" for query ${JSON.stringify(ewkQuery)}, expected "${providerName}"`
        );
        continue;
      }

      results.sourceAvailable = true;
      results.operatorName = results.operatorName || candidateOperatorName;

      if (anschlussRow && !results.anschlussdauer) {
        const eeNsRank = parseRank(anschlussRow.rank_ee_ns);
        const verbrauchNsRank = parseRank(anschlussRow.rank_verbrauch_ns);
        results.anschlussdauer = {
          eeNS_weeks: anschlussRow.ee_ns_gesamt_wochen ?? null,
          eeNS_phase1_weeks: anschlussRow.ee_ns_phase1_wochen ?? null,
          eeNS_phase2_weeks: anschlussRow.ee_ns_phase2_wochen ?? null,
          verbrauchNS_weeks: anschlussRow.verbrauch_ns_gesamt_wochen ?? null,
          eeMS_weeks: anschlussRow.ee_ms_gesamt_wochen ?? null,
          rankEeNS: eeNsRank.rank,
          rankVerbrauchNS: verbrauchNsRank.rank,
          totalVnbs: eeNsRank.total || verbrauchNsRank.total,
          bundesmedianEeNS_weeks: anschlussdauerJson?.stats?.ee_ns_gesamt?.median ?? null,
          bundesmedianVerbrauchNS_weeks:
            anschlussdauerJson?.stats?.verbrauch_ns_gesamt?.median ?? null,
        };
      }

      if (umsetzungsquoteRow && !results.umsetzungsquote) {
        const eeNsRank = parseRank(umsetzungsquoteRow.rank_umsetzungsquote_ee_ns);
        results.umsetzungsquote = {
          eeNS_percent: umsetzungsquoteRow.umsetzungsquote_ee_ns ?? null,
          verbrauchNS_percent: umsetzungsquoteRow.umsetzungsquote_verbrauch_ns ?? null,
          verbrauchMS_percent: umsetzungsquoteRow.umsetzungsquote_verbrauch_ms ?? null,
          rankEeNS: eeNsRank.rank,
          totalVnbs: eeNsRank.total,
        };
      }

      if (digitalisierungsindexRow && !results.digitalisierungsindex) {
        results.digitalisierungsindex = {
          gesamt_percent: digitalisierungsindexJson?.stats?.gesamtscore?.median
            ? Math.round(digitalisierungsindexJson.stats.gesamtscore.median)
            : null,
          smartGrids_percent: digitalisierungsindexRow.smart_grids_ns ?? null,
          kundenportal_percent: digitalisierungsindexRow.kundenmanagement_webportale ?? null,
          datenmanagement_percent: digitalisierungsindexRow.datenmanagement ?? null,
          kiEinsatz_percent: digitalisierungsindexRow.digitale_prozesse_ai ?? null,
          rank: null,
          totalVnbs: digitalisierungsindexJson?.stats?.gesamtscore?.n ?? null,
          bundesmedian_percent: digitalisierungsindexJson?.stats?.gesamtscore?.median ?? null,
        };
      }

      if (results.anschlussdauer && results.umsetzungsquote && results.digitalisierungsindex) {
        break;
      }
    }
  } catch (err) {
    results.sourceError = err.message;
    this.logger?.warn(`EWK data fetch failed for ${bdewCode}:`, err.message);
  }

  if (!results.sourceError) {
    const unresolvedErrors = [];
    if (!results.anschlussdauer) {
      unresolvedErrors.push(...metricErrors.anschlussdauer);
    }
    // When anschlussdauer succeeded (operator is confirmed in EWK), suppress
    // generic "upstream tool returned isError" failures for the secondary metrics.
    // These indicate the operator is absent from that specific EWK dataset —
    // a data gap, not a service failure.  Real transient errors (timeout,
    // session-not-found) are not matched by isEwkDataGapError and still bubble up.
    const ewkPartialOk = results.sourceAvailable;
    if (!results.umsetzungsquote) {
      const allDataGap =
        ewkPartialOk &&
        metricErrors.umsetzungsquote.length > 0 &&
        metricErrors.umsetzungsquote.every(isEwkDataGapError);
      if (!allDataGap) {
        unresolvedErrors.push(...metricErrors.umsetzungsquote);
      }
    }
    if (!results.digitalisierungsindex) {
      const allDataGap =
        ewkPartialOk &&
        metricErrors.digitalisierungsindex.length > 0 &&
        metricErrors.digitalisierungsindex.every(isEwkDataGapError);
      if (!allDataGap) {
        unresolvedErrors.push(...metricErrors.digitalisierungsindex);
      }
    }

    if (unresolvedErrors.length > 0) {
      results.sourceError = Array.from(new Set(unresolvedErrors)).join('; ');
    }
  }

  return results;
}

/**
 * Fetches MaStR installation data
 */
async function fetchMastrData(ctx, identity) {
  const results = {
    sourceAvailable: false,
    asOf: new Date().toISOString().split('T')[0],
    inBetrieb: null,
    inPlanung: null,
    netzbetreiberPruefung: null,
    sourceError: null,
  };

  const sourceErrors = [];

  const filterParams = {
    bdewCode: identity.marketPartnerBdewCode || undefined,
    gridOperatorId: identity.mastrId || undefined,
    vnbName: identity.name && identity.name !== 'Unknown' ? identity.name : undefined,
  };

  if (!filterParams.bdewCode && !filterParams.gridOperatorId && !filterParams.vnbName) {
    results.sourceError = 'No MaStR-capable grid operator identity could be resolved';
    return results;
  }

  const fetchAssetsSafe = async (params, errorPrefix, logLabel) => {
    return callActionWithRetry(ctx, 'assets.all', params, {
      attempts: 2,
      backoffMs: 350,
      timeoutMs: 90000,
      logger: this.logger,
      actionLabel: `assets.all ${logLabel}`,
    }).catch((err) => {
      sourceErrors.push(`${errorPrefix}: ${err.message}`);
      this.logger?.warn(`MaStR ${logLabel} failed for ${identity.name}:`, err.message);
      return null;
    });
  };

  try {
    // IMPORTANT: keep calls sequential to avoid MCP session spikes.
    // Each assets.all call fans out internally by technology, so a Promise.all
    // here can trigger nested concurrency and cause upstream "Session not found".
    //
    // No limit is passed (→ energy-market uses unlimited pagination) so that VNBs
    // with >1000 installations of a single type are counted correctly.
    // includeNapData: false — VNB monitor only aggregates counts/capacity; NAP
    // fields (MeLo, Spannungsebene, Engpasskapazität) are unused and increase
    // per-row payload significantly.
    const installedAssets = await fetchAssetsSafe(
      {
        ...filterParams,
        operationalStatus: '35',
        includeNapData: false,
      },
      'inBetrieb',
      'inBetrieb'
    );

    const plannedAssets = await fetchAssetsSafe(
      {
        ...filterParams,
        operationalStatus: '31',
        includeNapData: false,
      },
      'inPlanung',
      'inPlanung'
    );

    const queueAssets = await fetchAssetsSafe(
      {
        ...filterParams,
        operationalStatus: 'all',
        netzbetreiberPruefungStatus: '2955',
        includeNapData: false,
      },
      'netzbetreiberPruefung',
      'netzbetreiberPruefung'
    );

    const installedRows = Array.isArray(installedAssets) ? installedAssets : [];
    const plannedRows = Array.isArray(plannedAssets) ? plannedAssets : [];
    const queueRows = Array.isArray(queueAssets) ? queueAssets : [];

    if (installedRows.length || plannedRows.length || queueRows.length) {
      results.sourceAvailable = true;

      if (installedRows.length) {
        const totalInstalledCapacity = sumBy(installedRows, (item) => item['Leistung MW']);
        results.inBetrieb = {
          anlagenCount: installedRows.length,
          leistungMW: totalInstalledCapacity.toFixed(1),
          pvAnlagen: countByType(installedRows, 'solar'),
          pvLeistungMW: sumCapacityByType(installedRows, 'solar').toFixed(1),
          windAnlagen: countByType(installedRows, 'wind'),
          windLeistungMW: sumCapacityByType(installedRows, 'wind').toFixed(1),
          speicherAnlagen: countByType(installedRows, 'storage'),
          speicherLeistungMW: sumCapacityByType(installedRows, 'storage').toFixed(1),
        };
      }

      if (plannedRows.length) {
        const totalPlannedCapacity = sumBy(plannedRows, (item) => item['Leistung MW']);
        results.inPlanung = {
          anlagenCount: plannedRows.length,
          leistungMW: totalPlannedCapacity.toFixed(1),
          percentOfInstalledCapacity:
            results.inBetrieb && Number(results.inBetrieb.leistungMW) > 0
              ? ((totalPlannedCapacity / Number(results.inBetrieb.leistungMW)) * 100).toFixed(1)
              : 0,
        };
      }

      if (queueRows.length) {
        results.netzbetreiberPruefung = {
          anlagenCount: queueRows.length,
          leistungMW: sumBy(queueRows, (item) => item['Leistung MW']).toFixed(1),
          davonSpeicher: countByType(queueRows, 'storage'),
          davonPv: countByType(queueRows, 'solar'),
          davonWind: countByType(queueRows, 'wind'),
        };
      }
    }
  } catch (err) {
    results.sourceError = err.message;
    this.logger?.warn(
      `MaStR data fetch failed for ${identity.name || identity.bdewCode}:`,
      err.message
    );
  }

  if (!results.sourceError && sourceErrors.length > 0) {
    results.sourceError = sourceErrors.join('; ');
  }

  return results;
}

/**
 * Fetches market data (spot prices, gas storage)
 */
async function fetchMarketData(ctx) {
  const results = {
    sourceAvailable: false,
    dayAheadPrice_eurMWh: null,
    co2Intensity_gCO2eqKWh: null,
    gasStorageDE_percent: null,
    gasStorageStatus: null,
    timestamp: new Date().toISOString(),
    sourceError: null,
  };

  const sourceErrors = [];
  const today = new Date().toISOString().split('T')[0];

  try {
    // Sequential calls – both endpoints are MCP-backed and can overlap with
    // the MaStR/identity phases of the same snapshot or with a concurrent
    // nbp-monitor request for the same VNB. Running them serially avoids
    // exhausting the upstream per-token session limit.
    let priceData = await callActionWithRetry(
      ctx,
      'energy-market.prices',
      { market: 'day-ahead', region: 'Deutschland', date: today },
      {
        attempts: 2,
        backoffMs: 300,
        timeoutMs: 45000,
        logger: this.logger,
        actionLabel: 'energy-market.prices',
      }
    ).catch((err) => {
      sourceErrors.push(`prices: ${err.message}`);
      this.logger?.warn('Market prices fetch failed:', err.message);
      return null;
    });

    let primaryPriceError = null;
    if (priceData?.success === false) {
      primaryPriceError = priceData.error?.message || 'unknown upstream error';
    }

    // Fallback to german-grid.spotprices (includes ENTSO-E fallback internally)
    // if the primary day-ahead endpoint fails or returns no data points.
    if (
      !priceData ||
      priceData?.success === false ||
      !Array.isArray(priceData?.dataPoints) ||
      !priceData.dataPoints[0]
    ) {
      const fallbackSpot = await callActionWithRetry(
        ctx,
        'german-grid.spotprices',
        { dateFrom: today, dateTo: today, includeStatistics: true },
        {
          attempts: 2,
          backoffMs: 300,
          timeoutMs: 45000,
          logger: this.logger,
          actionLabel: 'german-grid.spotprices',
        }
      ).catch((err) => {
        sourceErrors.push(`prices-fallback: ${err.message}`);
        this.logger?.warn('Spot prices fallback failed:', err.message);
        return null;
      });

      const fallbackJson = parseStructuredToolResult(fallbackSpot);
      const fallbackPricePoints =
        fallbackSpot?.dataPoints ||
        fallbackSpot?.data?.dataPoints ||
        fallbackJson?.dataPoints ||
        [];

      if (Array.isArray(fallbackPricePoints) && fallbackPricePoints[0]) {
        priceData = {
          success: true,
          dataPoints: fallbackPricePoints,
        };
      } else if (primaryPriceError) {
        sourceErrors.push(`prices: ${primaryPriceError}`);
      }
    }

    const gasData = await callActionWithRetry(
      ctx,
      'gas-storage.countryStorage',
      { country: 'DE' },
      {
        attempts: 2,
        backoffMs: 300,
        timeoutMs: 60000,
        logger: this.logger,
        actionLabel: 'gas-storage.countryStorage',
      }
    ).catch((err) => {
      sourceErrors.push(`gas-storage: ${err.message}`);
      this.logger?.warn('Gas storage fetch failed:', err.message);
      return null;
    });

    if (priceData || gasData) {
      results.sourceAvailable = true;

      if (
        priceData?.success !== false &&
        Array.isArray(priceData?.dataPoints) &&
        priceData.dataPoints[0]
      ) {
        results.dayAheadPrice_eurMWh = Number(priceData.dataPoints[0].priceEURperMWh).toFixed(2);
      } else if (priceData?.success === false) {
        sourceErrors.push(`prices: ${priceData.error?.message || 'unknown upstream error'}`);
      }

      if (gasData?.success !== false && gasData?.data?.storage) {
        results.gasStorageDE_percent = Number(gasData.data.storage.fillPercentage).toFixed(1);
        const fillPercent = parseFloat(results.gasStorageDE_percent);
        results.gasStorageStatus =
          fillPercent < 20
            ? 'CRITICAL'
            : fillPercent < 30
              ? 'WARNING'
              : fillPercent < 70
                ? 'NORMAL'
                : 'FULL';
        results.timestamp = gasData?.metadata?.timestamp || results.timestamp;
      } else if (gasData?.success === false) {
        sourceErrors.push(`gas-storage: ${gasData.error?.message || 'unknown upstream error'}`);
      }
    }
  } catch (err) {
    results.sourceError = err.message;
    this.logger?.warn('Market data fetch failed:', err.message);
  }

  if (!results.sourceError && sourceErrors.length > 0) {
    results.sourceError = sourceErrors.join('; ');
  }

  return results;
}

/**
 * Generates alerts based on thresholds
 */
function generateAlerts(data, thresholds, lang = 'de') {
  const alerts = [];

  if (!data.ewk || !data.ewk.sourceAvailable) {
    return alerts;
  }

  const check = (fieldPath, currentValue, code, group) => {
    const config = thresholds[fieldPath];
    if (!config || currentValue === null || currentValue === undefined) {
      return null;
    }

    const current = parseFloat(currentValue);
    const isInverse = config.inverse;

    let severity = null;
    let threshold = null;

    if (isInverse) {
      // Lower is worse (percentages)
      if (current < config.critical) {
        severity = 'critical';
        threshold = config.critical;
      } else if (current < config.warning) {
        severity = 'warning';
        threshold = config.warning;
      }
    } else {
      // Higher is worse (weeks, MW)
      if (current > config.critical) {
        severity = 'critical';
        threshold = config.critical;
      } else if (current > config.warning) {
        severity = 'warning';
        threshold = config.warning;
      }
    }

    if (severity) {
      const codeDef = VNB_MONITOR_DEFAULTS.alertCodeDefinitions[code];
      return {
        severity,
        code,
        group,
        field: fieldPath.split('.').pop(),
        currentValue: current,
        threshold,
        message: `${config.description}: ${current} (${lang === 'en' ? 'threshold' : 'Schwelle'}: ${threshold})`,
        message_en: `${config.description}: ${current} (threshold: ${threshold})`,
        recommendation: codeDef ? codeDef[`recommendation_${lang}`] : 'Review operation parameters',
        ewkImpact: codeDef ? codeDef.ewkImpact : false,
      };
    }

    return null;
  };

  // Check EWK Anschlussdauer
  if (data.ewk.anschlussdauer) {
    const ad = data.ewk.anschlussdauer;
    const eeNsAlert = check(
      'ewk.anschlussdauer.eeNS_weeks',
      ad.eeNS_weeks,
      `ANSCHLUSSDAUER_EE_NS_${ad.eeNS_weeks > 90 ? 'CRITICAL' : 'WARNING'}`,
      'ewk.anschlussdauer'
    );
    if (eeNsAlert) {
      eeNsAlert.rank = ad.rankEeNS ? `${ad.rankEeNS}/${ad.totalVnbs}` : null;
      alerts.push(eeNsAlert);
    }

    const verbrNsAlert = check(
      'ewk.anschlussdauer.verbrauchNS_weeks',
      ad.verbrauchNS_weeks,
      `ANSCHLUSSDAUER_VERBRAUCH_${ad.verbrauchNS_weeks > 100 ? 'CRITICAL' : 'WARNING'}`,
      'ewk.anschlussdauer'
    );
    if (verbrNsAlert) {
      verbrNsAlert.rank = ad.rankVerbrauchNS ? `${ad.rankVerbrauchNS}/${ad.totalVnbs}` : null;
      alerts.push(verbrNsAlert);
    }
  }

  // Check EWK Umsetzungsquote
  if (data.ewk.umsetzungsquote) {
    const uq = data.ewk.umsetzungsquote;
    const eeNsAlert = check(
      'ewk.umsetzungsquote.eeNS_percent',
      uq.eeNS_percent,
      `UMSETZUNGSQUOTE_EE_NS_${uq.eeNS_percent < 40 ? 'CRITICAL' : 'WARNING'}`,
      'ewk.umsetzungsquote'
    );
    if (eeNsAlert) {
      eeNsAlert.rank = uq.rankEeNS ? `${uq.rankEeNS}/${uq.totalVnbs}` : null;
      alerts.push(eeNsAlert);
    }
  }

  // Check EWK Digitalisierungsindex
  if (data.ewk.digitalisierungsindex) {
    const di = data.ewk.digitalisierungsindex;
    const alert = check(
      'ewk.digitalisierungsindex.gesamt_percent',
      di.gesamt_percent,
      `DIGITALISIERUNGSINDEX_${di.gesamt_percent < 15 ? 'CRITICAL' : 'WARNING'}`,
      'ewk.digitalisierungsindex'
    );
    if (alert) {
      alert.rank = di.rank ? `${di.rank}/${di.totalVnbs}` : null;
      alerts.push(alert);
    }
  }

  // Check MaStR Prüfung Queue
  if (data.mastr && data.mastr.sourceAvailable && data.mastr.netzbetreiberPruefung) {
    const np = data.mastr.netzbetreiberPruefung;
    const alert = check(
      'mastr.netzbetreiberPruefung.leistungMW',
      np.leistungMW,
      `PRÜFUNG_QUEUE_${parseFloat(np.leistungMW) > 100 ? 'CRITICAL' : 'WARNING'}`,
      'mastr.netzbetreiberPruefung'
    );
    if (alert) {
      alerts.push(alert);
    }
  }

  // Check Market Gas Storage
  if (data.market && data.market.sourceAvailable && data.market.gasStorageDE_percent) {
    const gasAlert = check(
      'market.gasStorageDE_percent',
      data.market.gasStorageDE_percent,
      `GAS_STORAGE_${parseFloat(data.market.gasStorageDE_percent) < 20 ? 'CRITICAL' : 'WARNING'}`,
      'market.gasStorage'
    );
    if (gasAlert) {
      alerts.push(gasAlert);
    }
  }

  return alerts;
}

module.exports = {
  name: 'vnb-monitor',

  settings: {
    cacheTtlSeconds: CACHE_TTL_SECONDS,
    schemaVersion: SCHEMA_VERSION,
  },

  created() {
    this.cache = new Map();
  },

  actions: {
    /**
     * GET /api/vnb-monitor/:bdewCode
     * Returns full KPI snapshot for a single VNB
     */
    snapshot: {
      rest: 'GET /:bdewCode',
      params: {
        bdewCode: { type: 'string', required: true },
        refresh: { type: 'boolean', optional: true, default: false, convert: true },
        alerts: { type: 'boolean', optional: true, default: true, convert: true },
        lang: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
      },
      openapi: {
        summary: 'Get full KPI snapshot for a single VNB',
        tags: ['VNBMonitor'],
        description:
          'Returns aggregated KPIs from EWK, MaStR, and market data for a German grid operator (VNB). Results are cached with a configurable TTL.',
        parameters: [
          {
            name: 'bdewCode',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '10002954' },
            description: 'BDEW registration number',
          },
          {
            name: 'refresh',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Force cache bypass and re-fetch all KPIs',
          },
          {
            name: 'alerts',
            in: 'query',
            schema: { type: 'boolean', default: true },
            description: 'Include alerts array in response',
          },
          {
            name: 'lang',
            in: 'query',
            schema: { type: 'string', enum: ['de', 'en'], default: 'de' },
            description: 'Language for alert messages',
          },
        ],
        responses: {
          200: {
            description: 'Full KPI snapshot',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    schemaVersion: { type: 'string' },
                    bdewCode: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    identity: { type: 'object' },
                    ewk: { type: 'object' },
                    mastr: { type: 'object' },
                    market: { type: 'object' },
                    alerts: { type: 'array' },
                    alertSummary: { type: 'object' },
                  },
                },
              },
            },
          },
          404: {
            description: 'VNB not found',
          },
          503: {
            description: 'All data sources unavailable',
          },
        },
      },
      async handler(ctx) {
        const { bdewCode, refresh, alerts: includeAlerts, lang } = ctx.params;
        const tenantId = getTenantId(ctx);
        const { thresholds } = await this.loadThresholds(ctx);

        // Check cache
        const cacheKey = this.getCacheKey(bdewCode, tenantId);
        if (!refresh && this.cache.has(cacheKey)) {
          const cached = this.cache.get(cacheKey);
          if (new Date() < new Date(cached.expiresAt)) {
            return cached.data;
          }
        }

        const identity = await resolveVnbIdentity.call(this, ctx, bdewCode);
        const alternateBdewCodes = await findAlternateBdewCodes.call(this, ctx, identity, bdewCode);

        // Pass null as providerName when identity is unresolved so the mismatch guard
        // in fetchEwkData does not compare against the sentinel string "Unknown".
        // The EWK anschlussdauer probe itself can resolve the operator name from a
        // stale/alias BDEW code and we must not discard that result.
        const resolvedProviderName = identity.name !== 'Unknown' ? identity.name : null;
        const ewkData = await fetchEwkData.call(this, ctx, bdewCode, {
          providerName: resolvedProviderName,
          alternateBdewCodes,
        });

        // Back-fill identity from EWK result when upstream lookups (vnbLookup,
        // vnbLookupCodes) returned no record for this BDEW code.  The EWK probe
        // is the last authoritative source for resolving stale/alias codes.
        if (identity.name === 'Unknown' && ewkData.operatorName) {
          identity.name = ewkData.operatorName;
        }

        // Keep EWK operatorName consistent with identity only when identity is known.
        if (ewkData.sourceAvailable && identity.name && identity.name !== 'Unknown') {
          ewkData.operatorName = identity.name;
        }

        const [mastrData, marketData] = await Promise.all([
          fetchMastrData.call(this, ctx, identity),
          fetchMarketData.call(this, ctx),
        ]);

        // Build snapshot
        const snapshot = {
          schemaVersion: SCHEMA_VERSION,
          bdewCode,
          timestamp: new Date().toISOString(),
          cachedAt: new Date().toISOString(),
          ttlSeconds: CACHE_TTL_SECONDS,
          identity: {
            name: identity.name,
            mastrId: identity.mastrId,
            bnr: identity.bnr || null,
            bdewCode,
            location: identity.location,
            resolvedAt: identity.resolvedAt,
          },
          ewk: ewkData,
          mastr: mastrData,
          market: marketData,
          alerts: includeAlerts
            ? generateAlerts(
                { ewk: ewkData, mastr: mastrData, market: marketData },
                thresholds,
                lang
              )
            : [],
          alertSummary: null,
          sourceErrors: [],
        };

        // Build alert summary
        if (snapshot.alerts.length > 0) {
          snapshot.alertSummary = {
            total: snapshot.alerts.length,
            critical: snapshot.alerts.filter((a) => a.severity === 'critical').length,
            warning: snapshot.alerts.filter((a) => a.severity === 'warning').length,
            info: 0,
            ewkRelevant: snapshot.alerts.filter((a) => a.ewkImpact).length,
          };
        } else {
          snapshot.alertSummary = {
            total: 0,
            critical: 0,
            warning: 0,
            info: 0,
            ewkRelevant: 0,
          };
        }

        // Record source errors
        if (ewkData.sourceError) snapshot.sourceErrors.push(`ewk: ${ewkData.sourceError}`);
        if (mastrData.sourceError) snapshot.sourceErrors.push(`mastr: ${mastrData.sourceError}`);
        if (marketData.sourceError) snapshot.sourceErrors.push(`market: ${marketData.sourceError}`);

        // Cache result
        const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString();
        this.cache.set(cacheKey, { data: snapshot, expiresAt });

        return snapshot;
      },
    },

    /**
     * GET /api/vnb-monitor
     * Returns KPI snapshots for multiple VNBs
     */
    snapshotMulti: {
      rest: 'GET /',
      params: {
        bdewCodes: { type: 'string', required: true },
        refresh: { type: 'boolean', optional: true, default: false, convert: true },
        lang: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
      },
      openapi: {
        summary: 'Get KPI snapshots for multiple VNBs',
        tags: ['VNBMonitor'],
        description: 'Returns aggregated KPIs for multiple grid operators in a single call.',
        parameters: [
          {
            name: 'bdewCodes',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '10002954,9900386000008' },
            description: 'Comma-separated BDEW codes',
          },
          {
            name: 'refresh',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Force cache bypass',
          },
          {
            name: 'lang',
            in: 'query',
            schema: { type: 'string', enum: ['de', 'en'], default: 'de' },
            description: 'Language for alert messages',
          },
        ],
        responses: {
          200: {
            description: 'Array of KPI snapshots',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { bdewCodes, refresh, lang } = ctx.params;
        const codes = bdewCodes.split(',').map((c) => c.trim());

        return await Promise.all(
          codes.map((code) =>
            ctx.call('vnb-monitor.snapshot', {
              bdewCode: code,
              refresh,
              alerts: true,
              lang,
            })
          )
        );
      },
    },

    /**
     * GET /api/vnb-monitor/:bdewCode/alerts
     * Returns only the alerts array for a VNB
     */
    alerts: {
      rest: 'GET /:bdewCode/alerts',
      params: {
        bdewCode: { type: 'string', required: true },
        refresh: { type: 'boolean', optional: true, default: false, convert: true },
        lang: { type: 'enum', values: ['de', 'en'], optional: true, default: 'de' },
      },
      openapi: {
        summary: 'Get only alerts for a VNB',
        tags: ['VNBMonitor'],
        description: 'Returns only the alerts array — optimized for Power Automate polling.',
        parameters: [
          {
            name: 'bdewCode',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '10002954' },
            description: 'BDEW registration number',
          },
          {
            name: 'refresh',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Force cache bypass',
          },
          {
            name: 'lang',
            in: 'query',
            schema: { type: 'string', enum: ['de', 'en'], default: 'de' },
            description: 'Language for alert messages',
          },
        ],
        responses: {
          200: {
            description: 'Alerts array with summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    bdewCode: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    alertCount: { type: 'number' },
                    criticalCount: { type: 'number' },
                    alerts: { type: 'array' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { bdewCode, refresh, lang } = ctx.params;

        const snapshot = await ctx.call('vnb-monitor.snapshot', {
          bdewCode,
          refresh,
          alerts: true,
          lang,
        });

        return {
          bdewCode,
          timestamp: snapshot.timestamp,
          alertCount: snapshot.alertSummary.total,
          criticalCount: snapshot.alertSummary.critical,
          alerts: snapshot.alerts,
        };
      },
    },

    /**
     * POST /api/vnb-monitor/:bdewCode/cache/clear
     * Clears cache for a specific VNB
     */
    clearCache: {
      rest: 'POST /:bdewCode/cache/clear',
      params: {
        bdewCode: { type: 'string', required: true },
      },
      openapi: {
        summary: 'Clear cache for a VNB',
        tags: ['VNBMonitor'],
        description:
          'Removes the cached snapshot for a VNB, forcing a fresh fetch on next request.',
        parameters: [
          {
            name: 'bdewCode',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '10002954' },
            description: 'BDEW registration number',
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Empty object',
              },
              examples: {
                empty: {
                  summary: 'Empty request body',
                  value: {},
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Cache cleared',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    bdewCode: { type: 'string' },
                    cleared: { type: 'boolean' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { bdewCode } = ctx.params;
        const cacheKey = this.getCacheKey(bdewCode, getTenantId(ctx));
        const existed = this.cache.has(cacheKey);
        this.cache.delete(cacheKey);

        return {
          bdewCode,
          cleared: true,
          message: existed
            ? `Cache cleared for ${bdewCode}`
            : `No cache entry found for ${bdewCode}`,
        };
      },
    },

    /**
     * GET /api/vnb-monitor/thresholds
     * Returns current alert thresholds
     */
    getThresholds: {
      rest: 'GET /thresholds',
      openapi: {
        summary: 'Get active VNB monitor alert thresholds',
        tags: ['VNBMonitor', 'IntegrationHub'],
        responses: {
          200: {
            description: 'Current thresholds',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    source: { type: 'string' },
                    thresholds: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return this.loadThresholds(ctx);
      },
    },

    /**
     * PUT /api/vnb-monitor/thresholds
     * Replaces alert thresholds and clears cache
     */
    setThresholds: {
      rest: 'PUT /thresholds',
      params: {
        thresholds: { type: 'object', required: true },
      },
      openapi: {
        summary: 'Set VNB monitor alert thresholds (full replace)',
        tags: ['VNBMonitor', 'IntegrationHub'],
      },
      async handler(ctx) {
        const nextThresholds = this.validateThresholds(ctx.params.thresholds);
        const tenantId = getTenantId(ctx);
        await ctx.call('object-store.put', {
          namespace: this.getThresholdNamespace(ctx),
          key: THRESHOLD_KEY,
          payload: nextThresholds,
        });
        this.clearTenantCache(tenantId);

        return {
          success: true,
          message: 'Alert thresholds updated and cache invalidated.',
          thresholds: mergeThresholds(VNB_MONITOR_DEFAULTS.thresholds, nextThresholds),
        };
      },
    },

    /**
     * DELETE /api/vnb-monitor/thresholds
     * Restores default thresholds and clears cache
     */
    resetThresholds: {
      rest: 'DELETE /thresholds',
      openapi: {
        summary: 'Reset VNB monitor alert thresholds to defaults',
        tags: ['VNBMonitor', 'IntegrationHub'],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          await ctx.call('object-store.delete', {
            namespace: this.getThresholdNamespace(ctx),
            key: THRESHOLD_KEY,
          });
        } catch (_) {
          /* ignore — key may not exist */
        }
        this.clearTenantCache(tenantId);

        return {
          success: true,
          message: 'Alert thresholds reset to defaults and cache invalidated.',
          thresholds: { ...VNB_MONITOR_DEFAULTS.thresholds },
        };
      },
    },
  },

  methods: {
    getThresholdNamespace(ctx) {
      return tenantNamespace(THRESHOLD_NAMESPACE, getTenantId(ctx));
    },

    getCacheKey(bdewCode, tenantId) {
      return `vnb-monitor:${tenantId}:${bdewCode}`;
    },

    clearTenantCache(tenantId) {
      const prefix = `vnb-monitor:${tenantId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      }
    },

    async loadThresholds(ctx) {
      try {
        const stored = await ctx.call('object-store.get', {
          namespace: this.getThresholdNamespace(ctx),
          key: THRESHOLD_KEY,
        });
        return {
          source: 'store',
          thresholds: mergeThresholds(VNB_MONITOR_DEFAULTS.thresholds, stored.payload),
        };
      } catch (_) {
        return {
          source: 'defaults',
          thresholds: { ...VNB_MONITOR_DEFAULTS.thresholds },
        };
      }
    },

    validateThresholds(candidateThresholds) {
      if (!candidateThresholds || typeof candidateThresholds !== 'object') {
        throw new Error('thresholds must be an object.');
      }

      const defaults = VNB_MONITOR_DEFAULTS.thresholds;
      const normalized = {};

      Object.entries(defaults).forEach(([fieldPath, defaultRule]) => {
        const nextRule = candidateThresholds[fieldPath];
        if (!nextRule || typeof nextRule !== 'object') {
          throw new Error(`Missing threshold rule: ${fieldPath}`);
        }

        const warning = Number(nextRule.warning);
        const critical = Number(nextRule.critical);

        if (!Number.isFinite(warning) || !Number.isFinite(critical)) {
          throw new Error(`Threshold values must be numeric for ${fieldPath}`);
        }

        const inverse = defaultRule.inverse === true;
        if (!inverse && critical < warning) {
          throw new Error(
            `Invalid threshold order for ${fieldPath}: critical must be >= warning for non-inverse metrics.`
          );
        }
        if (inverse && critical > warning) {
          throw new Error(
            `Invalid threshold order for ${fieldPath}: critical must be <= warning for inverse metrics.`
          );
        }

        normalized[fieldPath] = {
          warning,
          critical,
          fieldType: defaultRule.fieldType,
          inverse,
          description: defaultRule.description,
        };
      });

      return normalized;
    },
  },
};
