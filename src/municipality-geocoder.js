'use strict';

/**
 * Municipality Reverse Geocoder
 *
 * Resolves WGS84 coordinates to a German Amtlicher Gemeindeschlüssel (AGS) via
 * OpenStreetMap Nominatim reverse geocoding. OSM boundary relations for German
 * municipalities carry the AGS as `extratags['de:amtlicher_gemeindeschluessel']`
 * (verified live against real coordinates for both a Kreisfreie Stadt and a
 * regular Gemeinde before building this).
 *
 * Environment variables:
 *   NOMINATIM_ENDPOINT  Override API base URL (default: public Nominatim instance)
 *
 * Usage note: the public Nominatim instance's usage policy caps requests at
 * ~1/sec and requires an identifying User-Agent (unset by axios by default —
 * see src/znp-osm-buildings.js's Overpass fix for what happens without one).
 * For high-volume production workloads, point NOMINATIM_ENDPOINT at a private
 * mirror.
 */

const axios = require('axios');

const NOMINATIM_ENDPOINT =
  process.env.NOMINATIM_ENDPOINT || 'https://nominatim.openstreetmap.org/reverse';

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Reverse-geocode a lat/lon pair to a German municipality via Nominatim.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{
 *   found: boolean,
 *   ags: string|null,
 *   name: string|null,
 *   adminLevel: number|null,
 *   state: string|null,
 *   postalCode: string|null,
 *   displayName: string|null,
 * }>}
 */
async function reverseGeocodeToAgs(lat, lon) {
  let response;
  try {
    response = await axios.get(NOMINATIM_ENDPOINT, {
      params: {
        format: 'json',
        lat,
        lon,
        zoom: 10, // city/town/village level — matches German Gemeinde admin levels 6-8
        addressdetails: 1,
        extratags: 1,
      },
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        // nominatim.org's usage policy requires an identifying User-Agent;
        // requests without one are rejected.
        'User-Agent': 'cernion-energy-tools/municipality-geocoder (+https://cernion.energy)',
      },
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return emptyResult();
    }
    throw err;
  }

  const data = response.data;
  if (!data || typeof data !== 'object' || data.error) {
    return emptyResult();
  }

  const extratags = data.extratags || {};
  const address = data.address || {};
  const ags = extratags['de:amtlicher_gemeindeschluessel'] || null;

  return {
    found: Boolean(ags),
    ags,
    name: data.name || address.city || address.town || address.village || null,
    adminLevel: extratags.admin_level ? Number(extratags.admin_level) : null,
    state: address.state || null,
    postalCode: address.postcode || null,
    displayName: data.display_name || null,
  };
}

function emptyResult() {
  return {
    found: false,
    ags: null,
    name: null,
    adminLevel: null,
    state: null,
    postalCode: null,
    displayName: null,
  };
}

module.exports = { reverseGeocodeToAgs };
