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

const fs = require('fs');

const VNB_MONITOR_DEFAULTS = require('../src/vnb-monitor-defaults');

const CONFIG_FILE = process.env.VNB_MONITOR_ALERT_CONFIG_FILE || './vnb-monitor-alerts.config.json';
const CACHE_TTL_SECONDS = parseInt(process.env.VNB_MONITOR_CACHE_TTL_SECONDS || '3600', 10);
const SCHEMA_VERSION = '1.0';

function loadAlertConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(raw);
      return config.thresholds || {};
    }
  } catch (err) {
    this.logger?.warn(`Failed to load alert config from ${CONFIG_FILE}:`, err.message);
  }
  return {};
}

function saveAlertConfig(thresholds, logger) {
  try {
    const payload = {
      thresholds,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logger?.warn(`Failed to persist alert config at ${CONFIG_FILE}:`, err.message);
    return false;
  }
}

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

/**
 * Resolves VNB identity (name, MaStR ID) from BDEW code
 */
async function resolveVnbIdentity(ctx, bdewCode, hintName = null) {
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
    this.logger?.warn(`Failed to resolve VNB identity for ${bdewCode}:`, err.message);
  }

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
 * Fetches EWK benchmarks in parallel
 */
async function fetchEwkData(ctx, bdewCode) {
  const results = {
    sourceAvailable: false,
    reportYear: 2024,
    operatorName: null,
    anschlussdauer: null,
    umsetzungsquote: null,
    digitalisierungsindex: null,
    sourceError: null,
  };

  const sourceErrors = [];

  try {
    // Sequential calls – the Cernion MCP server enforces a ~3-session-per-token
    // concurrency limit. Firing all three EWK tools in parallel risks a
    // "-32001 Session not found" error when another concurrent request (e.g.
    // nbp-monitor calling vnb-monitor.snapshot on a cold cache) opens sessions
    // at the same time. Sequential calls stay within the limit at the cost of
    // ~2× latency, which is acceptable given the 1-hour snapshot cache.
    const anschlussdauer = await ctx
      .call('ewk-monitoring.anschlussdauer', { bnr: bdewCode })
      .catch((err) => {
        sourceErrors.push(`anschlussdauer: ${err.message}`);
        this.logger?.warn(`EWK anschlussdauer failed for ${bdewCode}:`, err.message);
        return null;
      });
    const umsetzungsquote = await ctx
      .call('ewk-monitoring.umsetzungsquote', { bnr: bdewCode })
      .catch((err) => {
        sourceErrors.push(`umsetzungsquote: ${err.message}`);
        this.logger?.warn(`EWK umsetzungsquote failed for ${bdewCode}:`, err.message);
        return null;
      });
    const digitalisierungsindex = await ctx
      .call('ewk-monitoring.digitalisierungsindex', { bnr: bdewCode })
      .catch((err) => {
        sourceErrors.push(`digitalisierungsindex: ${err.message}`);
        this.logger?.warn(`EWK digitalisierungsindex failed for ${bdewCode}:`, err.message);
        return null;
      });

    const anschlussdauerJson = parseStructuredToolResult(anschlussdauer);
    const umsetzungsquoteJson = parseStructuredToolResult(umsetzungsquote);
    const digitalisierungsindexJson = parseStructuredToolResult(digitalisierungsindex);

    const anschlussRow = anschlussdauerJson?.rows?.[0] || null;
    const umsetzungsquoteRow = umsetzungsquoteJson?.rows?.[0] || null;
    const digitalisierungsindexRow = digitalisierungsindexJson?.rows?.[0] || null;

    if (anschlussRow || umsetzungsquoteRow || digitalisierungsindexRow) {
      results.sourceAvailable = true;
      results.operatorName =
        anschlussRow?.firmenname ||
        umsetzungsquoteRow?.firmenname ||
        digitalisierungsindexRow?.firmenname ||
        null;

      if (anschlussRow) {
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

      if (umsetzungsquoteRow) {
        const eeNsRank = parseRank(umsetzungsquoteRow.rank_umsetzungsquote_ee_ns);
        results.umsetzungsquote = {
          eeNS_percent: umsetzungsquoteRow.umsetzungsquote_ee_ns ?? null,
          verbrauchNS_percent: umsetzungsquoteRow.umsetzungsquote_verbrauch_ns ?? null,
          verbrauchMS_percent: umsetzungsquoteRow.umsetzungsquote_verbrauch_ms ?? null,
          rankEeNS: eeNsRank.rank,
          totalVnbs: eeNsRank.total,
        };
      }

      if (digitalisierungsindexRow) {
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
    }
  } catch (err) {
    results.sourceError = err.message;
    this.logger?.warn(`EWK data fetch failed for ${bdewCode}:`, err.message);
  }

  if (!results.sourceError && sourceErrors.length > 0) {
    results.sourceError = sourceErrors.join('; ');
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

  try {
    const [installedAssets, plannedAssets, queueAssets] = await Promise.all([
      ctx.call('assets.all', {
        ...filterParams,
        limit: 1000,
        operationalStatus: '35',
      }).catch((err) => {
        sourceErrors.push(`inBetrieb: ${err.message}`);
        this.logger?.warn(`MaStR inBetrieb failed for ${identity.name}:`, err.message);
        return null;
      }),
      ctx.call('assets.all', {
        ...filterParams,
        limit: 1000,
        operationalStatus: '31',
      }).catch((err) => {
        sourceErrors.push(`inPlanung: ${err.message}`);
        this.logger?.warn(`MaStR inPlanung failed for ${identity.name}:`, err.message);
        return null;
      }),
      ctx.call('assets.all', {
        ...filterParams,
        limit: 1000,
        operationalStatus: 'all',
        netzbetreiberPruefungStatus: '2955',
      }).catch((err) => {
        sourceErrors.push(`netzbetreiberPruefung: ${err.message}`);
        this.logger?.warn(`MaStR queue failed for ${identity.name}:`, err.message);
        return null;
      }),
    ]);

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
              ? ((totalPlannedCapacity /
                  Number(results.inBetrieb.leistungMW)) *
                  100).toFixed(1)
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
    this.logger?.warn(`MaStR data fetch failed for ${identity.name || identity.bdewCode}:`, err.message);
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

  try {
    // Sequential calls – both endpoints are MCP-backed and can overlap with
    // the MaStR/identity phases of the same snapshot or with a concurrent
    // nbp-monitor request for the same VNB. Running them serially avoids
    // exhausting the upstream per-token session limit.
    const priceData = await ctx
      .call('energy-market.prices', { market: 'day-ahead', region: 'Deutschland' })
      .catch((err) => {
        sourceErrors.push(`prices: ${err.message}`);
        this.logger?.warn('Market prices fetch failed:', err.message);
        return null;
      });
    const gasData = await ctx
      .call('gas-storage.countryStorage', { country: 'DE' })
      .catch((err) => {
        sourceErrors.push(`gas-storage: ${err.message}`);
        this.logger?.warn('Gas storage fetch failed:', err.message);
        return null;
      });

    if (priceData || gasData) {
      results.sourceAvailable = true;

      if (priceData?.success !== false && Array.isArray(priceData?.dataPoints) && priceData.dataPoints[0]) {
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
        recommendation: codeDef
          ? codeDef[`recommendation_${lang}`]
          : 'Review operation parameters',
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
    this.alertThresholds = mergeThresholds(
      VNB_MONITOR_DEFAULTS.thresholds,
      loadAlertConfig.call(this)
    );
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

        // Check cache
        const cacheKey = `vnb-monitor:${bdewCode}`;
        if (!refresh && this.cache.has(cacheKey)) {
          const cached = this.cache.get(cacheKey);
          if (new Date() < new Date(cached.expiresAt)) {
            return cached.data;
          }
        }

        const ewkData = await fetchEwkData.call(this, ctx, bdewCode);
        const identity = await resolveVnbIdentity.call(this, ctx, bdewCode);
        
        // Override EWK operatorName with correctly-resolved identity name to ensure consistency
        if (ewkData.sourceAvailable && identity.name) {
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
            bdewCode,
            location: identity.location,
            resolvedAt: identity.resolvedAt,
          },
          ewk: ewkData,
          mastr: mastrData,
          market: marketData,
          alerts: includeAlerts ? generateAlerts(
            { ewk: ewkData, mastr: mastrData, market: marketData },
            this.alertThresholds,
            lang
          ) : [],
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

        const results = await Promise.all(
          codes.map((code) =>
            ctx.call('vnb-monitor.snapshot', {
              bdewCode: code,
              refresh,
              alerts: true,
              lang,
            })
          )
        );

        return results;
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
        description: 'Removes the cached snapshot for a VNB, forcing a fresh fetch on next request.',
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
        const cacheKey = `vnb-monitor:${bdewCode}`;
        const existed = this.cache.has(cacheKey);
        this.cache.delete(cacheKey);

        return {
          bdewCode,
          cleared: true,
          message: existed ? `Cache cleared for ${bdewCode}` : `No cache entry found for ${bdewCode}`,
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
                    configFile: { type: 'string' },
                    thresholds: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      handler() {
        return {
          source: fs.existsSync(CONFIG_FILE) ? 'file' : 'defaults',
          configFile: CONFIG_FILE,
          thresholds: this.alertThresholds,
        };
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
      handler(ctx) {
        const nextThresholds = this.validateThresholds(ctx.params.thresholds);
        const persisted = saveAlertConfig(nextThresholds, this.logger);
        if (!persisted) {
          throw new Error('Failed to persist threshold configuration.');
        }

        this.alertThresholds = mergeThresholds(VNB_MONITOR_DEFAULTS.thresholds, nextThresholds);
        this.cache.clear();

        return {
          success: true,
          message: 'Alert thresholds updated and cache invalidated.',
          configFile: CONFIG_FILE,
          thresholds: this.alertThresholds,
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
      handler() {
        if (fs.existsSync(CONFIG_FILE)) {
          fs.unlinkSync(CONFIG_FILE);
        }

        this.alertThresholds = { ...VNB_MONITOR_DEFAULTS.thresholds };
        this.cache.clear();

        return {
          success: true,
          message: 'Alert thresholds reset to defaults and cache invalidated.',
          configFile: CONFIG_FILE,
          thresholds: this.alertThresholds,
        };
      },
    },
  },

  methods: {
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
