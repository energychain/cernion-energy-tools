'use strict';

/**
 * Unit tests for src/znp-osm-buildings.js
 *
 * Overpass HTTP calls are mocked via axios.
 */

jest.mock('axios', () => ({
  post: jest.fn(),
}));

// Turf is a pure math library — no need to mock it.

const axios = require('axios');
const { tileBbox, parseOverpassWay, mapAssetsToBuildings } = require('../src/znp-osm-buildings');

// ─── tileBbox ─────────────────────────────────────────────────────────────────

describe('tileBbox', () => {
  const bbox = { south: 49.47, west: 8.43, north: 49.52, east: 8.52 };

  it('returns n² tiles for an n×n split', () => {
    expect(tileBbox(bbox, 2)).toHaveLength(4);
    expect(tileBbox(bbox, 3)).toHaveLength(9);
  });

  it('tiles cover the full extent without gaps', () => {
    const tiles = tileBbox(bbox, 2);
    const minSouth = Math.min(...tiles.map((t) => t.south));
    const maxNorth = Math.max(...tiles.map((t) => t.north));
    const minWest  = Math.min(...tiles.map((t) => t.west));
    const maxEast  = Math.max(...tiles.map((t) => t.east));
    expect(minSouth).toBeCloseTo(bbox.south, 6);
    expect(maxNorth).toBeCloseTo(bbox.north, 6);
    expect(minWest).toBeCloseTo(bbox.west, 6);
    expect(maxEast).toBeCloseTo(bbox.east, 6);
  });

  it('each tile has south < north and west < east', () => {
    for (const t of tileBbox(bbox, 2)) {
      expect(t.south).toBeLessThan(t.north);
      expect(t.west).toBeLessThan(t.east);
    }
  });
});

// ─── parseOverpassWay ─────────────────────────────────────────────────────────

describe('parseOverpassWay', () => {
  it('returns null for non-way elements', () => {
    expect(parseOverpassWay({ type: 'node', id: 1, geometry: [] })).toBeNull();
  });

  it('returns null for ways with fewer than 3 geometry points', () => {
    expect(parseOverpassWay({ type: 'way', id: 1, geometry: [{ lat: 1, lon: 1 }] })).toBeNull();
  });

  it('parses a valid way into a building object', () => {
    const el = {
      type: 'way', id: 123456,
      geometry: [
        { lat: 49.49, lon: 8.47 },
        { lat: 49.491, lon: 8.47 },
        { lat: 49.491, lon: 8.471 },
        { lat: 49.49, lon: 8.47 },
      ],
      tags: { building: 'yes' },
    };
    const result = parseOverpassWay(el);
    expect(result).not.toBeNull();
    expect(result.osmId).toBe('way/123456');
    expect(result.geoJsonPolygon.type).toBe('Polygon');
    expect(result.centroid.lat).toBeGreaterThan(49);
    expect(result.tags).toEqual({ building: 'yes' });
  });

  it('closes an open ring automatically', () => {
    const el = {
      type: 'way', id: 99,
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 0, lon: 1 },
        // NOT closed — last point ≠ first
      ],
      tags: {},
    };
    const result = parseOverpassWay(el);
    const coords = result.geoJsonPolygon.coordinates[0];
    const first = coords[0];
    const last  = coords[coords.length - 1];
    expect(first).toEqual(last);
  });
});

// ─── mapAssetsToBuildings ─────────────────────────────────────────────────────

describe('mapAssetsToBuildings', () => {
  it('returns [] when buildings list is empty', () => {
    const assets = [{ nodeKey: 'mastr:A', lat: 49.49, lon: 8.47, assetType: 'solar' }];
    expect(mapAssetsToBuildings(assets, [])).toEqual([]);
  });

  it('returns [] when asset list is empty', () => {
    const building = {
      osmId: 'way/1',
      geoJsonPolygon: {
        type: 'Polygon',
        coordinates: [[[8.46, 49.48], [8.48, 49.48], [8.48, 49.50], [8.46, 49.50], [8.46, 49.48]]],
      },
      centroid: { lat: 49.49, lon: 8.47 },
      tags: {},
    };
    expect(mapAssetsToBuildings([], [building])).toEqual([]);
  });

  it('maps an asset that lies inside a building polygon', () => {
    const building = {
      osmId: 'way/42',
      geoJsonPolygon: {
        type: 'Polygon',
        // Large box covering lat 49.48–49.50, lon 8.46–8.48
        coordinates: [[[8.46, 49.48], [8.48, 49.48], [8.48, 49.50], [8.46, 49.50], [8.46, 49.48]]],
      },
      centroid: { lat: 49.49, lon: 8.47 },
      tags: {},
    };
    const assets = [{ nodeKey: 'mastr:INSIDE', lat: 49.49, lon: 8.47, assetType: 'solar' }];
    const mappings = mapAssetsToBuildings(assets, [building]);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].assetNodeKey).toBe('mastr:INSIDE');
    expect(mappings[0].buildingOsmId).toBe('way/42');
  });

  it('does NOT map an asset outside the polygon', () => {
    const building = {
      osmId: 'way/5',
      geoJsonPolygon: {
        type: 'Polygon',
        // Tiny box in the North Sea
        coordinates: [[[3.0, 54.0], [3.1, 54.0], [3.1, 54.1], [3.0, 54.1], [3.0, 54.0]]],
      },
      centroid: { lat: 54.05, lon: 3.05 },
      tags: {},
    };
    const assets = [{ nodeKey: 'mastr:FAR', lat: 49.49, lon: 8.47, assetType: 'solar' }];
    expect(mapAssetsToBuildings(assets, [building])).toEqual([]);
  });

  it('skips assets with null/undefined coordinates', () => {
    const building = {
      osmId: 'way/7',
      geoJsonPolygon: {
        type: 'Polygon',
        coordinates: [[[8.46, 49.48], [8.48, 49.48], [8.48, 49.50], [8.46, 49.50], [8.46, 49.48]]],
      },
      centroid: { lat: 49.49, lon: 8.47 },
      tags: {},
    };
    const assets = [{ nodeKey: 'mastr:NULL', lat: null, lon: null, assetType: 'solar' }];
    expect(mapAssetsToBuildings(assets, [building])).toEqual([]);
  });
});
