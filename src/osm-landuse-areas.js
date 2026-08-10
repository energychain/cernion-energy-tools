'use strict';

/**
 * OSM Landuse Areas — sector-split evidence for municipal load estimation.
 *
 * Background: src/municipal-load-estimator.js's sectorFractionsForProfile()
 * currently derives the commercial/public/residential load split purely
 * from population and density (evidenceStatus: 'heuristic-fallback'), and
 * its own nextGateLabel names the fix: "OSM-Gebäudenutzung, MaStR-
 * Anlagenstandorte und kommunale Liegenschaften für lokalen Lastsplit
 * verbinden." This module is that OSM building-usage evidence source —
 * OSM landuse=* polygon areas grouped by type, for a caller (e.g.
 * CernionGIS) to weight a municipality-wide value by area share instead of
 * equal distribution.
 *
 * Same Overpass data source and User-Agent/query conventions as
 * src/osm-grid-topology.js and src/znp-osm-buildings.js; shares the
 * planar-projection geometry helpers in src/osm-geometry.js (polygon area
 * via the shoelace formula on a local equirectangular projection —
 * verified against a known 100m x 100m square before use).
 *
 * Scope limitation: only simple closed `way` polygons are handled. OSM
 * also allows landuse areas mapped as multipolygon `relation`s (a way with
 * excluded inner rings/holes, or multiple disjoint outer rings) — these are
 * real but rarer for the residential/commercial/retail/industrial/
 * institutional categories relevant here, and are not fetched or counted
 * in v1. Their absence understates totalAreaM2ByType for whichever areas
 * happen to be relation-mapped, not a silent miscalculation.
 */

const axios = require('axios');
const { polygonAreaM2, polygonCentroid, bboxAreaSqKm } = require('./osm-geometry');

const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter';
const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT = 'cernion-energy-tools/osm-landuse-areas (+https://cernion.energy)';

/** Bbox area guard — protects the public Overpass instance from oversized queries. */
const MAX_BBOX_AREA_SQ_KM = 2500; // ~50km x 50km

/**
 * Default landuse categories fetched when the caller doesn't restrict via
 * landuseTypes — the OSM tags relevant to the residential/commercial/
 * public sector split used by municipal-load-estimator.js.
 */
const DEFAULT_LANDUSE_TYPES = [
  'residential',
  'commercial',
  'retail',
  'industrial',
  'institutional',
];

/**
 * Fetches OSM landuse=* way polygons within a bbox and computes their area
 * and centroid locally (no separate node-resolution pass needed — Overpass
 * `out geom` inlines full-resolution coordinates per way).
 * @param {{south,west,north,east}} bbox
 * @param {string[]} [landuseTypes]  Restrict to these landuse values; defaults to DEFAULT_LANDUSE_TYPES.
 * @returns {Promise<object[]>} areas
 */
async function fetchLanduseAreas(bbox, landuseTypes) {
  const types =
    Array.isArray(landuseTypes) && landuseTypes.length ? landuseTypes : DEFAULT_LANDUSE_TYPES;
  const typePattern = types.map((t) => t.replace(/[^a-z_]/gi, '')).join('|');

  const query =
    `[out:json][timeout:30];` +
    `way["landuse"~"^(${typePattern})$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `out geom;`;

  const response = await axios.post(OVERPASS_ENDPOINT, `data=${encodeURIComponent(query)}`, {
    timeout: REQUEST_TIMEOUT_MS + 5000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
  });

  const elements = response.data?.elements || [];
  const areas = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 3) continue;
    const coords = el.geometry
      .filter((g) => g && g.lat != null && g.lon != null)
      .map((g) => ({ lat: g.lat, lon: g.lon }));
    if (coords.length < 3) continue;

    areas.push({
      osmId: `way/${el.id}`,
      landuseType: el.tags?.landuse || null,
      name: el.tags?.name || null,
      areaM2Approx: Math.round(polygonAreaM2(coords)),
      centroid: polygonCentroid(coords),
    });
  }
  return areas;
}

/**
 * Aggregates a landuse area list into per-type totals.
 * @param {object[]} areas
 * @returns {{totalAreaM2ByType: Record<string, number>, areaCount: number}}
 */
function summarizeLanduseAreas(areas) {
  const totalAreaM2ByType = {};
  for (const area of areas) {
    const key = area.landuseType || 'unknown';
    totalAreaM2ByType[key] = (totalAreaM2ByType[key] || 0) + area.areaM2Approx;
  }
  return { totalAreaM2ByType, areaCount: areas.length };
}

module.exports = {
  DEFAULT_LANDUSE_TYPES,
  MAX_BBOX_AREA_SQ_KM,
  fetchLanduseAreas,
  summarizeLanduseAreas,
  bboxAreaSqKm,
};
