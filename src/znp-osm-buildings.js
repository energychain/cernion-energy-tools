'use strict';

/**
 * ZNP OSM Buildings Helper (Issue 3 — Layer 1 Spatial Clustering)
 *
 * Fetches building footprints from the Overpass API for a project bounding box
 * using automatic 2×2 tiling to handle large areas without hitting API limits.
 * Also provides mapAssetsToBuildings(), which uses @turf/boolean-point-in-polygon
 * to match MaStR asset coordinates to building polygons.
 *
 * Environment variables:
 *   OVERPASS_ENDPOINT  Override API URL (default: public Overpass API)
 */

const axios = require('axios');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default;
const { point: turfPoint, polygon: turfPolygon } = require('@turf/helpers');

const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter';

/** Delay in ms between tile requests to respect public Overpass rate limits. */
const TILE_DELAY_MS = 500;

/** Number of tiles per axis (TILE_N × TILE_N total tiles). */
const TILE_N = 2;

// ─── Overpass helpers ─────────────────────────────────────────────────────────

/**
 * Divide a bounding box into an n×n tile grid.
 * @param {{ south, west, north, east }} bbox
 * @param {number} n
 * @returns {Array<{ south, west, north, east }>}
 */
function tileBbox(bbox, n) {
  const tiles = [];
  const latStep = (bbox.north - bbox.south) / n;
  const lonStep = (bbox.east - bbox.west) / n;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      tiles.push({
        south: bbox.south + row * latStep,
        north: bbox.south + (row + 1) * latStep,
        west: bbox.west + col * lonStep,
        east: bbox.west + (col + 1) * lonStep,
      });
    }
  }
  return tiles;
}

/**
 * Query Overpass for all `building=*` ways inside a single tile.
 * Returns raw building objects with GeoJSON polygon geometry and centroid.
 * @param {{ south, west, north, east }} tile
 * @returns {Promise<Array>}
 */
async function fetchBuildingTile(tile) {
  const query =
    `[out:json][timeout:30];` +
    `way["building"](${tile.south},${tile.west},${tile.north},${tile.east});` +
    `out geom;`;

  const response = await axios.post(OVERPASS_ENDPOINT, `data=${encodeURIComponent(query)}`, {
    timeout: 35000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return (response.data.elements || []).map(parseOverpassWay).filter(Boolean);
}

/**
 * Convert a raw Overpass `way` element to a normalised building object.
 * Returns null for degenerate ways (< 4 coordinate pairs after closing).
 * @param {Object} el  Overpass element
 * @returns {Object|null}
 */
function parseOverpassWay(el) {
  if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 3) {
    return null;
  }
  const coords = el.geometry.map((g) => [g.lon, g.lat]);
  // Ensure the ring is closed (GeoJSON requirement)
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  if (coords.length < 4) return null;

  const centroid = {
    lat: el.geometry.reduce((s, g) => s + g.lat, 0) / el.geometry.length,
    lon: el.geometry.reduce((s, g) => s + g.lon, 0) / el.geometry.length,
  };
  return {
    osmId: `way/${el.id}`,
    geoJsonPolygon: { type: 'Polygon', coordinates: [coords] },
    centroid,
    tags: el.tags || {},
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch all building footprints inside a bounding box using 2×2 tiling.
 *
 * Calls `onTileProgress(tileNumber, totalTiles)` before each tile request so
 * the caller can emit job-log progress messages.
 *
 * @param {{ south, west, north, east }} bbox    Project bounding box
 * @param {Function} [onTileProgress]            Optional progress callback
 * @returns {Promise<Array>}  Deduplicated building objects
 */
async function fetchBuildingsForBbox(bbox, onTileProgress) {
  const tiles = tileBbox(bbox, TILE_N);
  const seen = new Set();
  const result = [];

  for (let i = 0; i < tiles.length; i++) {
    if (onTileProgress) onTileProgress(i + 1, tiles.length);
    const buildings = await fetchBuildingTile(tiles[i]);
    for (const b of buildings) {
      if (seen.has(b.osmId)) continue;
      seen.add(b.osmId);
      result.push(b);
    }
    if (i < tiles.length - 1) {
      await new Promise((r) => setTimeout(r, TILE_DELAY_MS));
    }
  }
  return result;
}

/**
 * Map an array of MaStR asset nodes to the buildings that contain them.
 * Uses @turf/boolean-point-in-polygon for the spatial containment test.
 *
 * @param {Array<{ nodeKey, lat, lon }>} assetNodes  Layer 0 asset descriptors
 * @param {Array}                        buildings   Output of fetchBuildingsForBbox
 * @returns {Array<{ assetNodeKey: string, buildingOsmId: string, building: Object }>}
 */
function mapAssetsToBuildings(assetNodes, buildings) {
  const mappings = [];
  for (const building of buildings) {
    let poly;
    try {
      poly = turfPolygon(building.geoJsonPolygon.coordinates);
    } catch {
      continue; // skip malformed polygons
    }
    for (const asset of assetNodes) {
      if (asset.lat == null || asset.lon == null) continue;
      const pt = turfPoint([asset.lon, asset.lat]);
      if (booleanPointInPolygon(pt, poly)) {
        mappings.push({ assetNodeKey: asset.nodeKey, buildingOsmId: building.osmId, building });
      }
    }
  }
  return mappings;
}

module.exports = { fetchBuildingsForBbox, mapAssetsToBuildings, tileBbox, parseOverpassWay };
