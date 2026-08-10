'use strict';

/**
 * Shared planar-projection geometry helpers for OSM-derived spatial
 * analysis. Extracted from src/osm-grid-topology.js when src/osm-landuse-
 * areas.js needed the same local-metres projection for polygon area
 * calculation, rather than duplicating it (per this repo's shared-utility
 * convention — see CLAUDE.md).
 *
 * All functions use an equirectangular (locally-flat) approximation around
 * a reference latitude — accurate to well under 1% error at the few-
 * kilometre scale of a single municipality query, which is more than
 * sufficient for the tens-of-metres proximity thresholds and polygon areas
 * these modules work with. Not suitable for country-scale geometry.
 */

const { haversineDistanceM } = require('./znp-clustering-heuristics');

/** Metres per degree of latitude (approx, standard WGS84 mid-latitude value). */
const M_PER_DEG_LAT = 110540;

/** Metres per degree of longitude at a given reference latitude. */
function mPerDegLon(refLatDeg) {
  return 111320 * Math.cos((refLatDeg * Math.PI) / 180);
}

/**
 * Projects a lat/lon point to local planar metres around a reference
 * latitude.
 * @param {number} lat @param {number} lon @param {number} refLat
 * @returns {{x: number, y: number}}
 */
function projectXY(lat, lon, refLat) {
  return { x: lon * mPerDegLon(refLat), y: lat * M_PER_DEG_LAT };
}

/**
 * Minimum distance from point P to segment AB (all in planar metres), plus
 * how far along AB (in metres from A) the closest point falls.
 * @returns {{distanceM: number, alongM: number}}
 */
function pointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const segLenSq = abx * abx + aby * aby;
  let t = segLenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / segLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return { distanceM: Math.sqrt(dx * dx + dy * dy), alongM: t * Math.sqrt(segLenSq) };
}

/**
 * Finds the closest point on a resolved polyline to a given location,
 * returning the perpendicular distance and the cumulative distance along
 * the polyline from its start to that point.
 * @param {number} lat @param {number} lon
 * @param {Array<{lat:number, lon:number}>} coords  Resolved polyline, >= 2 points.
 * @returns {{distanceM: number, alongM: number}}
 */
function nearestPointOnPolyline(lat, lon, coords) {
  const refLat = coords[0].lat;
  const p = projectXY(lat, lon, refLat);

  let best = null;
  let cumulativeM = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = projectXY(coords[i].lat, coords[i].lon, refLat);
    const b = projectXY(coords[i + 1].lat, coords[i + 1].lon, refLat);
    const { distanceM, alongM } = pointToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    const totalAlongM = cumulativeM + alongM;
    if (!best || distanceM < best.distanceM) best = { distanceM, alongM: totalAlongM };
    cumulativeM += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return best;
}

/**
 * Area of a closed polygon ring in square metres, via the shoelace formula
 * on the locally-projected coordinates. The ring does not need to be
 * explicitly closed (first point repeated as last) — this handles both.
 * @param {Array<{lat:number, lon:number}>} coords
 * @returns {number} area in m^2 (always >= 0)
 */
function polygonAreaM2(coords) {
  if (!coords || coords.length < 3) return 0;
  const refLat = coords[0].lat;
  const points = coords.map((c) => projectXY(c.lat, c.lon, refLat));

  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Centroid of a polygon ring (simple coordinate average — adequate for a
 * representative point label, not an area-weighted geometric centroid).
 * @param {Array<{lat:number, lon:number}>} coords
 * @returns {{lat: number, lon: number}|null}
 */
function polygonCentroid(coords) {
  if (!coords || coords.length === 0) return null;
  const sum = coords.reduce(
    (acc, c) => ({ lat: acc.lat + c.lat, lon: acc.lon + c.lon }),
    { lat: 0, lon: 0 }
  );
  return { lat: sum.lat / coords.length, lon: sum.lon / coords.length };
}

/**
 * @param {{south,west,north,east}} bbox
 * @returns {number} approximate area in km^2
 */
function bboxAreaSqKm(bbox) {
  const latKm = haversineDistanceM(bbox.south, bbox.west, bbox.north, bbox.west) / 1000;
  const lonKm = haversineDistanceM(bbox.south, bbox.west, bbox.south, bbox.east) / 1000;
  return latKm * lonKm;
}

/**
 * Expands a bbox by a fixed distance in metres on every side.
 * @param {{south,west,north,east}} bbox
 * @param {number} paddingM
 * @returns {{south,west,north,east}}
 */
function padBbox(bbox, paddingM) {
  const latPad = paddingM / M_PER_DEG_LAT;
  const lonPad = paddingM / mPerDegLon((bbox.south + bbox.north) / 2);
  return {
    south: bbox.south - latPad,
    north: bbox.north + latPad,
    west: bbox.west - lonPad,
    east: bbox.east + lonPad,
  };
}

module.exports = {
  M_PER_DEG_LAT,
  mPerDegLon,
  projectXY,
  pointToSegment,
  nearestPointOnPolyline,
  polygonAreaM2,
  polygonCentroid,
  bboxAreaSqKm,
  padBbox,
};
