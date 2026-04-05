'use strict';

/**
 * Unit tests for src/znp-clustering-heuristics.js
 */

const {
  haversineDistanceM,
  detectClusters,
  computeGFactorAdjustment,
  CLUSTER_RADIUS_M,
  CLUSTER_MIN_ASSETS,
  G_FACTOR_RULES,
} = require('../src/znp-clustering-heuristics');

// ─── haversineDistanceM ───────────────────────────────────────────────────────

describe('haversineDistanceM', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(haversineDistanceM(49.49, 8.47, 49.49, 8.47)).toBeCloseTo(0, 0);
  });

  it('returns ~111 km for 1° latitude difference', () => {
    const d = haversineDistanceM(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it('returns a positive value for any two distinct points', () => {
    expect(haversineDistanceM(49.0, 8.0, 50.0, 9.0)).toBeGreaterThan(0);
  });
});

// ─── detectClusters ───────────────────────────────────────────────────────────

function makeAsset(i, lat, lon, assetType = 'solar') {
  return { nodeKey: `mastr:${i}`, lat, lon, assetType };
}

describe('detectClusters', () => {
  it('returns [] for an empty asset list', () => {
    expect(detectClusters([])).toEqual([]);
  });

  it('returns [] when no cluster reaches minAssets threshold', () => {
    const assets = [makeAsset(1, 49.49, 8.47), makeAsset(2, 49.491, 8.471)];
    expect(detectClusters(assets, CLUSTER_RADIUS_M, 5)).toEqual([]);
  });

  it('detects a cluster when enough same-type assets are close together', () => {
    // Place 6 solar assets within 100 m of each other
    const assets = Array.from({ length: 6 }, (_, i) =>
      makeAsset(i, 49.49 + i * 0.0001, 8.47, 'solar')
    );
    const clusters = detectClusters(assets, CLUSTER_RADIUS_M, 5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].assetType).toBe('solar');
    expect(clusters[0].memberCount).toBe(6);
  });

  it('does NOT cluster different asset types together', () => {
    const solarAssets = Array.from({ length: 5 }, (_, i) =>
      makeAsset(i, 49.49 + i * 0.0001, 8.47, 'solar')
    );
    const evAssets = Array.from({ length: 5 }, (_, i) =>
      makeAsset(10 + i, 49.49 + i * 0.0001, 8.47, 'ev_charger')
    );
    const clusters = detectClusters([...solarAssets, ...evAssets], CLUSTER_RADIUS_M, 5);
    expect(clusters).toHaveLength(2);
    const types = clusters.map((c) => c.assetType).sort();
    expect(types).toEqual(['ev_charger', 'solar']);
  });

  it('skips assets with null coordinates', () => {
    const assets = [
      makeAsset(1, null, null, 'solar'),
      makeAsset(2, undefined, undefined, 'solar'),
    ];
    expect(detectClusters(assets)).toEqual([]);
  });

  it('returns memberNodeKeys for each cluster member', () => {
    const assets = Array.from({ length: 5 }, (_, i) =>
      makeAsset(i, 49.49 + i * 0.0001, 8.47, 'solar')
    );
    const [cluster] = detectClusters(assets, CLUSTER_RADIUS_M, 5);
    expect(cluster.memberNodeKeys).toHaveLength(5);
    expect(cluster.memberNodeKeys[0]).toMatch(/^mastr:/);
  });
});

// ─── computeGFactorAdjustment ────────────────────────────────────────────────

describe('computeGFactorAdjustment', () => {
  it('returns 1.0 for an empty cluster list', () => {
    expect(computeGFactorAdjustment([])).toBe(1.0);
  });

  it('returns 0.85 for a solar cluster ≥ densityThreshold', () => {
    const clusters = [{ assetType: 'solar', memberCount: 12 }];
    expect(computeGFactorAdjustment(clusters)).toBeCloseTo(0.85, 4);
  });

  it('returns 1.15 for an ev_charger cluster ≥ densityThreshold', () => {
    const clusters = [{ assetType: 'ev_charger', memberCount: 6 }];
    expect(computeGFactorAdjustment(clusters)).toBeCloseTo(1.15, 4);
  });

  it('returns 1.0 for a cluster below densityThreshold', () => {
    const solarThreshold = G_FACTOR_RULES.solar.densityThreshold;
    const clusters = [{ assetType: 'solar', memberCount: solarThreshold - 1 }];
    expect(computeGFactorAdjustment(clusters)).toBe(1.0);
  });

  it('clamps to [0.5, 1.5] for extreme stacked multipliers', () => {
    // Stack many solar clusters to push multiplier below 0.5
    const manySolar = Array.from({ length: 20 }, () => ({ assetType: 'solar', memberCount: 15 }));
    const result = computeGFactorAdjustment(manySolar);
    expect(result).toBeGreaterThanOrEqual(0.5);
  });

  it('ignores unknown asset types', () => {
    const clusters = [{ assetType: 'biomass', memberCount: 50 }];
    expect(computeGFactorAdjustment(clusters)).toBe(1.0);
  });
});
