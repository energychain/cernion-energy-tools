'use strict';

/**
 * Municipality Service — read-only Amtlicher Gemeindeschlüssel (AGS) lookup
 *
 * Thin, dedicated lookup surface over src/municipality-resolver.js's
 * resolveMunicipalityProfile() (name/PLZ/AGS -> profile, offline against
 * Destatis GV100 2022) and src/municipality-geocoder.js's reverse geocoder
 * (lat/lon -> AGS via Nominatim). Neither existing capability had its own
 * standalone action before this — resolveMunicipalityProfile was only
 * reachable indirectly through dashboard-api's much heavier
 * municipalEnergyValueAnalysisStatus (economic Lagebild, year/scenario
 * params), and coordinate-based lookup did not exist anywhere.
 */

const { MoleculerClientError } = require('moleculer').Errors;
const { resolveMunicipalityProfile } = require('../src/municipality-resolver');
const { reverseGeocodeToAgs } = require('../src/municipality-geocoder');

module.exports = {
  name: 'municipality',

  actions: {
    // ------------------------------------------------------------------
    // lookup — resolve a municipality profile by name, PLZ, or AGS
    // ------------------------------------------------------------------
    lookup: {
      rest: 'GET /lookup',
      params: {
        municipality: { type: 'string', optional: true, min: 1 },
        ags: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        summary: 'Look up a German municipality by name, PLZ, or AGS',
        tags: ['Municipality'],
        description:
          'Resolves a municipality profile (AGS, name, Bundesland, population, PLZ) from ' +
          'a municipality name, a 5-digit PLZ, or an Amtlicher Gemeindeschlüssel (AGS). ' +
          'Offline lookup against Destatis Gemeindegrenzen 2022 (GV100, 10,990 municipalities) ' +
          '— no external API call. found:true with population:null means the name/PLZ ' +
          'resolved but there was no Destatis GV100 match (name+state known only).',
        parameters: [
          {
            name: 'municipality',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'Hockenheim' },
            description: 'Municipality name or 5-digit PLZ.',
          },
          {
            name: 'ags',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '08226032' },
            description: 'Amtlicher Gemeindeschlüssel, takes priority over municipality.',
          },
        ],
        responses: {
          200: {
            description: 'Municipality profile (found:false if unresolved)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    found: { type: 'boolean' },
                    name: { type: 'string', nullable: true },
                    ags: { type: 'string', nullable: true },
                    state: { type: 'string', nullable: true },
                    postalCode: { type: 'string', nullable: true },
                    population: { type: 'integer', nullable: true },
                    areaSqKm: { type: 'number', nullable: true },
                    sourceStatus: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { municipality, ags } = ctx.params;
        if (!municipality && !ags) {
          throw new MoleculerClientError(
            'At least one of municipality or ags is required',
            422,
            'VALIDATION_ERROR'
          );
        }

        const profile = resolveMunicipalityProfile({ municipality, ags });
        return {
          found: profile.found,
          name: profile.name,
          ags: profile.ags,
          state: profile.state,
          postalCode: profile.postalCode,
          population: profile.population,
          areaSqKm: profile.areaSqKm,
          sourceStatus: profile.sourceStatus,
        };
      },
    },

    // ------------------------------------------------------------------
    // reverseGeocode — resolve a municipality profile from coordinates
    // ------------------------------------------------------------------
    reverseGeocode: {
      rest: 'GET /reverse-geocode',
      params: {
        lat: { type: 'number', convert: true, min: -90, max: 90 },
        lon: { type: 'number', convert: true, min: -180, max: 180 },
      },
      openapi: {
        summary: 'Resolve a German municipality (AGS) from WGS84 coordinates',
        tags: ['Municipality'],
        description:
          'Reverse-geocodes a lat/lon pair via OpenStreetMap Nominatim to a German ' +
          'Amtlicher Gemeindeschlüssel (AGS), then joins it against the same Destatis GV100 ' +
          'profile as GET /municipality/lookup. found:false means the coordinates do not ' +
          'fall inside a German municipality boundary known to Nominatim (e.g. outside ' +
          'Germany, or open water). Live external call — not cached; the public Nominatim ' +
          'instance is rate-limited to ~1 request/second, set NOMINATIM_ENDPOINT for a ' +
          'private mirror under sustained load.',
        parameters: [
          {
            name: 'lat',
            in: 'query',
            required: true,
            schema: { type: 'number', example: 49.3183 },
          },
          {
            name: 'lon',
            in: 'query',
            required: true,
            schema: { type: 'number', example: 8.5495 },
          },
        ],
        responses: {
          200: {
            description: 'Municipality profile resolved from coordinates (found:false if unresolved)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    found: { type: 'boolean' },
                    name: { type: 'string', nullable: true },
                    ags: { type: 'string', nullable: true },
                    state: { type: 'string', nullable: true },
                    postalCode: { type: 'string', nullable: true },
                    population: { type: 'integer', nullable: true },
                    areaSqKm: { type: 'number', nullable: true },
                    sourceStatus: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { lat, lon } = ctx.params;

        const geo = await reverseGeocodeToAgs(lat, lon);
        if (!geo.found) {
          return {
            found: false,
            name: geo.name,
            ags: null,
            state: geo.state,
            postalCode: geo.postalCode,
            population: null,
            areaSqKm: null,
            sourceStatus: 'geocoding-no-ags-match',
          };
        }

        const profile = resolveMunicipalityProfile({ ags: geo.ags });
        if (profile.found) {
          return {
            found: true,
            name: profile.name,
            ags: profile.ags,
            state: profile.state,
            postalCode: profile.postalCode || geo.postalCode,
            population: profile.population,
            areaSqKm: profile.areaSqKm,
            sourceStatus: profile.sourceStatus,
          };
        }

        // Nominatim resolved an AGS that isn't in our GV100 2022 snapshot
        // (e.g. a post-2022 territorial reform) — surface what we have.
        return {
          found: true,
          name: geo.name,
          ags: geo.ags,
          state: geo.state,
          postalCode: geo.postalCode,
          population: null,
          areaSqKm: null,
          sourceStatus: 'geocoding-only-no-gv100-match',
        };
      },
    },
  },
};
