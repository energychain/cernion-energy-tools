'use strict';

/**
 * CYA Topology Hop Detector (Voltage-Level Resolver)
 *
 * Determines whether an asset's capacity requires connection to a higher-voltage
 * network tier (MS → HS → HöS) rather than the local distribution grid. This is
 * a best-effort, non-blocking helper — OSM unavailability returns gracefully.
 *
 * Business rule: assets are routed based on VOLTAGE_THRESHOLDS capacity bands.
 * Physical consequence: the connection point is typically not in the asset's
 * municipality but at the nearest substation of the required voltage class.
 *
 * EU AI Act / Data Provenance: all findings are marked dataProvenance:'osm'
 * or dataProvenance:'inferred' so downstream consumers can trace the source.
 *
 * v0.26.8: Generalized from hardcoded 10 MW (HS only) to 4-tier cascade.
 */

/**
 * Voltage-level thresholds: capacity in MW → required voltage class
 *
 * @type {Array<{minMw: number, maxMw: number, voltageClass: string, voltageKv: string, severity: string}>}
 */
const VOLTAGE_THRESHOLDS = [
  { minMw: 0, maxMw: 10, voltageClass: 'MS', voltageKv: '10 kV', severity: 'none' },
  { minMw: 10, maxMw: 50, voltageClass: 'MS', voltageKv: '20 kV', severity: 'info' },
  { minMw: 50, maxMw: 150, voltageClass: 'HS', voltageKv: '110 kV', severity: 'warning' },
  {
    minMw: 150,
    maxMw: Infinity,
    voltageClass: 'HöS',
    voltageKv: '220/380 kV',
    severity: 'critical',
  },
];

/**
 * Determine the required voltage class for the given asset capacity.
 *
 * @param {number} capacityMw - Asset capacity in MW
 * @returns {{minMw: number, maxMw: number, voltageClass: string, voltageKv: string, severity: string} | null}
 */
function determineRequiredVoltageLevel(capacityMw) {
  if (capacityMw === null || capacityMw === undefined) {
    return null;
  }
  return VOLTAGE_THRESHOLDS.find((t) => capacityMw >= t.minMw && capacityMw < t.maxMw);
}

/**
 * Assess whether the given asset requires a voltage-level hop to HS or HöS.
 *
 * @param {import('moleculer').Context} ctx - Moleculer context (used to call osm-geo.substationFinder)
 * @param {{ location: string, capacityMw: number }} options
 * @returns {Promise<{
 *   needsHop: boolean,
 *   voltageClass?: string,
 *   voltageKv?: string,
 *   severity?: string,
 *   physicalConnectionPoint?: object,
 *   inferredOperator?: string|null,
 *   rationale?: string,
 *   reason?: string,
 *   dataProvenance?: string,
 * }>}
 */
async function assessTopologyHop(ctx, { location, capacityMw }) {
  if (!location || capacityMw === undefined || capacityMw === null) {
    return { needsHop: false, reason: 'insufficient_input' };
  }

  const voltageLevel = determineRequiredVoltageLevel(capacityMw);
  if (!voltageLevel) {
    return { needsHop: false, reason: 'capacity_out_of_range' };
  }

  // No hop needed for MS-only assets (<50 MW)
  if (voltageLevel.voltageClass === 'MS' && capacityMw < 50) {
    return {
      needsHop: false,
      reason: 'capacity_below_hs_threshold',
      voltageClass: 'MS',
      voltageKv: voltageLevel.voltageKv,
      severity: voltageLevel.severity,
      capacityMw,
    };
  }

  // HS/HöS assets (≥50 MW) require topology hop — try OSM lookup
  const hopType = voltageLevel.voltageClass === 'HS' ? 'HS' : 'HöS';
  try {
    const result = await ctx.call(
      'osm-geo.substationFinder',
      { location, voltageLevel: hopType, maxResults: 5 },
      { meta: { cernionToken: ctx.meta.cernionToken } }
    );

    if (result && result.nearestSubstations && result.nearestSubstations.length > 0) {
      const nearest = result.nearestSubstations[0];
      return {
        needsHop: true,
        voltageClass: voltageLevel.voltageClass,
        voltageKv: voltageLevel.voltageKv,
        severity: voltageLevel.severity,
        targetVoltage: hopType,
        physicalConnectionPoint: {
          lat: nearest.lat,
          lon: nearest.lon,
          name: nearest.name,
          distance_km: nearest.distance_km,
        },
        inferredOperator: result.operatorName || null,
        rationale: `Asset ${capacityMw} MW requires ${voltageLevel.voltageKv} connection. Nearest ${hopType} substation: ${nearest.name} (${nearest.distance_km} km)`,
        dataProvenance: 'osm',
      };
    }

    // OSM returned no substations
    return {
      needsHop: true,
      voltageClass: voltageLevel.voltageClass,
      voltageKv: voltageLevel.voltageKv,
      severity: voltageLevel.severity,
      targetVoltage: hopType,
      reason: 'no_substations_found',
      rationale: `Asset ${capacityMw} MW requires ${voltageLevel.voltageKv} connection, but no nearby substations in OSM data`,
      dataProvenance: 'inferred',
    };
  } catch (err) {
    // OSM/Overpass unavailable — graceful degrade
    return {
      needsHop: true,
      voltageClass: voltageLevel.voltageClass,
      voltageKv: voltageLevel.voltageKv,
      severity: voltageLevel.severity,
      targetVoltage: hopType,
      reason: 'osm_unavailable',
      rationale: `Asset ${capacityMw} MW theoretically requires ${voltageLevel.voltageKv} connection (OSM topology lookup failed)`,
      dataProvenance: 'inferred',
      error: err.message,
    };
  }
}

module.exports = {
  VOLTAGE_THRESHOLDS,
  determineRequiredVoltageLevel,
  assessTopologyHop,
};
