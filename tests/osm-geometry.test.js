'use strict';

/**
 * Tests for src/osm-geometry.js — shared planar-projection geometry helpers
 * used by src/osm-grid-topology.js and src/osm-landuse-areas.js.
 */

const {
  projectXY,
  pointToSegment,
  nearestPointOnPolyline,
  polygonAreaM2,
  polygonCentroid,
  bboxAreaSqKm,
  padBbox,
  M_PER_DEG_LAT,
  mPerDegLon,
} = require('../src/osm-geometry');

describe('projectXY / mPerDegLon', () => {
  it('increases x with longitude and y with latitude', () => {
    const a = projectXY(49.3, 8.5, 49.3);
    const b = projectXY(49.3, 8.51, 49.3);
    const c = projectXY(49.31, 8.5, 49.3);
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.y).toBeGreaterThan(a.y);
  });

  it('mPerDegLon shrinks toward the poles (cosine falloff)', () => {
    expect(mPerDegLon(0)).toBeCloseTo(111320, 0);
    expect(mPerDegLon(60)).toBeCloseTo(111320 * 0.5, 0);
  });
});

describe('pointToSegment', () => {
  it('returns 0 distance for a point on the segment', () => {
    const { distanceM } = pointToSegment(5, 0, 0, 0, 10, 0);
    expect(distanceM).toBeCloseTo(0, 5);
  });

  it('clamps the projection to the segment endpoints', () => {
    const { alongM } = pointToSegment(-5, 3, 0, 0, 10, 0);
    expect(alongM).toBe(0); // clamped to A, not extrapolated to -5
  });
});

describe('nearestPointOnPolyline', () => {
  it('finds 0 distance for a point exactly on a vertex', () => {
    const coords = [
      { lat: 49.3, lon: 8.5 },
      { lat: 49.31, lon: 8.5 },
    ];
    const result = nearestPointOnPolyline(49.3, 8.5, coords);
    expect(result.distanceM).toBeLessThan(1);
  });
});

describe('polygonAreaM2', () => {
  it('computes the exact area of a known 100m x 100m square', () => {
    const lat0 = 49.3;
    const lon0 = 8.5;
    const dLat = 100 / M_PER_DEG_LAT;
    const dLon = 100 / mPerDegLon(lat0);
    const square = [
      { lat: lat0, lon: lon0 },
      { lat: lat0, lon: lon0 + dLon },
      { lat: lat0 + dLat, lon: lon0 + dLon },
      { lat: lat0 + dLat, lon: lon0 },
    ];
    expect(polygonAreaM2(square)).toBeCloseTo(10000, -1); // within ~10m^2
  });

  it('is unaffected by winding direction (clockwise vs counter-clockwise)', () => {
    const lat0 = 49.3;
    const lon0 = 8.5;
    const dLat = 50 / M_PER_DEG_LAT;
    const dLon = 50 / mPerDegLon(lat0);
    const cw = [
      { lat: lat0, lon: lon0 },
      { lat: lat0 + dLat, lon: lon0 },
      { lat: lat0 + dLat, lon: lon0 + dLon },
      { lat: lat0, lon: lon0 + dLon },
    ];
    const ccw = [...cw].reverse();
    expect(polygonAreaM2(cw)).toBeCloseTo(polygonAreaM2(ccw), 1);
  });

  it('returns 0 for fewer than 3 points or empty input', () => {
    expect(polygonAreaM2([])).toBe(0);
    expect(polygonAreaM2([{ lat: 0, lon: 0 }])).toBe(0);
    expect(polygonAreaM2([{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }])).toBe(0);
  });

  it('handles a ring that is not explicitly closed (first point not repeated as last)', () => {
    const lat0 = 49.3;
    const lon0 = 8.5;
    const dLat = 100 / M_PER_DEG_LAT;
    const dLon = 100 / mPerDegLon(lat0);
    const openRing = [
      { lat: lat0, lon: lon0 },
      { lat: lat0, lon: lon0 + dLon },
      { lat: lat0 + dLat, lon: lon0 + dLon },
      { lat: lat0 + dLat, lon: lon0 },
    ];
    const closedRing = [...openRing, openRing[0]];
    expect(polygonAreaM2(openRing)).toBeCloseTo(polygonAreaM2(closedRing), 1);
  });
});

describe('polygonCentroid', () => {
  it('returns the coordinate average of the ring', () => {
    const square = [
      { lat: 49.3, lon: 8.5 },
      { lat: 49.3, lon: 8.502 },
      { lat: 49.302, lon: 8.502 },
      { lat: 49.302, lon: 8.5 },
    ];
    const centroid = polygonCentroid(square);
    expect(centroid.lat).toBeCloseTo(49.301, 3);
    expect(centroid.lon).toBeCloseTo(8.501, 3);
  });

  it('returns null for an empty ring', () => {
    expect(polygonCentroid([])).toBeNull();
  });
});

describe('bboxAreaSqKm', () => {
  it('computes a plausible area for a ~10km x 10km bbox', () => {
    const area = bboxAreaSqKm({ south: 49.273, west: 8.483, north: 49.363, east: 8.621 });
    expect(area).toBeGreaterThan(50);
    expect(area).toBeLessThan(150);
  });
});

describe('padBbox', () => {
  it('expands the bbox outward on every side by approximately the requested metres', () => {
    const bbox = { south: 49.3, west: 8.5, north: 49.31, east: 8.51 };
    const padded = padBbox(bbox, 2000);
    expect(padded.south).toBeLessThan(bbox.south);
    expect(padded.north).toBeGreaterThan(bbox.north);
    expect(padded.west).toBeLessThan(bbox.west);
    expect(padded.east).toBeGreaterThan(bbox.east);
    const latPadM = (bbox.south - padded.south) * M_PER_DEG_LAT;
    expect(latPadM).toBeGreaterThan(1900);
    expect(latPadM).toBeLessThan(2100);
  });

  it('zero padding is a no-op', () => {
    const bbox = { south: 49.3, west: 8.5, north: 49.31, east: 8.51 };
    expect(padBbox(bbox, 0)).toEqual(bbox);
  });
});
