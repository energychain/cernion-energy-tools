'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const EdmSqlitePool = require('../src/edm-sqlite-pool');
const {
  STANDARD_PROFILES,
  determineSeason,
  determineDayType,
  getStandardProfileValues,
} = require('../src/slp-profiles');

function parseCustomValues(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

module.exports = {
  name: 'slp',
  timeout: 30000,
  settings: {},

  started() {
    const dbPath = this.settings.dbPath || process.env.EDM_DB_PATH || 'data/edm';
    this.pool = new EdmSqlitePool(dbPath);
  },

  stopped() {
    if (this.pool) {
      this.pool.closeAll();
    }
  },

  actions: {
    listProfiles: {
      rest: 'GET /profiles',
      openapi: {
        summary: 'List SLP profiles',
        tags: ['SLP (Standardlastprofile)'],
        responses: { 200: { description: 'Profile list' } },
      },
      handler() {
        const standardProfiles = Object.values(STANDARD_PROFILES).map((profile) => ({
          id: profile.id,
          name: profile.name,
          type: 'standard',
          description: profile.description,
        }));

        const db = this.pool.getRegistry();
        const customRows = db
          .prepare('SELECT profile_id, name, base_profile, season, day_type, owner FROM custom_slp ORDER BY created_at DESC')
          .all();

        const customProfiles = customRows.map((row) => ({
          id: row.profile_id,
          name: row.name,
          type: 'custom',
          baseProfile: row.base_profile,
          season: row.season,
          dayType: row.day_type,
          owner: row.owner,
        }));

        return {
          success: true,
          profiles: [...standardProfiles, ...customProfiles],
        };
      },
    },

    getProfile: {
      rest: 'GET /profiles/:profileId',
      params: {
        profileId: { type: 'string', min: 1 },
        date: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Get one SLP profile',
        tags: ['SLP (Standardlastprofile)'],
        parameters: [
          { name: 'profileId', in: 'path', required: true, schema: { type: 'string', example: 'H0' } },
          { name: 'date', in: 'query', required: false, schema: { type: 'string', example: '2026-01-15' } },
        ],
        responses: { 200: { description: 'Profile' }, 404: { description: 'Not found' } },
      },
      handler(ctx) {
        const date = ctx.params.date || new Date().toISOString().slice(0, 10);
        const standard = getStandardProfileValues(ctx.params.profileId, date);
        if (standard) {
          return {
            success: true,
            profileId: standard.profileId,
            name: standard.name,
            season: standard.season,
            dayType: standard.dayType,
            values: standard.values,
          };
        }

        const db = this.pool.getRegistry();
        const row = db.prepare('SELECT * FROM custom_slp WHERE profile_id = ?').get(ctx.params.profileId);

        if (!row) {
          throw new MoleculerClientError('Profile not found', 404, 'PROFILE_NOT_FOUND');
        }

        const values = parseCustomValues(row.values);
        if (!values || values.length !== 96) {
          throw new MoleculerClientError('Invalid custom profile values', 500, 'PROFILE_DATA_INVALID');
        }

        return {
          success: true,
          profileId: row.profile_id,
          name: row.name,
          season: row.season,
          dayType: row.day_type,
          values,
        };
      },
    },

    generateTimeseries: {
      rest: 'POST /generate',
      params: {
        profileId: { type: 'string', min: 1 },
        date: { type: 'string', min: 1 },
        annualConsumptionKwh: { type: 'number', convert: true },
      },
      openapi: {
        summary: 'Generate 96 quarter-hour SLP values',
        tags: ['SLP (Standardlastprofile)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['profileId', 'date', 'annualConsumptionKwh'],
                properties: {
                  profileId: { type: 'string', example: 'H0' },
                  date: { type: 'string', example: '2026-01-15' },
                  annualConsumptionKwh: { type: 'number', example: 3500 },
                },
              },
              examples: {
                default: {
                  value: {
                    profileId: 'H0',
                    date: '2026-01-15',
                    annualConsumptionKwh: 3500,
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Generated' }, 404: { description: 'Profile not found' } },
      },
      handler(ctx) {
        const { profileId, date, annualConsumptionKwh } = ctx.params;
        const season = determineSeason(date);
        const dayType = determineDayType(date);

        let profile = getStandardProfileValues(profileId, date);

        if (!profile) {
          const db = this.pool.getRegistry();
          const row = db.prepare('SELECT * FROM custom_slp WHERE profile_id = ?').get(profileId);
          if (!row) {
            throw new MoleculerClientError('Profile not found', 404, 'PROFILE_NOT_FOUND');
          }

          const values = parseCustomValues(row.values);
          if (!values || values.length !== 96) {
            throw new MoleculerClientError('Invalid custom profile values', 500, 'PROFILE_DATA_INVALID');
          }

          profile = {
            profileId,
            name: row.name,
            season: row.season,
            dayType: row.day_type,
            values,
          };
        }

        const sum = profile.values.reduce((acc, value) => acc + Number(value || 0), 0);
        if (sum <= 0) {
          throw new MoleculerClientError('Profile values must sum to > 0', 400, 'PROFILE_VALUES_INVALID');
        }

        const dailyConsumption = annualConsumptionKwh / 365;
        const values = profile.values.map((value) => {
          return Number(((Number(value || 0) / sum) * dailyConsumption).toFixed(8));
        });

        const totalKwh = Number(values.reduce((acc, value) => acc + value, 0).toFixed(8));
        const peakKw = Number((Math.max(...values) * 4).toFixed(8));

        return {
          success: true,
          profileId,
          date,
          season,
          dayType,
          values,
          totalKwh,
          peakKw,
        };
      },
    },

    createCustomProfile: {
      rest: 'POST /profiles',
      params: {
        profileId: { type: 'string', pattern: /^[a-z0-9_]+$/ },
        name: { type: 'string' },
        baseProfile: { type: 'string', optional: true },
        season: { type: 'enum', values: ['winter', 'summer', 'transition', 'all'] },
        dayType: { type: 'enum', values: ['weekday', 'saturday', 'sunday', 'all'] },
        values: { type: 'array', items: 'number', min: 96, max: 96 },
        owner: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Create custom SLP profile',
        tags: ['SLP (Standardlastprofile)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['profileId', 'name', 'season', 'dayType', 'values'],
                properties: {
                  profileId: { type: 'string', example: 'custom_muster_001' },
                  name: { type: 'string', example: 'Nachtspeicher-Profil Muster' },
                  baseProfile: { type: 'string', example: 'H0' },
                  season: { type: 'string', enum: ['winter', 'summer', 'transition', 'all'], example: 'all' },
                  dayType: { type: 'string', enum: ['weekday', 'saturday', 'sunday', 'all'], example: 'all' },
                  values: { type: 'array', items: { type: 'number' }, minItems: 96, maxItems: 96, example: new Array(96).fill(1 / 96) },
                  owner: { type: 'string', example: 'Stadtwerke Beispiel' },
                },
              },
              examples: {
                default: {
                  value: {
                    profileId: 'custom_muster_001',
                    name: 'Nachtspeicher-Profil Muster',
                    season: 'all',
                    dayType: 'all',
                    values: new Array(96).fill(1 / 96),
                    owner: 'Stadtwerke Beispiel',
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Created' } },
      },
      handler(ctx) {
        const { profileId, name, baseProfile, season, dayType, values, owner } = ctx.params;
        if (STANDARD_PROFILES[profileId]) {
          throw new MoleculerClientError('Standard profile IDs are reserved', 400, 'PROFILE_RESERVED');
        }

        const db = this.pool.getRegistry();
        const existing = db.prepare('SELECT profile_id FROM custom_slp WHERE profile_id = ?').get(profileId);
        if (existing) {
          throw new MoleculerClientError('Profile already exists', 409, 'PROFILE_EXISTS');
        }

        db.prepare(`
          INSERT INTO custom_slp (
            profile_id, name, base_profile, season, day_type, "values", owner
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          profileId,
          name,
          baseProfile || null,
          season,
          dayType,
          JSON.stringify(values),
          owner || null
        );

        return { success: true, profileId, createdAt: new Date().toISOString() };
      },
    },

    deleteCustomProfile: {
      rest: 'DELETE /profiles/:profileId',
      params: {
        profileId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Delete custom SLP profile',
        tags: ['SLP (Standardlastprofile)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['profileId'],
                properties: {
                  profileId: { type: 'string', example: 'custom_muster_001' },
                },
              },
              examples: {
                default: { value: { profileId: 'custom_muster_001' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Deleted' }, 400: { description: 'Standard profile cannot be deleted' } },
      },
      handler(ctx) {
        const { profileId } = ctx.params;

        if (STANDARD_PROFILES[profileId]) {
          throw new MoleculerClientError(
            'Standard profile cannot be deleted',
            400,
            'STANDARD_PROFILE_READ_ONLY'
          );
        }

        const db = this.pool.getRegistry();
        const existing = db.prepare('SELECT profile_id FROM custom_slp WHERE profile_id = ?').get(profileId);
        if (!existing) {
          throw new MoleculerClientError('Profile not found', 404, 'PROFILE_NOT_FOUND');
        }

        db.prepare('DELETE FROM custom_slp WHERE profile_id = ?').run(profileId);
        return { success: true, profileId, deleted: true };
      },
    },
  },
};
