'use strict';

/**
 * Tests for src/osm-landuse-areas.js — OSM landuse=* polygon area extraction,
 * sector-split evidence for src/municipal-load-estimator.js (see its
 * nextGateLabel: "OSM-Gebäudenutzung ... für lokalen Lastsplit verbinden.").
 */

jest.mock('axios');

const axios = require('axios');
const {
  DEFAULT_LANDUSE_TYPES,
  MAX_BBOX_AREA_SQ_KM,
  fetchLanduseAreas,
  summarizeLanduseAreas,
  bboxAreaSqKm,
} = require('../src/osm-landuse-areas');

beforeEach(() => {
  axios.post.mockReset();
});

const HOCKENHEIM_BBOX = { south: 49.273, west: 8.483, north: 49.363, east: 8.621 };

// A small square way, real Overpass `out geom` shape: geometry inlines
// {lat, lon} per node directly on the way, no separate node resolution.
function squareWay(id, landuseType, name, lat0, lon0, sizeDeg) {
  return {
    type: 'way',
    id,
    tags: { landuse: landuseType, ...(name ? { name } : {}) },
    geometry: [
      { lat: lat0, lon: lon0 },
      { lat: lat0, lon: lon0 + sizeDeg },
      { lat: lat0 + sizeDeg, lon: lon0 + sizeDeg },
      { lat: lat0 + sizeDeg, lon: lon0 },
    ],
  };
}

describe('fetchLanduseAreas', () => {
  it('parses way polygons into areas with computed areaM2Approx and centroid', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        elements: [squareWay(1, 'industrial', 'Hägebüch', 49.33, 8.55, 0.001)],
      },
    });
    const areas = await fetchLanduseAreas(HOCKENHEIM_BBOX);
    expect(areas).toHaveLength(1);
    expect(areas[0].osmId).toBe('way/1');
    expect(areas[0].landuseType).toBe('industrial');
    expect(areas[0].name).toBe('Hägebüch');
    expect(areas[0].areaM2Approx).toBeGreaterThan(0);
    expect(areas[0].centroid).toHaveProperty('lat');
    expect(areas[0].centroid).toHaveProperty('lon');
  });

  it('defaults to the 5 supported landuse types when landuseTypes is omitted', async () => {
    axios.post.mockResolvedValueOnce({ data: { elements: [] } });
    await fetchLanduseAreas(HOCKENHEIM_BBOX);
    const [, body] = axios.post.mock.calls[0];
    const decoded = decodeURIComponent(body);
    for (const type of DEFAULT_LANDUSE_TYPES) {
      expect(decoded).toContain(type);
    }
  });

  it('restricts the query to the given landuseTypes filter', async () => {
    axios.post.mockResolvedValueOnce({ data: { elements: [] } });
    await fetchLanduseAreas(HOCKENHEIM_BBOX, ['industrial', 'retail']);
    const [, body] = axios.post.mock.calls[0];
    const decoded = decodeURIComponent(body);
    expect(decoded).toContain('industrial|retail');
    expect(decoded).not.toContain('residential');
  });

  it('returns null name for unnamed areas', async () => {
    axios.post.mockResolvedValueOnce({
      data: { elements: [squareWay(2, 'commercial', null, 49.3, 8.5, 0.0005)] },
    });
    const areas = await fetchLanduseAreas(HOCKENHEIM_BBOX);
    expect(areas[0].name).toBeNull();
  });

  it('skips ways with fewer than 3 resolvable geometry points (degenerate)', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        elements: [
          {
            type: 'way',
            id: 3,
            tags: { landuse: 'industrial' },
            geometry: [
              { lat: 49.3, lon: 8.5 },
              { lat: 49.301, lon: 8.501 },
            ],
          },
        ],
      },
    });
    const areas = await fetchLanduseAreas(HOCKENHEIM_BBOX);
    expect(areas).toHaveLength(0);
  });

  it('ignores non-way elements defensively', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        elements: [
          { type: 'node', id: 99, lat: 49.3, lon: 8.5, tags: { landuse: 'industrial' } },
          squareWay(4, 'retail', null, 49.32, 8.52, 0.0008),
        ],
      },
    });
    const areas = await fetchLanduseAreas(HOCKENHEIM_BBOX);
    expect(areas).toHaveLength(1);
    expect(areas[0].osmId).toBe('way/4');
  });

  it('sends an identifying User-Agent (Overpass 406 lesson from the addLayer1 fix)', async () => {
    axios.post.mockResolvedValueOnce({ data: { elements: [] } });
    await fetchLanduseAreas(HOCKENHEIM_BBOX);
    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers['User-Agent']).toBeTruthy();
  });

  it('propagates a hard fetch error to the caller', async () => {
    axios.post.mockRejectedValueOnce(new Error('OVERPASS_TIMEOUT'));
    await expect(fetchLanduseAreas(HOCKENHEIM_BBOX)).rejects.toThrow('OVERPASS_TIMEOUT');
  });
});

describe('summarizeLanduseAreas', () => {
  it('aggregates total area per landuse type', () => {
    const areas = [
      { landuseType: 'industrial', areaM2Approx: 1000 },
      { landuseType: 'industrial', areaM2Approx: 500 },
      { landuseType: 'retail', areaM2Approx: 200 },
    ];
    const summary = summarizeLanduseAreas(areas);
    expect(summary.totalAreaM2ByType).toEqual({ industrial: 1500, retail: 200 });
    expect(summary.areaCount).toBe(3);
  });

  it('returns an empty summary for an empty area list', () => {
    const summary = summarizeLanduseAreas([]);
    expect(summary.totalAreaM2ByType).toEqual({});
    expect(summary.areaCount).toBe(0);
  });
});

describe('module constants', () => {
  it('re-exports bboxAreaSqKm and MAX_BBOX_AREA_SQ_KM for the service handler guard', () => {
    expect(typeof bboxAreaSqKm).toBe('function');
    expect(MAX_BBOX_AREA_SQ_KM).toBeGreaterThan(0);
    expect(DEFAULT_LANDUSE_TYPES).toEqual(
      expect.arrayContaining(['residential', 'commercial', 'retail', 'industrial', 'institutional'])
    );
  });
});
