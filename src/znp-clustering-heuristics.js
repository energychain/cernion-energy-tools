'use strict';

/**
 * ZNP Clustering Heuristics (Issue 3 — Layer 1 g-Factor Modulation)
 *
 * Detects spatial asset clusters and computes g-factor adjustments based on
 * building density. This is the core planning intelligence and USP of the
 * Cernion Zielnetzplanung: g-factor ≠ worst-case assumption.
 *
 * Heuristics:
 *   Solar clusters (≥ SOLAR_DENSITY_THRESHOLD assets in ≤ CLUSTER_RADIUS_M):
 *     → g × 0.85  (mutual shading reduces simultaneous peak feed-in)
 *   EV charger / wallbox clusters (≥ EV_DENSITY_THRESHOLD):
 *     → g × 1.15  (simultaneous evening charging demand spike)
 *
 * All threshold constants are exported for customer configurability (v2).
 */

// ─── Configurable thresholds ──────────────────────────────────────────────────

/** Radius in metres used for cluster detection. */
const CLUSTER_RADIUS_M = 500;

/** Minimum number of same-type assets to form a cluster. */
const CLUSTER_MIN_ASSETS = 5;

/**
 * Per-asset-type g-factor adjustment rules.
 * densityThreshold: minimum cluster size before the multiplier is applied.
 * multiplier:       applied to the VDE simultaneity factor when triggered.
 */
const G_FACTOR_RULES = {
  solar: {
    densityThreshold: 10,
    multiplier: 0.85,
    reason: 'Dichte PV-Bebauung: gegenseitige Verschattung reduziert Gleichzeitigkeit',
  },
  ev_charger: {
    densityThreshold: 5,
    multiplier: 1.15,
    reason: 'Wallbox-Cluster: gleichzeitiges Abendladen erhöht Gleichzeitigkeit',
  },
  wallbox: {
    densityThreshold: 5,
    multiplier: 1.15,
    reason: 'Wallbox-Cluster: gleichzeitiges Abendladen erhöht Gleichzeitigkeit',
  },
};

// ─── Distance helpers ─────────────────────────────────────────────────────────

/**
 * Haversine distance between two WGS84 coordinates in metres.
 * @param {number} lat1 @param {number} lon1
 * @param {number} lat2 @param {number} lon2
 * @returns {number} distance in metres
 */
function haversineDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Cluster detection ────────────────────────────────────────────────────────

/**
 * Greedy spatial cluster detection.
 * Groups assets of the same type that are within `radiusM` of the seed asset.
 * Each asset can belong to at most one cluster (first-match wins).
 *
 * @param {Array<{ nodeKey, lat, lon, assetType }>} assets
 * @param {number} [radiusM]     Cluster radius in metres (default: CLUSTER_RADIUS_M)
 * @param {number} [minAssets]   Minimum cluster size (default: CLUSTER_MIN_ASSETS)
 * @returns {Array<{ assetType, memberCount, centroid, memberNodeKeys }>}
 */
function detectClusters(assets, radiusM = CLUSTER_RADIUS_M, minAssets = CLUSTER_MIN_ASSETS) {
  const clusters = [];
  const assigned = new Set();
  const valid = assets.filter((a) => a.lat != null && a.lon != null);

  for (let i = 0; i < valid.length; i++) {
    if (assigned.has(i)) continue;
    const seed = valid[i];
    const members = [i];

    for (let j = i + 1; j < valid.length; j++) {
      if (assigned.has(j)) continue;
      const other = valid[j];
      if (other.assetType !== seed.assetType) continue;
      if (haversineDistanceM(seed.lat, seed.lon, other.lat, other.lon) <= radiusM) {
        members.push(j);
      }
    }

    if (members.length >= minAssets) {
      members.forEach((idx) => assigned.add(idx));
      clusters.push({
        assetType: seed.assetType || 'unknown',
        memberCount: members.length,
        centroid: { lat: seed.lat, lon: seed.lon },
        memberNodeKeys: members.map((idx) => valid[idx].nodeKey),
      });
    }
  }
  return clusters;
}

// ─── g-Factor adjustment ──────────────────────────────────────────────────────

/**
 * Compute the overall g-factor multiplier from a list of detected clusters.
 * All applicable cluster multipliers are applied cumulatively, then clamped
 * to the range [0.5, 1.5] to prevent physically implausible results.
 *
 * Returns 1.0 when there are no clusters (neutral: VDE table value unchanged).
 *
 * @param {Array} clusters  Output of detectClusters()
 * @returns {number}  g-factor multiplier (applied on top of VDE simultaneity factor)
 */
function computeGFactorAdjustment(clusters) {
  if (!clusters.length) return 1.0;

  let multiplier = 1.0;
  for (const cluster of clusters) {
    const rule = G_FACTOR_RULES[cluster.assetType];
    if (!rule) continue;
    if (cluster.memberCount >= rule.densityThreshold) {
      multiplier *= rule.multiplier;
    }
  }
  // Clamp to physically sensible range
  return Math.min(1.5, Math.max(0.5, multiplier));
}

module.exports = {
  detectClusters,
  computeGFactorAdjustment,
  haversineDistanceM,
  CLUSTER_RADIUS_M,
  CLUSTER_MIN_ASSETS,
  G_FACTOR_RULES,
};
