'use strict';

/**
 * CYA Topology Hop Detector
 *
 * Determines whether an asset's capacity requires connection to the upstream
 * 110-kV (HS) network rather than the local distribution grid. This is a
 * best-effort, non-blocking helper — OSM unavailability returns gracefully.
 *
 * Business rule: assets >= MW_THRESHOLD_110KV require HS-level connection.
 * Physical consequence: the connection point is typically not in the asset's
 * municipality but at the nearest HS/MS substation in a neighbouring area.
 *
 * EU AI Act / Data Provenance: all findings are marked dataProvenance:'osm'
 * or dataProvenance:'inferred' so downstream consumers can trace the source.
 */

const MW_THRESHOLD_110KV = 10;

/**
 * Assess whether the given asset requires a voltage-level hop to 110 kV (HS).
 *
 * @param {import('moleculer').Context} ctx - Moleculer context (used to call osm-geo.substationFinder)
 * @param {{ location: string, capacityMw: number }} options
 * @returns {Promise<{
 *   needsHop: boolean,
 *   targetVoltage?: 'HS',
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

  if (capacityMw < MW_THRESHOLD_110KV) {
    return {
      needsHop: false,
      reason: 'capacity_below_threshold',
      thresholdMw: MW_THRESHOLD_110KV,
      capacityMw,
    };
  }

  // Best-effort OSM lookup — must never throw into the CYA pipeline.
  try {
    const result = await ctx.call('osm-geo.substationFinder', {
      location,
      voltageLevel: 'HS',
      maxResults: 5,
    }, { meta: { cernionToken: ctx.meta.cernionToken } });

    const substations = result?.data?.substations || [];
    const summary = result?.data?.summary || {};
    const dominantOperator = summary?.dominantOperator || null;

    if (substations.length === 0) {
      return {
        needsHop: true,
        targetVoltage: 'HS',
        physicalConnectionPoint: null,
        inferredOperator: null,
        rationale: `Asset (${capacityMw} MW) überschreitet die ${MW_THRESHOLD_110KV}-MW-Schwelle. Kein HS-Umspannwerk in OSM-Daten für "${location}" gefunden — Anschlusspunkt muss manuell ermittelt werden.`,
        dataProvenance: 'osm',
      };
    }

    const nearestSubstation = substations[0];
    return {
      needsHop: true,
      targetVoltage: 'HS',
      physicalConnectionPoint: {
        osmId: nearestSubstation.osmId,
        name: nearestSubstation.name || null,
        location: nearestSubstation.location,
        voltageLevel: nearestSubstation.voltageLevel,
        operator: nearestSubstation.operator || dominantOperator,
      },
      inferredOperator: nearestSubstation.operator || dominantOperator,
      rationale: `Asset (${capacityMw} MW) überschreitet die ${MW_THRESHOLD_110KV}-MW-Schwelle. Physikalischer Anschlusspunkt liegt nicht in "${location}", sondern am nächsten HS-Umspannwerk${nearestSubstation.name ? ` "${nearestSubstation.name}"` : ''} (Netzbetreiber: ${nearestSubstation.operator || dominantOperator || 'unbekannt'}).`,
      dataProvenance: 'osm',
    };
  } catch {
    // Graceful degradation — OSM or Overpass temporarily unavailable.
    return {
      needsHop: capacityMw >= MW_THRESHOLD_110KV,
      targetVoltage: capacityMw >= MW_THRESHOLD_110KV ? 'HS' : undefined,
      physicalConnectionPoint: null,
      inferredOperator: null,
      rationale: capacityMw >= MW_THRESHOLD_110KV
        ? `Asset (${capacityMw} MW) überschreitet die ${MW_THRESHOLD_110KV}-MW-Schwelle — HS-Anschluss erforderlich. OSM-Geodaten aktuell nicht verfügbar, physikalischer Anschlusspunkt muss manuell ermittelt werden.`
        : undefined,
      reason: 'osm_unavailable',
      dataProvenance: 'inferred',
    };
  }
}

module.exports = {
  MW_THRESHOLD_110KV,
  assessTopologyHop,
};
